import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../prisma/prisma.service.js';
import { safeParseJson } from '../common/safe-json.js';

export interface SnippetOptimization {
  articleId: string;
  currentSnippet: string;
  optimized: {
    metaTitle: string;
    metaDescription: string;
    aiAnswerCard: string;        // 60-80 kelime, AI'in alintilamasi icin optimize
    questionVariants: string[];  // 5 farkli soru formati (AEO icin)
  };
  reasoning: string;
}

/**
 * Snippet Optimizer — bir makalenin meta+ozet+ilk paragrafini AI cevap
 * kutucuklarinda gorunecek sekilde optimize eder.
 *
 * Strateji:
 *   - meta_title: <60 char, sorulu format
 *   - meta_description: <155 char, ilk cumle dogrudan cevap
 *   - aiAnswerCard: <80 kelime, blockquote'a uygun, AI alintilanma icin
 *   - questionVariants: AEO sorgu varyasyonlari (people also ask formati)
 *
 * KIRACI KAPSAMI: her metot siteId alir ve makaleyi findFirst({ id, siteId })
 * ile okur. Controller ayrica kontrol ediyor (assertArticleInSite); servis de
 * kendini korur ki baska bir cagiran (MCP, worker) kimligi siteyle
 * sinirlamayi unuttugunda baska musterinin makalesi okunup yazilamasin.
 */
@Injectable()
export class SnippetOptimizerService {
  private readonly log = new Logger(SnippetOptimizerService.name);
  private readonly anthropic = process.env.ANTHROPIC_API_KEY
    ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    : null;

  constructor(private readonly prisma: PrismaService) {}

  /** Makale bu siteye ait degilse 404 — kimligin baska sitede var olup olmadigi sizmaz */
  private async requireArticle(siteId: string, articleId: string) {
    if (!siteId || !articleId) throw new NotFoundException('Makale bulunamadı.');
    const article = await this.prisma.article.findFirst({ where: { id: articleId, siteId } });
    if (!article) throw new NotFoundException('Makale bulunamadı.');
    return article;
  }

  async optimize(siteId: string, articleId: string): Promise<SnippetOptimization> {
    // Anahtar yokken duz Error 500 donuyordu; durum gecici ve dogrusu 503
    if (!this.anthropic) throw new ServiceUnavailableException('AI servisi şu anda kullanılamıyor.');

    const article: any = await this.requireArticle(siteId, articleId);
    const md = (article.bodyMd ?? '').slice(0, 8000);

    const resp = await this.anthropic.messages.create({
      model: 'claude-opus-5',
      max_tokens: 4000,
      system: 'Sen AI search engine optimization uzmanisin. Bir makalenin meta+snippet alanlarini AI cevap kutucuklarinda (Google AI Overviews, ChatGPT, Perplexity) gorunecek sekilde optimize edersin. JSON dondur, baska aciklama yok.',
      messages: [{
        role: 'user',
        content: `Makale:\nBaslik: ${article.title}\nMevcut meta_title: ${article.metaTitle ?? '(yok)'}\nMevcut meta_description: ${article.metaDescription ?? '(yok)'}\n\nIcerik (ilk 8K):\n${md}\n\nJSON dondur:\n{\n  "metaTitle": "<60 char, soru formati tercihen>",\n  "metaDescription": "<155 char, ilk cumle dogrudan cevap>",\n  "aiAnswerCard": "<60-80 kelime, blockquote'a yapistirmaya uygun, AI'in tam metni alintilamasi icin atomik bilgi>",\n  "questionVariants": ["soru 1", "soru 2", "soru 3", "soru 4", "soru 5"],\n  "reasoning": "kisa aciklama"\n}`,
      }],
    });

    const text = resp.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('JSON parse fail');
    const parsed = safeParseJson(match[0]);

    return {
      articleId,
      currentSnippet: article.metaDescription ?? '',
      optimized: {
        metaTitle: parsed.metaTitle ?? '',
        metaDescription: parsed.metaDescription ?? '',
        aiAnswerCard: parsed.aiAnswerCard ?? '',
        questionVariants: parsed.questionVariants ?? [],
      },
      reasoning: parsed.reasoning ?? '',
    };
  }

  /**
   * Onerileri uygula: makaleye yeni meta + ilk paragrafa aiAnswerCard
   * blockquote ekler.
   */
  async apply(siteId: string, articleId: string, optimized: SnippetOptimization['optimized']): Promise<{ ok: boolean }> {
    // Alanlar istemciden gelir (optimize cevabinin geri gonderilmesi): dize
    // olmayan deger Prisma'da 500, frontmatter'a da keyfi JSON demekti.
    if (
      !optimized || typeof optimized !== 'object'
      || typeof optimized.metaTitle !== 'string'
      || typeof optimized.metaDescription !== 'string'
      || typeof optimized.aiAnswerCard !== 'string'
      || !Array.isArray(optimized.questionVariants)
      || !optimized.questionVariants.every((q) => typeof q === 'string')
    ) {
      throw new BadRequestException('Uygulanacak öneri eksik ya da hatalı (metaTitle, metaDescription, aiAnswerCard, questionVariants).');
    }
    const article = await this.requireArticle(siteId, articleId);
    const md = article.bodyMd ?? '';

    // aiAnswerCard'i mevcut Hizli cevap blockquote'unun yerine koy.
    // Degistirme FONKSIYONLA: dize verilince metindeki "$1", "$&" kaliplari
    // ozel anlam tasir — "fiyati $10" gibi bir cumle H1 satirini metne kopyalardi.
    let newMd = md;
    const card = optimized.aiAnswerCard;
    const fastAnswerRe = /^(>\s*\*\*Hızlı cevap:\*\*[\s\S]*?)(?=\n\n[^>])/m;
    if (fastAnswerRe.test(md)) {
      newMd = md.replace(fastAnswerRe, () => `> **Hızlı cevap:** ${card}\n`);
    } else {
      // Yoksa H1'den sonra ekle
      newMd = md.replace(/^(#\s+.+\n)/, (_m, h1: string) => `${h1}\n> **Hızlı cevap:** ${card}\n\n`);
    }

    await this.prisma.article.update({
      where: { id: article.id },
      data: {
        metaTitle: optimized.metaTitle,
        metaDescription: optimized.metaDescription,
        bodyMd: newMd,
        // Frontmatter'a aeo_queries ekle
        frontmatter: {
          ...((article.frontmatter as any) ?? {}),
          aeo_queries: optimized.questionVariants,
          ai_optimized_at: new Date().toISOString(),
        } as any,
      },
    });

    return { ok: true };
  }
}
