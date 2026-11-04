/**
 * Olcum altyapisi tespiti (04.11.2026) — bir sitenin HERKESE ACIK dosyalarindan (ana sayfa HTML'i, ayni kokenli JS
 * paketleri, googletagmanager.com/gtm.js kapsayicisi) hangi analitik / reklam / etiket araclarinin kurulu oldugunu
 * ve hangi donusum olaylarinin olculdugunu cikarir. Musterinin sitesi ve rakipleri icin ayni kod calisir.
 *
 * Yalniz okuma: form doldurulmaz, olay tetiklenmez. Bu dosya saf fonksiyonlar; ag cagrisi olcum.service.ts'te.
 *
 * NEDEN "tespit edilemedi" dili: GA4 panelinde isaretlenen anahtar etkinlikler, ozel kanal gruplari, sunucu taraflı
 * etiketleme ve giris arkasindaki uygulama sayfalari disaridan gorunmez. Bulgu metinleri "yok" yerine
 * "disaridan gorunmuyor" der; sabit deger rakamlari "dosyada yazan deger"dir, birim ekonomisi diye sunulmaz.
 */

export type PlatformKod =
  | 'gtm' | 'ga4' | 'google_ads' | 'meta' | 'linkedin' | 'tiktok' | 'openai_ads' | 'bing_uet' | 'x_ads'
  | 'reddit' | 'pinterest' | 'criteo' | 'clarity' | 'hotjar' | 'yandex' | 'posthog' | 'segment' | 'mixpanel'
  | 'amplitude' | 'hubspot' | 'plausible' | 'matomo' | 'insider';

export type PlatformTur = 'etiket' | 'analitik' | 'reklam' | 'pazarlama';

/** Bulunan izin geldigi yer: sayfanin kendisi, sitenin JS paketi ya da GTM kapsayicisi */
export type Kaynak = 'html' | 'js' | 'gtm';

type PlatformTanim = {
  ad: string;
  tur: PlatformTur;
  /** varlik izi (kimlik bulunamasa da platform kurulu sayilir) */
  iz: RegExp[];
  /** kimlik yakalayan desenler: 1. grup kimlik */
  kimlik: RegExp[];
};

/**
 * NEDEN baglamli kimlik desenleri: "G-XXXXXXXXXX" ya da cipliak sayilar kucultulmus kodda rastgele de gecer;
 * kimlik yalniz yukleme/yapilandirma cagrisinin icinde yakalanir.
 */
