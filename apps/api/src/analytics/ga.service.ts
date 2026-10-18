import { Injectable, Logger } from '@nestjs/common';
import { google } from 'googleapis';
import { PrismaService } from '../prisma/prisma.service.js';
import { GaOAuthService } from '../auth/ga-oauth.service.js';
import type { GaLandingRow } from './search-opportunity.js';
import { buildConversionChecks, type ConversionCheck, type GaEventRow } from './ga-key-events.js';

/** GA4 donusum (onemli etkinlik) kurulum kontrolu — panelde kontrol listesi */
export type GaKeyEventSetup =
  | { status: 'not_connected' }
  | { status: 'error'; message: string }
  | {
      status: 'ok';
      propertyId: string;
      days: number;
      checks: ConversionCheck[];
      /** Mulkteki onemli etkinlik adlari */
      keyEvents: string[];
      /** admin = Admin API'deki tanimli liste; report = yalniz donemde tetiklenenler (Admin API okunamadi) */
      keyEventsSource: 'admin' | 'report';
      /** Admin API okunamadiysa kullaniciya gosterilecek neden */
      adminNote: string | null;
      fetchedAt: string;
    };

export interface GaPagePerf {
  pagePath: string;
  sessions: number;
  engagementRate: number;     // 0..1
  avgEngagementSec: number;
  conversions: number;
  bounceRate: number;          // 0..1 (1 - engagementRate yaklaşığı)
}

export interface GaSiteSummary {
  totalSessions: number;
  totalConversions: number;
  avgEngagementSec: number;
  avgBounceRate: number;
  topPages: GaPagePerf[];
}

/**
 * GA4 Data API wrapper.
 * Tum metodlar opsiyonel calisir — site bagli degilse null doner.
 */
@Injectable()
export class GaService {
  private readonly log = new Logger(GaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gaOAuth: GaOAuthService,
  ) {}

  async fetchSiteSummary(siteId: string, days = 30): Promise<GaSiteSummary | null> {
    const site = await this.prisma.site.findUnique({ where: { id: siteId } });
    if (!site?.gaPropertyId || !site?.gaRefreshToken) return null;

    const client = await this.gaOAuth.getAuthenticatedClient(siteId);
    if (!client) return null;

    try {
      const data = google.analyticsdata({ version: 'v1beta', auth: client as any });

      const startDate = `${days}daysAgo`;

      const res = await data.properties.runReport({
        property: `properties/${site.gaPropertyId}`,
        requestBody: {
          dateRanges: [{ startDate, endDate: 'today' }],
          dimensions: [{ name: 'pagePath' }],
          metrics: [
            { name: 'sessions' },
            { name: 'engagementRate' },
            { name: 'userEngagementDuration' },
            // 2024-05-06'da `conversions` → `keyEvents` (GA4 Data API changelog;
            // guncel semada `conversions` yok). Donus alani adi web icin ayni kaldi.
            { name: 'keyEvents' },
            { name: 'bounceRate' },
          ],
          orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
          limit: '50',
        },
      } as any);

      const rows = res.data.rows ?? [];
      const topPages: GaPagePerf[] = rows.map((r: any) => {
        const sessions = Number(r.metricValues?.[0]?.value ?? 0);
        const engagementRate = Number(r.metricValues?.[1]?.value ?? 0);
        const userEngagementDuration = Number(r.metricValues?.[2]?.value ?? 0);
        const conversions = Number(r.metricValues?.[3]?.value ?? 0);
        const bounceRate = Number(r.metricValues?.[4]?.value ?? 0);
        return {
          pagePath: r.dimensionValues?.[0]?.value ?? '/',
          sessions,
          engagementRate,
          avgEngagementSec: sessions > 0 ? userEngagementDuration / sessions : 0,
          conversions,
          bounceRate,
        };
      });

      const totalSessions = topPages.reduce((s, p) => s + p.sessions, 0);
      const totalConversions = topPages.reduce((s, p) => s + p.conversions, 0);
      const weightedEngagement =
        totalSessions > 0
          ? topPages.reduce((s, p) => s + p.avgEngagementSec * p.sessions, 0) / totalSessions
          : 0;
      const weightedBounce =
        totalSessions > 0
          ? topPages.reduce((s, p) => s + p.bounceRate * p.sessions, 0) / totalSessions
          : 0;

      return {
        totalSessions,
        totalConversions,
        avgEngagementSec: weightedEngagement,
        avgBounceRate: weightedBounce,
        topPages,
      };
    } catch (err: any) {
      this.log.warn(`[${siteId}] GA fetch error: ${err.message}`);
      return null;
    }
  }

