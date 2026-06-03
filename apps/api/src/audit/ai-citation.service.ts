import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import { decrypt } from '@luviai/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { QuotaService } from '../billing/quota.service.js';

export type Provider = 'anthropic' | 'gemini' | 'openai' | 'perplexity' | 'xai' | 'deepseek' | 'meta';

export interface CitationProbe {
  query: string;
  cited: boolean;
  brandMentioned: boolean;
  excerpt?: string;
  /** Marka response'ta hangi paragraf sırasında ilk geçti. 1 = en üstte, daha yüksek = aşağıda, null = hiç geçmedi */
  position?: number | null;
  /** Marka mention'ının tonu (heuristic — anahtar kelime context'ine bakar) */
  sentiment?: 'positive' | 'neutral' | 'negative' | null;
  /** Aynı response'ta hangi rakipler kaç defa anıldı */
  competitors?: Array<{ name: string; mentions: number; positionFirst: number | null }>;
  /** Per-page citation: AI cevabında hangi spesifik sayfa URL'leri alıntılandı (host'umuza ait) */
  citedPages?: string[];
}

export interface CitationResult {
  provider: string;
  label: string;
  available: boolean;
  score: number | null;
  probes: CitationProbe[];
  reason?: string;
  source?: 'pool' | 'byok'; // anahtarin nereden geldigi
  /** Aggregate: ortalama position (response içinde ilk mention sırası) */
  avgPosition?: number | null;
  /** Aggregate: sentiment dağılımı */
  sentimentMix?: { positive: number; neutral: number; negative: number; absent: number };
  /** Aggregate: share of voice — marka vs rakip toplam mention'lar */
  shareOfVoice?: Array<{ name: string; mentions: number; pct: number; isBrand?: boolean }>;
}

interface KeyResolution {
  key: string | null;
  source: 'pool' | 'byok' | 'none';
  reason?: string; // 'BYOK_REQUIRED' | 'NO_KEY'
}

const PROVIDER_LABELS: Record<Provider, string> = {
  anthropic:  'Anthropic Claude',
  gemini:     'Google Gemini',
  openai:     'OpenAI ChatGPT',
  perplexity: 'Perplexity',
  xai:        'xAI Grok',
  deepseek:   'DeepSeek',
  meta:       'Meta AI (Llama)',
};

const POOL_ENV_KEY: Record<Provider, string> = {
  anthropic:  'ANTHROPIC_API_KEY',
  gemini:     'GOOGLE_AI_API_KEY',
  openai:     'OPENAI_API_KEY',
  perplexity: 'PERPLEXITY_API_KEY',
  xai:        'XAI_API_KEY',
  deepseek:   'DEEPSEEK_API_KEY',
  meta:       'GROQ_API_KEY',          // Llama via Groq
};

/**
 * AI Citation Test — site brain icindeki AEO/GEO sorularini gercek LLM lara
 * sorup cevapta site URL veya marka adinin gecip gecmedigini olcer.
 *
 * Score formulu:
 *   citation (URL hostname match) = tam puan (100/probe)
 *   brand mention (yalniz isim)  = yarim puan (50/probe)
 *
 * Sprint BYOK — Hibrit anahtar cozumlemesi:
 *   1. Site BYOK varsa onu kullan (sinirsiz, kota dusurmez — kullanicinin kendi parasi)
 *   2. Plan havuzundaysa ortak ENV key'i kullan (kotaya tabi)
 *   3. Yoksa "BYOK_REQUIRED veya plan yukselt" dondur
 */
@Injectable()
export class AiCitationService {
  private readonly log = new Logger(AiCitationService.name);

  // Cost guard — gunluk per-provider hard cap (USD).
  // Sadece havuz (pool) kullanimina uygulanir; BYOK kullanicinin kendi parasi oldugu icin saymaz.
  private readonly DAILY_BUDGET_USD: Record<Provider, number> = {
    anthropic:  parseFloat(process.env.AI_BUDGET_ANTHROPIC_USD  ?? '5'),
    gemini:     parseFloat(process.env.AI_BUDGET_GEMINI_USD     ?? '5'),
    openai:     parseFloat(process.env.AI_BUDGET_OPENAI_USD     ?? '5'),
    perplexity: parseFloat(process.env.AI_BUDGET_PERPLEXITY_USD ?? '5'),
    xai:        parseFloat(process.env.AI_BUDGET_GROK_USD       ?? '3'),
    deepseek:   parseFloat(process.env.AI_BUDGET_DEEPSEEK_USD   ?? '3'),
    meta:       parseFloat(process.env.AI_BUDGET_META_USD       ?? '3'),
  };

  // Approx cost per probe (input ~150 tok + output ~400 tok)
  private readonly COST_PER_PROBE_USD: Record<Provider, number> = {
    anthropic:  0.0024,
    gemini:     0,
    openai:     0.0004,
    perplexity: 0.0006,
    xai:        0.0003,
    deepseek:   0.0006,
    meta:       0.0002,        // Groq Llama 3.3 70B ~$0.59/1M in + $0.79/1M out → ~$0.0002/probe
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly quota: QuotaService,
  ) {}