export const PLATFORMLAR: Record<PlatformKod, PlatformTanim> = {
  gtm: {
    ad: 'Google Etiket Yöneticisi', tur: 'etiket',
    iz: [/googletagmanager\.com\/gtm\.js/],
    kimlik: [/gtm\.js\?id=(GTM-[A-Z0-9]{4,12})/g, /["'](GTM-[A-Z0-9]{4,12})["']/g],
  },
  ga4: {
    ad: 'Google Analytics 4', tur: 'analitik',
    iz: [/googletagmanager\.com\/gtag\/js\?id=G-/],
    kimlik: [
      /gtag\/js\?id=(G-[A-Z0-9]{6,12})\b/g,
      /["']config["']\s*,\s*["'](G-[A-Z0-9]{6,12})["']/g,
      /measurementId["']?\s*[:=]\s*["'](G-[A-Z0-9]{6,12})["']/g,
    ],
  },
  google_ads: {
    ad: 'Google Ads', tur: 'reklam',
    iz: [/googleadservices\.com\/pagead\/conversion/, /googleads\.g\.doubleclick\.net/],
    kimlik: [/\b(AW-\d{6,12})\b/g],
  },
  meta: {
    ad: 'Meta (Facebook/Instagram) pikseli', tur: 'reklam',
    iz: [/connect\.facebook\.net\/[a-zA-Z_]+\/fbevents\.js/, /facebook\.com\/tr\?id=/],
    kimlik: [/fbq\(\s*["']init["']\s*,\s*["'](\d{10,20})["']/g, /facebook\.com\/tr\?id=(\d{10,20})/g],
  },
  linkedin: {
    ad: 'LinkedIn Insight', tur: 'reklam',
    iz: [/snap\.licdn\.com\/li\.lms-analytics/, /px\.ads\.linkedin\.com/],
    kimlik: [/_linkedin_partner_id\s*=\s*["']?(\d{4,12})/g],
  },
  tiktok: {
    ad: 'TikTok pikseli', tur: 'reklam',
    iz: [/analytics\.tiktok\.com\/i18n\/pixel/],
    kimlik: [/ttq\.load\(\s*["']([A-Z0-9]{15,25})["']/g],
  },
  openai_ads: {
    ad: 'ChatGPT (OpenAI) reklam pikseli', tur: 'reklam',
    iz: [/bzrcdn\.openai\.com\/sdk\/oaiq/],
    kimlik: [/oaiq\(\s*["']init["']\s*,\s*\{\s*pixelId\s*:\s*["']([A-Za-z0-9_-]{8,40})["']/g],
  },
  bing_uet: {
    ad: 'Microsoft Ads (UET)', tur: 'reklam',
    iz: [/bat\.bing\.com\/bat\.js/],
    kimlik: [/\bti\s*:\s*["'](\d{5,12})["']/g],
  },
  x_ads: {
    ad: 'X (Twitter) reklam pikseli', tur: 'reklam',
    iz: [/static\.ads-twitter\.com\/uwt\.js/],
    kimlik: [/twq\(\s*["']config["']\s*,\s*["']([a-z0-9]{5,10})["']/g],
  },
  reddit: {
    ad: 'Reddit pikseli', tur: 'reklam',
    iz: [/redditstatic\.com\/ads\/pixel\.js/],
    kimlik: [/rdt\(\s*["']init["']\s*,\s*["']([A-Za-z0-9_]{6,40})["']/g],
  },
  pinterest: {
    ad: 'Pinterest etiketi', tur: 'reklam',
    iz: [/s\.pinimg\.com\/ct\/core\.js/],
    kimlik: [/pintrk\(\s*["']load["']\s*,\s*["'](\d{8,16})["']/g],
  },
  criteo: {
    ad: 'Criteo', tur: 'reklam',
    iz: [/static\.criteo\.net\/js\/ld\/ld\.js/, /dynamic\.criteo\.com/],
    kimlik: [],
  },
  clarity: {
    ad: 'Microsoft Clarity', tur: 'analitik',
    iz: [/clarity\.ms\/tag\//],
    kimlik: [/clarity\.ms\/tag\/["'+\s]*([a-z0-9]{8,12})\b/g],
  },
  hotjar: {
    ad: 'Hotjar', tur: 'analitik',
    iz: [/static\.hotjar\.com\/c\/hotjar-/],
    kimlik: [/hjid\s*:\s*(\d{5,10})/g],
  },
  yandex: {
    ad: 'Yandex Metrica', tur: 'analitik',
    iz: [/mc\.yandex\.ru\/metrika\/tag\.js/],
    kimlik: [/ym\(\s*(\d{6,10})\s*,\s*["']init["']/g],
  },
  posthog: { ad: 'PostHog', tur: 'analitik', iz: [/\.posthog\.com/, /posthog\.init\(/], kimlik: [] },
  segment: { ad: 'Segment', tur: 'analitik', iz: [/cdn\.segment\.com\/analytics\.js/], kimlik: [] },
  mixpanel: { ad: 'Mixpanel', tur: 'analitik', iz: [/cdn\.mxpnl\.com/, /mixpanel\.init\(/], kimlik: [] },
  amplitude: { ad: 'Amplitude', tur: 'analitik', iz: [/cdn\.amplitude\.com/, /amplitude\.getInstance\(\)\.init\(/], kimlik: [] },
  hubspot: {
    ad: 'HubSpot', tur: 'pazarlama',
    iz: [/js\.hs-scripts\.com\//, /js\.hs-analytics\.net\//],
    kimlik: [/js\.hs-scripts\.com\/(\d{5,10})\.js/g],
  },
  plausible: { ad: 'Plausible', tur: 'analitik', iz: [/plausible\.io\/js\//], kimlik: [] },
  matomo: { ad: 'Matomo', tur: 'analitik', iz: [/matomo\.js/, /piwik\.js/, /_paq\.push\(\s*\[\s*["']trackPageView/], kimlik: [] },
  insider: { ad: 'Insider', tur: 'pazarlama', iz: [/api\.useinsider\.com/, /\.api\.useinsider\.com/], kimlik: [] },
};

export type OlcumPlatform = { kod: PlatformKod; ad: string; tur: PlatformTur; kimlikler: string[]; kaynaklar: Kaynak[] };

export type OlayDegeri = { tur: 'sabit'; sayi: number; para?: string } | { tur: 'dinamik' };

export type OlcumOlay = {
  /** olayin kendi adi: "generate_lead", "Purchase", "AW-123/abc" */
  ad: string;
  platform: PlatformKod | 'datalayer';
  /** GTM'de olayi tetikleyen dataLayer olayi ya da sayfa yolu ("form_submit", "/tesekkurler") */
  tetikleyici?: string;
  deger?: OlayDegeri;
  kaynak: Kaynak;
};

export type GtmOzet = { kimlik: string; etiketSayisi: number; duraklatilan: number; sunucuTarafli: boolean };

export type OlcumRaporu = {
  platformlar: OlcumPlatform[];
  olaylar: OlcumOlay[];
  gtm: GtmOzet[];
  /** sunucu taraflı etiketleme izi (transport_url / server_container_url): bu kanaldan giden olaylar gorunmez */
  sunucuTarafli: boolean;
};

/** GTM'in kendi ic olaylari ve sayfa gorunumu donusum sayilmaz */
const DONUSUM_DISI = /^(gtm\.|page_view$|pageview$|PageView$|page_viewed$|spa_page_view$|virtual_page_?view$|ViewContent$|user_engagement$|scroll$|session_start$|first_visit$|config$|originalLocation$|cookie_?consent\w*$|consent\w*$)/i;

export function donusumOlayiMi(o: Pick<OlcumOlay, 'ad'>): boolean {
  return !DONUSUM_DISI.test(o.ad);
}

/** Toplayici: ayni platform/olay birden cok kaynaktan gelirse birlestirir */
class Toplayici {
  private p = new Map<PlatformKod, { kimlik: Set<string>; kaynak: Set<Kaynak> }>();
  private o = new Map<string, OlcumOlay>();
  gtm: GtmOzet[] = [];
  sunucuTarafli = false;

  platform(kod: PlatformKod, kaynak: Kaynak, kimlik?: string) {
    const k = this.p.get(kod) ?? { kimlik: new Set<string>(), kaynak: new Set<Kaynak>() };
    if (kimlik) k.kimlik.add(kimlik);
    k.kaynak.add(kaynak);
    this.p.set(kod, k);
  }

  olay(o: OlcumOlay) {
    const ad = o.ad.trim().slice(0, 80);
    if (!ad) return;
    const anahtar = `${o.platform}|${ad}|${o.tetikleyici ?? ''}`;
    const eski = this.o.get(anahtar);
    // sabit deger dinamikten, dinamik bilinmeyenden daha bilgilidir
    if (!eski || (o.deger && (!eski.deger || (eski.deger.tur === 'dinamik' && o.deger.tur === 'sabit')))) {
      this.o.set(anahtar, { ...o, ad });
    }
  }

  rapor(): OlcumRaporu {
    const sira: PlatformKod[] = Object.keys(PLATFORMLAR) as PlatformKod[];
    return {
      platformlar: [...this.p.entries()]
        .sort((a, b) => sira.indexOf(a[0]) - sira.indexOf(b[0]))
        .map(([kod, v]) => ({
          kod, ad: PLATFORMLAR[kod].ad, tur: PLATFORMLAR[kod].tur,
          kimlikler: [...v.kimlik].sort(), kaynaklar: [...v.kaynak].sort(),
        })),
      olaylar: [...this.o.values()].sort((a, b) => a.platform.localeCompare(b.platform) || a.ad.localeCompare(b.ad)),
      gtm: this.gtm,
      sunucuTarafli: this.sunucuTarafli,
    };
  }
}

/** Olay cagrisinin hemen arkasindaki nesneden sabit deger (value: 250) ve para birimi */
function degerOku(arka: string): OlayDegeri | undefined {
  const parca = arka.slice(0, 400).split(/\)\s*[;,]/)[0];
  const sayi = /\bvalue["']?\s*:\s*(\d{1,7}(?:\.\d{1,2})?)\b/.exec(parca);
  if (sayi) {
    const para = /\bcurrency["']?\s*:\s*["']([A-Z]{3})["']/.exec(parca)?.[1];
    return { tur: 'sabit', sayi: Number(sayi[1]), ...(para ? { para } : {}) };
  }
  return /\bvalue["']?\s*:/.test(parca) ? { tur: 'dinamik' } : undefined;
}

/** Kod icindeki olay cagrilari: [desen, platform] — 1. grup olay adi */
const OLAY_DESENLERI: Array<[RegExp, PlatformKod | 'datalayer']> = [
  [/gtag\(\s*["']event["']\s*,\s*["']([A-Za-z0-9_ .-]{2,60})["']/g, 'ga4'],
  [/fbq\(\s*["']track(?:Custom)?["']\s*,\s*["']([A-Za-z0-9_ ]{2,60})["']/g, 'meta'],
  [/ttq\.track\(\s*["']([A-Za-z0-9_]{2,60})["']/g, 'tiktok'],
  [/oaiq\(\s*["']measure["']\s*,\s*["']([A-Za-z0-9_]{2,60})["']/g, 'openai_ads'],
  [/rdt\(\s*["']track["']\s*,\s*["']([A-Za-z0-9_]{2,60})["']/g, 'reddit'],
  [/pintrk\(\s*["']track["']\s*,\s*["']([A-Za-z0-9_]{2,60})["']/g, 'pinterest'],
  [/twq\(\s*["']event["']\s*,\s*["']([A-Za-z0-9_-]{2,60})["']/g, 'x_ads'],
  [/ym\(\s*\d{6,10}\s*,\s*["']reachGoal["']\s*,\s*["']([A-Za-z0-9_-]{2,60})["']/g, 'yandex'],
  [/dataLayer\.push\(\s*\{[^{}]{0,300}?\bevent["']?\s*:\s*["']([A-Za-z0-9_.-]{2,60})["']/g, 'datalayer'],
];

/** HTML ya da JS metnindeki izler (GTM kapsayicisindaki ozel HTML etiketleri de bununla taranir) */
function metniTara(metin: string, kaynak: Kaynak, t: Toplayici) {
  for (const [kod, tanim] of Object.entries(PLATFORMLAR) as Array<[PlatformKod, PlatformTanim]>) {
    let bulundu = tanim.iz.some((d) => d.test(metin));
    for (const d of tanim.kimlik) {
      for (const m of metin.matchAll(d)) {
        bulundu = true;
        t.platform(kod, kaynak, m[1]);
      }
    }
    if (bulundu) t.platform(kod, kaynak);
  }
  for (const [desen, platform] of OLAY_DESENLERI) {
    for (const m of metin.matchAll(desen)) {
      const arka = metin.slice((m.index ?? 0) + m[0].length);
      const ad = m[1];
      if (platform === 'datalayer' && /^gtm\./.test(ad)) continue;
      // gtag olayi send_to: AW-… ise Google Ads donusumudur
      const sendTo = /^[^)]{0,300}?send_to["']?\s*:\s*["'](AW-\d{6,12}(?:\/[A-Za-z0-9_-]+)?)["']/.exec(arka)?.[1];
      // Olay cagrisi platformun kurulu oldugunun kanitidir (yukleyici baska pakette olabilir).
      // NEDEN ga4 haric: gtag('event') yalniz Google Ads icin de kullanilir; GA4 kimlikten sayilir.
      if (sendTo) t.platform('google_ads', kaynak, sendTo.split('/')[0]);
      else if (platform !== 'ga4' && platform !== 'datalayer') t.platform(platform, kaynak);
      t.olay({ ad: sendTo && ad === 'conversion' ? sendTo : ad, platform: sendTo ? 'google_ads' : platform, deger: degerOku(arka), kaynak });
    }
  }
  for (const m of metin.matchAll(/lintrk\(\s*["']track["']\s*,\s*\{\s*conversion_id\s*:\s*["']?(\d{4,12})/g)) {
    t.platform('linkedin', kaynak);
    t.olay({ ad: `conversion_id ${m[1]}`, platform: 'linkedin', kaynak });
  }
  if (/\b(transport_url|server_container_url)["']?\s*[:=]/.test(metin)) t.sunucuTarafli = true;
}

/** gtm.js icindeki `"resource": {...}` nesnesi (macros, tags, predicates, rules) */
type GtmKaynak = {
  macros?: Array<Record<string, unknown>>;
  tags?: Array<Record<string, unknown>>;
  predicates?: Array<Record<string, unknown>>;
  rules?: unknown[];
};

export function gtmKaynagiAyikla(js: string): GtmKaynak | null {
  const i = js.indexOf('"resource":');
  if (i < 0) return null;
  const bas = js.indexOf('{', i);
  if (bas < 0) return null;
  // NEDEN el ile parantez sayimi: nesneden sonra JS kodu devam eder; JSON.parse tum dosyayi kabul etmez
  let derinlik = 0;
  let dizide = false;
  let kacis = false;
  for (let j = bas; j < js.length; j++) {
    const c = js[j];
    if (dizide) {
      if (kacis) kacis = false;
      else if (c === '\\') kacis = true;
      else if (c === '"') dizide = false;
      continue;
    }
    if (c === '"') dizide = true;
    else if (c === '{') derinlik++;
    else if (c === '}' && --derinlik === 0) {
      try {
        return JSON.parse(js.slice(bas, j + 1)) as GtmKaynak;
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** GTM degeri: duz metin ya da ["macro", n] / ["template", …] → dinamik */
function duz(v: unknown): string | undefined {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined;
}

function gtmDeger(v: unknown, para?: unknown): OlayDegeri | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const s = duz(v);
  if (s !== undefined) {
    const n = Number(s);
    if (!Number.isFinite(n) || n <= 0) return undefined;
    const p = duz(para);
    return { tur: 'sabit', sayi: n, ...(p && /^[A-Z]{3}$/.test(p) ? { para: p } : {}) };
  }
  return { tur: 'dinamik' };
}

/** Etiket indeksi → onu tetikleyen dataLayer olaylari / sayfa yollari */
function tetikleyiciler(k: GtmKaynak): Map<number, string[]> {
  const macros = k.macros ?? [];
  const yuklem = (k.predicates ?? []).map((p) => {
    const arg0 = p.arg0 as unknown;
    const m = Array.isArray(arg0) && arg0[0] === 'macro' && typeof arg0[1] === 'number' ? macros[arg0[1]] : undefined;
    const fn = m?.function;
    const arg1 = duz(p.arg1);
    if (!arg1) return undefined;
    if (fn === '__e') return /^gtm\.(js|init|init_consent|dom|load)$/.test(arg1) ? 'sayfa yüklenince' : arg1;
    if (fn === '__u' || fn === '__aev') return arg1.startsWith('/') || arg1.includes('.') ? arg1 : undefined;
    return undefined;
  });
  const sonuc = new Map<number, string[]>();
  for (const kural of k.rules ?? []) {
    if (!Array.isArray(kural)) continue;
    const kosullar: string[] = [];
    const etiketler: number[] = [];
    for (const adim of kural) {
      if (!Array.isArray(adim)) continue;
      if (adim[0] === 'if') for (const n of adim.slice(1)) { const y = typeof n === 'number' ? yuklem[n] : undefined; if (y) kosullar.push(y); }
      if (adim[0] === 'add') for (const n of adim.slice(1)) if (typeof n === 'number') etiketler.push(n);
    }
    for (const e of etiketler) sonuc.set(e, [...(sonuc.get(e) ?? []), ...kosullar]);
  }
  return sonuc;
}

const GOOGLE_KUTUPHANESI = new Set<PlatformKod>(['gtm', 'ga4', 'google_ads']);

/** GTM kapsayicisi (gtm.js) — etiket turlerine gore platform ve donusum olaylari */
function gtmTara(kimlik: string, js: string, t: Toplayici) {
  t.platform('gtm', 'gtm', kimlik);
  const k = gtmKaynagiAyikla(js);
  if (!k) {
    // NEDEN tam metin taranmaz: GTM kutuphanesindeki Google adresleri yanlis pozitif verir (GOOGLE_KUTUPHANESI)
    t.gtm.push({ kimlik, etiketSayisi: 0, duraklatilan: 0, sunucuTarafli: false });
    return;
  }
  const tet = tetikleyiciler(k);
  const etiketler = k.tags ?? [];
  let duraklatilan = 0;
  let sunucu = false;
  // Meta piksel kimligi bilinirse ayni kimlikli ozel sablon etiketi Meta olayidir
  const metniHtml = etiketler.map((e) => duz(e.vtp_html) ?? '').join('\n');
  etiketler.forEach((e, i) => {
    const fn = String(e.function ?? '');
    const ilkTet = tet.get(i)?.find((x) => x !== 'sayfa yüklenince');
    const tetikleyici = ilkTet ?? (tet.get(i)?.length ? 'sayfa yüklenince' : undefined);
    if (e.vtp_serverContainerUrl || e.vtp_transportUrl) sunucu = true;
    switch (fn) {
      case '__paused':
        duraklatilan++;
        return;
      case '__googtag':
      case '__gaawc': {
        const id = duz(e.vtp_tagId) ?? duz(e.vtp_measurementId);
        if (id?.startsWith('G-')) t.platform('ga4', 'gtm', id);
        else if (id?.startsWith('AW-')) t.platform('google_ads', 'gtm', id);
        return;
      }
      case '__gaawe': {
        const id = duz(e.vtp_measurementIdOverride);
        t.platform('ga4', 'gtm', id?.startsWith('G-') ? id : undefined);
        const ad = duz(e.vtp_eventName);
        if (ad) t.olay({ ad, platform: 'ga4', tetikleyici, kaynak: 'gtm' });
        return;
      }
      case '__ua':
        t.platform('ga4', 'gtm');
        return;
      case '__awct': {
        const id = duz(e.vtp_conversionId);
        const etiket = duz(e.vtp_conversionLabel);
        const aw = id ? `AW-${id.replace(/^AW-/, '')}` : undefined;
        t.platform('google_ads', 'gtm', aw);
        t.olay({ ad: aw && etiket ? `${aw}/${etiket}` : 'Google Ads dönüşümü', platform: 'google_ads', tetikleyici, deger: gtmDeger(e.vtp_conversionValue, e.vtp_currencyCode), kaynak: 'gtm' });
        return;
      }
      case '__sp': {
        const id = duz(e.vtp_conversionId);
        t.platform('google_ads', 'gtm', id ? `AW-${id.replace(/^AW-/, '')}` : undefined);
        return;
      }
      case '__baut': {
        t.platform('bing_uet', 'gtm', duz(e.vtp_tagId));
        const ad = duz(e.vtp_goalValue) ? 'UET hedefi' : undefined;
        if (ad) t.olay({ ad, platform: 'bing_uet', tetikleyici, deger: gtmDeger(e.vtp_goalValue), kaynak: 'gtm' });
        return;
      }
      case '__html':
        metniTara(duz(e.vtp_html) ?? '', 'gtm', t);
        return;
      default:
        if (fn.startsWith('__cvt')) sablonEtiketi(e, tetikleyici, metniHtml, js, t);
    }
  });
  // ozel HTML disindaki her sey (sablon kodlari) — yalniz platform izleri.
  // NEDEN Google platformlari haric: GTM'in kendi kutuphanesi her kapsayicida googleadservices/gtag adreslerini
  // tasir; Google Ads ve GA4 yalniz etiketlerden (__googtag/__awct/__gaawe) sayilir.
  for (const [kod, tanim] of Object.entries(PLATFORMLAR) as Array<[PlatformKod, PlatformTanim]>) {
    if (!GOOGLE_KUTUPHANESI.has(kod) && tanim.iz.some((d) => d.test(js))) t.platform(kod, 'gtm');
  }
  if (/\b(transport_url|server_container_url)\b/.test(metniHtml)) sunucu = true;
  if (sunucu) t.sunucuTarafli = true;
  t.gtm.push({ kimlik, etiketSayisi: etiketler.length, duraklatilan, sunucuTarafli: sunucu });
}

/**
 * Topluluk sablonu etiketleri (__cvt_*): kod adi rastgele, platform alan adlarindan anlasilir.
 * Meta: vtp_pixelId + (vtp_standardEventName | Meta CAPI alanlari); Clarity: vtp_projectId ve kapsayicida clarity.ms.
 */
function sablonEtiketi(e: Record<string, unknown>, tetikleyici: string | undefined, metniHtml: string, js: string, t: Toplayici) {
  const anahtarlar = Object.keys(e).join(' ');
  const piksel = duz(e.vtp_pixelId);
  if (piksel && (/Meta|CAPI|fbq/i.test(anahtarlar) || metniHtml.includes(piksel)) && /^\d{10,20}$/.test(piksel)) {
    t.platform('meta', 'gtm', piksel);
    const std = duz(e.vtp_standardEventName);
    const ad = std ?? duz(e.vtp_customEventName);
    if (ad) {
      const liste = e.vtp_objectPropertyList;
      let deger: OlayDegeri | undefined;
      if (Array.isArray(liste)) {
        for (const satir of liste.slice(1)) {
          if (Array.isArray(satir) && satir[2] === 'value' && satir[3] === 'value') {
            deger = gtmDeger(satir[4], undefined);
          }
          if (Array.isArray(satir) && satir[2] === 'currency' && deger?.tur === 'sabit') {
            const p = duz(satir[4]);
            if (p && /^[A-Z]{3}$/.test(p)) deger = { ...deger, para: p };
          }
        }
      }
      t.olay({ ad, platform: 'meta', tetikleyici, deger, kaynak: 'gtm' });
    }
    return;
  }
  const proje = duz(e.vtp_projectId);
  if (proje && /^[a-z0-9]{8,12}$/.test(proje) && /clarity\.ms/.test(js)) {
    t.platform('clarity', 'gtm', proje);
    return;
  }
  const tiktok = duz(e.vtp_pixelCode) ?? duz(e.vtp_pixelId);
  if (tiktok && /^[A-Z0-9]{15,25}$/.test(tiktok) && /tiktok/i.test(js)) {
    t.platform('tiktok', 'gtm', tiktok);
    const ad = duz(e.vtp_event) ?? duz(e.vtp_eventName);
    if (ad) t.olay({ ad, platform: 'tiktok', tetikleyici, kaynak: 'gtm' });
    return;
  }
  const li = duz(e.vtp_partnerId);
  if (li && /^\d{4,12}$/.test(li)) t.platform('linkedin', 'gtm', li);
}

export type OlcumGirdisi = {
  html: string;
  /** ayni kokenli JS paketleri (Next/Vite parcalari) */
  js: string[];
  /** GTM kimligi → gtm.js icerigi */
  gtm: Record<string, string>;
};

export function olcumTespit(g: OlcumGirdisi): OlcumRaporu {
  const t = new Toplayici();
  metniTara(g.html, 'html', t);
  for (const j of g.js) metniTara(j, 'js', t);
  for (const [kimlik, js] of Object.entries(g.gtm)) gtmTara(kimlik, js, t);
  return t.rapor();
}

/** HTML + JS'te gecen GTM kimlikleri (gtm.js indirilecekler) */
export function gtmKimlikleri(metinler: string[], sinir = 3): string[] {
  const s = new Set<string>();
  for (const m of metinler) {
    for (const d of PLATFORMLAR.gtm.kimlik) for (const x of m.matchAll(d)) s.add(x[1]);
  }
  return [...s].slice(0, sinir);
}

/** Ana sayfadaki ayni kokenli script adresleri (mutlak). Ucuncu taraf kutuphaneler indirilmez: kimlik sayfada/pakette. */
export function ayniKokenScriptleri(html: string, sayfaUrl: string, sinir = 30): string[] {
  const kok = new URL(sayfaUrl);
  const s = new Set<string>();
  for (const m of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) {
    try {
      const u = new URL(m[1].replace(/&amp;/g, '&'), kok);
      if (u.protocol === 'https:' || u.protocol === 'http:') {
        if (u.hostname === kok.hostname || u.hostname === `www.${kok.hostname}` || `www.${u.hostname}` === kok.hostname) s.add(u.toString());
      }
    } catch {
      // gecersiz adres atlanir
    }
  }
  return [...s].slice(0, sinir);
}

export type BulguDuzey = 'kritik' | 'uyari' | 'bilgi';
export type OlcumBulgusu = { duzey: BulguDuzey; kod: string; metin: string };

/** AI asistanlarinin yonlendiren alan adlari — GA4 ozel kanal grubu tavsiyesi icin */
export const AI_YONLENDIRENLER = ['chatgpt.com', 'perplexity.ai', 'gemini.google.com', 'copilot.microsoft.com', 'claude.ai'];

/** Musterinin kendi sitesi icin bulgular (rakip icin degil). Disaridan gorunmeyen sey "yok" diye yazilmaz. */
export function olcumBulgulari(r: OlcumRaporu): OlcumBulgusu[] {
  const b: OlcumBulgusu[] = [];
  const var_ = (k: PlatformKod) => r.platformlar.some((p) => p.kod === k);
  const analitik = r.platformlar.filter((p) => p.tur === 'analitik');
  const reklam = r.platformlar.filter((p) => p.tur === 'reklam');
  const donusum = r.olaylar.filter(donusumOlayiMi);
  if (!analitik.length && !var_('gtm')) {
    b.push({ duzey: 'kritik', kod: 'analitik-yok', metin: 'Sitede analitik aracı bulunamadı. Yapay zekâ asistanlarından gelenler dahil hiçbir ziyaretçi ölçülemiyor.' });
  } else if (!analitik.length && !r.sunucuTarafli) {
    b.push({ duzey: 'uyari', kod: 'analitik-gorunmuyor', metin: 'Etiket yöneticisi var ama içinde analitik aracı görünmüyor. Ziyaretçi ölçümü yapılmıyor olabilir.' });
  }
  if ((analitik.length || var_('gtm')) && !donusum.length) {
    b.push({
      duzey: 'uyari', kod: 'donusum-gorunmuyor',
      metin: 'Dışarıdan görünen dönüşüm olayı yok (form gönderimi, kayıt, satın alma). Google Analytics panelinde elle tanımlı bir anahtar etkinlik yoksa, hangi kanalın müşteri getirdiği ölçülemiyor.',
    });
  }
  if (reklam.length && !donusum.some((o) => reklam.some((p) => p.kod === o.platform))) {
    b.push({
      duzey: 'uyari', kod: 'reklam-donusumsuz',
      metin: `${reklam.map((p) => p.ad).join(', ')} kurulu ama bu platformlara dönüşüm bildirildiği görünmüyor. Reklam sistemi neyin satış getirdiğini öğrenemez.`,
    });
  }
  if (var_('ga4')) {
    b.push({
      duzey: 'bilgi', kod: 'ai-kanal-grubu',
      metin: `Yapay zekâ asistanlarından gelen ziyaretçiyi ayrı görmek için Google Analytics'te özel kanal grubu tanımlayın (kaynak: ${AI_YONLENDIRENLER.join(', ')}). Bu ayar dışarıdan görünmez.`,
    });
  }
  if (r.sunucuTarafli) {
    b.push({ duzey: 'bilgi', kod: 'sunucu-tarafli', metin: 'Sunucu taraflı etiketleme izi var. Bu kanaldan giden olaylar dışarıdan görünmez; liste eksik olabilir.' });
  }
  return b;
}
