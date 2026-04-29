import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../prisma/prisma.service.js';

export interface OutreachOpportunity {
  source: 'reddit' | 'quora' | 'haro' | 'twitter';
  url: string;
  title: string;
  snippet: string;
  publishedAt?: string;
  subreddit?: string;
  draftReply: string;        // AI uretimi taslak (manuel onay zorunlu)
  brandFitScore: number;     // 0-100
  sourceLink?: string;       // marka URL'i taslakta yer aliyor mu
}

/**
 * Community Outreach — Reddit, Quora ve HARO'da sektorle ilgili sorulari
 * tespit edip markanin sesinde taslak cevap onerir. Kullanici manuel onaylar,
 * tek tikla post eder. Spam degil, gercek deger.
 *
 * Reddit: oauth2 + /search.json
 * Quora: scrape (resmi API yok)
 * HARO: email forward yapilirsa parse edilir (email-based, MVP'de placeholder)
 */
@Injectable()
export class CommunityOutreachService {
  private readonly log = new Logger(CommunityOutreachService.name);
  private readonly anthropic = process.env.ANTHROPIC_API_KEY
    ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    : null;

  constructor(private readonly prisma: PrismaService) {}

  async findOpportunities(siteId: string, opts: { limit?: number } = {}): Promise<OutreachOpportunity[]> {
    const limit = opts.limit ?? 10;
    const site = await this.prisma.site.findUniqueOrThrow({
      where: { id: siteId },
      include: { brain: true },
    });

    const seo: any = site.brain?.seoStrategy ?? {};
    const queries: string[] = [
      ...(Array.isArray(seo.aeoQueries) ? seo.aeoQueries : []),
      ...(Array.isArray(seo.geoQueries) ? seo.geoQueries : []),
    ].slice(0, 5);

    if (queries.length === 0 && site.niche) {
      queries.push(`${site.niche} öneri`, `${site.niche} hangisi`, `${site.niche} nasil secilir`);
    }

    const opportunities: OutreachOpportunity[] = [];

    // Reddit — public JSON search (subreddit yok, genel)
    for (const q of queries) {
      try {
        const redditOps = await this.searchReddit(q);
        opportunities.push(...redditOps);
      } catch (err: any) {
        this.log.warn(`Reddit search fail (${q}): ${err.message}`);
      }
    }

    // Brand fit + AI taslak
    const final: OutreachOpportunity[] = [];
    for (const op of opportunities.slice(0, limit)) {
      const fit = this.scoreBrandFit(op, site);
      const draft = await this.generateReply(op, site);
      final.push({ ...op, brandFitScore: fit, draftReply: draft, sourceLink: site.url });
    }

    return final.sort((a, b) => b.brandFitScore - a.brandFitScore);
  }

  // ────────────────────────────────────────────────────────────
  //  Reddit search (public JSON, no auth required)
  // ────────────────────────────────────────────────────────────
  private async searchReddit(query: string): Promise<OutreachOpportunity[]> {
    const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&sort=new&t=month&limit=5`;
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'LuviAI-Outreach/1.0 (https://ai.luvihost.com)' },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return [];
      const data = await res.json() as any;
      const posts = data?.data?.children ?? [];
      return posts
        .filter((p: any) => p?.data?.is_self || p?.data?.is_video === false)
        .filter((p: any) => p?.data?.title?.includes('?') || p?.data?.title?.toLowerCase().includes('öner'))
        .map((p: any) => ({
          source: 'reddit' as const,
          url: `https://reddit.com${p.data.permalink}`,
          title: p.data.title,
          snippet: (p.data.selftext ?? '').slice(0, 300),
          publishedAt: new Date(p.data.created_utc * 1000).toISOString(),
          subreddit: p.data.subreddit,
          draftReply: '',
          brandFitScore: 0,
        }));
    } catch {
      return [];
    }
  }

  // ────────────────────────────────────────────────────────────
  //  Brand fit scoring
  // ────────────────────────────────────────────────────────────
  private scoreBrandFit(op: OutreachOpportunity, site: any): number {
    let score = 50;
    const text = `${op.title} ${op.snippet}`.toLowerCase();
    const niche = (site.niche ?? '').toLowerCase();
    if (niche && text.includes(niche)) score += 20;
    if (text.includes('öneri') || text.includes('hangi')) score += 15;
    if (op.snippet.length > 100) score += 10;
    if (op.subreddit && /turkey|turkce|tr_|turki/i.test(op.subreddit)) score += 5;
    return Math.min(100, score);
  }

  // ────────────────────────────────────────────────────────────
  //  AI reply draft
  // ────────────────────────────────────────────────────────────
  private async generateReply(op: OutreachOpportunity, site: any): Promise<string> {
    if (!this.anthropic) {
      return `[AI cevap olusturmak icin ANTHROPIC_API_KEY gerekli]\n\n${site.name} olarak bu konuyu ele alabilecegim bir blog yazimiz var: ${site.url}`;
    }
    try {
      const brand: any = site.brain?.brandVoice ?? {};
      const systemPrompt = `Sen ${site.name} markasinin temsilcisisin. ${site.niche ?? 'sektor'} alaninda calisiyorsun. Reddit/Quora'da gercek deger katacak, samimi, spam olmayan cevaplar yazarsin. ASLA reklam yapma. Kullanicinin sorusuna once gercek cevap ver, sonra DOGAL bir bicimde markanizdan link verirsen ver. Marka tonu: ${brand.tone ?? 'profesyonel ama samimi'}. Cevap maksimum 150 kelime.`;

      const resp = await this.anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: `Reddit baslik: ${op.title}\n\nIcerik: ${op.snippet}\n\nSubreddit: r/${op.subreddit ?? 'unknown'}\n\nMarkamiz: ${site.name} (${site.url})\n\nGercek deger katacak, samimi bir cevap taslagi yaz. Spam degil, gercek bilgi.`,
        }],
      });
      return resp.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
    } catch (err: any) {
      return `[AI fail: ${err.message}]`;
    }
  }
}
