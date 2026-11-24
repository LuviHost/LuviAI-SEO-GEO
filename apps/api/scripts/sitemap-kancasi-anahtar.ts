/**
 * Yayin sonrasi site haritasi tetiginin site anahtarini uretir ya da iptal eder
 * (POST /api/hooks/sitemap — src/audit/sitemap-kanca.ts).
 *
 * CALISTIRMA (apps/api icinden):
 *   npx tsx scripts/sitemap-kancasi-anahtar.ts --host=kobipratik.com          # yeni anahtar (eskisi gecersiz olur)
 *   npx tsx scripts/sitemap-kancasi-anahtar.ts --host=kobipratik.com --iptal  # anahtari kaldir
 * Yeni anahtar STDOUT'a tek satir yazilir ve bir daha gosterilemez (DB'de yalniz SHA-256'si
 * durur). Ciktiyi ekrana degil dogrudan hedef sunucudaki dosyaya aktar.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { kancaHash, yeniKancaAnahtari } from '../src/audit/sitemap-kanca.js';

const HOST = (process.argv.find((a) => a.startsWith('--host='))?.split('=')[1] ?? '')
  .trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
const IPTAL = process.argv.includes('--iptal');

const prisma = new PrismaClient();

async function main(): Promise<number> {
  if (!HOST) { console.error('--host= gerekli'); return 1; }
  const adaylar = await prisma.site.findMany({ where: { url: { contains: HOST } }, select: { id: true, url: true, gscRefreshToken: true } });
  const site = adaylar.find((s) => {
    try { return new URL(s.url).hostname.toLowerCase().replace(/^www\./, '') === HOST; } catch { return false; }
  });
  if (!site) { console.error(`${HOST}: site bulunamadı`); return 1; }
  if (IPTAL) {
    await prisma.site.update({ where: { id: site.id }, data: { sitemapKancaHash: null } });
    console.error(`${HOST}: anahtar kaldırıldı`);
    return 0;
  }
  if (!site.gscRefreshToken) console.error(`UYARI: ${HOST} Search Console'a bağlı değil; tetik gönderemez`);
  const anahtar = yeniKancaAnahtari();
  await prisma.site.update({ where: { id: site.id }, data: { sitemapKancaHash: kancaHash(anahtar) } });
  process.stdout.write(anahtar + '\n');
  return 0;
}

main()
  .then((k) => { process.exitCode = k; })
  .catch((err) => { console.error(`hata — ${String(err?.message ?? err).slice(0, 200)}`); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
