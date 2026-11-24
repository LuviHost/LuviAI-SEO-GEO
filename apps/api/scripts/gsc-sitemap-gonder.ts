/**
 * Site haritasini Search Console'a gonderir (sitemaps.submit) — yayin sonrasi.
 *
 * NEDEN (24.11.2026): RanksUp site haritasini yalniz makale yayinlaninca gonderiyor
 * (ai-indexing-pinger). ranksup.ai'nin kendi sayfalari web yayiniyla degisince
 * Google'a haber gitmiyordu. scripts/deploy-web.sh basarili yayindan sonra bunu cagirir.
 * Google'in bugun destekledigi kanal Search Console API'dir (sitemap ping 2023'te kapandi).
 * Gonderim dizine almayi garanti etmez; Google site haritasini sirasina alir.
 *
 * CALISTIRMA (apps/api icinden):
 *   npx tsx scripts/gsc-sitemap-gonder.ts                     # varsayilan: ranksup.ai
 *   npx tsx scripts/gsc-sitemap-gonder.ts --host=ornek.com
 * Site RanksUp'ta Search Console'a bagli olmali (Site.gscRefreshToken + gscPropertyUrl,
 * yazma kapsami 'webmasters'). Token / kimlik bilgisi yazdirilmaz.
 * Cikis kodu: 0 gonderildi, 1 gonderilemedi (yayin betigi bunu yalniz uyari sayar).
 */
// dotenv once: @luviai/shared sifreleme anahtarini modul yuklenirken okur
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { GscOAuthService } from '../src/auth/gsc-oauth.service.js';

const HOST = (process.argv.find((a) => a.startsWith('--host='))?.split('=')[1] ?? 'ranksup.ai')
  .trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');

const prisma = new PrismaClient();

async function main(): Promise<number> {
  const adaylar = await prisma.site.findMany({
    where: { url: { contains: HOST }, gscRefreshToken: { not: null } },
    select: { id: true, url: true },
  });
  // "contains" alt alan adlarini da getirir; tam host eslesmesi aranir
  const site = adaylar.find((s) => {
    try { return new URL(s.url).hostname.toLowerCase().replace(/^www\./, '') === HOST; } catch { return false; }
  });
  if (!site) {
    console.log(`GSC: ${HOST} için Search Console'a bağlı site yok — gönderilmedi`);
    return 1;
  }
  const sitemap = `${new URL(site.url).origin}/sitemap.xml`;
  const r = await new GscOAuthService(prisma as never).submitSitemap(site.id, sitemap);
  if (r.ok) {
    console.log(`GSC: ${sitemap} gönderildi`);
    return 0;
  }
  console.log(`GSC: ${sitemap} gönderilemedi (${r.skipped ?? r.error ?? 'bilinmeyen'})`);
  return 1;
}

main()
  .then((kod) => { process.exitCode = kod; })
  .catch((err) => { console.log(`GSC: hata — ${String(err?.message ?? err).slice(0, 200)}`); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