  // ────────────────────────────────────────────────────────────
  //  KEY RESOLUTION (BYOK > Pool > None)
  // ────────────────────────────────────────────────────────────
  /**
   * Bu site icin bu provider'a hangi key kullanilacak?
   * 1) BYOK varsa onu (verified olmasa bile dener; ilk kayitta zaten test edilmis olur)
   * 2) Plan havuzundaysa ENV key'i
   * 3) Yoksa null + reason
   */
  private async resolveKey(siteId: string, provider: Provider, plan: string): Promise<KeyResolution> {
    // 1) BYOK
    try {
      const byok = await this.prisma.siteAiProviderKey.findUnique({
        where: { siteId_provider: { siteId, provider } },
      });
      if (byok) {
        const key = decrypt(byok.enc);
        if (key) return { key, source: 'byok' };
      }
    } catch (err: any) {
      this.log.warn(`BYOK lookup fail (${siteId}/${provider}): ${err.message}`);
    }

    // 2) ENV key varsa pool olarak kullan (operatör ENV'e koyduysa bu provider'ı havuza dahil etmiş demektir).
    // Plan pool kontrolü hâlâ getProviderStatus'ta inPool sinyali olarak kullanılır,
    // ama runtime'da bir ENV key varsa kotaya tabi şekilde çalıştırılır.
    const envKey = process.env[POOL_ENV_KEY[provider]];
    if (envKey) return { key: envKey, source: 'pool' };

    // 3) Plan pool'da ama ENV yok → açık mesaj
    if (this.quota.getPlanPool(plan).includes(provider)) {
      return { key: null, source: 'none', reason: `${POOL_ENV_KEY[provider]} env yok` };
    }

    // 4) None — kullanici BYOK girmeli
    return {
      key: null,
      source: 'none',
      reason: `${PROVIDER_LABELS[provider]} icin API anahtari yok — kendi API anahtarini bagla (BYOK)`,
    };
  }

  /**
   * UI icin: bu site/plan kombinasyonunda hangi provider havuzda, hangisi BYOK gerektiriyor?
   */
  async getProviderStatus(siteId: string, plan: string): Promise<Array<{
    provider: Provider;
    label: string;
    inPool: boolean;
    hasByok: boolean;
    byokVerified: boolean;
    byokPrefix?: string;
    byokError?: string;
    effectiveSource: 'pool' | 'byok' | 'none';
  }>> {
    const byokRows = await this.prisma.siteAiProviderKey.findMany({ where: { siteId } });
    const byokMap = new Map(byokRows.map(r => [r.provider, r]));
    const pool = this.quota.getPlanPool(plan);

    const providers: Provider[] = ['anthropic', 'gemini', 'openai', 'perplexity', 'xai', 'deepseek', 'meta'];
    return providers.map(provider => {
      const byok = byokMap.get(provider);
      const hasEnvKey = !!process.env[POOL_ENV_KEY[provider]];
      // ENV key varsa effectively havuzdadır; planın sembolik pool listesini de dikkate al.
      const inPool = pool.includes(provider) || hasEnvKey;
      const effective: 'pool' | 'byok' | 'none' = byok ? 'byok' : (inPool ? 'pool' : 'none');
      return {
        provider,
        label: PROVIDER_LABELS[provider],
        inPool,
        hasByok: !!byok,
        byokVerified: byok?.verified ?? false,
        byokPrefix: byok?.prefix,
        byokError: byok?.lastError ?? undefined,
        effectiveSource: effective,
      };
    });
  }

  // ────────────────────────────────────────────────────────────
  //  BUDGET GUARD (havuz icin gunluk USD cap)
  // ────────────────────────────────────────────────────────────
  private async isOverBudget(provider: Provider, plannedProbes: number): Promise<boolean> {
    const cap = this.DAILY_BUDGET_USD[provider];
    if (!cap) return false;
    const today = new Date().toISOString().slice(0, 10);
    const key = `ai-cost:${provider}:${today}`;
    const row = await this.prisma.kvStore.findUnique({ where: { key } }).catch(() => null);
    const spentToday = parseFloat(((row as any)?.value as string) ?? '0');
    const projected = spentToday + (this.COST_PER_PROBE_USD[provider] ?? 0) * plannedProbes;
    return projected > cap;
  }

  private async addCost(provider: Provider, probeCount: number): Promise<void> {
    if (probeCount === 0) return;
    const today = new Date().toISOString().slice(0, 10);
    const key = `ai-cost:${provider}:${today}`;
    const cost = (this.COST_PER_PROBE_USD[provider] ?? 0) * probeCount;
    try {
      const existing = await this.prisma.kvStore.findUnique({ where: { key } }).catch(() => null);
      const prev = parseFloat(((existing as any)?.value as string) ?? '0');
      await this.prisma.kvStore.upsert({
        where: { key },
        create: { key, value: String(prev + cost) },
        update: { value: String(prev + cost) },
      });
    } catch (err: any) {
      this.log.warn(`addCost(${provider}) fail: ${err.message}`);
    }
  }

  async getTodayCosts(): Promise<Record<string, { spent: number; cap: number }>> {
    const today = new Date().toISOString().slice(0, 10);
    const out: Record<string, { spent: number; cap: number }> = {};
    for (const provider of Object.keys(this.DAILY_BUDGET_USD) as Provider[]) {
      const row = await this.prisma.kvStore.findUnique({ where: { key: `ai-cost:${provider}:${today}` } }).catch(() => null);
      const spent = parseFloat(((row as any)?.value as string) ?? '0');
      out[provider] = { spent, cap: this.DAILY_BUDGET_USD[provider] };
    }
    return out;
  }

