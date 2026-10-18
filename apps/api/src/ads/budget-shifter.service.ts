import { Injectable, Logger } from '@nestjs/common';
import type { AdCampaign } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AdsClientService } from './ads-client.service.js';
import { AdsBudgetGuardService } from './budget-guard.service.js';
import { BUDGET_SHIFT_FRACTION, describeRejection, roundBudget } from './budget-guard.js';
import { autopilotDailyBudget, hasPatch, liveSyncPatch, sameBudget, type BudgetWriteResult, type LiveCampaignBudget } from './live-budget.js';

type Platform = 'google_ads' | 'meta_ads';
type HistoryEntry = Record<string, unknown>;

const PLATFORM_LABEL: Record<string, string> = { google_ads: 'Google Ads', meta_ads: 'Meta' };

function fmtAmount(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/**
 * Cross-Platform Budget Shifter — Google ile Meta arasinda butce kaydirir.
 *
 * Strateji (ADS_AUTOPILOT turunda, 6 saatte bir):
 *   - Ayni hedefli (objective) etkin bir Google + bir Meta kampanyasi, ikisi de
 *     son 30 gunde >= 100 harcamis
 *   - ROAS orani >= 1,5 ise zayifin GUNLUK butcesinin %20'si gucluye kaydirilir;
 *     toplam butce degismez
 *
 * Emniyet (R5-B):
 *   - Guclu kampanyanin artisi budget-guard'dan gecer (24 saatte 1, 7 gunde 2,
 *     tavan = ilk degisiklikteki butcenin 2 kati). Artis kirpilirsa zayiftan
 *     alinan tutar da kirpilir; artis yoksa kaydirma yapilmaz.
 *   - Iki hesap AYNI para biriminde olmali: tutar dogrudan tasinir; USD hesaptaki
 *     100'u TL hesaba 100 diye eklemek harcamayi katlardi. Para birimi
 *     okunamazsa kaydirma yapilmaz.
 *   - Toplam (omur boyu) butceli kampanyaya dokunulmaz.
 *   - Once zayif azaltilir, sonra guclu artirilir: ikinci adim basarisizsa
 *     zayif eski butcesine dondurulur; o da olmazsa toplam butce DUSER, asla artmaz.
 *   - RanksUp kaydi yalniz platformun onayladigi degisiklikle guncellenir ve
 *     iki kampanyanin otopilot gecmisine once/sonra tutarlariyla yazilir.
 *
 * Canli butce (live-budget.ts): kaydirilan tutar, azaltma, artis ve geri alma
 * RanksUp'in kopyasindan (budgetAmount) DEGIL iki kampanyanin reklam
 * platformundaki gunluk butcesinden hesaplanir. Eskiden "azaltma" kopya
 * bayatsa zayifin gercek butcesini ARTIRABILIYOR (canli 50, kayit 500 → 400)
 * ve geri alma onu gercek eski degerine degil kayittaki sayiya donduruyordu.
 * Kopya canli degerden farkliysa o tur kaydirma yapilmaz, kayit esitlenir.
 * Her yazim "beklenen mevcut deger"le yapilir (istemci yazmadan once yeniden okur).
 */
@Injectable()
export class BudgetShifterService {
  private readonly log = new Logger(BudgetShifterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly adsClient: AdsClientService,
    private readonly guard: AdsBudgetGuardService,
  ) {}

  async shiftBudgets(): Promise<{ pairsAnalyzed: number; shifts: number }> {
    const sites = await this.prisma.site.findMany({
      where: { adsAutopilot: true } as any,
    });

    let pairsAnalyzed = 0;
    let shifts = 0;

    for (const site of sites) {
      // Ayni objective'e sahip Google + Meta ciftleri bul
      const campaigns = await this.prisma.adCampaign.findMany({
        where: { siteId: site.id, status: 'ACTIVE' },
      });

      const byObjective: Record<string, AdCampaign[]> = {};
      for (const c of campaigns) {
        if (!byObjective[c.objective]) byObjective[c.objective] = [];
        byObjective[c.objective].push(c);
      }

      // Para birimleri site basina en fazla bir kez, yalniz gerekirse okunur
      let currencies: Promise<Record<Platform, string | null>> | null = null;
      const getCurrencies = () => {
        currencies ??= Promise.all([
          this.adsClient.getAccountCurrency(site.id, 'google_ads'),
          this.adsClient.getAccountCurrency(site.id, 'meta_ads'),
        ]).then(([google_ads, meta_ads]) => ({ google_ads, meta_ads }));
        return currencies;
      };

      for (const group of Object.values(byObjective)) {
        const google = group.find((c) => c.platform === 'google_ads');
        const meta = group.find((c) => c.platform === 'meta_ads');
        if (!google || !meta) continue;
        if (Number(google.spend) < 100 || Number(meta.spend) < 100) continue; // yetersiz veri
        pairsAnalyzed++;

        const gRoas = Number(google.roas);
        const mRoas = Number(meta.roas);
        if (gRoas === 0 || mRoas === 0) continue;

        // Kazanan en az 1.5x daha iyi olmali
        const ratio = Math.max(gRoas, mRoas) / Math.min(gRoas, mRoas);
        if (ratio < 1.5) continue;

        const winner = gRoas > mRoas ? google : meta;
        const loser = gRoas > mRoas ? meta : google;
        try {
          if (await this.shiftPair(site.id, winner, loser, getCurrencies)) shifts++;
        } catch (err: any) {
          this.log.warn(`[${site.id}] butce kaydirma atlandi (${loser.id} → ${winner.id}): ${err?.message ?? err}`);
        }
      }
    }

    this.log.log(`Budget shifter: ${pairsAnalyzed} cift, ${shifts} kaydirma`);
    return { pairsAnalyzed, shifts };
  }

  private async shiftPair(
    siteId: string,
    winner: AdCampaign,
    loser: AdCampaign,
    getCurrencies: () => Promise<Record<Platform, string | null>>,
  ): Promise<boolean> {
    const tag = `[${siteId}] kaydirma ${loser.id} (${loser.platform}) → ${winner.id} (${winner.platform})`;
    const winnerPlatform = winner.platform as Platform;
    const loserPlatform = loser.platform as Platform;

    if (winner.budgetType === 'lifetime' || loser.budgetType === 'lifetime') {
      this.log.log(`${tag} atlandi: toplam (omur boyu) butceli kampanya`);
      return false;
    }
    if (!winner.externalId || !loser.externalId) {
      this.log.log(`${tag} atlandi: platform kimligi eksik`);
      return false;
    }

    const cur = await getCurrencies();
    const winnerCurrency = cur[winnerPlatform];
    const loserCurrency = cur[loserPlatform];
    if (!winnerCurrency || !loserCurrency || winnerCurrency !== loserCurrency) {
      this.log.log(`${tag} atlandi: hesaplarin para birimi ${loserCurrency ?? 'bilinmiyor'} / ${winnerCurrency ?? 'bilinmiyor'} — tutar ancak ayni birimde tasinabilir`);
      return false;
    }

    // Iki kampanyanin CANLI gunluk butcesi; kayit bayatsa esitlenir ve bu tur kaydirma yapilmaz
    const [winnerLive, loserLive] = await Promise.all([
      this.adsClient.getLiveBudget(siteId, winnerPlatform, winner.externalId),
      this.adsClient.getLiveBudget(siteId, loserPlatform, loser.externalId),
    ]);
    if (!winnerLive.ok || !loserLive.ok) {
      this.log.warn(`${tag} atlandi: reklam platformundaki butce okunamadi (${!winnerLive.ok ? winner.id : loser.id})`);
      return false;
    }
    const winnerCheck = await this.checkLive(winner, winnerLive.live);
    const loserCheck = await this.checkLive(loser, loserLive.live);
    if (!winnerCheck.ok || !loserCheck.ok) {
      this.log.log(`${tag} atlandi: ${!winnerCheck.ok ? `${winner.id} ${winnerCheck.reason}` : ''}${!winnerCheck.ok && !loserCheck.ok ? '; ' : ''}${!loserCheck.ok ? `${loser.id} ${loserCheck.reason}` : ''}`);
      return false;
    }
    // Yazim ve geri alma TAM canli degerle (Google mikro birim); gecmis kurusa yuvarlanmis gosterir
    const winnerBefore = winnerCheck.amount;
    const loserBefore = loserCheck.amount;

    const now = new Date();
    const proposed = roundBudget(winnerBefore + loserBefore * BUDGET_SHIFT_FRACTION);
    const r = await this.guard.reserveIncrease({ siteId, campaignId: winner.id, current: winnerBefore, proposed, now });
    if (!r.ok) {
      this.log.log(`${tag} atlandi: ${describeRejection(r, this.guard.config())}`);
      return false;
    }
    const { reservation } = r;
    const winnerAfter = reservation.after;
    // Artis tavana kirpildiysa zayiftan alinan da kirpilir: toplam degismez
    const moved = roundBudget(winnerAfter - winnerBefore);
    const loserAfter = roundBudget(loserBefore - moved);
    if (!(moved > 0) || !(loserAfter > 0)) {
      await this.guard.release(reservation);
      this.log.log(`${tag} atlandi: kaydirilacak tutar gecersiz (${moved})`);
      return false;
    }

    // 1) Once azalt: basarisizsa artis yapilmaz. Sonuc belirsiz olsa bile
    //    (zayifta kismi azaltma kalmis olabilir) toplam yalniz DUSMUS olabilir.
    const down: BudgetWriteResult = await this.adsClient
      .updateBudget(siteId, loserPlatform, loser.externalId, loserAfter, loserBefore)
      .catch(() => ({ ok: false }));
    if (!down.ok) {
      await this.guard.release(reservation);
      this.log.warn(
        `${tag} atlandi: platform azaltmayi onaylamadi (${fmtAmount(loserBefore)} → ${fmtAmount(loserAfter)})` +
        `${down.uncertain ? ' — sonuc belirsiz, zayif kampanyada kismi azaltma kalmis olabilir (sonraki tur kayit esitlenir)' : ''}`,
      );
      return false;
    }
    const loserNow = roundBudget(down.applied ?? loserAfter);
    await this.guard.noteBaseline(siteId, loser.id, loserBefore, now);

    // 2) Sonra artir (guclu kampanyanin canli butcesi okundugu gibi olmali)
    const up: BudgetWriteResult = await this.adsClient
      .updateBudget(siteId, winnerPlatform, winner.externalId, winnerAfter, winnerBefore)
      .catch(() => ({ ok: false }));
    if (!up.ok) {
      if (up.uncertain) {
        // Guclude artis kalmis olabilir: zayif GERI YUKSELTILMEZ (toplam artabilirdi),
        // rezervasyon korunur (guard bu artisi sayar). Kayit platformdaki kesin kismi yazar.
        this.log.error(`${tag} artisin sonucu belirsiz; azaltma geri alinmadi (toplam butce artmasin), emniyet kaydi korundu: ${loser.id} ${fmtAmount(loserBefore)} → ${fmtAmount(loserNow)}`);
        // uncertain: panel "geri alinamadi, toplam dustu" demesin; karsi artisin sonucu bilinmiyor
        await this.writeChange(loser, loserNow, {
          time: now.toISOString(), action: 'budget-shift-out', budgetBefore: roundBudget(loserBefore), budgetAfter: loserNow,
          counterpart: PLATFORM_LABEL[winnerPlatform] ?? winnerPlatform, completed: false, uncertain: true,
        });
        return false;
      }
      await this.guard.release(reservation);
      // Geri alma zayifin canli ESKI butcesine; beklenen mevcut deger az once yazilan
      const restore: BudgetWriteResult = await this.adsClient
        .updateBudget(siteId, loserPlatform, loser.externalId, loserBefore, loserNow)
        .catch(() => ({ ok: false }));
      if (restore.ok) {
        this.log.warn(`${tag} atlandi: platform artisi onaylamadi; azaltilan butce geri alindi (${fmtAmount(loserBefore)})`);
        return false;
      }
      // Platformdaki gercek durum: zayif azaldi, guclu degismedi (toplam dustu)
      this.log.error(`${tag} artis onaylanmadi ve azaltma geri alinamadi: ${loser.id} butcesi ${fmtAmount(loserBefore)} → ${fmtAmount(loserNow)} kaldi (toplam butce dustu)`);
      await this.writeChange(loser, loserNow, {
        time: now.toISOString(), action: 'budget-shift-out', budgetBefore: roundBudget(loserBefore), budgetAfter: loserNow,
        counterpart: PLATFORM_LABEL[winnerPlatform] ?? winnerPlatform, completed: false,
      });
      return false;
    }
    const winnerNow = roundBudget(up.applied ?? winnerAfter);

    const common = { time: now.toISOString(), currency: winnerCurrency, completed: true };
    await this.writeChange(loser, loserNow, {
      ...common, action: 'budget-shift-out', budgetBefore: roundBudget(loserBefore), budgetAfter: loserNow,
      counterpart: PLATFORM_LABEL[winnerPlatform] ?? winnerPlatform, roas: Number(loser.roas),
    });
    await this.writeChange(winner, winnerNow, {
      ...common, action: 'budget-shift-in', budgetBefore: roundBudget(winnerBefore), budgetAfter: winnerNow,
      counterpart: PLATFORM_LABEL[loserPlatform] ?? loserPlatform, roas: Number(winner.roas),
      ceiling: reservation.ceiling, clamped: reservation.clamped,
    });

    this.log.log(
      `${tag}: ${fmtAmount(moved)} ${winnerCurrency} kaydirildi — ${loser.id} ${fmtAmount(loserBefore)} → ${fmtAmount(loserNow)}, ` +
      `${winner.id} ${fmtAmount(winnerBefore)} → ${fmtAmount(winnerNow)} (tavan ${fmtAmount(reservation.ceiling)}${reservation.clamped ? ', kirpildi' : ''}; ` +
      `ROAS ${Number(loser.roas).toFixed(1)} → ${Number(winner.roas).toFixed(1)})`,
    );
    return true;
  }

  /**
   * Canli butce otopilotun degistirebilecegi gunluk butce mi ve kayitla ayni mi.
   * Platformdaki gercek (butce, tur, kalici son) kayda her durumda islenir;
   * kayit canli degerden farkliysa bu tur kaydirma yapilmaz.
   */
  private async checkLive(
    c: AdCampaign,
    live: LiveCampaignBudget,
  ): Promise<{ ok: true; amount: number } | { ok: false; reason: string }> {
    const patch = liveSyncPatch(c, live);
    if (hasPatch(patch)) await this.prisma.adCampaign.update({ where: { id: c.id }, data: patch });
    const usable = autopilotDailyBudget(live);
    if (!usable.ok) return usable;
    const recorded = c.budgetAmount === null || c.budgetAmount === undefined ? Number.NaN : Number(c.budgetAmount);
    if (!sameBudget(recorded, usable.amount)) {
      return {
        ok: false,
        reason: `RanksUp kaydindaki gunluk butce (${Number.isFinite(recorded) ? fmtAmount(recorded) : 'yok'}) reklam hesabindakinden (${fmtAmount(usable.amount)}) farkli; kayit esitlendi`,
      };
    }
    return usable;
  }

  /** Butce ve gecmis tek guncellemede */
  private async writeChange(c: AdCampaign, budgetAmount: number, entry: HistoryEntry): Promise<void> {
    const history: HistoryEntry[] = Array.isArray(c.autopilotActions) ? [...(c.autopilotActions as HistoryEntry[])] : [];
    history.push(entry);
    await this.prisma.adCampaign.update({
      where: { id: c.id },
      data: { budgetAmount, autopilotActions: history.slice(-20) as any },
    });
  }
}
