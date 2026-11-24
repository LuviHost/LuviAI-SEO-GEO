/**
 * Site haritasi Search Console'a son gonderimden sonra degisti mi? (saf; ag yok)
 *
 * NEDEN (24.11.2026): kobipratik.com'un on yuzu Windows sunucusundan yayinlaniyor;
 * Search Console anahtari RanksUp sunucusunda. Anahtari o sunucuya tasimak yerine
 * RanksUp sunucusu site haritasini saatte bir okur, en yeni <lastmod> Search
 * Console'daki son gonderimden (sitemaps.get lastSubmitted) yeniyse gonderir.
 * Durum dosyasi yok: karsilastirma Google'in kendi kaydiyla yapilir.
 *
 * Sinir: lastmod cogu sitede yalniz gun (2026-11-25); ayni gun ikinci yayin,
 * gonderimden sonraki bir degisiklik olarak gorulmez.
 */

/** <lastmod> degerleri arasindan en yenisi (ayristirilamayanlar atlanir); yoksa null */
export function newestLastmod(xml: string): Date | null {
  let best: number | null = null;
  for (const m of xml.matchAll(/<lastmod>\s*([^<\s]+)\s*<\/lastmod>/gi)) {
    const t = Date.parse(m[1]);
    if (Number.isFinite(t) && (best === null || t > best)) best = t;
  }
  return best === null ? null : new Date(best);
}

/** Site haritasi dizini (sitemapindex) ise alt site haritalarinin adresleri */
export function childSitemaps(xml: string, max = 20): string[] {
  if (!/<sitemapindex[\s>]/i.test(xml)) return [];
  const out: string[] = [];
  for (const m of xml.matchAll(/<sitemap>[\s\S]*?<loc>\s*([^<\s]+)\s*<\/loc>[\s\S]*?<\/sitemap>/gi)) {
    if (out.length >= max) break;
    out.push(m[1].replace(/&amp;/g, '&'));
  }
  return out;
}

export type SubmitKarari = { gonder: boolean; neden: string };

/**
 * Gonderilmeli mi? Hic gonderilmemisse evet; site haritasinda tarih yoksa
 * (degisim olculemez) hayir; en yeni lastmod son gonderimden sonraysa evet.
 */
export function submitKarari(newest: Date | null, lastSubmitted: string | Date | null | undefined): SubmitKarari {
  const son = lastSubmitted ? new Date(lastSubmitted) : null;
  if (!son || !Number.isFinite(son.getTime())) return { gonder: true, neden: 'Search Console\'da daha önce gönderilmemiş' };
  if (!newest) return { gonder: false, neden: 'site haritasında tarih (lastmod) yok, değişiklik ölçülemiyor' };
  if (newest.getTime() > son.getTime()) {
    return { gonder: true, neden: `en yeni değişiklik ${newest.toISOString().slice(0, 10)}, son gönderim ${son.toISOString().slice(0, 16)}` };
  }
  return { gonder: false, neden: `son gönderimden (${son.toISOString().slice(0, 16)}) sonra değişiklik yok` };
}
