import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';

export interface HeatmapCell {
  query: string;
  provider: string;
  status: 'cited' | 'mentioned' | 'competitor' | 'none';
  competitor?: string; // hangi rakip alıntılandı
  excerpt: string;
}

export interface HeatmapResult {
  generatedAt: string;
  brand: string;
  brandHost: string;
  competitors: string[];
  providers: string[];
  queries: string[];
  cells: HeatmapCell[];
  // Aggregations
  scoreByProvider: Record<string, number>;       // 0-100
  scoreByQuery: Record<string, number>;
  competitorWins: Record<string, number>;        // rakip adi → kac kez alıntılandı
  // Strategic insights
  fırsatQueries: string[];                       // hiç kimse alıntılanmıyor — boşluk
  zayifQueries: string[];                        // rakip alıntılanıyor, biz değiliz
  guzelQueries: string[];                        // biz alıntılanıyoruz
}

/**
 * GEO Heatmap — sektor sorularini 4 AI saglayicisinda test edip
 * marka × rakip alintilanma matrisini cikarir.
 *
 * Sonuc grid'inde:
 *   YESIL (cited) = Site URL alintilandi
 *   SARI  (mentioned) = Sadece marka adi gecti
 *   KIRMIZI (competitor) = Rakip site URL alintilandi
 *   GRI (none) = Kimse alintilamadi (firsat)
 */
@Injectable()
export class GeoHeatmapService {
  private readonly log = new Logger(GeoHeatmapService.name);
  private readonly anthropic = process.env.ANTHROPIC_API_KEY
    ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    : null;
  private readonly geminiKey = process.env.GOOGLE_AI_API_KEY ?? process.env.GEMINI_API_KEY ?? null;
  private readonly gemini = this.geminiKey ? new GoogleGenAI({ apiKey: this.geminiKey }) : null;
  private readonly openaiKey = process.env.OPENAI_API_KEY ?? null;
  private readonly perplexityKey = process.env.PERPLEXITY_API_KEY ?? null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async runForSite(siteId: string, opts: { maxQueries?: number } = {}): Promise<HeatmapResult> {
    await this.settings.assertAiEnabled('GEO heatmap');
    const max = opts.maxQueries ?? 10;
    const site = await this.prisma.site.findUniqueOrThrow({
      where: { id: siteId },
      include: { brain: true },
    });

    const brand = site.name;
    const url = site.url;
    const brandHost = this.extractHost(url);

    // Brain'den sorgular
    const seo: any = site.brain?.seoStrategy ?? {};
    const queries: string[] = [];
    if (Array.isArray(seo?.aeoQueries)) queries.push(...seo.aeoQueries);
    if (Array.isArray(seo?.geoQueries)) queries.push(...seo.geoQueries);
    if (Array.isArray(seo?.topQuestions)) queries.push(...seo.topQuestions);
    if (queries.length === 0 && site.niche) {
      queries.push(
        `${site.niche} alaninda en iyi siteler hangileri?`,
        `${site.niche} icin Turkiye'deki en kapsamli kaynaklar nelerdir?`,
        `${site.niche} konusunda hangi sirketler one cikiyor?`,
      );
    }
    const probeQueries = [...new Set(queries)].slice(0, max);

    // Brain'deki rakip listesi
    const competitorsRaw: any[] = Array.isArray(site.brain?.competitors)
      ? (site.brain!.competitors as any[])
      : [];
    const competitors = competitorsRaw
      .map((c) => ({
        name: String(c.name ?? '').toLowerCase().trim(),
        host: this.extractHost(String(c.url ?? '')),
      }))
      .filter((c) => c.host && c.host !== brandHost);

    // Tum cell'leri paralel topla
    const providers = [
      { id: 'anthropic', label: 'Claude', enabled: !!this.anthropic },
      { id: 'gemini', label: 'Gemini', enabled: !!this.gemini },
      { id: 'openai', label: 'ChatGPT', enabled: !!this.openaiKey },
      { id: 'perplexity', label: 'Perplexity', enabled: !!this.perplexityKey },
    ];

    const cells: HeatmapCell[] = [];
    for (const q of probeQueries) {
      const tasks = providers.map(async (p) => {
        if (!p.enabled) {
          return { query: q, provider: p.id, status: 'none' as const, excerpt: '(saglayici aktif degil)' };
        }
        try {
          const text = await this.askProvider(p.id, q);
          const lower = text.toLowerCase();
          // Once site URL alintilandi mi?
          if (lower.includes(brandHost)) {
            return { query: q, provider: p.id, status: 'cited' as const, excerpt: text.slice(0, 200) };
          }
          // Sonra rakip URL'i?
          for (const c of competitors) {
            if (lower.includes(c.host)) {
              return { query: q, provider: p.id, status: 'competitor' as const, competitor: c.host, excerpt: text.slice(0, 200) };
            }
          }
          // Marka adi gecti mi?
          if (lower.includes(brand.toLowerCase())) {
            return { query: q, provider: p.id, status: 'mentioned' as const, excerpt: text.slice(0, 200) };
          }
          return { query: q, provider: p.id, status: 'none' as const, excerpt: text.slice(0, 200) };
        } catch (err: any) {
          this.log.warn(`Heatmap probe fail (${p.id}/${q}): ${err.message}`);
          return { query: q, provider: p.id, status: 'none' as const, excerpt: `HATA: ${err.message}` };
        }
      });
      const queryCells = await Promise.all(tasks);
      cells.push(...queryCells);
    }

    // Skor hesaplari
    const scoreByProvider: Record<string, number> = {};
    const scoreByQuery: Record<string, number> = {};
    const competitorWins: Record<string, number> = {};

    for (const p of providers) {
      const pCells = cells.filter((c) => c.provider === p.id);
      const cited = pCells.filter((c) => c.status === 'cited').length;
      const mentioned = pCells.filter((c) => c.status === 'mentioned').length;
      const total = pCells.length;
      scoreByProvider[p.id] = total > 0 ? Math.round(((cited * 100 + mentioned * 50) / total)) : 0;
    }
    for (const q of probeQueries) {
      const qCells = cells.filter((c) => c.query === q);
      const cited = qCells.filter((c) => c.status === 'cited').length;
      const mentioned = qCells.filter((c) => c.status === 'mentioned').length;
      const total = qCells.length;
      scoreByQuery[q] = total > 0 ? Math.round(((cited * 100 + mentioned * 50) / total)) : 0;
    }
    for (const c of cells) {
      if (c.status === 'competitor' && c.competitor) {
        competitorWins[c.competitor] = (competitorWins[c.competitor] ?? 0) + 1;
      }
    }

    // Insight kategorileri
    const fırsatQueries: string[] = [];
    const zayifQueries: string[] = [];
    const guzelQueries: string[] = [];
    for (const q of probeQueries) {
      const qCells = cells.filter((c) => c.query === q);
      const cited = qCells.some((c) => c.status === 'cited');
      const competitor = qCells.some((c) => c.status === 'competitor');
      if (cited) {
        guzelQueries.push(q);
      } else if (competitor) {
        zayifQueries.push(q);
      } else {
        fırsatQueries.push(q);
      }
    }

    return {
      generatedAt: new Date().toISOString(),
      brand,
      brandHost,
      competitors: competitors.map((c) => c.host),
      providers: providers.map((p) => p.label),
      queries: probeQueries,
      cells,
      scoreByProvider,
      scoreByQuery,
      competitorWins,
      fırsatQueries,
      zayifQueries,
      guzelQueries,
    };
  }

