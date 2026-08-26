import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { parseGscAiCsv, GscAiCsvError } from './gsc-ai-csv.js';
import { assessAiModeQuery, summarizeAiMode, type AiModeAssessment } from './ai-mode-pattern.js';

/**
 * Google AI yuzeyi — AI Overviews / AI Mode.
 *
 * Urunun 7 saglayicisi Google'in AI yuzeylerini hic kapsamiyor (Gemini API
 * != AI Overviews). Google birinci-taraf veriyi yalniz GSC UI export'uyla
 * veriyor (API yok). Bu servis:
 *   1) CSV import — onizleme + yanlis-dosya korumasi + idempotent upsert
 *   2) gosterim serisi — panel grafigi
 *   3) AI-Mode-suphesi sorgular — mevcut GSC snapshot'larindan sezgisel liste
 */

const SURFACE = 'gen_ai';
/** Ayni gunun normal arama gosteriminin bu orani asiliyorsa "yanlis dosya?" uyarisi */
const SUSPICIOUS_RATIO = 0.5;

@Injectable()
export class GoogleAiSurfaceService {
  private readonly log = new Logger(GoogleAiSurfaceService.name);

  constructor(private readonly prisma: PrismaService) {}

  private parseOrThrow(csv: string) {
    try {
      return parseGscAiCsv(csv ?? '');
    } catch (err: any) {
      if (err instanceof GscAiCsvError) throw new BadRequestException(err.message);
      throw err;
    }
  }

  /** Gunluk normal-arama gosterimleriyle kiyas: AI gosterimi > %50 ise suphe */
  private async suspiciousDays(siteId: string, rows: Array<{ date: string; impressions: number }>) {
    const dates = rows.map((r) => new Date(`${r.date}T00:00:00Z`));
    const snaps = await this.prisma.analyticsSnapshot.findMany({
      where: { siteId, date: { in: dates } },
      select: { date: true, totalImpressions: true },
    });
    const byDate = new Map(snaps.map((s) => [s.date.toISOString().slice(0, 10), s.totalImpressions]));
    return rows.filter((r) => {
      const total = byDate.get(r.date);
      return typeof total === 'number' && total > 0 && r.impressions > total * SUSPICIOUS_RATIO;
    }).map((r) => r.date);
  }

  async preview(siteId: string, csv: string) {
    const parsed = this.parseOrThrow(csv);
    const suspicious = await this.suspiciousDays(siteId, parsed.rows);
    return {
      rows: parsed.rows.length,
      from: parsed.rows[0].date,
      to: parsed.rows[parsed.rows.length - 1].date,
      totalImpressions: parsed.rows.reduce((a, r) => a + r.impressions, 0),
      mapping: parsed.mapping,
      delimiter: parsed.delimiter === '\t' ? 'tab' : parsed.delimiter,
      warnings: parsed.warnings.slice(0, 10),
      suspiciousDays: suspicious,
      suspiciousNote: suspicious.length
        ? `${suspicious.length} günde AI gösterimi, aynı günün toplam arama gösteriminin yarısından fazla — dosyanın Üretken AI raporu olduğundan emin olun.`
        : null,
    };
  }

  async import(siteId: string, csv: string, opts: { fileName?: string } = {}) {
    const parsed = this.parseOrThrow(csv);
    const suspicious = await this.suspiciousDays(siteId, parsed.rows);
    const importedAt = new Date().toISOString();
    let saved = 0;
    for (const r of parsed.rows) {
      const date = new Date(`${r.date}T00:00:00Z`);
      await this.prisma.gscAiVisibilitySnapshot.upsert({
        where: { siteId_date_surface: { siteId, date, surface: SURFACE } },
        update: { impressions: r.impressions, clicks: r.clicks, position: r.position, meta: { fileName: opts.fileName ?? null, mapping: parsed.mapping, importedAt } },
        create: {
          siteId, date, surface: SURFACE,
          impressions: r.impressions, clicks: r.clicks, position: r.position,
          source: 'csv_upload',
          meta: { fileName: opts.fileName ?? null, mapping: parsed.mapping, importedAt },
        },
      });
      saved++;
    }
    this.log.log(`[${siteId}] GSC GenAI import: ${saved} gun (${parsed.rows[0].date}..${parsed.rows[parsed.rows.length - 1].date})`);
    return {
      saved,
      from: parsed.rows[0].date,
      to: parsed.rows[parsed.rows.length - 1].date,
      totalImpressions: parsed.rows.reduce((a, r) => a + r.impressions, 0),
      suspiciousDays: suspicious,
      warnings: parsed.warnings.slice(0, 10),
    };
  }

