/**
 * Firmanin KENDI sitesini gezme yardimcilari — 03-desen ve 07-kurumsal-adres ortak kullanir.
 * Arama motoru / ucuncu taraf site YOK (KVKK 2022/861); yalniz firmanin alan adi.
 */
import dns from 'node:dns/promises';
import * as cheerio from 'cheerio';
import { fetchText, jitter, normalizeDomain, sleep, translit } from './prospect-utils.js';

/** Firmanin kendi sitesinde bakilacak sayfalar — once bunlar, sonra nav kesfi */
export const CONTACT_PATHS = ['/iletisim', '/contact', '/bize-ulasin', '/basin', '/basin-odasi', '/press', '/yatirimci-iliskileri', '/investor-relations'];

/** Alan adi tahmininde firma adindan atilan hukuki/genel kelimeler */
export const HUKUKI = /\b(a s|as|t a s|tas|anonim|sirketi|sirket|ltd|sti|limited|holding|ve|tic|san|sanayi|ticaret|hizmetleri|hizmet|grubu|group|turkiye|türkiye)\b/g;

/** Ana sayfa nav'indan iletisim benzeri ic linkler (butce kalirsa) */
export function navLinkleri(html: string, base: string): string[] {
  const $ = cheerio.load(html);
  const out = new Set<string>();
  $('a[href]').each((_, a) => {
    const href = $(a).attr('href') ?? '';
    const text = translit($(a).text());
    if (!/iletisim|contact|basin|press|yatirimci|investor|ulasin/.test(translit(href) + ' ' + text)) return;
    try {
      const u = new URL(href, base);
      if (normalizeDomain(u.hostname) === normalizeDomain(base)) out.add(u.origin + u.pathname);
    } catch { /* gecersiz href */ }
  });
  return [...out];
}

export async function mxVar(domain: string): Promise<boolean> {
  try { return (await dns.resolveMx(domain)).some((m) => m.exchange && m.exchange !== '.'); } catch { return false; }
}

/**
 * Web'i bos firma icin tek tahmin: <cekirdek>.com.tr / <cekirdek>.com.
 * Kabul sarti: alan adinin MX'i var VE sayfa basligi cekirdek adin tamamini
 * (ya da en az 2 kelimesini) iceriyor — "Anadolu", "Global" gibi tek kelime
 * eslesmesiyle yanlis siteye gitmemek icin.
 */
export async function alanAdiTahmin(firma: string): Promise<{ web: string | null; not: string }> {
  const cekirdek = translit(firma).replace(HUKUKI, ' ').replace(/\s+/g, ' ').trim();
  const tokens = cekirdek.split(' ').filter((t) => t.length >= 3);
  const slug = cekirdek.replace(/\s+/g, '');
  if (slug.length < 4 || tokens.length === 0) return { web: null, not: 'cekirdek ad cok kisa' };
  for (const d of [`${slug}.com.tr`, `${slug}.com`]) {
    if (!(await mxVar(d))) continue;
    try {
      const html = await fetchText(`https://${d}`, { timeoutMs: 10_000 });
      const title = translit(cheerio.load(html)('title').first().text());
      const tam = title.includes(cekirdek) || title.includes(slug);
      const ikiKelime = tokens.filter((t) => title.includes(t)).length >= Math.min(2, tokens.length);
      if (tam || (tokens.length >= 2 && ikiKelime)) return { web: d, not: 'baslik eslesti' };
    } catch { /* yok */ }
    await sleep(jitter(300, 800));
  }
  return { web: null, not: 'tahmin dogrulanamadi' };
}
