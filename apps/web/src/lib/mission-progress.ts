/**
 * Kurulum ilerlemesi — saf hesaplar (bilesen: components/ai-scan/mission-wheel.tsx).
 *
 * NEDEN VAR: kurulum ekrani yuzdeyi yalniz gecen sureye gore artiriyordu (60 sn
 * tahmin): bir dakikada %95'e gelip orada bekliyor, cumleler de adimlardan
 * bagimsiz donuyordu. Site taramasi AI olcumunu de bekler (her asistana 5 soru,
 * tekrarli) ve birkac dakika surer; bes adimdan ikisi bitmisken ekran dakikalarca
 * "95% · Yayın takvimi planlanıyor" yaziyor, kurulum takilmis gibi gorunuyordu
 * (12.11.2026, iki ayri sitede). Yuzde artik BITEN ADIMLARDAN hesaplanir, cumle
 * yalniz GERCEKTEN suren adimi soyler.
 */

export type MissionTaskKey = 'brain' | 'audit' | 'topics' | 'platform' | 'schedule';

export type MissionTask = {
  key: MissionTaskKey;
  label: string;
  done: boolean;
};

/** Bir adim icinde yuzdenin yaklasabilecegi pay (adim diliminin orani) — sonraki adimin sinirina varmaz */
const STEP_CREEP_SHARE = 0.8;
/** Adim ici ilerlemenin zaman sabiti: ~2 dakikada payin yaklasik dortte ucu dolar, sonra yavaslar */
const STEP_CREEP_TAU_MS = 90_000;
/** Site taramasi bu kadar surdukten sonra "bu adim uzun surer" notu gosterilir */
export const LONG_STEP_NOTE_AFTER_MS = 45_000;

/**
 * Su an GERCEKTEN calisabilecek adimlar (zincir sirasi, worker ONBOARDING_CHAIN):
 * marka beyni + site taramasi + platform tespiti birlikte baslar; icerik konulari
 * bunlar bitince, yayin takvimi konulardan sonra calisir.
 */
export function activeTaskKeys(tasks: MissionTask[]): MissionTaskKey[] {
  const pending = (k: MissionTaskKey) => tasks.some((t) => t.key === k && !t.done);
  const done = (k: MissionTaskKey) => tasks.some((t) => t.key === k && t.done);
  // Sonraki asama bittiyse oncekiler de BITMISTIR — "bitmedi" gorunen adim sonucsuz
  // kalmistir (tarama hata verdi, platform tespit edilemedi; zincir yine de ilerler).
  // Yoksa ekran konular hazirken hala "site taranıyor" derdi.
  if (done('schedule')) return [];
  if (done('topics')) return pending('schedule') ? ['schedule'] : [];
  const ilk = (['brain', 'audit', 'platform'] as MissionTaskKey[]).filter(pending);
  // Platform tespiti zinciri bekletmez (tespit edilemese de konular baslar)
  if (ilk.some((k) => k !== 'platform')) return ilk;
  if (pending('topics')) return ['topics'];
  if (pending('schedule')) return ['schedule'];
  return ilk;
}

/** Calisan adimlarin durum cumleleri — yalniz gercekten suren adimlar icin */
export function activeMessages(tasks: MissionTask[]): string[] {
  const active = activeTaskKeys(tasks);
  const brainDone = !active.includes('brain');
  const out: string[] = [];
  if (active.includes('brain')) out.push('Marka sesi ve hedef kitle çıkarılıyor', 'Rakipler belirleniyor');
  if (active.includes('audit')) {
    out.push('Site sayfaları taranıyor');
    // AI olcumu sorularini marka beyninden alir: beyin bitmeden baslamaz
    if (brainDone) out.push('AI asistanlarına sorular soruluyor');
  }
  // Platform tespiti icin cumle yok: saniyeler surer; sonucsuz bittiyse "tespit ediliyor" yanlis olurdu
  if (active.includes('topics')) out.push('İçerik konuları üretiliyor');
  if (active.includes('schedule')) out.push('Yayın takvimi planlanıyor');
  return out.length > 0 ? out : ['Kurulum tamamlanıyor'];
}

/**
 * Ilerleme yuzdesi: biten adim sayisi + suren adim icinde yavaslayarak artan pay.
 * Bir sonraki adim bitmeden o adimin sinirina varmaz; bes adimdan ikisi bitmisken
 * %95 yazmaz.
 */
export function missionPercent(doneCount: number, total: number, sinceStepMs: number): number {
  if (total <= 0) return 0;
  if (doneCount >= total) return 100;
  const step = 100 / total;
  const creep = step * STEP_CREEP_SHARE * (1 - Math.exp(-Math.max(0, sinceStepMs) / STEP_CREEP_TAU_MS));
  return Math.min(99, doneCount * step + creep);
}
