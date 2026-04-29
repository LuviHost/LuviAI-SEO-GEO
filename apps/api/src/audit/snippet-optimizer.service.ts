import { Injectable, Logger } from '@nestjs/common';
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
 */
@Injectable()
export class SnippetOptimizerService {
  private readonly log = new Logger(SnippetOptimizerService.name);
  private readonly anthropic = process.env.ANTHROPIC_API_KEY
    ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    : null;

  constructor(private readonly prisma: PrismaService) {}

  async optimize(articleId: string): Promise<SnippetOptimization> {
    if (!this.anthropic) throw new Error('ANTHROPIC_API_KEY yok');

    const articleRaw = await this.prisma.article.findUniqueOrThrow({ where: { id: articleId } });
    const article: any = articleRaw;
    const md = (article.bodyMd ?? '').slice(0, 8000);

    const resp = await this.anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
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
  async apply(articleId: string, optimized: SnippetOptimization['optimized']): Promise<{ ok: boolean }> {
    const article = await this.prisma.article.findUniqueOrThrow({ where: { id: articleId } });
    const md = article.bodyMd ?? '';

    // aiAnswerCard'i mevcut Hizli cevap blockquote'unun yerine koy
    let newMd = md;
    const fastAnswerRe = /^(>\s*\*\*Hızlı cevap:\*\*[\s\S]*?)(?=\n\n[^\>])/m;
    if (fastAnswerRe.test(md)) {
      newMd = md.replace(fastAnswerRe, `> **Hızlı cevap:** ${optimized.aiAnswerCard}\n`);
    } else {
      // Yoksa H1'den sonra ekle
      newMd = md.replace(/^(#\s+.+\n)/, `$1\n> **Hızlı cevap:** ${optimized.aiAnswerCard}\n\n`);
    }

    await this.prisma.article.update({
      where: { id: articleId },
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
