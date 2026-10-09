/**
 * HTML icinde TEK bir gorselin alt attribute'unu cerrahi olarak degistirir —
 * eslesen <img> etiketi disinda tek bayt degismez (saf, ag yok).
 *
 * NEDEN cheerio ile yeniden yazmiyoruz: DOM kutuphanesi HTML'i yeniden
 * serilestirir (bosluk, attribute sirasi, Gutenberg blok yorumlari, varlik
 * kodlamasi degisir) → WordPress gonderisinde "blok bozuldu" uyarisi ve
 * anlamsiz revizyon farki. Burada yalnizca eslesen etiketin alt degeri
 * degisir. (Gutenberg core/image blogunun alt'i HTML'den okunur — blok
 * dogrulamasini bozmaz.)
 *
 * Eslesme sirasi: wp-image-<id> sinifi → birebir src (srcRaw ya da mutlak
 * src) → dosya taban adi (-300x200 / -scaled ekleri atilarak). Taban adiyla
 * FARKLI kaynaklara eslesirse BELIRSIZ sayilir ve hicbir sey yazilmaz.
 */

export interface ImgAltTarget {
  /** Sayfadaki yazimiyla src */
  srcRaw: string;
  /** Mutlak src */
  src?: string;
  wpAttachmentId?: number | null;
}

export type PatchReason = 'not_found' | 'ambiguous' | 'unchanged' | 'expect_mismatch';

export interface PatchResult {
  html: string;
  changed: boolean;
  /** Degisen etiket sayisi */
  matched: number;
  /** Ilk eslesen etiketin onceki alt'i (attribute yoksa null) */
  oldAlt: string | null;
  reason?: PatchReason;
}

// Tirnak icindeki '>' etiketi bitirmesin
const IMG_TAG = /<img\b(?:[^>"']|"[^"]*"|'[^']*')*\/?>/gi;

function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"').replace(/&#0*39;/g, "'").replace(/&#x0*27;/gi, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

export function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

interface AttrHit { value: string; start: number; end: number }

/** Etiket icinde bir attribute'u bulur (cift/tek tirnak, tirnaksiz ya da degersiz) */
function findAttr(tag: string, name: string): AttrHit | null {
  const re = new RegExp(`\\s${name}(?:\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\`]+)))?(?=[\\s/>])`, 'i');
  const m = re.exec(tag);
  if (!m) return null;
  return { value: decodeEntities(m[1] ?? m[2] ?? m[3] ?? ''), start: m.index, end: m.index + m[0].length };
}

/** Etiketin alt degeri (varlik kodlari cozulmus); attribute yoksa null */
export function readAlt(tag: string): string | null {
  const hit = findAttr(tag, 'alt');
  return hit ? hit.value : null;
}

function effectiveSrc(tag: string): string {
  const src = findAttr(tag, 'src')?.value ?? '';
  if (src && !src.startsWith('data:')) return src;
  const lazy = findAttr(tag, 'data-src') ?? findAttr(tag, 'data-lazy-src') ?? findAttr(tag, 'data-original');
  if (lazy?.value) return lazy.value;
  const srcset = findAttr(tag, 'srcset')?.value ?? findAttr(tag, 'data-srcset')?.value ?? '';
  return srcset.split(',')[0]?.trim().split(/\s+/)[0] ?? src;
}

function baseName(url: string): string {
  const path = url.split(/[?#]/)[0];
  const last = path.split('/').filter(Boolean).pop() ?? '';
  return last.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/-(?:\d+x\d+|scaled)$/i, '').replace(/-(?:\d+x\d+|scaled)$/i, '').toLowerCase();
}

function sameUrl(a: string, b: string | undefined, origin: string | null): boolean {
  if (!b) return false;
  if (a === b) return true;
  if (!origin) return false;
  try { return new URL(a, origin).toString() === new URL(b).toString(); } catch { return false; }
}

interface TagHit { start: number; end: number; tag: string; src: string }

export function findImgTags(html: string, target: ImgAltTarget): { hits: TagHit[]; ambiguous: boolean } {
  const all: TagHit[] = [];
  for (const m of html.matchAll(IMG_TAG)) {
    all.push({ start: m.index!, end: m.index! + m[0].length, tag: m[0], src: effectiveSrc(m[0]) });
  }

  if (target.wpAttachmentId) {
    const re = new RegExp(`(?:^|\\s)wp-image-${target.wpAttachmentId}(?:\\s|$)`);
    const byId = all.filter((t) => re.test(findAttr(t.tag, 'class')?.value ?? ''));
    if (byId.length > 0) return { hits: byId, ambiguous: false };
  }

  let origin: string | null = null;
  try { origin = target.src ? new URL(target.src).origin : null; } catch { origin = null; }
  const exact = all.filter((t) => t.src && (t.src === target.srcRaw || sameUrl(t.src, target.src, origin)));
  if (exact.length > 0) return { hits: exact, ambiguous: false };

  const want = baseName(target.src || target.srcRaw);
  if (!want) return { hits: [], ambiguous: false };
  const byBase = all.filter((t) => t.src && baseName(t.src) === want);
  const distinct = new Set(byBase.map((t) => t.src));
  if (distinct.size > 1) return { hits: [], ambiguous: true };
  return { hits: byBase, ambiguous: false };
}

/**
 * newAlt === null → alt attribute'u KALDIRILIR (geri alma: gorselin basta hic
 * alt'i yoktu; alt="" yazmak "suslemeye ait" beyani olurdu — anlam degisir).
 */
export function patchImgAlt(
  html: string,
  target: ImgAltTarget,
  newAlt: string | null,
  opts: { expectCurrentAlt?: string } = {},
): PatchResult {
  const { hits, ambiguous } = findImgTags(html, target);
  if (ambiguous) return { html, changed: false, matched: 0, oldAlt: null, reason: 'ambiguous' };
  if (hits.length === 0) return { html, changed: false, matched: 0, oldAlt: null, reason: 'not_found' };

  const firstAlt = findAttr(hits[0].tag, 'alt');
  const oldAlt = firstAlt ? firstAlt.value : null;
  const escaped = newAlt === null ? '' : escapeAttr(newAlt);
  let out = html;
  let matched = 0;
  let skippedExpect = 0;

  // Sondan basa: onceki ofsetler kaymasin
  for (const h of [...hits].sort((a, b) => b.start - a.start)) {
    const cur = findAttr(h.tag, 'alt');
    if (opts.expectCurrentAlt !== undefined && (cur?.value ?? '').trim() !== opts.expectCurrentAlt.trim()) {
      skippedExpect++;
      continue;
    }
    if (newAlt === null ? !cur : (cur && cur.value === newAlt)) continue;
    const newTag = newAlt === null
      ? h.tag.slice(0, cur!.start) + h.tag.slice(cur!.end)
      : cur
        ? h.tag.slice(0, cur.start) + ` alt="${escaped}"` + h.tag.slice(cur.end)
        : h.tag.replace(/^<img\b/i, (s) => `${s} alt="${escaped}"`);
    out = out.slice(0, h.start) + newTag + out.slice(h.end);
    matched++;
  }

  if (matched === 0) {
    return { html, changed: false, matched: 0, oldAlt, reason: skippedExpect > 0 ? 'expect_mismatch' : 'unchanged' };
  }
  return { html: out, changed: true, matched, oldAlt };
}
