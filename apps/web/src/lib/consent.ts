/**
 * Cerez onayi: karar mantigi + izleme etiketlerinin (Google Tag Manager,
 * Google Analytics 4, Microsoft Clarity) onaya bagli yuklenmesi ve geri alinmasi.
 *
 * NEDEN: kok layout GTM'i (GA4, Google Ads donusum + yeniden pazarlama) ve
 * Clarity'yi (oturum kaydi + isi haritasi) HER sayfa goruntulemesinde, onaysiz
 * yukluyordu; cerez bandi yalniz localStorage'a {accepted} yaziyor, "Reddet"
 * hicbir seyi degistirmiyordu (18.10.2026 tespiti). Artik etiketler YALNIZ
 * ziyaretci "Kabul et" dediginde yuklenir; ret ya da secim yoksa hic yuklenmez.
 *
 * Onay sarti (iki kaynak):
 *  1) KVKK, "Cerez Uygulamalari Hakkinda Rehber" (ilk yayin 20.06.2022; guncel
 *     baski: KVKK Yayinlari No: 69, Temmuz 2025)
 *     https://kvkk.gov.tr/Icerik/7353/Cerez-Uygulamalari-Hakkinda-Rehber
 *     - 6.2: davranissal reklam cerezleri acik riza ister; gosterim sikligi,
 *       reklam ortakligi, arastirma ve pazar analizi gibi reklam amacli cerezler dahil;
 *     - 7: acik riza cerez YERLESTIRILMEDEN ONCE, aktif bir eylemle alinir;
 *       siteye girmis olmak riza sayilmaz;
 *     - 7.1: "kabul ediyorum" gibi genel/belirsiz onay acik riza degildir;
 *       amac, sure ve birinci/ucuncu taraf bilgisi verilmelidir;
 *     - 7.3: riza geri alinabilir olmali ve tercih paneline erisim saglanmali;
 *       "kabul et" ile "reddet" esit agirlikta sunulmali; rizaya tabi cerezler
 *       ilk elde pasif gelmeli; riza Gizlilik Bildirimi'ne ilistirilemez
 *       (eski bant tam olarak buydu: "Kabul ederek Gizlilik Politikasi'ni
 *       onaylamis olursun"); tercih, omruyle orantili araliklarla yeniden
 *       sorulabilir ama her giriste sorulmamali;
 *     - 5.8: tercihi hatirlayan kayit ayrica riza gerektirmez;
 *     - 5.9: "birinci taraf analitik" ancak amaci olcumle sinirli, capraz takip
 *       yapmayan ve verisi ucuncu taraflara iletilmeyen haliyle rizasiz
 *       (Kriter B) dusunulebilir. GA4 ve Clarity veriyi Google/Microsoft'a
 *       gonderir; bu kapsama girmez.
 *  2) AB e-Gizlilik Direktifi 2002/58/EC m. 5(3) (2009/136/EC ile degisik):
 *     terminal cihaza bilgi yazmak ya da oradan okumak, acik ve kapsamli
 *     bilgilendirme sonrasi onay ister; istisna yalniz iletim icin ya da
 *     kullanicinin acikca istedigi hizmet icin kesinlikle gerekli olan. AEA'dan
 *     gelen ziyaretciler icin gecerli; KVKK rehberi bolum 3 de bu maddeye atif yapar.
 *     https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02002L0058-20091219
 *
 * Google Consent Mode v2 "gelismis" kipi KULLANILMAZ: o kipte etiketler onaydan
 * once yuklenir ve onay reddedilse de cerezsiz olcum ("cookieless ping")
 * gonderir. "Temel" kipte etiketler banttaki etkilesime kadar yuklenmez ve
 * onaydan once Google'a hicbir veri gitmez; burada uygulanan bu:
 *   https://developers.google.com/tag-platform/security/concepts/consent-mode
 *   https://support.google.com/google-ads/answer/10000067
 * Temel kipin resmi sirasi da izlenir: varsayilan "denied" -> onayla "update
 * granted" -> container en son yuklenir:
 *   https://developers.google.com/tag-platform/security/guides/consent?consentmode=basic
 * Clarity'nin kendi "Consent Mode"u da yetmez: ret durumunda bile betik calisir
 * ve cerezsiz kayit (/collect) gonderir. Bu yuzden Clarity de onaya kadar hic
 * yuklenmez:
 *   https://learn.microsoft.com/en-us/clarity/setup-and-installation/consent-mode
 *   https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-consent-api-v2
 *
 * Saf mantik (ayristirma, karar tablosu, cerez adlari) DOM'suz test edilir;
 * DOM'a dokunan tek yer browserTagEnv() / browserPageEnv() ve olay
 * yardimcilaridir. Bilesenin yan etkileri (geri alma, yukleme, yenileme,
 * bekleyen yenileme) createConsentController'da, ortam enjekte edilerek test edilir.
 */

