import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AdsClientService, type AdVariant } from './ads-client.service.js';

type HistoryEntry = Record<string, unknown>;

/** Her reklamin son 7 gunde en az bu kadar gosterimi olmali (yeterli veri) */
export const AB_MIN_IMPRESSIONS = 1000;
/** Kazananin tiklama orani en az bu kadar onde olmali (0,3 puan) */
export const AB_MIN_CTR_GAP = 0.003;
/**
 * Iki oran z-testi esigi: %99 guven (iki yonlu). 0,3 puanlik fark tek basina
 * anlamli degil (100 gosterimde 0,3 tiklama); eski kural gurultuyle reklam
 * duraklatabiliyordu.
 */
export const AB_MIN_Z = 2.576;
/** RanksUp'in duraklattigi reklamlarin defteri (KvStore anahtar oneki) */
export const AB_LEDGER_PREFIX = 'ads-ab-paused:';
/** Defter siniri: dolarsa yeni duraklatma yapilmaz (eski kayit silinmez, yeniden acilan reklam unutulmasin) */
export const AB_LEDGER_MAX = 500;
/**
 * Bir turun bir kampanyanin gecmisine yazabilecegi en fazla A/B kaydi (ozet
 * dahil). NEDEN: gecmis (autopilotActions) tum otopilot adimlarinin ortak son
 * 20 kaydidir (slice(-20)). Grup basina kayitla 25 grupta duraklatan bir tur
 * yalniz son 20 kaydi tutuyordu: 5 grubun duraklatmasi ve reklam kimlikleri
 * (musterinin reklami bulup yeniden acmasinin yolu) hic gorunmuyor, diger
 * adimlarin eski kayitlarinin hepsi de siliniyordu. Sigmayan gruplar tek ozet
 * kayitta birlesir; gecmisin yarisi diger adimlara kalir.
 */
export const AB_HISTORY_RUN_MAX = 10;
/** Grup kaydindaki reklam kimligi siniri: fazlasi kesilir, pausedAdIdsTotal yazilir */
export const AB_HISTORY_GROUP_IDS_MAX = 10;
/** Ozet kayittaki reklam kimligi ve grup kimligi siniri (kayit boyu sinirli kalsin) */
export const AB_HISTORY_SUMMARY_IDS_MAX = 100;

/** Metrikleri tam okunmus, karsilastirmaya girebilen reklam */
type Rated = AdVariant & { impressions: number; clicks: number; conversions: number; conversionValue: number; ctr: number };

/** Bir reklam grubu / reklam seti icin karar */
export interface AbGroupPlan {
  groupId: string;
  groupName: string;
  winner: Rated;
  /** Duraklatilacaklar: kazanandan tiklama oraninda anlamli bicimde geride, donusumde onde degil */
  losers: Rated[];
}

function rated(v: AdVariant): Rated | null {
  if (!v.eligible) return null;
  const { impressions, clicks, conversions, conversionValue } = v;
  if (impressions === null || clicks === null || conversions === null || conversionValue === null) return null;
  if (impressions < AB_MIN_IMPRESSIONS || clicks > impressions) return null;
  return { ...v, impressions, clicks, conversions, conversionValue, ctr: clicks / impressions };
}

/**
 * Kazanan geride kalandan tiklama oraninda hem 0,3 puandan fazla hem de %99
 * guvenle (havuzlanmis iki oran z-testi) onde mi.
 */
export function ctrClearlyBetter(w: { clicks: number; impressions: number }, l: { clicks: number; impressions: number }): boolean {
  const p1 = w.clicks / w.impressions;
  const p2 = l.clicks / l.impressions;
  if (!(p1 - p2 > AB_MIN_CTR_GAP)) return false;
  const p = (w.clicks + l.clicks) / (w.impressions + l.impressions);
  const se = Math.sqrt(p * (1 - p) * (1 / w.impressions + 1 / l.impressions));
  if (!(se > 0)) return false;
  return (p1 - p2) / se >= AB_MIN_Z;
}

