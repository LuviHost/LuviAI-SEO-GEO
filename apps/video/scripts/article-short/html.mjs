/**
 * Bagimliliksiz, hosgorulu HTML yardimcilari (prototip). Uretimde worker'daki cheerio
 * kullanilir (apps/worker zaten bagimli); cikti semasi ayni kalir.
 */

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', ndash: '–', mdash: '—', laquo: '«', raquo: '»', middot: '·' };

export function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

export const stripTags = (s) => decode(s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

export function attr(tag, name) {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? decode(m[2] ?? m[3] ?? m[4] ?? '') : null;
}

/** <meta property|name="key" content="..."> */
export function meta(html, key) {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const t = m[0];
    const k = (attr(t, 'property') ?? attr(t, 'name') ?? '').toLowerCase();
    if (k === key.toLowerCase()) return attr(t, 'content');
  }
  return null;
}

export function links(html) {
  return [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => ({ rel: (attr(m[0], 'rel') ?? '').toLowerCase(), href: attr(m[0], 'href'), sizes: attr(m[0], 'sizes'), type: attr(m[0], 'type') }));
}

/** JSON-LD bloklari (@graph acilir) */
export function jsonLd(html) {
  const out = [];
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const j = JSON.parse(m[1].trim());
      for (const x of Array.isArray(j) ? j : [j]) {
        if (x && Array.isArray(x['@graph'])) out.push(...x['@graph']);
        else if (x) out.push(x);
      }
    } catch {
      /* bozuk JSON-LD yok sayilir */
    }
  }
  return out;
}

export const typeOf = (node) => [].concat(node?.['@type'] ?? []).map(String);

/** start konumundaki acilis etiketinin denk kapanisina kadar olan HTML (ayni ad sayilir) */
export function balancedElement(html, start) {
  const open = /^<([a-z0-9]+)/i.exec(html.slice(start));
  if (!open) return null;
  const tag = open[1].toLowerCase();
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  re.lastIndex = start;
  let depth = 0;
  for (let m; (m = re.exec(html)); ) {
    if (m[0].endsWith('/>')) continue;
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(start, m.index + m[0].length);
  }
  return html.slice(start);
}
