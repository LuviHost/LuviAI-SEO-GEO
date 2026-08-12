import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { JobQueueService } from '../jobs/job-queue.service.js';
import { QuotaService } from '../billing/quota.service.js';
import { LLMProviderService } from '../llm/llm-provider.service.js';
import { PromptLabService } from './prompt-lab.service.js';
import { acquireCronLock } from '../common/cron-lock.js';

/**
 * Content Opportunity — kapali dongu:
 *
 *   Prompt Lab'de KAYBEDILEN sorgu → icerik firsati (LOST/WEAK etiketi + kanit)
 *   → tek tikla makale uretimi → yayin → ayni prompt YENIDEN olculur → delta.
 *
 * Rakip urunlerdeki "Content Opportunity / Forge" akisinin RanksUp karsiligi.
 * Fark: kanit zinciri kalici (promptId → articleId → remeasureResult) ve
 * makale uretimi mevcut 6-ajan pipeline'ina baglanir.
 */

const LOOKBACK_DAYS = 14;
/** citedRate alti LOST sayilir */
const LOST_THRESHOLD = 0.01;
/** citedRate bu esigin altindaysa WEAK */
const WEAK_THRESHOLD = 0.4;

@Injectable()
export class ContentOpportunityService {
  private readonly log = new Logger(ContentOpportunityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobQueue: JobQueueService,
    private readonly quota: QuotaService,
    private readonly llm: LLMProviderService,
    private readonly promptLab: PromptLabService,
  ) {}

  // ────────────────────────────────────────────────────────────
  //  TURETME — prompt kayiplarindan firsat cikar
  // ────────────────────────────────────────────────────────────

  /**
   * Son LOOKBACK_DAYS gunun GeoPromptRun verisinden prompt basina kapsama
   * durumu cikarir ve LOST/WEAK promptlari ContentOpportunity'ye yazar.
   * Ayni prompt icin acik (OPEN/PLANNED) firsat varsa gunceller, yenisini acmaz.
   */
  async derive(siteId: string): Promise<{ created: number; updated: number; scanned: number }> {
    const since = new Date(Date.now() - LOOKBACK_DAYS * 86400_000);

    // Site prompt'lari (app prompt'lari App Prompt Lab'de ayri ele alinir)
    const prompts = await this.prisma.geoPrompt.findMany({
      where: { siteId, isActive: true, trackedAppId: null },
      select: { id: true, text: true, intent: true },
    });
    if (prompts.length === 0) return { created: 0, updated: 0, scanned: 0 };

    const runs = await this.prisma.geoPromptRun.findMany({
      where: { siteId, date: { gte: since }, promptId: { in: prompts.map((p) => p.id) } },
      select: { promptId: true, provider: true, cited: true, brandMentioned: true },
    });

    const byPrompt = new Map<string, { cited: number; total: number; providers: Map<string, { cited: number; total: number }> }>();
    for (const r of runs) {
      const cur = byPrompt.get(r.promptId) ?? { cited: 0, total: 0, providers: new Map() };
      cur.total++;
      if (r.cited) cur.cited++;
      const p = cur.providers.get(r.provider) ?? { cited: 0, total: 0 };
      p.total++;
      if (r.cited) p.cited++;
      cur.providers.set(r.provider, p);
      byPrompt.set(r.promptId, cur);
    }

    let created = 0;
    let updated = 0;

    for (const prompt of prompts) {
      const stats = byPrompt.get(prompt.id);
      if (!stats || stats.total === 0) continue; // olcum yok — MISSING uretme (gurultu)

      const rate = stats.cited / stats.total;
      const coverage = rate <= LOST_THRESHOLD ? 'LOST' : rate < WEAK_THRESHOLD ? 'WEAK' : 'WON';
      const providersLost = Array.from(stats.providers.entries())
        .filter(([, s]) => s.cited === 0)
        .map(([provider]) => provider);

      // Skor: kayip orani + niyet agirligi (ticari sorgu kaybi daha degerli)
      const intentBoost = prompt.intent === 'commercial' || prompt.intent === 'transactional' ? 20
        : prompt.intent === 'comparison' ? 15 : 0;
      const score = Math.min(100, Math.round((1 - rate) * 80) + intentBoost);

      // Dedup TUM aktif-olmayan durumlar dahil yapilir:
      //  - OPEN/PLANNED   → yerinde guncelle
      //  - GENERATED/PUBLISHED → makale dongude, YENI kart ACMA (cift uretim + kota israfi olurdu)
      //  - DISMISSED      → kullanicinin "yoksay" karari kalicidir, yeniden acma
      //  - REMEASURED     → dongu kapandi; hala kayipsa yeni kart mesru
      const existing = await this.prisma.contentOpportunity.findFirst({
        where: { siteId, promptId: prompt.id, status: { notIn: ['REMEASURED'] } },
        orderBy: { createdAt: 'desc' },
      });

      if (coverage === 'WON') {
        // Kazanilmis — acik firsat varsa kapat (kanit: rate)
        if (existing && (existing.status === 'OPEN' || existing.status === 'PLANNED')) {
          await this.prisma.contentOpportunity.update({
            where: { id: existing.id },
            data: { coverage: 'WON', meta: { ...(existing.meta as any ?? {}), wonAt: new Date().toISOString(), citedRate: rate } },
          });
          updated++;
        }
        continue;
      }

      if (existing && existing.status !== 'OPEN' && existing.status !== 'PLANNED') {
        // GENERATED/PUBLISHED/DISMISSED — dokunma, yeni kart da acma
        continue;
      }

      if (existing) {
        await this.prisma.contentOpportunity.update({
          where: { id: existing.id },
          data: {
            coverage,
            providersLost,
            score,
            meta: { ...(existing.meta as any ?? {}), citedRate: rate, cited: stats.cited, total: stats.total },
          },
        });
        updated++;
      } else {
        await this.prisma.contentOpportunity.create({
          data: {
            siteId,
            source: 'prompt',
            promptId: prompt.id,
            title: await this.suggestTitle(siteId, prompt.text),
            query: prompt.text,
            coverage,
            providersLost,
            score,
            status: 'OPEN',
            meta: { citedRate: rate, cited: stats.cited, total: stats.total },
          },
        });
        created++;
      }
    }

    return { created, updated, scanned: prompts.length };
  }

