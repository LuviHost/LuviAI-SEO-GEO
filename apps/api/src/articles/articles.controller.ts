import { Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ArticlesService } from './articles.service.js';
import { ArticleSchedulerService } from './article-scheduler.service.js';
import { ProgrammaticSeoService } from './programmatic-seo.service.js';
import { TranslatorService } from './translator.service.js';
import { QaGateService } from './qa-gate.service.js';
import { RequiresPlan } from '../billing/plan-feature.decorator.js';
import { TranslateArticleDto, TranslateBulkDto } from './articles.dto.js';

// PLAN KAPILARI — bu dosyada yalnizca EYLEM uclari plana baglidir.
// Programmatic SEO fiyat kartinda Ajans plani maddesi olarak satiliyor, o yuzden
// toplu sehir uretimi ucu kapali. Duz listeleme ve gecmis GET uclari bilerek
// ACIK birakildi; plani dusen kullanici gecmis verisini gorebilmeli.
//
// SAHIPLIK: SiteAccessGuard yalniz `:siteId`'yi dogrular. `:id` (makale) ayri
// bir parametre — servis onu siteId'siz okuyorsa (reschedule, unschedule,
// translate) makale once BU siteye ait mi diye bakilir (requireArticle).
//
// KALDIRILAN UCLAR (istemcisi yoktu; web/mobil/worker cagirmiyor):
//  - POST schedule-batch: ilk makaleyi kota denetimi OLMADAN hemen uretime
//    aliyordu; her cagri bedava bir makale (5 ajanlik LLM zinciri) demekti.
//    Onboarding ayni servisi worker'da (5/5 adimi) dogrudan cagiriyor.
//  - POST :id/video/tiktok: govdedeki `videoPath` sunucuda fs.readFile ile
//    okunuyordu (rastgele dosya okuma) ve RanksUp'in KENDI TikTok hesabina
//    (TIKTOK_ACCESS_TOKEN) yukleniyordu.
//  - POST :id/video/instagram: herhangi bir musteri, RanksUp'in KENDI
//    Instagram hesabinda (INSTAGRAM_ACCESS_TOKEN) istedigi video ve metinle
//    Reels yayinlatabiliyordu.
@Controller('sites/:siteId/articles')
export class ArticlesController {
  constructor(
    private readonly articles: ArticlesService,
    private readonly scheduler: ArticleSchedulerService,
    private readonly programmatic: ProgrammaticSeoService,
    private readonly translator: TranslatorService,
    private readonly qaGate: QaGateService,
  ) {}

  /** Makale bu siteye ait degilse 404 (baska sitenin makalesinin varligi sizmaz) */
  private async requireArticle(siteId: string, id: string): Promise<void> {
    if (!siteId || !id) throw new NotFoundException('Makale bulunamadı');
    const article = await this.articles.findOne(id, siteId);
    if (!article) throw new NotFoundException('Makale bulunamadı');
  }

  @Get()
  list(@Param('siteId') siteId: string, @Query('status') status?: string) {
    return this.articles.list(siteId, status);
  }

  /** GET /sites/:siteId/articles/scheduled — takvim icin bekleyen makaleler */
  @Get('scheduled')
  scheduled(@Param('siteId') siteId: string) {
    return this.scheduler.listScheduledForSite(siteId);
  }

  /** POST /sites/:siteId/articles/schedule-topic — drag-drop: bir tier-1 konuyu takvime ekle */
  @Post('schedule-topic')
  scheduleTopic(
    @Param('siteId') siteId: string,
    @Body() body: { topic: string; scheduledAt: string; slug?: string; pillar?: string },
  ) {
    return this.scheduler.scheduleTopic(siteId, body);
  }

  /** PUT /sites/:siteId/articles/:id/reschedule — drag-drop: takvimde mevcut makaleyi tasi */
  @Put(':id/reschedule')
  async reschedule(
    @Param('siteId') siteId: string,
    @Param('id') id: string,
    @Body() body: { scheduledAt: string },
  ) {
    // Servis makaleyi yalniz id ile okuyor: baska sitenin makalesi tasinabiliyor
    // (DRAFT → SCHEDULED, kurbanin kotasindan uretim) ve tam satiri donuyordu
    await this.requireArticle(siteId, id);
    return this.scheduler.rescheduleArticle(id, body.scheduledAt);
  }

