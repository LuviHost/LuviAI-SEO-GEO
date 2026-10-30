import { Injectable, Logger } from '@nestjs/common';
import { brandMatcher, resolveSiteBrand, type BrandMatcher } from './brand-in-query.js';
import { hostMentioned } from './host-match.js';
import { probeErrorExcerpt, safeErrorText } from './probe-retry.js';
import { foldForMatch } from '../common/text-normalize.js';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { noteMeasured } from '../billing/measurement-allowance.js';
import { GEO_HEATMAP_MAX_QUERIES, clampLimit } from './audit-limits.js';
import { AiCitationService, type Provider } from './ai-citation.service.js';

/**
 * Hucre durumu. 'error' (saglayici hatasi / bos cevap) ve 'disabled'
 * (saglayici bu sunucuda etkin degil) OLCUM DEGILDIR: skor paydasina ve
 * firsat/zayif/guzel siniflarina girmez. Eskiden ikisi de 'none' yaziliyordu;
 * hata alan saglayici 0 puan, hata alan soru "fırsat (kimse yok)" gorunuyordu.
 */
export type HeatmapStatus = 'cited' | 'mentioned' | 'competitor' | 'none' | 'error' | 'disabled';

export interface HeatmapCell {
  query: string;
  provider: string;
  status: HeatmapStatus;
  competitor?: string; // hangi rakip alıntılandı
  excerpt: string;
}

export interface HeatmapResult {
  generatedAt: string;
  brand: string;
  brandHost: string;
  competitors: string[];
  /** Gorunen adlar (Claude, Gemini...) — providerIds ile ayni sirada */
  providers: string[];
  /** Saglayici kimlikleri (anthropic, gemini...) — scoreByProvider anahtarlari */
  providerIds: string[];
  queries: string[];
  cells: HeatmapCell[];
  // Aggregations — yalniz OLCULEN hucrelerden; hic olculen hucre yoksa null
  scoreByProvider: Record<string, number | null>; // 0-100
  scoreByQuery: Record<string, number | null>;
  competitorWins: Record<string, number>;        // rakip adi → kac kez alıntılandı
  // Strategic insights (yalniz en az bir hucresi olculen sorgular)
  fırsatQueries: string[];                       // hiç kimse alıntılanmıyor — boşluk
  zayifQueries: string[];                        // rakip alıntılanıyor, biz değiliz
  guzelQueries: string[];                        // biz alıntılanıyoruz
  /** Hicbir saglayicida olculemeyen sorgular — hicbir sinifa girmez */
  olculemeyenQueries: string[];
}

/** Hucre bir olcum mu — hata ve etkin olmayan saglayici olcum degildir */
export function isMeasuredCell(c: Pick<HeatmapCell, 'status'>): boolean {
  return c.status !== 'error' && c.status !== 'disabled';
}

/** Ana olcumle (citation-score.ts) ayni puan: alinti 100, yalniz anilma 50; olculen hucre yoksa null */
function cellScore(cells: HeatmapCell[]): number | null {
  const measured = cells.filter(isMeasuredCell);
  if (measured.length === 0) return null;
  const cited = measured.filter((c) => c.status === 'cited').length;
  const mentioned = measured.filter((c) => c.status === 'mentioned').length;
  return Math.round((cited * 100 + mentioned * 50) / measured.length);
}

/**
 * Izgara ozetleri (saf). Skorlar ve siniflar yalniz OLCULEN hucrelerden:
 * bir saglayicinin tum hucreleri hataliysa skoru null ("olculemedi"), bir
 * sorgunun tum hucreleri hataliysa sorgu olculemeyenler listesine gider —
 * "fırsat (kimse yok)" diye gosterilmez.
 */
export function summarizeHeatmap(
  cells: HeatmapCell[],
  providerIds: string[],
  queries: string[],
): Pick<HeatmapResult, 'scoreByProvider' | 'scoreByQuery' | 'competitorWins' | 'fırsatQueries' | 'zayifQueries' | 'guzelQueries' | 'olculemeyenQueries'> {
  const scoreByProvider: Record<string, number | null> = {};
  const scoreByQuery: Record<string, number | null> = {};
  const competitorWins: Record<string, number> = {};
  for (const id of providerIds) scoreByProvider[id] = cellScore(cells.filter((c) => c.provider === id));
  for (const q of queries) scoreByQuery[q] = cellScore(cells.filter((c) => c.query === q));
  for (const c of cells) {
    if (c.status === 'competitor' && c.competitor) {
      competitorWins[c.competitor] = (competitorWins[c.competitor] ?? 0) + 1;
    }
  }

  const fırsatQueries: string[] = [];
  const zayifQueries: string[] = [];
  const guzelQueries: string[] = [];
  const olculemeyenQueries: string[] = [];
  for (const q of queries) {
    const measured = cells.filter((c) => c.query === q && isMeasuredCell(c));
    if (measured.length === 0) olculemeyenQueries.push(q);
    else if (measured.some((c) => c.status === 'cited')) guzelQueries.push(q);
    else if (measured.some((c) => c.status === 'competitor')) zayifQueries.push(q);
    else fırsatQueries.push(q);
  }
  return { scoreByProvider, scoreByQuery, competitorWins, fırsatQueries, zayifQueries, guzelQueries, olculemeyenQueries };
}

