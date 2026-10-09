import type { ExtractedImage } from '../../sites/image-extract.js';

/**
 * Tarama sayfalarindan SiteImage adaylarini cikarir — saf.
 *
 * Aday = duzeltilmesi gereken gorsel; denetim kontroluyle (image-alt-check.ts)
 * AYNI tanim:
 *   - alt attribute'u yok ve aria ile suslemeye ait denmemis (absent)
 *   - alt var ama dosya adi / "resim" gibi supheli (suspicious)
 * alt="" (suslemeye ait) aday DEGIL.
 *
 * Ayni gorsel (srcHash) birden cok sayfada gecebilir (sablon gorselleri): tek
 * kayit, en kotu durum (absent > suspicious) ve sayfa sayisi tutulur.
 */

export const SITE_IMAGE_CAP = 1000;
const MAX_SAMPLE_PAGES = 5;

export type CandidateReason = 'absent' | 'suspicious';

export interface InventoryCandidate {
  srcHash: string;
  src: string;
  srcRaw: string;
  firstPageUrl: string;
  pageCount: number;
  samplePages: string[];
  reason: CandidateReason;
  altState: ExtractedImage['altState'];
  currentAlt: string | null;
  flags: string[];
  linked: boolean;
  linkHref: string | null;
  width: number | null;
  height: number | null;
  wpAttachmentId: number | null;
  pageLang: string | null;
  context: ExtractedImage['context'];
}

type PageLike = { url: string; lang?: string | null; images?: ExtractedImage[] };

function reasonOf(img: ExtractedImage): CandidateReason | null {
  if (img.altState === 'absent' && !img.ariaDecorative) return 'absent';
  if (img.altState === 'present' && img.flags.length > 0) return 'suspicious';
  return null;
}

/**
 * Adaylar (oncelik: absent > suspicious, sonra cok sayfada gecen once; `cap`
 * ile kesilir) + artik IYI alt'i olan gorseller (mevcut kayitlarin durumunu
 * guncellemek icin: APPLIED → VERIFIED).
 */
export function collectCandidates(
  pages: PageLike[],
  cap = SITE_IMAGE_CAP,
): { candidates: InventoryCandidate[]; good: Map<string, string>; capped: boolean } {
  const byHash = new Map<string, InventoryCandidate>();
  const good = new Map<string, string>();

  for (const p of pages) {
    for (const img of p.images ?? []) {
      const reason = reasonOf(img);
      if (!reason) {
        if (img.altState === 'present' && img.alt && !byHash.has(img.srcHash)) good.set(img.srcHash, img.alt);
        continue;
      }
      good.delete(img.srcHash); // bir sayfada bile sorunluysa "iyi" sayilmaz
      const cur = byHash.get(img.srcHash);
      if (cur) {
        cur.pageCount++;
        if (cur.samplePages.length < MAX_SAMPLE_PAGES && !cur.samplePages.includes(p.url)) cur.samplePages.push(p.url);
        if (reason === 'absent' && cur.reason !== 'absent') {
          Object.assign(cur, { reason, altState: img.altState, currentAlt: img.alt, flags: img.flags });
        }
        continue;
      }
      byHash.set(img.srcHash, {
        srcHash: img.srcHash,
        src: img.src,
        srcRaw: img.srcRaw,
        firstPageUrl: p.url,
        pageCount: 1,
        samplePages: [p.url],
        reason,
        altState: img.altState,
        currentAlt: img.alt,
        flags: img.flags,
        linked: img.linked,
        linkHref: img.linkHref,
        width: img.width,
        height: img.height,
        wpAttachmentId: img.wpAttachmentId,
        pageLang: p.lang ?? null,
        context: img.context,
      });
    }
  }

  const all = [...byHash.values()].sort((a, b) =>
    (a.reason === b.reason ? 0 : a.reason === 'absent' ? -1 : 1) || b.pageCount - a.pageCount);
  return { candidates: all.slice(0, Math.max(0, cap)), good, capped: all.length > cap };
}

/**
 * Mevcut kaydin yeni taramadaki durumu.
 *  - Aday olarak tekrar goruldu: VERIFIED idiyse NEW'e doner (geriledi); diger
 *    durumlar (oneri/onay/uygulama) KORUNUR — kullanicinin isi silinmez.
 *  - Iyi alt'la goruldu: APPLIED → VERIFIED; digerleri degismez.
 */
export function nextStatus(prev: string, seenAs: 'candidate' | 'good'): string {
  if (seenAs === 'candidate') return prev === 'VERIFIED' ? 'NEW' : prev;
  return prev === 'APPLIED' ? 'VERIFIED' : prev;
}
