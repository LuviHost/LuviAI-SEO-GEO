/**
 * Plan siniri — duvara carpan dugmenin ne diyecegi. Saf, test edilir (plan-limit.spec.mts).
 *
 * SAHIP ISTEGI (15.11.2026): hakki ya da plani yetmeyen musteri olu bir dugme / kirmizi bir
 * hata gormesin; dugme ona yolu gostersin. Uc bicim:
 *  - 'buy'   : duvari kaldiran plan kartla aliniyor  → "Profesyonel'e geç" (panel ici plan penceresi)
 *  - 'quote' : duvari kaldiran plan yalniz teklifle  → "Teklif al"
 *  - 'wait'  : hicbir plan kaldirmiyor               → satis YOK; ne zaman acilacagi yazilir
 *
 * DURUSTLUK KURALI: hangi bicimin gecerli oldugunu SUNUCU soyler (api billing/plan-limit.ts
 * upgradeOfferFor; ozellik kapilari icin /me entitlements.required[..].offer). Web plan
 * tablosu tutmaz (bkz. lib/entitlements.ts) ve "satin al"i kendi basina uydurmaz: paket
 * almanin kaldirmadigi yerde (haftalik olcum hakki her planda ayni) satis dugmesi cikmaz.
 *
 * SATIN ALMA KAPALIYKEN (PayTR test modu; lib/checkout-availability.ts): musteri kartla
 * alamaz. Dugme "X'e geç" yerine "Bize yaz" der; pencere planlari ve iletisim adresini gosterir.
 */

/** 403 govdesindeki makine kodu (api billing/plan-limit.ts PLAN_LIMIT_CODE) */
export const PLAN_LIMIT_CODE = 'PLAN_LIMIT';

/** window CustomEvent adi; detail: UpgradeRequest (components/upgrade-gate.tsx dinler) */
export const PLAN_LIMIT_EVENT = 'ranksup:plan-limit';

export type UpgradeKind = 'buy' | 'quote' | 'wait';

export interface UpgradeOffer {
  kind: UpgradeKind;
  planId: string | null;
  planName: string | null;
}

/** Plan penceresini acan istek: hangi yol + neden (musteriye gosterilen cumle) */
export interface UpgradeRequest {
  offer: UpgradeOffer;
  reason: string;
  /** Sunucu hatasindan mi geldi? O zaman cagiranin ham hata bildirimi kapatilir */
  fromError?: boolean;
}

const isKind = (v: unknown): v is UpgradeKind => v === 'buy' || v === 'quote' || v === 'wait';
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

/** Sunucunun `upgrade` alani; yoksa ya da bicim disiysa null (tahmin yurutulmez) */
export function readUpgradeOffer(raw: unknown): UpgradeOffer | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (!isKind(o.kind)) return null;
  const planName = text(o.planName);
  // Satis yolu plan adi olmadan yazilamaz ("…'e geç" neye?)
  if (o.kind !== 'wait' && !planName) return null;
  return { kind: o.kind, planId: text(o.planId), planName: o.kind === 'wait' ? null : planName };
}

/** Hata govdesindeki yukseltme yolu (kod ne olursa olsun: AI butcesi ve Asistan notu da tasir) */
export function upgradeOfferOfError(body: unknown): UpgradeOffer | null {
  if (!body || typeof body !== 'object') return null;
  return readUpgradeOffer((body as { upgrade?: unknown }).upgrade);
}

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Hatali yanit bir plan siniri mi, panel plan penceresini acmali mi?
 *  - yalniz 403 + PLAN_LIMIT kodu + satis yolu ('buy' / 'quote');
 *  - yalniz DEGISTIREN istek: pencere bir TIKLAMANIN cevabidir. Okuma isteginde (sayfa
 *    acilirken gelen 403) acilmaz — sayfaya giren musterinin onune satis penceresi
 *    firlamasin; o sayfalar kilit kartini kendisi cizer (PlanLockedCard).
 *  - 'wait' pencere acmaz: satilacak bir sey yok, sunucunun metni (ne zaman yenilenir)
 *    cagiranin bildirimiyle gosterilir.
 */
export function planLimitRequest(status: number, method: string | null | undefined, body: unknown): UpgradeRequest | null {
  if (status !== 403) return null;
  if (!body || typeof body !== 'object') return null;
  if ((body as { code?: unknown }).code !== PLAN_LIMIT_CODE) return null;
  // Yontem verilmediyse (bos / tanimsiz) fetch varsayilani GET'tir
  if (READ_METHODS.has(String(method || 'GET').toUpperCase())) return null;
  const offer = upgradeOfferOfError(body);
  if (!offer || offer.kind === 'wait') return null;
  return { offer, reason: text((body as { message?: unknown }).message) ?? '', fromError: true };
}

/**
 * Kilitli ozelligin yukseltme yolu (/me entitlements.required[ozellik]). `offer` alani yoksa
 * (eski API) yol bilinmiyor: null doner, dugme satis vaat etmeden "Planları gör" der.
 */