/** localStorage anahtari. Eski bantla ayni: eski kayitlar parseConsent'te ayrica yorumlanir. */
export const CONSENT_STORAGE_KEY = 'luviai-cookie-consent';

/** Kayit bicimi surumu. 1 = eski bant ({accepted, ts}); 2 = bu surum ({v, choice, ts}). */
export const CONSENT_VERSION = 2;

/**
 * Tercihin gecerlilik suresi: 12 ay. KVKK rehberi 7.3: tercih her giriste
 * sorulmaz ama periyodik olarak yeniden sorulabilir. Sure dolunca karar
 * "secim yok" sayilir; bu arada hicbir sey yuklenmez.
 */
export const CONSENT_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

/** Saat kaymasi toleransi: bundan ileri tarihli kayit bozuk sayilir (suresiz gecerlilik olmasin). */
const CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;

/** Gizlilik sayfasindaki (ya da ileride altbilgideki) "Cerez tercihleri" dugmesi bu olayla bandi acar. */
export const CONSENT_REOPEN_EVENT = 'ranksup:cookie-preferences';

/** Bu sekmede tercih degisti: gizlilik sayfasindaki durum satiri yeniden okur. */
export const CONSENT_CHANGE_EVENT = 'ranksup:cookie-consent-change';

export type ConsentChoice = 'granted' | 'denied';
export type ConsentState = ConsentChoice | 'unset';

/**
 * Saklanan metni karara cevirir. Karar tablosu:
 *  - kayit yok / JSON degil / nesne degil / alan eksik ya da yanlis tipte -> 'unset'
 *  - zaman damgasi 12 aydan eski ya da ileri tarihli                    -> 'unset'
 *  - v2 {choice:'granted'}                                               -> 'granted'
 *  - {choice:'denied'} (hangi surum olursa olsun)                        -> 'denied'
 *  - baska surumun 'granted' kaydi                                       -> 'unset'
 *  - eski bant {accepted:false}                                          -> 'denied'
 *  - eski bant {accepted:true}                                           -> 'unset'
 *
 * NEDEN eski "kabul" gecersiz: eski bant ne yuklendigini soylemiyor ve onayi
 * Gizlilik Politikasi onayina bagliyordu (KVKK rehberi 7.1 ve 7.3); o tiklama
 * bugunku araclara bilgilendirilmis riza degil, yeniden sorulur.
 * NEDEN eski "red" gecerli: reddetmek icin bilgilendirme gerekmez; ret her
 * zaman guvenli yondur, ziyaretci yeniden rahatsiz edilmez. Ayni gerekce
 * baska surumun ret kaydi icin de gecerli.
 */
export function parseConsent(raw: string | null | undefined, now: number): ConsentState {
  if (typeof raw !== 'string' || raw === '') return 'unset';
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return 'unset';
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return 'unset';
  const rec = data as Record<string, unknown>;

  const ts = rec.ts;
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return 'unset';
  if (ts > now + CLOCK_SKEW_MS || now - ts > CONSENT_MAX_AGE_MS) return 'unset';

  if (!('v' in rec)) {
    // Eski bant: yalniz acik boolean false ret sayilir
    return rec.accepted === false ? 'denied' : 'unset';
  }
  if (typeof rec.v !== 'number' || !Number.isInteger(rec.v) || rec.v < 1) return 'unset';
  if (rec.choice === 'denied') return 'denied';
  if (rec.choice === 'granted' && rec.v === CONSENT_VERSION) return 'granted';
  return 'unset';
}