/**
 * Geride kalan gosterim basina daha cok donusum ya da donusum degeri getirdiyse
 * duraklatilmaz: tiklama orani kampanyanin asil hedefi olmayabilir (Google'da
 * donusum tabanli teklif stratejisi tam bu donusumlere gore calisir —
 * google-ads-client getAdVariantMetrics notu).
 * Carpraz carpim: kayan nokta bolmesi esitlikte yanilmasin.
 */
function convertsNoBetter(w: Rated, l: Rated): boolean {
  return l.conversions * w.impressions <= w.conversions * l.impressions
    && l.conversionValue * w.impressions <= w.conversionValue * l.impressions;
}

/**
 * Reklamlari YALNIZ kendi grubunda karsilastirir. Eskiden tum kampanya tek
 * havuzdu: baska reklam gruplarinin / reklam setlerinin tek reklami
 * duraklatiliyor (o gruplar yayindan dusuyordu), yayinda olmayan bir reklam
 * kazanan secilebiliyordu.
 *
 * Kurallar:
 *  - yalniz eligible ve metrikleri tam, en az AB_MIN_IMPRESSIONS gosterimli
 *    reklamlar; grupta bunlardan en az 2 yoksa grup atlanir,
 *  - kazanan en yuksek tiklama orani (esitlikte cok gosterimli, sonra kimlik),
 *  - geride kalan ancak ctrClearlyBetter ve convertsNoBetter ise ve
 *    `skip`'te (defterde) degilse duraklatilir,
 *  - kazanan hicbir zaman duraklatilmaz: her grupta en az bir uygun reklam kalir.
 * Ayni duraklatma hedefi iki satirda gecerse yanit guvenilmez → null.
 */
export function planAbGroups(variants: AdVariant[], skip: ReadonlySet<string>): AbGroupPlan[] | null {
  const targets = new Set<string>();
  for (const v of variants) {
    if (targets.has(v.target)) return null;
    targets.add(v.target);
  }
  const groups = new Map<string, { name: string; ads: Rated[] }>();
  for (const v of variants) {
    const r = rated(v);
    if (!r) continue;
    const g = groups.get(r.groupId) ?? { name: r.groupName, ads: [] };
    g.ads.push(r);
    groups.set(r.groupId, g);
  }
  const plans: AbGroupPlan[] = [];
  for (const [groupId, g] of groups) {
    if (g.ads.length < 2) continue;
    const sorted = [...g.ads].sort((a, b) =>
      b.ctr - a.ctr || b.impressions - a.impressions || (a.adId < b.adId ? -1 : a.adId > b.adId ? 1 : 0));
    const winner = sorted[0];
    const losers = sorted.slice(1).filter((l) => !skip.has(l.target) && ctrClearlyBetter(winner, l) && convertsNoBetter(winner, l));
    // Savunma: kazanan listede olamaz, grup bosalmaz
    if (losers.length === 0 || losers.some((l) => l.target === winner.target)) continue;
    plans.push({ groupId, groupName: g.name, winner, losers });
  }
  return plans;
}

/** Bir grubun bu turdaki sonucu: grup kaydi + ozet icin ham sayilar ve KESILMEMIS kimlik listesi */
interface AbGroupOutcome {
  entry: HistoryEntry;
  groupId: string;
  paused: number;
  failed: number;
  uncertain: number;
  pausedAdIds: string[];
  reason?: string;
}

/**
 * Duraklatilan reklam kimlikleri: siniri asarsa ilk `max` kimlik yazilir ve
 * pausedAdIdsTotal (onaylanan duraklatmalarin tamami) eklenir. Eskiden liste
 * sessizce kesiliyordu; panel "kimlikleri" deyip eksik liste gosteriyordu.
 */
function pausedIdsFields(ids: string[], max: number): HistoryEntry {
  if (ids.length === 0) return {};
  return ids.length > max ? { pausedAdIds: ids.slice(0, max), pausedAdIdsTotal: ids.length } : { pausedAdIds: [...ids] };
}

