import { Injectable, Logger } from '@nestjs/common';
import type { AdCampaign } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AdsClientService } from './ads-client.service.js';
import { GoogleAdsClientService } from './google-ads-client.service.js';
import { MetaAdsClientService } from './meta-ads-client.service.js';
import { WebhookNotifierService } from '../audit/webhook-notifier.service.js';
import { AdsBudgetGuardService } from './budget-guard.service.js';
import { BUDGET_INCREASE_FACTOR, describeRejection, roundBudget } from './budget-guard.js';
import { autopilotDailyBudget, hasPatch, liveSyncPatch, sameBudget, type BudgetWriteResult } from './live-budget.js';

export interface CampaignBuildRequest {
  siteId: string;
  platform: 'google_ads' | 'meta_ads' | 'both';
  objective: 'traffic' | 'leads' | 'conversions' | 'brand_awareness' | 'sales';
  productOrService: string;
  keyBenefit?: string;
  landingUrl: string;
  budgetType: 'daily' | 'lifetime';
  budgetAmount: number;     // reklam hesabinin para biriminde
  startDate?: string;
  endDate?: string;
  autoLaunch?: boolean;     // true ise MCP uzerinden launch
}

export interface CampaignBuildResult {
  campaigns: any[];          // DB kayitlari
  audience: any;
  adCopy: any;
  images: any[];
  estimatedCostUsd: number;
  launchResults: any[];
}

const PLATFORM_LABEL: Record<string, string> = { google_ads: 'Google Ads', meta_ads: 'Meta' };

type AutopilotSite = { id: string; name: string };
type HistoryEntry = Record<string, unknown>;