export function serializeConsent(choice: ConsentChoice, now: number): string {
  return JSON.stringify({ v: CONSENT_VERSION, choice, ts: now });
}

/** Yalniz acik kabul etiket yukletir. Secim yok, ret ve bozuk kayit hicbir sey yukletmez. */
export function shouldLoadTrackers(state: ConsentState): boolean {
  return state === 'granted';
}

export interface ConsentStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Depoyu okur. Depo bir fonksiyonla verilir cunku `window.localStorage`
 * erisiminin KENDISI de hata atabilir (gizli pencere, engellenmis site
 * verisi: SecurityError). Her hata 'unset' demektir: hicbir sey yuklenmez.
 */
export function readConsent(storage: () => ConsentStorage | null | undefined, now: number): ConsentState {
  try {
    const s = storage();
    return s ? parseConsent(s.getItem(CONSENT_STORAGE_KEY), now) : 'unset';
  } catch {
    return 'unset';
  }
}

/** Kaydeder; kaydedilemezse false (karar o sayfa icin bellekte uygulanir, sonraki giriste yeniden sorulur). */
export function writeConsent(storage: () => ConsentStorage | null | undefined, choice: ConsentChoice, now: number): boolean {
  try {
    const s = storage();
    if (!s) return false;
    s.setItem(CONSENT_STORAGE_KEY, serializeConsent(choice, now));
    return true;
  } catch {
    return false;
  }
}

// --- Karar tablosu: bilesen yalniz bu plani uygular ---

/**
 * 'load' = sayfa acilisi; 'choice' = bu sekmede tiklama; 'sync' = karar bu
 * sekmenin disinda degisti: baska sekmede verildi/geri alindi (storage olayi)
 * ya da sayfa geri/ileri onbellekten (bfcache) dondu.
 */
export type ConsentTrigger = 'load' | 'choice' | 'sync';

export interface ConsentPlan {
  /** Bant gosterilsin mi (yalniz secim yokken) */
  showBanner: boolean;
  /** GTM + GA4 + Clarity yuklensin mi (yalniz 'granted') */
  loadTrackers: boolean;
  /** Bu sayfada yuklu etiketlere "onay geri alindi" sinyali gitsin mi */
  revokeTrackers: boolean;
  /** ranksup.ai uzerindeki birinci taraf izleme cerezleri silinsin mi */
  clearCookies: boolean;
  /** Sayfa simdi yenilensin mi: yuklenmis betik bellekten cikarilamaz, yenilenince hic yuklenmez */
  reload: boolean;
  /**
   * Yenileme bir sonraki sayfa gecisine mi birakildi: bu sayfada bir form
   * alanina yazilmis; hemen yenilemek kaydedilmemis metni silerdi.
   */
  reloadOnNavigate: boolean;
}

export interface ConsentPlanContext {
  /** Bu sayfada (son sayfa gecisinden beri) bir form alanina yazildi mi */
  typedInput?: boolean;
}

