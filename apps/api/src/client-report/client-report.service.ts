import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AiKpisService, latestReadinessKpi } from '../audit/ai-kpis.service.js';
import { AiCitationTrackerService } from '../audit/ai-citation-tracker.service.js';
import { ActionPlansService } from '../action-plans/action-plans.service.js';
import { readCrawlAccess } from '../sites/crawl-access.js';
import { QuotaService } from '../billing/quota.service.js';
import { loadPlanLockedIds } from '../articles/plan-lock.js';
import { unbrandedOnly } from '../audit/brand-in-query.js';
import { rivalsFromCompetitors, shareOfVoiceList } from '../audit/share-of-voice.js';
import { buildClientReport, type RaporGirdisi } from './client-report-build.js';
import {
  PAYLASIM_ONEKI, SITE_BASINA_PAYLASIM, anahtarCoz, gecerliGun, gecerliToken, paylasimAnahtari, snapshotSigdir,
  tokenOneki, yeniToken, type PaylasimKaydi,
} from './client-report-share.js';
import type { MusteriRaporu } from './client-report.types.js';

const DAY_MS = 86_400_000;
export const RAPOR_BULUNAMADI = 'Rapor bulunamadı ya da paylaşım süresi doldu';

/** SiteImage durumlari: alt metni sitede GERCEKTEN yazilmis (uygulandi / dogrulandi) */
const DUZELTILMIS_GORSEL = ['APPLIED', 'VERIFIED'];

export interface PaylasimOzeti {
  token: string;
  /** Web yolu — alan adi panelin kendi kokenidir (/rapor/<token>) */
  yol: string;
  olusturuldu: string;
  sonGecerlilik: string;
}

/**
 * Musteri raporu — kayitli son olcumlerden TEK JSON derler; paylasim
 * snapshot'larini yonetir.
 *
 * MALIYET YOK: hicbir yol tarama, AI sorgusu ya da LLM cagrisi baslatmaz;
 * yalniz DB okur (bu yuzden tum planlarda ve suresi dolan denemede acik).
 * Panel KPI'lariyla ayni sayilar icin ayni servisler kullanilir:
 * AuditService.getLatest (erisim engeli notuyla), AiKpisService.getKpis,
 * AiCitationTrackerService.getHistory(headline), ActionPlansService.list.
 */
@Injectable()
export class ClientReportService {
  private readonly log = new Logger(ClientReportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly kpis: AiKpisService,
    private readonly tracker: AiCitationTrackerService,
    private readonly actionPlans: ActionPlansService,
    private readonly quota: QuotaService,
  ) {}

  async build(siteId: string, now = new Date()): Promise<MusteriRaporu> {
    return buildClientReport(await this.girdi(siteId, now), now);
  }

