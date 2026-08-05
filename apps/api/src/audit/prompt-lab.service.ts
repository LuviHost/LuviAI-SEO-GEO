import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AiCitationService, type CitationProbe, type Provider } from './ai-citation.service.js';
import { FanoutService } from './fanout.service.js';

/**
 * Prompt Lab — kullanicinin takip ettigi sorulari yonetir ve calistirir.
 *
 * NEDEN VAR: Citation probe sorgulari bugune kadar brain'den otomatik
 * turuyordu (seoStrategy.aeoQueries vb.) ve kullanici mudahale edemiyordu.
 * "Beni su 30 soruda takip et" diyememek iki sey demekti: (1) olculen sey
 * kullanicinin gercekten onemsedigi soru olmayabiliyordu, (2) fan-out gibi
 * soru-bazli analizler yapilamiyordu cunku kalici bir soru kimligi yoktu.
 *
 * Bu servis o kimligi verir: her prompt bir kayit, her olcum o kayda bagli.
 */

export interface PromptRunSummary {
  promptId: string;
  text: string;
  /** Ana soru olcumu */
  main: { cited: number; mentioned: number; total: number; score: number };
  /** Fan-out dallarinin olcumu (dal calistirildiysa) */
  fanout: { cited: number; mentioned: number; total: number; score: number } | null;
  /** Provider bazinda detay */
  providers: Array<{
    provider: string;
    label: string;
    available: boolean;
    reason?: string;
    probes: CitationProbe[];
  }>;
  /** En zayif dallar — aksiyon icin */
  weakestBranches: Array<{ id: string; text: string; kind: string; citedCount: number; total: number }>;
  runAt: string;
}

const MAX_PROMPTS_PER_SITE = 200;

@Injectable()
export class PromptLabService {
  private readonly log = new Logger(PromptLabService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly citation: AiCitationService,
    private readonly fanout: FanoutService,
  ) {}

  // ────────────────────────────────────────────────────────────
  //  CRUD
  // ────────────────────────────────────────────────────────────
  async list(siteId: string, opts: { includeInactive?: boolean } = {}) {
    const prompts = await this.prisma.geoPrompt.findMany({
      where: { siteId, ...(opts.includeInactive ? {} : { isActive: true }) },
      orderBy: [{ createdAt: 'desc' }],
      include: { _count: { select: { fanouts: true } } },
    });
    return prompts.map((p) => ({
      id: p.id,
      text: p.text,
      intent: p.intent,
      locale: p.locale,
      source: p.source,
      tags: p.tags,
      isActive: p.isActive,
      fanoutCount: p._count.fanouts,
      lastRunAt: p.lastRunAt,
      lastCitedCount: p.lastCitedCount,
      lastTotalCount: p.lastTotalCount,
      /** 0..100 — son calistirmanin citation orani */
      lastScore: p.lastTotalCount > 0
        ? Math.round((p.lastCitedCount / p.lastTotalCount) * 100)
        : null,
      createdAt: p.createdAt,
    }));
  }

  async create(siteId: string, input: {
    text: string;
    intent?: string;
    locale?: string;
    tags?: string[];
    source?: string;
  }) {
    const text = (input.text ?? '').trim();
    if (text.length < 5) throw new BadRequestException('Soru en az 5 karakter olmali');
    if (text.length > 500) throw new BadRequestException('Soru 500 karakteri asamaz');

    const count = await this.prisma.geoPrompt.count({ where: { siteId } });
    if (count >= MAX_PROMPTS_PER_SITE) {
      throw new BadRequestException(`Site basina en fazla ${MAX_PROMPTS_PER_SITE} prompt takip edilebilir`);
    }

    // Ayni soru iki kez eklenmesin — normalize edip karsilastir
    const existing = await this.findByNormalizedText(siteId, text);
    if (existing) throw new BadRequestException('Bu soru zaten takip listesinde');

    return this.prisma.geoPrompt.create({
      data: {
        siteId,
        text,
        intent: input.intent ?? 'informational',
        locale: input.locale ?? 'tr',
        tags: input.tags?.length ? input.tags : undefined,
        source: input.source ?? 'manual',
      },
    });
  }

  async update(promptId: string, input: {
    text?: string;
    intent?: string;
    tags?: string[];
    isActive?: boolean;
  }) {
    const data: any = {};
    if (input.text !== undefined) {
      const text = input.text.trim();
      if (text.length < 5) throw new BadRequestException('Soru en az 5 karakter olmali');
      data.text = text;
    }
    if (input.intent !== undefined) data.intent = input.intent;
    if (input.tags !== undefined) data.tags = input.tags;
    if (input.isActive !== undefined) data.isActive = input.isActive;

    return this.prisma.geoPrompt.update({ where: { id: promptId }, data });
  }

