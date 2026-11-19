import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { FxService } from '../billing/fx.service.js';
import { GoogleAdsClientService } from './google-ads-client.service.js';
import { MetaAdsClientService } from './meta-ads-client.service.js';
import { GOOGLE_SNAPSHOT_QUERIES, buildGoogleSnapshot } from './google-snapshot-map.js';
import { buildMetaSnapshot } from './meta-snapshot-map.js';
import { definedSnapshotFields } from './rules/requires.js';
import type { AccountSnapshot, AuditDataStatus, Platform } from './rules/types.js';

export interface CollectedSnapshot {
  snapshot: AccountSnapshot;
  source: AuditDataStatus['source'];
  /** Okunamayan parcalar (kisa, musteriye gosterilebilir) */
  readErrors: string[];
}

/**
 * Kampanya Skoru icin reklam hesabinin snapshot'i — YALNIZ musteri hesabindan
 * okunan veriyle (Google Ads GAQL / Meta Graph API, yalniz okuma).
 *
 * NEDEN: eskiden snapshot RanksUp'in kendi `adCampaign` tablosundan
 * (yalniz RanksUp'tan acilan kampanyalar; kampanya acma kaldirildigi icin
 * musteride bos) kuruluyor, okunmayan alanlar varsayilanla doluyordu
 * (geoTargeting 'people_in', rsa.count 1, adStrength 'average', bidStrategy
 * 'unknown', sitelink 0 ...). Kurallar bu uydurma degerleri hesabin gercegi
 * gibi puanliyordu. Artik okunmayan her alan undefined; kural 'na' doner.
 */
@Injectable()
export class AdsSnapshotCollectorService {
  private readonly log = new Logger(AdsSnapshotCollectorService.name);

  constructor(
    private readonly google: GoogleAdsClientService,
    private readonly meta: MetaAdsClientService,
    // Opsiyonel: kur servisi yoksa (elle kurulan servis, testler) TRY hesapta USD esikli kurallar 'na' kalir
    @Optional() @Inject(FxService) private readonly fx?: FxService,
  ) {}

  /**
   * USD esikli kurallar (G06, G16) icin kur (18.11.2026): USD hesapta 1, TRY hesapta TCMB kuru
   * (FxService — fiyatlarda kullanilan kaynak). Baska birim ya da kur okunamazsa usdPerUnit yok.
   */
  private async applyFx(snapshot: AccountSnapshot): Promise<void> {
    try {
      let birim: number | undefined;
      if (snapshot.currency === 'USD') birim = 1;
      else if (snapshot.currency === 'TRY' && this.fx) {
        const kur = await this.fx.getUsdToTryRate();
        if (Number.isFinite(kur) && kur > 0) birim = 1 / kur;
      }
      if (birim === undefined) return;
      snapshot.usdPerUnit = birim;
      if (typeof snapshot.monthlySpend === 'number') snapshot.monthlySpendUsd = Math.round(snapshot.monthlySpend * birim * 100) / 100;
    } catch (err: any) {
      this.log.warn(`Kur okunamadi; USD esikli kontroller 'na' kalir: ${String(err?.message ?? err).slice(0, 120)}`);
    }
  }

  async collect(siteId: string, platform: Platform): Promise<CollectedSnapshot> {
    try {
      return platform === 'google' ? await this.collectGoogle(siteId) : await this.collectMeta(siteId);
    } catch (err: any) {
      // Okuma hatasi denetimi dusurmez: hicbir sey okunamadi, kurallar 'na'
      this.log.warn(`[${siteId}] ${platform} snapshot okunamadi: ${String(err?.message ?? err).slice(0, 200)}`);
      return { snapshot: {}, source: 'none', readErrors: ['Reklam hesabı okunamadı'] };
    }
  }

  private async collectGoogle(siteId: string): Promise<CollectedSnapshot> {
    const r = await this.google.queryEach(siteId, GOOGLE_SNAPSHOT_QUERIES);
    if (!r.ok) return { snapshot: {}, source: 'none', readErrors: [r.error] };
    const { snapshot, readErrors } = buildGoogleSnapshot(r.results);
    await this.applyFx(snapshot);
    return this.finish(siteId, 'google_ads_api', snapshot, readErrors);
  }

  private async collectMeta(siteId: string): Promise<CollectedSnapshot> {
    const r = await this.meta.readAccountForAudit(siteId);
    if (!r.ok) return { snapshot: {}, source: 'none', readErrors: [r.error] };
    const { snapshot, readErrors } = buildMetaSnapshot(r);
    await this.applyFx(snapshot);
    return this.finish(siteId, 'meta_graph_api', snapshot, readErrors);
  }

  private finish(siteId: string, source: AuditDataStatus['source'], snapshot: AccountSnapshot, readErrors: string[]): CollectedSnapshot {
    const fields = definedSnapshotFields(snapshot);
    if (readErrors.length > 0) this.log.warn(`[${siteId}] snapshot eksik okundu: ${readErrors.join(', ')}`);
    return { snapshot, source: fields.length > 0 ? source : 'none', readErrors };
  }
}