  /** Rapor girdisini toplar. Bir kaynak hata verirse o bolum "olculemedi" olur; rapor dusmez. */
  async girdi(siteId: string, now: Date): Promise<RaporGirdisi> {
    const site = await this.prisma.site.findUnique({
      where: { id: siteId },
      select: { name: true, url: true, userId: true, ingestSecret: true, brain: { select: { competitors: true } } },
    });
    if (!site) throw new NotFoundException('Site bulunamadı');

    const d7 = new Date(now.getTime() - 7 * DAY_MS);
    const d30 = new Date(now.getTime() - 30 * DAY_MS);
    const yut = <T>(p: Promise<T>, yedek: T, ad: string): Promise<T> =>
      p.catch((err) => {
        this.log.warn(`[${siteId}] rapor kaynagi okunamadi (${ad}): ${String(err?.message ?? err).slice(0, 200)}`);
        return yedek;
      });

    const [
      audit, erisim, manset, kosum, kpi, botSatirlari, botVarMi, yayinda, takvimde, plan, sovSatirlari, duzeltilen, envanterVar, hazirlik,
    ] = await Promise.all([
      yut(this.audit.getLatest(siteId), null, 'audit'),
      yut(readCrawlAccess(this.prisma, siteId), null, 'crawl-access'),
      yut(this.tracker.getHistory(siteId, 30, true) as Promise<any>, null, 'citation-headline'),
      yut(this.prisma.aiCitationRun.findFirst({ where: { siteId }, orderBy: { runAt: 'desc' }, select: { runAt: true, providers: true } }), null, 'citation-run'),
      yut(this.kpis.getKpis(siteId), null, 'ai-kpis'),
      yut(this.prisma.aiCrawlerHit.findMany({ where: { siteId, date: { gte: d30 } }, select: { date: true, bot: true, hits: true } }), [], 'crawler-hits'),
      yut(this.prisma.aiCrawlerHit.findFirst({ where: { siteId }, select: { id: true } }), null, 'crawler-any'),
      yut(this.prisma.article.count({ where: { siteId, status: 'PUBLISHED' } }), 0, 'articles-published'),
      yut(this.takvimdeki(siteId, site.userId), 0, 'articles-scheduled'),
      yut(this.actionPlans.list(siteId), [], 'action-plan'),
      // Ses payi listesi: KPI ile AYNI pencere ve havuz (son 7 gun, markasiz, app prompt'lari haric)
      yut(this.prisma.geoPromptRun.findMany({
        where: { siteId, date: { gte: d7 }, prompt: { trackedAppId: null } },
        select: { brandMentioned: true, brandInQuery: true, competitors: true },
      }), [], 'sov'),
      yut(this.prisma.siteImage.count({ where: { siteId, status: { in: DUZELTILMIS_GORSEL } } }), 0, 'images-fixed'),
      yut(this.prisma.siteImage.findFirst({ where: { siteId }, select: { id: true } }), null, 'images-any'),
      yut(this.readinessWithDate(siteId), null, 'agent-readiness'),
    ]);

    const son7 = botSatirlari.filter((r) => r.date >= d7).reduce((a, r) => a + r.hits, 0);
    const son30 = botSatirlari.reduce((a, r) => a + r.hits, 0);
    const botToplam = new Map<string, number>();
    for (const r of botSatirlari) botToplam.set(r.bot, (botToplam.get(r.bot) ?? 0) + r.hits);

    const sov = shareOfVoiceList(
      unbrandedOnly(sovSatirlari as Array<{ brandMentioned: boolean; brandInQuery: boolean; competitors: unknown }>).map((r) => ({
        brandPresent: r.brandMentioned,
        rivals: rivalsFromCompetitors(r.competitors as any[]),
      })),
      site.name,
    );

    const headline = manset?.headline;
    return {
      site: { name: site.name, url: site.url },
      audit: audit
        ? {
          ranAt: audit.ranAt,
          overallScore: audit.overallScore,
          geoScore: audit.geoScore,
          checks: audit.checks,
          issues: audit.issues,
          accessBlocked: (audit as any).accessBlocked ?? null,
        }
        : null,
      erisimEngeli: !audit && erisim ? { reason: erisim.reason, hint: erisim.hint } : null,
      aiManset: headline ? { score: headline.score ?? null, method: headline.method ?? null } : null,
      aiKosum: kosum ? { runAt: kosum.runAt, providers: kosum.providers } : null,
      kpi: kpi
        ? { mentionRate: kpi.mentionRate.value, shareOfVoice: kpi.shareOfVoice.value, unbrandedCount: kpi.queryMix.unbranded }
        : null,
      botlar: {
        // Takip kodu kurulmadiysa ve hic kayit yoksa "0 ziyaret" bir olcum degildir
        takipVar: !!site.ingestSecret || !!botVarMi,
        son7,
        son30,
        botlar: [...botToplam.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([ad, ziyaret]) => ({ ad, ziyaret })),
      },
      icerik: { yayinda, takvimde },
      aksiyonPlani: plan.map((i) => ({
        title: i.title, description: i.description, impact: i.impact, effort: i.effort, status: i.status, source: i.source, sourceRef: i.sourceRef,
      })),
      rakipler: { tanimli: tanimliRakipler(site.brain?.competitors, site.name), sesPayi: sov },
      gorselDuzeltilen: envanterVar ? duzeltilen : null,
      ajanHazirligi: hazirlik,
    };
  }