/**
 * Durum + tetikleyici + "bu sayfada etiket yuklu mu" -> yapilacaklar.
 *
 * - Onay yoksa (secim yok ya da ret) izleme cerezleri her durumda silinir:
 *   eski surum GTM ve Clarity'yi onaysiz yukledigi icin mevcut ziyaretcilerde
 *   _ga / _clck gibi cerezler kaldi; gecerli onay olmadan tutulmamalari gerekir.
 * - Onay yokken bu sayfada etiket yukluyse etiketlere geri alma sinyali gider
 *   VE sayfa yenilenir. NEDEN baska sekmeden gelen geri almada da ('sync'):
 *   Google'a giden consent "denied" yuklu container'i durdurmaz; Google
 *   etiketleri o durumda cerezsiz olcum ("cookieless ping") gondermeye devam
 *   eder, yani tam da kacinilan "gelismis kip" olur (bu dosyanin basi; Google:
 *   https://developers.google.com/tag-platform/security/concepts/consent-mode
 *   "advanced" kip tanimi). Gizlilik sayfasi da geri almada "sayfa yenilenir ve
 *   bu araclar bir daha yuklenmez" diyor. Eskiden yalniz tiklanan sekme
 *   yenileniyordu; GTM'i yuklemis diger sekme reddedilmis onayla calisiyordu
 *   (rv18 C1).
 * - Istisna: 'sync'te bu sayfada bir form alanina yazilmissa yenileme bir
 *   sonraki sayfa gecisine kalir (reloadOnNavigate). Uygulamada kaydedilmemis
 *   degisiklik korumasi (beforeunload) yok; arka plandaki bir sekmeyi
 *   yenilemek yarim kalmis bir yorum yaniti ya da ayar metnini sessizce
 *   silerdi. Sayfa gecisinde sayfanin durumu zaten birakilir. O ana kadar
 *   Google'da onay "denied" (yeni cerez yazilmaz), Clarity durdurulmus
 *   (consent(false)) ve cerezler silinmis olur.
 * - Bu sekmede ret tiklandiysa ('choice') sayfa her durumda hemen yenilenir:
 *   karari veren bu sayfa ve gizlilik metni bunu soyler.
 */
export function planConsent(
  state: ConsentState,
  trigger: ConsentTrigger,
  trackersLoaded: boolean,
  ctx: ConsentPlanContext = {},
): ConsentPlan {
  const granted = state === 'granted';
  const revoke = !granted && trackersLoaded;
  const defer = revoke && trigger === 'sync' && ctx.typedInput === true;
  return {
    showBanner: state === 'unset' && trigger !== 'choice',
    loadTrackers: granted,
    revokeTrackers: revoke,
    clearCookies: !granted,
    reload: revoke && !defer,
    reloadOnNavigate: defer,
  };
}

// --- Izleme kimlikleri ---

/**
 * Kimlikler env'den gelir ve betik adresine girer; bicim disi bir deger
 * (yanlis yazilmis env, enjeksiyon) yuklenmez. Eski kod kimligi ham haliyle
 * satir ici betige yaziyordu.
 */
const GTM_ID_RE = /^GTM-[A-Z0-9]{4,12}$/;
const CLARITY_ID_RE = /^[a-z0-9]{6,20}$/;
/** GA4 olcum kimligi: G- + buyuk harf/rakam (ornek G-Y5W4W5EHE7) */
const GA_ID_RE = /^G-[A-Z0-9]{4,}$/;

export function validGtmId(id: unknown): string | null {
  return typeof id === 'string' && GTM_ID_RE.test(id) ? id : null;
}

export function validClarityId(id: unknown): string | null {
  return typeof id === 'string' && CLARITY_ID_RE.test(id) ? id : null;
}

export function validGaId(id: unknown): string | null {
  return typeof id === 'string' && GA_ID_RE.test(id) ? id : null;
}

// --- GA4'e giden sayfa adresi: paylasim jetonlari maskelenir ---

/**
 * Jetonlu herkese acik yollar: /rapor/<jeton> (musteri raporu paylasim
 * baglantisi, lib/musteri-raporu.ts) ve /karne/<jeton> (AI gorunurluk karnesi).
 * Jeton baglantinin kendisidir (bilen acar); Google'a gitmemeli. Uygulamada
 * baska jetonlu yol (sifre sifirlama, davet) yok: giris yalniz Google OAuth.
 */
const TOKEN_ROUTE_RE = /^\/(rapor|karne)\/[^/]+/;

/**
 * Jetonlu yolsa maskelenmis adres (kok + /rapor/[token], sorgu ve parca atilir),
 * degilse null. Bozuk adres de null (GA kendi adresini kullanir; jetonlu yolda
 * bozuk adres olmaz).
 */
export function maskTokenUrl(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const m = TOKEN_ROUTE_RE.exec(u.pathname);
  return m ? `${u.origin}/${m[1]}/[token]` : null;
}

