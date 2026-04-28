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

  constructor(private readonly prisma: PrismaService) {}

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
    const [anthropic, gemini, openai, perplexity] = await Promise.all([
      this.testAnthropic(brand, url, probeQueries),
      this.testGemini(brand, url, probeQueries),
      this.testOpenAI(brand, url, probeQueries),
      this.testPerplexity(brand, url, probeQueries),
    ]);

    return [
      anthropic,
      gemini,
      openai,
      perplexity,
      this.unavailable('grok', 'xAI Grok', 'XAI_API_KEY env yok'),
      this.unavailable('deepseek', 'DeepSeek', 'DEEPSEEK_API_KEY env yok'),
    ];
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
    return { provider: 'anthropic', label: 'Anthropic Claude', available: true, score: this.scoreFromProbes(probes), probes };
  }

  // ────────────────────────────────────────────────────────────
  //  Google Gemini (gemini-2.5-flash text)
  // ────────────────────────────────────────────────────────────
  private async testGemini(brand: string, url: string, queries: string[]): Promise<CitationResult> {
    if (!this.gemini) return this.unavailable('gemini', 'Google Gemini', 'GOOGLE_AI_API_KEY env yok');
    if (queries.length === 0) return this.noQueries('gemini', 'Google Gemini');

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
    return { provider: 'gemini', label: 'Google Gemini', available: true, score: this.scoreFromProbes(probes), probes };
  }

  // ────────────────────────────────────────────────────────────
  //  OpenAI ChatGPT (gpt-4o-mini)
  // ────────────────────────────────────────────────────────────
  private async testOpenAI(brand: string, url: string, queries: string[]): Promise<CitationResult> {
    if (!this.openaiKey) return this.unavailable('openai', 'OpenAI ChatGPT', 'OPENAI_API_KEY env yok');
    if (queries.length === 0) return this.noQueries('openai', 'OpenAI ChatGPT');

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
    return { provider: 'openai', label: 'OpenAI ChatGPT', available: true, score: this.scoreFromProbes(probes), probes };
  }

  // ────────────────────────────────────────────────────────────
  //  Perplexity (web-search citations)
  // ────────────────────────────────────────────────────────────
  private async testPerplexity(brand: string, url: string, queries: string[]): Promise<CitationResult> {
    if (!this.perplexityKey) return this.unavailable('perplexity', 'Perplexity', 'PERPLEXITY_API_KEY env yok — web-search-citation testi icin onerilen kaynak');
    if (queries.length === 0) return this.noQueries('perplexity', 'Perplexity');

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
    return { provider: 'perplexity', label: 'Perplexity', available: true, score: this.scoreFromProbes(probes), probes };
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
}