  // ────────────────────────────────────────────────────────────
  //  Provider abstraction
  // ────────────────────────────────────────────────────────────
  private async askProvider(provider: string, query: string): Promise<string> {
    const system = 'Kullanicinin sorusuna kisa ve dogrudan cevap ver. Tanidigin Turkiye kaynaklarini, web sitelerini ve markalari ismiyle ve URL siyle birlikte belirt.';

    if (provider === 'anthropic' && this.anthropic) {
      const resp = await this.anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 350,
        system,
        messages: [{ role: 'user', content: query }],
      });
      return resp.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join(' ');
    }
    if (provider === 'gemini' && this.gemini) {
      const resp = await this.gemini.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `${system}\n\nSoru: ${query}`,
        config: { maxOutputTokens: 350 } as any,
      });
      return resp.text ?? '';
    }
    if (provider === 'openai' && this.openaiKey) {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${this.openaiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o-mini', max_tokens: 350,
          messages: [{ role: 'system', content: system }, { role: 'user', content: query }],
        }),
      });
      if (!res.ok) throw new Error(`OpenAI ${res.status}`);
      const data = await res.json() as any;
      return data?.choices?.[0]?.message?.content ?? '';
    }
    if (provider === 'perplexity' && this.perplexityKey) {
      const res = await fetch('https://api.perplexity.ai/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${this.perplexityKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'sonar', max_tokens: 350,
          messages: [{ role: 'system', content: system }, { role: 'user', content: query }],
        }),
      });
      if (!res.ok) throw new Error(`Perplexity ${res.status}`);
      const data = await res.json() as any;
      return data?.choices?.[0]?.message?.content ?? '';
    }
    return '';
  }

  private extractHost(url: string): string {
    try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); }
    catch { return url.toLowerCase(); }
  }
}