/**
 * gtag config parametreleri: jetonlu sayfada page_location (ve ayni siteden
 * gelen jetonlu page_referrer) maskelenir; diger sayfalarda parametre yok, GA4
 * adresi kendisi okur (SPA gecmis olaylari bozulmasin: config'e yazilan
 * page_location sonraki tum isabetlerde kalir). Jetonlu sayfalar yalniz tam
 * sayfa yuklemesiyle acilir (uygulama ici baglanti yok; spec denetler), yani
 * maskelenmis deger o sayfanin tum isabetlerini kapsar ve baska sayfaya tasinmaz.
 * GA4 page_path kullanmaz (Universal Analytics alani); yol page_location'dan
 * turetilir. GTM container'inin kendi etiketleri bu kapsamin disinda.
 */
export function gaPageParams(pageUrl: string, referrer: string): Record<string, string> | null {
  const location = maskTokenUrl(pageUrl);
  const ref = referrer ? maskTokenUrl(referrer) : null;
  if (!location && !ref) return null;
  const out: Record<string, string> = {};
  if (location) out.page_location = location;
  if (ref) out.page_referrer = ref;
  return out;
}

// --- Izleme cerezleri (geri almada silinir) ---

/**
 * Google ve Microsoft'un bu sitede (birinci taraf) biraktigi cerezler.
 * Kaynaklar: GA4 _ga, _ga_<kimlik> (https://support.google.com/analytics/answer/11397207),
 * Google Ads / donusum baglayici _gcl_*, _gac_*, FPGCL*, FPAU, FPGSID
 * (https://business.safety.google/adscookies/), Clarity _clck ve _clsk
 * (https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-cookies).
 * _gid ve _gat eski Universal Analytics'ten kalmis olabilir.
 * Kendi cerezlerimiz (authjs.*, luvi_ref, luviai_admin_unlocked) bu listeye
 * GIRMEZ; httpOnly cerezler document.cookie'de zaten gorunmez.
 */
const TRACKING_COOKIE_EXACT = new Set(['_ga', '_gid', '_gat', '_clck', '_clsk', 'FPAU', 'FPGSID']);
const TRACKING_COOKIE_PREFIXES = ['_ga_', '_gat_', '_gcl_', '_gac_', '_gaexp', 'FPGCL'];

export function isTrackingCookie(name: string): boolean {
  return TRACKING_COOKIE_EXACT.has(name) || TRACKING_COOKIE_PREFIXES.some((p) => name.startsWith(p));
}

/** document.cookie metninden izleme cerezlerinin adlari (tekrarsiz) */
export function trackingCookieNames(cookieString: string): string[] {
  const names = new Set<string>();
  for (const part of cookieString.split(';')) {
    const eq = part.indexOf('=');
    const name = (eq === -1 ? part : part.slice(0, eq)).trim();
    if (name && isTrackingCookie(name)) names.add(name);
  }
  return [...names];
}

/**
 * Cerezin yazilmis olabilecegi Domain degerleri. GA ve Clarity cerezi
 * yazilabilen en ust alana (ranksup.ai) koyar; www gibi alt alanda da
 * kalmis olabilir. Silme yalniz ayni Domain ile olur: her ust alan denenir
 * (tek etiketli ust alan haric; tarayici zaten reddeder). localhost ve IP
 * adresinde Domain kullanilmaz, yalniz host'a ozel silme yapilir.
 */
export function cookieDomains(hostname: string): string[] {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '');
  if (!host || !host.includes('.') || host.includes(':') || /^[\d.]+$/.test(host)) return [];
  const parts = host.split('.');
  const out: string[] = [];
  for (let i = 0; i <= parts.length - 2; i++) out.push(`.${parts.slice(i).join('.')}`);
  return out;
}

/** Her ad icin host'a ozel + her Domain icin bir silme atamasi (document.cookie'ye yazilir) */
export function expireCookieAssignments(names: readonly string[], hostname: string): string[] {
  const base = 'Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/';
  const domains = cookieDomains(hostname);
  const out: string[] = [];
  for (const name of names) {
    out.push(`${name}=; ${base}`);
    for (const d of domains) out.push(`${name}=; ${base}; Domain=${d}`);
  }
  return out;
}

// --- Etiket yukleme / geri alma (DOM, ortam enjekte edilir) ---