/**
 * Butceye sigmayan gruplarin tek ozet kaydi. groupId / groupName / kazanan
 * YOK (tek grup degil): groupCount birlesen grup sayisi, groupIds kimlikleri
 * (en fazla AB_HISTORY_SUMMARY_IDS_MAX; fazlasi varsa groupCount daha
 * buyuktur), sayilar toplam, pausedAdIds onaylanan tum duraklatmalar (sinirli,
 * kesilirse pausedAdIdsTotal). Hicbirinde onayli ya da belirsiz duraklatma
 * yoksa 'ab-test-pause-failed': sonraki turda ayni basarisizlik groupIds ile
 * taninir ve yeniden yazilmaz.
 */
function abSummaryEntry(rest: AbGroupOutcome[], time: string): HistoryEntry {
  let paused = 0;
  let failed = 0;
  let uncertain = 0;
  for (const o of rest) {
    paused += o.paused;
    failed += o.failed;
    uncertain += o.uncertain;
  }
  const reason = rest.find((o) => o.failed > 0 && o.reason)?.reason;
  const base: HistoryEntry = { time, groupCount: rest.length, groupIds: rest.map((o) => o.groupId).slice(0, AB_HISTORY_SUMMARY_IDS_MAX) };
  if (paused === 0 && uncertain === 0) {
    return { ...base, action: 'ab-test-pause-failed', failedCount: failed, ...(reason ? { reason } : {}) };
  }
  return {
    ...base,
    action: 'ab-test-winner',
    pausedCount: paused,
    failedCount: failed,
    ...(uncertain > 0 ? { uncertainCount: uncertain } : {}),
    ...pausedIdsFields(rest.flatMap((o) => o.pausedAdIds), AB_HISTORY_SUMMARY_IDS_MAX),
    ...(failed > 0 && reason ? { reason } : {}),
  };
}

/**
 * Bu turun gecmise girecek kayitlari: AB_HISTORY_RUN_MAX'a sigiyorsa grup
 * basina birer kayit; sigmiyorsa ilk AB_HISTORY_RUN_MAX - 1 grup ayri, kalanlar
 * tek ozet kayitta. Ayri kayit onceligi onayli / belirsiz duraklatmalarda (grup
 * adi ve kazanan musteriye gerekli); basarisizliklar (cogu hesap capinda ayni
 * neden) once ozete gider.
 */
function abRunEntries(outcomes: AbGroupOutcome[], time: string): HistoryEntry[] {
  if (outcomes.length <= AB_HISTORY_RUN_MAX) return outcomes.map((o) => o.entry);
  const ranked = [
    ...outcomes.filter((o) => o.entry.action === 'ab-test-winner'),
    ...outcomes.filter((o) => o.entry.action !== 'ab-test-winner'),
  ];
  const keep = AB_HISTORY_RUN_MAX - 1;
  return [...ranked.slice(0, keep).map((o) => o.entry), abSummaryEntry(ranked.slice(keep), time)];
}

