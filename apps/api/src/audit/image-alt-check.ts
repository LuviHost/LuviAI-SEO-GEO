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
/** "Asagidaki gorseller tembel yuklenmiyor" bilgisi icin ilk ucten sonraki en az gorsel sayisi */
export const LATER_EAGER_MIN = 8;

type PageLike = Pick<CrawledPage, 'url'> & Partial<Pick<CrawledPage, 'imageAltStats' | 'images' | 'imagesCapped'>>;

export function computeImageAltCheck(pages: PageLike[]): CheckResult {
  let total = 0, withAlt = 0, emptyAlt = 0, absent = 0, ariaDecorative = 0, suspicious = 0, excluded = 0;
  let pagesScanned = 0;
  let noDimensions = 0, dimensionsMeasured = 0;
  const noDimensionsPages: string[] = [];
  // Ust gorsel tembel yukleme (24.11.2026; eski taramalarda alan yok → null)
  let earlyLazy = 0, lazyMeasured = 0, laterEagerPageCount = 0;
  const earlyLazyPages: string[] = [];
  const laterEagerPages: string[] = [];
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
    if (typeof s.noDimensions === 'number') {
      dimensionsMeasured++;
      noDimensions += s.noDimensions;
      if (s.noDimensions > 0 && noDimensionsPages.length < MAX_LISTED_PAGES) noDimensionsPages.push(p.url);
    }
    if (typeof s.earlyLazy === 'number') {
      lazyMeasured++;
      earlyLazy += s.earlyLazy;
      if (s.earlyLazy > 0 && earlyLazyPages.length < MAX_LISTED_PAGES) earlyLazyPages.push(p.url);
      // Yalniz sayfada ilk ucten sonra en az LATER_EAGER_MIN gorsel varsa ve HICBIRI tembel degilse
      if ((s.laterImages ?? 0) >= LATER_EAGER_MIN && (s.laterEager ?? 0) === (s.laterImages ?? 0)) {
        laterEagerPageCount++;
        if (laterEagerPages.length < MAX_LISTED_PAGES) laterEagerPages.push(p.url);
      }
    }
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
    // Eski taramalarda (alan yok) olculmedi: null; sayi uydurulmaz
    noDimensions: dimensionsMeasured > 0 ? noDimensions : null,
    noDimensionsPages,
    earlyLazy: lazyMeasured > 0 ? earlyLazy : null,
    earlyLazyPages,
    laterEagerPageCount: lazyMeasured > 0 ? laterEagerPageCount : null,
    laterEagerPages,
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

  if (noDimensions > 0) {
    issues.push({
      severity: 'info',
      type: 'image_dimensions_missing',
      description: `${noDimensions} görselin HTML'de genişlik ve yüksekliği yok (${noDimensionsPages.length}${noDimensionsPages.length >= MAX_LISTED_PAGES ? '+' : ''} sayfada). Boyutu bilinmeyen görsel yüklenince alttaki içeriği kaydırır; <img> etiketine width ve height ekle (CSS'te boyut verildiyse gerek yok).`,
      fixable: false,
    });
  }

  if (earlyLazy > 0) {
    issues.push({
      severity: 'info',
      type: 'image_early_lazy',
      description: `${earlyLazyPages.length}${earlyLazyPages.length >= MAX_LISTED_PAGES ? '+' : ''} sayfada ilk görsellerden ${earlyLazy} tanesi loading="lazy" ile tembel yükleniyor. Sayfanın üstündeki görsel (çoğu zaman en büyük içerik öğesi, LCP) tembel yüklenirse tarayıcı onu geç ister ve sayfa geç dolar; üstteki görselden loading="lazy"yi kaldır. Görsel ekranın altındaysa değişiklik gerekmez.`,
      fixable: false,
    });
  }
  if (laterEagerPageCount > 0) {
    issues.push({
      severity: 'info',
      type: 'image_lazy_missing',
      description: `${laterEagerPageCount} sayfada ilk üçten sonraki ${LATER_EAGER_MIN} ya da daha çok görselin hiçbiri tembel yüklenmiyor. Ekranın altındaki görsellere loading="lazy" eklemek ilk açılışı hafifletir; üstteki görsellere ekleme.`,
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
