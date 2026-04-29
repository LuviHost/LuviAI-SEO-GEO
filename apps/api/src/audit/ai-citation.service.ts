import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import { PrismaService } from '../prisma/prisma.service.js';

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
}

/**
 * AI Citation Test — site brain icindeki AEO/GEO sorularini gercek LLM lara
 * sorup cevapta site URL veya marka adinin gecip gecmedigini olcer.
 *
 * Score formulu:
 *   citation (URL hostname match) = tam puan (100/probe)
 *   brand mention (yalniz isim)  = yarim puan (50/probe)
 *
 * Mevcut: Anthropic Claude. Eklenebilir: OpenAI/Perplexity/Gemini/Grok/DeepSeek
 * (env'de ilgili API key olduğunda otomatik aktif olur).
 */
@Injectable()
export class AiCitationService {
  private readonly log = new Logger(AiCitationService.name);
  private readonly anthropic = process.env.ANTHROPIC_API_KEY
    ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    : null;
  private readonly geminiKey = process.env.GOOGLE_AI_API_KEY ?? process.env.GEMINI_API_KEY ?? null;
  private readonly gemini = this.geminiKey ? new GoogleGenAI({ apiKey: this.geminiKey }) : null;
  private readonly openaiKey = process.env.OPENAI_API_KEY ?? null;
  private readonly perplexityKey = process.env.PERPLEXITY_API_KEY ?? null;
  private readonly grokKey = process.env.XAI_API_KEY ?? null;
  private readonly deepseekKey = process.env.DEEPSEEK_API_KEY ?? null;

  // Cost guard — gunluk per-provider hard cap (USD).
  // Asilirsa o provider o gun icin probe atmaz, "available:false" doner.
  private readonly DAILY_BUDGET_USD: Record<string, number> = {
    anthropic: parseFloat(process.env.AI_BUDGET_ANTHROPIC_USD ?? '5'),
    gemini:    parseFloat(process.env.AI_BUDGET_GEMINI_USD    ?? '5'),  // free tier zaten
    openai:    parseFloat(process.env.AI_BUDGET_OPENAI_USD    ?? '5'),
    perplexity:parseFloat(process.env.AI_BUDGET_PERPLEXITY_USD?? '5'),
    grok:      parseFloat(process.env.AI_BUDGET_GROK_USD      ?? '3'),
    deepseek:  parseFloat(process.env.AI_BUDGET_DEEPSEEK_USD  ?? '3'),
  };

  // Approx cost per probe (input ~150 tok + output ~400 tok) — gercek fiyatlardan turetildi
  private readonly COST_PER_PROBE_USD: Record<string, number> = {
    anthropic: 0.0024, // Haiku 4.5
    gemini:    0,      // free tier yetiyor
    openai:    0.0004, // gpt-4o-mini
    perplexity:0.0006, // sonar
    grok:      0.0003, // grok-4-fast
    deepseek:  0.0006, // V3 standard
  };

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Bu gun icin provider butcesi asildi mi?
   * Asilirsa probe iptal — "available:false, reason: Bütçe asildi" doner.
   */
  private async isOverBudget(provider: string, plannedProbes: number): Promise<boolean> {
    const cap = this.DAILY_BUDGET_USD[provider];
    if (!cap) return false;
    const today = new Date().toISOString().slice(0, 10);
    const key = `ai-cost:${provider}:${today}`;

    const row = await this.prisma.kvStore.findUnique({ where: { key } }).catch(() => null);
    const spentToday = parseFloat(((row as any)?.value as string) ?? '0');
    const projected = spentToday + (this.COST_PER_PROBE_USD[provider] ?? 0) * plannedProbes;
    return projected > cap;
  }