export const GTM_SCRIPT_ID = 'ranksup-gtm';
export const CLARITY_SCRIPT_ID = 'ranksup-clarity';
/** Dogrudan GA4 (gtag.js); GTM container'indan bagimsiz */
export const GA_SCRIPT_ID = 'ranksup-ga4';

type ClarityFn = ((...args: unknown[]) => void) & { q?: unknown[] };
export type GtagFn = (...args: unknown[]) => void;

export interface TagWindow {
  dataLayer?: unknown[];
  gtag?: GtagFn;
  clarity?: ClarityFn;
}

/** Etiketlerin dokundugu tarayici yuzeyi; testte sahtelenir */
export interface TagEnv {
  win: TagWindow;
  hostname: string;
  /** Su anki sayfa adresi ve document.referrer (GA4 jeton maskesi); yoksa maske yok */
  pageUrl?(): string;
  referrer?(): string;
  now(): number;
  hasScript(id: string): boolean;
  addScript(id: string, src: string): void;
  readCookies(): string;
  writeCookie(assignment: string): void;
}

const GOOGLE_CONSENT_DENIED = {
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
  analytics_storage: 'denied',
} as const;

/**
 * Kabul: bant "reklam donusum olcumu ve yeniden pazarlama" amacini aciklar
 * (ad_storage, ad_user_data, ad_personalization) ve ziyaret istatistigi
 * (analytics_storage). Dort tur Consent Mode v2'nin turleri.
 */
const GOOGLE_CONSENT_GRANTED = {
  ad_storage: 'granted',
  ad_user_data: 'granted',
  ad_personalization: 'granted',
  analytics_storage: 'granted',
} as const;

const CLARITY_CONSENT_GRANTED = { ad_Storage: 'granted', analytics_Storage: 'granted' } as const;

/**
 * Google'in resmi gtag kalibi: `function gtag(){dataLayer.push(arguments);}`.
 * `arguments` nesnesi itilir (dizi degil); kalip birebir korunur.
 * GTM ve GA4 ayni window.dataLayer'i paylasir (Google'in onerdigi kurulum);
 * sayfada zaten bir gtag fonksiyonu varsa yeniden tanimlanmaz. window.gtag
 * kayit olayi (signup-event.ts) icin de kullanilir.
 */
function gtagFor(win: TagWindow): GtagFn {
  if (!Array.isArray(win.dataLayer)) win.dataLayer = [];
  if (typeof win.gtag === 'function') return win.gtag;
  const dl = win.dataLayer;
  const gtag: GtagFn = function gtag() {
    // eslint-disable-next-line prefer-rest-params -- Google kalibi arguments nesnesi bekler
    dl.push(arguments);
  };
  win.gtag = gtag;
  return gtag;
}

/** Clarity'nin resmi kurulum kalibindaki kuyruk: betik yuklenince kuyruktaki cagrilari isler. */
function clarityFor(win: TagWindow): ClarityFn {
  if (typeof win.clarity !== 'function') {
    const stub: ClarityFn = function clarity() {
      // eslint-disable-next-line prefer-rest-params -- Clarity kalibi arguments nesnesi bekler
      (stub.q = stub.q || []).push(arguments);
    };
    win.clarity = stub;
  }
  return win.clarity;
}

/** Bu sayfada bir Google etiketi (GTM ya da GA4) yuklu mu: consent varsayilani zaten itilmis demektir */
function googlePresent(env: Pick<TagEnv, 'hasScript'>): boolean {
  return env.hasScript(GTM_SCRIPT_ID) || env.hasScript(GA_SCRIPT_ID);
}

export function trackersPresent(env: Pick<TagEnv, 'hasScript'>): boolean {
  return googlePresent(env) || env.hasScript(CLARITY_SCRIPT_ID);
}

/** Kok layout'tan gelen kimlikler; bos ya da bicim disi kimlik o araci kapatir */
export interface TrackerIds {
  gtmId?: string | null;
  clarityId?: string | null;
  /** GA4 olcum kimligi (G-...); gtag.js ile dogrudan yuklenir */
  gaId?: string | null;
}

