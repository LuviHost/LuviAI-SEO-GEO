import { load } from 'cheerio';
import { detectBlock } from '../common/block-detect.js';
import type { SafeTextOptions, SafeTextResult } from '../common/safe-fetch.js';
import { wordPressPlainLink, type LivenessOutcome } from './republish-policy.js';

/**
 * YAYINDAKI KOPYANIN HERKESE ACIK ADRESI — yanit nasil okunur (saf, tek kaynak).
 *
 * Ayni soruyu iki yer soruyor: "bu adreste yazi hala duruyor mu?"
 *  - gunluk canlilik denetimi (published-liveness.service.ts): kopya iki denetimde
 *    404/410 verirse emekliye ayrilir;
 *  - yayinci (publisher.service.ts checkEntryPublicUrl): WordPress yazi kimligi 404
 *    verdiginde adres de 404/410 veriyorsa kopya silinmis sayilir (live_entry_missing:
 *    kayda missingAt, sitedeki son kopyaysa yazi READY_TO_PUBLISH).
 *
 * NEDEN TEK DOSYA: yayincinin kendi siniflandirmasi yalniz durum koduna bakiyor, govdeyi
 * hic okumuyordu. 404 durumuyla donen bir guvenlik duvari / bot dogrulama sayfasi
 * (Cloudflare "Just a moment..." ve cf-mitigated: challenge, DataDome captcha) "yazi
 * silinmis" sayiliyor; musterinin yayindaki kopyasi emekliye ayrilip site haritasindan
 * dusuyordu. Canlilik denetimi ayni yaniti common/block-detect.ts ile belirsiz sayiyordu.
 * Iki karar artik ayni islevi ve ayni istek seceneklerini kullanir.
 */

/**
 * Istek secenekleri. Kucuk bayt tavani: karar durum kodundan verilir; govdenin basi
 * yalniz engel / bot dogrulama sayfasini tanimak icin okunur (block-detect.ts basliklara
 * ve govdenin basina bakar; 2xx disinda da govde gerekir — errorBodyBytes). Birkac
 * yonlendirme izlenir (http → https, sonda egik cizgi, WordPress ?p=<id> → kalici
 * baglanti). Son madde iki kaynakla (2026-10-18'de okundu): WordPress redirect_canonical()
 * kaynak kodu (developer.wordpress.org/reference/functions/redirect_canonical:
 * `is_single() && ! empty( $_GET['p'] )` → `get_permalink( get_query_var( 'p' ) )`) ve
 * permalinkmanager.pro/docs/plugin-settings/canonical-redirects ("?p=123" → "canonical
 * permalink"). Degerler canlilik denetiminin LIVENESS_FETCH'i ile ayni.
 */
export const PUBLIC_URL_FETCH: SafeTextOptions = {
  method: 'GET',
  maxBytes: 32 * 1024,
  errorBodyBytes: 32 * 1024,
  maxRedirects: 3,
  timeoutMs: 10_000,
};

/**
 * Sorgulu adreste (WordPress duz baglantisi ?p=<id>) basarili yanitin okunan on kismi: sayfanin
 * kanonik baglantisi icin (declaresHomepageCanonical). <link rel="canonical"> <head>'dedir; tema
 * ve eklentilerin satir ici CSS / betikleri <head>'i 32 KB'tan uzun yapabilir. Sinirli: yalniz
 * sorgulu adreste, yalniz 2xx govdesi (hata govdesi errorBodyBytes ile ayni kalir).
 */
export const QUERY_URL_MAX_BYTES = 256 * 1024;

/** Adresin sorgu dizesi var mi (bos "?" sayilmaz); ayristirilamazsa hayir */
function hasQuery(raw: string | undefined): boolean {
  if (!raw) return false;
  try {
    return new URL(raw).search !== '';
  } catch {
    return false;
  }
}

/**
 * Bu adresin yoklamasindaki istek secenekleri: PUBLIC_URL_FETCH; sorgulu adreste govdenin ilk
 * QUERY_URL_MAX_BYTES'i okunur (kanonik baglanti denetimi). Guzel kalici baglanti eskisi gibi
 * 32 KB okur. Canlilik denetimi ve yayincinin adres yoklamasi bunu kullanir.
 */
export function publicUrlFetchOptions(requested: string): SafeTextOptions {
  return hasQuery(requested) ? { ...PUBLIC_URL_FETCH, maxBytes: QUERY_URL_MAX_BYTES } : PUBLIC_URL_FETCH;
}

/**
 * Sitenin ana sayfa adresi (siniflandirmanin "ana sayfaya yonlendirme" kurali icin):
 * kayitli site adresinin protokol + host + yolu; sorgu ve parca atilir. Canlilik
 * denetiminin ana sayfa yoklamasiyla ayni bicim.
 */