  /** DELETE /sites/:siteId/articles/scheduled/:id — takvimden kaldir */
  @Delete('scheduled/:id')
  async unschedule(@Param('siteId') siteId: string, @Param('id') id: string) {
    // Servis yalniz id ile siliyordu — baska sitenin takvimdeki makalesi silinebiliyordu
    await this.requireArticle(siteId, id);
    return this.scheduler.unscheduleArticle(id);
  }

  /**
   * PATCH /sites/:siteId/articles/:id/social-pre-plan
   * Body: { channelIds: string[] | null }
   * Article PUBLISHED olunca SocialAutoDraftService bu listeyi kullanir:
   *   - null/undefined => tum aktif kanallar (default)
   *   - []             => hicbir kanalda paylasma
   *   - ['ch1','ch2']  => sadece bu iki kanalda DRAFT olusur
   */
  @Patch(':id/social-pre-plan')
  setSocialPrePlan(
    @Param('siteId') siteId: string,
    @Param('id') id: string,
    @Body() body: { channelIds: string[] | null },
  ) {
    return this.articles.setSocialPrePlan(siteId, id, body?.channelIds ?? null);
  }

  @Get(':id')
  get(@Param('siteId') siteId: string, @Param('id') id: string) {
    return this.articles.findOne(id, siteId);
  }

  /** POST /sites/:siteId/articles/generate — queue */
  @Post('generate')
  generate(@Param('siteId') siteId: string, @Body() body: { topic: string; targetIds?: string[] }) {
    return this.articles.queueGeneration(siteId, body.topic, body.targetIds);
  }

  /** POST /sites/:siteId/articles/run-now — senkron pipeline (quota'li) */
  @Post('run-now')
  runNow(@Param('siteId') siteId: string, @Body() body: { topic: string; skipImages?: boolean; maxRevize?: number }) {
    return this.articles.runPipelineNow({
      siteId,
      topic: body.topic,
      skipImages: body.skipImages,
      maxRevize: body.maxRevize,
    });
  }

  /** POST /sites/:siteId/articles/:id/publish */
  @Post(':id/publish')
  publish(
    @Param('siteId') siteId: string,
    @Param('id') id: string,
    @Body() body: { targetIds: string[]; overrideQa?: boolean },
  ) {
    return this.articles.queuePublish(siteId, id, body.targetIds, { overrideQa: body.overrideQa });
  }

  /** POST /sites/:siteId/articles/:id/qa-check — yayin oncesi QA gate'i (yeniden) kos */
  @Post(':id/qa-check')
  qaCheck(@Param('siteId') siteId: string, @Param('id') id: string) {
    return this.qaGate.check(id, siteId);
  }

  /** POST /sites/:siteId/articles/:id/trigger-now — SCHEDULED article'ı şimdi üretime al */
  @Post(':id/trigger-now')
  triggerNow(@Param('siteId') siteId: string, @Param('id') id: string) {
    return this.articles.triggerNow(siteId, id);
  }

  /** POST /sites/:siteId/articles/:id/translate — makaleyi farkli dile cevir */
  @Post(':id/translate')
  async translate(@Param('siteId') siteId: string, @Param('id') id: string, @Body() body: TranslateArticleDto) {
    // Servis makaleyi yalniz id ile okuyor: baska sitenin makalesi o sitede
    // yeni bir ceviri kaydi olarak (LLM maliyetiyle) uretilebiliyordu
    await this.requireArticle(siteId, id);
    return this.translator.translate(id, body.toLanguage);
  }

  /** POST /sites/:siteId/articles/translate-bulk — site icin bulk cevir */
  @Post('translate-bulk')
  translateBulk(@Param('siteId') siteId: string, @Body() body: TranslateBulkDto) {
    return this.translator.bulkTranslateSite(siteId, body.languages ?? ['en']);
  }

  /** POST /sites/:siteId/articles/programmatic/cities — 81 il icin bulk schedule (plan kapisi) */
  @RequiresPlan('programmaticSeo')
  @Post('programmatic/cities')
  programmaticCities(
    @Param('siteId') siteId: string,
    @Body() body: { template: string; cities?: string[]; spreadDays?: number; maxQuota?: number },
  ) {
    return this.programmatic.generateCityPages(siteId, body);
  }
}
