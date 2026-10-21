/**
 * Marka verisi — urunun yapacagi gibi yalniz sitenin herkese acik sayfasindan:
 *   ad    : og:site_name > JSON-LD Organization/WebSite/publisher > <title> son parcasi > alan adi
 *   logo  : apple-touch-icon > SVG ikon > JSON-LD logo > en buyuk PNG ikon > /favicon.ico
 *   renk  : meta theme-color (notr degilse) > CSS degiskeni (adinda primary ya da brand gecen) >
 *           CSS'te en sik gecen doygun renk > logodaki doygun renk > yok (sablon RanksUp turuncusu)
 * Indirilen dosyalar (logo, CSS) guvenilmeyen veridir: kaydedilir, yalniz okunur. Logo videoya
 * data: URI olarak <img> ile girer (SVG icindeki betik/harici kaynak <img> baglaminda calismaz).
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { jsonLd, links, meta, stripTags, typeOf } from './html.mjs';
import { fetchLimited } from './net.mjs';

const IMAGE_TYPES = { 'image/svg+xml': 'svg', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico', 'image/gif': 'gif' };

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
  m = /rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/i.exec(v);
  if (m) return '#' + m.slice(1, 4).map((x) => Math.min(255, Number(x)).toString(16).padStart(2, '0')).join('');
  return null;
}

/** marka rengi sayilabilir mi: yeterince doygun, ne neredeyse beyaz ne neredeyse siyah */
const isBrandish = (hex) => {
  const { s, l } = hexToHsl(hex);
  return s >= 0.35 && l >= 0.18 && l <= 0.82;
};

function colorFromCss(css) {
  const vars = [...css.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)].map((m) => ({ name: m[1].toLowerCase(), hex: normHex(m[2]) })).filter((v) => v.hex && isBrandish(v.hex));
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

export async function extractBrand(html, pageUrl, { saveDir }) {
  const base = new URL(pageUrl);
  const ld = jsonLd(html);
  const org = ld.find((n) => typeOf(n).some((t) => ['Organization', 'Corporation', 'LocalBusiness'].includes(t)));
  const site = ld.find((n) => typeOf(n).includes('WebSite'));
  const art = ld.find((n) => n?.publisher);
  const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const titleTail = titleTag ? stripTags(titleTag[1]).split(/\s[|–—-]\s/).map((s) => s.trim()).filter(Boolean) : [];
  const domain = base.hostname.replace(/^www\./, '');
  const name = meta(html, 'og:site_name') || org?.name || site?.name || art?.publisher?.name || (titleTail.length > 1 ? titleTail[titleTail.length - 1] : null) || domain;
  const notes = [];

  /* logo */
  const ls = links(html).filter((l) => l.href);
  const size = (l) => Math.max(0, ...String(l.sizes ?? '').split(/\s+/).map((s) => Number(s.split('x')[0]) || 0));
  const ldLogo = [org?.logo, art?.publisher?.logo, site?.publisher?.logo].map((x) => (typeof x === 'string' ? x : x?.url)).find(Boolean);
  const candidates = [
    ...ls.filter((l) => l.rel.includes('apple-touch-icon')).sort((a, b) => size(b) - size(a)),
    ...ls.filter((l) => /\bicon\b/.test(l.rel) && (l.type === 'image/svg+xml' || /\.svg(\?|$)/i.test(l.href))),
    ...(ldLogo ? [{ href: ldLogo, rel: 'json-ld' }] : []),
    ...ls.filter((l) => /\bicon\b/.test(l.rel) && !/\.svg(\?|$)/i.test(l.href)).sort((a, b) => size(b) - size(a)),
    { href: '/favicon.ico', rel: 'varsayilan' },
  ];
  let logo = null;
  for (const c of candidates) {
    try {
      const r = await fetchLimited(new URL(c.href, base).href, { maxBytes: 300_000, accept: 'image/*' });
      let type = r.contentType.split(';')[0].trim().toLowerCase();
      const head = r.body.subarray(0, 300).toString('utf8');
      if (!IMAGE_TYPES[type] && /<svg[\s>]/i.test(head)) type = 'image/svg+xml';
      if (!IMAGE_TYPES[type] || r.body.length < 64) continue;
      const file = join(saveDir, `logo.${IMAGE_TYPES[type]}`);
      writeFileSync(file, r.body);
      logo = { url: r.url, rel: c.rel, type, bytes: r.body.length, file, dataUri: `data:${type};base64,${r.body.toString('base64')}` };
      break;
    } catch (e) {
      notes.push(`logo adayi atlandi (${c.href}): ${e.message}`);
    }
  }

  /* renk */
  let color = null;
  const theme = normHex(meta(html, 'theme-color'));
  if (theme && isBrandish(theme)) color = { hex: theme, source: 'meta:theme-color' };
  if (!color) {
    let css = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');
    const sheets = ls.filter((l) => l.rel.includes('stylesheet') && new URL(l.href, base).hostname.endsWith(domain)).slice(0, 2);
    for (const [i, s] of sheets.entries()) {
      try {
        const r = await fetchLimited(new URL(s.href, base).href, { maxBytes: 1_500_000, accept: 'text/css' });
        writeFileSync(join(saveDir, `style-${i}.css`), r.body);
        css += '\n' + r.body.toString('utf8');
      } catch (e) {
        notes.push(`stil dosyasi atlandi (${s.href}): ${e.message}`);
      }
    }
    color = colorFromCss(css);
  }
  if (!color && logo?.type === 'image/svg+xml') {
    const svg = Buffer.from(logo.dataUri.split(',')[1], 'base64').toString('utf8');
    const fills = [...svg.matchAll(/(?:fill|stop-color)\s*=\s*["'](#[0-9a-f]{3,6})["']/gi)].map((m) => normHex(m[1])).filter((h) => h && isBrandish(h));
    if (fills.length) color = { hex: fills[0], source: 'logo-svg' };
  }
  if (!color) notes.push('marka rengi bulunamadi -> sablon RanksUp turuncusuna duser');
  return {
    name: String(name).trim(),
    domain,
    primary: color?.hex ?? null,
    colorSource: color?.source ?? 'yok',
    logo: logo ? { url: logo.url, rel: logo.rel, type: logo.type, bytes: logo.bytes, file: logo.file } : null,
    logoDataUri: logo?.dataUri ?? null,
    notes,
  };
}

