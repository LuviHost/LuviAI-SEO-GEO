import { stripHeroPlaceholder } from './hero-placeholder.js';

export interface QaIssue {
  type: string;      // fabricated_attribution | unsourced_claim | placeholder_image | template_leak | mock_content | empty_section | thin_content | image_alt_empty
  detail: string;    // kullaniciya gosterilen aciklama
  excerpt?: string;  // makaledeki ilgili kesit
}

/**
 * QA kapisinin deterministik katmani — saf fonksiyon (test edilebilsin diye
 * QaGateService'ten ayrildi).
 *
 * Hero yer tutucusu (`![Hero](placeholder-hero.webp)`) ENGEL DEGILDIR: gercek
 * hero yayin aninda publisher'da uretilir ve satir orada silinir. Eskiden bu
 * satir her makaleyi BLOCKED yapiyordu. Diger placeholder gorseller engel kalir.
 */
export function deterministicQaIssues(
  article: { heroImageUrl?: string | null },
  body: string,
): { blockers: QaIssue[]; warnings: QaIssue[] } {
  const blockers: QaIssue[] = [];
  const warnings: QaIssue[] = [];
  const scan = stripHeroPlaceholder(body);

  // Placeholder gorsel — hero alani veya govde ici
  if (article.heroImageUrl && /placeholder/i.test(article.heroImageUrl)) {
    blockers.push({
      type: 'placeholder_image',
      detail: 'Hero görseli hâlâ placeholder — yayında kırık/boş görsel görünür.',
      excerpt: article.heroImageUrl,
    });
  }
  const imgPlaceholders = scan.match(/!\[[^\]]*\]\((?:[^)]*placeholder[^)]*|\s*)\)/gi) ?? [];
  if (imgPlaceholders.length > 0) {
    blockers.push({
      type: 'placeholder_image',
      detail: `${imgPlaceholders.length} görsel placeholder'ı doldurulmamış.`,
      excerpt: imgPlaceholders[0]?.slice(0, 200),
    });
  }

  // Sablon kalintisi
  const templateLeaks = scan.match(/\{\{[^}]{1,60}\}\}|\[(?:GÖRSEL|GORSEL|IMAGE|TODO|PLACEHOLDER)[^\]]{0,60}\]/g) ?? [];
  if (templateLeaks.length > 0) {
    blockers.push({
      type: 'template_leak',
      detail: `Doldurulmamış şablon alanı: ${templateLeaks.slice(0, 3).join(', ')}`,
    });
  }

  // Mock icerik izi (AI_GLOBAL_DISABLED uretimleri yayina cikmasin)
  if (/MOCK ARTICLE|AI_GLOBAL_DISABLED/.test(scan)) {
    blockers.push({
      type: 'mock_content',
      detail: 'Makale mock pipeline çıktısı — gerçek üretim değil, yayınlanamaz.',
    });
  }

  // Alt metni bos gercek gorsel. Uyari (engel degil): Google gorselin konusunu
  // alt metninden de anlar; ekran okuyucu alt'siz gorseli ya atlar ya dosya adini
  // okur. Kaynaklar: Google Search Central "Google Images best practices" +
  // W3C WAI "Informative images". (Bos URL'li ![x]() yukarida placeholder engelidir.)
  const emptyAlt = scan.match(/!\[\s*\]\(\s*[^)\s][^)]*\)/g) ?? [];
  if (emptyAlt.length > 0) {
    warnings.push({
      type: 'image_alt_empty',
      detail: `${emptyAlt.length} görselde alt metni yok — görseli anlatan kısa ve özgül bir açıklama ekle (anahtar kelime doldurma).`,
      excerpt: emptyAlt[0]?.slice(0, 200),
    });
  }

  // Bos bolum: baslik + hemen ardindan baska baslik
  const emptySections = scan.match(/^#{2,3}\s+[^\n]+\n+(?=#{2,3}\s)/gm) ?? [];
  if (emptySections.length > 0) {
    warnings.push({
      type: 'empty_section',
      detail: `${emptySections.length} başlık altında içerik yok.`,
      excerpt: emptySections[0]?.trim().slice(0, 120),
    });
  }

  // Cok kisa govde
  const wordCount = scan.split(/\s+/).filter(Boolean).length;
  if (wordCount > 0 && wordCount < 300) {
    warnings.push({
      type: 'thin_content',
      detail: `Makale yalnızca ${wordCount} kelime — ince içerik AI aramalarında alıntılanmaz.`,
    });
  }

  return { blockers, warnings };
}
