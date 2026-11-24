import { createHash, randomBytes } from 'node:crypto';
import { urlHostMatches } from './host-match.js';

/**
 * Yayin sonrasi site haritasi tetigi — saf yardimcilar (sitemap-kanca.controller.ts).
 *
 * NEDEN (24.11.2026): kobipratik.com'un on yuzu Windows sunucusundan yayinlaniyor;
 * Search Console anahtari RanksUp sunucusunda. Yayin betigi (deploy-frontend.ps1)
 * sonunda POST /api/hooks/sitemap'e site basina TEK AMACLI bir anahtarla istek atar;
 * RanksUp gonderimi kendi Search Console baglantisiyla yapar. Anahtar sizsa bile
 * yalniz o sitenin site haritasini (dakikalar arayla) yeniden gondertebilir.
 * DB'de yalniz SHA-256 ozeti tutulur (Site.sitemapKancaHash).
 */

/** Ayni site icin iki tetik arasindaki en kisa sure */
export const KANCA_ARALIK_MS = 5 * 60_000;

export function yeniKancaAnahtari(): string {
  return randomBytes(32).toString('hex');
}

export function kancaHash(anahtar: string): string {
  return createHash('sha256').update(anahtar, 'utf8').digest('hex');
}

/** "Bearer <anahtar>" basligindan anahtar; bicim uymazsa null */
export function bearerAnahtar(header: unknown): string | null {
  if (typeof header !== 'string') return null;
  const m = /^Bearer\s+([A-Za-z0-9_-]{32,128})\s*$/.exec(header);
  return m ? m[1] : null;
}

/**
 * Gonderilecek site haritasi: istenen adres verildiyse yalniz https ve sitenin
 * kendi alan adinda (alt alan adi dahil) kabul edilir; yoksa <origin>/sitemap.xml.
 * Uygun degilse null (istek reddedilir).
 */
export function kancaSitemapAdresi(siteUrl: string, istenen: unknown): string | null {
  let host: string;
  let origin: string;
  try { const u = new URL(siteUrl); host = u.hostname; origin = u.origin; } catch { return null; }
  if (istenen === undefined || istenen === null || istenen === '') return `${origin}/sitemap.xml`;
  if (typeof istenen !== 'string' || istenen.length > 500) return null;
  let u: URL;
  try { u = new URL(istenen); } catch { return null; }
  if (u.protocol !== 'https:' || !urlHostMatches(u.toString(), host)) return null;
  return u.toString();
}
