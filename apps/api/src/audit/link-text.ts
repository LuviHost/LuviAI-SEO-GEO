/**
 * ACIKLAYICI OLMAYAN BAGLANTI METNI — saf (I/O yok).
 *
 * Kaynak (25.11.2026'da okundu):
 *  - Google, "Link best practices" (developers.google.com/search/docs/crawling-indexing/links-crawlable):
 *    iyi baglanti metni aciklayici, kisa ve iki sayfayla da ilgilidir; Google
 *    bu metni hem kullanicinin hem kendisinin hedef sayfayi anlamasi icin okur.
 *  - Lighthouse SEO denetimi "Links do not have descriptive text"
 *    (github.com/GoogleChrome/lighthouse core/audits/seo/link-text.js): ayni
 *    kural. Liste oradaki Ingilizce liste ile birebir; Lighthouse'ta Turkce
 *    liste YOK — Turkce satirlar o Ingilizce ifadelerin dogrudan karsiligidir
 *    (click here → buraya tıklayın, read more → devamını oku, more → daha fazla ...).
 *    Ifade eklerken Ingilizce listede karsiligi olmayan bir kelime eklenmez.
 *
 * Lighthouse ile ayni: metin kirpilir ve kucuk harfe cevrilir, BIREBIR
 * eslesme aranir ("Devamını oku: Kredi notu nedir?" aciklayicidir, isaretlenmez).
 * Bos metin (yalniz gorselli baglanti) isaretlenmez; rel=nofollow, javascript:,
 * mailto:, tel: ve ayni sayfa (#) baglantilari atlanir.
 * Bizim eklememiz: sondaki ok / uc nokta isaretleri ("Devamı »", "Read more →")
 * karsilastirmadan once atilir — ayni ifadedir.
 */

const INGILIZCE = [
  'click here', 'click this', 'go', 'here', 'information', 'learn more', 'more', 'more info',
  'more information', 'right here', 'read more', 'see more', 'start', 'this',
];

const TURKCE = [
  // click here / click this / right here
  'buraya tıklayın', 'buraya tıkla', 'buraya tıklayınız', 'tıklayın', 'tıkla', 'tıklayınız', 'buna tıklayın', 'tam burada',
  // here
  'burada', 'buraya', 'burası',
  // read more
  'devamı', 'devamını oku', 'devamını okuyun', 'devamını gör',
  // more / see more
  'daha fazla', 'daha fazlası', 'daha fazlasını gör', 'fazlası',
  // more info / more information / learn more / information
  'daha fazla bilgi', 'daha fazla bilgi al', 'detaylı bilgi', 'bilgi', 'daha fazlasını öğrenin', 'daha fazlasını öğren',
  // start / this ("go" → "git" BILEREK yok: Ingilizce sitede "Git" yazilim adidir)
  'başla', 'bu',
];

export const GENERIC_LINK_TEXTS: ReadonlySet<string> = new Set([...INGILIZCE, ...TURKCE]);

/**
 * Karsilastirma bicimi: bosluklar teklenir, kenar ok / nokta isaretleri atilir,
 * kucuk harf. Iki bicim doner: Turkce kucuk harf ("TIKLAYIN" → "tıklayın") ve
 * genel kucuk harf ("CLICK HERE" → "click here"; Turkce kuralla "clıck" olurdu).
 */
export function normalizeLinkText(text: string): string[] {
  const t = text.replace(/\s+/g, ' ').replace(/^[\s»›→>…·.:-]+|[\s»›→>…·.:-]+$/g, '');
  return [...new Set([t.toLocaleLowerCase('tr'), t.toLowerCase()])];
}

/** Bu baglanti metni denetime girer mi (Lighthouse'un atladiklari atlanir) */
export function linkTextApplies(href: string, rel: string | undefined): boolean {
  const h = href.trim().toLowerCase();
  if (!h || h.startsWith('#')) return false;
  if (/^(javascript|mailto|tel):/.test(h)) return false;
  if ((rel ?? '').toLowerCase().includes('nofollow')) return false;
  return true;
}

/** Metin aciklayici degil mi (listede birebir var mi). Bos metin false. */
export function isGenericLinkText(text: string): boolean {
  return normalizeLinkText(text).some((n) => n !== '' && GENERIC_LINK_TEXTS.has(n));
}