  async remove(promptId: string) {
    // fanouts + runs cascade ile gider (schema'da onDelete: Cascade)
    await this.prisma.geoPrompt.delete({ where: { id: promptId } }).catch(() => null);
    return { ok: true };
  }

  /**
   * Brain'deki mevcut AEO/GEO sorgularini takip listesine aktar.
   * Ilk kurulumda bos ekran yerine calisir bir set verir.
   */
  async importFromBrain(siteId: string): Promise<{ imported: number; skipped: number }> {
    const site = await this.prisma.site.findUnique({
      where: { id: siteId },
      include: { brain: true },
    });
    if (!site) return { imported: 0, skipped: 0 };

    const seo: any = site.brain?.seoStrategy ?? {};
    const candidates: string[] = [];
    for (const k of ['aeoQueries', 'geoQueries', 'topQuestions']) {
      if (Array.isArray(seo?.[k])) candidates.push(...seo[k]);
    }

    const clean = Array.from(new Set(
      candidates
        .filter((q): q is string => typeof q === 'string')
        .map((q) => q.trim())
        .filter((q) => q.length >= 5 && q.length <= 500),
    ));

    let imported = 0;
    let skipped = 0;
    for (const text of clean) {
      if (await this.findByNormalizedText(siteId, text)) { skipped++; continue; }
      const total = await this.prisma.geoPrompt.count({ where: { siteId } });
      if (total >= MAX_PROMPTS_PER_SITE) { skipped++; continue; }
      await this.prisma.geoPrompt.create({
        data: { siteId, text, source: 'brain', locale: site.language === 'en' ? 'en' : 'tr' },
      });
      imported++;
    }
    return { imported, skipped };
  }

  // ────────────────────────────────────────────────────────────
  //  CALISTIRMA
  // ────────────────────────────────────────────────────────────
  /**
   * Tek bir prompt'u (istege bagli fan-out dallariyla birlikte) calistir.
   *
   * MALIYET UYARISI: dal sayisi x provider sayisi kadar LLM cagrisi yapilir.
   * withFanout=true iken saglayici sayisi daraltilmazsa 8 dal x 7 provider = 56
   * cagri eder. Bu yuzden fan-out varsayilan olarak 3 saglayiciyla calisir.
   */
  async runPrompt(promptId: string, opts: {
    withFanout?: boolean;
    providers?: Provider[];
    fanoutProviders?: Provider[];
  } = {}): Promise<PromptRunSummary> {
    const prompt = await this.prisma.geoPrompt.findUnique({
      where: { id: promptId },
      include: { fanouts: { where: { isActive: true }, orderBy: { rank: 'asc' } } },
    });
    if (!prompt) throw new BadRequestException('Prompt bulunamadi');

    const today = this.utcToday();

    // ── 1) Ana soru
    const mainResults = await this.citation.runQueries(prompt.siteId, [prompt.text], {
      providers: opts.providers,
    });

    const mainProbeRows: Array<{ provider: string; probe: CitationProbe }> = [];
    for (const r of mainResults) {
      for (const probe of r.probes) mainProbeRows.push({ provider: r.provider, probe });
    }
    await this.persistRuns(prompt.siteId, promptId, null, today, mainProbeRows);

    // ── 2) Fan-out dallari
    let fanoutAgg: PromptRunSummary['fanout'] = null;
    const branchStats = new Map<string, { text: string; kind: string; cited: number; total: number }>();

    if (opts.withFanout && prompt.fanouts.length > 0) {
      // Maliyet freni — dal olcumunde varsayilan 3 saglayici
      const fanoutProviders: Provider[] = opts.fanoutProviders?.length
        ? opts.fanoutProviders
        : ['openai', 'anthropic', 'gemini'];

      for (const branch of prompt.fanouts) {
        const res = await this.citation.runQueries(prompt.siteId, [branch.text], {
          providers: fanoutProviders,
        });
        const rows: Array<{ provider: string; probe: CitationProbe }> = [];
        for (const r of res) {
          for (const probe of r.probes) rows.push({ provider: r.provider, probe });
        }
        await this.persistRuns(prompt.siteId, promptId, branch.id, today, rows);

        const valid = rows.filter((r) => !this.isErrorProbe(r.probe));
        branchStats.set(branch.id, {
          text: branch.text,
          kind: branch.kind,
          cited: valid.filter((r) => r.probe.cited).length,
          total: valid.length,
        });
      }

      let cited = 0, mentioned = 0, total = 0;
      for (const s of branchStats.values()) { cited += s.cited; total += s.total; }
      // mention sayimi ayri gerekiyor — runs tablosundan degil bellekten toplayalim
      mentioned = await this.countMentionedToday(prompt.siteId, promptId, today, true);
      fanoutAgg = { cited, mentioned, total, score: total ? Math.round((cited / total) * 100) : 0 };
    }

    // ── 3) Ozet
    const mainValid = mainProbeRows.filter((r) => !this.isErrorProbe(r.probe));
    const mainCited = mainValid.filter((r) => r.probe.cited).length;
    const mainMentioned = mainValid.filter((r) => r.probe.brandMentioned).length;
    const main = {
      cited: mainCited,
      mentioned: mainMentioned,
      total: mainValid.length,
      score: mainValid.length ? Math.round((mainCited / mainValid.length) * 100) : 0,
    };

    await this.prisma.geoPrompt.update({
      where: { id: promptId },
      data: {
        lastRunAt: new Date(),
        lastCitedCount: main.cited,
        lastTotalCount: main.total,
      },
    });

    const weakestBranches = Array.from(branchStats.entries())
      .map(([id, s]) => ({ id, text: s.text, kind: s.kind, citedCount: s.cited, total: s.total }))
      .sort((a, b) => {
        const ra = a.total ? a.citedCount / a.total : 0;
        const rb = b.total ? b.citedCount / b.total : 0;
        return ra - rb;
      })
      .slice(0, 5);

    return {
      promptId,
      text: prompt.text,
      main,
      fanout: fanoutAgg,
      providers: mainResults.map((r) => ({
        provider: r.provider,
        label: r.label,
        available: r.available,
        reason: r.reason,
        probes: r.probes,
      })),
      weakestBranches,
      runAt: new Date().toISOString(),
    };
  }

