import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../prisma/prisma.service.js';

export interface TranslationResult {
  ok: boolean;
  translatedArticleId?: string;
  fromLanguage: string;
  toLanguage: string;
  bytes?: number;
  error?: string;
}

/**
 * Translator — bir makaleyi farkli dile cevirir, yeni Article kaydi olusturur.
 *
 * Anthropic Sonnet 4.6 ile high-quality cevir:
 *   - Markdown yapisi korunur (#, ##, **, blockquote, table)
 *   - Frontmatter ceviri yapilir (title, meta_title, meta_description)
 *   - Internal link'ler hedef dilin slug'ina cevrilmek istenirse mapping
 *   - Hreflang otomatik baglanir
 *
 * Hedefler: en, de, fr, ar, es, ru
 */
@Injectable()
export class TranslatorService {
  private readonly log = new Logger(TranslatorService.name);
  private readonly anthropic = process.env.ANTHROPIC_API_KEY
    ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    : null;

  constructor(private readonly prisma: PrismaService) {}

  async translate(articleId: string, toLanguage: string): Promise<TranslationResult> {
    if (!this.anthropic) {
      return { ok: false, fromLanguage: '', toLanguage, error: 'ANTHROPIC_API_KEY yok' };
    }

    const articleRaw = await this.prisma.article.findUniqueOrThrow({ where: { id: articleId } });
    const article: any = articleRaw;
    const fromLanguage = article.language ?? 'tr';

    if (fromLanguage === toLanguage) {
      return { ok: false, fromLanguage, toLanguage, error: 'Ayni dil' };
    }

    const langName = ({
      en: 'English', de: 'German', fr: 'French',
      ar: 'Arabic', es: 'Spanish', ru: 'Russian', tr: 'Turkish',
    } as any)[toLanguage] ?? toLanguage;

    try {
      const md = (article.bodyMd ?? '').slice(0, 50000);
      const resp = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 8000,
        system: `Sen profesyonel ceviri uzmanisin. Markdown formatini KORU (#, ##, **, blockquote, tables, lists). Frontmatter (--- arasindaki YAML) icindeki value'lari cevir, key'leri DEGISTIRME. SEO meta_title ve meta_description native ${langName} okuyucu icin yeniden yaz, kelime kelime ceviri yapma. Internal link URL'lerini AYNEN birak.`,
        messages: [{
          role: 'user',
          content: `Cevir: ${fromLanguage} -> ${langName}\n\nMakale:\n\n${md}`,
        }],
      });

      const translatedMd = resp.content
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('\n');

      // Yeni slug — orijinal slug + dil prefix
      const newSlug = `${toLanguage}-${article.slug}`.slice(0, 60);

      // Frontmatter parse
      const fmMatch = translatedMd.match(/^---\n([\s\S]*?)\n---/);
      const newTitle = fmMatch?.[1]?.match(/^title:\s*"?(.+?)"?$/m)?.[1] ?? article.title;
      const newMetaTitle = fmMatch?.[1]?.match(/^meta_title:\s*"?(.+?)"?$/m)?.[1] ?? null;
      const newMetaDesc = fmMatch?.[1]?.match(/^meta_description:\s*"?(.+?)"?$/m)?.[1] ?? null;

      const newArticle = await this.prisma.article.create({
        data: {
          siteId: article.siteId,
          topic: article.topic,
          slug: newSlug,
          title: newTitle,
          metaTitle: newMetaTitle,
          metaDescription: newMetaDesc,
          category: article.category,
          language: toLanguage,
          persona: article.persona,
          pillar: article.pillar,
          bodyMd: translatedMd,
          frontmatter: { ...(article.frontmatter ?? {}), translated_from: articleId, language: toLanguage } as any,
          schemaMarkup: article.schemaMarkup,
          status: 'READY_TO_PUBLISH' as any,
          editorScore: article.editorScore,
          editorVerdict: article.editorVerdict,
          totalCost: 0.05,
        },
      });

      this.log.log(`[${article.id}] Translated to ${toLanguage}: ${newArticle.id}`);
      return {
        ok: true,
        translatedArticleId: newArticle.id,
        fromLanguage,
        toLanguage,
        bytes: translatedMd.length,
      };
    } catch (err: any) {
      this.log.error(`Translate fail: ${err.message}`);
      return { ok: false, fromLanguage, toLanguage, error: err.message };
    }
  }

  /**
   * Site icin tum eligible makaleleri secili dillere bulk cevir (otopilot).
   */
  async bulkTranslateSite(siteId: string, languages: string[]): Promise<{ scheduled: number; results: any[] }> {
    const articles = await this.prisma.article.findMany({
      where: { siteId, status: 'PUBLISHED' as any, language: 'tr' as any },
      orderBy: { publishedAt: 'desc' },
      take: 20,
    });

    const results: any[] = [];
    for (const a of articles) {
      for (const lang of languages) {
        // Zaten cevirisi var mi?
        const existing = await this.prisma.article.findFirst({
          where: { siteId, language: lang, frontmatter: { path: ['translated_from'], equals: a.id } as any },
        });
        if (existing) continue;

        const r = await this.translate(a.id, lang);
        results.push({ articleId: a.id, ...r });
      }
    }

    return { scheduled: results.filter((r) => r.ok).length, results };
  }
}