  /**
   * Probe sonrasi bugunku harcamayi increment et.
   */
  private async addCost(provider: string, probeCount: number): Promise<void> {
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

  /**
   * Bugunku tum provider harcamalarini getir (dashboard widget icin).
   */
  async getTodayCosts(): Promise<Record<string, { spent: number; cap: number }>> {
    const today = new Date().toISOString().slice(0, 10);
    const out: Record<string, { spent: number; cap: number }> = {};
    for (const provider of Object.keys(this.DAILY_BUDGET_USD)) {
      const row = await this.prisma.kvStore.findUnique({ where: { key: `ai-cost:${provider}:${today}` } }).catch(() => null);
      const spent = parseFloat(((row as any)?.value as string) ?? '0');
      out[provider] = { spent, cap: this.DAILY_BUDGET_USD[provider] };
    }
    return out;
  }

  async runForSite(siteId: string, maxProbes = 5): Promise<CitationResult[]> {
    const site = await this.prisma.site.findUnique({
      where: { id: siteId },
      include: { brain: true },
    });
    if (!site) return [];

    const brand = site.name;
    const url = site.url;
    const seo: any = site.brain?.seoStrategy ?? {};
    const queries: string[] = [];
    if (Array.isArray(seo?.aeoQueries)) queries.push(...seo.aeoQueries);
    if (Array.isArray(seo?.geoQueries)) queries.push(...seo.geoQueries);
    if (Array.isArray(seo?.topQuestions)) queries.push(...seo.topQuestions);

    if (queries.length === 0 && site.niche) {
      queries.push(
        `${site.niche} alaninda en iyi siteler hangileri?`,
        `${site.niche} icin onerilebilecek Turkiye merkezli kaynaklar nelerdir?`,
        `${site.niche} konusunda en kapsamli rehberler nereden okunabilir?`,
      );
    }
    const probeQueries = Array.from(new Set(queries)).slice(0, maxProbes);

    // Tum saglayicilari paralel calistir — toplam suresi en yavas saglayici kadar
    const [anthropic, gemini, openai, perplexity, grok, deepseek] = await Promise.all([
      this.testAnthropic(brand, url, probeQueries),
      this.testGemini(brand, url, probeQueries),
      this.testOpenAI(brand, url, probeQueries),
      this.testPerplexity(brand, url, probeQueries),
      this.testGrok(brand, url, probeQueries),
      this.testDeepseek(brand, url, probeQueries),
    ]);

    return [anthropic, gemini, openai, perplexity, grok, deepseek];
  }

  // ────────────────────────────────────────────────────────────
  //  Ortak yardimcilar
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

  // ────────────────────────────────────────────────────────────
  //  Anthropic Claude
  // ────────────────────────────────────────────────────────────
  private async testAnthropic(brand: string, url: string, queries: string[]): Promise<CitationResult> {
    if (!this.anthropic) return this.unavailable('anthropic', 'Anthropic Claude', 'ANTHROPIC_API_KEY env yok');
    if (queries.length === 0) return this.noQueries('anthropic', 'Anthropic Claude');
    if (await this.isOverBudget('anthropic', queries.length)) return this.budgetExceeded('anthropic', 'Anthropic Claude');

    const host = this.extractHost(url);
    const probes: CitationProbe[] = [];
    for (const q of queries) {
      try {
        const resp = await this.anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 400,
          system: this.buildSystemPrompt(),
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
    await this.addCost('anthropic', probes.filter((p) => !p.excerpt?.startsWith('HATA:')).length);
    return { provider: 'anthropic', label: 'Anthropic Claude', available: true, score: this.scoreFromProbes(probes), probes };
  }

  // ────────────────────────────────────────────────────────────
  //  Google Gemini (gemini-2.5-flash text)
  // ────────────────────────────────────────────────────────────
  private async testGemini(brand: string, url: string, queries: string[]): Promise<CitationResult> {
    if (!this.gemini) return this.unavailable('gemini', 'Google Gemini', 'GOOGLE_AI_API_KEY env yok');
    if (queries.length === 0) return this.noQueries('gemini', 'Google Gemini');
    if (await this.isOverBudget('gemini', queries.length)) return this.budgetExceeded('gemini', 'Google Gemini');

    const host = this.extractHost(url);
    const probes: CitationProbe[] = [];
    const systemPrompt = this.buildSystemPrompt();

    for (const q of queries) {
      try {
        const resp = await this.gemini.models.generateContent({
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
    await this.addCost('gemini', probes.filter((p) => !p.excerpt?.startsWith('HATA:')).length);
    return { provider: 'gemini', label: 'Google Gemini', available: true, score: this.scoreFromProbes(probes), probes };
  }

  // ────────────────────────────────────────────────────────────
  //  OpenAI ChatGPT (gpt-4o-mini)
  // ────────────────────────────────────────────────────────────
  private async testOpenAI(brand: string, url: string, queries: string[]): Promise<CitationResult> {
    if (!this.openaiKey) return this.unavailable('openai', 'OpenAI ChatGPT', 'OPENAI_API_KEY env yok');
    if (queries.length === 0) return this.noQueries('openai', 'OpenAI ChatGPT');
    if (await this.isOverBudget('openai', queries.length)) return this.budgetExceeded('openai', 'OpenAI ChatGPT');

    const host = this.extractHost(url);
    const probes: CitationProbe[] = [];
    const systemPrompt = this.buildSystemPrompt();

    for (const q of queries) {
      try {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.openaiKey}`,
            'Content-Type': 'application/json',
          },
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
    await this.addCost('openai', probes.filter((p) => !p.excerpt?.startsWith('HATA:')).length);
    return { provider: 'openai', label: 'OpenAI ChatGPT', available: true, score: this.scoreFromProbes(probes), probes };
  }

  // ────────────────────────────────────────────────────────────
  //  Perplexity (web-search citations)
  // ────────────────────────────────────────────────────────────
  private async testPerplexity(brand: string, url: string, queries: string[]): Promise<CitationResult> {
    if (!this.perplexityKey) return this.unavailable('perplexity', 'Perplexity', 'PERPLEXITY_API_KEY env yok — web-search-citation testi icin onerilen kaynak');
    if (queries.length === 0) return this.noQueries('perplexity', 'Perplexity');
    if (await this.isOverBudget('perplexity', queries.length)) return this.budgetExceeded('perplexity', 'Perplexity');

    const host = this.extractHost(url);
    const probes: CitationProbe[] = [];
    const systemPrompt = this.buildSystemPrompt();

    for (const q of queries) {
      try {
        const res = await fetch('https://api.perplexity.ai/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.perplexityKey}`,
            'Content-Type': 'application/json',
          },
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
        // Perplexity citations array da varsa onlari da kontrol et
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
    await this.addCost('perplexity', probes.filter((p) => !p.excerpt?.startsWith('HATA:')).length);
    return { provider: 'perplexity', label: 'Perplexity', available: true, score: this.scoreFromProbes(probes), probes };
  }

  // ────────────────────────────────────────────────────────────
  //  xAI Grok (grok-4-fast — OpenAI-uyumlu /chat/completions)
  // ────────────────────────────────────────────────────────────
  private async testGrok(brand: string, url: string, queries: string[]): Promise<CitationResult> {
    if (!this.grokKey) return this.unavailable('grok', 'xAI Grok', 'XAI_API_KEY env yok');
    if (queries.length === 0) return this.noQueries('grok', 'xAI Grok');
    if (await this.isOverBudget('grok', queries.length)) return this.budgetExceeded('grok', 'xAI Grok');

    const host = this.extractHost(url);
    const probes: CitationProbe[] = [];
    const systemPrompt = this.buildSystemPrompt();

    for (const q of queries) {
      try {
        const res = await fetch('https://api.x.ai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.grokKey}`,
            'Content-Type': 'application/json',
          },
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
    await this.addCost('grok', probes.filter((p) => !p.excerpt?.startsWith('HATA:')).length);
    return { provider: 'grok', label: 'xAI Grok', available: true, score: this.scoreFromProbes(probes), probes };
  }

  // ────────────────────────────────────────────────────────────
  //  DeepSeek (deepseek-chat — OpenAI-uyumlu /chat/completions)
  // ────────────────────────────────────────────────────────────
  private async testDeepseek(brand: string, url: string, queries: string[]): Promise<CitationResult> {
    if (!this.deepseekKey) return this.unavailable('deepseek', 'DeepSeek', 'DEEPSEEK_API_KEY env yok');
    if (queries.length === 0) return this.noQueries('deepseek', 'DeepSeek');
    if (await this.isOverBudget('deepseek', queries.length)) return this.budgetExceeded('deepseek', 'DeepSeek');

    const host = this.extractHost(url);
    const probes: CitationProbe[] = [];
    const systemPrompt = this.buildSystemPrompt();

    for (const q of queries) {
      try {
        const res = await fetch('https://api.deepseek.com/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.deepseekKey}`,
            'Content-Type': 'application/json',
          },
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
    await this.addCost('deepseek', probes.filter((p) => !p.excerpt?.startsWith('HATA:')).length);
    return { provider: 'deepseek', label: 'DeepSeek', available: true, score: this.scoreFromProbes(probes), probes };
  }

  private noQueries(provider: string, label: string): CitationResult {
    return {
      provider, label, available: true, score: null, probes: [],
      reason: 'AEO/GEO sorgusu yok — Brain regenerate et',
    };
  }

  private unavailable(provider: string, label: string, reason: string): CitationResult {
    return { provider, label, available: false, score: null, probes: [], reason };
  }

  private budgetExceeded(provider: string, label: string): CitationResult {
    return {
      provider, label, available: false, score: null, probes: [],
      reason: `Günlük bütçe aşıldı (${this.DAILY_BUDGET_USD[provider]?.toFixed(2)} USD). 24 saat sonra tekrar dener.`,
    };
  }
}
