import { countCharacters } from './keyword-field-audit.js';

/**
 * Uretilen ASO metni icin politika bekcisi (saf). Prompt tek basina yetmez:
 * model puan, kullanici sayisi, odul, fiyat ve indirim uydurabiliyor. Bu
 * modul AI ciktisini dondurmeden once tarar; iddiayi cikarir ya da isaretler.
 *
 * Kural kaynaklari (iki-kaynak kurali):
 *  - Apple App Review Guideline 2.3.7: ad, alt baslik, ekran goruntusu ve
 *    onizlemede fiyat yok; meta veriyi fiyat bilgisiyle doldurma; alt baslik
 *    "unverifiable product claims" icermez. 2.3.14: yaratici varliklarda
 *    dogrulanamayan iddia ve belirli/indirimli fiyat yok.
 *    https://developer.apple.com/app-store/review/guidelines/
 *  - Apple urun sayfasi rehberi: aciklamada belirli fiyat verme; alt baslikta
 *    "world's best app" gibi genel ifade kullanma; odul anilacaksa aciklamada
 *    ya da promosyon metninde.
 *    https://developer.apple.com/app-store/product-page/
 *  - Google Play meta veri politikasi: ad/ikon/gelistirici adinda emoji,
 *    ALL CAPS (marka degilse), magaza performansi/siralama ("#1"), fiyat ve
 *    promosyon ("free for limited time only") yok; aciklamada kaynaksiz
 *    kullanici yorumu ve "best game ever" gibi aldatici iddia yok.
 *    https://support.google.com/googleplay/android-developer/answer/9898842
 *  - Google Play onizleme varliklari rehberi: kisa aciklamada ve ekran
 *    goruntusunde performans/odul/kullanici yorumu, fiyat/promosyon, eylem
 *    cagrisi ("download now"), emoji ve vurgu icin buyuk harf yok.
 *    https://support.google.com/googleplay/android-developer/answer/9866151
 *
 * Ilke: kisa alanlarda (ad, alt baslik, kisa aciklama, gorsel metni, anahtar
 * kelime) iddia her durumda cikarilir. Uzun alanlarda (aciklama, yenilikler,
 * promosyon metni) puan/kullanici sayisi/odul/siralama yalniz saglanan
 * uygulama verisinde (mevcut magaza metni, gercek puan) geciyorsa kalir.
 * Belirsiz olanlar ("en iyi") uzun metinde yalniz isaretlenir; yanlis
 * pozitifte kullanicinin metnini parcalamamak icin.
 *
 * Yanlis pozitif anlami TERSINE cevirebilir ("Ad Free Music Player" →
 * "Ad Music Player"). Bu yuzden:
 *  - Ingilizce "free" yalniz fiyat baglaminda ("for free", "free download",
 *    "free of charge", "free-to-play") cikarilir; "X free" (gluten/ad/hands
 *    free) ve kaliplar ("feel free", "free time") iddia degildir; geri kalan
 *    belirsiz "free" yalniz isaretlenir. Turkce "ücretsiz"/"bedava" her zaman
 *    fiyattir.
 *  - Kesim tireli bilesigin ortasinda yapilmaz; bilesigin tamamina genisler.
 *  - Doviz/kur metnindeki tutar ("1 USD kaç TL") ve fiyat baglami olmayan
 *    tasarruf ("%20 tasarruf" enerji) cikarilmaz.
 */

export type GuardField =
  | 'title'
  | 'subtitle'
  | 'shortDescription'
  | 'promotionalText'
  | 'description'
  | 'whatsNew'
  | 'keywords'
  | 'keyword'
  | 'caption';

/** BOTH: metin iki magazada da kullanilir (ekran goruntusu tasarimi tek) → iki kural seti birden */
export type GuardStore = 'IOS' | 'ANDROID' | 'BOTH';

export type GuardCode =
  | 'PRICE'
  | 'DISCOUNT'
  | 'FREE'
  | 'RATING_CLAIM'
  | 'USER_COUNT'
  | 'AWARD_PRESS'
  | 'RANKING'
  | 'SUPERLATIVE'
  | 'CALL_TO_ACTION'
  | 'TESTIMONIAL'
  | 'EMOJI'
  | 'ALL_CAPS'
  | 'OVER_LIMIT';

export interface GuardIssue {
  /** Cagiranin alan etiketi (ör. "title", "captions[2].hook") */
  field: string;
  code: GuardCode;
  action: 'removed' | 'flagged';
  /** Eslesen ifade (kaldirildiysa artik metinde yok) */
  excerpt: string;
  message: string;
  source: string;
}

export interface GuardFacts {
  /** Saglanan uygulama verisi (mevcut magaza metni): iddia yalniz burada geciyorsa uzun alanda kalir */
  sourceText?: string | null;
  /** Magazadan okunan gercek ortalama puan (0..5); puan iddiasi bununla eslesmeli */
  rating?: number | null;
  /** Marka adi — ALL CAPS istisnasi */
  brand?: string | null;
}

export interface GuardOptions {
  field: GuardField;
  store: GuardStore;
  facts?: GuardFacts;
  label?: string;
  /** Asilirsa isaretlenir; metin KESILMEZ (kelime ortasindan kesmek daha kotu) */
  limit?: number;
  /** 'flag': metne dokunma, yalniz raporla (kullanicinin kendi girdisi icin) */
  mode?: 'enforce' | 'flag';
}

export interface GuardResult {
  text: string;
  issues: GuardIssue[];
}

