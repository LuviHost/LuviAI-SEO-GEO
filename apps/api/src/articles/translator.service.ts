import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../prisma/prisma.service.js';
import { TRANSLATION_LANGUAGES } from './articles.dto.js';

export interface TranslationResult {
  ok: boolean;
  translatedArticleId?: string;
  fromLanguage: string;
  toLanguage: string;
  bytes?: number;
  error?: string;
}

type TranslationLanguage = (typeof TRANSLATION_LANGUAGES)[number];

/**
 * Hedef dil izin listesi — articles.dto TranslateArticleDto ile AYNI kaynak.
 * Record tipi: DTO'ya dil eklenip burasi unutulursa derleme hatasi. Eskiden
 * bilinmeyen kod "?? toLanguage" ile dogrudan istem metnine giriyordu; servis
 * artik DTO'dan bagimsiz olarak da reddeder (bulk ve ileride eklenecek
 * cagiranlar icin).
 */
const LANG_NAMES: Record<TranslationLanguage, string> = {
  en: 'English', de: 'German', fr: 'French',
  ar: 'Arabic', es: 'Spanish', ru: 'Russian', tr: 'Turkish',
};

function isTranslationLanguage(v: unknown): v is TranslationLanguage {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(LANG_NAMES, v);
}

/**
 * Ceviri kaydinin kaynagi frontmatter.translated_from'da. MySQL'de Prisma
 * JSON yolu `$` ile baslayan TEK bir dizedir; dizi bicimi (path: ['x'])
 * yalniz PostgreSQL icindir ("MySQL ... path: "$.petName"" —
 * https://www.prisma.io/docs/orm/prisma-client/special-fields-and-types/working-with-json-fields).
 * Eski dizi bicimi `as any` ile derleniyordu ama MySQL'de calisma aninda
 * dogrulama hatasi verirdi.
 */
const TRANSLATED_FROM_PATH = '$.translated_from';

/**
 * Translator — bir makaleyi farkli dile cevirir, yeni Article kaydi olusturur.
 *
 * Anthropic Sonnet ile high-quality cevir:
 *   - Markdown yapisi korunur (#, ##, **, blockquote, table)
 *   - Frontmatter ceviri yapilir (title, meta_title, meta_description)
 *   - Internal link'ler hedef dilin slug'ina cevrilmek istenirse mapping
 *   - Hreflang otomatik baglanir
 *
 * Hedefler: en, de, fr, ar, es, ru, tr (LANG_NAMES)
 *
 * KIRACI KAPSAMI: siteId verildiginde makale findFirst({ id, siteId }) ile
 * okunur. Controller (articles.controller requireArticle) ayrica kontrol
 * ediyor; servis de baska sitenin makalesini o kimlikle cevirmez.
 */
@Injectable()
export class TranslatorService {
  private readonly log = new Logger(TranslatorService.name);
  private readonly anthropic = process.env.ANTHROPIC_API_KEY
    ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    : null;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * @param siteId Makalenin ait olmasi gereken site. articles.controller su an
   *   yalniz (id, dil) geciriyor — siteId'li cagriya gecince servis katmani da
   *   kapsami dayatir (bkz. integrator notu). Verilmezse eski davranis:
   *   kimlik tek basina (yalniz controller kontrolune guvenilir).
   */
  async translate(articleId: string, toLanguage: string, siteId?: string): Promise<TranslationResult> {
    if (!isTranslationLanguage(toLanguage)) {
      return { ok: false, fromLanguage: '', toLanguage: String(toLanguage).slice(0, 10), error: `Desteklenmeyen dil. Şunlardan biri olmalı: ${TRANSLATION_LANGUAGES.join(', ')}` };
    }
    if (!this.anthropic) {
      return { ok: false, fromLanguage: '', toLanguage, error: 'ANTHROPIC_API_KEY yok' };
    }

    const articleRaw = await this.prisma.article.findFirst({
      where: siteId ? { id: articleId, siteId } : { id: articleId },
    });
    if (!articleRaw) {
      return { ok: false, fromLanguage: '', toLanguage, error: 'Makale bulunamadı' };
    }
    const article: any = articleRaw;
    const fromLanguage = article.language ?? 'tr';

    if (fromLanguage === toLanguage) {
      return { ok: false, fromLanguage, toLanguage, error: 'Makale zaten bu dilde.' };
    }

    // Ayni makalenin ayni dile cevirisi zaten varsa modele HIC gitme. Eskiden
    // tekil ceviride kontrol yoktu: Sonnet cagrisi (32k cikti tavani) yapiliyor,
    // sonra (siteId, slug) tekilligi yuzunden kayit yine de dusuyordu.
    const existing = await this.prisma.article.findFirst({
      where: {
        siteId: article.siteId,
        language: toLanguage,
        frontmatter: { path: TRANSLATED_FROM_PATH, equals: article.id },
      },
      select: { id: true },
    });
    if (existing) {
      return {
        ok: false,
        translatedArticleId: existing.id,
        fromLanguage,
        toLanguage,
        error: 'Bu makalenin bu dile çevirisi zaten var.',
      };
    }

    // Yeni slug — orijinal slug + dil prefix
    const newSlug = `${toLanguage}-${article.slug}`.slice(0, 60);
    const slugTaken = await this.prisma.article.findFirst({
      where: { siteId: article.siteId, slug: newSlug },
      select: { id: true },
    });
    if (slugTaken) {
      return {
        ok: false,
        fromLanguage,
        toLanguage,
        error: `Bu sitede "${newSlug}" adresli bir makale zaten var; çeviri kaydı oluşturulamaz.`,
      };
    }

    const langName = LANG_NAMES[toLanguage];

    try {
      const md = (article.bodyMd ?? '').slice(0, 50000);
      const resp = await this.anthropic.messages.create({
        model: 'claude-sonnet-5',
        max_tokens: 32000,
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
          frontmatter: { ...(article.frontmatter ?? {}), translated_from: article.id, language: toLanguage } as any,
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
    // Izin listesi disi dil hic denenmez (DTO'dan bagimsiz ikinci kat)
    const langs = [...new Set((Array.isArray(languages) ? languages : []).filter(isTranslationLanguage))];
    const articles = await this.prisma.article.findMany({
      where: { siteId, status: 'PUBLISHED' as any, language: 'tr' as any },
      orderBy: { publishedAt: 'desc' },
      take: 20,
    });

    const results: any[] = [];
    for (const a of articles) {
      for (const lang of langs) {
        // Zaten cevirisi var mi? (translate() da bakar; burada sonuc listesini sismez)
        const existing = await this.prisma.article.findFirst({
          where: { siteId, language: lang, frontmatter: { path: TRANSLATED_FROM_PATH, equals: a.id } },
          select: { id: true },
        });
        if (existing) continue;

        const r = await this.translate(a.id, lang, siteId);
        results.push({ articleId: a.id, ...r });
      }
    }

    return { scheduled: results.filter((r) => r.ok).length, results };
  }
}
