import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
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

    const results: CitationResult[] = [];
    results.push(await this.testAnthropic(brand, url, probeQueries));
    results.push(this.unavailable('openai', 'OpenAI ChatGPT', 'OPENAI_API_KEY env yok'));
    results.push(this.unavailable('perplexity', 'Perplexity', 'PERPLEXITY_API_KEY env yok — web-search-citation testi icin onerilen kaynak'));
    results.push(this.unavailable('gemini', 'Google Gemini', 'GEMINI_API_KEY env yok'));
    results.push(this.unavailable('grok', 'xAI Grok', 'XAI_API_KEY env yok'));
    results.push(this.unavailable('deepseek', 'DeepSeek', 'DEEPSEEK_API_KEY env yok'));
    return results;
  }

  private async testAnthropic(brand: string, url: string, queries: string[]): Promise<CitationResult> {
    if (!this.anthropic) {
      return this.unavailable('anthropic', 'Anthropic Claude', 'ANTHROPIC_API_KEY env yok');
    }
    if (queries.length === 0) {
      return {
        provider: 'anthropic',
        label: 'Anthropic Claude',
        available: true,
        score: null,
        probes: [],
        reason: 'AEO/GEO sorgusu yok — Brain regenerate et',
      };
    }

    const host = (() => {
      try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); }
      catch { return url.toLowerCase(); }
    })();
    const brandLower = brand.toLowerCase();

    const probes: CitationProbe[] = [];
    for (const q of queries) {
      try {
        const resp = await this.anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 400,
          system: 'Kullanicinin sorusuna kisa ve dogrudan cevap ver. Tanidigin Turkiye kaynaklarini, web sitelerini ve markalari ismiyle ve URL siyle birlikte belirt. Bilmiyorsan acikca soyle.',
          messages: [{ role: 'user', content: q }],
        });
        const text = resp.content
          .filter((b: any) => b.type === 'text')
          .map((b: any) => b.text)
          .join(' ');
        const lower = text.toLowerCase();
        probes.push({
          query: q,
          cited: lower.includes(host),
          brandMentioned: lower.includes(brandLower),
          excerpt: text.slice(0, 220),
        });
      } catch (err: any) {
        this.log.warn(`Anthropic probe failed (${q}): ${err.message}`);
        probes.push({ query: q, cited: false, brandMentioned: false, excerpt: `HATA: ${err.message}` });
      }
    }

    const citedCount = probes.filter(p => p.cited).length;
    const mentionedCount = probes.filter(p => p.brandMentioned && !p.cited).length;
    const score = probes.length === 0
      ? null
      : Math.round(((citedCount * 100) + (mentionedCount * 50)) / probes.length);
    return { provider: 'anthropic', label: 'Anthropic Claude', available: true, score, probes };
  }

  private unavailable(provider: string, label: string, reason: string): CitationResult {
    return { provider, label, available: false, score: null, probes: [], reason };
  }
}