const SOURCE: Record<GuardCode, string> = {
  PRICE: 'Apple 2.3.7 · Google Play meta veri politikası',
  DISCOUNT: 'Apple 2.3.7 · Google Play meta veri politikası',
  FREE: 'Apple 2.3.7 · Google Play meta veri politikası',
  RATING_CLAIM: 'Apple 2.3.7 · Google Play önizleme varlıkları rehberi',
  USER_COUNT: 'Apple 2.3.7 · Google Play önizleme varlıkları rehberi',
  AWARD_PRESS: 'Apple 2.3.14 · Google Play önizleme varlıkları rehberi',
  RANKING: 'Google Play meta veri politikası · Apple 2.3.7',
  SUPERLATIVE: 'Apple ürün sayfası rehberi · Google Play meta veri politikası',
  CALL_TO_ACTION: 'Google Play önizleme varlıkları rehberi',
  TESTIMONIAL: 'Google Play meta veri politikası',
  EMOJI: 'Google Play meta veri politikası',
  ALL_CAPS: 'Google Play meta veri politikası',
  OVER_LIMIT: 'Mağaza karakter sınırı',
};

function messageFor(code: GuardCode, action: 'removed' | 'flagged'): string {
  switch (code) {
    case 'PRICE':
      return action === 'removed'
        ? 'Fiyat bilgisi: mağaza metninde ve görsellerde fiyat yer almamalı.'
        : 'Fiyat ya da tutar geçiyor: uygulamanın fiyatıysa çıkar (mağaza metninde fiyat yer almamalı); örnek tutar ya da kur bilgisiyse sorun yok.';
    case 'DISCOUNT': return 'İndirim ya da deneme teklifi: fiyat ve promosyon bilgisi meta veride yer almamalı.';
    case 'FREE':
      return action === 'removed'
        ? '"Ücretsiz" iddiası fiyat bilgisidir; ad, alt başlık, kısa açıklama ve görsellerde kullanılmaz.'
        : '"Ücretsiz" / "free" fiyat anlamındaysa fiyat bilgisi sayılır; gerekli değilse çıkar. Başka anlamdaysa (ör. bir oyunun ya da markanın adının parçasıysa) sorun yok.';
    case 'RATING_CLAIM': return 'Puan iddiası: uygulamanın mağaza verisiyle doğrulanamıyor ya da bu alanda kullanılamaz.';
    case 'USER_COUNT': return 'Kullanıcı ya da indirme sayısı iddiası: uygulamanın mağaza metninde yok.';
    case 'AWARD_PRESS': return 'Ödül ya da basın iddiası: uygulamanın mağaza metninde yok.';
    case 'RANKING': return 'Sıralama iddiası ("#1", "en çok indirilen"): mağaza performansı iddiası kullanılmaz.';
    case 'SUPERLATIVE': return 'Doğrulanamayan üstünlük iddiası ("en iyi").';
    case 'CALL_TO_ACTION': return 'Eylem çağrısı ("hemen indir"): Google Play adda, kısa açıklamada ve görsellerde istemiyor.';
    case 'TESTIMONIAL': return 'Kaynağı belirsiz kullanıcı yorumu alıntısı.';
    case 'EMOJI': return 'Emoji: Google Play adda ve kısa açıklamada kullanılmaz.';
    case 'ALL_CAPS': return 'Tamamı büyük harf kelime: marka adının parçası değilse kullanma.';
    case 'OVER_LIMIT': return 'Karakter sınırı aşıldı — kısalt.';
  }
}

// ─── Eslesme ───────────────────────────────────────────────

/**
 * Indeksi koruyan katlama: I/İ/ı → i, digerleri kucuk harf (uzunlugu
 * degistirmeyen kod noktalarinda). Desenler bu metin uzerinde calisir, bulunan
 * indeks orijinal metinde de gecerlidir. (JS'in /iu bayragi 'İ'yi 'i' ile
 * eslestirmez — "ÜCRETSİZ" baslik bekciyi atlatirdi.)
 */
function foldKeepIndex(s: string): string {
  let out = '';
  for (const ch of s) {
    if (ch === 'İ' || ch === 'I' || ch === 'ı') { out += 'i'; continue; }
    const low = ch.toLowerCase();
    out += low.length === ch.length ? low : ch;
  }
  return out;
}

const squash = (s: string) => foldKeepIndex(s).replace(/\s+/g, ' ').trim();

// Desenler katlanmis metin icindir: kucuk harf, ı yerine i.
const L = String.raw`(?<![\p{L}\p{N}])`;
const R = String.raw`(?![\p{L}\p{N}])`;

const PRICE_RE = new RegExp(
  String.raw`[₺$€£]\s?\d[\d.,]*|${L}\d[\d.,]*\s?(?:₺|\$|€|£|tl|try|usd|eur|gbp|lira\p{L}*|dolar\p{L}*|euro\p{L}*|avro\p{L}*)(?!\p{L})`,
  'gu',
);

/**
 * Doviz/kur cevirici, borsa ve altin metni: "1 USD kaç TL" uygulamanin fiyati
 * degil, uygulamanin konusu. Bu baglamdaki tutar cikarilmaz, isaretlenir
 * (cikarmak "Döviz: kaç TL" gibi anlamsiz bir ad birakiyordu).
 */
const CONVERTER_RE = new RegExp(
  String.raw`${L}(?:döviz\p{L}*|kurlar\p{L}*|kur çevir\p{L}*|çevirici\p{L}*|currency|exchange rates?|converter\p{L}*|kaç (?:tl|lira|dolar|euro|avro)|borsa\p{L}*|kripto\p{L}*|crypto\p{L}*|bitcoin|altin fiyat\p{L}*|gold price\p{L}*)${R}`,
  'u',
);

