import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { AiCitationService, type Provider } from './ai-citation.service.js';
import { LLMProviderService } from '../llm/llm-provider.service.js';
import { safeParseJson } from '../common/safe-json.js';
import { acquireCronLock } from '../common/cron-lock.js';

/**
 * Product Radar — AI asistanlar kullanicinin KATEGORISINDE hangi urunleri
 * oneriyor? (Maya Product Radar karsiligi.)
 *
 * "best X tools" tarzi kategori sorgularini gercek saglayicilara sorar,
 * cevaptaki oneri listesini cikarir ve markanin listede olup olmadigini,
 * kacinci sirada oldugunu kaydeder. Rakip kesif + kayip tespiti tek ekranda.
 */

const RADAR_PROVIDERS: Provider[] = ['openai', 'anthropic', 'gemini', 'perplexity'];
const MAX_QUERIES = 3;

@Injectable()
export class ProductRadarService {
  private readonly log = new Logger(ProductRadarService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly citation: AiCitationService,
    private readonly llm: LLMProviderService,
  ) {}

  // ────────────────────────────────────────────────────────────

  async run(siteId: string): Promise<{ snapshots: number; queries: string[] }> {
    const site = await this.prisma.site.findUniqueOrThrow({
      where: { id: siteId },
      include: { brain: true },
    });

    const queries = this.buildQueries(site);
    if (queries.length === 0) {
      throw new BadRequestException('Kategori sorgusu uretilemedi — site nis bilgisi (niche) eksik');
    }

    const category = site.niche ?? 'genel';
    const brand = site.name;
    const today = this.utcToday();
    let saved = 0;

    for (const query of queries) {
      const results = await this.citation.runQueries(siteId, [query], { providers: RADAR_PROVIDERS });

      for (const r of results) {
        if (!r.available || r.probes.length === 0) continue;
        const probe = r.probes[0];
        if (probe.excerpt?.startsWith('HATA:')) continue;

        const products = await this.extractProducts(siteId, probe.excerpt ?? '', brand);
        const brandEntry = products.find((p) => p.isBrand);

        // Ayni gun + provider + query tekrarinda yeni satir atma, guncelle.
        // TAM siteId ile aranir — kirpik id turetmek capraz-tenant carpismasi
        // riskiydi (cuid'in ilk 8 karakteri timestamp onekidir, benzersiz degil).
        const dupe = await this.prisma.productRadarSnapshot.findFirst({
          where: { siteId, date: today, provider: r.provider, query },
          select: { id: true },
        });
        const payload = {
          products: products as any,
          brandListed: !!brandEntry || probe.brandMentioned,
          brandRank: brandEntry?.rank ?? null,
        };
        if (dupe) {
          await this.prisma.productRadarSnapshot.update({ where: { id: dupe.id }, data: payload });
        } else {
          await this.prisma.productRadarSnapshot.create({
            data: { siteId, date: today, provider: r.provider, category, query, ...payload },
          });
        }
        saved++;
      }
    }

    return { snapshots: saved, queries };
  }

  /** Son taramanin ozeti: urun frekans tablosu + marka durumu */
  async latest(siteId: string) {
    const last = await this.prisma.productRadarSnapshot.findFirst({
      where: { siteId },
      orderBy: { date: 'desc' },
      select: { date: true },
    });
    if (!last) return { date: null, snapshots: [], leaderboard: [], brand: null };

    const snapshots = await this.prisma.productRadarSnapshot.findMany({
      where: { siteId, date: last.date },
      orderBy: [{ provider: 'asc' }],
    });

    // Leaderboard: urun → kac saglayici/sorguda onerildi, ortalama sira
    const tally = new Map<string, { name: string; count: number; rankSum: number; ranked: number; isBrand: boolean; providers: Set<string> }>();
    for (const s of snapshots) {
      const products: any[] = Array.isArray(s.products) ? (s.products as any[]) : [];
      for (const p of products) {
        const key = String(p.name ?? '').toLowerCase().trim();
        if (!key) continue;
        const cur = tally.get(key) ?? { name: p.name, count: 0, rankSum: 0, ranked: 0, isBrand: !!p.isBrand, providers: new Set<string>() };
        cur.count++;
        cur.providers.add(s.provider);
        if (typeof p.rank === 'number') { cur.rankSum += p.rank; cur.ranked++; }
        if (p.isBrand) cur.isBrand = true;
        tally.set(key, cur);
      }
    }
    const leaderboard = Array.from(tally.values())
      .map((t) => ({
        name: t.name,
        appearances: t.count,
        providers: Array.from(t.providers),
        avgRank: t.ranked > 0 ? Math.round((t.rankSum / t.ranked) * 10) / 10 : null,
        isBrand: t.isBrand,
      }))
      .sort((a, b) => b.appearances - a.appearances || (a.avgRank ?? 99) - (b.avgRank ?? 99))
      .slice(0, 25);

    const brandRow = leaderboard.find((l) => l.isBrand) ?? null;

    return {
      date: last.date.toISOString().slice(0, 10),
      snapshots: snapshots.map((s) => ({
        provider: s.provider,
        query: s.query,
        products: s.products,
        brandListed: s.brandListed,
        brandRank: s.brandRank,
      })),
      leaderboard,
      brand: brandRow,
    };
  }

