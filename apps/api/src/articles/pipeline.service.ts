import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AgentRunnerService } from './agent-runner.service.js';
import { EmailService } from '../email/email.service.js';
import { SocialAutoDraftService } from '../social/social-auto-draft.service.js';
import { SchemaClassifierService } from './schema-classifier.service.js';
import { SettingsService } from '../settings/settings.service.js';
import {
  AGENT_01_KEYWORD,
  AGENT_02_OUTLINE,
  AGENT_03_WRITER,
  AGENT_04_EDITOR,
  AGENT_05_VISUALS,
  parseFrontmatter,
  turkishSlug,
} from '@luviai/shared';
import type { AgentContext } from '@luviai/shared';

export interface PipelineResult {
  articleId: string;
  slug: string;
  title: string;
  bodyMd: string;
  editorScore: number | null;
  editorVerdict: 'PASS' | 'REVIZE' | 'FAIL';
  totalCostUsd: number;
  durationMs: number;
  agentOutputs: Record<string, any>;
}

/**
 * 6-ajan zinciri orkestratörü.
 * LuviHost'taki generate-article.js'in NestJS service versiyonu.
 *
 * Akış:
 *   01-keyword → 02-outline → 03-writer → 04-editor (PASS kapısı, max 1 revize)
 *   → 05-visuals (skip varsa atlanır)
 *   → DB'ye Article kaydı
 */