/**
 * Onay varsa etiketleri (GTM, GA4, Clarity) yukler. `state` burada da denetlenir: cagiran
 * yanlislikla cagirsa bile ret ya da secim yokken HICBIR sey yuklenmez.
 * Betik zaten yukluyse yeniden eklenmez; yalniz onay yeniden bildirilir
 * (ayni sayfada geri alinip yeniden verilen onay calissin).
 */
export function loadTrackers(
  env: TagEnv,
  state: ConsentState,
  ids: TrackerIds,
): { gtm: boolean; clarity: boolean; ga: boolean } {
  const result = { gtm: false, clarity: false, ga: false };
  if (!shouldLoadTrackers(state)) return result;

  const gtmId = validGtmId(ids.gtmId);
  const gaId = validGaId(ids.gaId);
  if (gtmId || gaId) {
    // GTM ve GA4 tek dataLayer + tek consent sirasi paylasir: varsayilan
    // "denied" ve "update granted" sayfada yalniz bir kez, ilk Google
    // betiginden once itilir; sonraki cagrilar yalniz onayi yeniden bildirir.
    const gtag = gtagFor(env.win);
    if (googlePresent(env)) {
      gtag('consent', 'update', GOOGLE_CONSENT_GRANTED);
    } else {
      gtag('consent', 'default', GOOGLE_CONSENT_DENIED);
      gtag('consent', 'update', GOOGLE_CONSENT_GRANTED);
    }
    if (gtmId && !env.hasScript(GTM_SCRIPT_ID)) {
      env.win.dataLayer!.push({ 'gtm.start': env.now(), event: 'gtm.js' });
      env.addScript(GTM_SCRIPT_ID, `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(gtmId)}`);
      result.gtm = true;
    }
    // Google'in gtag.js kurulum kalibi: js + config, betik en son
    // (https://developers.google.com/tag-platform/gtagjs/install). Betik kimligi
    // tekrar eklemeyi engeller: js/config sayfa basina bir kez.
    if (gaId && !env.hasScript(GA_SCRIPT_ID)) {
      gtag('js', new Date(env.now()));
      const params = gaPageParams(env.pageUrl?.() ?? '', env.referrer?.() ?? '');
      if (params) gtag('config', gaId, params);
      else gtag('config', gaId);
      env.addScript(GA_SCRIPT_ID, `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaId)}`);
      result.ga = true;
    }
  }

  const clarityId = validClarityId(ids.clarityId);
  if (clarityId) {
    // Microsoft: onay verildiginde consentv2 ile bildirilmeli; AEA/UK/CH
    // ziyaretcilerinde sinyal yoksa Clarity cerez kullanmaz (31.10.2025'ten beri)
    clarityFor(env.win)('consentv2', CLARITY_CONSENT_GRANTED);
    if (!env.hasScript(CLARITY_SCRIPT_ID)) {
      env.addScript(CLARITY_SCRIPT_ID, `https://www.clarity.ms/tag/${encodeURIComponent(clarityId)}`);
      result.clarity = true;
    }
  }
  return result;
}

/** Birinci taraf izleme cerezlerini siler; silinen adlari dondurur */
export function clearTrackingCookies(env: Pick<TagEnv, 'readCookies' | 'writeCookie' | 'hostname'>): string[] {
  let names: string[] = [];
  try {
    names = trackingCookieNames(env.readCookies());
    for (const assignment of expireCookieAssignments(names, env.hostname)) env.writeCookie(assignment);
  } catch {
    /* cerez erisimi kapaliysa silinecek bir sey de yoktur */
  }
  return names;
}

/**
 * Onay geri alindi: yuklu etiketlere bildir, cerezleri sil.
 *  - Google: consent update "denied" -> etiketler yeni cerez yazmaz.
 *  - Clarity: consent(false) cerezlerini siler ve yeni onaya kadar izlemeyi
 *    DURDURUR. consentv2 "denied" kullanilmaz: o cagri cerezsiz kipte izlemeye
 *    devam eder (clarity-consent-api-v2, "What happens when a user rejects cookies").
 * Betikler bellekte kalir; tam durdurma icin cagiran sayfayi yeniler.
 */
