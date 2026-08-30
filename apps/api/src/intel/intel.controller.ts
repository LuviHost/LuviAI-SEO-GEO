import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Logger,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service.js';
import { IntelCollectorService } from './collector.service.js';
import { IntelTriageService } from './triage.service.js';
import { IntelAnalystService, PRODUCT_AREAS } from './analyst.service.js';
import { ClaimLedgerService } from './claim-ledger.service.js';
import { IntelActionService } from './intel-action.service.js';
import { IntelDigestService } from './digest.service.js';
import { XSearchService } from './x-search.service.js';
import { OpenClawService } from './openclaw.service.js';
import { LinkedinOutreachService, type ImportRow } from './linkedin-outreach.service.js';
import { parseSearchUrls } from './linkedin-outreach-rules.js';
import { DISABLED_SOURCES } from './source-registry.js';

/**
 * Intel uclari — TAMAMI admin. Bu bir ic arastirma aracidir; musteri
 * yuzeyine acilmaz. Kanit defteri ham haliyle (elenmis yayinlar, hatali
 * kaynaklar, LLM notlari) disari verilecek bir sey degil.
 */

function assertAdmin(req: Request) {
  const user = (req as any).user;
  if (!user) throw new ForbiddenException('Auth required');
  if (user.role !== 'ADMIN') throw new ForbiddenException('Admin only');
  return user;
}

/**
 * Su an arka planda calisan asamalar. Modul kapsaminda tutuluyor: controller
 * ornegi istek basina yeniden olusabilir, kilit onunla birlikte kaybolurdu.
 */
const CALISAN_ASAMALAR = new Set<string>();

@Controller('intel')
export class IntelController {
  private readonly log = new Logger(IntelController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly collector: IntelCollectorService,
    private readonly triage: IntelTriageService,
    private readonly analyst: IntelAnalystService,
    private readonly ledger: ClaimLedgerService,
    private readonly intelAction: IntelActionService,
    private readonly digest: IntelDigestService,
    private readonly xSearch: XSearchService,
    private readonly openClaw: OpenClawService,
    private readonly linkedin: LinkedinOutreachService,
  ) {}

  // ────────────────────────────────────────────────────────────
  //  GENEL DURUM
  // ────────────────────────────────────────────────────────────