  /** Haftalik otomatik tarama — Sali 05:30 UTC (citation cron'lariyla cakismasin) */
  @Cron('30 5 * * 2')
  async weeklyRunAll() {
    // API + worker ayni cron'u tetikler — atomik kilit tek proses calistirir
    // (LLM cagrili en pahali cron'lardan; cift calisma cift maliyet olurdu)
    if (!(await acquireCronLock(this.prisma, 'product-radar', 'weekly'))) return;
    const sites = await this.prisma.site.findMany({
      where: { status: 'ACTIVE' as any, niche: { not: null } },
      select: { id: true },
      take: 100,
    });
    this.log.log(`Haftalik Product Radar: ${sites.length} site`);
    for (const s of sites) {
      try {
        await this.run(s.id);
      } catch (err: any) {
        this.log.warn(`Product radar fail (${s.id}): ${err.message}`);
      }
    }
  }

  // ────────────────────────────────────────────────────────────

  private buildQueries(site: any): string[] {
    const niche = (site.niche ?? '').trim();
    if (!niche) return [];
    const tr = site.language !== 'en';
    const queries = tr
      ? [
          `en iyi ${niche} araçları hangileri?`,
          `${niche} için hangi ürünü/servisi önerirsin?`,
          `${niche} alanında en popüler çözümler`,
        ]
      : [
          `what are the best ${niche} tools?`,
          `which ${niche} product would you recommend?`,
          `most popular ${niche} solutions`,
        ];
    return queries.slice(0, MAX_QUERIES);
  }

  /** AI cevabindan oneri listesi cikar — ucuz LLM parse, hatada bos liste */
  private async extractProducts(siteId: string, excerpt: string, brand: string): Promise<Array<{
    name: string;
    rank: number;
    isBrand: boolean;
  }>> {
    if (!excerpt || excerpt.length < 40) return [];
    try {
      const res = await this.llm.chat({
        context: 'product-radar-extract',
        siteId,
        model: 'claude-haiku-4-5',
        maxTokens: 800,
        systemPrompt: [
          'Sana bir AI asistan cevabi verilecek. Cevapta ONERILEN urun/servis/marka adlarini sirasiyla cikar.',
          'YANIT: yalnizca JSON dizi: [{"name":"Urun Adi","rank":1}] — rank cevaptaki gecis sirasi (1 = ilk).',
          'En fazla 15 madde. Urun degil kavram olanlari (ör. "SEO", "içerik pazarlama") ALMA.',
        ].join('\n'),
        messages: [{ role: 'user', content: excerpt.slice(0, 8000) }],
      });
      const raw = res.output.trim().replace(/^```json?\s*|\s*```$/g, '');
      const parsed = safeParseJson<any>(raw);
      if (!Array.isArray(parsed)) return [];
      const brandNorm = brand.toLowerCase();
      return parsed
        .filter((p) => p && typeof p.name === 'string' && p.name.trim())
        .slice(0, 15)
        .map((p, i) => ({
          name: p.name.trim().slice(0, 120),
          rank: typeof p.rank === 'number' ? p.rank : i + 1,
          isBrand: p.name.toLowerCase().includes(brandNorm) || brandNorm.includes(p.name.toLowerCase().trim()),
        }));
    } catch (err: any) {
      this.log.warn(`Product extract fail: ${err.message}`);
      return [];
    }
  }

  private utcToday(): Date {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }
}