  /**
   * Sitenin tum aktif promptlarini sirayla calistirir.
   * Paralel calistirmiyoruz — saglayici rate limitleri ve gunluk butce
   * guard'i (ai-citation.service) sirali akista daha ongorulebilir davraniyor.
   */
  async runAll(siteId: string, opts: { withFanout?: boolean; limit?: number } = {}) {
    const limit = Math.min(Math.max(opts.limit ?? 25, 1), MAX_PROMPTS_PER_SITE);
    const prompts = await this.prisma.geoPrompt.findMany({
      where: { siteId, isActive: true },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { id: true },
    });

    const summaries: PromptRunSummary[] = [];
    for (const p of prompts) {
      try {
        summaries.push(await this.runPrompt(p.id, { withFanout: opts.withFanout }));
      } catch (err: any) {
        this.log.warn(`Prompt calistirilamadi (${p.id}): ${err.message}`);
      }
    }
    return {
      siteId,
      ran: summaries.length,
      requested: prompts.length,
      summaries,
      runAt: new Date().toISOString(),
    };
  }

  // ────────────────────────────────────────────────────────────
  //  KAPSAMA RAPORU — "hangi dalda kaybediyoruz"
  // ────────────────────────────────────────────────────────────
  /**
   * Ana soru ile fan-out dallari arasindaki citation farkini gosterir.
   * Asil urun degeri burasi: "ana soruda %60 gorunuyorsun ama
   * 'guvenilir mi' dallarinda %0'sin" gibi bir tespit.
   */
  async coverage(siteId: string, days = 30) {
    const since = new Date(Date.now() - days * 86400_000);

    const runs = await this.prisma.geoPromptRun.findMany({
      where: { siteId, date: { gte: this.utcDateOnly(since) } },
      select: {
        promptId: true, fanoutId: true, provider: true,
        cited: true, brandMentioned: true, excerpt: true,
      },
    });

    const fanouts = await this.prisma.geoFanoutQuery.findMany({
      where: { siteId },
      select: { id: true, text: true, kind: true, promptId: true },
    });
    const fanoutById = new Map(fanouts.map((f) => [f.id, f]));

    const valid = runs.filter((r) => !r.excerpt?.startsWith('HATA:'));
    const mainRuns = valid.filter((r) => !r.fanoutId);
    const branchRuns = valid.filter((r) => r.fanoutId);

    // Dal tipine gore kirilim — en zayif tip aksiyonu yonlendirir
    const byKind = new Map<string, { cited: number; mentioned: number; total: number }>();
    for (const r of branchRuns) {
      const kind = fanoutById.get(r.fanoutId!)?.kind ?? 'unknown';
      const cur = byKind.get(kind) ?? { cited: 0, mentioned: 0, total: 0 };
      cur.total++;
      if (r.cited) cur.cited++;
      if (r.brandMentioned) cur.mentioned++;
      byKind.set(kind, cur);
    }

    const pct = (c: number, t: number) => (t ? Math.round((c / t) * 100) : 0);

    return {
      siteId,
      days,
      main: {
        cited: mainRuns.filter((r) => r.cited).length,
        mentioned: mainRuns.filter((r) => r.brandMentioned).length,
        total: mainRuns.length,
        score: pct(mainRuns.filter((r) => r.cited).length, mainRuns.length),
      },
      fanout: {
        cited: branchRuns.filter((r) => r.cited).length,
        mentioned: branchRuns.filter((r) => r.brandMentioned).length,
        total: branchRuns.length,
        score: pct(branchRuns.filter((r) => r.cited).length, branchRuns.length),
      },
      byKind: Array.from(byKind.entries())
        .map(([kind, s]) => ({ kind, ...s, score: pct(s.cited, s.total) }))
        .sort((a, b) => a.score - b.score),
      /** Ana soruda gorunup dallarda kaybedilen fark — negatifse dal tarafi zayif */
      gap: pct(branchRuns.filter((r) => r.cited).length, branchRuns.length)
         - pct(mainRuns.filter((r) => r.cited).length, mainRuns.length),
    };
  }

