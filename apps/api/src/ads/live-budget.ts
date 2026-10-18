import { roundBudget } from './budget-guard.js';

/**
 * Reklam platformundaki CANLI kampanya durumu ve butcesi — otopilotun her
 * butce degisikliginde dayandigi tek kaynak.
 *
 * NEDEN: orchestrator ve budget-shifter yeni gunluk butceyi RanksUp'in kendi
 * kopyasindan (AdCampaign.budgetAmount) hesaplayip Google/Meta'ya MUTLAK deger
 * olarak yaziyordu; kopya platformdan hic yenilenmiyordu. Musteri butceyi
 * Google Ads'te 500'den 50'ye indirdiyse otopilot 50'yi 600 yapiyordu (12 kat)
 * ve budget-guard'in tabani/tavani da ayni bayat sayidan hesaplaniyordu; tersinde
 * (canli 1000, kayit 100) "artis" butceyi 120'ye KESIYORDU. Kural artik:
 *  1. Her degisiklikten once canli butce okunur; yeni tutar ve guard tabani ondan.
 *  2. Canli deger kayittan farkliysa o tur degisiklik yapilmaz, kayit esitlenir
 *     (musterinin elle yaptigi degisiklik ayni turda ezilmez, eski koddan kalan
 *     sisirilmis kayitlar platforma tasinmaz).
 *  3. Platform yazimi "beklenen mevcut deger" ile yapilir: istemci yazmadan
 *     hemen once yeniden okur, butce arada degismisse yazmaz.
 *  4. performance-sync her turda butceyi ve kalici durumu (kaldirildi /
 *     arsivlendi / silindi) kayda yansitir.
 */

/** Platform durumu RanksUp kumesine indirgenmis: ENDED = kalici (Google REMOVED, Meta ARCHIVED/DELETED) */
export type LiveCampaignStatus = 'ACTIVE' | 'PAUSED' | 'ENDED' | 'OTHER';

export interface LiveCampaignBudget {
  status: LiveCampaignStatus;
  /** Platformun ham durum degeri (loglar icin): ENABLED, REMOVED, ARCHIVED, WITH_ISSUES ... */
  platformStatus: string;
  /**
   * daily: yalniz bu kampanyaya ait gunluk butce (otopilot degistirebilir)
   * shared: baska kampanyalarla paylasilan gunluk butce (Google) — degistirilmez
   * lifetime: toplam (omur boyu) butce — degistirilmez
   * null: butce okunamadi ya da belirsiz (or. Meta'da gunluk ve toplam butceli ad set'ler karisik)
   */
  budgetType: 'daily' | 'shared' | 'lifetime' | null;
  /** budgetType'in tutari, reklam hesabinin para biriminde; bilinmiyorsa null */
  amount: number | null;
}

export type LiveBudgetResult = { ok: true; live: LiveCampaignBudget } | { ok: false; error?: string };

/** Platform butce yazimi sonucu (AdsClientService.updateBudget) */
export interface BudgetWriteResult {
  ok: boolean;
  /** Yalniz nedeni kesin olan durumda Turkce aciklama */
  error?: string;
  /** Yazim yapilmadi: canli butce, cagiranin dayandigi degerden farkli */
  stale?: boolean;
  /** stale durumunda okunan canli butce (cagiran kaydi esitler) */
  live?: number;
  /** Basarili yazimda platformun uyguladigi tutar (Meta en kucuk birime yuvarlar) */
  applied?: number;
  /**
   * Basarisiz yazimda platformda degisiklik kalmis OLABILIR: Meta'da bazi ad
   * set'ler yazilip geri alinamadi ya da ag hatasi yuzunden sonuc bilinmiyor.
   * Cagiran bu durumda budget-guard rezervasyonunu geri ALMAZ (guard bir artisi
   * fazla sayar = temkinli) ve toplam butceyi artirabilecek telafi adimi atmaz.
   */
  uncertain?: boolean;
}