  // ────────────────────────────────────────────────────────────
  //  ANA GIRIS NOKTASI
  // ────────────────────────────────────────────────────────────
  async runForSite(siteId: string, maxProbes = 5): Promise<CitationResult[]> {
    // Guard: AI_GLOBAL_DISABLED admin flag — ücretli LLM call'larini durdur
    try {
      const flag = await this.prisma.appSetting.findUnique({ where: { key: 'AI_GLOBAL_DISABLED' } });
      if (flag && (flag.value === '1' || flag.value === 'true')) {
        this.log.warn(`[${siteId}] AI Citation atlandi: AI_GLOBAL_DISABLED=1`);
        return [];
      }
    } catch (_err) { /* tablo yoksa devam et */ }

    const site = await this.prisma.site.findUnique({
      where: { id: siteId },
      include: { brain: true, user: { select: { id: true, plan: true } } },
    });
    if (!site) return [];

    const userId = site.userId;
    const plan = site.user.plan;

    // Kota — sadece HAVUZ kullanan testler dusurur. BYOK varsa o provider sayilmaz.
    // Once kota kontrol et; tamamen havuzdaysa kota dusur.
    const status = await this.getProviderStatus(siteId, plan);
    const usesPool = status.some(s => s.effectiveSource === 'pool');

    if (usesPool) {
      try {
        await this.quota.enforceCitationQuota(userId);
      } catch (err: any) {
        // Kota dolu — bu durumda sadece BYOK olanlari calistir
        this.log.log(`Kota dolu (user ${userId}), sadece BYOK provider'lar calisacak: ${err.message}`);
        // Hata firlatma — BYOK olanlar calismaya devam etsin
      }
    }

    // Brand resolution — site.name cok kisa (orn "ai") veya genericse hostname'in
    // ana parcasini kullan. "ai" gibi 2 harfli string'i AI kelimesinden ayirt edemeyiz.
    let brand = (site.name || '').trim();
    if (brand.length < 4) {
      try {
        const u = new URL(site.url);
        const parts = u.hostname.replace(/^www\./, '').split('.');
        if (parts.length >= 2) brand = parts[parts.length - 2]; // ranksup.ai -> "luvihost"
      } catch { /* ignore */ }
    }
    const url = site.url;
    const seo: any = site.brain?.seoStrategy ?? {};
    const queries: string[] = [];
    if (Array.isArray(seo?.aeoQueries)) queries.push(...seo.aeoQueries);
    if (Array.isArray(seo?.geoQueries)) queries.push(...seo.geoQueries);
    if (Array.isArray(seo?.topQuestions)) queries.push(...seo.topQuestions);

    // Eski brain'lerde aeo/geo/topQuestions yok → pillars + personas.searchIntent'ten türet
    if (queries.length === 0) {
      const derived = this.deriveQueriesFromBrain(site.brain);
      queries.push(...derived);
    }

    // Son çare: niş bazlı generic sorgu (en zayıf seçenek)
    if (queries.length === 0 && site.niche && site.niche !== 'diğer') {
      queries.push(
        `${site.niche} alaninda en iyi siteler hangileri?`,
        `${site.niche} icin onerilebilecek Turkiye merkezli kaynaklar nelerdir?`,
        `${site.niche} konusunda en kapsamli rehberler nereden okunabilir?`,
      );
    }
    const probeQueries = Array.from(new Set(queries)).slice(0, maxProbes);

    // Rakip listesi — brain'den + ASO modülünden (TrackedApp Competitor table varsa)
    const competitors: string[] = [];
    const brainComps: any = (site.brain as any)?.competitors;
    if (Array.isArray(brainComps)) {
      for (const c of brainComps) {
        const name = typeof c === 'string' ? c : (c && typeof c === 'object' ? c.name : null);
        if (name && typeof name === 'string') competitors.push(name);
      }
    }
    // ASO competitor table fallback (varsa)
    try {
      const asoComps = await this.prisma.$queryRawUnsafe<Array<{ name: string }>>(
        `SELECT DISTINCT name FROM aso_competitors WHERE siteId = ? AND isActive = 1 LIMIT 20`,
        siteId,
      ).catch(() => []);
      for (const c of asoComps ?? []) if (c.name) competitors.push(c.name);
    } catch { /* table yoksa sessiz geç */ }
    const uniqueCompetitors = Array.from(new Set(competitors.map((c) => c.trim()).filter((c) => c.length >= 3 && c.toLowerCase() !== brand.toLowerCase())));

    const providers: Provider[] = ['anthropic', 'gemini', 'openai', 'perplexity', 'xai', 'deepseek', 'meta'];
    const results = await Promise.all(
      providers.map(p => this.runProvider(p, siteId, plan, brand, url, probeQueries, uniqueCompetitors)),
    );

    // Havuz kullanan en az bir basarili test varsa kota +1
    const anyPoolSuccess = results.some(r => r.source === 'pool' && r.score !== null);
    if (anyPoolSuccess) {
      try { await this.quota.incrementCitationUsage(userId); } catch (e) { /* noop */ }
    }

    return results;
  }

