/**
 * Bagimliliksiz, hosgorulu HTML yardimcilari. Girdi GUVENILMEYEN HTML'dir (musteri sitesinin
 * anasayfasi, API surecinde de calisir).
 *
 * ReDoS KURALI (inceleme bulgusu): bu dosyadaki her desen dogrusal kalmali.
 *  - Etiket ici `[^<>]*`, `[^>]*` DEGIL: kapanmayan `<meta <meta ...` dizisinde her deneme
 *    belgenin sonuna kadar taranir -> karesel (2 MB ~ dakikalar). `[^<>]` bir sonraki '<'da durur.
 *  - Kapanisi aranan etiket (title, script, p ...) tembel `[\s\S]*?<\/x>` ile DEGIL,
 *    elements() ile: kapanis bir kez aranir, bulunmazsa o etiket adi icin arama biter.
 *    Tembel desen kapanmayan her acilista belgenin sonuna kadar tarar (85 sn / 2 MB olculdu).
 *  - Belge boyutu cagiranda kirpilir (MAX_HTML_CHARS); dogrusal desen + tavan = sinirli sure.
 */

/** Tek belgede ayristirilan en fazla karakter (anasayfa / makale). Logo, meta ve JSON-LD basta olur. */
export const MAX_HTML_CHARS = 300_000;
/** Tek etiketin (acilis) en fazla uzunlugu — daha uzunu bozuk/dusmanca sayilir, atlanir */
const MAX_TAG = 4096;

export const capHtml = (s, max = MAX_HTML_CHARS) => (typeof s === 'string' ? (s.length > max ? s.slice(0, max) : s) : '');

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', ndash: '–', mdash: '—', laquo: '«', raquo: '»', middot: '·' };

export function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      // &#x110000; / &#xD800; gibi gecersiz kod noktasi String.fromCodePoint'i RangeError ile
      // firlatir ve tum ayristirmayi dusururdu (dusmanca sayfa = marka/makale yok). Gecersiz
      // varlik oldugu gibi birakilir; tek basina vekil (surrogate) de metne sokulmaz.
      return Number.isInteger(cp) && cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

export const stripTags = (s) => decode(s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^<>]+>/g, '')).replace(/\s+/g, ' ').trim();

export function attr(tag, name) {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? decode(m[2] ?? m[3] ?? m[4] ?? '') : null;
}

/** <meta property|name="key" content="..."> */
export function meta(html, key) {
  for (const m of html.matchAll(new RegExp(`<meta\\b[^<>]{0,${MAX_TAG}}>`, 'gi'))) {
    const t = m[0];
    const k = (attr(t, 'property') ?? attr(t, 'name') ?? '').toLowerCase();
    if (k === key.toLowerCase()) return attr(t, 'content');
  }
  return null;
}

export function links(html) {
  return [...html.matchAll(new RegExp(`<link\\b[^<>]{0,${MAX_TAG}}>`, 'gi'))].map((m) => ({ rel: (attr(m[0], 'rel') ?? '').toLowerCase(), href: attr(m[0], 'href'), sizes: attr(m[0], 'sizes'), type: attr(m[0], 'type') }));
}

/**
 * Kapanisi olan elemanlar, sirayla: { index, name, open, inner, end }. `names` duzenli ifade
 * alternatifi ('p|li', 'h[1-6]'). Anlam eski `<(x)\b[^>]*>([\s\S]*?)<\/\1>` deseniyle ayni
 * (ilk kapanisa kadar), ama dogrusal: kapanisi olmayan ad bir daha aranmaz.
 */
export function* elements(html, names) {
  const openRe = new RegExp(`<(${names})\\b[^<>]{0,${MAX_TAG}}>`, 'gi');
  const closers = new Map();
  for (let m; (m = openRe.exec(html)); ) {
    const name = m[1].toLowerCase();
    let close = closers.get(name);
    if (close === null) continue;
    if (!close) closers.set(name, (close = new RegExp(`</${name}\\s*>`, 'gi')));
    close.lastIndex = openRe.lastIndex;
    const c = close.exec(html);
    // Kapanis yok: sonraki ayni adli acilislarin da kapanisi yok -> o ad icin arama biter
    if (!c) {
      closers.set(name, null);
      continue;
    }
    yield { index: m.index, name, open: m[0], inner: html.slice(openRe.lastIndex, c.index), end: c.index + c[0].length };
    openRe.lastIndex = c.index + c[0].length;
  }
}

/** Ilk eslesen elemanin ic HTML'i ya da null */
export function firstInner(html, names) {
  for (const el of elements(html, names)) return el.inner;
  return null;
}

/** Elemanlari (kapanisiyla) metinden cikar — eski `.replace(/<(a|b)\b[\s\S]*?<\/\1>/gi, '')` */
export function removeElements(html, names) {
  let out = '';
  let last = 0;
  for (const el of elements(html, names)) {
    out += html.slice(last, el.index);
    last = el.end;
  }
  return out + html.slice(last);
}

/** JSON-LD bloklari (@graph acilir). En fazla 400 dugum: dev @graph bellek/yigin sorunu olmasin. */
export function jsonLd(html) {
  const out = [];
  const add = (x) => {
    if (x && out.length < 400) out.push(x);
  };
  for (const el of elements(html, 'script')) {
    if (!/^application\/ld\+json$/i.test(String(attr(el.open, 'type') ?? '').trim())) continue;
    try {
      const j = JSON.parse(el.inner.trim());
      for (const x of Array.isArray(j) ? j : [j]) {
        // push(...dev dizi) arguman siniri asinca RangeError verir: tek tek eklenir
        if (x && Array.isArray(x['@graph'])) for (const g of x['@graph']) add(g);
        else add(x);
      }
    } catch {
      /* bozuk JSON-LD yok sayilir */
    }
    if (out.length >= 400) break;
  }
  return out;
}

export const typeOf = (node) => [].concat(node?.['@type'] ?? []).map(String);

/** start konumundaki acilis etiketinin denk kapanisina kadar olan HTML (ayni ad sayilir) */
export function balancedElement(html, start) {
  const open = /^<([a-z0-9]+)/i.exec(html.slice(start));
  if (!open) return null;
  const tag = open[1].toLowerCase();
  const re = new RegExp(`<(/?)${tag}\\b[^<>]{0,${MAX_TAG}}>`, 'gi');
  re.lastIndex = start;
  let depth = 0;
  for (let m; (m = re.exec(html)); ) {
    if (m[0].endsWith('/>')) continue;
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(start, m.index + m[0].length);
  }
  return html.slice(start);
}
