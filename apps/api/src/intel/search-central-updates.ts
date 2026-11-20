import { load } from 'cheerio';
import type { RawItem } from './collector.service.js';

/**
 * Google Search Central BELGE DEGISIKLIK GUNLUGU — developers.google.com/search/updates
 *
 * NEDEN AYRI KAYNAK (20.11.2026): Search Central blogu (google-search-central)
 * buyuk duyurulari verir; ama belge degisiklikleri yalniz bu gunluge yazilir.
 * "FAQ zengin sonucu 7 Mayis 2026'da kaldirildi" (8 Mayis kaydi) ve "llms.txt
 * hakkinda aciklama" blogda hic gecmedi — defter bunu ancak 6 ay sonra bir
 * R10 forum aktarimindan, yanlis tarihle ogrendi.
 *
 * NEDEN OZEL AYRISTIRICI:
 * - Her kaydin <link>'i ayin capasi (#may-2026): ayni aydaki tum kayitlar
 *   ayni adresi tasir ve kaydin kendi capasi basliktan turetilemiyor
 *   ("Removing documentation for the FAQ rich result feature" → #removing-faq-rich-result).
 *   Adrese kaydin tarihi eklenir; parmak izi (adres + baslik) ayni basligin
 *   farkli tarihte tekrar gelmesinde (orn. "Updated the favicon documentation")
 *   eskisiyle cakisip sessizce dusmesin.
 * - Kaydin TAMAMI <description>'daki "What / Why" metnidir. Analist adresi
 *   acarsa 390 KB'lik sayfanin basini okur, bu kaydi degil — o yuzden metin
 *   toplama aninda fullText olarak saklanir (X postlarindaki kalip).
 * - Metnin basina kaynak ve tarih yazilir: analist resmi kaynak oldugunu ve
 *   degisikligin tarihini bilmeli; ayrica kisa kayitlar ("Deprecating the FAQ
 *   rich result feature", 191 karakter) 200 karakter esiginde elenmesin.
 */
export const SEARCH_CENTRAL_UPDATES_FEED =
  'https://developers.google.com/search/updates/search_docs_updates.rss';

export function isSearchCentralUpdatesFeed(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname === 'developers.google.com' && u.pathname === '/search/updates/search_docs_updates.rss';
  } catch {
    return false;
  }
}

/** Aciklama HTML'i → duz metin; baglantilarin adresi korunur (hangi belge degisti) */
function descriptionToText(html: string): string {
  const $ = load(`<div id="k">${html}</div>`);
  $('#k a[href]').each((_, a) => {
    const $a = $(a);
    const href = $a.attr('href') ?? '';
    const label = $a.text().replace(/\s+/g, ' ').trim();
    $a.replaceWith(href && /^https?:\/\//.test(href) ? `${label} (${href})` : label);
  });
  $('#k p').each((_, p) => {
    $(p).append('\n');
  });
  return $('#k')
    .text()
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

export function parseSearchCentralUpdates(xml: string): RawItem[] {
  const $ = load(xml, { xml: true });
  const out: RawItem[] = [];

  $('item').each((_, el) => {
    const $el = $(el);
    const title = $el.find('title').first().text().replace(/\s+/g, ' ').trim();
    const link = $el.find('link').first().text().trim();
    const body = descriptionToText($el.find('description').first().text());
    const date = new Date($el.find('pubDate').first().text().trim());
    if (!title || !link || !body || Number.isNaN(date.getTime())) return;

    const ymd = date.toISOString().slice(0, 10);
    const [base, hash] = link.split('#');
    const url = `${base}?tarih=${ymd}${hash ? `#${hash}` : ''}`;

    out.push({
      url,
      title,
      author: 'Google Search Central',
      publishedAt: date,
      summary: body,
      fullText: [
        `Google Search Central belge degisiklik gunlugu (resmi kaynak) — ${ymd}`,
        title,
        body,
      ].join('\n'),
      meta: { guid: $el.find('guid').first().text().trim() || null },
    });
  });

  return out;
}