@Injectable()
export class PipelineService {
  private readonly log = new Logger(PipelineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: AgentRunnerService,
    private readonly email: EmailService,
    private readonly socialAutoDraft: SocialAutoDraftService,
    private readonly schemaClassifier: SchemaClassifierService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Mock pipeline — AI_GLOBAL_DISABLED=1 iken gerçek API yerine simulasyon çalışır.
   * Article DB'de doldurulup status READY_TO_PUBLISH yapılır. UI akışını test etmek için.
   */
  private async runMockPipeline(opts: {
    siteId: string;
    topic: string;
    articleId?: string;
  }): Promise<PipelineResult> {
    this.log.warn(`[${opts.siteId}] MOCK pipeline (AI_GLOBAL_DISABLED=1) — topic: "${opts.topic}"`);

    // Realistik UX için kısa bir bekleme (kullanıcı "üretiliyor" UI'ında pipeline akışını görür)
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    if (opts.articleId) {
      await this.prisma.article.update({ where: { id: opts.articleId }, data: { status: 'GENERATING' as any } });
    }
    await sleep(8000);
    if (opts.articleId) {
      await this.prisma.article.update({ where: { id: opts.articleId }, data: { status: 'EDITING' as any } });
    }
    await sleep(6000);

    const slug = opts.topic
      .toLowerCase()
      .replace(/[^a-z0-9çğıöşü]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);

    const bodyMd = [
      `# ${opts.topic}`,
      '',
      `> **MOCK ARTICLE — AI_GLOBAL_DISABLED=1 iken üretilen dummy içerik.** Gerçek pipeline çalıştırmak için admin panelden flag'i kapat.`,
      '',
      '## Giriş',
      '',
      `Bu makale "${opts.topic}" konusunda dummy bir test içeriğidir. Gerçek üretim için Anthropic, OpenAI ve Gemini API kredilerinizin aktif olması gerekir. Şu an admin panelde \`AI_GLOBAL_DISABLED=1\` ayarı aktif olduğu için gerçek AI çağrıları yapılmadı.`,
      '',
      'Aşağıdaki içerik tamamen şablon — UI akışını ve yayın hedefine yükleme mantığını test etmek için kullanılır.',
      '',
      '## Hızlı Cevap',
      '',
      `${opts.topic} hakkında kısa özet: bu konu hakkında detaylı bilgi gerçek pipeline çalıştırıldığında 1800-2500 kelimelik kapsamlı bir rehberle sağlanır. Şu an gördüğünüz mock veri sadece test amaçlıdır.`,
      '',
      '## Ne, Neden, Nasıl?',
      '',
      `### Ne?\n\nMock pipeline, gerçek AI çağrılarını atlatıp şablon içerik üreten bir test moduydur. Bu modda Anthropic Claude, OpenAI veya Google Gemini API'lerine hiç istek gitmez.\n\n### Neden?\n\nGeliştirme/test aşamasında UI akışını, schema markup'ı, sosyal medya entegrasyonunu ve yayın hedefini gerçek para harcamadan test edebilmek için.\n\n### Nasıl?\n\nAdmin panelden \`AI_GLOBAL_DISABLED\` toggle'ını **AÇIK** yaparsın → tüm paid AI servisleri otomatik mock moda düşer.`,
      '',
      '## Sıkça Sorulan Sorular',
      '',
      `### Mock makale yayınlanır mı?\n\nEvet, gerçek pipeline'la aynı yolları izler — yayın hedefine yüklenir, sosyal medya draft'ı oluşturulur, schema markup eklenir.\n\n### Gerçek içerik nasıl üretirim?\n\nAdmin panel → \`AI_GLOBAL_DISABLED\` toggle'ını **KAPALI** yap. Sonraki "Şimdi üret" çağrısı gerçek pipeline'ı tetikler.\n\n### Mock makaleler kalıcı mı?\n\nDB'de durur, kullanıcı isterse silebilir. Gerçek üretime geçtiğinde topluca silmek için admin panel batch tools eklenebilir.`,
      '',
      '## Sonuç',
      '',
      `Bu mock makale şu konuyu işliyor: **${opts.topic}**. Gerçek üretim için yukarıdaki talimatları takip et. Test amaçlı oluşturuldu, yayın için uygun değil.`,
    ].join('\n');

    const wordCount = bodyMd.split(/\s+/).filter(Boolean).length;
    const faqs = [
      { q: 'Mock makale yayınlanır mı?', a: 'Evet, pipeline yollarını izler.' },
      { q: 'Gerçek içerik nasıl üretirim?', a: 'AI_GLOBAL_DISABLED toggle\'ını KAPALI yap.' },
      { q: 'Mock makaleler kalıcı mı?', a: 'DB\'de durur, manuel silinebilir.' },
    ];
    const heroPrompt = `Mock hero image for "${opts.topic}"`;

    const baseData: any = {
      slug,
      title: opts.topic,
      metaTitle: `${opts.topic} — Mock Test`,
      metaDescription: `${opts.topic} hakkında dummy test makalesi. AI_GLOBAL_DISABLED aktif.`,
      bodyMd,
      bodyHtml: `<article><h1>${opts.topic}</h1>${bodyMd.split('\n').filter(Boolean).map((p) => p.startsWith('#') ? '' : `<p>${p}</p>`).join('')}</article>`,
      wordCount,
      faqs,
      schemaMarkup: [
        { '@context': 'https://schema.org', '@type': 'Article', headline: opts.topic, datePublished: new Date().toISOString() },
      ],
      agentOutputs: { mock: true, generatedAt: new Date().toISOString(), heroPrompt },
      status: 'READY_TO_PUBLISH' as any,
    };

    let articleId: string;
    if (opts.articleId) {
      const updated = await this.prisma.article.update({ where: { id: opts.articleId }, data: baseData });
      articleId = updated.id;
    } else {
      const created = await this.prisma.article.create({
        data: { ...baseData, siteId: opts.siteId, topic: opts.topic, language: 'tr' },
      });
      articleId = created.id;
    }

    return {
      articleId,
      slug,
      title: opts.topic,
      bodyMd,
      bodyHtml: baseData.bodyHtml,
      faqs,
      heroPrompt,
      schemaMarkup: baseData.schemaMarkup,
      durationMs: Date.now() - 14000, // sleeps included
      totalCostUsd: 0,
      editorVerdict: 'PASS', // mock olsa da autoPublish path'i tetiklensin
      mock: true,
    } as any;
  }

  async runPipeline(opts: {
    siteId: string;
    topic: string;
    skipImages?: boolean;
    maxRevize?: number;
    articleId?: string;
  }): Promise<PipelineResult> {
    // AI_GLOBAL_DISABLED=1 → mock pipeline (dummy article üret, gerçek API çağrısı yapma)
    if (await this.settings.getBoolean('AI_GLOBAL_DISABLED')) {
      return this.runMockPipeline({ siteId: opts.siteId, topic: opts.topic, articleId: opts.articleId });
    }

    const t0 = Date.now();

    const site = await this.prisma.site.findUniqueOrThrow({
      where: { id: opts.siteId },
      include: { brain: true },
    });

    if (!site.brain) {
      throw new Error(`Site ${opts.siteId}: brain henüz oluşturulmamış. Önce BRAIN_GENERATE çalıştırın.`);
    }

    const brainContext: AgentContext = {
      brain: {
        brandVoice: site.brain.brandVoice as any,
        personas: site.brain.personas as any,
        competitors: site.brain.competitors as any,
        seoStrategy: site.brain.seoStrategy as any,
        glossary: site.brain.glossary as any,
      },
      siteUrl: site.url,
      siteName: site.name,
      niche: site.niche ?? 'web',
      language: (site.language as any) ?? 'tr',
      whmcsCart: undefined,
      today: new Date().toISOString().slice(0, 10),
    };

    const dateNote = `\n\n[ZORUNLU: Bugünün tarihi ${brainContext.today}. Frontmatter'da date_published bu olacak. Geçmiş yıl YASAK. Kod-fence sarmalama yok.]`;

    const agentOutputs: Record<string, any> = {};
    let totalCost = 0;

    // 01 — Anahtar Kelime
    this.log.log(`[${opts.siteId}] [1/6] Anahtar kelime: "${opts.topic}"`);
    const keyword = await this.runner.run({
      agentName: '01-keyword',
      agentSystemSuffix: AGENT_01_KEYWORD.systemSuffix,
      brainContext,
      input: `Konu: ${opts.topic}`,
    });
    agentOutputs.keyword = { output: keyword.output, usage: keyword.usage };
    totalCost += keyword.costUsd;

    // 02 — Taslak
    this.log.log(`[${opts.siteId}] [2/6] Taslak`);
    const outline = await this.runner.run({
      agentName: '02-outline',
      agentSystemSuffix: AGENT_02_OUTLINE.systemSuffix,
      brainContext,
      input: keyword.output,
    });
    agentOutputs.outline = { output: outline.output, usage: outline.usage };
    totalCost += outline.costUsd;

    // 03 — Yazar
    this.log.log(`[${opts.siteId}] [3/6] Yazar`);
    const writer = await this.runner.run({
      agentName: '03-writer',
      agentSystemSuffix: AGENT_03_WRITER.systemSuffix,
      brainContext,
      input: outline.output + dateNote,
    });
    agentOutputs.writer = { output: writer.output, usage: writer.usage };
    totalCost += writer.costUsd;

    // 04 — Editör
    let currentDraft = writer.output;
    let editorVerdict: 'PASS' | 'REVIZE' | 'FAIL' = 'FAIL';
    let editorScore: number | null = null;
    const maxRevize = opts.maxRevize ?? 1;

    for (let attempt = 0; attempt <= maxRevize; attempt++) {
      this.log.log(`[${opts.siteId}] [4/6] Editör${attempt > 0 ? ` (revize ${attempt})` : ''}`);
      const editor = await this.runner.run({
        agentName: '04-editor',
        agentSystemSuffix: AGENT_04_EDITOR.systemSuffix,
        brainContext,
        input: currentDraft + dateNote,
      });
      agentOutputs[`editor_attempt_${attempt}`] = { output: editor.output, usage: editor.usage };
      totalCost += editor.costUsd;

      const verdict = this.extractEditorVerdict(editor.output);
      editorVerdict = verdict.verdict;
      editorScore = verdict.score;

      this.log.log(`[${opts.siteId}]   → ${verdict.verdict} (${verdict.score}/60)`);

      if (verdict.verdict === 'PASS') {
        if (verdict.article && verdict.article.length > 1000 && !this.hasPlaceholder(verdict.article)) {
          currentDraft = verdict.article;
        }
        break;
      }
      if (verdict.verdict === 'FAIL' || attempt >= maxRevize) {
        if (verdict.article) currentDraft = verdict.article;
        break;
      }
      if (verdict.article) currentDraft = verdict.article;
    }

    // 05 — Görselleştirici
    if (!opts.skipImages && editorVerdict === 'PASS') {
      this.log.log(`[${opts.siteId}] [5/6] Görselleştirici`);
      const visuals = await this.runner.run({
        agentName: '05-visuals',
        agentSystemSuffix: AGENT_05_VISUALS.systemSuffix,
        brainContext,
        input: currentDraft,
        maxTokens: 4096,
      });
      agentOutputs.visuals = { output: visuals.output, usage: visuals.usage };
      totalCost += visuals.costUsd;
    } else {
      this.log.log(`[${opts.siteId}] [5/6] Görseller atlandı`);
    }

    // Frontmatter parse + DB
    const cleaned = this.cleanCodeFences(currentDraft);
    const { data: fm, content: body } = parseFrontmatter(cleaned);

    const slug = (fm.slug as string) || turkishSlug((fm.title as string) ?? opts.topic).slice(0, 60);
    const wordCount = body.split(/\s+/).length;

    // ── Schema Classifier — 15+ schema tipini otomatik karara bagla ──
    let schemaMarkup: any = null;
    if (editorVerdict === 'PASS') {
      try {
        const faqs = (fm.faqs as any[]) ?? [];
        const classification = await this.schemaClassifier.classify(cleaned, {
          hasFaqs: faqs.length > 0,
          persona: fm.persona as string,
          pillar: fm.pillar as string,
        });
        const siteRaw = await this.prisma.site.findUniqueOrThrow({
          where: { id: opts.siteId },
        });
        const siteAny: any = siteRaw;
        const siteName: string = String(siteAny.name ?? 'Site');
        const siteUrl: string = String(siteAny.url ?? '');
        const baseUrl = siteUrl.replace(/\/+$/, '');
        const articleUrl = `${baseUrl}/blog/${slug}.html`;
        const sameAs = Array.isArray(siteAny.socialProfiles)
          ? (siteAny.socialProfiles as string[])
          : [];

        const jsonLd = this.schemaClassifier.buildJsonLd({
          types: classification.primary,
          article: {
            title: (fm.title as string) ?? opts.topic,
            url: articleUrl,
            slug,
            metaDescription: (fm.meta_description as string) ?? null,
            datePublished: new Date().toISOString(),
            dateModified: new Date().toISOString(),
            heroImage: ((fm as any).hero_image as string) ?? null,
            faqs: faqs as any,
            author: fm.persona ? { name: fm.persona as string } : null,
          },
          site: {
            name: siteName,
            url: baseUrl,
            sameAs,
          },
        });

        schemaMarkup = { types: classification.primary, reasoning: classification.reasoning, jsonLd };
        agentOutputs.schema = { types: classification.primary, count: jsonLd.length, reasoning: classification.reasoning };
        this.log.log(`[${opts.siteId}] Schema: ${classification.primary.length} tip (${classification.primary.join(', ')})`);
      } catch (err: any) {
        this.log.warn(`[${opts.siteId}] Schema classifier fail: ${err.message}`);
      }
    }

    const articleData = {
      siteId: opts.siteId,
      topic: opts.topic,
      slug,
      title: (fm.title as string) ?? opts.topic,
      metaTitle: (fm.meta_title as string) ?? null,
      metaDescription: (fm.meta_description as string) ?? null,
      category: (fm.category as string) ?? 'Hosting',
      language: brainContext.language === 'both' ? 'tr' : brainContext.language,
      persona: (fm.persona as string) ?? null,
      pillar: (fm.pillar as string) ?? null,
      bodyMd: cleaned,
      frontmatter: fm as any,
      agentOutputs: agentOutputs as any,
      schemaMarkup: schemaMarkup as any,
      faqs: (fm.faqs as any) ?? null,
      wordCount,
      readingTime: Math.max(1, Math.round(wordCount / 200)),
      editorScore,
      editorVerdict: editorVerdict as any,
      totalCost: totalCost,
      status: editorVerdict === 'PASS' ? 'READY_TO_PUBLISH' : 'REVIZE_NEEDED',
      internalLinks: (fm.internal_links as any) ?? null,
    } as const;

    // Eger queueGeneration() placeholder Article olusturmussa onu guncelle,
    // yoksa yeni kayit olustur (geriye uyumluluk).
    const article = opts.articleId
      ? await this.prisma.article.update({
          where: { id: opts.articleId },
          data: articleData,
        })
      : await this.prisma.article.create({
          data: articleData,
        });

    const durationMs = Date.now() - t0;
    this.log.log(`[${opts.siteId}] ✅ Pipeline tamamlandı: ${slug} (${editorVerdict}, $${totalCost.toFixed(4)}, ${(durationMs / 1000).toFixed(0)}s, ${wordCount} kelime)`);

    // Site sahibine "makale hazir" maili (PASS olduysa).
    // Mail gonderimi pipeline'i blok etmez — fail olsa da makale kaydi tamam.
    if (editorVerdict === 'PASS') {
      this.notifyArticleReady(opts.siteId, article.id).catch((err) => {
        this.log.warn(`[${opts.siteId}] Mail gonderilemedi: ${err.message}`);
      });

      // Sosyal medya: makale yayina hazir oldugunda her aktif kanal icin
      // DRAFT post olustur. Cron, slot zamani gelince DRAFT'i QUEUED'a ceker
      // ve X/LinkedIn'e atar. Yayin hedefine publish gerek yok.
      this.socialAutoDraft.createDraftsForArticle(article.id).catch((err) => {
        this.log.warn(`[${opts.siteId}] Sosyal draft olusturulamadi: ${err.message}`);
      });
    }

    return {
      articleId: article.id,
      slug,
      title: article.title,
      bodyMd: cleaned,
      editorScore,
      editorVerdict,
      totalCostUsd: totalCost,
      durationMs,
      agentOutputs,
    };
  }

  /**
   * Makale PASS aldiginda site sahibine mail gonder.
   * Kullanicinin daha onceki PUBLISHED makalesi yoksa "first_article_published",
   * varsa daha basit bir bilgilendirme.
   */
  private async notifyArticleReady(siteId: string, articleId: string): Promise<void> {
    const site = await this.prisma.site.findUnique({
      where: { id: siteId },
      include: { user: { select: { email: true, name: true, id: true } } },
    });
    if (!site?.user?.email) return;

    const article = await this.prisma.article.findUnique({
      where: { id: articleId },
    });
    if (!article) return;

    const publicUrl = `${process.env.WEB_BASE_URL ?? 'https://ai.luvihost.com'}/sites/${siteId}/articles/${articleId}`;

    // Daha onceki ready/published makale var mi?
    const earlierCount = await this.prisma.article.count({
      where: {
        siteId,
        id: { not: articleId },
        status: { in: ['READY_TO_PUBLISH', 'PUBLISHED'] as any },
      },
    });

    const template = earlierCount === 0 ? 'first_article_published' : 'article_ready';
    await this.email.send({
      userId: site.user.id,
      to: site.user.email,
      template,
      data: {
        name: site.user.name ?? 'kullanici',
        title: article.title,
        publicUrl,
        wordCount: article.wordCount,
        faqs: ((article.frontmatter as any)?.faqs as any[])?.length ?? 0,
        editorScore: article.editorScore,
        articlesPublished: earlierCount + 1,
      },
    });
    this.log.log(`[${siteId}] Mail gonderildi: ${site.user.email} (${template})`);
  }

  private extractEditorVerdict(output: string): {
    verdict: 'PASS' | 'REVIZE' | 'FAIL';
    score: number | null;
    article: string | null;
  } {
    const verdictPattern = /##\s*Karar(?:\s+güncellemesi)?\s*\n\*\*\[?(PASS|REVIZE|FAIL)/gi;
    const matches = [...output.matchAll(verdictPattern)];
    let verdict: 'PASS' | 'REVIZE' | 'FAIL' = matches.length > 0
      ? (matches[matches.length - 1][1].toUpperCase() as any)
      : 'FAIL';

    const scoreMatch = output.match(/\*\*Toplam\*\*\s*\|\s*\*\*(\d+)\/60/i)
      || output.match(/\b(\d+)\/60\b/);
    const score = scoreMatch ? parseInt(scoreMatch[1], 10) : null;

    if (verdict === 'REVIZE' && score !== null && score >= 48) verdict = 'PASS';

    let articleMatch = output.match(/##\s*Düzeltilmiş tam makale\s*\n+```(?:markdown)?\s*\n([\s\S]+?)```\s*$/i);
    if (!articleMatch) articleMatch = output.match(/##\s*Düzeltilmiş tam makale\s*\n([\s\S]+?)$/i);

    return {
      verdict,
      score,
      article: articleMatch ? articleMatch[1].trim() : null,
    };
  }

  private hasPlaceholder(text: string): boolean {
    return /\[YAZAR\s+(EKLEYECEK|TAMAMLAYACAK)/i.test(text);
  }

  private cleanCodeFences(raw: string): string {
    let txt = raw.trim();
    if (txt.startsWith('```markdown') || txt.startsWith('```')) {
      const lines = txt.split('\n');
      lines.shift();
      if (lines[lines.length - 1].trim() === '```') lines.pop();
      txt = lines.join('\n');
    }
    const lines = txt.split('\n');
    if (lines.length > 0 && !/^---\s*$/.test(lines[0])) {
      const limit = Math.min(lines.length, 25);
      for (let i = 1; i < limit; i++) {
        if (/^---\s*$/.test(lines[i])) {
          txt = lines.slice(i).join('\n');
          break;
        }
      }
    }
    return txt;
  }
}
