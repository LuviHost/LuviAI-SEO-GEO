import { createHash } from 'node:crypto';
import type { CheerioAPI } from 'cheerio';

/**
 * Sayfadaki <img>'leri tek tek cikarir — saf (cheerio $ alir, ag yok).
 *
 * NEDEN: tarayici yalnizca sayfa basi sayim tutuyordu (total/withAlt/emptyAlt);
 * hangi gorselin alt'siz oldugu, nerede durdugu bilinmiyordu → "alt ekle"
 * onerisi uretilemiyor, sorun sayfaya baglanamiyordu.
 *
 * Alt durumu (W3C WAI "Decorative images" + open-seo):
 *   absent  → alt ATTRIBUTE'u yok: HATA (ekran okuyucu dosya adini okur)
 *   empty   → alt="": suslemeye ait gorsel icin DOGRU isaretleme, hata DEGIL
 *   present → dolu alt; classifyAlt ile suphe isaretleri
 */

export type AltState = 'absent' | 'empty' | 'present';
export type AltFlag = 'filename_like' | 'generic';

export interface ExtractedImage {
  srcRaw: string;
  src: string;
  srcHash: string;
  altState: AltState;
  alt: string | null;
  width: number | null;
  height: number | null;
  linked: boolean;
  linkHref: string | null;
  wpAttachmentId: number | null;
  /** role=presentation|none ya da aria-hidden=true — yazar suslemeye ait dedi */
  ariaDecorative: boolean;
  /** Degerlendirme disi: izleme pikseli, <noscript>, kucuk data URI, kaynaksiz */
  excluded: boolean;
  flags: AltFlag[];
  context: { heading?: string; caption?: string; nearText?: string };
}

export interface ImageAltStats {
  /** Sayfadaki tum <img> (geriye uyum) */
  total: number;
  /** Asagidakiler degerlendirme DISI (excluded) gorseller haric */
  withAlt: number;
  emptyAlt: number;
  /** alt attribute'u yok ve aria ile suslemeye ait denmemis */
  absent: number;
  ariaDecorative: number;
  suspicious: number;
  excluded: number;
}

export const MAX_IMAGES_PER_PAGE = 50;
const ALT_MAX = 300;

/**
 * Supheli alt (WCAG F30: "dosya adi ya da yer tutucu metin alternatif degildir"
 * + WebAIM WAVE "suspicious alternative text"). Iki kaynakta ortak olanlar.
 */
const GENERIC_ALTS = new Set([
  'image', 'picture', 'photo', 'graphic', 'spacer', 'img',
  'resim', 'görsel', 'gorsel', 'fotoğraf', 'fotograf', 'foto', 'imaj', 'grafik',
]);

export function classifyAlt(alt: string): AltFlag[] {
  const a = alt.trim();
  if (!a) return [];
  const flags: AltFlag[] = [];
  if (/^[\w\-. ()]+\.(?:jpe?g|png|gif|webp|avif|svg|bmp|tiff?|heic)$/i.test(a)
    || /^(?:img|dsc|dscn|image|photo|pic|screenshot|screen shot)[-_ ]?\d{2,}/i.test(a)) {
    flags.push('filename_like');
  }
  const norm = a.toLocaleLowerCase('tr').replace(/[^\p{L}\p{N} ]/gu, '').trim();
  if (GENERIC_ALTS.has(norm)) flags.push('generic');
  return flags;
}

function toInt(v: string | undefined): number | null {
  if (!v) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** srcset'in ilk adayi ("a.jpg 300w, b.jpg 600w" → "a.jpg") */
function firstSrcsetUrl(srcset: string | undefined): string | null {
  if (!srcset) return null;
  const first = srcset.split(',')[0]?.trim().split(/\s+/)[0];
  return first || null;
}

function isTinyDataUri(s: string): boolean {
  return s.startsWith('data:') && s.length < 200;
}

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) : t;
}