  /** Tek prompt'un zaman icindeki citation trendi */
  async history(promptId: string, days = 30) {
    const since = this.utcDateOnly(new Date(Date.now() - days * 86400_000));
    const runs = await this.prisma.geoPromptRun.findMany({
      where: { promptId, date: { gte: since } },
      orderBy: { date: 'asc' },
      select: { date: true, provider: true, cited: true, brandMentioned: true, fanoutId: true, excerpt: true },
    });

    const byDate = new Map<string, { cited: number; mentioned: number; total: number }>();
    for (const r of runs) {
      if (r.excerpt?.startsWith('HATA:')) continue;
      const key = r.date.toISOString().slice(0, 10);
      const cur = byDate.get(key) ?? { cited: 0, mentioned: 0, total: 0 };
      cur.total++;
      if (r.cited) cur.cited++;
      if (r.brandMentioned) cur.mentioned++;
      byDate.set(key, cur);
    }

    return Array.from(byDate.entries())
      .map(([date, s]) => ({
        date,
        ...s,
        score: s.total ? Math.round((s.cited / s.total) * 100) : 0,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  // ────────────────────────────────────────────────────────────
  //  YARDIMCILAR
  // ────────────────────────────────────────────────────────────
  private async persistRuns(
    siteId: string,
    promptId: string,
    fanoutId: string | null,
    date: Date,
    rows: Array<{ provider: string; probe: CitationProbe }>,
  ) {
    if (rows.length === 0) return;
    await this.prisma.geoPromptRun.createMany({
      data: rows.map(({ provider, probe }) => ({
        siteId,
        promptId,
        fanoutId,
        provider,
        date,
        cited: !!probe.cited,
        brandMentioned: !!probe.brandMentioned,
        position: probe.position ?? null,
        sentiment: probe.sentiment ?? null,
        excerpt: probe.excerpt?.slice(0, 2000) ?? null,
        citedPages: probe.citedPages?.length ? probe.citedPages : undefined,
        competitors: probe.competitors?.length ? (probe.competitors as any) : undefined,
      })),
    }).catch((err) => {
      this.log.warn(`GeoPromptRun yazilamadi (${promptId}): ${err.message}`);
    });
  }

  private async countMentionedToday(siteId: string, promptId: string, date: Date, fanoutOnly: boolean) {
    return this.prisma.geoPromptRun.count({
      where: {
        siteId, promptId, date,
        brandMentioned: true,
        ...(fanoutOnly ? { fanoutId: { not: null } } : { fanoutId: null }),
      },
    }).catch(() => 0);
  }

  /** Probe hata dondurduyse istatistige katma — yoksa skor yanlis duser */
  private isErrorProbe(probe: CitationProbe): boolean {
    return !!probe.excerpt?.startsWith('HATA:');
  }

  private async findByNormalizedText(siteId: string, text: string) {
    const norm = this.normalize(text);
    const all = await this.prisma.geoPrompt.findMany({
      where: { siteId },
      select: { id: true, text: true },
    });
    return all.find((p) => this.normalize(p.text) === norm) ?? null;
  }

  private normalize(s: string): string {
    return s.toLocaleLowerCase('tr').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  }

  /** UTC gun basi — server timezone'a bagli kalmamak icin (TR'de local midnight bir onceki UTC gunune kayar) */
  private utcToday(): Date {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }

  private utcDateOnly(d: Date): Date {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
}