const MATCH_ABS = 0.01;
const MATCH_REL = 0.005;

/**
 * Iki butce ayni mi. Sayilmayan farklar: kurus yuvarlamasi (kayit Decimal(10,2),
 * Google mikro birim) ve Meta'nin en kucuk birime yuvarlamasi (JPY gibi
 * birimlerde tamsayi). Daha buyuk fark = butce baska yerden degismis.
 */
export function sameBudget(a: number, b: number): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  const tolerance = Math.max(MATCH_ABS, MATCH_REL * Math.max(Math.abs(a), Math.abs(b)));
  return Math.abs(a - b) <= tolerance + 1e-9;
}

/**
 * Otopilotun degistirebilecegi canli gunluk butce. Platformda etkin olmayan
 * (duraklatilmis, kaldirilmis, sorunlu) kampanyanin butcesine dokunulmaz: son
 * 30 gunun metrikleri iyi olsa bile kampanya su an harcamiyor. Yayin takvimi
 * henuz baslamamis kampanya da (Google serving_status PENDING, Meta
 * ACTIVE/SCHEDULED) 'OTHER' gelir ve ayni sekilde dokunulmaz.
 */
export function autopilotDailyBudget(live: LiveCampaignBudget): { ok: true; amount: number } | { ok: false; reason: string } {
  if (live.status !== 'ACTIVE') return { ok: false, reason: `kampanya reklam platformunda etkin degil (${live.platformStatus})` };
  if (live.budgetType === 'shared') return { ok: false, reason: 'butce baska kampanyalarla paylasiliyor' };
  if (live.budgetType === 'lifetime') return { ok: false, reason: 'toplam (omur boyu) butceli kampanya' };
  if (live.budgetType !== 'daily' || live.amount === null || !(live.amount > 0)) {
    return { ok: false, reason: 'reklam platformundaki gunluk butce okunamadi' };
  }
  return { ok: true, amount: live.amount };
}

export interface LiveSyncPatch {
  status?: 'ENDED';
  budgetType?: 'daily' | 'lifetime';
  budgetAmount?: number;
}

/**
 * Platformdaki gercegi RanksUp kaydina yansitan alanlar (bos nesne = fark yok).
 *
 * Durum: yalniz KALICI son (Google REMOVED, Meta ARCHIVED/DELETED) → ENDED;
 * otopilot ve kaydirici artik o kampanyaya dokunmaz. Platformda duraklatilmis
 * kampanya ETKIN kalir: yeniden acildiginda kayit kendiliginden dogru olsun ve
 * otopilot "duraklatildi" kaydini musterinin acmasina karsi tekrar tekrar
 * uygulamasin; butce adimlari zaten canli durumu okuyup duraklatilmis
 * kampanyaya dokunmaz (autopilotDailyBudget).
 *
 * Butce: tutar okunabildiyse kurusuna kadar esitlenir (paylasilan gunluk butce
 * de kampanyanin harcayabilecegi gunluk tutardir); tur gunluk/toplam olarak.
 */
export function liveSyncPatch(
  row: { status?: string | null; budgetType?: string | null; budgetAmount?: unknown },
  live: LiveCampaignBudget,
): LiveSyncPatch {
  const patch: LiveSyncPatch = {};
  if (live.status === 'ENDED' && row.status !== 'ENDED') patch.status = 'ENDED';
  if (live.budgetType !== null && live.amount !== null && live.amount > 0) {
    const type = live.budgetType === 'lifetime' ? 'lifetime' : 'daily';
    if (row.budgetType !== type) patch.budgetType = type;
    const amount = roundBudget(live.amount);
    const recorded = row.budgetAmount === null || row.budgetAmount === undefined ? Number.NaN : Number(row.budgetAmount);
    if (!Number.isFinite(recorded) || Math.abs(recorded - amount) >= 0.005) patch.budgetAmount = amount;
  }
  return patch;
}

export function hasPatch(p: LiveSyncPatch): boolean {
  return Object.keys(p).length > 0;
}