  /** Panel serisi + son 28 gun vs onceki 28 gun */
  async series(siteId: string, days = 90) {
    const since = new Date(Date.now() - Math.min(Math.max(days, 7), 365) * 86_400_000);
    const rows = await this.prisma.gscAiVisibilitySnapshot.findMany({
      where: { siteId, surface: SURFACE, date: { gte: since } },
      orderBy: { date: 'asc' },
      select: { date: true, impressions: true, meta: true },
    });
    const series = rows.map((r) => ({ date: r.date.toISOString().slice(0, 10), impressions: r.impressions }));
    const cut28 = Date.now() - 28 * 86_400_000;
    const cut56 = Date.now() - 56 * 86_400_000;
    const sum = (from: number, to: number) => rows
      .filter((r) => r.date.getTime() >= from && r.date.getTime() < to)
      .reduce((a, r) => a + r.impressions, 0);
    const last28 = sum(cut28, Number.POSITIVE_INFINITY);
    const prev28 = sum(cut56, cut28);
    const lastImport = rows.length ? (rows[rows.length - 1].meta as any)?.importedAt ?? null : null;
    return {
      series,
      totals: { last28, prev28, deltaPct: prev28 > 0 ? Math.round(((last28 - prev28) / prev28) * 100) : null },
      lastImportAt: lastImport,
      note: 'Google bu raporu yalnız gösterim olarak ve AI Overviews / AI Mode ayrımı olmadan verir; tıklama ve sorgu yok.',
    };
  }

  /**
   * Mevcut GSC snapshot'larindan AI-Mode-suphesi sorgular. Sorgu bazinda
   * toplanir (gosterim/tiklama toplami, gosterim-agirlikli pozisyon).
   */
  async aiModeQueries(siteId: string, days = 28) {
    const since = new Date(Date.now() - Math.min(Math.max(days, 7), 90) * 86_400_000);
    const snaps = await this.prisma.analyticsSnapshot.findMany({
      where: { siteId, date: { gte: since } },
      select: { queryDetails: true },
    });
    const agg = new Map<string, { impressions: number; clicks: number; posW: number }>();
    for (const s of snaps) {
      const rows = Array.isArray(s.queryDetails) ? (s.queryDetails as any[]) : [];
      for (const r of rows) {
        const q = typeof r?.query === 'string' ? r.query.trim() : '';
        if (!q) continue;
        const cur = agg.get(q) ?? { impressions: 0, clicks: 0, posW: 0 };
        const imp = Number(r.impressions ?? 0);
        cur.impressions += imp;
        cur.clicks += Number(r.clicks ?? 0);
        cur.posW += Number(r.position ?? 0) * imp;
        agg.set(q, cur);
      }
    }
    const assessed: AiModeAssessment[] = [...agg.entries()].map(([query, v]) => assessAiModeQuery({
      query,
      impressions: v.impressions,
      clicks: v.clicks,
      position: v.impressions > 0 ? Math.round((v.posW / v.impressions) * 10) / 10 : null,
    }));
    const likely = assessed.filter((a) => a.aiModeLikely).sort((a, b) => b.impressions - a.impressions).slice(0, 50);
    return {
      days,
      summary: summarizeAiMode(assessed),
      queries: likely,
      note: 'Sezgisel tahmin — GSC hangi sorgunun AI Mode\'dan geldiğini söylemez. Snapshot tıklama sıralı ilk 100 satırı tuttuğu için tıklamasız sorgular büyük sitelerde eksik görünebilir.',
    };
  }
}