/**
 * Tek cevabin hucre durumu — ana olcumle (ai-citation buildProbe) AYNI
 * eslesme kurallari. Eskiden ham includes() vardi: "notsite.com" alinti,
 * "Hepsiemlak" icindeki "emlak" anilma sayiliyordu.
 *   1) site alan adi etiket sinirli gectiyse  → cited
 *   2) rakip alan adi gectiyse                 → competitor
 *   3) marka (kelime sinirli, jenerik korumali) → mentioned
 */
export function classifyHeatmapText(
  text: string,
  brandHost: string,
  competitorHosts: string[],
  matcher: BrandMatcher,
): { status: 'cited' | 'mentioned' | 'competitor' | 'none'; competitor?: string } {
  const folded = foldForMatch(text || '');
  if (hostMentioned(folded, brandHost)) return { status: 'cited' };
  for (const host of competitorHosts) {
    if (hostMentioned(folded, host)) return { status: 'competitor', competitor: host };
  }
  if (matcher.indexInFolded(folded) !== null) return { status: 'mentioned' };
  return { status: 'none' };
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
 *   error / disabled = olculemedi — skora ve siniflara girmez
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
    private readonly citation: AiCitationService,
  ) {}

  async runForSite(siteId: string, opts: { maxQueries?: number } = {}): Promise<HeatmapResult> {
    await this.settings.assertAiEnabled('GEO heatmap');
    // Sorgu basina 4 saglayici cagrisi. Tavan yalniz controller'da ve DTO'daydi;
    // servisi dogrudan cagiran yollar (MCP, worker) sinirsiz sorgu gecebilirdi.
    const max = clampLimit(opts.maxQueries, GEO_HEATMAP_MAX_QUERIES, 10);
    const site = await this.prisma.site.findUniqueOrThrow({
      where: { id: siteId },
      include: { brain: true },
    });

    // Ham site.name DEGIL — kisa/uzun pazarlama adlarinda hostname'e dusen
    // ayni cozumleme her damga noktasinda kullanilmali; yoksa heatmap ile
    // KPI seridi ayni site icin farkli sorulari "markali" sayar.
    const brand = resolveSiteBrand(site.name, site.url);
    const url = site.url;
    const brandHost = this.extractHost(url);
    // Olcumle AYNI marka karari (jenerik + alan adindan turetilmis markada yalniz alan adi sayilir)
    const matcher = brandMatcher(brand, brandHost);

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
    // Markali sorgular izgaraya HIC girmez: heatmap "gorunurluk" iddiasinda
    // ve markali soruda sari/yesil hucre neredeyse garanti — hem skorlari
    // sisiriyor hem firsat/zayif/guzel siniflamasini bozuyordu. Kaynaginda
    // suzmek ayrica markali hucre olcum maliyetini de sifirlar.
    let unbrandedQueries = [...new Set(queries)].filter((q) => !matcher.inText(q));
    if (unbrandedQueries.length === 0 && site.niche) {
      // Brain'in tum sorgulari markaliysa izgarayi bos birakma — bos grid
      // "her motorda gorunmezsin" gibi cizilir. Nis sablonlari markasizdir
      // ve brain'i bos sitelerdeki mevcut fallback ile ayni felsefe.
      unbrandedQueries = [
        `${site.niche} alaninda en iyi siteler hangileri?`,
        `${site.niche} icin Turkiye'deki en kapsamli kaynaklar nelerdir?`,
        `${site.niche} konusunda hangi sirketler one cikiyor?`,
      ];
    }
    const probeQueries = unbrandedQueries.slice(0, max);

    // AYLIK HAK — olcum ONCESI. Eskiden heatmap ne aylik calistirma tavanina
    // ne gunluk havuz butcesine tabiydi: tek istek 20 soru x 4 saglayici
    // RanksUp anahtariyla kosuyordu. Sayim fiyat kartindaki kural: soru basina
    // 1 calistirma. Yetmiyorsa hicbir saglayici cagrilmadan 403 (kismi izgara
    // yok — eksik izgara firsat/zayif siniflarini yaniltir).
    await this.citation.assertCitationRuns(site.userId, probeQueries.length, 'GEO ısı haritası');

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

    // GUNLUK HAVUZ BUTCESI — ana olcumle (runProvider) ayni kapi ve ayni
    // defter: saglayici basina tum sorular icin onceden bakilir; asilmissa o
    // saglayici bu izgarada olculmez (hucre 'error', skora girmez). Maliyet
    // tavani ai-citation'in probe tablosundan (COST_PER_PROBE_USD) gelir;
    // heatmap cagrisi web aramasiz oldugundan gercek maliyet bunun altinda
    // kalir — kapi temkinli tarafta hata yapar.
    const overBudget = new Set<string>();
    for (const p of providers) {
      if (p.enabled && probeQueries.length > 0
        && await this.citation.poolBudgetExceeded(p.id as Provider, probeQueries.length, site.userId)) {
        overBudget.add(p.id);
      }
    }

    const cells: HeatmapCell[] = [];
    for (const q of probeQueries) {
      const tasks = providers.map(async (p): Promise<HeatmapCell> => {
        if (!p.enabled) {
          return { query: q, provider: p.id, status: 'disabled', excerpt: 'Sağlayıcı bu sunucuda etkin değil — ölçülmedi.' };
        }
        if (overBudget.has(p.id)) {
          return { query: q, provider: p.id, status: 'error', excerpt: this.citation.poolBudgetReason(p.id as Provider) };
        }
        try {
          const text = await this.askProvider(p.id, q);
          // Bos cevap olcum degildir (ana olcumle ayni kural): "kimse
          // alintilanmadi" sayilsaydi skoru dusurur, soruyu firsat gosterirdi.
          if (!text.trim()) {
            return { query: q, provider: p.id, status: 'error', excerpt: 'HATA: bos cevap' };
          }
          noteMeasured(); // haftalik olcum hakki (rota oturumu icinde sayilir)
          const verdict = classifyHeatmapText(text, brandHost, competitors.map((c) => c.host), matcher);
          return { query: q, provider: p.id, ...verdict, excerpt: text.slice(0, 200) };
        } catch (err: any) {
          this.log.warn(`Heatmap probe fail (${p.id}/${q}): ${safeErrorText(err)}`);
          // Saglayici govdesi musteriye gitmez — yalniz kod (probe-retry.ts)
          return { query: q, provider: p.id, status: 'error', excerpt: probeErrorExcerpt(err) };
        }
      });
      const queryCells = await Promise.all(tasks);
      cells.push(...queryCells);
    }

    // Maliyet ve hak yalniz OLCULEN hucre/soru icin (runProvider measuredOnly
    // ve hasRealProbes ile ayni): hata veren cagri hak yemez.
    for (const p of providers) {
      const measured = cells.filter((c) => c.provider === p.id && isMeasuredCell(c)).length;
      if (measured > 0) await this.citation.recordPoolCost(p.id as Provider, measured, site.userId).catch(() => 0);
    }
    const measuredQueries = probeQueries.filter((q) => cells.some((c) => c.query === q && isMeasuredCell(c))).length;
    await this.citation.consumeCitationRuns(site.userId, measuredQueries);

    const providerIds = providers.map((p) => p.id);
    return {
      generatedAt: new Date().toISOString(),
      brand,
      brandHost,
      competitors: competitors.map((c) => c.host),
      providers: providers.map((p) => p.label),
      providerIds,
      queries: probeQueries,
      cells,
      ...summarizeHeatmap(cells, providerIds, probeQueries),
    };
  }

  // ────────────────────────────────────────────────────────────
  //  Provider abstraction
  // ────────────────────────────────────────────────────────────
  private async askProvider(provider: string, query: string): Promise<string> {
    const system = 'Kullanicinin sorusuna kisa ve dogrudan cevap ver. Tanidigin Turkiye kaynaklarini, web sitelerini ve markalari ismiyle ve URL siyle birlikte belirt.';

    if (provider === 'anthropic' && this.anthropic) {
      const resp = await this.anthropic.messages.create({
        model: 'claude-opus-5',
        max_tokens: 1000,
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
          model: 'gpt-4o-mini', max_tokens: 1000,
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
          model: 'sonar', max_tokens: 1000,
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