  /**
   * Organik arama oturumlarinin acilis sayfalari (GSC × GA4 arama firsatlari icin).
   * Boyut/metrik adlari GA4 Data API semasindan: hostName, landingPage (yalniz
   * yol), sessionDefaultChannelGroup = "Organic Search"; keyEvents ve
   * sessionKeyEventRate (eski conversions / sessionConversionRate).
   * Site bagli degilse ya da GA hata verirse null — cagiran "veri yok" der.
   */
  async fetchOrganicLandingPages(
    siteId: string,
    startDate: string,
    endDate: string,
    limit = 1000,
  ): Promise<{ rows: GaLandingRow[]; totalRows: number } | null> {
    const site = await this.prisma.site.findUnique({ where: { id: siteId } });
    if (!site?.gaPropertyId || !site?.gaRefreshToken) return null;

    const client = await this.gaOAuth.getAuthenticatedClient(siteId);
    if (!client) return null;

    try {
      const data = google.analyticsdata({ version: 'v1beta', auth: client as any });
      const res = await data.properties.runReport({
        property: `properties/${site.gaPropertyId}`,
        requestBody: {
          dateRanges: [{ startDate, endDate }],
          dimensions: [{ name: 'hostName' }, { name: 'landingPage' }],
          metrics: [
            { name: 'sessions' },
            { name: 'engagementRate' },
            { name: 'keyEvents' },
            { name: 'sessionKeyEventRate' },
          ],
          dimensionFilter: {
            filter: {
              fieldName: 'sessionDefaultChannelGroup',
              stringFilter: { matchType: 'EXACT', value: 'Organic Search' },
            },
          },
          orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
          limit: String(limit),
        },
      } as any);

      const rows: GaLandingRow[] = (res.data.rows ?? []).map((r: any) => ({
        hostName: r.dimensionValues?.[0]?.value ?? '',
        landingPage: r.dimensionValues?.[1]?.value ?? '',
        sessions: Number(r.metricValues?.[0]?.value ?? 0),
        engagementRate: Number(r.metricValues?.[1]?.value ?? 0),
        keyEvents: Number(r.metricValues?.[2]?.value ?? 0),
        sessionKeyEventRate: Number(r.metricValues?.[3]?.value ?? 0),
      }));
      return { rows, totalRows: Number(res.data.rowCount ?? rows.length) };
    } catch (err: any) {
      this.log.warn(`[${siteId}] GA organik acilis sayfalari hata: ${err.message}`);
      return null;
    }
  }

