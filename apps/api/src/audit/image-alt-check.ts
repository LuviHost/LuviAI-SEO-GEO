import type { AuditIssue, CheckResult } from './audit-checks.service.js';
import type { CrawledPage } from '../sites/site-crawler.service.js';

/**
 * Kontrol #12 — Gorsel alt metni, yontem v2 (saf).
 *
 * v1 kapsamayi withAlt/total olarak olcuyordu → suslemeye ait gorsele dogru
 * isaretleme olan alt="" de PUAN KIRIYORDU. v2 (W3C WAI "Decorative images" +
 * open-seo: yalnizca alt attribute'u HIC OLMAYAN gorsel sorundur):
 *   - sorun   : alt attribute'u yok (absent), aria ile suslemeye ait denmemis
 *   - sorun degil: alt="" (suslemeye ait), aria-hidden/role=presentation
 *   - bilgi   : dosya adi / "resim" gibi supheli alt (WCAG F30 + WebAIM WAVE)
 *   - disarida: izleme pikseli, <noscript>, kucuk data URI
 * Skor = 100 × (1 − alt'siz / degerlendirilen icerik gorseli).
 */
export const IMAGE_ALT_METHOD_VERSION = 2;
const MAX_LISTED_PAGES = 50;

type PageLike = Pick<CrawledPage, 'url'> & Partial<Pick<CrawledPage, 'imageAltStats' | 'images' | 'imagesCapped'>>;

export function computeImageAltCheck(pages: PageLike[]): CheckResult {
  let total = 0, withAlt = 0, emptyAlt = 0, absent = 0, ariaDecorative = 0, suspicious = 0, excluded = 0;
  let pagesScanned = 0;
  let capped = false;
  const missingAltPages: string[] = [];
  const suspiciousPages: string[] = [];

  for (const p of pages) {
    const s = p.imageAltStats;
    if (!s) continue;
    pagesScanned++;
    total += s.total ?? 0;
    withAlt += s.withAlt ?? 0;
    emptyAlt += s.emptyAlt ?? 0;
    absent += s.absent ?? 0;
    ariaDecorative += s.ariaDecorative ?? 0;
    suspicious += s.suspicious ?? 0;
    excluded += s.excluded ?? 0;
    if (p.imagesCapped) capped = true;
    if ((s.absent ?? 0) > 0 && missingAltPages.length < MAX_LISTED_PAGES) missingAltPages.push(p.url);
    if ((s.suspicious ?? 0) > 0 && suspiciousPages.length < MAX_LISTED_PAGES) suspiciousPages.push(p.url);
  }

  const contentImages = withAlt + emptyAlt + absent + ariaDecorative;
  const details = {
    methodVersion: IMAGE_ALT_METHOD_VERSION,
    totalImages: total,
    contentImages,
    withAlt,
    emptyAlt,
    absent,
    ariaDecorative,
    suspicious,
    excluded,
    pagesScanned,
    missingAltPages,
    suspiciousPages,
    capped,
  };

  if (contentImages === 0) {
    return { id: 'image_alt', name: 'Image alt text', found: true, valid: true, score: 100, issues: [], details };
  }

  const score = Math.round(100 * (1 - absent / contentImages));
  const issues: AuditIssue[] = [];
  if (absent > 0) {
    issues.push({
      severity: absent > contentImages * 0.5 ? 'warning' : 'info',
      type: 'image_alt_missing',
      description: `${absent} görselde alt metni yok (${missingAltPages.length}${missingAltPages.length >= MAX_LISTED_PAGES ? '+' : ''} sayfada). Google görselin konusunu alt metninden de anlar; görseli anlatan kısa, özgül bir açıklama ekle — anahtar kelime doldurma. Süs görselleri için alt="" doğrudur.`,
      fixable: false,
    });
  }
  if (suspicious > 0) {
    issues.push({
      severity: 'info',
      type: 'image_alt_suspicious',
      description: `${suspicious} görselin alt metni dosya adı ya da "resim/görsel" gibi genel bir kelime — görseli anlatmıyor.`,
      fixable: false,
    });
  }

  return {
    id: 'image_alt',
    name: 'Image alt text',
    found: withAlt > 0,
    valid: score >= 90,
    score,
    issues,
    details,
  };
}