  @Get('overview')
  async overview(@Req() req: Request) {
    assertAdmin(req);

    const since7 = new Date(Date.now() - 7 * 86_400_000);
    const [byStatus, byClaimStatus, sources, recentItems, latestDigest, openActions] = await Promise.all([
      this.prisma.intelItem.groupBy({ by: ['status'], _count: true }),
      this.prisma.intelClaim.groupBy({ by: ['status'], _count: true }),
      this.prisma.intelSource.findMany({
        orderBy: [{ enabled: 'desc' }, { tier: 'asc' }, { name: 'asc' }],
        select: {
          id: true, key: true, name: true, kind: true, tier: true, weight: true,
          enabled: true, failCount: true, lastError: true, lastFetchedAt: true,
          intervalHours: true, target: true, targetOverride: true,
          _count: { select: { items: true } },
        },
      }),
      this.prisma.intelItem.count({ where: { createdAt: { gte: since7 } } }),
      this.digest.latest(),
      this.prisma.intelClaim.count({ where: { actionStatus: 'OPEN', status: { in: ['CONFIRMED', 'MYTH'] } } }),
    ]);

    return {
      items: {
        byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count])),
        last7Days: recentItems,
      },
      claims: Object.fromEntries(byClaimStatus.map((s) => [s.status, s._count])),
      openActions,
      sources,
      disabledSources: DISABLED_SOURCES,
      xSearchEnabled: this.xSearch.enabled,
      openClawEnabled: this.openClaw.enabled,
      latestDigest: latestDigest
        ? { id: latestDigest.id, period: latestDigest.period, date: latestDigest.date, emailedAt: latestDigest.emailedAt }
        : null,
      productAreas: PRODUCT_AREAS,
    };
  }

  // ────────────────────────────────────────────────────────────
  //  IDDIA DEFTERI
  // ────────────────────────────────────────────────────────────

  @Get('claims')
  async claims(
    @Req() req: Request,
    @Query('status') status?: string,
    @Query('topic') topic?: string,
    @Query('area') area?: string,
    @Query('limit') limit?: string,
  ) {
    assertAdmin(req);
    return this.ledger.list({
      status: status || undefined,
      topic: topic || undefined,
      area: area || undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get('claims/:idOrSlug')
  async claim(@Req() req: Request, @Param('idOrSlug') idOrSlug: string) {
    assertAdmin(req);
    const claim = await this.ledger.get(idOrSlug);
    if (!claim) throw new BadRequestException('Iddia bulunamadi');
    return claim;
  }

  @Post('claims/:id/action')
  async setAction(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { actionStatus: string; note?: string },
  ) {
    assertAdmin(req);
    try {
      return await this.ledger.setAction(id, body.actionStatus, body.note);
    } catch (err: any) {
      throw new BadRequestException(err.message);
    }
  }

  /**
   * POST /intel/claims/:id/to-action — iddiadan SECILI sitelere aksiyon
   * plani maddesi ac (admin onayli kopru; otomatik uretim yok — bkz.
   * intel-action.service.ts). Iki-kaynak kurali burada da zorlanir.
   */
  @Post('claims/:id/to-action')
  async toAction(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { siteIds: string[]; title?: string; description?: string; impact?: 'high' | 'medium' | 'low'; effort?: 'easy' | 'medium' | 'hard' },
  ) {
    assertAdmin(req);
    return this.intelAction.toActionPlan(id, body ?? { siteIds: [] });
  }

  // ────────────────────────────────────────────────────────────
  //  HAM KAYITLAR — triage denetimi icin
  // ────────────────────────────────────────────────────────────

  @Get('items')
  async items(
    @Req() req: Request,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    assertAdmin(req);
    return this.prisma.intelItem.findMany({
      where: status ? { status } : undefined,
      orderBy: [{ createdAt: 'desc' }],
      take: Math.min(limit ? parseInt(limit, 10) : 100, 300),
      select: {
        id: true, url: true, title: true, publishedAt: true, status: true,
        relevance: true, topics: true, triageNote: true, engagement: true,
        source: { select: { name: true, tier: true } },
      },
    });
  }

  /**
   * Tek kaydin TAM icerigi — okunan metnin kendisi.
   *
   * NEDEN AYRI UC: fullText 60 bin karaktere kadar cikabiliyor; listede
   * 100 kayitla birlikte donmek paneli bogar. Liste hafif kalir, metin
   * yalnizca acilan satir icin cekilir.
   */
  @Get('items/:id')
  async item(@Req() req: Request, @Param('id') id: string) {
    assertAdmin(req);
    const found = await this.prisma.intelItem.findUnique({
      where: { id },
      select: {
        id: true, url: true, title: true, summary: true, fullText: true,
        author: true, publishedAt: true, status: true, relevance: true,
        topics: true, triageNote: true, engagement: true, meta: true,
        source: { select: { name: true, tier: true } },
      },
    });
    if (!found) throw new BadRequestException('Kayit bulunamadi');
    return found;
  }

  // ────────────────────────────────────────────────────────────
  //  KAYNAKLAR
  // ────────────────────────────────────────────────────────────

  @Post('sources/sync')
  async syncSources(@Req() req: Request) {
    assertAdmin(req);
    return this.collector.syncCatalog();
  }

  /** Devre disi kalmis kaynagi elle geri acar (hata sayacini sifirlar). */
  /**
   * Arama sorgusunu panelden degistir.
   *
   * `targetOverride` alanina yazilir, `target`'a DEGIL: syncCatalog() her
   * senkronda `target`'i koddan eziyor, oraya yazilan elle degisiklik bir
   * sonraki acilista sessizce kaybolurdu. Bos/null gonderilirse override
   * kaldirilir ve katalog degerine donulur.
   */
  @Post('sources/:id/target')
  async setSourceTarget(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { target?: string | null },
  ) {
    assertAdmin(req);
    const value = typeof body?.target === 'string' ? body.target.trim() : '';
    if (value.length > 2000) throw new BadRequestException('Sorgu 2000 karakteri asamaz');

    const updated = await this.prisma.intelSource.update({
      where: { id },
      data: {
        targetOverride: value || null,
        // Sorgu degisti — eski hata sayaci artik gecerli degil.
        failCount: 0,
        lastError: null,
      },
      select: { id: true, key: true, target: true, targetOverride: true },
    });
    return { ok: true, ...updated, etkin: updated.targetOverride ?? updated.target };
  }

  @Post('sources/:id/toggle')
  async toggleSource(@Req() req: Request, @Param('id') id: string, @Body() body: { enabled: boolean }) {
    assertAdmin(req);
    return this.prisma.intelSource.update({
      where: { id },
      data: { enabled: !!body.enabled, ...(body.enabled ? { failCount: 0, lastError: null } : {}) },
    });
  }

  /** Tek kaynagi hemen ceker — yeni feed eklendiginde beklemeden test icin. */
  /**
   * Tek kaynagi ceker — ARKA PLANDA. Bir X kaynagi iki sekme gezip her postu
   * actigi icin ~15 dakika surer; senkron beklemek Cloudflare 524'une takilir.
   */
  @Post('sources/:id/collect')
  async collectOne(@Req() req: Request, @Param('id') id: string) {
    assertAdmin(req);

    const kilit = `source:${id}`;
    if (CALISAN_ASAMALAR.has(kilit)) {
      return { ok: false, zatenCalisiyor: true, mesaj: 'Bu kaynak zaten cekiliyor' };
    }
    CALISAN_ASAMALAR.add(kilit);

    this.collector
      .collectSource(id)
      .then((n) => this.log.log(`[${id}] elle toplama: ${n} yeni kayit`))
      .catch((err) => this.log.warn(`[${id}] elle toplama hatasi: ${err?.message ?? err}`))
      .finally(() => CALISAN_ASAMALAR.delete(kilit));

    return { ok: true, baslatildi: true, mesaj: 'Arka planda basladi' };
  }

  // ────────────────────────────────────────────────────────────
  //  ELLE CALISTIRMA — cron beklemeden boru hattini surmek icin
  // ────────────────────────────────────────────────────────────

  /**
   * Boru hattini elle surer — ARKA PLANDA.
   *
   * NEDEN BEKLEMIYORUZ: bu asamalar dakikalarca surer (tam toplama turu ~2
   * saat). Senkron yanit beklemek Cloudflare'in ~100 saniyelik tavanina
   * takiliyor ve kullaniciya 524 donuyordu — is aslinda basariyla bitse bile.
   * Cloudflare tavani plan seviyesinde degistirilemedigi icin dogru cozum
   * istegi hemen kapatmak; panel zaten sayaclari yenileyerek ilerlemeyi
   * gosteriyor.
   */
  @Post('run/:stage')
  async run(@Req() req: Request, @Param('stage') stage: string) {
    assertAdmin(req);

    const isler: Record<string, () => Promise<unknown>> = {
      collect: () => this.collector.collectDue(),
      triage: () => this.triage.runPending(),
      analyze: () => this.analyst.runRelevant(),
      recompute: () => this.ledger.recomputeAll(),
    };
    const is = isler[stage];
    if (!is) throw new BadRequestException('Gecersiz asama: collect | triage | analyze | recompute');

    // Ust uste basilmayi engelle: iki triage turu ayni kayitlari isler,
    // iki toplama turu ayni tek tarayiciyi paylasip birbirini dusurur.
    if (CALISAN_ASAMALAR.has(stage)) {
      return { ok: false, zatenCalisiyor: true, mesaj: `${stage} zaten calisiyor` };
    }
    CALISAN_ASAMALAR.add(stage);

    // Bilerek await YOK. Hata yutulmasin diye sonuc loglaniyor.
    is()
      .then((sonuc) => this.log.log(`[${stage}] tamamlandi: ${JSON.stringify(sonuc)}`))
      .catch((err) => this.log.error(`[${stage}] basarisiz: ${err?.message ?? err}`))
      .finally(() => CALISAN_ASAMALAR.delete(stage));

    return { ok: true, baslatildi: stage, mesaj: 'Arka planda basladi — panel sayaclari ilerlemeyi gosterir' };
  }

  // ────────────────────────────────────────────────────────────
  //  OZET
  // ────────────────────────────────────────────────────────────

  @Get('digest/latest')
  async latestDigest(@Req() req: Request, @Query('period') period?: string) {
    assertAdmin(req);
    return this.digest.latest(period || undefined);
  }

  @Get('digest')
  async digests(@Req() req: Request, @Query('limit') limit?: string) {
    assertAdmin(req);
    return this.prisma.intelDigest.findMany({
      orderBy: { date: 'desc' },
      take: Math.min(limit ? parseInt(limit, 10) : 20, 60),
      select: { id: true, period: true, date: true, stats: true, emailedAt: true },
    });
  }

  /**
   * Ozet uretir — ARKA PLANDA. Editor notu icin LLM cagrisi yapiyor;
   * senkron beklemek Cloudflare'in ~100 saniyelik tavanina takilip yaniti
   * bos birakiyordu (panelde "Unexpected end of JSON input" olarak cikiyordu).
   */
  @Post('digest/build')
  async buildDigest(@Req() req: Request, @Body() body: { period?: string; send?: boolean }) {
    assertAdmin(req);
    const period = body?.period === 'weekly' ? 'weekly' : 'daily';

    const kilit = `digest:${period}`;
    if (CALISAN_ASAMALAR.has(kilit)) {
      return { ok: false, zatenCalisiyor: true, mesaj: `${period} ozet zaten uretiliyor` };
    }
    CALISAN_ASAMALAR.add(kilit);

    this.digest
      .build(period, body?.send !== false)
      .then((d) => this.log.log(`[digest:${period}] uretildi: ${d?.id ?? 'bos'}`))
      .catch((err) => this.log.error(`[digest:${period}] basarisiz: ${err?.message ?? err}`))
      .finally(() => CALISAN_ASAMALAR.delete(kilit));

    return { ok: true, baslatildi: period, mesaj: 'Ozet arka planda uretiliyor' };
  }

  // ────────────────────────────────────────────────────────────
  //  LINKEDIN OUTREACH BOTU (Faz 8) — /admin/linkedin
  // ────────────────────────────────────────────────────────────

  @Get('linkedin/overview')
  async linkedinOverview(@Req() req: Request) {
    assertAdmin(req);
    return this.linkedin.overview();
  }

  /** CSV'den yapistirilan satirlar: ad,soyad,firma,unvan,sektor,kademe,profileUrl — profileUrl tekil (upsert) */
  @Post('linkedin/import')
  async linkedinImport(@Req() req: Request, @Body() body: { rows?: ImportRow[] }) {
    assertAdmin(req);
    const rows = Array.isArray(body?.rows) ? body.rows : null;
    if (!rows) throw new BadRequestException('rows dizisi gerekli');
    if (rows.length > 5000) throw new BadRequestException('Tek seferde en fazla 5000 satır');
    return this.linkedin.importRows(rows);
  }

  @Post('linkedin/pause')
  async linkedinPause(@Req() req: Request, @Body() body: { reason?: string }) {
    assertAdmin(req);
    return this.linkedin.pause(typeof body?.reason === 'string' ? body.reason.slice(0, 500) : undefined);
  }

  @Post('linkedin/resume')
  async linkedinResume(@Req() req: Request) {
    assertAdmin(req);
    return this.linkedin.resume();
  }

  /**
   * Elle tick.
   *   - KURU tick SENKRON: 1-3 profil (~1-2 dk), sonuc `actions` ile doner
   *     (panel kuru sonucu aninda gosterir). `force:true` calisma penceresini asar.
   *   - GERCEK tick ARKA PLANDA: islemler arasi 2-6 dk bekleme ile 15 dk'ya
   *     kadar surer; HTTP istegi bu kadar acik tutulmaz. `{ started:true,
   *     dryRun:false, actions:[] }` doner; sonuc durum kartinda / son kayitlarda.
   * Elle tick'te rastgele atlama (jitter) YOK; ayni anda ikinci tick reddedilir.
   */
  @Post('linkedin/tick')
  async linkedinTick(@Req() req: Request, @Body() body: { dryRun?: boolean; research?: string[]; force?: boolean }) {
    assertAdmin(req);
    const kilit = 'linkedin:tick';
    if (CALISAN_ASAMALAR.has(kilit)) {
      return { actions: [], reason: 'Tick zaten çalışıyor' };
    }
    const dryRun = body?.dryRun !== false;
    const research = Array.isArray(body?.research) ? body.research.filter((s) => typeof s === 'string') : undefined;
    CALISAN_ASAMALAR.add(kilit);

    if (dryRun) {
      try {
        return await this.linkedin.tick({ dryRun: true, research, force: body?.force === true, jitter: false });
      } finally {
        CALISAN_ASAMALAR.delete(kilit);
      }
    }

    this.linkedin
      .tick({ dryRun: false, research, jitter: false })
      .then((r) => this.log.log(`LinkedIn gerçek tick bitti: ${r.actions.length} işlem${r.paused ? ' — bot duraklatıldı' : ''}${r.reason ? ` (${r.reason.slice(0, 120)})` : ''}`))
      .catch((err) => this.log.warn(`LinkedIn gerçek tick hatası: ${err?.message ?? err}`))
      .finally(() => CALISAN_ASAMALAR.delete(kilit));

    return { started: true, dryRun: false, actions: [], reason: 'Gerçek tick arka planda başladı — sonuç durum kartında ve son kayıtlarda' };
  }

  /**
   * Kullanicinin yapistirdigi LinkedIn kisi arama linklerini gezip aday yazar (GONDERIM YOK).
   * Uzun surdugu icin arka planda calisir; sonuc panelde "son kayitlar" listesinde gorunur.
   */
  @Post('linkedin/research-urls')
  async linkedinResearchUrls(
    @Req() req: Request,
    @Body() body: { urls?: string; kampanya?: string; sektor?: string; dryRun?: boolean },
  ) {
    assertAdmin(req);
    const { urls, gecersiz } = parseSearchUrls(body?.urls ?? '');
    if (urls.length === 0) {
      return { started: false, urls: 0, gecersiz, reason: 'Geçerli LinkedIn kişi arama linki bulunamadı' };
    }
    const kilit = 'linkedin:tick';
    if (CALISAN_ASAMALAR.has(kilit)) return { started: false, urls: urls.length, gecersiz, reason: 'Tick zaten çalışıyor' };
    CALISAN_ASAMALAR.add(kilit);

    const opts = { kampanya: body?.kampanya, sektor: body?.sektor ?? null, dryRun: body?.dryRun === true };
    if (opts.dryRun) {
      try {
        return { started: true, urls: urls.length, gecersiz, ...(await this.linkedin.researchUrls(urls, opts)) };
      } finally {
        CALISAN_ASAMALAR.delete(kilit);
      }
    }

    this.linkedin
      .researchUrls(urls, opts)
      .then((r) => this.log.log(`LinkedIn link taramasi bitti: ${r.sonuclar.reduce((a, x) => a + x.yeni, 0)} yeni aday`))
      .catch((err) => this.log.warn(`LinkedIn link taramasi hatası: ${err?.message ?? err}`))
      .finally(() => CALISAN_ASAMALAR.delete(kilit));

    return { started: true, urls: urls.length, gecersiz, reason: `${urls.length} link arka planda taranıyor — sonuç son kayıtlarda` };
  }

  /** Kayitlarin kampanyasini toplu degistir (panelden secim) */
  @Post('linkedin/prospects/kampanya')
  async linkedinSetKampanya(@Req() req: Request, @Body() body: { ids?: string[]; kampanya?: string }) {
    assertAdmin(req);
    const ids = Array.isArray(body?.ids) ? body.ids.filter((x) => typeof x === 'string').slice(0, 500) : [];
    if (ids.length === 0) return { updated: 0 };
    return this.linkedin.setKampanya(ids, body?.kampanya);
  }

  @Post('linkedin/prospects/:id/skip')
  async linkedinSkip(@Req() req: Request, @Param('id') id: string) {
    assertAdmin(req);
    return this.linkedin.skip(id);
  }
}