export function requirementOffer(
  req: { plan?: unknown; planName?: unknown; offer?: unknown } | null | undefined,
): UpgradeOffer | null {
  if (!req) return null;
  return readUpgradeOffer({ kind: req.offer, planId: req.plan, planName: req.planName });
}

const BACK_VOWELS = 'aıouAIOU';
const VOWELS = 'aeıioöuüAEIİOÖUÜ';

/**
 * Plan adina yonelme eki: "Profesyonel'e", "Başlangıç'a", "Kurumsal'a". Ek son unluye uyar
 * (kalin → a, ince → e); ad unluyle bitiyorsa kaynastirma "y" gelir. Plan adi sunucudan
 * geldigi icin (plan yeniden adlandirilabilir) ek elle yazilmaz.
 */
export function dativeOf(name: string): string {
  const trimmed = name.trim();
  const letters = [...trimmed];
  const lastVowel = [...letters].reverse().find((ch) => VOWELS.includes(ch));
  const suffix = lastVowel && BACK_VOWELS.includes(lastVowel) ? 'a' : 'e';
  const endsWithVowel = VOWELS.includes(letters[letters.length - 1] ?? '');
  return `${trimmed}'${endsWithVowel ? 'y' : ''}${suffix}`;
}

export const LIMIT_COPY = {
  quote: 'Teklif al',
  contact: 'Bize yaz',
  plans: 'Planları gör',
  quoteTitle: (planName: string) => `${planName} planı teklifle sunuluyor`,
  quoteBody: 'Kapsamı ve fiyatı birlikte belirliyoruz. Bize yaz, ihtiyacını dinleyip teklif gönderelim.',
  quoteSubject: (planName: string) => `${planName} planı — teklif`,
  /** Haftalik olcum hakki: dugmenin ustunde yazan kisa etiket */
  nextMeasurement: (when: string) => `Sonraki ölçüm ${when}`,
  /** Haftalik olcum hakki: bos kutularda ve ipuclarinda yazan tam cumle */
  measurementUsed: (when: string) =>
    `Bu site için ölçüm hakkını kullandın. Her site 7 günde 1, ayda en fazla 4 kez ölçülür; sonraki ölçüm ${when} itibarıyla açılır.`,
  /** Hicbir planin kaldirmadigi sinir ('wait'): satis yok, dugme pasif */
  atLimit: 'Sınıra ulaştın',
} as const;

/**
 * Kilitli dugmenin etiketi.
 *  - 'quote'                       → "Teklif al"
 *  - 'buy', satin alma acik        → "Profesyonel'e geç"
 *  - 'buy', satin alma KAPALI      → "Bize yaz" (kartla alinamaz; "geç" demek bos vaat olur)
 *  - 'buy', durum BILINMIYOR       → "Planları gör". Satin alma durumu yuklenirken ya da
 *    okunamadiginda "geç" denmez: test modunda her musteri ilk cizimde bos vaat gorurdu
 *    (bagimsiz inceleme 15.11.2026). Durum gelince etiket kesinlesir.
 *  - 'wait' ya da plan adi yok     → "Planları gör" (dugme satis vaat etmez)
 */
export function upgradeLabel(offer: UpgradeOffer | null | undefined, purchaseOpen: boolean | null): string {
  if (!offer || offer.kind === 'wait' || !offer.planName) return LIMIT_COPY.plans;
  if (offer.kind === 'quote') return LIMIT_COPY.quote;
  if (purchaseOpen === false) return LIMIT_COPY.contact;
  if (purchaseOpen === null) return LIMIT_COPY.plans;
  return `${dativeOf(offer.planName)} geç`;
}

/** Yol bilinmiyor: pencere planlari isaretsiz gosterir, musteri kendisi secer */
const UNKNOWN_OFFER: UpgradeOffer = Object.freeze({ kind: 'buy', planId: null, planName: null });

export type UpgradeAction =
  /** Dugme plan / teklif penceresini acar */
  | { mode: 'window'; label: string; offer: UpgradeOffer }
  /** Satilacak bir sey yok: dugme pasif, neden ipucunda */
  | { mode: 'none'; label: string };

/**
 * Kilitli dugme NE YAPAR — etiketle birlikte tek karar (UpgradeButton bunu cizer).
 *  - 'wait': hicbir plan siniri kaldirmiyor → pencere ACILMAZ. Eskiden yol 'buy'a cevrilip
 *    pencere aciliyordu: en ust plandaki musteriye altindaki planlar "Bu plana geç" diye
 *    sunuluyordu (bagimsiz inceleme 15.11.2026).
 *  - yol yok / bicim disi (eski API): pencere isaretsiz acilir, etiket satis vaat etmez.
 */
export function upgradeAction(offer: UpgradeOffer | null | undefined, purchaseOpen: boolean | null): UpgradeAction {
  if (offer?.kind === 'wait') return { mode: 'none', label: LIMIT_COPY.atLimit };
  const known = offer && offer.planName ? offer : null;
  return { mode: 'window', label: upgradeLabel(known, purchaseOpen), offer: known ?? UNKNOWN_OFFER };
}
