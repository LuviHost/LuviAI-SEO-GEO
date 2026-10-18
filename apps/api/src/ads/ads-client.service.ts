import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { GoogleAdsClientService } from './google-ads-client.service.js';
import { MetaAdsClientService } from './meta-ads-client.service.js';
import type { BudgetWriteResult, LiveBudgetResult } from './live-budget.js';

export interface CampaignMetrics {
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
  ctr: number;
  cpc: number;
  roas: number;
}

/**
 * A/B adiminin okudugu reklam satiri (google/meta getAdVariantMetrics, son 7 gun).
 *
 * NEDEN grup + uygunluk: eski satirda reklam grubu / reklam seti yoktu; A/B
 * tum kampanyadaki reklamlari tek havuzda siralayip baska gruplarin TEK
 * reklamini duraklatiyor (o gruplar yayindan dusuyordu) ve yayinda olmayan
 * (grubu duraklatilmis) bir reklami kazanan secebiliyordu. Artik reklamlar
 * yalniz kendi grubunda ve yalniz eligible olanlar karsilastirilir.
 *
 * Metrik alani null: platform alani gondermedi ya da okunamadi. Boyle bir
 * reklam karsilastirmaya girmez (ne kazanan secilir ne duraklatilir).
 */
export interface AdVariant {
  /** Platformdaki reklam kimligi (Google ad_group_ad.ad.id, Meta ad id) */
  adId: string;
  /** Duraklatma hedefi: Google ad_group_ad kaynak adi, Meta reklam kimligi */
  target: string;
  /** Google reklam grubu / Meta reklam seti kimligi */
  groupId: string;
  /** Grubun platformdaki adi (gecmiste gosterilir; bos olabilir) */
  groupName: string;
  /**
   * A/B'ye girebilir: reklam, grubu ve kampanya katmani su an yayinda olabilir
   * ve karsilastirma kampanyanin hedefiyle uyumlu (platform istemcisindeki
   * kurallar). false olan reklama hicbir sey yapilmaz.
   */
  eligible: boolean;
  impressions: number | null;
  /** Google tiklama, Meta baglanti tiklamasi (inline_link_clicks) */
  clicks: number | null;
  /** Gosterim basina karsilastirilan donusum (kesirli olabilir) */
  conversions: number | null;
  /** Donusum degeri (hesap para biriminde) */
  conversionValue: number | null;
}

/**
 * Reklam durumu yazimi. uncertain: istek gitti ama sonucu bilinmiyor (zaman
 * asimi, ag hatasi, 5xx ya da okunamayan basarili yanit) — reklam
 * duraklatilmis da olabilir, olmayabilir de.
 */
export interface AdStatusWriteResult {
  ok: boolean;
  error?: string;
  uncertain?: boolean;
}

/**
 * AdsClientService — platform router.
 *
 * Eski AdsMcpClientService (Ryze AI MCP) yerine geldi. Direkt resmi
 * Google Ads + Meta Marketing API'lerini cagirir.
 *
 * Hicbir 3. parti bagimliligi yok. Sifir SaaS aboneligi.
 */
@Injectable()
export class AdsClientService {
  private readonly log = new Logger(AdsClientService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly google: GoogleAdsClientService,
    private readonly meta: MetaAdsClientService,
  ) {}

  /**
   * Bir kampanyanin gercek metriklerini ceker.
   */
  async getMetrics(siteId: string, platform: 'google_ads' | 'meta_ads', externalId: string): Promise<CampaignMetrics | null> {
    try {
      if (platform === 'google_ads') {
        return await this.google.getCampaignMetrics(siteId, externalId);
      }
      return await this.meta.getCampaignInsights(siteId, externalId);
    } catch (err: any) {
      this.log.warn(`[${siteId}/${platform}/${externalId}] Metrics fail: ${err.message}`);
      return null;
    }
  }

  /**
   * Pause/enable.
   */
  async setStatus(siteId: string, platform: 'google_ads' | 'meta_ads', externalId: string, paused: boolean): Promise<{ ok: boolean; error?: string }> {
    if (platform === 'google_ads') {
      return this.google.setCampaignStatus(siteId, externalId, paused ? 'PAUSED' : 'ENABLED');
    }
    return this.meta.setCampaignStatus(siteId, externalId, paused ? 'PAUSED' : 'ACTIVE');
  }