  /**
   * Uretilecek takvim yazisi sayisi. Plan kilidindeki yazilar (deneme hakki
   * doldu; articles/plan-lock.ts) uretilmeyecegi icin musteriye "takvimde"
   * diye sayilmaz — panel KpiRow da kilitlileri ayri soyler.
   */
  private async takvimdeki(siteId: string, userId: string): Promise<number> {
    const rows = await this.prisma.article.findMany({ where: { siteId, status: 'SCHEDULED' }, select: { id: true } });
    if (rows.length === 0) return 0;
    const kilitli = await loadPlanLockedIds(this.prisma, this.quota, userId);
    return rows.filter((r) => !kilitli.has(r.id)).length;
  }

  private async readinessWithDate(siteId: string) {
    const kpi = await latestReadinessKpi(this.prisma, siteId);
    if (!kpi) return null;
    const scan = await this.prisma.agentReadinessScan.findFirst({ where: { siteId }, orderBy: { ranAt: 'desc' }, select: { ranAt: true } });
    return { score: kpi.score, measured: kpi.measured, reason: kpi.reason, ranAt: scan?.ranAt?.toISOString() ?? null };
  }

  // ─── Paylasim ─────────────────────────────────────────────────────

  async listShares(siteId: string, now = new Date()): Promise<PaylasimOzeti[]> {
    const rows = await this.prisma.kvStore.findMany({
      where: { AND: [{ key: { startsWith: PAYLASIM_ONEKI } }, { key: { endsWith: `:${siteId}` } }], expiresAt: { gt: now } },
      // Govde (snapshot) okunmaz: liste yalniz anahtar ve tarihlerden cizilir
      select: { key: true, expiresAt: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: SITE_BASINA_PAYLASIM,
    });
    const out: PaylasimOzeti[] = [];
    for (const r of rows) {
      const c = anahtarCoz(r.key);
      // Harmanlama harf duyarsiz: anahtar BIREBIR bu siteye ait olmali
      if (!c || c.siteId !== siteId || !r.expiresAt) continue;
      out.push({ token: c.token, yol: `/rapor/${c.token}`, olusturuldu: r.updatedAt.toISOString(), sonGecerlilik: r.expiresAt.toISOString() });
    }
    return out;
  }

  async createShare(siteId: string, userId: string | null, gunGirdisi: unknown, now = new Date()): Promise<PaylasimOzeti> {
    const etkin = await this.prisma.kvStore.count({
      where: { AND: [{ key: { startsWith: PAYLASIM_ONEKI } }, { key: { endsWith: `:${siteId}` } }], expiresAt: { gt: now } },
    });
    if (etkin >= SITE_BASINA_PAYLASIM) {
      throw new BadRequestException(`Bu site için en fazla ${SITE_BASINA_PAYLASIM} etkin bağlantı olabilir. Eski bağlantılardan birini kaldırıp tekrar dene.`);
    }
    const gun = gecerliGun(gunGirdisi);
    const rapor = await this.build(siteId, now);
    const sonGecerlilik = new Date(now.getTime() + gun * DAY_MS);
    const token = yeniToken();
    const kayit: PaylasimKaydi = {
      v: 1, siteId, olusturan: userId, olusturuldu: now.toISOString(), sonGecerlilik: sonGecerlilik.toISOString(), rapor,
    };
    let value: string;
    try {
      value = snapshotSigdir(kayit);
    } catch {
      throw new BadRequestException('Rapor paylaşım için çok büyük. Lütfen destekle iletişime geç.');
    }
    await this.prisma.kvStore.create({ data: { key: paylasimAnahtari(token, siteId), value, expiresAt: sonGecerlilik } });
    return { token, yol: `/rapor/${token}`, olusturuldu: kayit.olusturuldu, sonGecerlilik: kayit.sonGecerlilik };
  }

  /** Geri alma: satir silinir; baska sitenin tokeni bu siteden silinemez (anahtar siteId tasir) */
  async revokeShare(siteId: string, token: string): Promise<{ ok: true }> {
    if (!gecerliToken(token)) throw new NotFoundException(RAPOR_BULUNAMADI);
    const key = paylasimAnahtari(token, siteId);
    const row = await this.prisma.kvStore.findUnique({ where: { key }, select: { key: true } });
    // Harmanlama esitligi yetmez (harf duyarsiz): bulunan anahtar birebir ayni olmali
    if (!row || row.key !== key) throw new NotFoundException(RAPOR_BULUNAMADI);
    await this.prisma.kvStore.deleteMany({ where: { key } });
    return { ok: true };
  }

  /**
   * Herkese acik okuma. Gecersiz bicim, olmayan, geri alinmis, suresi dolmus
   * ya da sitesi silinmis paylasim AYNI 404'u alir (hangisi oldugu sizmaz).
   */
  async getPublic(token: string, now = new Date()): Promise<{ rapor: MusteriRaporu; paylasim: { olusturuldu: string; sonGecerlilik: string } }> {
    if (!gecerliToken(token)) throw new NotFoundException(RAPOR_BULUNAMADI);
    const rows = await this.prisma.kvStore.findMany({
      where: { key: { startsWith: tokenOneki(token) } },
      select: { key: true, value: true, expiresAt: true },
      take: 3,
    });
    // LIKE '_' joker ve harf duyarsiz harmanlama: token BIREBIR eslesmeli
    const row = rows.find((r) => anahtarCoz(r.key)?.token === token);
    if (!row) throw new NotFoundException(RAPOR_BULUNAMADI);
    if (!row.expiresAt || row.expiresAt.getTime() <= now.getTime()) {
      // Gunluk temizlik gelmeden okunduysa: sure dolmus satir hemen silinir
      await this.prisma.kvStore.deleteMany({ where: { key: row.key, expiresAt: { lte: now } } }).catch(() => undefined);
      throw new NotFoundException(RAPOR_BULUNAMADI);
    }
    let kayit: PaylasimKaydi;
    try {
      kayit = JSON.parse(row.value) as PaylasimKaydi;
    } catch {
      throw new NotFoundException(RAPOR_BULUNAMADI);
    }
    const c = anahtarCoz(row.key);
    if (!kayit?.rapor || !c || kayit.siteId !== c.siteId) throw new NotFoundException(RAPOR_BULUNAMADI);
    // Site silme kv anahtarini zaten siler; ikinci kat: site yoksa rapor yayinda kalmaz
    const site = await this.prisma.site.findUnique({ where: { id: c.siteId }, select: { id: true } });
    if (!site || site.id !== c.siteId) throw new NotFoundException(RAPOR_BULUNAMADI);
    return { rapor: kayit.rapor, paylasim: { olusturuldu: kayit.olusturuldu, sonGecerlilik: kayit.sonGecerlilik } };
  }
}

/** Brain rakip listesi (dize ya da { name }) — ai-citation resolveCompetitors ile ayni okuma */
export function tanimliRakipler(v: unknown, marka: string): string[] {
  const out: string[] = [];
  for (const c of Array.isArray(v) ? v : []) {
    const ad = typeof c === 'string' ? c : c && typeof c === 'object' ? (c as { name?: unknown }).name : null;
    if (typeof ad === 'string' && ad.trim().length >= 3 && ad.trim().toLowerCase() !== marka.toLowerCase()) out.push(ad.trim());
  }
  return [...new Set(out)].slice(0, 10);
}
