import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AgentRunnerService } from './agent-runner.service.js';
import { EmailService } from '../email/email.service.js';
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
  ) {}

  async runPipeline(opts: {
    siteId: string;
    topic: string;
    skipImages?: boolean;
    maxRevize?: number;
    articleId?: string;
  }): Promise<PipelineResult> {
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