// "tasarruf"/"save" BILEREK burada yok: "%20 tasarruf" cogu zaman enerji ya da
// butce tasarrufudur, indirim degil (bkz. SAVINGS_RE + PRICE_CONTEXT_RE).
const DISCOUNT_RE = new RegExp(
  [
    String.raw`(?:%\s?\d{1,3}|(?<!\p{N})\d{1,3}\s?%)(?:\s+\p{L}+){0,2}?\s*(?:indirim\p{L}*|off|discount\p{L}*)(?!\p{L})`,
    String.raw`${L}(?:indirimli|indirimde|indirimle|discounted|on sale|(?:ücretsiz|free)\s+(?:deneme\p{L}*|trial\p{L}*)|deneme süres\p{L}*|free trial|promo(?:syon)? kod\p{L}*|kupon kod\p{L}*|coupon code|promo code|cash ?back|para iade\p{L}*|limited[- ]time offer|sinirli süre\p{L}*|\d{1,3}\s?(?:gün|ay|hafta|days?|months?|weeks?)\s+(?:ücretsiz|free|bedava)\p{L}*|ilk ay\p{L}*\s+(?:ücretsiz|free|bedava)\p{L}*)${R}`,
  ].join('|'),
  'gu',
);

/** Yuzdeli tasarruf: "%40 tasarruf", "save 50%" — yalniz yakininda fiyat/abonelik baglami varsa indirim */
const SAVINGS_RE = new RegExp(
  [
    String.raw`(?:%\s?\d{1,3}|(?<!\p{N})\d{1,3}\s?%)(?:\s+\p{L}+){0,2}?\s*(?:tasarruf\p{L}*|save)(?!\p{L})`,
    String.raw`${L}save\s+(?:up to\s+)?(?:%\s?\d{1,3}|\d{1,3}\s?%)`,
  ].join('|'),
  'gu',
);
const PRICE_CONTEXT_RE = new RegExp(
  String.raw`${L}(?:fiyat\p{L}*|abonelik\p{L}*|üyelik\p{L}*|premium|pro sürüm\p{L}*|yillik plan\p{L}*|aylik plan\p{L}*|paket\p{L}*|subscription\p{L}*|membership\p{L}*|price\p{L}*|pricing|annual plan|yearly plan|monthly plan)${R}|[₺$€£]`,
  'u',
);
/** Tasarruf ifadesinin iki yanina bakilan pencere (karakter) */
const SAVINGS_CONTEXT_CHARS = 80;

// Turkce "ücretsiz"/"bedava" her zaman fiyat anlamindadir ("reklamsız" ayri sozcuk)
const TR_FREE_RE = new RegExp(String.raw`(?<![\p{L}\p{N}-])(?:ücretsiz\p{L}*|bedava\p{L}*)`, 'gu');
// Ingilizce "free" cok anlamli — siniflandirma englishFree()'de
const EN_FREE_RE = /(?<![\p{L}\p{N}])free(?![\p{L}\p{N}])/gu;

/**
 * "X free" = X'siz; fiyat iddiasi DEGIL. "Gluten Free Recipes"ten "free"
 * cikarilinca "Gluten Recipes" kaliyor, anlam tersine donuyordu. Liste
 * kapali: listede olmayan "X free" belirsiz sayilir ve yalniz isaretlenir,
 * hicbir zaman cikarilmaz.
 */
const FREE_COMPOUND_NOUNS: ReadonlySet<string> = new Set([
  'ad', 'ads', 'advert', 'adverts', 'advertising', 'advertisement', 'advertisements', 'banner', 'popup', 'popups', 'spam',
  'gluten', 'sugar', 'dairy', 'lactose', 'fat', 'nut', 'nuts', 'soy', 'egg', 'meat', 'alcohol', 'caffeine', 'nicotine', 'smoke',
  'cruelty', 'stress', 'hassle', 'worry', 'care', 'distraction', 'distractions', 'clutter', 'hands', 'paper', 'cash', 'contact',
  'touch', 'key', 'cord', 'wire', 'cable', 'noise', 'virus', 'malware', 'tracking', 'tracker', 'trackers', 'crash', 'bug', 'error',
  'lag', 'latency', 'password', 'login', 'account', 'registration', 'signup', 'root', 'drm', 'copyright', 'royalty', 'carbon',
  'plastic', 'waste', 'chemical', 'paraben', 'sulfate', 'gmo', 'allergen', 'pain', 'guilt', 'drama', 'risk', 'interruption',
  'interruptions', 'junk', 'bloat', 'bloatware', 'judgment', 'judgement', 'commission', 'interest', 'tax', 'duty', 'toll',
]);
/** Onunde bunlar varsa "free" fiyattir: "for free", "totally free", "it's free" (yuzde ayrica: "100% free") */
const FREE_PRICE_BEFORE: ReadonlySet<string> = new Set([
  'for', 'totally', 'completely', 'absolutely', 'entirely', 'fully', 'always', 'forever', "it's", 'it’s',
]);
/** Ardindan bunlar gelirse fiyattir: "free download", "free app", "free version" */
const FREE_PRICE_AFTER: ReadonlySet<string> = new Set([
  'download', 'downloads', 'app', 'apps', 'application', 'version', 'edition', 'game', 'games', 'trial', 'shipping',
  'delivery', 'plan', 'premium', 'subscription',
]);
/** Bir kelime arayla: "free budget app", "free puzzle games" */
const FREE_PRICE_AFTER2: ReadonlySet<string> = new Set(['app', 'apps', 'application', 'game', 'games', 'download', 'downloads']);
/** Fiyat disi kaliplar: "feel free", "set free", "free time", "free up space", "free your mind", "free kick" */
const FREE_IDIOM_BEFORE: ReadonlySet<string> = new Set(['feel', 'set', 'break']);
const FREE_IDIOM_AFTER: ReadonlySet<string> = new Set([
  'up', 'time', 'space', 'storage', 'memory', 'ram', 'disk', 'your', 'yourself', 'yourselves', 'from', 'kick', 'kicks',
  'throw', 'throws', 'fall', 'will', 'spirit', 'agent', 'agents', 'style', 'hand', 'roam', 'roaming', 'form', 'flow',
  'range', 'speech',
]);

interface FreeMatch {
  start: number;
  end: number;
  /** true: fiyat anlami acik — kisa alandan cikarilir; false: belirsiz — yalniz isaretlenir */
  priceContext: boolean;
}