/** Sayiyi panel/bildirim icin kisa yaz (tam sayiysa ondaliksiz) */
function fmtAmount(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/**
 * Campaign Orchestrator — RanksUp'ta kayitli reklam kampanyalarinin otopilotu.
 * (Kampanya kurulumu 0db5a1c'de kaldirildi; burada yalniz mevcut kampanyalar
 * yonetilir.)
 */
@Injectable()
export class CampaignOrchestratorService {
  private readonly log = new Logger(CampaignOrchestratorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly adsClient: AdsClientService,
    private readonly google: GoogleAdsClientService,
    private readonly meta: MetaAdsClientService,
    private readonly webhook: WebhookNotifierService,
    private readonly guard: AdsBudgetGuardService,
  ) {}

  /**
   * Cron (ADS_AUTOPILOT, 6 saatte bir) — reklam otopilotu acik sitelerde etkin
   * kampanyalar: ROAS dusuk + harcama yuksek → duraklat; tiklama orani ve ROAS
   * yuksek → gunluk butce +%20, YALNIZ budget-guard izin verirse.
   *
   * Her degisiklik platform ONAYLADIKTAN sonra RanksUp'a yazilir. Eski kod
   * platform cagrisinin sonucunu yok sayip kaydi her durumda degistiriyordu:
   * duraklatma basarisizsa panel "Duraklatıldı" derken kampanya harcamaya devam
   * ediyordu; basarisiz artista ise RanksUp'taki butce platformdan kopup her
   * turda katlaniyordu.
   */
  async optimizeAutopilotCampaigns(): Promise<{ scanned: number; actions: number }> {
    const sites = await this.prisma.site.findMany({
      where: { adsAutopilot: true } as any,
    });

    let scanned = 0;
    let actions = 0;

    for (const site of sites) {
      const activeCampaigns = await this.prisma.adCampaign.findMany({
        where: { siteId: site.id, status: 'ACTIVE' },
      });

      for (const c of activeCampaigns) {
        scanned++;
        // Bir kampanyadaki hata digerlerini durdurmasin (eskiden tum tur duserdi)
        try {
          actions += await this.optimizeOne(site, c);
        } catch (err: any) {
          this.log.warn(`[${site.id}/${c.id}] otopilot adimi atlandi: ${err?.message ?? err}`);
        }
      }
    }

    this.log.log(`Ad autopilot: ${scanned} kampanya tarandi, ${actions} aksiyon`);
    return { scanned, actions };
  }

  private async optimizeOne(site: AutopilotSite, c: AdCampaign): Promise<number> {
    const now = new Date();
    const entries: HistoryEntry[] = [];
    const data: { status?: string; budgetAmount?: number } = {};
    const platform = c.platform as 'google_ads' | 'meta_ads';
    const spend = Number(c.spend ?? 0);
    const roas = Number(c.roas ?? 0);
    const ctr = Number(c.ctr ?? 0);

    if (c.roas !== null && roas < 1.5 && c.spend && spend > 100) {
      // ROAS < 1.5 → duraklat. Platform kimligi yoksa platformda durdurulacak bir sey yok.
      const res = c.externalId
        ? await this.adsClient.setStatus(site.id, platform, c.externalId, true).catch(() => ({ ok: false }))
        : { ok: true };
      if (!res.ok) {
        this.log.warn(`[${site.id}/${c.id}] duraklatma platformda onaylanmadi; kayit ETKIN kaldi, sonraki turda yeniden denenir`);
      } else {
        data.status = 'PAUSED';
        entries.push({ time: now.toISOString(), actions: ['pause-low-roas'], ctr, roas });
        this.log.log(`[${site.id}/${c.id}] duraklatildi: ROAS ${roas.toFixed(2)}, son 30 gun harcama ${spend.toFixed(2)}`);
        this.webhook.notify({
          siteId: site.id,
          siteName: site.name,
          event: 'ai_citation_drop' as any,
          title: 'Kampanya duraklatıldı',
          message: `${c.name} (${PLATFORM_LABEL[platform] ?? platform}) ROAS ${roas.toFixed(2)} olduğu için otomatik duraklatıldı. Son 30 günde ${spend.toFixed(0)} harcanmıştı (reklam hesabının para birimiyle).`,
          url: `https://ranksup.ai/sites/${site.id}`,
          meta: { roas, spend },
        }).catch(() => {});
      }
    } else if (ctr > 0.03 && roas > 5) {
      // CTR > %3 + ROAS > 5 → gunluk butce +%20 (emniyet rayi: budget-guard.ts)
      const step = await this.increaseBudget(site, c, platform, now, { ctr, roas });
      if (step) {
        data.budgetAmount = step.after;
        entries.push(step.entry);
        this.webhook.notify({
          siteId: site.id,
          siteName: site.name,
          event: 'ai_citation_rise' as any,
          title: 'Kampanya bütçesi artırıldı',
          message: `${c.name} iyi performans gösteriyor (tıklama oranı %${(ctr * 100).toFixed(1)}, ROAS ${roas.toFixed(2)}). Günlük bütçe ${fmtAmount(step.before)} → ${fmtAmount(step.after)} (reklam hesabının para birimiyle). Üst sınır ${fmtAmount(step.ceiling)}.`,
          url: `https://ranksup.ai/sites/${site.id}`,
          meta: { ctr, roas, oldBudget: step.before, newBudget: step.after, ceiling: step.ceiling },
        }).catch(() => {});
      }
    }

    if (entries.length === 0) return 0;
    // Durum/butce ve gecmis tek guncellemede: biri yazilip digeri kaybolmasin
    const history: HistoryEntry[] = Array.isArray(c.autopilotActions) ? [...(c.autopilotActions as HistoryEntry[])] : [];
    history.push(...entries);
    await this.prisma.adCampaign.update({
      where: { id: c.id },
      data: { ...data, autopilotActions: history.slice(-20) as any },
    });
    return entries.length;
  }

  /**
   * Butce artisi: CANLI butce → budget-guard rezervasyonu → platform (canli
   * deger hala ayniysa) → (onaylanirsa) kayit.
   *
   * Hesap RanksUp'in kopyasindan (budgetAmount) DEGIL platformdaki gunluk
   * butceden yapilir (live-budget.ts). Kopya canli degerden farkliysa (musteri
   * butceyi reklam hesabinda degistirmis ya da eski kod kaydi sisirmis) bu tur
   * artis yapilmaz, kayit canli degere esitlenir; sonraki tur esitlenmis kayitla
   * devam eder. Platform reddederse rezervasyon geri alinir; sonuc belirsizse
   * (platformda degisiklik kalmis olabilir) rezervasyon korunur.
   */
  private async increaseBudget(
    site: AutopilotSite,
    c: AdCampaign,
    platform: 'google_ads' | 'meta_ads',
    now: Date,
    perf: { ctr: number; roas: number },
  ): Promise<{ before: number; after: number; ceiling: number; entry: HistoryEntry } | null> {
    const tag = `[${site.id}/${c.id}]`;
    // updateBudget GUNLUK butce yazar (Google amount_micros, Meta daily_budget):
    // toplam butceli kampanyada tutari gunluk diye yazmak harcamayi katlardi.
    if (c.budgetType === 'lifetime') {
      this.log.log(`${tag} butce artisi atlandi: toplam (omur boyu) butceli kampanya, otopilot yalniz gunluk butceyi degistirir`);
      return null;
    }
    if (!c.externalId) {
      this.log.log(`${tag} butce artisi atlandi: platform kimligi yok`);
      return null;
    }

    const liveRes = await this.adsClient.getLiveBudget(site.id, platform, c.externalId);
    if (!liveRes.ok) {
      this.log.warn(`${tag} butce artisi atlandi: reklam platformundaki butce okunamadi`);
      return null;
    }
    const patch = liveSyncPatch(c, liveRes.live);
    const usable = autopilotDailyBudget(liveRes.live);
    const recorded = c.budgetAmount === null || c.budgetAmount === undefined ? Number.NaN : Number(c.budgetAmount);
    if (!usable.ok || !sameBudget(recorded, usable.amount)) {
      if (hasPatch(patch)) await this.prisma.adCampaign.update({ where: { id: c.id }, data: patch });
      if (!usable.ok) {
        this.log.log(`${tag} butce artisi atlandi: ${usable.reason}`);
      } else {
        this.log.warn(
          `${tag} butce artisi atlandi: RanksUp kaydindaki gunluk butce (${Number.isFinite(recorded) ? fmtAmount(recorded) : 'yok'}) ` +
          `reklam hesabindakinden (${fmtAmount(usable.amount)}) farkli; kayit esitlendi, bu tur degisiklik yapilmadi`,
        );
      }
      return null;
    }
    // Kurus farki ya da tur bilgisi gibi kucuk duzeltmeler kayda islenir, artis canli degerden surer
    if (hasPatch(patch)) await this.prisma.adCampaign.update({ where: { id: c.id }, data: patch });

    const before = usable.amount;
    const proposed = roundBudget(before * BUDGET_INCREASE_FACTOR);
    const r = await this.guard.reserveIncrease({ siteId: site.id, campaignId: c.id, current: before, proposed, now });
    if (!r.ok) {
      this.log.log(`${tag} butce artisi atlandi: ${describeRejection(r, this.guard.config())}`);
      return null;
    }
    const { reservation } = r;
    const res: BudgetWriteResult = await this.adsClient
      .updateBudget(site.id, platform, c.externalId, reservation.after, before)
      .catch(() => ({ ok: false }));
    if (!res.ok) {
      if (res.uncertain) {
        // Platformda artis kalmis olabilir: guard onu sayili tutar (bekleme ve haftalik sinir korunur)
        this.log.error(`${tag} butce artisinin sonucu belirsiz (${fmtAmount(before)} → ${fmtAmount(reservation.after)}); emniyet kaydi korundu, RanksUp kaydi degismedi`);
      } else {
        await this.guard.release(reservation);
        this.log.warn(`${tag} platform butce artisini onaylamadi (${fmtAmount(before)} → ${fmtAmount(reservation.after)})${res.stale ? ': butce okuma ile yazma arasinda degismis' : ''}; RanksUp kaydi degismedi`);
      }
      return null;
    }

    const after = roundBudget(res.applied ?? reservation.after);
    this.log.log(
      `${tag} butce artirildi: ${fmtAmount(before)} → ${fmtAmount(after)} ` +
      `(taban ${fmtAmount(reservation.baseline)}, tavan ${fmtAmount(reservation.ceiling)}, ` +
      `7 gunde ${reservation.increasesThisWeek}. artis${reservation.clamped ? ', tavana kirpildi' : ''})`,
    );
    // Gecmis ve bildirim kurusuna yuvarlanmis tutari gosterir (Google mikro birimde 33.333333 gibi gelebilir)
    const shownBefore = roundBudget(before);
    return {
      before: shownBefore,
      after,
      ceiling: reservation.ceiling,
      entry: {
        time: now.toISOString(),
        action: 'budget-up',
        budgetBefore: shownBefore,
        budgetAfter: after,
        ceiling: reservation.ceiling,
        clamped: reservation.clamped,
        ctr: perf.ctr,
        roas: perf.roas,
      },
    };
  }
}