  /**
   * Telefon tiklamasi ve form/randevu gonderimi onemli etkinlik olarak
   * olculuyor mu (ga-key-events.ts). Iki okuma:
   *  1) Data API: son N gunde olay adlari + eventCount + keyEvents
   *  2) Admin API properties.keyEvents.list: tanimli onemli etkinlikler —
   *     "tanimli ama hic tetiklenmedi" durumunu yalniz bu gosterir. Okunamazsa
   *     (API kapali, yetki) kontrol yine calisir, not dusulur.
   * Ikisi de analytics.readonly kapsamiyla calisir (baglanti bu kapsamla kurulu).
   */
  async fetchKeyEventSetup(siteId: string, days = 28): Promise<GaKeyEventSetup> {
    const span = Number.isFinite(days) ? Math.min(Math.max(Math.trunc(days), 7), 90) : 28;
    const site = await this.prisma.site.findUnique({ where: { id: siteId } });
    if (!site?.gaPropertyId || !site?.gaRefreshToken) return { status: 'not_connected' };
    const client = await this.gaOAuth.getAuthenticatedClient(siteId);
    if (!client) return { status: 'not_connected' };
    const property = `properties/${site.gaPropertyId}`;

    let rows: GaEventRow[];
    try {
      const data = google.analyticsdata({ version: 'v1beta', auth: client as any });
      const res = await data.properties.runReport({
        property,
        requestBody: {
          dateRanges: [{ startDate: `${span}daysAgo`, endDate: 'today' }],
          dimensions: [{ name: 'eventName' }],
          metrics: [{ name: 'eventCount' }, { name: 'keyEvents' }],
          orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
          limit: '500',
        },
      } as any);
      rows = (res.data.rows ?? []).map((r: any) => ({
        eventName: String(r.dimensionValues?.[0]?.value ?? ''),
        eventCount: Number(r.metricValues?.[0]?.value ?? 0),
        keyEvents: Number(r.metricValues?.[1]?.value ?? 0),
      }));
    } catch (err: any) {
      this.log.warn(`[${siteId}] GA olay raporu hata: ${String(err?.message ?? err).slice(0, 200)}`);
      const msg = String(err?.message ?? '');
      if (err?.code === 401 || /invalid_grant|unauthorized/i.test(msg)) {
        return { status: 'error', message: 'Google Analytics bağlantısının yetkisi geçersiz. Bağlantıyı kesip yeniden bağlayın.' };
      }
      if (err?.code === 403 || /permission/i.test(msg)) {
        return { status: 'error', message: 'Bağlı Google hesabının seçili GA4 mülkünü okuma yetkisi yok. Bağlantılar sayfasından mülkü kontrol edin.' };
      }
      return { status: 'error', message: 'GA4 olay verisi şu an okunamadı. Birazdan tekrar deneyin.' };
    }

    let configured: string[] | null = null;
    let adminNote: string | null = null;
    try {
      const admin = google.analyticsadmin({ version: 'v1beta', auth: client as any });
      const names: string[] = [];
      let pageToken: string | undefined;
      // Standart mulkte en fazla 30 onemli etkinlik var; sayfa siniri yalniz guvenlik icin
      for (let page = 0; page < 5; page++) {
        const r = await admin.properties.keyEvents.list({ parent: property, pageSize: 200, pageToken });
        for (const k of r.data.keyEvents ?? []) if (k.eventName) names.push(k.eventName);
        pageToken = r.data.nextPageToken ?? undefined;
        if (!pageToken) break;
      }
      configured = names;
    } catch (err: any) {
      const msg = String(err?.message ?? '');
      this.log.warn(`[${siteId}] GA onemli etkinlik listesi okunamadi: ${msg.slice(0, 200)}`);
      adminNote = /has not been used|is disabled|SERVICE_DISABLED/i.test(msg)
        ? 'Google Analytics Admin API sunucu projesinde kapalı olduğu için tanımlı önemli etkinlik listesi okunamadı; yalnız son dönemde tetiklenenler gösteriliyor.'
        : 'Tanımlı önemli etkinlik listesi okunamadı; yalnız son dönemde tetiklenenler gösteriliyor.';
    }

    return {
      status: 'ok',
      propertyId: site.gaPropertyId,
      days: span,
      checks: buildConversionChecks({ rows, configuredKeyEvents: configured }),
      keyEvents: configured ?? rows.filter((r) => r.keyEvents > 0).map((r) => r.eventName),
      keyEventsSource: configured ? 'admin' : 'report',
      adminNote,
      fetchedAt: new Date().toISOString(),
    };
  }

  /**
   * Topic engine icin "underperforming" sayfalari donder — yuksek session
   * ama yuksek bounce. Ranker'a "bu konuda makale yenile/derinlestir" sinyali.
   */
  async getUnderperformingPages(siteId: string, days = 30): Promise<GaPagePerf[]> {
    const summary = await this.fetchSiteSummary(siteId, days);
    if (!summary) return [];
    return summary.topPages.filter(
      (p) => p.sessions >= 50 && p.bounceRate >= 0.7 && p.conversions === 0,
    );
  }
}