  // ────────────────────────────────────────────────────────────
  //  PUBLIC (UNAUTH) — landing page demo icin
  //  Site DB lookup yok, ENV anahtarlari ile direkt 6 provider'a paralel sor.
  //  Cost guard ve quota DEVRE DISI — caller (PublicCitationService)
  //  IP rate-limit + cache + Turnstile ile abuse'i kontrol eder.
  // ────────────────────────────────────────────────────────────
  async runPublicProbes(opts: {
    brand: string;
    host: string;
    queries: string[];
    competitors?: string[];
  }): Promise<Array<{
    provider: Provider;
    label: string;
    available: boolean;
    probes: CitationProbe[];
    reason?: string;
  }>> {
    const { brand, host, queries, competitors = [] } = opts;
    const systemPrompt = this.buildSystemPrompt();
    const providers: Provider[] = ['anthropic', 'gemini', 'openai', 'perplexity', 'xai', 'deepseek', 'meta'];

    return Promise.all(providers.map(async (provider) => {
      const label = PROVIDER_LABELS[provider];
      const key = process.env[POOL_ENV_KEY[provider]];
      if (!key) {
        return { provider, label, available: false, probes: [], reason: 'NO_KEY' };
      }
      try {
        let probes: CitationProbe[] = [];
        switch (provider) {
          case 'anthropic':  probes = await this.probeAnthropic(key, host, brand, queries, systemPrompt, competitors); break;
          case 'gemini':     probes = await this.probeGemini(key, host, brand, queries, systemPrompt, competitors); break;
          case 'openai':     probes = await this.probeOpenAI(key, host, brand, queries, systemPrompt, competitors); break;
          case 'perplexity': probes = await this.probePerplexity(key, host, brand, queries, systemPrompt, competitors); break;
          case 'xai':        probes = await this.probeXai(key, host, brand, queries, systemPrompt, competitors); break;
          case 'deepseek':   probes = await this.probeDeepseek(key, host, brand, queries, systemPrompt, competitors); break;
          case 'meta':       probes = await this.probeMeta(key, host, brand, queries, systemPrompt, competitors); break;
        }
        // Cost defteri tutulur (public da olsa sistem kotasinin parcasi)
        await this.addCost(provider, probes.length).catch(() => {});
        return { provider, label, available: true, probes };
      } catch (err: any) {
        this.log.warn(`Public probe failed (${provider}): ${err.message}`);
        return { provider, label, available: false, probes: [], reason: err.message?.slice(0, 200) };
      }
    }));
  }

  /** Public aggregate — PublicCitationService bunu cagirir, kendi shareOfVoice'unu hesaplar. */
  publicAggregate(probes: CitationProbe[], brand: string) {
    return this.aggregateProbes(probes, brand);
  }

  // ────────────────────────────────────────────────────────────
  //  PER-PROVIDER ROUTER
  // ────────────────────────────────────────────────────────────
  private async runProvider(
    provider: Provider,
    siteId: string,
    plan: string,
    brand: string,
    url: string,
    queries: string[],
    competitors: string[] = [],
  ): Promise<CitationResult> {
    const label = PROVIDER_LABELS[provider];
    const resolved = await this.resolveKey(siteId, provider, plan);

    if (!resolved.key) {
      return {
        provider, label, available: false, score: null, probes: [],
        reason: resolved.reason ?? 'API anahtari yok',
      };
    }
    if (queries.length === 0) {
      return {
        provider, label, available: true, score: null, probes: [],
        reason: 'AEO/GEO sorgusu yok — Brain regenerate et',
        source: resolved.source as 'pool' | 'byok',
      };
    }
    // Butce kontrolu sadece havuz icin (BYOK kullanicinin kendi parasi)
    if (resolved.source === 'pool' && await this.isOverBudget(provider, queries.length)) {
      return {
        provider, label, available: false, score: null, probes: [],
        reason: `Günlük havuz bütçesi aşıldı (${this.DAILY_BUDGET_USD[provider]?.toFixed(2)} USD). BYOK ekleyebilir veya yarın tekrar denersiniz.`,
        source: 'pool',
      };
    }

    const host = this.extractHost(url);
    const systemPrompt = this.buildSystemPrompt();
    let probes: CitationProbe[] = [];

    try {
      switch (provider) {
        case 'anthropic':
          probes = await this.probeAnthropic(resolved.key, host, brand, queries, systemPrompt, competitors);
          break;
        case 'gemini':
          probes = await this.probeGemini(resolved.key, host, brand, queries, systemPrompt, competitors);
          break;
        case 'openai':
          probes = await this.probeOpenAI(resolved.key, host, brand, queries, systemPrompt, competitors);
          break;
        case 'perplexity':
          probes = await this.probePerplexity(resolved.key, host, brand, queries, systemPrompt, competitors);
          break;
        case 'xai':
          probes = await this.probeXai(resolved.key, host, brand, queries, systemPrompt, competitors);
          break;
        case 'deepseek':
          probes = await this.probeDeepseek(resolved.key, host, brand, queries, systemPrompt, competitors);
          break;
        case 'meta':
          probes = await this.probeMeta(resolved.key, host, brand, queries, systemPrompt, competitors);
          break;
      }
    } catch (err: any) {
      this.log.warn(`${provider} probe failed (whole batch): ${err.message}`);
      return {
        provider, label, available: false, score: null, probes: [],
        reason: `HATA: ${err.message}`,
        source: resolved.source as 'pool' | 'byok',
      };
    }

    if (resolved.source === 'pool') {
      await this.addCost(provider, probes.filter((p) => !p.excerpt?.startsWith('HATA:')).length);
    }

    const agg = this.aggregateProbes(probes, brand);
    return {
      provider, label, available: true,
      score: this.scoreFromProbes(probes),
      probes,
      source: resolved.source as 'pool' | 'byok',
      avgPosition: agg.avgPosition,
      sentimentMix: agg.sentimentMix,
      shareOfVoice: agg.shareOfVoice,
    };
  }