/**
 * A/B Test Manager — ayni reklam grubundaki (Meta'da reklam setindeki) yayinda
 * olan reklamlarin son 7 gunluk tiklama oranini karsilastirir, anlamli bicimde
 * geride kalanlari duraklatir (planAbGroups kurallari).
 *
 * Bir kampanyada hicbir sey YAPILMAYAN durumlar (gecmise kayit da yazilmaz):
 *  - kampanya platformda yayinda degil (getLiveBudget status ACTIVE degil ya da
 *    okunamadi): duraklatilmis / bitmis / baslamamis kampanyada karar verilmez,
 *  - reklam satirlari okunamadi ya da beklenmeyen bicimde (getAdVariants null),
 *  - defter okunamadi, bozuk ya da dolu; duraklatma niyeti deftere yazilamadi.
 *
 * DEFTER (KvStore, anahtar AB_LEDGER_PREFIX + site:platform:kampanya): RanksUp'in
 * duraklattigi her reklam, duraklatma isteginden ONCE yazilir. Eskiden musterinin
 * yeniden actigi reklam bir sonraki 6 saatlik turda yine duraklatiliyordu
 * (duraklatma oncesi gosterimleri 7 gunluk pencerede kaldigi icin). Defterdeki
 * bir reklam etkin gorunuyorsa musteri yeniden acmistir: bir daha duraklatilmaz.
 * Gecmise (autopilotActions, son 20 kayit) guvenilmez: diger adimlar da yazar
 * ve eski kayit duser. Istek sonucu belirsizse (uncertain) reklam defterde
 * kalir; platform kesin reddettiyse defterden silinir (sonraki tur yeniden
 * deneyebilir; silme yazilamazsa reklam defterde kalir — temkinli yon).
 *
 * Gecmise YALNIZ platformun onayladigi duraklatmalar "duraklatildi" yazilir,
 * her grup icin ayri kayit (groupId, groupName):
 *  - hicbiri duraklatilamadiysa ve belirsiz sonuc yoksa 'ab-test-pause-failed'
 *    (platformun nedeniyle; ayni grupta ayni basarisizlik ust uste yazilmaz),
 *  - aksi halde 'ab-test-winner': pausedCount yalniz onaylananlar, failedCount
 *    HER ZAMAN (hepsi onaylandiysa 0) — panel bu alanin varligindan kaydin
 *    yeni surumden (sayilari onayli) oldugunu anlar; uncertainCount sonucu
 *    bilinmeyenler (yalniz > 0 ise), pausedAdIds onaylanan reklam kimlikleri
 *    (en fazla AB_HISTORY_GROUP_IDS_MAX; kesildiyse pausedAdIdsTotal tamaminin
 *    sayisi).
 * Bir tur bir kampanyaya en fazla AB_HISTORY_RUN_MAX kayit yazar (gecmis tum
 * adimlarin ortak son 20 kaydi): fazla gruplar groupId'siz tek ozet kayitta
 * birlesir (abSummaryEntry: groupCount, groupIds, toplam sayilar, tum onayli
 * kimlikler); hicbir onayli duraklatma gecmisten kaybolmasin.
 *
 * Uygunluk: startDate en az 7 gun once. startDate'i performance-sync yazar
 * (kampanyanin platformda yayinda goruldugu ilk an). Eskiden hicbir kod
 * yazmiyordu: NULL <= x SQL'de hicbir satiri secmedigi icin bu adim hic
 * calismiyordu (ab-test-manager.spec.ts sahte findMany'si where'i SQL NULL
 * kuraliyla uygular, bu durum fark edilmeden geri gelmesin).
 */
@Injectable()
export class AbTestManagerService {
  private readonly log = new Logger(AbTestManagerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly adsClient: AdsClientService,
  ) {}

  /** Defter: duraklatma hedefi → ilk duraklatma zamani. Okunamaz ya da bozuksa null */
  private async readLedger(key: string): Promise<Map<string, string> | null> {
    try {
      const row = await this.prisma.kvStore.findUnique({ where: { key } });
      if (!row) return new Map();
      const parsed: any = JSON.parse(row.value);
      if (!parsed || parsed.v !== 1 || !parsed.paused || typeof parsed.paused !== 'object' || Array.isArray(parsed.paused)) return null;
      const out = new Map<string, string>();
      for (const [k, v] of Object.entries(parsed.paused)) {
        if (typeof v !== 'string') return null;
        out.set(k, v);
      }
      return out;
    } catch (err: any) {
      this.log.warn(`A/B defteri okunamadi (${key}): ${err?.message ?? err}`);
      return null;
    }
  }

  private async writeLedger(key: string, ledger: Map<string, string>): Promise<boolean> {
    try {
      const value = JSON.stringify({ v: 1, paused: Object.fromEntries(ledger) });
      await this.prisma.kvStore.upsert({ where: { key }, create: { key, value }, update: { value } });
      return true;
    } catch (err: any) {
      this.log.warn(`A/B defteri yazilamadi (${key}): ${err?.message ?? err}`);
      return false;
    }
  }