  /** Gunluk 05:00 UTC — aktif sitelerde firsat turet (olcum verisi olanlarda) */
  @Cron('0 5 * * *')
  async dailyDeriveAll() {
    // API ve worker AYNI AppModule'u bootstrap ediyor → her @Cron iki proseste
    // birden tetiklenir. KvStore @id uzerinden atomik kilit: ilk create kazanir.
    if (!(await acquireCronLock(this.prisma, 'opportunity-derive', 'daily'))) return;
    const sites = await this.prisma.site.findMany({
      where: { status: 'ACTIVE' as any },
      select: { id: true },
      take: 200,
    });
    for (const s of sites) {
      try {
        await this.derive(s.id);
      } catch (err: any) {
        this.log.warn(`Opportunity derive fail (${s.id}): ${err.message}`);
      }
    }
  }

  // ────────────────────────────────────────────────────────────
  //  CRUD + AKIS
  // ────────────────────────────────────────────────────────────

  async list(siteId: string, opts: { status?: string; coverage?: string } = {}) {
    const items = await this.prisma.contentOpportunity.findMany({
      where: {
        siteId,
        ...(opts.status ? { status: opts.status } : {}),
        ...(opts.coverage ? { coverage: opts.coverage } : {}),
      },
      orderBy: [{ status: 'asc' }, { score: 'desc' }, { updatedAt: 'desc' }],
      take: 200,
      include: {
        article: { select: { id: true, title: true, slug: true, status: true, publishedAt: true } },
      },
    });
    return items;
  }

  async updateStatus(siteId: string, id: string, status: string) {
    const allowed = ['OPEN', 'PLANNED', 'DISMISSED'];
    if (!allowed.includes(status)) {
      throw new BadRequestException(`Durum yalnizca ${allowed.join('/')} olabilir`);
    }
    const item = await this.require(siteId, id);
    return this.prisma.contentOpportunity.update({
      where: { id: item.id },
      data: { status },
    });
  }