  // ────────────────────────────────────────────────────────────
  //  PROBE IMPLEMENTASYONLARI (key parametre olarak gelir)
  // ────────────────────────────────────────────────────────────
  private async probeAnthropic(key: string, host: string, brand: string, queries: string[], systemPrompt: string, competitors: string[] = []): Promise<CitationProbe[]> {
    const client = new Anthropic({ apiKey: key });
    const probes: CitationProbe[] = [];
    for (const q of queries) {
      try {
        const resp = await client.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 400,
          system: systemPrompt,
          messages: [{ role: 'user', content: q }],
        });
        const text = resp.content
          .filter((b: any) => b.type === 'text')
          .map((b: any) => b.text)
          .join(' ');
        probes.push(this.buildProbe(q, text, host, brand, competitors));
      } catch (err: any) {
        this.log.warn(`Anthropic probe failed (${q}): ${err.message}`);
        probes.push({ query: q, cited: false, brandMentioned: false, excerpt: `HATA: ${err.message}` });
      }
    }
    return probes;
  }

  private async probeGemini(key: string, host: string, brand: string, queries: string[], systemPrompt: string, competitors: string[] = []): Promise<CitationProbe[]> {
    const client = new GoogleGenAI({ apiKey: key });
    const probes: CitationProbe[] = [];
    for (const q of queries) {
      try {
        const resp = await client.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: `${systemPrompt}\n\nSoru: ${q}`,
          config: { maxOutputTokens: 400 } as any,
        });
        const text = resp.text ?? '';
        probes.push(this.buildProbe(q, text, host, brand, competitors));
      } catch (err: any) {
        this.log.warn(`Gemini probe failed (${q}): ${err.message}`);
        probes.push({ query: q, cited: false, brandMentioned: false, excerpt: `HATA: ${err.message}` });
      }
    }
    return probes;
  }

  private async probeOpenAI(key: string, host: string, brand: string, queries: string[], systemPrompt: string, competitors: string[] = []): Promise<CitationProbe[]> {
    const probes: CitationProbe[] = [];
    for (const q of queries) {
      try {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            max_tokens: 400,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: q },
            ],
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => '')}`.slice(0, 200));
        const data = await res.json() as any;
        const text = data?.choices?.[0]?.message?.content ?? '';
        probes.push(this.buildProbe(q, text, host, brand, competitors));
      } catch (err: any) {
        this.log.warn(`OpenAI probe failed (${q}): ${err.message}`);
        probes.push({ query: q, cited: false, brandMentioned: false, excerpt: `HATA: ${err.message}` });
      }
    }
    return probes;
  }

  private async probePerplexity(key: string, host: string, brand: string, queries: string[], systemPrompt: string, competitors: string[] = []): Promise<CitationProbe[]> {
    const probes: CitationProbe[] = [];
    for (const q of queries) {
      try {
        const res = await fetch('https://api.perplexity.ai/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'sonar',
            max_tokens: 400,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: q },
            ],
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => '')}`.slice(0, 200));
        const data = await res.json() as any;
        const text = data?.choices?.[0]?.message?.content ?? '';
        const citations: string[] = Array.isArray(data?.citations) ? data.citations : [];
        const citedFromList = citations.some((u: string) => u.toLowerCase().includes(host));
        const probe = this.buildProbe(q, text, host, brand, competitors);
        if (citedFromList) probe.cited = true;
        probes.push(probe);
      } catch (err: any) {
        this.log.warn(`Perplexity probe failed (${q}): ${err.message}`);
        probes.push({ query: q, cited: false, brandMentioned: false, excerpt: `HATA: ${err.message}` });
      }
    }
    return probes;
  }

  private async probeXai(key: string, host: string, brand: string, queries: string[], systemPrompt: string, competitors: string[] = []): Promise<CitationProbe[]> {
    const probes: CitationProbe[] = [];
    for (const q of queries) {
      try {
        const res = await fetch('https://api.x.ai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'grok-4-fast-non-reasoning',
            max_tokens: 400,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: q },
            ],
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => '')}`.slice(0, 200));
        const data = await res.json() as any;
        const text = data?.choices?.[0]?.message?.content ?? '';
        probes.push(this.buildProbe(q, text, host, brand, competitors));
      } catch (err: any) {
        this.log.warn(`Grok probe failed (${q}): ${err.message}`);
        probes.push({ query: q, cited: false, brandMentioned: false, excerpt: `HATA: ${err.message}` });
      }
    }
    return probes;
  }

  private async probeDeepseek(key: string, host: string, brand: string, queries: string[], systemPrompt: string, competitors: string[] = []): Promise<CitationProbe[]> {
    const probes: CitationProbe[] = [];
    for (const q of queries) {
      try {
        const res = await fetch('https://api.deepseek.com/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'deepseek-chat',
            max_tokens: 400,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: q },
            ],
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => '')}`.slice(0, 200));
        const data = await res.json() as any;
        const text = data?.choices?.[0]?.message?.content ?? '';
        probes.push(this.buildProbe(q, text, host, brand, competitors));
      } catch (err: any) {
        this.log.warn(`DeepSeek probe failed (${q}): ${err.message}`);
        probes.push({ query: q, cited: false, brandMentioned: false, excerpt: `HATA: ${err.message}` });
      }
    }
    return probes;
  }

  /** Meta AI (Llama) via Groq — OpenAI-compatible endpoint, free tier friendly */
  private async probeMeta(key: string, host: string, brand: string, queries: string[], systemPrompt: string, competitors: string[] = []): Promise<CitationProbe[]> {
    const probes: CitationProbe[] = [];
    const model = process.env.GROQ_LLAMA_MODEL ?? 'llama-3.3-70b-versatile';
    for (const q of queries) {
      try {
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            max_tokens: 400,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: q },
            ],
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => '')}`.slice(0, 200));
        const data = await res.json() as any;
        const text = data?.choices?.[0]?.message?.content ?? '';
        probes.push(this.buildProbe(q, text, host, brand, competitors));
      } catch (err: any) {
        this.log.warn(`Meta/Llama probe failed (${q}): ${err.message}`);
        probes.push({ query: q, cited: false, brandMentioned: false, excerpt: `HATA: ${err.message}` });
      }
    }
    return probes;
  }

  // ────────────────────────────────────────────────────────────
  //  YARDIMCI
  // ────────────────────────────────────────────────────────────
  private buildSystemPrompt(): string {
    return 'Kullanicinin sorusuna kisa ve dogrudan cevap ver. Tanidigin Turkiye kaynaklarini, web sitelerini ve markalari ismiyle ve URL siyle birlikte belirt. Bilmiyorsan acikca soyle.';
  }

  private extractHost(url: string): string {
    try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); }
    catch { return url.toLowerCase(); }
  }

  private scoreFromProbes(probes: CitationProbe[]): number | null {
    if (probes.length === 0) return null;
    const cited = probes.filter(p => p.cited).length;
    const mentioned = probes.filter(p => p.brandMentioned && !p.cited).length;
    return Math.round(((cited * 100) + (mentioned * 50)) / probes.length);
  }

  private buildProbe(query: string, text: string, host: string, brand: string, competitors: string[] = []): CitationProbe {
    const lower = text.toLowerCase();
    const brandLower = (brand || '').toLowerCase().trim();
    // Marka mention'a sahte match yok — word boundary + minimum 4 karakter zorunlu.
    let brandMentioned = false;
    let brandFirstIdx: number | null = null;
    if (brandLower.length >= 4) {
      const escaped = brandLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(?:^|[^a-zA-Z0-9À-ſğüşöçıİĞÜŞÖÇ])${escaped}(?:$|[^a-zA-Z0-9À-ſğüşöçıİĞÜŞÖÇ])`, 'i');
      const m = text.match(re);
      if (m && m.index !== undefined) {
        brandMentioned = true;
        brandFirstIdx = m.index;
      }
    }

    // ── Position: response'u paragraflara böl, brand ilk hangi paragrafta?
    let position: number | null = null;
    if (brandMentioned && brandFirstIdx !== null) {
      // Paragraf yerine "satır" — daha tutarlı (markdown lists bile çalışsın)
      const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
      let cumIdx = 0;
      for (let i = 0; i < lines.length; i++) {
        cumIdx += lines[i].length + 1; // +1 newline
        if (cumIdx > brandFirstIdx) { position = i + 1; break; }
      }
      if (position === null) position = lines.length;
    }

    // ── Sentiment: brand mention çevresindeki ±80 karakter context'inde pozitif/negatif kelime ara
    let sentiment: 'positive' | 'neutral' | 'negative' | null = null;
    if (brandMentioned && brandFirstIdx !== null) {
      const ctxStart = Math.max(0, brandFirstIdx - 80);
      const ctxEnd = Math.min(text.length, brandFirstIdx + brandLower.length + 80);
      const ctx = text.slice(ctxStart, ctxEnd).toLowerCase();
      // TR + EN kalıplar
      const positive = /(en iyi|önerilir|tavsiye|kaliteli|güçlü|harika|popüler|lider|en sevilen|kazanc|kullanışlı|effective|recommended|best|leading|popular|top|excellent|trusted|reliable|favored)/i;
      const negative = /(kötü|sorunlu|yavaş|pahalı|tavsiye etmem|hayal kırıklığı|zayıf|eksik|berbat|sıkıntı|problem|avoid|bad|poor|weak|disappointing|expensive|outdated|complaints)/i;
      if (positive.test(ctx)) sentiment = 'positive';
      else if (negative.test(ctx)) sentiment = 'negative';
      else sentiment = 'neutral';
    }

    // ── Competitor mentions: ASO modülünden gelen rakip listesini text'te ara
    const competitorStats: Array<{ name: string; mentions: number; positionFirst: number | null }> = [];
    for (const compRaw of competitors) {
      const comp = (compRaw || '').toLowerCase().trim();
      if (comp.length < 3 || comp === brandLower) continue;
      const esc = comp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(?:^|[^a-zA-Z0-9À-ſğüşöçıİĞÜŞÖÇ])${esc}(?:$|[^a-zA-Z0-9À-ſğüşöçıİĞÜŞÖÇ])`, 'gi');
      const matches = [...text.matchAll(re)];
      if (matches.length > 0) {
        competitorStats.push({
          name: compRaw,
          mentions: matches.length,
          positionFirst: matches[0].index ?? null,
        });
      }
    }

    // ── Per-page citation: response'ta host'umuza ait URL'leri çıkar
    // Örnek: "luvihost.com/blog/x" → ['/blog/x']
    const citedPages: string[] = [];
    if (host) {
      const escHost = host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Matches: https://host/path veya host/path (https opsiyonel)
      const urlRe = new RegExp(`(?:https?:\\/\\/)?${escHost}(\\/[\\w\\-./?#=&%+]*)`, 'gi');
      const matches = [...text.matchAll(urlRe)];
      const seen = new Set<string>();
      for (const m of matches) {
        let path = m[1] || '/';
        // Trim trailing punctuation, fragment'ler ve query string sadeleştir
        path = path.replace(/[.,;:)\]]+$/, '').split('#')[0].split('?')[0] || '/';
        if (path.length > 0 && !seen.has(path) && path.length < 200) {
          seen.add(path);
          citedPages.push(path);
        }
      }
    }

    return {
      query,
      cited: lower.includes(host),
      brandMentioned,
      excerpt: text.slice(0, 220),
      position,
      sentiment,
      competitors: competitorStats,
      citedPages,
    };
  }

  /**
   * Probe array'inden aggregate metrikleri çıkar:
   *  - avgPosition  : Brand'in ortalama mention sırası (1=en üstte)
   *  - sentimentMix : Pozitif/nötr/negatif/yok dağılımı
   *  - shareOfVoice : Brand vs rakip toplam mention oranı
   */
  private aggregateProbes(probes: CitationProbe[], brand: string): {
    avgPosition: number | null;
    sentimentMix: { positive: number; neutral: number; negative: number; absent: number };
    shareOfVoice: Array<{ name: string; mentions: number; pct: number; isBrand?: boolean }>;
  } {
    // avgPosition
    const positions = probes.map((p) => p.position).filter((x): x is number => typeof x === 'number');
    const avgPosition = positions.length > 0
      ? Math.round((positions.reduce((a, b) => a + b, 0) / positions.length) * 10) / 10
      : null;

    // sentiment mix
    const mix = { positive: 0, neutral: 0, negative: 0, absent: 0 };
    for (const p of probes) {
      if (!p.brandMentioned || !p.sentiment) mix.absent++;
      else mix[p.sentiment]++;
    }

    // share of voice
    const counter = new Map<string, number>();
    let brandMentions = 0;
    for (const p of probes) {
      if (p.brandMentioned) brandMentions++;
      for (const c of p.competitors ?? []) {
        counter.set(c.name, (counter.get(c.name) ?? 0) + c.mentions);
      }
    }
    const total = brandMentions + [...counter.values()].reduce((a, b) => a + b, 0);
    const shareOfVoice: Array<{ name: string; mentions: number; pct: number; isBrand?: boolean }> = [];
    if (total > 0) {
      shareOfVoice.push({ name: brand, mentions: brandMentions, pct: Math.round((brandMentions / total) * 100), isBrand: true });
      for (const [name, mentions] of [...counter.entries()].sort((a, b) => b[1] - a[1])) {
        shareOfVoice.push({ name, mentions, pct: Math.round((mentions / total) * 100) });
      }
    }

    return { avgPosition, sentimentMix: mix, shareOfVoice };
  }

  /**
   * Per-page citation breakdown — Clarity tarzı.
   * "Hangi MY URL kaç kere AI cevabında alıntılandı + hangi sorgu için".
   *
   * Output:
   *   pages: [{ url, cites, queries: [{query, provider, cites}] }]
   *   topPages: en çok cite alan 10 sayfa
   *   groundingQueries: en çok cite tetikleyen sorgular
   */
  aggregatePerPageCitations(results: CitationResult[]): {
    pages: Array<{ url: string; cites: number; queries: Array<{ query: string; provider: string; cites: number }> }>;
    topPages: Array<{ url: string; cites: number }>;
    groundingQueries: Array<{ query: string; cites: number; pages: string[] }>;
    totalCites: number;
  } {
    // (url) → (query+provider) → count
    const pageMap = new Map<string, Map<string, number>>();
    const queryMap = new Map<string, { cites: number; pages: Set<string> }>();
    let totalCites = 0;

    for (const r of results) {
      if (!r.available) continue;
      for (const p of r.probes ?? []) {
        for (const url of p.citedPages ?? []) {
          totalCites++;
          // Page → query+provider
          if (!pageMap.has(url)) pageMap.set(url, new Map());
          const key = `${p.query}|||${r.provider}`;
          pageMap.get(url)!.set(key, (pageMap.get(url)!.get(key) ?? 0) + 1);
          // Query → cites + pages
          if (!queryMap.has(p.query)) queryMap.set(p.query, { cites: 0, pages: new Set() });
          const q = queryMap.get(p.query)!;
          q.cites++;
          q.pages.add(url);
        }
      }
    }

    const pages = [...pageMap.entries()].map(([url, queries]) => {
      const queryList = [...queries.entries()].map(([key, cites]) => {
        const [query, provider] = key.split('|||');
        return { query, provider, cites };
      }).sort((a, b) => b.cites - a.cites);
      return {
        url,
        cites: queryList.reduce((s, q) => s + q.cites, 0),
        queries: queryList,
      };
    }).sort((a, b) => b.cites - a.cites);

    const groundingQueries = [...queryMap.entries()]
      .map(([query, data]) => ({ query, cites: data.cites, pages: [...data.pages] }))
      .sort((a, b) => b.cites - a.cites);

    return {
      pages,
      topPages: pages.slice(0, 10).map((p) => ({ url: p.url, cites: p.cites })),
      groundingQueries: groundingQueries.slice(0, 15),
      totalCites,
    };
  }

  /**
   * GEO Roadmap — sonuçlardan yola çıkarak "neden bu skordasın + ne yapmalısın".
   * Maya'nın "GEO Roadmap & Actions" özelliğinin RanksUp versiyonu.
   * OpenAI gpt-4o-mini ile 1 call; yoksa heuristic fallback.
   */
  async generateRoadmap(
    siteId: string,
    results: CitationResult[],
  ): Promise<{ summary: string; actions: Array<{ title: string; why: string; effort: 'low' | 'medium' | 'high' }> } | null> {
    const successfulResults = results.filter((r) => r.available && r.probes.length > 0);
    if (successfulResults.length === 0) return null;

    const allProbes = successfulResults.flatMap((r) => r.probes);
    const totalProbes = allProbes.length;
    const brandHits = allProbes.filter((p) => p.brandMentioned || p.cited).length;
    const hitRate = totalProbes > 0 ? brandHits / totalProbes : 0;
    const avgScore = successfulResults.reduce((s, r) => s + (r.score ?? 0), 0) / successfulResults.length;

    const compTally = new Map<string, number>();
    for (const p of allProbes) {
      for (const c of p.competitors ?? []) compTally.set(c.name, (compTally.get(c.name) ?? 0) + c.mentions);
    }
    const topCompetitors = [...compTally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);

    const sentiment = { positive: 0, neutral: 0, negative: 0 };
    for (const p of allProbes) {
      if (p.brandMentioned && p.sentiment && p.sentiment !== null) {
        sentiment[p.sentiment as 'positive' | 'neutral' | 'negative']++;
      }
    }

    const site = await this.prisma.site.findUnique({
      where: { id: siteId },
      select: { name: true, url: true, niche: true },
    });
    if (!site) return null;

    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey) {
      try {
        const prompt = `RanksUp bir markanın AI asistanlarda (ChatGPT, Claude, Gemini, Perplexity) görünürlüğünü ölçtü.

Marka: ${site.name} (${site.url})
Niş: ${site.niche ?? 'bilinmiyor'}
Probe sayısı: ${totalProbes}
Markanın mention edildiği probe sayısı: ${brandHits} (%${Math.round(hitRate * 100)})
Ortalama score: ${Math.round(avgScore)}/100
En çok anılan rakipler: ${topCompetitors.map(([n, c]) => `${n} (${c}x)`).join(', ') || 'yok'}
Sentiment: ${sentiment.positive} pozitif, ${sentiment.neutral} nötr, ${sentiment.negative} negatif

Bu veriye göre 5 madde ACTIONABLE öneri ver. Her öneri için: başlık (max 8 kelime), neden önemli (1 cümle), tahmini efor (low/medium/high).
Format: JSON {"summary":"1 cümle genel özet","actions":[{"title":"...","why":"...","effort":"low"},...]}.
Sadece JSON dön, başka şey yazma.`;

        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.3,
            response_format: { type: 'json_object' },
          }),
        });
        if (res.ok) {
          const data: any = await res.json();
          const raw = data.choices?.[0]?.message?.content;
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed.summary && Array.isArray(parsed.actions)) return parsed;
          }
        }
      } catch (err: any) {
        this.log.warn(`generateRoadmap LLM failed: ${err.message} — heuristic fallback`);
      }
    }

    // Heuristic fallback
    const actions: Array<{ title: string; why: string; effort: 'low' | 'medium' | 'high' }> = [];
    if (hitRate < 0.2) {
      actions.push({ title: 'Marka adını her ana sayfa H1\'ine ekle', why: 'AI modelleri markayı bulamıyor; H1 ve meta-title net olmalı.', effort: 'low' });
      actions.push({ title: 'Wikipedia + Türkçe forum kaynaklarına eklen', why: 'LLM\'ler bu kaynakları çok besler.', effort: 'medium' });
    }
    if (topCompetitors.length > 0) {
      actions.push({
        title: `${topCompetitors[0][0]} ile karşılaştırma sayfası ekle`,
        why: `Bu rakip ${topCompetitors[0][1]} kez anıldı; karşılaştırma içerikleri AI'da sık çekiliyor.`,
        effort: 'medium',
      });
    }
    if (sentiment.negative > sentiment.positive) {
      actions.push({ title: 'Olumlu müşteri yorumlarını sayfada öne çıkar', why: 'AI context\'inde negatif sinyal baskın.', effort: 'low' });
    }
    actions.push({ title: 'FAQ Schema markup ekle', why: 'AEO için kritik; AI direkt soru-cevap çekiyor.', effort: 'low' });
    actions.push({ title: 'Aylık 4 long-form "ultimate guide" yayını', why: 'AI assistant\'lar uzun otoriter içerikleri tercih ediyor.', effort: 'high' });

    return {
      summary: `Görünürlük skorun ${Math.round(avgScore)}/100. ${brandHits === 0 ? 'AI\'lar markanı henüz tanımıyor — temel çalışmalar gerek.' : `${brandHits} probe'ta anıldın, %${Math.round(hitRate * 100)} oranı.`}`,
      actions: actions.slice(0, 5),
    };
  }

  /**
   * Eski/eksik brain'lerde aeo/geo/topQuestions yoksa pillars + personas.searchIntent'ten
   * AI'a sorulabilir anlamlı query türetir. Niş fallback'inden çok daha hedefli.
   */
  private deriveQueriesFromBrain(brain: any): string[] {
    if (!brain) return [];
    const out: string[] = [];

    const pillars: any[] = Array.isArray(brain.seoStrategy?.pillars) ? brain.seoStrategy.pillars : [];
    for (const p of pillars.slice(0, 3)) {
      if (typeof p?.name === 'string' && p.name.trim()) {
        out.push(`${p.name.trim()} icin en iyi cozumler nelerdir?`);
      }
      const clusters: any[] = Array.isArray(p?.clusters) ? p.clusters : [];
      for (const c of clusters.slice(0, 2)) {
        const phrase = String(c).replace(/[-_]+/g, ' ').trim();
        if (phrase.length > 4) out.push(`${phrase}?`);
      }
    }

    const personas: any[] = Array.isArray(brain.personas) ? brain.personas : [];
    for (const persona of personas.slice(0, 2)) {
      const intents: any[] = Array.isArray(persona?.searchIntent) ? persona.searchIntent : [];
      for (const intent of intents.slice(0, 2)) {
        const s = String(intent).trim();
        if (s.length > 5) out.push(s);
      }
    }

    return Array.from(new Set(out));
  }
}
