import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
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

/** Oneri basina bir model cagrisi (aiRefine) — controller da ayni tavani uygular */
const MAX_SUGGESTIONS = 10;

/**
 * Cross-link havuzuna giren baska siteler. Panel (geo-lab-panel CrossLinkTab)
 * kullaniciya "Sadece Otopilot ON olan siteler dahil edilir (onay)" diyor;
 * eskiden otopilot yalnizca siralamada +10 puandi, otopilotu KAPALI sitelerin
 * makaleleri ve site adlari da baska musterilere oneriliyordu. Kural artik
 * sorguda: oneride de, uygulamada da ayni kosul.
 */
const CANDIDATE_SITE_WHERE = {
  status: { in: ['ACTIVE', 'AUDIT_COMPLETE'] as any[] },
  autopilot: true,
};

/** Markdown satirina girecek serbest metin: tek satir, koseli parantez ve HTML acisi yok */
function inlineText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\r\n]+/g, ' ').replace(/[[\]<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * Cross-Linking — RanksUp ekosistemindeki sitelerin makalelerini akilli bir
 * sekilde birbirine baglar. Sadece OPT-IN siteler dahil edilir (otopilot
 * acik — CANDIDATE_SITE_WHERE).
 *
 * Calisma:
 *   1. Tum opted-in sitelerin published makalelerini topla
 *   2. Her cift icin: AI ile semantic relevance hesapla
 *   3. Score >= 50 olanlar icin cross-link onerisi uret
 *   4. Manuel onaydan sonra makalenin "Ayrica bakiniz" bolumune eklenir
 *
 * KIRACI KAPSAMI: kaynak makale her zaman findFirst({ id, siteId }) ile
 * okunur. Controller ayrica kontrol ediyor (assertArticleInSite); servis de
 * kendini korur — kimligi siteyle sinirlamayan bir cagiran baska musterinin
 * makalesini okutup govdesine yazdiramasin.
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
  async suggestForArticle(siteId: string, articleId: string, opts: { limit?: number } = {}): Promise<CrossLinkSuggestion[]> {
    const rawLimit = typeof opts.limit === 'number' && Number.isFinite(opts.limit) ? Math.trunc(opts.limit) : 5;
    const limit = Math.min(Math.max(rawLimit, 1), MAX_SUGGESTIONS);
    if (!siteId || !articleId) throw new NotFoundException('Makale bulunamadı.');
    const article: any = await this.prisma.article.findFirst({ where: { id: articleId, siteId } });
    if (!article) throw new NotFoundException('Makale bulunamadı.');

    const sourceSite: any = await this.prisma.site.findUnique({
      where: { id: siteId },
      select: { url: true, niche: true },
    });
    if (!sourceSite) throw new NotFoundException('Site bulunamadı.');

    // Kendi sitesi olmayan, yayinda ve cross-link'e acik (otopilot) siteler
    const candidateArticles = await this.prisma.article.findMany({
      where: {
        siteId: { not: siteId },
        status: 'PUBLISHED' as any,
        site: CANDIDATE_SITE_WHERE,
      },
      // Yalniz gereken site alanlari: tam satir sirlari (token'lar) bellege tasirdi
      include: { site: { select: { name: true, url: true, niche: true } } },
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
      // Otopilot eskiden +10 puandi; artik havuzdaki her site otopilotlu
      const score = overlap * 60 + (sameNiche ? 20 : 0);
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
   *
   * Oneri nesnesi istemciden geri gelir; yalniz kimlikler ve iki serbest
   * metin (baglanti metni, baglam) kullanilir. Hedef ADRES istemcinin
   * gonderdigi toArticleUrl'den DEGIL, kayitli hedef makaleden kurulur:
   * eskiden makaleye istenen herhangi bir adres (javascript: dahil)
   * yazilabiliyordu ve hedefin hala yayinda / paylasima acik olup olmadigina
   * bakilmiyordu.
   */
  async applyLinkSuggestion(
    siteId: string,
    suggestion: Partial<CrossLinkSuggestion> | Record<string, unknown>,
  ): Promise<{ ok: boolean; error?: string; toArticleUrl?: string }> {
    const s = (suggestion ?? {}) as Record<string, unknown>;
    const fromId = typeof s.fromArticleId === 'string' ? s.fromArticleId : '';
    const toId = typeof s.toArticleId === 'string' ? s.toArticleId : '';
    if (!fromId || !toId) {
      throw new BadRequestException('Öneride kaynak ve hedef makale kimliği (fromArticleId, toArticleId) gerekli.');
    }

    if (!siteId) throw new NotFoundException('Makale bulunamadı.');
    const article = await this.prisma.article.findFirst({ where: { id: fromId, siteId } });
    if (!article) throw new NotFoundException('Makale bulunamadı.');

    const target = await this.prisma.article.findFirst({
      where: { id: toId, siteId: { not: siteId }, status: 'PUBLISHED' as any, site: CANDIDATE_SITE_WHERE },
      select: { title: true, slug: true, site: { select: { url: true } } },
    });
    if (!target) {
      throw new BadRequestException('Hedef makale artık önerilemiyor: yayından kalkmış ya da sitesi çapraz bağlantıya kapalı.');
    }
    const toUrl = `${target.site.url.replace(/\/+$/, '')}/blog/${target.slug}.html`;
    const anchor = inlineText(s.anchorText, 120) || inlineText(target.title, 60);
    const context = inlineText(s.contextSnippet, 300);

    const md = article.bodyMd ?? '';

    // "Ayrica bakiniz" bolumu var mi?
    let newMd = md;
    const linkLine = `- [${anchor}](${toUrl})${context ? ` — ${context}` : ''}`;

    if (/##\s*Ayrıca\s*bakınız/i.test(md) || /##\s*Ayrica\s*bakiniz/i.test(md)) {
      // Mevcut bolume ekle. Degistirme FONKSIYONLA: metindeki "$1"/"$&" kaliplari
      // dize degistirmede ozel anlam tasir ve satiri bozardi.
      newMd = md.replace(/(##\s*Ayr[ıi]ca\s*bak[ıi]n[ıi]z\s*\n)/i, (_m, heading: string) => `${heading}${linkLine}\n`);
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
      where: { id: article.id },
      data: { bodyMd: newMd },
    });

    return { ok: true, toArticleUrl: toUrl };
  }

  // ────────────────────────────────────────────────────────────
  //  AI relevance refine
  // ────────────────────────────────────────────────────────────
  private async aiRefine(source: any, target: any): Promise<{ relevance: number; anchor: string; context: string; insertionPoint: string } | null> {
    if (!this.anthropic) return null;
    try {
      const resp = await this.anthropic.messages.create({
        model: 'claude-opus-5',
        max_tokens: 4000,
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