export function siteHomepage(site: URL): string {
  return `${site.protocol}//${site.host}${site.pathname}`;
}

/** Ayni host (www farki yok sayilir) ve ayni yol (sondaki egik cizgi yok sayilir); sorgu dizesine bakilmaz */
function samePath(a: string, b: string): boolean {
  try {
    const x = new URL(a);
    const y = new URL(b);
    const host = (u: URL) => u.hostname.toLowerCase().replace(/^www\./, '');
    const path = (u: URL) => u.pathname.replace(/\/+$/, '');
    return host(x) === host(y) && path(x) === path(y);
  } catch {
    return false;
  }
}

/**
 * Yonlendirmenin vardigi son adres sitenin ana sayfasi mi: ayni host + ayni yol. Sorgu
 * dizesi yok sayilir: silinen sayfayi ana sayfaya ceviren eklenti adrese parametre
 * ekleyebilir. Yanilma yonu guvenli: ana sayfa sayilan yanit 'unknown' olur, hicbir sey yazilmaz.
 */
function landedOnHomepage(finalUrl: string, homepage: string): boolean {
  return samePath(finalUrl, homepage);
}

/**
 * Istenen adres ana sayfanin KENDISI mi: ayni host + ayni yol VE ayni sorgu dizesi.
 * NEDEN sorgu: WordPress'in duz baglantisi (https://site/?p=42) ana sayfayla ayni yoldadir.
 * Yalniz yola bakan eski kural ?p=42'yi "ana sayfanin kendisi" sayiyor, onun ana sayfaya
 * yonlenmesini (404'u ana sayfaya ceviren eklenti) canli kopya diye okuyordu: hic yayina
 * alinmamis WordPress taslagi canli goruldu (liveSeenAt) sayilip site haritasinda ilan
 * ediliyor, yonlendirme durunca iki 404 ile "artik yayinda gorunmuyor" bildirimi gidiyor;
 * silinmis ?p= yazisi da hep canli kaliyordu.
 */
function isHomepageItself(requested: string, homepage: string): boolean {
  try {
    return samePath(requested, homepage) && new URL(requested).search === new URL(homepage).search;
  } catch {
    return false;
  }
}

/** "Ana sayfa" karsilastirma anahtari: host (www'siz, kucuk harf; varsayilan disi port dahil) + yol (sondaki egik cizgisiz); sema yok sayilir */
function homeKey(u: URL): string {
  return `${u.host.toLowerCase().replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}`;
}

/**
 * Sayfanin bildirdigi kanonik adres (saf): ilk <link rel="canonical" href>; o yoksa (ya da
 * adresi cozulemiyorsa) <meta property="og:url">. Goreli adres yanitin son adresine gore
 * cozulur. Ikisi de yoksa null.
 */
function declaredCanonical(html: string, base: string): URL | null {
  if (!html) return null;
  const $ = load(html);
  const resolve = (raw: string | undefined): URL | null => {
    const v = (raw ?? '').trim();
    if (!v) return null;
    try {
      return new URL(v, base);
    } catch {
      return null;
    }
  };
  return resolve($('link[rel~="canonical" i][href]').first().attr('href'))
    ?? resolve($('meta[property="og:url" i]').first().attr('content'));
}

/**
 * Sorgulu adrese gelen sayfa kanonik adres olarak sitenin ANA SAYFASINI mi bildiriyor (saf)?
 * Ana sayfa: sitenin kok adresi, kayitli site adresi (homepage) ve WordPress duz baglantisinda
 * baglantinin kendi yolu (WordPress ?p= baglantisini home_url( '?p=' . ID ) ile kurar: yol
 * WordPress'in ana sayfasidir). Sema, www ve sondaki egik cizgi yok sayilir; kanonik adreste
 * sorgu olmamali.
 *
 * NEDEN: sorgu dizesini yok sayan bir onbellek / CDN https://site/?p=42 istegine yonlendirmesiz
 * 200 ile ana sayfayi sunabilir; yanit "canli" okunur ve hic yayina alinmamis taslak canli
 * goruldu sayilirdi (liveSeenAt: adres ilan edilir, sonra iki 404 ile "artik yayinda
 * gorunmuyor" bildirimi). Yayindaki WordPress yazisi ?p=42'de ana sayfayi DEGIL kendi kalici
 * baglantisini kanonik bildirir. Iki kaynak (2026-10-18'de okundu): developer.wordpress.org
 * rel_canonical() / wp_get_canonical_url() referansi (yalniz is_singular() sayfada; adres
 * get_permalink( $post ), yayinda olmayan yazida false) ve wordpress-develop
 * src/wp-includes/link-template.php (ayni kod; get_permalink "Plain" ayarda
 * home_url( '?p=' . $post->ID ), digerlerinde kalici baglanti doner; default-filters.php
 * rel_canonical'i wp_head'e baglar). Kanonik baglanti bildirmeyen sayfa eskisi gibi okunur.
 */