export function revokeTrackers(env: TagEnv): void {
  if (Array.isArray(env.win.dataLayer)) gtagFor(env.win)('consent', 'update', GOOGLE_CONSENT_DENIED);
  if (typeof env.win.clarity === 'function') {
    try {
      env.win.clarity('consent', false);
    } catch {
      /* Clarity hatasi geri almayi durdurmasin; cerezler yine silinir */
    }
  }
  clearTrackingCookies(env);
}

// --- Sekme denetleyicisi: plani uygular, bekleyen yenilemeyi tutar ---

/** Etiket ortami + sayfayi yenileme; testte sahtelenir */
export interface ConsentPageEnv extends TagEnv {
  reload(): void;
}

export interface ConsentController {
  /** Karari bu sekmeye uygular (geri alma, cerez silme, yukleme, yenileme) ve plani dondurur */
  apply(state: ConsentState, trigger: ConsentTrigger, ids: TrackerIds): ConsentPlan;
  /** Bu sayfada bir form alanina yazildi (kaydedilmemis metin olabilir) */
  noteInput(): void;
  /** Sayfa (route) degisti: bekleyen yenileme varsa simdi yapilir */
  routeChanged(): void;
  /** Bir sonraki sayfa gecisinde yenileme bekleniyor mu */
  readonly reloadPending: boolean;
}

/**
 * Bilesenin yan etkileri burada toplanir ki karar + uygulama DOM'suz test
 * edilsin. "Yazildi" isareti yalniz o sayfa icin gecerlidir: sayfa gecisinde
 * sifirlanir. Bekleyen yenileme yeni bir kararla yeniden hesaplanir; arada
 * onay yeniden verildiyse ('granted') iptal olur, container onayla calisir.
 */
export function createConsentController(env: ConsentPageEnv): ConsentController {
  let typed = false;
  let pending = false;
  return {
    apply(state, trigger, ids) {
      const plan = planConsent(state, trigger, trackersPresent(env), { typedInput: typed });
      if (plan.revokeTrackers) revokeTrackers(env);
      if (plan.clearCookies) clearTrackingCookies(env);
      if (plan.loadTrackers) loadTrackers(env, state, ids);
      pending = plan.reloadOnNavigate;
      if (plan.reload) env.reload();
      return plan;
    },
    noteInput() {
      typed = true;
    },
    routeChanged() {
      typed = false;
      if (!pending) return;
      pending = false;
      env.reload();
    },
    get reloadPending() {
      return pending;
    },
  };
}

/** Gercek tarayici ortami. Yalniz istemcide (efekt/olay icinde) cagrilir. */
export function browserTagEnv(): TagEnv {
  return {
    win: window as unknown as TagWindow,
    hostname: window.location.hostname,
    pageUrl: () => window.location.href,
    referrer: () => document.referrer,
    now: () => Date.now(),
    hasScript: (id) => document.getElementById(id) !== null,
    addScript: (id, src) => {
      const s = document.createElement('script');
      s.id = id;
      s.async = true;
      s.src = src;
      document.head.appendChild(s);
    },
    readCookies: () => document.cookie,
    writeCookie: (assignment) => {
      document.cookie = assignment;
    },
  };
}

/** Gercek tarayici ortami + yenileme. Yalniz istemcide (efekt/olay icinde) cagrilir. */
export function browserPageEnv(): ConsentPageEnv {
  return { ...browserTagEnv(), reload: () => window.location.reload() };
}

/** localStorage'a guvenli erisim (erisimin kendisi hata atabilir; readConsent/writeConsent yakalar) */
export const browserConsentStorage = (): ConsentStorage => window.localStorage;

/** "Cerez tercihleri" dugmesi: bandi yeniden acar (CookieConsent dinler) */
export function openCookiePreferences(target: Pick<EventTarget, 'dispatchEvent'> = window): void {
  target.dispatchEvent(new Event(CONSENT_REOPEN_EVENT));
}

/** Bu sekmede tercih degisti; dinleyenler depodan yeniden okur */
export function announceConsentChange(target: Pick<EventTarget, 'dispatchEvent'> = window): void {
  target.dispatchEvent(new Event(CONSENT_CHANGE_EVENT));
}
