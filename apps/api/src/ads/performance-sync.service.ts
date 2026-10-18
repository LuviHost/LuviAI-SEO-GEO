import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AdsClientService } from './ads-client.service.js';
import { hasPatch, liveSyncPatch } from './live-budget.js';

/**
 * Performance Sync — her 6 saatte bir aktif kampanyalarin gercek metrik
 * verilerini Google Ads + Meta Marketing API'den ceker, AdCampaign'a yazar.
 *
 * Direkt resmi API entegrasyonu (Faz 11.2 — Ryze AI MCP kaldirildi).
 *
 * Metriklerle birlikte kampanyanin CANLI butcesi ve durumu da kayda islenir
 * (live-budget.ts liveSyncPatch). Eskiden yalniz metrikler yaziliyordu:
 * musterinin reklam hesabinda degistirdigi butce RanksUp'ta hic guncellenmiyor,
 * Meta'da arsivlenen / silinen ya da Google'da kaldirilan kampanya ETKIN
 * kaliyordu (insights eski metrikleri donmeye devam ettigi icin otopilot ve
 * kaydirici ona dokunmayi surduruyordu). Kalici son → ENDED; panel listede
 * gosterir, otopilot adimlari yalniz ETKIN kayitlarla calisir.
 */
@Injectable()
export class PerformanceSyncService {
  private readonly log = new Logger(PerformanceSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly adsClient: AdsClientService,
  ) {}

  async syncAllActive(): Promise<{ synced: number; failed: number; flagged: number; ended: number; budgetsResynced: number }> {
    const campaigns = await this.prisma.adCampaign.findMany({
      where: {
        status: 'ACTIVE',
        externalId: { not: null },
      },
      include: { site: true },
    });

    let synced = 0;
    let failed = 0;
    const flagged = 0; // dolandiricilik isareti henuz uretilmiyor (alan geriye uyumluluk icin)
    let ended = 0;
    let budgetsResynced = 0;

    for (const c of campaigns) {
      const site: any = c.site;
      const platform = c.platform as 'google_ads' | 'meta_ads';

      // Bagli mi kontrol et
      const hasCreds = platform === 'google_ads'
        ? !!site.googleAdsRefreshToken && !!site.googleAdsCustomerId
        : !!site.metaAdsAccessToken && !!site.metaAdsAccountId;

      if (!hasCreds || !c.externalId) continue;

      try {
        // Ikisi de kendi hatasini yutar (null / { ok: false }): biri digerini engellemez
        const [metrics, liveRes] = await Promise.all([
          this.adsClient.getMetrics(site.id, platform, c.externalId),
          this.adsClient.getLiveBudget(site.id, platform, c.externalId),
        ]);

        const data: Record<string, unknown> = {};
        if (metrics) {
          Object.assign(data, {
            impressions: metrics.impressions,
            clicks: metrics.clicks,
            spend: metrics.spend,
            conversions: metrics.conversions,
            ctr: metrics.ctr,
            cpc: metrics.cpc,
            roas: metrics.roas,
            performanceCheckedAt: new Date(),
            performanceMetrics: metrics as any,
          });
        }
        if (liveRes.ok) {
          const patch = liveSyncPatch(c, liveRes.live);
          if (hasPatch(patch)) {
            Object.assign(data, patch);
            if (patch.status === 'ENDED') ended++;
            if (patch.budgetAmount !== undefined) budgetsResynced++;
            this.log.log(
              `[${c.id}] platformla esitlendi (${liveRes.live.platformStatus}): ` +
              Object.entries(patch).map(([k, v]) => `${k} ${String((c as any)[k] ?? '—')} → ${String(v)}`).join(', '),
            );
          }
          // Baslangic tarihi: kampanyanin platformda YAYINDA goruldugu ilk an.
          // NEDEN: A/B adimi (ab-test-manager) "en az 7 gun once baslamis"
          // kampanyayi startDate <= 7 gun once ile secer; ama startDate'i hicbir
          // kod yazmiyordu (tek yazan sihirbaz 0db5a1c'de kalkti, o da panelden
          // tarih almiyordu). SQL'de NULL <= x hicbir satiri secmedigi icin A/B
          // adimi hic calismiyor, panel ise "En az 7 gün önce başlamış kampanyada
          // ... diğer varyantları duraklatır" diyordu. Ilk gorulme ani gercek
          // baslangictan ONCE olamaz (kampanya o anda zaten yayindaydi); bu
          // tarihten 7 gun sonra "en az 7 gun once baslamis" iddiasi kesin
          // dogrudur. Eski kayitlarda A/B bu yuzden 7 gun gecikir (temkinli yon).
          // Yalniz bossa yazilir: duraklatilip yeniden acilan kampanyanin ilk
          // baslangici korunur (varyant metrikleri zaten son 7 gunun, >=100 gosterim).
          if (liveRes.live.status === 'ACTIVE' && !c.startDate) {
            data.startDate = new Date();
            this.log.log(`[${c.id}] kampanya platformda yayinda goruldu; baslangic tarihi kaydedildi (A/B adimi 7 gun sonra uygun)`);
          }
        } else {
          this.log.warn(`[${c.id}] canli butce/durum okunamadi; kayittaki butce ve durum korunuyor`);
        }

        if (Object.keys(data).length > 0) {
          await this.prisma.adCampaign.update({ where: { id: c.id }, data });
        }
        if (metrics) synced++;
        else failed++;
      } catch (err: any) {
        this.log.warn(`[${c.id}] sync fail: ${err.message}`);
        failed++;
      }
    }

    this.log.log(`Performance sync: ${synced} ok, ${failed} fail, ${flagged} fraud flag, ${ended} sona erdi, ${budgetsResynced} butce esitlendi`);
    return { synced, failed, flagged, ended, budgetsResynced };
  }
}