  /**
   * Firsattan makale uret — mevcut 6-ajan pipeline'ina baglanir.
   * queueGeneration ile ayni akis: placeholder Article + GENERATE_ARTICLE job.
   */
  async generateArticle(siteId: string, id: string) {
    const item = await this.require(siteId, id);
    if (item.articleId) {
      throw new BadRequestException('Bu firsat icin zaten makale uretildi');
    }

    const site = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId } });
    await this.quota.enforceArticleQuota(site.userId);

    const topic = item.title || item.query;
    const placeholderSlug = `generating-${Date.now().toString(36)}`;
    const article = await this.prisma.article.create({
      data: {
        siteId,
        topic,
        slug: placeholderSlug,
        title: topic,
        status: 'GENERATING' as any,
        language: site.language ?? 'tr',
      },
    });

    const job = await this.jobQueue.enqueue({
      type: 'GENERATE_ARTICLE',
      userId: site.userId,
      siteId,
      payload: { siteId, topic, articleId: article.id },
    });
    await this.quota.incrementArticleUsage(site.userId);

    await this.prisma.contentOpportunity.update({
      where: { id: item.id },
      data: {
        status: 'GENERATED',
        articleId: article.id,
        meta: {
          ...(item.meta as any ?? {}),
          generateJobId: job.dbJobId,
          // Remeasure icin "once" kaniti
          before: (item.meta as any)?.before ?? {
            cited: (item.meta as any)?.cited ?? 0,
            total: (item.meta as any)?.total ?? 0,
          },
        },
      },
    });

    return { opportunityId: item.id, articleId: article.id, jobId: job.dbJobId };
  }

  /**
   * Yayin sonrasi yeniden olcum — ayni prompt'u tekrar calistirir,
   * before/after deltayi kaydeder. Kanit dongusunun son halkasi.
   */
  async remeasure(siteId: string, id: string) {
    const item = await this.require(siteId, id);
    if (!item.promptId) {
      throw new BadRequestException('Bu firsat bir prompt kaynagina bagli degil');
    }

    const summary = await this.promptLab.runPrompt(siteId, item.promptId, {});
    const before = (item.meta as any)?.before ?? { cited: 0, total: 0 };
    const after = { cited: summary.main.cited, total: summary.main.total };

    const won = after.total > 0 && after.cited / after.total >= WEAK_THRESHOLD;
    const wonProviders = summary.providers
      .filter((p) => p.available && p.probes.some((probe) => probe.cited))
      .map((p) => p.provider);

    const updated = await this.prisma.contentOpportunity.update({
      where: { id: item.id },
      data: {
        status: 'REMEASURED',
        coverage: won ? 'WON' : after.cited > before.cited ? 'WEAK' : item.coverage,
        remeasuredAt: new Date(),
        remeasureResult: { before, after, wonProviders },
      },
    });

    return { opportunity: updated, before, after, wonProviders };
  }

  /** Yayinlanan makalesi olan GENERATED firsatlari PUBLISHED'a tasi (UI list oncesi cagirilir) */
  async reconcile(siteId: string) {
    const generated = await this.prisma.contentOpportunity.findMany({
      where: { siteId, status: 'GENERATED', articleId: { not: null } },
      include: { article: { select: { status: true } } },
    });
    for (const g of generated) {
      if (g.article?.status === 'PUBLISHED') {
        await this.prisma.contentOpportunity.update({
          where: { id: g.id },
          data: { status: 'PUBLISHED' },
        });
      }
    }
  }

  // ────────────────────────────────────────────────────────────
  //  YARDIMCILAR
  // ────────────────────────────────────────────────────────────

  private async require(siteId: string, id: string) {
    // Tenant izolasyonu: id + siteId birlikte (bkz. prompt-lab.service.ts nota)
    const item = await this.prisma.contentOpportunity.findFirst({ where: { id, siteId } });
    if (!item) throw new NotFoundException('Firsat bulunamadi');
    return item;
  }

  /** Kaybedilen sorgudan makale basligi oner — LLM, hata durumunda heuristik */
  private async suggestTitle(siteId: string, query: string): Promise<string> {
    try {
      const res = await this.llm.chat({
        context: 'content-opportunity-title',
        siteId,
        model: 'claude-haiku-4-5',
        maxTokens: 100,
        systemPrompt: 'Kullanicinin AI aramalarinda kaybettigi sorgu icin SEO/GEO uyumlu tek bir Turkce makale basligi uret. SADECE basligi dondur, tirnak ve aciklama yok.',
        messages: [{ role: 'user', content: `Kaybedilen sorgu: "${query}"` }],
      });
      const title = res.output.trim().split('\n')[0].replace(/^["'«]|["'»]$/g, '').slice(0, 180);
      if (title.length >= 10) return title;
    } catch (err: any) {
      this.log.warn(`Baslik onerisi uretilemedi: ${err.message}`);
    }
    return query.length > 60 ? query.slice(0, 60) : `${query} — Kapsamlı Rehber`;
  }
}
