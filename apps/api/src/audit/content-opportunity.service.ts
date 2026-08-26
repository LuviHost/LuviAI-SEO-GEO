import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { JobQueueService } from '../jobs/job-queue.service.js';
import { QuotaService } from '../billing/quota.service.js';
import { LLMProviderService } from '../llm/llm-provider.service.js';
import { PromptLabService } from './prompt-lab.service.js';
import { acquireCronLock } from '../common/cron-lock.js';
import { siteWhereForFeature } from '../billing/plan-site-filter.js';
import {
  remeasureVerdict, afterWindowStart, REMEASURE_FOLLOW_UPS, REMEASURE_WINDOW_DAYS,
} from './remeasure-verdict.js';

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
/**
 * Hukum icin gereken asgari satir sayisi. Havuz fanoutId:null +
 * brandInQuery:false suzgecleriyle ~6 kat kuculdu; eski buyuk payda tek
 * probe'luk gunlerin (butce asimi gunu tek saglayici kosar) LOST/WON karari
 * vermesini engelliyordu. Simdi acik esik gerekiyor: tek satirla ne kart
 * acilir ne "kazanildi" diye kapanir.
 */
const MIN_RUNS_FOR_VERDICT = 3;
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

    // YALNIZ ana soru + MARKASIZ satirlar. Iki suzgecin de gerekcesi ayni:
    // firsat "kaybettigin soru"yu temsil eder ve remeasure() sonucu
    // summary.main (yalniz ana soru) ile olcer — before/after ayni tanimdan
    // gelmezse delta anlamsizlasir. Markali satirlar (fan-out sablon dallari
    // %100 markali; 12 dal x 3 saglayici = 36 satir, ana soru ~7) citedRate'i
    // yukari cekip gercekte LOST olan promptu WEAK/WON gosteriyordu — firsat
    // karti ya hic acilmiyor ya "kazanildi" diye kapaniyordu.
    // NOT: ana sorusu markali olan prompt boylece hic kart uretmez — dogru:
    // markali soruda "gorunmuyorsun" diye icerik uretmek anlamsiz.
    const runs = await this.prisma.geoPromptRun.findMany({
      where: {
        siteId, date: { gte: since }, promptId: { in: prompts.map((p) => p.id) },
        fanoutId: null,
        brandInQuery: false,
      },
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
      // Olcum yok/yetersiz — hukum verme (MISSING de uretme: gurultu)
      if (!stats || stats.total < MIN_RUNS_FOR_VERDICT) continue;

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
            meta: { ...(existing.meta as any ?? {}), citedRate: rate, cited: stats.cited, total: stats.total, method: 'main-unbranded' },
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
            meta: { citedRate: rate, cited: stats.cited, total: stats.total, method: 'main-unbranded' },
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
      where: {
        status: 'ACTIVE' as any,
        // Profesyonel ozelligi — kapali dongu otomatik olarak da alt planda calismamali.
        ...siteWhereForFeature('contentOpportunities'),
      },
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
   * Yayin sonrasi yeniden olcum — HIBRIT.
   *
   * Tik: 1 kosum (kullanici tetikli, kota sayar) → "ON SONUC" aninda gosterilir,
   * coverage DEGISMEZ. D+1 ve D+2'de dailyRemeasureFollowUps ayni promptu
   * sistem modunda (kota tuketmeden) yeniden kosar; hukum >= 2 FARKLI GUN ve
   * >= 6 satirda verilir (remeasure-verdict.ts). Eski kod tek tikin ~7
   * saglayici satiriyla WON ilan ediyordu — AI cevaplari gunden gune oynak,
   * tek kosumluk "kazandik" buyuk oranda sansti.
   */
  async remeasure(siteId: string, id: string) {
    const item = await this.require(siteId, id);
    if (!item.promptId) {
      throw new BadRequestException('Bu firsat bir prompt kaynagina bagli degil');
    }
    await this.promptLab.runPrompt(siteId, item.promptId, { trigger: 'user' });
    const updated = await this.applyRemeasure(item.id, { followUpsDone: 0 });
    const rr = updated.remeasureResult as any;
    return { opportunity: updated, before: rr?.before ?? null, after: rr?.after, wonProviders: rr?.wonProviders ?? [] };
  }

  /**
   * "after" havuzunu topla ve hukmu uygula — tek tik ve takip kosumlari AYNI
   * yoldan gecer. Havuz: son REMEASURE_WINDOW_DAYS gunun ana-soru + markasiz
   * satirlari (persistRuns HATA'li probe'u zaten yazmaz), yayin gununden
   * erken degil (afterWindowStart — gun basina yuvarlanir).
   */
  private async applyRemeasure(id: string, opts: { followUpsDone: number }) {
    const item = await this.prisma.contentOpportunity.findUniqueOrThrow({
      where: { id },
      include: { article: { select: { publishedAt: true } } },
    });
    const now = new Date();
    const since = afterWindowStart(now, item.article?.publishedAt ?? null);
    const rows = await this.prisma.geoPromptRun.findMany({
      where: { siteId: item.siteId, promptId: item.promptId!, fanoutId: null, brandInQuery: false, date: { gte: since } },
      select: { date: true, provider: true, cited: true },
    });
    const v = remeasureVerdict(
      rows.map((r) => ({ date: r.date.toISOString().slice(0, 10), provider: r.provider, cited: r.cited })),
      { weak: WEAK_THRESHOLD, lost: LOST_THRESHOLD },
    );

    // before: 14 gunluk cok-kosum toplami; yalniz AYNI YONTEMLE (main-unbranded)
    // olculmusse kiyaslanir — eski kartlarin karisik-havuz before'u sismis,
    // onunla kiyas "makale ise yaramadi" yalanini uretir.
    const before = (item.meta as any)?.before ?? { cited: 0, total: 0 };
    const comparable = (item.meta as any)?.method === 'main-unbranded' && before.total > 0;

    // Kesin hukum coverage'i degistirir; ON SONUC ve LOST mevcut coverage'a dokunmaz
    const coverage = v.verdict === 'WON' ? 'WON' : v.verdict === 'WEAK' ? 'WEAK' : item.coverage;

    return this.prisma.contentOpportunity.update({
      where: { id },
      data: {
        status: 'REMEASURED',
        coverage,
        remeasuredAt: item.remeasuredAt ?? now, // ilk tik ani; takipler lastMeasuredAt'e yazar
        remeasureResult: {
          before: comparable ? before : null,
          beforeMethod: comparable ? 'main-unbranded' : 'legacy-mixed',
          after: { cited: v.cited, total: v.total },
          wonProviders: v.wonProviders,
          method: 'main-unbranded',
          verdict: v.verdict,
          dayCount: v.dayCount,
          windowDays: REMEASURE_WINDOW_DAYS,
          windowStart: since.toISOString().slice(0, 10),
          followUpsDone: opts.followUpsDone,
          followUpsTarget: REMEASURE_FOLLOW_UPS,
          lastMeasuredAt: now.toISOString(),
        },
      },
    });
  }

  /**
   * Takip kosumlari — 05:30 UTC. ON SONUC'ta kalan kartlarin promptunu sistem
   * modunda (kota tuketmeden) yeniden kosar. GeoPromptRun hattinda baska cron
   * yok — bu olmadan "on sonuc" kalici bir kilit olurdu.
   */
  @Cron('30 5 * * *')
  async dailyRemeasureFollowUps() {
    if (!(await acquireCronLock(this.prisma, 'opportunity-remeasure-followup', 'daily'))) return;
    const since = new Date(Date.now() - 10 * 86_400_000);
    const pending = await this.prisma.contentOpportunity.findMany({
      where: {
        status: 'REMEASURED',
        remeasuredAt: { gte: since },
        promptId: { not: null },
        remeasureResult: { path: '$.verdict', equals: 'PRELIMINARY' },
        site: { status: 'ACTIVE' as any, ...siteWhereForFeature('contentOpportunities') },
      },
      select: { id: true, siteId: true, promptId: true, remeasureResult: true },
      take: 200,
    });
    let ran = 0;
    for (const item of pending) {
      const done = Number((item.remeasureResult as any)?.followUpsDone ?? 0);
      if (done >= REMEASURE_FOLLOW_UPS) continue;
      try {
        await this.promptLab.runPrompt(item.siteId, item.promptId!, { trigger: 'system' });
        await this.applyRemeasure(item.id, { followUpsDone: done + 1 });
        ran++;
      } catch (err: any) {
        this.log.warn(`Remeasure takip fail (${item.id}): ${err.message}`);
      }
    }
    if (ran > 0) this.log.log(`Remeasure takip kosumu: ${ran} kart`);
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
        model: 'claude-opus-5',
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
