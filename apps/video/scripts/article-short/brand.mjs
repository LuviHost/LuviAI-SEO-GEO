/**
 * Marka verisi — urunun yapacagi gibi yalniz sitenin herkese acik sayfasindan:
 *   ad    : og:site_name > JSON-LD Organization/WebSite/publisher > <title> son parcasi > alan adi
 *   logo  : apple-touch-icon > SVG ikon > JSON-LD logo > en buyuk PNG ikon > /favicon.ico
 *   renk  : meta theme-color (notr degilse) > CSS degiskeni (adinda primary ya da brand gecen) >
 *           CSS'te en sik gecen doygun renk > logodaki doygun renk > yok (sablon RanksUp turuncusu)
 * Indirilen dosyalar (logo, CSS) guvenilmeyen veridir: kaydedilir, yalniz okunur. Logo videoya
 * data: URI olarak <img> ile girer (SVG icindeki betik/harici kaynak <img> baglaminda calismaz).
 *
 * Sunucu (api videos/article-video-brand.ts) ayni fonksiyonu kullanir, iki kancayla:
 *   fetcher     : SSRF korumali indirme (ozel/yerel IP, yonlendirme hilesi, boyut/sure siniri);
 *                 varsayilan net.mjs fetchLimited yalniz CLI icindir
 *   prepareLogo : indirilen logoyu donusturur/sinirlar (sharp: PNG, en fazla 256 px); null donerse
 *                 aday atlanir ve siradakine gecilir
 * saveDir verilmezse diske hicbir sey yazilmaz.
 *
 * SINIRLAR (inceleme bulgusu — tek istek API'yi kilitleyemesin, tek video kuyrugu tikayamasin):
 *  - Ayristirma saf ve senkron iki fonksiyonda: analyzeBrandPage (HTML) ve colorFromCss (CSS).
 *    Ikisi de girdiyi kirpar (MAX_HTML_CHARS / MAX_CSS_CHARS) ve yalniz dogrusal desen kullanir.
 *    Sunucu bunlari `compute` kancasiyla worker_thread'de, sert sure siniriyla calistirir
 *    (api videos/brand-sandbox.ts); CLI ayni surecte cagirir.
 *  - Logo adayi en fazla MAX_LOGO_CANDIDATES: sayfadaki her <link rel=icon> aday olunca 41 bin
 *    aday x 8 sn = saatlerce suren tek is olculdu (kuyruk eszamanliligi 1, herkes bekler).
 *  - Tum cikarimin tek bir son tarihi var (deadlineMs, varsayilan 30 sn) + cagiranin signal'i.
 *    Suresi dolunca kalan adaylar denenmez; o ana kadar bulunanla donulur.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { capHtml, elements, firstInner, jsonLd, links, MAX_HTML_CHARS, meta, stripTags, typeOf } from './html.mjs';
import { fetchLimited } from './net.mjs';

const IMAGE_TYPES = { 'image/svg+xml': 'svg', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico', 'image/gif': 'gif' };

/** Tek CSS belgesinde (satir ici toplam ya da indirilen dosya) ayristirilan en fazla karakter */
export const MAX_CSS_CHARS = 300_000;
/** Denenecek en fazla logo adayi (varsayilan /favicon.ico dahil) */
export const MAX_LOGO_CANDIDATES = 6;
/** Tum marka cikariminin (indirmeler dahil) son tarihi */
export const BRAND_DEADLINE_MS = 30_000;

function hexToHsl(hex) {
  const n = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { s, l };
}