function declaresHomepageCanonical(
  res: Pick<SafeTextResult, 'text' | 'url'>,
  requested: string,
  homepage: string | null | undefined,
): boolean {
  let req: URL;
  try {
    req = new URL(requested);
  } catch {
    return false;
  }
  const declared = declaredCanonical(res.text ?? '', res.url || requested);
  if (!declared || declared.search !== '' || (declared.protocol !== 'https:' && declared.protocol !== 'http:')) return false;
  const homes = new Set([homeKey(new URL('/', req))]);
  if (wordPressPlainLink(requested)) homes.add(homeKey(new URL(req.pathname, req)));
  if (homepage) {
    try {
      homes.add(homeKey(new URL(homepage)));
    } catch {
      // Ayristirilamayan ana sayfa yok sayilir
    }
  }
  return homes.has(homeKey(declared));
}

/**
 * Engel / bot dogrulama denetiminin okudugu govde (karakter): yanitin eskiden okunan on kismi
 * kadar. Sorgulu adreste daha uzun govde okunur (kanonik baglanti icin); engel karari
 * bu yuzden degismesin.
 */
const BLOCK_PROBE_CHARS = 32 * 1024;

/**
 * Yanitin siniflandirmasi (saf):
 *  - unknown: engel / bot dogrulamasi (block-detect: WAF, challenge, 401/407, 403/451,
 *    429, 503), diger 4xx ve 5xx; ayrica silinen sayfayi ana sayfaya yonlendiren site:
 *    sayfanin durdugunu gostermez, kaldirildigini da kanitlamaz. Bu davranis yaygin
 *    eklentilerle gelir (2026-10-18'de okundu: wordpress.org/plugins/all-404-redirect-to-homepage
 *    "redirect them to homepage ... using 301", 200.000+ etkin kurulum;
 *    wordpress.org/plugins/404-to-homepage "Redirect 404 to Homepage"). Sorgulu adres
 *    (WordPress ?p=<id>) ana sayfanin kendisi sayilmaz (isHomepageItself). Sorgulu adrese
 *    gelen ve kanonik adres olarak sitenin ana sayfasini bildiren sayfa da (sorguyu yok sayan
 *    onbellek / CDN ana sayfayi sundu) unknown: declaresHomepageCanonical.
 *  - gone: 404 / 410 (engel isareti tasimayan). 410 "muhtemelen kalici", 404 ise
 *    kaliciligi soylemez ve sunucunun kaynagi gizlemesi de olabilir (RFC 9110 15.5.5 /
 *    15.5.11; MDN HTTP 404 / 410 sayfalari). Canlilik denetimi bu yuzden tek 404 ile
 *    yetinmez (iki denetim + ayakta ana sayfa); yayinci ise yalniz WordPress'in de
 *    kimlige 404 dedigi yazida sorar.
 *  - live: 2xx / 3xx (yonlendirmeler izlendikten sonraki son yanit).
 * Not: 404 sayfasindaki iletisim formu reCAPTCHA'si engel sayilmaz (block-detect
 * GENERIC_CHALLENGE yalniz red durumlarinda) — formlu siradan 404 yine 'gone'.
 * opts.homepage verilmezse ana sayfaya yonlendirme kurali uygulanmaz; kanonik ana sayfa
 * kurali sitenin kok adresiyle (ve ?p= baglantisinin yoluyla) yine uygulanir.
 */
export function classifyLivenessResponse(
  res: Pick<SafeTextResult, 'status' | 'headers' | 'text' | 'url' | 'redirected'>,
  opts: { requested?: string; homepage?: string | null } = {},
): LivenessOutcome {
  if (detectBlock({ status: res.status, headers: res.headers ?? {}, text: (res.text ?? '').slice(0, BLOCK_PROBE_CHARS) })) return 'unknown';
  if (res.status === 404 || res.status === 410) return 'gone';
  if (res.status >= 200 && res.status < 400) {
    if (res.redirected && opts.homepage && opts.requested
      && landedOnHomepage(res.url, opts.homepage) && !isHomepageItself(opts.requested, opts.homepage)) return 'unknown';
    // Yalniz sorgulu adreste: guzel kalici baglanti ve ana sayfanin kendisi eskisi gibi okunur
    if (opts.requested && hasQuery(opts.requested) && declaresHomepageCanonical(res, opts.requested, opts.homepage)) return 'unknown';
    return 'live';
  }
  return 'unknown';
}
