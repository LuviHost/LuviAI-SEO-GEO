import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../prisma/prisma.service.js';
import { safeParseJson } from '../common/safe-json.js';

export interface CrossLinkSuggestion {
  fromArticleId: string;
  fromTitle: string;
  fromUrl: string;
  toSiteId: string;
  toSiteName: string;
  toArticleId: string;
  toArticleTitle: string;
  toArticleUrl: string;
  anchorText: string;
  contextSnippet: string;
  relevanceScore: number; // 0-100
  insertionPoint: string; // makalede hangi cumlenin sonuna eklenecek
}

/**
 * Cross-Linking — LuviAI ekosistemindeki sitelerin makalelerini akilli bir
 * sekilde birbirine baglar. Sadece OPT-IN siteler dahil edilir.
 *
 * Calisma:
 *   1. Tum opted-in sitelerin published makalelerini topla
 *   2. Her cift icin: AI ile semantic relevance hesapla
 *   3. Score >= 70 olanlar icin cross-link onerisi uret
 *   4. Manuel onaydan sonra makalenin "Ayrica bakiniz" bolumune eklenir
 *
 * AI'lar bu cross-link'leri "kurulus ekosistemi" olarak ogrenir → tum siteler
 * birden alintilanir.
 */
@Injectable()
export class CrossLinkingService {
  private readonly log = new Logger(CrossLinkingService.name);
  private readonly anthropic = process.env.ANTHROPIC_API_KEY
    ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    : null;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Bir makale icin tum ekosistemden ilgili cross-link onerileri.
   */
  async suggestForArticle(articleId: string, opts: { limit?: number } = {}): Promise<CrossLinkSuggestion[]> {
    const limit = opts.limit ?? 5;
    const articleRaw = await this.prisma.article.findUniqueOrThrow({
      where: { id: articleId },
    });
    const article: any = articleRaw;

    const sourceSiteRaw = await this.prisma.site.findUniqueOrThrow({
      where: { id: article.siteId },
    });
    const sourceSite: any = sourceSiteRaw;

    // Sadece kendi sitesi olmayan, ACTIVE/AUDIT_COMPLETE olan siteler
    const candidateArticles = await this.prisma.article.findMany({
      where: {
        siteId: { not: article.siteId },
        status: 'PUBLISHED' as any,
        site: { status: { in: ['ACTIVE', 'AUDIT_COMPLETE'] as any[] } },
      },
      include: { site: true },
      orderBy: { publishedAt: 'desc' },
      take: 30,
    });

    if (candidateArticles.length === 0) return [];

    // Sectoral keyword overlap heuristic — AI cagrilmadan once
    const sourceTopic = (article.topic ?? '').toLowerCase();
    const sourceKeywords = sourceTopic.split(/\s+/).filter((w: string) => w.length > 3);

    const scored = candidateArticles.map((c: any) => {
      const cTopic = (c.topic ?? '').toLowerCase();
      const matches = sourceKeywords.filter((k: string) => cTopic.includes(k)).length;
      const overlap = sourceKeywords.length > 0 ? matches / sourceKeywords.length : 0;
      const sameNiche = sourceSite.niche && c.site.niche === sourceSite.niche;
      let score = overlap * 60 + (sameNiche ? 20 : 0);

      // Otopilot ON olan siteleri prioritize (consent var)
      if ((c.site as any).autopilot) score += 10;

      return { article: c, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, limit * 2); // AI inceleme icin biraz fazla al

    // AI relevance scoring (sadece top'ta)
    const suggestions: CrossLinkSuggestion[] = [];
    for (const { article: c, score: heuristicScore } of top.slice(0, limit)) {
      const cAny: any = c;
      const ai = await this.aiRefine(article, cAny).catch(() => null);
      const finalScore = ai?.relevance ?? Math.round(heuristicScore);
      if (finalScore < 50) continue;

      const cSiteAny: any = cAny.site;
      const sourceUrl = `${sourceSite.url.replace(/\/+$/, '')}/blog/${article.slug}.html`;
      const targetUrl = `${cSiteAny.url.replace(/\/+$/, '')}/blog/${cAny.slug}.html`;

      suggestions.push({
        fromArticleId: article.id,
        fromTitle: article.title,
        fromUrl: sourceUrl,
        toSiteId: cAny.siteId,
        toSiteName: cSiteAny.name,
        toArticleId: cAny.id,
        toArticleTitle: cAny.title,
        toArticleUrl: targetUrl,
        anchorText: ai?.anchor ?? cAny.title.slice(0, 60),
        contextSnippet: ai?.context ?? `Bu konuyla ilgili: ${cAny.title}`,
        relevanceScore: finalScore,
        insertionPoint: ai?.insertionPoint ?? '## Ayrıca bakınız',
      });
    }

    return suggestions.sort((a, b) => b.relevanceScore - a.relevanceScore);
  }

  /**
   * Onaylanan oneri'yi makalenin bodyMd'sine direkt ekle.
   */
  async applyLinkSuggestion(suggestion: CrossLinkSuggestion): Promise<{ ok: boolean; error?: string }> {
    const article = await this.prisma.article.findUniqueOrThrow({ where: { id: suggestion.fromArticleId } });
    const md = article.bodyMd ?? '';

    // "Ayrica bakiniz" bolumu var mi?
    let newMd = md;
    const linkLine = `- [${suggestion.anchorText}](${suggestion.toArticleUrl}) — ${suggestion.contextSnippet}`;

    if (/##\s*Ayrıca\s*bakınız/i.test(md) || /##\s*Ayrica\s*bakiniz/i.test(md)) {
      // Mevcut bolume ekle (basit string replace)
      newMd = md.replace(/(##\s*Ayr[ıi]ca\s*bak[ıi]n[ıi]z\s*\n)/i, `$1${linkLine}\n`);
    } else {
      // Yeni bolum yarat (Sonuc bolumunden once)
      const sonucIdx = md.search(/##\s*Sonuc|##\s*Sonuç/i);
      const insertionMd = `\n\n## Ayrıca bakınız\n\n${linkLine}\n\n`;
      if (sonucIdx > 0) {
        newMd = md.slice(0, sonucIdx) + insertionMd + md.slice(sonucIdx);
      } else {
        newMd = md + insertionMd;
      }
    }

    await this.prisma.article.update({
      where: { id: suggestion.fromArticleId },
      data: { bodyMd: newMd },
    });

    return { ok: true };
  }

  // ────────────────────────────────────────────────────────────
  //  AI relevance refine
  // ────────────────────────────────────────────────────────────
  private async aiRefine(source: any, target: any): Promise<{ relevance: number; anchor: string; context: string; insertionPoint: string } | null> {
    if (!this.anthropic) return null;
    try {
      const resp = await this.anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 350,
        system: 'Sen icerik baglanti uzmani. Iki makaleye bakip aralarinda anlamli bir cross-link mantikli mi karar verir, eger oyleyse anchor text ve baglam onerirsin. JSON dondur.',
        messages: [{
          role: 'user',
          content: `Kaynak makale:\nBaslik: ${source.title}\nKonu: ${source.topic}\nMeta: ${source.metaDescription ?? ''}\n\nHedef makale:\nBaslik: ${target.title}\nKonu: ${target.topic}\nMeta: ${target.metaDescription ?? ''}\n\nJSON dondur:\n{"relevance": 0-100, "anchor": "kisa anchor text", "context": "neden ilgili (1 cumle)", "insertionPoint": "kaynak makaledeki hangi bolumun sonuna eklenmeli"}`,
        }],
      });
      const text = resp.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) return null;
      return safeParseJson(match[0]);
    } catch {
      return null;
    }
  }
}