function normHex(v) {
  if (!v) return null;
  let m = /#([0-9a-f]{3}|[0-9a-f]{6})\b/i.exec(v);
  if (m) {
    let h = m[1].toLowerCase();
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    return `#${h}`;
  }
  m = /rgba?\(\s{0,10}(\d{1,3})[\s,]{1,10}(\d{1,3})[\s,]{1,10}(\d{1,3})/i.exec(v);
  if (m) return '#' + m.slice(1, 4).map((x) => Math.min(255, Number(x)).toString(16).padStart(2, '0')).join('');
  return null;
}

/** marka rengi sayilabilir mi: yeterince doygun, ne neredeyse beyaz ne neredeyse siyah */
const isBrandish = (hex) => {
  const { s, l } = hexToHsl(hex);
  return s >= 0.35 && l >= 0.18 && l <= 0.82;
};

/**
 * CSS -> marka rengi. Degisken deseni ReDoS'a karsi sinirli: eski `(--[\w-]+)\s*:\s*([^;}]+)`
 * uzun '-----' dizisinde her konumdan basliyor, tum diziyi yutup geri izliyordu (karesel; 2 MB
 * satir ici CSS ~ 85 dk olculdu). Simdi: ad yalniz kelime/tire OLMAYAN karakterden sonra
 * baslayabilir (dizinin icinden yeni deneme yok) ve her parca uzunluk tavanli.
 */
export function colorFromCss(rawCss) {
  const css = capHtml(rawCss, MAX_CSS_CHARS);
  const vars = [...css.matchAll(/(?<![\w-])(--[\w-]{1,80})\s{0,20}:\s{0,20}([^;}]{1,200})/g)].map((m) => ({ name: m[1].toLowerCase(), hex: normHex(m[2]) })).filter((v) => v.hex && isBrandish(v.hex));
  const rank = (n) => (/primary/.test(n) ? 0 : /brand/.test(n) ? 1 : /accent|main|theme/.test(n) ? 2 : 9) + (/hover|pressed|focus|active|disabled|light|dark|\d{2,3}/.test(n) ? 0.5 : 0);
  const named = vars.filter((v) => rank(v.name) < 9).sort((a, b) => rank(a.name) - rank(b.name));
  if (named.length) return { hex: named[0].hex, source: `css-degiskeni:${named[0].name}` };
  const counts = new Map();
  for (const m of css.matchAll(/#(?:[0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
    const h = normHex(m[0]);
    if (h && isBrandish(h)) counts.set(h, (counts.get(h) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return top && top[1] >= 3 ? { hex: top[0], source: `css-sikligi:${top[1]}` } : null;
}

/** SVG logodaki ilk doygun dolgu rengi (logo en fazla 300 KB indirilir; desen dogrusal) */
export function colorFromSvg(svgText) {
  const svg = capHtml(svgText, MAX_CSS_CHARS);
  for (const m of svg.matchAll(/(?:fill|stop-color)\s{0,10}=\s{0,10}["'](#[0-9a-f]{3,6})["']/gi)) {
    const h = normHex(m[1]);
    if (h && isBrandish(h)) return h;
  }
  return null;
}

/**
 * Sayfanin SAF ayristirmasi (ag yok, yan etki yok, ciktisi yapisal-kopyalanabilir duz veri):
 * worker_thread'e gonderilip sert sure siniriyla calistirilabilsin diye ayri.
 * Aday ve stil adresleri burada mutlak adrese cevrilir; gecersiz href atlanir.
 */
export function analyzeBrandPage(rawHtml, pageUrl) {
  const html = capHtml(rawHtml);
  const base = new URL(pageUrl);
  const ld = jsonLd(html);
  const org = ld.find((n) => typeOf(n).some((t) => ['Organization', 'Corporation', 'LocalBusiness'].includes(t)));
  const site = ld.find((n) => typeOf(n).includes('WebSite'));
  const art = ld.find((n) => n?.publisher);
  const titleInner = firstInner(html, 'title');
  const titleTail = titleInner !== null ? stripTags(titleInner).split(/\s[|–—-]\s/).map((s) => s.trim()).filter(Boolean) : [];
  const domain = base.hostname.replace(/^www\./, '');
  const name = meta(html, 'og:site_name') || org?.name || site?.name || art?.publisher?.name || (titleTail.length > 1 ? titleTail[titleTail.length - 1] : null) || domain;
  const abs = (href) => {
    try {
      return new URL(href, base).href;
    } catch {
      return null;
    }
  };

  /* logo adaylari — oncelik sirasi korunur, ayni adres bir kez, toplam MAX_LOGO_CANDIDATES */
  const ls = links(html).filter((l) => l.href);
  const size = (l) => {
    let best = 0;
    for (const s of String(l.sizes ?? '').split(/\s+/).slice(0, 20)) best = Math.max(best, Number(s.split('x')[0]) || 0);
    return best;
  };
  const ldLogo = [org?.logo, art?.publisher?.logo, site?.publisher?.logo].map((x) => (typeof x === 'string' ? x : x?.url)).find((x) => typeof x === 'string' && x);
  const ordered = [
    ...ls.filter((l) => l.rel.includes('apple-touch-icon')).sort((a, b) => size(b) - size(a)),
    ...ls.filter((l) => /\bicon\b/.test(l.rel) && (l.type === 'image/svg+xml' || /\.svg(\?|$)/i.test(l.href))),
    ...(ldLogo ? [{ href: ldLogo, rel: 'json-ld' }] : []),
    ...ls.filter((l) => /\bicon\b/.test(l.rel) && !/\.svg(\?|$)/i.test(l.href)).sort((a, b) => size(b) - size(a)),
  ];
  const candidates = [];
  const seen = new Set();
  // Son yer varsayilan /favicon.ico'ya ayrilir: sayfa adaylari tavani doldursa da o denenir
  for (const c of ordered) {
    if (candidates.length >= MAX_LOGO_CANDIDATES - 1) break;
    const url = abs(c.href);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    candidates.push({ url, href: c.href, rel: c.rel });
  }
  const fav = abs('/favicon.ico');
  if (fav && !seen.has(fav)) candidates.push({ url: fav, href: '/favicon.ico', rel: 'varsayilan' });

  /* renk girdileri */
  const theme = normHex(meta(html, 'theme-color'));
  let inlineCss = '';
  for (const el of elements(html, 'style')) {
    inlineCss += (inlineCss ? '\n' : '') + el.inner;
    if (inlineCss.length >= MAX_CSS_CHARS) break;
  }
  const sheets = [];
  for (const l of ls) {
    if (sheets.length >= 2) break;
    if (!l.rel.includes('stylesheet')) continue;
    const url = abs(l.href);
    if (!url) continue;
    const host = new URL(url).hostname;
    // Yalniz sitenin kendi alan adi (ve alt alan adlari); "kotu-ornek.com" "ornek.com" ile bitse de sayilmaz
    if (host === domain || host.endsWith(`.${domain}`)) sheets.push({ url, href: l.href });
  }
  return {
    name: String(name),
    domain,
    candidates,
    themeColor: theme && isBrandish(theme) ? theme : null,
    inlineCss: capHtml(inlineCss, MAX_CSS_CHARS),
    sheets,
    truncated: typeof rawHtml === 'string' && rawHtml.length > html.length,
  };
}

const LOCAL_OPS = { analyze: analyzeBrandPage, cssColor: colorFromCss };
/** Varsayilan hesaplayici (CLI): ayni surecte. Sunucu worker_thread'li olanini verir. */
export const localCompute = async (op, args) => LOCAL_OPS[op](...args);

/** Sinyal kesilince bekleyen islemi birakir (alttaki indirme kendi sure siniriyla biter) */
export function raceAbort(promise, signal) {
  if (!signal) return promise;
  const reason = () => signal.reason ?? new Error('iptal edildi');
  if (signal.aborted) return Promise.reject(reason());
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(reason());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}

export async function extractBrand(html, pageUrl, { saveDir = null, fetcher = fetchLimited, prepareLogo = null, signal = null, deadlineMs = BRAND_DEADLINE_MS, compute = localCompute } = {}) {
  const deadline = AbortSignal.timeout(deadlineMs);
  const sig = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const until = (p) => raceAbort(Promise.resolve(p), sig);
  const page = await until(compute('analyze', [html, pageUrl]));
  const notes = [];
  if (page.truncated) notes.push(`sayfa ${MAX_HTML_CHARS} karakterden uzun; yalniz basi okundu`);
  let timeoutNoted = false;
  const timedOut = (what) => {
    if (!timeoutNoted) notes.push(`marka suresi doldu (${what}); o ana kadar bulunanla devam`);
    timeoutNoted = true;
  };

  /* logo */
  let logo = null;
  for (const c of page.candidates) {
    if (sig.aborted) {
      timedOut('logo');
      break;
    }
    try {
      const r = await until(fetcher(c.url, { maxBytes: 300_000, accept: 'image/*', signal: sig }));
      let type = r.contentType.split(';')[0].trim().toLowerCase();
      const head = r.body.subarray(0, 300).toString('utf8');
      if (!IMAGE_TYPES[type] && /<svg[\s>]/i.test(head)) type = 'image/svg+xml';
      if (!IMAGE_TYPES[type] || r.body.length < 64) continue;
      // SVG'nin ham metni renk aramasi icin saklanir (donusturulmus PNG'de dolgu rengi okunmaz)
      const svgText = type === 'image/svg+xml' ? r.body.toString('utf8') : null;
      let body = r.body;
      let outType = type;
      if (prepareLogo) {
        const prepared = await until(prepareLogo(r.body, type));
        if (!prepared) {
          notes.push(`logo adayi donusturulemedi (${c.href})`);
          continue;
        }
        body = prepared.body;
        outType = prepared.type;
      }
      let file = null;
      if (saveDir) {
        file = join(saveDir, `logo.${IMAGE_TYPES[outType] ?? 'bin'}`);
        writeFileSync(file, body);
      }
      logo = { url: r.url, rel: c.rel, type: outType, sourceType: type, bytes: body.length, file, svgText, dataUri: `data:${outType};base64,${body.toString('base64')}` };
      break;
    } catch (e) {
      if (sig.aborted) {
        timedOut('logo');
        break;
      }
      notes.push(`logo adayi atlandi (${c.href}): ${e?.message ?? e}`);
    }
  }

  /* renk */
  let color = page.themeColor ? { hex: page.themeColor, source: 'meta:theme-color' } : null;
  if (!color && !sig.aborted) {
    let css = page.inlineCss;
    for (const [i, s] of page.sheets.entries()) {
      if (sig.aborted) break;
      try {
        const r = await until(fetcher(s.url, { maxBytes: 1_500_000, accept: 'text/css', signal: sig }));
        if (saveDir) writeFileSync(join(saveDir, `style-${i}.css`), r.body);
        // Her dosya ayri kirpilir: tek dev dosya digerinin yerini yemesin
        css += '\n' + capHtml(r.body.toString('utf8'), MAX_CSS_CHARS);
      } catch (e) {
        notes.push(`stil dosyasi atlandi (${s.href}): ${e?.message ?? e}`);
      }
    }
    try {
      if (!sig.aborted) color = await until(compute('cssColor', [css]));
    } catch (e) {
      notes.push(`css rengi okunamadi: ${e?.message ?? e}`);
    }
  }
  if (!color && sig.aborted) timedOut('renk');
  if (!color && logo?.svgText) {
    const hex = colorFromSvg(logo.svgText);
    if (hex) color = { hex, source: 'logo-svg' };
  }
  if (!color) notes.push('marka rengi bulunamadi -> sablon RanksUp turuncusuna duser');
  return {
    name: String(page.name).trim(),
    domain: page.domain,
    primary: color?.hex ?? null,
    colorSource: color?.source ?? 'yok',
    logo: logo ? { url: logo.url, rel: logo.rel, type: logo.type, sourceType: logo.sourceType, bytes: logo.bytes, file: logo.file } : null,
    logoDataUri: logo?.dataUri ?? null,
    notes,
  };
}