  /**
   * Kampanyanin reklam platformundaki CANLI durumu ve butcesi (live-budget.ts).
   * Otopilot her butce degisikliginden once bunu okur; RanksUp'in kopyasi
   * (budgetAmount) yazimin dayanagi olmaz. Hata → { ok: false }.
   */
  async getLiveBudget(siteId: string, platform: 'google_ads' | 'meta_ads', externalId: string): Promise<LiveBudgetResult> {
    try {
      return platform === 'google_ads'
        ? await this.google.getLiveBudget(siteId, externalId)
        : await this.meta.getLiveBudget(siteId, externalId);
    } catch (err: any) {
      this.log.warn(`[${siteId}/${platform}/${externalId}] canli butce okunamadi: ${err?.message ?? err}`);
      return { ok: false };
    }
  }

  /**
   * Gunluk butce — tutar reklam hesabinin para birimindedir (TL varsayilmaz).
   * Otopilot bunu yalniz budget-guard'dan gecirerek cagirir.
   *
   * expectedCurrent ZORUNLU: yeni tutarin hesaplandigi canli butce. Istemci
   * yazmadan hemen once yeniden okur; butce arada degismisse yazmaz (stale).
   * Boylece bayat bir deger hicbir yoldan platforma yazilamaz.
   */
  async updateBudget(
    siteId: string,
    platform: 'google_ads' | 'meta_ads',
    externalId: string,
    dailyBudget: number,
    expectedCurrent: number,
  ): Promise<BudgetWriteResult> {
    if (platform === 'google_ads') return this.google.updateBudget(siteId, externalId, dailyBudget, expectedCurrent);
    return this.meta.updateDailyBudget(siteId, externalId, dailyBudget, expectedCurrent);
  }

  /**
   * Reklam hesabinin para birimi (ISO 4217) ya da okunamazsa null. Iki platform
   * arasinda tutar tasiyan adim (budget-shifter) yalniz ikisi AYNI birimdeyse calisir.
   */
  async getAccountCurrency(siteId: string, platform: 'google_ads' | 'meta_ads'): Promise<string | null> {
    try {
      return platform === 'google_ads'
        ? await this.google.getAccountCurrency(siteId)
        : await this.meta.getAccountCurrency(siteId);
    } catch (err: any) {
      this.log.warn(`[${siteId}/${platform}] para birimi alinamadi: ${err?.message ?? err}`);
      return null;
    }
  }

  /**
   * Negative keywords (Google'a ozel).
   */
  async addNegativeKeywords(siteId: string, externalId: string, keywords: string[]) {
    return this.google.addNegativeKeywords(siteId, externalId, keywords);
  }

  /**
   * Search terms report (Google'a ozel).
   */
  async getSearchTerms(siteId: string, externalId: string) {
    return this.google.getSearchTerms(siteId, externalId);
  }

  /**
   * Site icin hangi platform bagli? Frontend'in MCP yerine bunu kullanmasi icin.
   */
  async getConnectedPlatforms(siteId: string): Promise<{ google: boolean; meta: boolean }> {
    const site: any = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId } });
    return {
      google: !!site.googleAdsRefreshToken && !!site.googleAdsCustomerId,
      meta: !!site.metaAdsAccessToken && !!site.metaAdsAccountId,
    };
  }

  /**
   * Faz 11.3 — Ad-level varyant metrikleri (A/B test winner picker icin).
   * Okuma hatasi ya da beklenmeyen yanit → null: A/B o kampanyada hicbir sey
   * yapmaz (eskiden Google hatasi firlatir, Meta bos liste donerdi).
   */
  async getAdVariants(siteId: string, platform: 'google_ads' | 'meta_ads', externalId: string): Promise<AdVariant[] | null> {
    try {
      return platform === 'google_ads'
        ? await this.google.getAdVariantMetrics(siteId, externalId)
        : await this.meta.getAdVariantMetrics(siteId, externalId);
    } catch (err: any) {
      this.log.warn(`[${siteId}/${platform}/${externalId}] reklam varyantlari okunamadi: ${err?.message ?? err}`);
      return null;
    }
  }

  /**
   * Faz 11.3 — Ad-level pause/enable. error: Google'in musteriye gosterilebilir
   * kesin nedeni (or. AB siyasi reklam beyani eksik); A/B gecmisi bunu yazar.
   * uncertain: sonuc bilinmiyor (AdStatusWriteResult).
   */
  async setAdStatus(siteId: string, platform: 'google_ads' | 'meta_ads', adIdOrResource: string, paused: boolean): Promise<AdStatusWriteResult> {
    if (platform === 'google_ads') {
      return this.google.setAdStatus(siteId, adIdOrResource, paused ? 'PAUSED' : 'ENABLED');
    }
    return this.meta.setAdStatus(siteId, adIdOrResource, paused ? 'PAUSED' : 'ACTIVE');
  }
}