  async pickWinners(): Promise<{ analyzed: number; winnersChosen: number; pausedAds: number }> {
    const sites = await this.prisma.site.findMany({
      where: { adsAutopilot: true } as any,
    });

    let analyzed = 0;
    let winnersChosen = 0;
    let pausedAds = 0;

    for (const site of sites) {
      const oneWeekAgo = new Date(Date.now() - 7 * 86400000);
      const campaigns = await this.prisma.adCampaign.findMany({
        where: {
          siteId: site.id,
          status: 'ACTIVE',
          startDate: { lte: oneWeekAgo },
        },
      });

      for (const c of campaigns) {
        if (!c.externalId) continue;
        analyzed++;
        const platform = c.platform;
        if (platform !== 'google_ads' && platform !== 'meta_ads') continue;
        try {
          // 1. Kampanya platformda yayinda mi (Google ENABLED + SERVING, Meta ACTIVE ve takvimi suruyor)
          const liveRes = await this.adsClient.getLiveBudget(site.id, platform, c.externalId);
          if (!liveRes.ok || liveRes.live.status !== 'ACTIVE') {
            this.log.log(`[${c.id}] A/B: kampanya platformda yayinda degil ya da durumu okunamadi; dokunulmadi`);
            continue;
          }

          // 2. Reklamlar, gruplari ve uygunluklari
          const variants = await this.adsClient.getAdVariants(site.id, platform, c.externalId);
          if (!variants) {
            this.log.log(`[${c.id}] A/B: reklam satirlari okunamadi; dokunulmadi`);
            continue;
          }

          // 3. Defter: musterinin yeniden actigi reklamlar
          const key = `${AB_LEDGER_PREFIX}${site.id}:${platform}:${c.externalId}`;
          const ledger = await this.readLedger(key);
          if (!ledger) {
            this.log.warn(`[${c.id}] A/B: defter okunamadi ya da bozuk; dokunulmadi`);
            continue;
          }

          const plans = planAbGroups(variants, new Set(ledger.keys()));
          if (!plans) {
            this.log.warn(`[${c.id}] A/B: ayni reklam iki kez geldi; dokunulmadi`);
            continue;
          }
          if (plans.length === 0) continue;

          const toPause = plans.flatMap((p) => p.losers);
          if (ledger.size + toPause.length > AB_LEDGER_MAX) {
            this.log.warn(`[${c.id}] A/B: defter dolu (${ledger.size}); yeni duraklatma yapilmadi`);
            continue;
          }

          // 4. Niyet ONCE deftere: yazilamazsa duraklatma yok (musteri yeniden acarsa taninamazdi)
          const time = new Date().toISOString();
          for (const l of toPause) ledger.set(l.target, time);
          if (!(await this.writeLedger(key, ledger))) continue;

          const history: HistoryEntry[] = Array.isArray(c.autopilotActions) ? [...(c.autopilotActions as HistoryEntry[])] : [];
          // Grup sonuclari once toplanir: kayit butcesini asarsa fazlasi ozete (abRunEntries)
          const outcomes: AbGroupOutcome[] = [];
          let ledgerChanged = false;

          for (const plan of plans) {
            let paused = 0;
            let failed = 0;
            let uncertain = 0;
            let reason: string | undefined;
            const pausedAdIds: string[] = [];
            for (const loser of plan.losers) {
              const r: { ok: boolean; error?: string; uncertain?: boolean } = await this.adsClient
                .setAdStatus(site.id, platform, loser.target, true)
                .catch(() => ({ ok: false, uncertain: true }));
              if (r.ok) {
                paused++;
                pausedAdIds.push(loser.adId);
              } else if (r.uncertain) {
                // Duraklatilmis olabilir: defterde kalir, bir daha dokunulmaz
                uncertain++;
              } else {
                // Platform kesin reddetti: reklam duraklatilmadi, sonraki tur yeniden deneyebilir
                failed++;
                ledger.delete(loser.target);
                ledgerChanged = true;
                if (!reason && typeof r.error === 'string' && r.error) reason = r.error;
              }
            }
            pausedAds += paused;

            const base: HistoryEntry = {
              time,
              groupId: plan.groupId,
              ...(plan.groupName ? { groupName: plan.groupName } : {}),
              winnerAdId: plan.winner.adId,
              winnerCtr: plan.winner.ctr,
            };

            if (paused === 0 && uncertain === 0) {
              this.log.warn(`[${c.id}] A/B grup ${plan.groupId}: kazanan ad ${plan.winner.adId}; ${failed} reklamin hicbiri duraklatilamadi${reason ? `: ${reason}` : ''}`);
              const entry: HistoryEntry = { ...base, action: 'ab-test-pause-failed', failedCount: failed, ...(reason ? { reason } : {}) };
              // Ayni grupta ayni basarisizlik her 6 saatte tekrar yazilip gecmisin son 20 kaydini doldurmasin.
              // Grubu ozet kayitta (groupIds) gecen basarisizlik da sayilir: yoksa ozete giren gruplar her tur
              // yeniden yazilir, gecmis yine dolardi.
              const lastForGroup = [...history].reverse().find((h) =>
                (h.action === 'ab-test-winner' || h.action === 'ab-test-pause-failed')
                && (h.groupId === plan.groupId || (Array.isArray(h.groupIds) && h.groupIds.includes(plan.groupId))));
              const repeated = !!lastForGroup
                && lastForGroup.action === entry.action
                && (Array.isArray(lastForGroup.groupIds)
                  // Ozet grup basina kazanan / sayi tasimaz: ayni neden yeter
                  ? (lastForGroup.reason ?? null) === (entry.reason ?? null)
                  : lastForGroup.winnerAdId === entry.winnerAdId
                    && lastForGroup.failedCount === entry.failedCount
                    && (lastForGroup.reason ?? null) === (entry.reason ?? null));
              if (!repeated) outcomes.push({ entry, groupId: plan.groupId, paused, failed, uncertain, pausedAdIds, reason });
              continue;
            }

            if (paused > 0) winnersChosen++;
            this.log.log(`[${c.id}] A/B grup ${plan.groupId}: kazanan ad ${plan.winner.adId} (CTR ${(plan.winner.ctr * 100).toFixed(2)}%), ${paused}/${plan.losers.length} reklam duraklatildi, ${uncertain} belirsiz`);
            const entry: HistoryEntry = {
              ...base,
              action: 'ab-test-winner',
              pausedCount: paused,
              // failedCount HER ZAMAN yazilir (hic basarisizlik yoksa 0). Eski surum
              // pausedCount'u platform onayi olmadan yaziyordu ve failedCount
              // tasimiyordu; panel (web lib/ads-history.ts abTestDetail) alansiz
              // kaydi bu yuzden onaysiz sayip "duraklatilmak uzere secildi" diyor.
              failedCount: failed,
              ...(uncertain > 0 ? { uncertainCount: uncertain } : {}),
              ...pausedIdsFields(pausedAdIds, AB_HISTORY_GROUP_IDS_MAX),
              ...(failed > 0 && reason ? { reason } : {}),
            };
            outcomes.push({ entry, groupId: plan.groupId, paused, failed, uncertain, pausedAdIds, reason });
          }

          // En iyi gayret: yazilamazsa kesin reddedilen reklam defterde kalir (yalniz yeniden denenmez)
          if (ledgerChanged) await this.writeLedger(key, ledger);
          const fresh = abRunEntries(outcomes, time);
          if (fresh.length > 0) {
            history.push(...fresh);
            await this.prisma.adCampaign.update({
              where: { id: c.id },
              data: { autopilotActions: history.slice(-20) as any },
            });
          }
        } catch (err: any) {
          this.log.warn(`[${c.id}] A/B fail: ${err.message}`);
        }
      }
    }

    this.log.log(`A/B test analyzer: ${analyzed} kampanya, ${winnersChosen} grupta kazanan, ${pausedAds} reklam duraklatildi`);
    return { analyzed, winnersChosen, pausedAds };
  }
}