/**
 * Katlanmis metinde `i`'deki Ingilizce "free"nin anlami. null = fiyat degil.
 * Fiyat baglaminda kalip butun olarak doner ("for free", "free of charge",
 * "free-to-play"): yalniz "free"yi kesmek "for" / "of charge" sarkitirdi.
 */
function englishFree(folded: string, i: number): FreeMatch | null {
  const end = i + 'free'.length;
  // Tireli bilesik: "ad-free", "sugar-free" (X'siz); "free-form", "free-range" fiyat degil
  if (folded[i - 1] === '-') return null;
  const rest = folded.slice(end, end + 80);
  if (rest.startsWith('-')) {
    const toPlay = /^-to-(?:play|download|use|install|try)(?![\p{L}\p{N}])/u.exec(rest);
    return toPlay ? { start: i, end: end + toPlay[0].length, priceContext: true } : null;
  }
  const head = folded.slice(Math.max(0, i - 40), i);
  const prevM = /([\p{L}\p{N}%'’]+)[ \t\u00A0]+$/u.exec(head);
  const prev = prevM?.[1] ?? '';
  const prevStart = prevM ? i - head.length + prevM.index : i;
  const nextM = /^[ \t\u00A0]+([\p{L}\p{N}'’]+)(?:[ \t\u00A0]+([\p{L}\p{N}'’]+))?/u.exec(rest);
  const n1 = nextM?.[1] ?? '';
  const n2 = nextM?.[2] ?? '';
  const throughN2 = nextM ? end + nextM[0].length : end;
  const throughN1 = nextM ? end + nextM[0].indexOf(n1) + n1.length : end;

  if (FREE_IDIOM_BEFORE.has(prev) || FREE_IDIOM_AFTER.has(n1)) return null;
  if (n1 === 'of') {
    // "free of charge/cost" fiyattir; "free of ads/distractions" X'siz demektir
    return n2 === 'charge' || n2 === 'cost' ? { start: i, end: throughN2, priceContext: true } : null;
  }
  if (FREE_COMPOUND_NOUNS.has(prev)) return null;
  const priceBefore = FREE_PRICE_BEFORE.has(prev) || /^(?:\d{1,3}%|%\d{1,3})$/.test(prev);
  const start = priceBefore ? prevStart : i;
  if (n1 === 'to' && /^(?:play|download|use|install|try)$/.test(n2)) return { start, end: throughN2, priceContext: true };
  if (n1 === 'forever') return { start, end: throughN1, priceContext: true };
  if (priceBefore) return { start, end, priceContext: true };
  // "Free Download Manager" → yalniz "Free" cikar; urun adi ("Download Manager") kalir
  if (FREE_PRICE_AFTER.has(n1) || FREE_PRICE_AFTER2.has(n2)) return { start: i, end, priceContext: true };
  return { start: i, end, priceContext: false };
}

// Ondalikli puan ("4,8 yildiz", "4.7/5") ya da yildiz dizisi. Tam sayi "5 yildizli"
// BILEREK yok: otel/restoran uygulamasinda ozellik ("5 yildizli oteller").
const RATING_RE = new RegExp(
  [
    String.raw`(?<![\p{L}\p{N}.,])[0-5][.,]\d\s?(?:\/\s?5|★|⭐|yildiz\p{L}*|puan\p{L}*|stars?|rating\p{L}*|out of 5)(?!\p{L})`,
    String.raw`★{3,}|⭐{2,}`,
    String.raw`${L}(?:(?:en )?yüksek puanli (?:uygulama|app|oyun)\p{L}*|top[- ]rated|highly rated|rated\s[0-5][.,]\d)${R}`,
  ].join('|'),
  'gu',
);

const USER_UNIT = String.raw`(?:kullanici\p{L}*|indir(?:me|il)\p{L}*|müşteri\p{L}*|kişi(?!lik)\p{L}*|üye(?!lik)\p{L}*|users?|downloads?|installs?|customers?|people|members?)(?!\p{L})`;
const USER_COUNT_RE = new RegExp(
  [
    String.raw`(?<![\p{L}\p{N}.,])(?:(?<pre>over|more than|en az)\s+)?(?<num>\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)(?:\s?(?:(?<sufA>k|m|b|thousand|million|billion)(?!\p{L})|(?<sufB>bin|milyon|milyar)\p{L}*))?(?<plus>\s?\+)?(?:['’]\p{L}*)?(?:\s+(?<qual>fazla|aşkin|üzeri\p{L}*|over|plus))?(?:\s+\p{L}+){0,2}?\s+${USER_UNIT}`,
    String.raw`${L}(?<word>binlerce|milyonlarca|yüz ?binlerce|on ?binlerce|yüzlerce|thousands of|millions of|hundreds of thousands of)(?:\s+\p{L}+)?\s+${USER_UNIT}`,
  ].join('|'),
  'gu',
);

const AWARD_RE = new RegExp(
  String.raw`${L}(?:editör(?:ün|lerin) seçimi\p{L}*|editors?['’]? ?choice|editor['’]?s choice|günün uygulamas\p{L}*|haftanin uygulamas\p{L}*|yilin uygulamas\p{L}*|günün oyunu|yilin oyunu|app of the (?:day|week|year)|game of the (?:day|week|year)|best of (?:play|20\d\d|the year)|apple design award\p{L}*|ödüllü (?:uygulama|oyun|app)\p{L}*|ödül(?:ler)?(?:i|ini|ü|ünü)?\s+(?:aldi|kazandi|kazanan|sahibi)\p{L}*|award[- ]winning|as seen (?:on|in)|basinda (?:yer aldi|çikti)\p{L}*|featured (?:by|in|on) (?:apple|google|the app store|app store|google play)|techcrunch|forbes|the verge|wall street journal|new york times|bloomberg|webrazzi)${R}`,
  'gu',
);

// "bir numara" tek basina "a number" demek ("Bir numara seç", "İkinci bir
// numara edin"); siralama iddiasi "bir numaralı uygulama" bicimindedir.
// "best-seller/best-selling" yalniz uygulama/oyun icin iddia ("Best Seller
// Books" kitap kategorisidir). Uygulama/oyun adi ileri bakisla aranir ve
// eslesmeye GIRMEZ: "Türkiye'nin en popüler bütçe uygulaması"ndan yalniz
// "en popüler" cikar (eskiden "bütçe uygulaması" da gidip "Türkiye'nin"
// sarkiyordu).
const APP_NOUN_AHEAD = String.raw`(?=(?:\s+\p{L}+){0,2}?\s+(?:uygulama\p{L}*|apps?|applications?|oyun\p{L}*|games?)(?![\p{L}\p{N}]))`;
const RANKING_RE = new RegExp(
  [
    String.raw`(?<![\p{L}\p{N}#])#\s?1(?![\d.,])`,
    String.raw`${L}(?:no\.?\s?1(?![\d.,])|number one|(?:bir|1) numarali\p{L}*|1\.\s?sira\p{L}*|birinci sira\p{L}*|top\s?\d{1,3}\s+(?:app\p{L}*|uygulama\p{L}*|listesi\p{L}*|chart\p{L}*)|(?:en çok indiril\p{L}*|en çok kullanil\p{L}*|en popüler|en sevilen|most downloaded|most popular|most loved|best[- ]?sell\p{L}*)${APP_NOUN_AHEAD}|lider (?:uygulama|app)\p{L}*|leading app\p{L}*|#\s?\d+\s+in)${R}`,
  ].join('|'),
  'gu',
);

// Iddia olmayan kaliplar: "en iyi sekilde" (zarf), "en iyi arkadaş" / "best
// friend" (bir nesne), "personal best", "best practices", "best before",
// "best-seller" (yukarida RANKING). "Best-seller" icinden "best" kesilince
// "-seller" → "seller" kaliyordu.
const SUPERLATIVE_RE = new RegExp(
  String.raw`${L}(?:en iyi(?!\s+(?:şekilde|biçimde|haliyle|arkadaş))\p{L}*|dünyanin en|türkiye['’]?nin en|(?<!personal\s)(?:the\s+|world['’]?s\s+)?best(?![\s-]+(?:friend|bff|practice|before|sell)))${R}`,
  'gu',
);

// "Get today's horoscope": "today" iyelik ekiyle eylem cagrisi degil. "indir
// ve" yalniz uygulama indirme cagrisinda ("indir ve kazan"); "PDF indir ve
// paylaş" ozellik anlatimi.
const CTA_RE = new RegExp(
  String.raw`${L}(?:(?:hemen|şimdi|bugün|hadi|haydi)\s+(?:indir|yükle|dene|oyna|kaydol|üye ol|katil|başla)\p{L}*|(?:download|install|get|try|play|start)(?:\s+it)?\s+(?:now|today)(?!['’]\p{L})|ücretsiz indir\p{L}*|indir ve\s+(?:kazan|oyna|başla|dene|keşfet|kullan)\p{L}*)${R}`,
  'gu',
);

// Tek tirnak BILEREK yok: Turkce ek kesmesi ("Türkiye'nin ... İstanbul'da") alinti sanilirdi
const QUOTE_RE = /[“«"]([^”»"\n]{8,240})[”»"]/gu;
const PRAISE_RE = new RegExp(
  String.raw`${L}(?:harika|mükemmel|bayildim|beğendim|tavsiye\p{L}*|hayatimi|süper|muhteşem|çok iyi|love|loved|amazing|great|awesome|recommend\p{L}*|life[- ]changing|best)${R}|\p{L}+(?:iyorum|uyorum|üyorum)${R}`,
  'u',
);
// Telif/marka isaretleri (©®™) emoji sayilmaz
const EMOJI_RE = /(?:(?![©®™])\p{Extended_Pictographic}(?:️|[\u{1F3FB}-\u{1F3FF}])*(?:‍\p{Extended_Pictographic}️?)*|[\u{1F1E6}-\u{1F1FF}]{2}|[0-9#*]️?⃣)️?/gu;

interface Hit {
  code: GuardCode;
  start: number;
  end: number;
  excerpt: string;
  /** Ifade saglanan uygulama verisinde (mevcut magaza metni, gercek puan) geciyor */
  supported: boolean;
  /** FREE: fiyat anlami acik ("for free", "free download", "ücretsiz") */
  priceContext?: boolean;
  /** PRICE: tutar uygulamanin fiyati degil (doviz/kur/borsa metni) */
  notAppPrice?: boolean;
}

type HitContext = Pick<Hit, 'supported' | 'priceContext' | 'notAppPrice'>;

interface PreparedFacts {
  source: string;
  userCounts: Set<string>;
  rating: number | null;
  /** Marka cekirdegi (katlanmis): "Best Secret: Moda" → "best secret" */
  brand: string;
  brandWords: Set<string>;
}

/** Magaza adinin marka kismi: "Marka: aciklama" / "Marka - aciklama" */
const brandCore = (name: string) => (name.split(/\s*[:：|–—]\s*|\s+-\s+/)[0] ?? '').trim();

const MULT: Record<string, number> = {
  k: 1e3, thousand: 1e3, bin: 1e3,
  m: 1e6, million: 1e6, milyon: 1e6,
  b: 1e9, billion: 1e9, milyar: 1e9,
};

/** Kullanici sayisi iddiasini karsilastirilabilir anahtara cevir ("1M+" ve "1.000.000" ayni) */
function userCountKey(g: Record<string, string | undefined>): string | null {
  if (g.word) return g.word.replace(/\s+/g, '');
  if (!g.num) return null;
  const raw = /^\d{1,3}(?:[.,]\d{3})+$/.test(g.num) ? g.num.replace(/[.,]/g, '') : g.num.replace(',', '.');
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) return null;
  const sufB = g.sufB ? (g.sufB.startsWith('milyar') ? 'milyar' : g.sufB.startsWith('milyon') ? 'milyon' : 'bin') : undefined;
  const mult = MULT[g.sufA ?? sufB ?? ''] ?? 1;
  return String(Math.round(n * mult));
}

/** "5 kullaniciya kadar" ozelliktir; iddia sayilan: buyuk sayi, kisaltma, "+", "fazla", kelime formu */
function isUserCountClaim(g: Record<string, string | undefined>): boolean {
  if (g.word) return true;
  if (g.sufA || g.sufB || g.plus || g.qual || g.pre) return true;
  const key = userCountKey(g);
  return key != null && Number(key) >= 1000;
}

function prepareFacts(f?: GuardFacts): PreparedFacts {
  const source = squash(f?.sourceText ?? '');
  const userCounts = new Set<string>();
  for (const m of source.matchAll(USER_COUNT_RE)) {
    const g = (m.groups ?? {}) as Record<string, string | undefined>;
    if (!isUserCountClaim(g)) continue;
    const key = userCountKey(g);
    if (key) userCounts.add(key);
  }
  const rating = typeof f?.rating === 'number' && Number.isFinite(f.rating) && f.rating > 0 ? f.rating : null;
  const brand = squash(brandCore(f?.brand ?? ''));
  const brandWords = new Set(brand.split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  return { source, userCounts, rating, brand, brandWords };
}

/**
 * Marka adinin metindeki konumlari. Marka icindeki kelime iddia sayilmaz:
 * "Best Secret", "FREE NOW" gibi tescilli adlar parcalanmasin.
 */
function brandSpans(text: string, facts: PreparedFacts): Array<[number, number]> {
  if (facts.brand.replace(/\s/g, '').length < 2) return [];
  const folded = foldKeepIndex(text);
  const spans: Array<[number, number]> = [];
  const isWord = (ch: string | undefined) => !!ch && /[\p{L}\p{N}]/u.test(ch);
  let from = 0;
  for (;;) {
    const i = folded.indexOf(facts.brand, from);
    if (i < 0) break;
    const end = i + facts.brand.length;
    if (!isWord(folded[i - 1]) && !isWord(folded[end])) spans.push([i, end]);
    from = i + 1;
  }
  return spans;
}

const inSource = (excerpt: string, facts: PreparedFacts) => {
  const e = squash(excerpt);
  return e.length > 0 && facts.source.includes(e);
};

function detect(text: string, facts: PreparedFacts): Hit[] {
  const folded = foldKeepIndex(text);
  const hits: Hit[] = [];
  const pushSpan = (code: GuardCode, start: number, end: number, ctx: Partial<HitContext> = {}) => {
    hits.push({ code, start, end, excerpt: text.slice(start, end).trim(), supported: false, ...ctx });
  };
  const push = (code: GuardCode, m: RegExpMatchArray, supported = false) => {
    const start = m.index ?? 0;
    pushSpan(code, start, start + m[0].length, { supported });
  };

  const converter = CONVERTER_RE.test(folded);
  for (const m of folded.matchAll(PRICE_RE)) {
    const start = m.index ?? 0;
    pushSpan('PRICE', start, start + m[0].length, { supported: inSource(m[0], facts), notAppPrice: converter });
  }
  for (const m of folded.matchAll(DISCOUNT_RE)) push('DISCOUNT', m, inSource(m[0], facts));
  for (const m of folded.matchAll(SAVINGS_RE)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const around = folded.slice(Math.max(0, start - SAVINGS_CONTEXT_CHARS), end + SAVINGS_CONTEXT_CHARS);
    if (PRICE_CONTEXT_RE.test(around)) pushSpan('DISCOUNT', start, end, { supported: inSource(m[0], facts) });
  }
  for (const m of folded.matchAll(TR_FREE_RE)) {
    const start = m.index ?? 0;
    pushSpan('FREE', start, start + m[0].length, { priceContext: true });
  }
  for (const m of folded.matchAll(EN_FREE_RE)) {
    const f = englishFree(folded, m.index ?? 0);
    if (f) pushSpan('FREE', f.start, f.end, { priceContext: f.priceContext });
  }
  for (const m of folded.matchAll(RATING_RE)) {
    const num = m[0].match(/[0-5][.,]\d/);
    let supported: boolean;
    if (num && facts.rating != null) {
      // Gercek puan biliniyorsa iddia onunla eslesmeli (eski metindeki bayat puan tasinmasin)
      supported = Math.abs(Number.parseFloat(num[0].replace(',', '.')) - Math.round(facts.rating * 10) / 10) < 0.05;
    } else {
      supported = inSource(m[0], facts);
    }
    push('RATING_CLAIM', m, supported);
  }
  for (const m of folded.matchAll(USER_COUNT_RE)) {
    const g = (m.groups ?? {}) as Record<string, string | undefined>;
    if (!isUserCountClaim(g)) continue;
    const key = userCountKey(g);
    push('USER_COUNT', m, key != null && facts.userCounts.has(key));
  }
  for (const m of folded.matchAll(AWARD_RE)) push('AWARD_PRESS', m, inSource(m[0], facts));
  for (const m of folded.matchAll(RANKING_RE)) push('RANKING', m, inSource(m[0], facts));
  for (const m of folded.matchAll(SUPERLATIVE_RE)) push('SUPERLATIVE', m);
  for (const m of folded.matchAll(CTA_RE)) push('CALL_TO_ACTION', m);
  for (const m of text.matchAll(QUOTE_RE)) {
    const inner = m[1] ?? '';
    if (inner.trim().split(/\s+/).length < 3 || !PRAISE_RE.test(foldKeepIndex(inner))) continue;
    push('TESTIMONIAL', m, inSource(inner, facts));
  }
  for (const m of text.matchAll(EMOJI_RE)) push('EMOJI', m);
  return hits;
}

// ─── Politika ──────────────────────────────────────────────

/** Kisa alanlar: iddia her durumda cikar (performans/odul/fiyat bu alanlarda yasak ya da dogrulanamaz) */
const STRICT = new Set<GuardField>(['title', 'subtitle', 'shortDescription', 'caption', 'keyword', 'keywords']);

type Action = 'remove' | 'flag' | 'ignore';

function actionFor(code: GuardCode, field: GuardField, store: GuardStore, hit: HitContext): Action {
  const playVisible = store !== 'IOS';
  const long = field === 'description' || field === 'whatsNew';
  const supported = hit.supported;
  switch (code) {
    case 'PRICE':
      // Kur/doviz metnindeki tutar uygulamanin fiyati degil; uzun metinde
      // mevcut magaza metninde zaten gecen tutar kullanicinin kendi icerigi
      if (hit.notAppPrice || (long && supported)) return 'flag';
      return 'remove';
    case 'DISCOUNT':
      return long && supported ? 'flag' : 'remove';
    case 'FREE':
      // Belirsiz "free" ("Free Music Player") hicbir alanda kesilmez: yanlis
      // pozitifte anlam bozuluyordu. Uzun metinde fiyat anlami da yalniz isaret.
      if (long) return 'flag';
      return hit.priceContext ? 'remove' : 'flag';
    case 'RATING_CLAIM':
    case 'USER_COUNT':
    case 'AWARD_PRESS':
    case 'RANKING':
      if (STRICT.has(field)) return 'remove';
      return supported ? 'ignore' : 'remove';
    case 'SUPERLATIVE':
      return STRICT.has(field) ? 'remove' : 'flag';
    case 'CALL_TO_ACTION':
      return playVisible && (field === 'title' || field === 'shortDescription' || field === 'caption') ? 'remove' : 'ignore';
    case 'TESTIMONIAL':
      if (STRICT.has(field)) return 'remove';
      return supported ? 'ignore' : 'flag';
    case 'EMOJI':
      return playVisible && (field === 'title' || field === 'shortDescription') ? 'remove' : 'ignore';
    case 'ALL_CAPS':
      return playVisible && (field === 'title' || field === 'shortDescription') ? 'flag' : 'ignore';
    case 'OVER_LIMIT':
      return 'flag';
  }
}

type Granularity = 'span' | 'term' | 'clause' | 'sentence';

function granularityOf(field: GuardField): Granularity {
  switch (field) {
    case 'title':
    case 'subtitle':
      return 'span';
    case 'keywords':
    case 'keyword':
      return 'term';
    case 'shortDescription':
    case 'caption':
    case 'promotionalText':
      return 'clause';
    case 'description':
    case 'whatsNew':
      return 'sentence';
  }
}

// Birim + sondaki ayrac birlikte tutulur: birim atilinca ayraci da gider, kalanlar aynen birlesir
const SENTENCE_DELIM = /[.!?…]+[ \t\u00A0]+|\n+/g;
const CLAUSE_DELIM = /[.!?…;,]+[ \t\u00A0]+|[ \t\u00A0]+[-–—|][ \t\u00A0]+|\n+/g;

function splitKeep(text: string, delim: RegExp): string[] {
  const out: string[] = [];
  let last = 0;
  for (const m of text.matchAll(delim)) {
    const end = (m.index ?? 0) + m[0].length;
    out.push(text.slice(last, end));
    last = end;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const EDGE_SEP = String.raw`[\s,;:|·•&+\-–—]`;

const isWordChar = (ch: string | undefined) => !!ch && /[\p{L}\p{N}]/u.test(ch);

/** [start,end) bir tireli bilesigin parcasiysa ("#1-ranked", "best-in-class") bilesigin tamami */
function widenToCompound(text: string, start: number, end: number): [number, number] {
  let s = start;
  let e = end;
  if (isWordChar(text[s])) {
    while (s >= 2 && text[s - 1] === '-' && isWordChar(text[s - 2])) {
      s -= 1;
      while (s > 0 && isWordChar(text[s - 1])) s--;
    }
  }
  if (isWordChar(text[e - 1])) {
    while (e + 1 < text.length && text[e] === '-' && isWordChar(text[e + 1])) {
      e += 1;
      while (e < text.length && isWordChar(text[e])) e++;
    }
  }
  return [s, e];
}

function tidyShort(s: string): string {
  let t = s
    .replace(/️/g, '')
    .replace(/[ \t\u00A0]{2,}/g, ' ')
    .replace(/[ \t]+([,.;:!?])/g, '$1')
    .replace(/([:|–—-])(?:[ \t]*[:|–—-])+/g, '$1');
  // Bas/sondaki ayrac ve sarkan baglac ("Butcem: ", "Butce ve")
  for (let i = 0; i < 3; i++) {
    t = t
      .replace(new RegExp(`^${EDGE_SEP}+`, 'u'), '')
      .replace(new RegExp(`${EDGE_SEP}+$`, 'u'), '')
      .replace(/(?:[ \t]+(?:ve|ile|and|or|ya da))+$/iu, '')
      .replace(/^(?:(?:ve|ile|and|or)[ \t]+)+/iu, '');
  }
  return t.trim();
}

function tidyLong(s: string): string {
  return s
    .replace(/[ \t\u00A0]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(new RegExp(`^${EDGE_SEP}+`, 'u'), '')
    .replace(/[\s,;:|·&+\-–—]+$/u, '')
    .trim();
}

function allCapsWords(text: string, facts: PreparedFacts): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(?<![\p{L}\p{N}])[\p{L}\p{N}]{4,}(?![\p{L}\p{N}])/gu)) {
    const w = m[0];
    if (w.replace(/[^\p{L}]/gu, '').length < 4) continue;
    if (w !== w.toLocaleUpperCase('tr') || w === w.toLocaleLowerCase('tr')) continue;
    if (facts.brandWords.has(squash(w))) continue;
    out.push(w);
  }
  return [...new Set(out)];
}

// ─── Genel giris ───────────────────────────────────────────

export function guardText(text: string, opts: GuardOptions): GuardResult {
  const original = String(text ?? '');
  const label = opts.label ?? opts.field;
  const facts = prepareFacts(opts.facts);
  const flagOnly = opts.mode === 'flag';
  const issues: GuardIssue[] = [];
  const seen = new Set<string>();
  const report = (code: GuardCode, action: 'removed' | 'flagged', excerpt: string) => {
    const key = `${code}|${action}|${squash(excerpt)}`;
    if (seen.has(key)) return;
    seen.add(key);
    issues.push({ field: label, code, action, excerpt, message: messageFor(code, action), source: SOURCE[code] });
  };
  const classify = (part: string) => {
    const spans = brandSpans(part, facts);
    return detect(part, facts)
      // Marka adinin icindeki kelime ihlal sayilmaz; emoji markada da yasak
      .filter((h) => h.code === 'EMOJI' || !spans.some(([s, e]) => s <= h.start && h.end <= e))
      .map((h) => {
        const a = actionFor(h.code, opts.field, opts.store, h);
        return { ...h, action: (flagOnly && a === 'remove' ? 'flag' : a) as Action };
      })
      .filter((h) => h.action !== 'ignore');
  };

  let out = original;
  const gran = granularityOf(opts.field);

  if (gran === 'term') {
    const terms = opts.field === 'keywords' ? original.split(/[,，]/) : [original];
    const kept: string[] = [];
    for (const term of terms) {
      const hits = classify(term);
      const removal = hits.filter((h) => h.action === 'remove');
      if (removal.length) {
        removal.forEach((h) => report(h.code, 'removed', h.excerpt));
        continue;
      }
      hits.forEach((h) => report(h.code, 'flagged', h.excerpt));
      kept.push(term);
    }
    out = flagOnly
      ? original
      : opts.field === 'keywords'
        ? kept.map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean).join(',')
        : (kept[0] ?? '').replace(/\s+/g, ' ').trim();
  } else if (gran === 'span') {
    const hits = classify(original);
    // Tireli bilesigin bir parcasi tek basina kesilmez ("#1-ranked" → "-ranked"
    // ya da "Best-in-class" → "-in-class" sarkmasin): kesim bilesigin tamamina genisler
    const removal = hits
      .filter((h) => h.action === 'remove')
      .map((h) => {
        const [start, end] = widenToCompound(original, h.start, h.end);
        return { ...h, start, end, excerpt: original.slice(start, end).trim() };
      })
      .sort((a, b) => a.start - b.start);
    hits.filter((h) => h.action === 'flag').forEach((h) => report(h.code, 'flagged', h.excerpt));
    removal.forEach((h) => report(h.code, 'removed', h.excerpt));
    if (removal.length && !flagOnly) {
      let acc = '';
      let cursor = 0;
      for (const h of removal) {
        if (h.start < cursor) { cursor = Math.max(cursor, h.end); continue; }
        acc += original.slice(cursor, h.start);
        cursor = h.end;
      }
      acc += original.slice(cursor);
      out = tidyShort(acc);
    }
  } else {
    // Tespit TUM metinde yapilir, birimlere konumla dagitilir: virgul iceren
    // bir alinti ya da iddia iki birime yayilabilir, ikisi de atilir.
    const all = classify(original);
    const units = splitKeep(original, gran === 'sentence' ? SENTENCE_DELIM : CLAUSE_DELIM);
    const kept: string[] = [];
    let offset = 0;
    for (const unit of units) {
      const start = offset;
      offset += unit.length;
      const hits = all.filter((h) => h.start < offset && h.end > start);
      const removal = hits.filter((h) => h.action === 'remove');
      if (removal.length && !flagOnly) {
        removal.forEach((h) => report(h.code, 'removed', h.excerpt));
        continue;
      }
      hits.forEach((h) => report(h.code, h.action === 'remove' ? 'removed' : 'flagged', h.excerpt));
      kept.push(unit);
    }
    if (!flagOnly && kept.length !== units.length) {
      out = gran === 'sentence' ? tidyLong(kept.join('')) : tidyShort(kept.join(''));
    }
  }

  if (actionFor('ALL_CAPS', opts.field, opts.store, { supported: false }) === 'flag') {
    allCapsWords(out, facts).forEach((w) => report('ALL_CAPS', 'flagged', w));
  }
  if (opts.limit != null && countCharacters(out) > opts.limit) {
    report('OVER_LIMIT', 'flagged', `${countCharacters(out)}/${opts.limit} karakter`);
  }
  return { text: out, issues };
}

/**
 * Rakip uygulamanin MARKA kismi ("Spotify: Muzik ve Podcast" → "spotify")
 * anahtar kelimede geciyor mu? Apple 2.3.7 meta veriyi "popular app names"
 * ile doldurmayi yasakliyor. Ayraci olmayan cok kelimeli baslikta marka
 * sinirini bilemeyiz; o durumda yalniz tum baslik eslesmesi sayilir (genel
 * kelimeyi yanlislikla atmamak icin).
 */
export function competitorBrandIn(term: string, competitorNames: string[], ownName?: string | null): string | null {
  const words = (s: string) => squash(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const brandOf = (name: string) => words(brandCore(name));
  const own = brandOf(ownName ?? '').join(' ');
  const hay = ` ${words(term).join(' ')} `;
  for (const name of competitorNames) {
    const brand = brandOf(name);
    const key = brand.join(' ');
    if (key.replace(/\s/g, '').length < 3 || key === own) continue;
    if (hay.includes(` ${key} `)) return name;
  }
  return null;
}