export function extractImages(
  $: CheerioAPI,
  pageUrl: string,
  opts: { max?: number } = {},
): { images: ExtractedImage[]; stats: ImageAltStats; capped: boolean } {
  const max = opts.max ?? MAX_IMAGES_PER_PAGE;
  const stats: ImageAltStats = { total: 0, withAlt: 0, emptyAlt: 0, absent: 0, ariaDecorative: 0, suspicious: 0, excluded: 0 };
  const images: ExtractedImage[] = [];
  const seen = new Set<string>();
  let capped = false;

  $('img').each((_, el) => {
    stats.total++;
    const $el = $(el);
    const attr = (n: string) => $el.attr(n);

    // Lazy-load: gercek kaynak cogu zaman data-* ya da srcset'te
    const rawSrc = (attr('src') ?? '').trim();
    const lazy = attr('data-src') ?? attr('data-lazy-src') ?? attr('data-original') ?? firstSrcsetUrl(attr('srcset') ?? attr('data-srcset')) ?? '';
    const srcRaw = (!rawSrc || isTinyDataUri(rawSrc)) && lazy ? lazy.trim() : rawSrc;

    const altAttr = attr('alt');
    const altState: AltState = altAttr === undefined ? 'absent' : altAttr.trim() === '' ? 'empty' : 'present';
    const alt = altAttr === undefined ? null : clip(altAttr, ALT_MAX);
    const role = (attr('role') ?? '').toLowerCase();
    const ariaDecorative = role === 'presentation' || role === 'none' || attr('aria-hidden') === 'true';
    const width = toInt(attr('width'));
    const height = toInt(attr('height'));

    const excluded = !srcRaw
      || isTinyDataUri(srcRaw)
      || (width !== null && height !== null && width <= 1 && height <= 1)
      || $el.closest('noscript').length > 0;

    const flags = altState === 'present' && alt ? classifyAlt(alt) : [];

    if (excluded) {
      stats.excluded++;
    } else if (altState === 'present') {
      stats.withAlt++;
      if (flags.length > 0) stats.suspicious++;
    } else if (ariaDecorative) {
      stats.ariaDecorative++;
    } else if (altState === 'empty') {
      stats.emptyAlt++;
    } else {
      stats.absent++;
    }

    if (excluded) return;
    let src = '';
    try { src = new URL(srcRaw, pageUrl).toString(); } catch { src = ''; }
    const key = src || srcRaw;
    if (seen.has(key)) return; // ayni sayfada ayni gorsel (logo vb.) bir kez
    if (images.length >= max) { capped = true; return; }
    seen.add(key);

    const $a = $el.closest('a[href]');
    const linkHref = $a.length ? ($a.attr('href') ?? null) : null;
    const wpMatch = /\bwp-image-(\d+)\b/.exec(attr('class') ?? '');
    const caption = clip($el.closest('figure').find('figcaption').first().text(), 150);

    // En yakin baslik: atalari 5 seviyeye kadar gez, her seviyede onceki kardes basliga bak
    let heading = '';
    let $cur = $el;
    for (let i = 0; i < 5 && !heading && $cur.length; i++) {
      const h = $cur.prevAll('h1,h2,h3').first();
      if (h.length) heading = clip(h.text(), 120);
      $cur = $cur.parent();
    }
    const nearText = clip($el.closest('p, figure, li, div').first().text(), 150);

    images.push({
      srcRaw: clip(srcRaw, 2000),
      src,
      srcHash: createHash('sha1').update(key).digest('hex'),
      altState,
      alt,
      width,
      height,
      linked: $a.length > 0,
      linkHref,
      wpAttachmentId: wpMatch ? parseInt(wpMatch[1], 10) : null,
      ariaDecorative,
      excluded: false,
      flags,
      context: {
        ...(heading ? { heading } : {}),
        ...(caption ? { caption } : {}),
        ...(nearText ? { nearText } : {}),
      },
    });
  });

  return { images, stats, capped };
}
