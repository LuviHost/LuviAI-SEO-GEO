import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import { decrypt } from '@luviai/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { QuotaService } from '../billing/quota.service.js';

export type Provider = 'anthropic' | 'gemini' | 'openai' | 'perplexity' | 'xai' | 'deepseek';

export interface CitationProbe {
  query: string;
  cited: boolean;
  brandMentioned: boolean;
  excerpt?: string;
}

export interface CitationResult {
  provider: string;
  label: string;
  available: boolean;
  score: number | null;
  probes: CitationProbe[];
  reason?: string;
  source?: 'pool' | 'byok'; // anahtarin nereden geldigi
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
};

const POOL_ENV_KEY: Record<Provider, string> = {
  anthropic:  'ANTHROPIC_API_KEY',
  gemini:     'GOOGLE_AI_API_KEY',
  openai:     'OPENAI_API_KEY',
  perplexity: 'PERPLEXITY_API_KEY',
  xai:        'XAI_API_KEY',
  deepseek:   'DEEPSEEK_API_KEY',
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
  };

  // Approx cost per probe (input ~150 tok + output ~400 tok)
  private readonly COST_PER_PROBE_USD: Record<Provider, number> = {
    anthropic:  0.0024,
    gemini:     0,
    openai:     0.0004,
    perplexity: 0.0006,
    xai:        0.0003,
    deepseek:   0.0006,
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

    // 2) Pool
    const inPool = this.quota.getPlanPool(plan).includes(provider);
    if (inPool) {
      const envKey = process.env[POOL_ENV_KEY[provider]];
      if (envKey) return { key: envKey, source: 'pool' };
      return { key: null, source: 'none', reason: `${POOL_ENV_KEY[provider]} env yok` };
    }

    // 3) None — kullanici BYOK girmeli ya da plan yukseltmeli
    return {
      key: null,
      source: 'none',
      reason: `${PROVIDER_LABELS[provider]} bu plana dahil degil — kendi API anahtarini bagla veya plani yukselt`,
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

    const providers: Provider[] = ['anthropic', 'gemini', 'openai', 'perplexity', 'xai', 'deepseek'];
    return providers.map(provider => {
      const byok = byokMap.get(provider);
      const inPool = pool.includes(provider);
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

    const brand = site.name;
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

    const providers: Provider[] = ['anthropic', 'gemini', 'openai', 'perplexity', 'xai', 'deepseek'];
    const results = await Promise.all(
      providers.map(p => this.runProvider(p, siteId, plan, brand, url, probeQueries)),
    );

    // Havuz kullanan en az bir basarili test varsa kota +1
    const anyPoolSuccess = results.some(r => r.source === 'pool' && r.score !== null);
    if (anyPoolSuccess) {
      try { await this.quota.incrementCitationUsage(userId); } catch (e) { /* noop */ }
    }

    return results;
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
          probes = await this.probeAnthropic(resolved.key, host, brand, queries, systemPrompt);
          break;
        case 'gemini':
          probes = await this.probeGemini(resolved.key, host, brand, queries, systemPrompt);
          break;
        case 'openai':
          probes = await this.probeOpenAI(resolved.key, host, brand, queries, systemPrompt);
          break;
        case 'perplexity':
          probes = await this.probePerplexity(resolved.key, host, brand, queries, systemPrompt);
          break;
        case 'xai':
          probes = await this.probeXai(resolved.key, host, brand, queries, systemPrompt);
          break;
        case 'deepseek':
          probes = await this.probeDeepseek(resolved.key, host, brand, queries, systemPrompt);
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

    return {
      provider, label, available: true,
      score: this.scoreFromProbes(probes),
      probes,
      source: resolved.source as 'pool' | 'byok',
    };
  }

  // ────────────────────────────────────────────────────────────
  //  PROBE IMPLEMENTASYONLARI (key parametre olarak gelir)
  // ────────────────────────────────────────────────────────────
  private async probeAnthropic(key: string, host: string, brand: string, queries: string[], systemPrompt: string): Promise<CitationProbe[]> {
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
        probes.push(this.buildProbe(q, text, host, brand));
      } catch (err: any) {
        this.log.warn(`Anthropic probe failed (${q}): ${err.message}`);
        probes.push({ query: q, cited: false, brandMentioned: false, excerpt: `HATA: ${err.message}` });
      }
    }
    return probes;
  }

  private async probeGemini(key: string, host: string, brand: string, queries: string[], systemPrompt: string): Promise<CitationProbe[]> {
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
        probes.push(this.buildProbe(q, text, host, brand));
      } catch (err: any) {
        this.log.warn(`Gemini probe failed (${q}): ${err.message}`);
        probes.push({ query: q, cited: false, brandMentioned: false, excerpt: `HATA: ${err.message}` });
      }
    }
    return probes;
  }

  private async probeOpenAI(key: string, host: string, brand: string, queries: string[], systemPrompt: string): Promise<CitationProbe[]> {
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
        probes.push(this.buildProbe(q, text, host, brand));
      } catch (err: any) {
        this.log.warn(`OpenAI probe failed (${q}): ${err.message}`);
        probes.push({ query: q, cited: false, brandMentioned: false, excerpt: `HATA: ${err.message}` });
      }
    }
    return probes;
  }

  private async probePerplexity(key: string, host: string, brand: string, queries: string[], systemPrompt: string): Promise<CitationProbe[]> {
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
        const probe = this.buildProbe(q, text, host, brand);
        if (citedFromList) probe.cited = true;
        probes.push(probe);
      } catch (err: any) {
        this.log.warn(`Perplexity probe failed (${q}): ${err.message}`);
        probes.push({ query: q, cited: false, brandMentioned: false, excerpt: `HATA: ${err.message}` });
      }
    }
    return probes;
  }

  private async probeXai(key: string, host: string, brand: string, queries: string[], systemPrompt: string): Promise<CitationProbe[]> {
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
        probes.push(this.buildProbe(q, text, host, brand));
      } catch (err: any) {
        this.log.warn(`Grok probe failed (${q}): ${err.message}`);
        probes.push({ query: q, cited: false, brandMentioned: false, excerpt: `HATA: ${err.message}` });
      }
    }
    return probes;
  }

  private async probeDeepseek(key: string, host: string, brand: string, queries: string[], systemPrompt: string): Promise<CitationProbe[]> {
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
        probes.push(this.buildProbe(q, text, host, brand));
      } catch (err: any) {
        this.log.warn(`DeepSeek probe failed (${q}): ${err.message}`);
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

  private buildProbe(query: string, text: string, host: string, brand: string): CitationProbe {
    const lower = text.toLowerCase();
    return {
      query,
      cited: lower.includes(host),
      brandMentioned: lower.includes(brand.toLowerCase()),
      excerpt: text.slice(0, 220),
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
