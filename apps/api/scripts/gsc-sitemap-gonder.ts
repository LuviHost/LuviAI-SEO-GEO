/**
 * Site haritasini Search Console'a gonderir (sitemaps.submit).
 *
 * NEDEN (24.11.2026): RanksUp site haritasini yalniz makale yayinlaninca gonderiyor
 * (ai-indexing-pinger). Iki kullanim:
 *  1. ranksup.ai: scripts/deploy-web.sh basarili web yayinindan sonra cagirir.
 *  2. kobipratik.com: on yuz Windows sunucusundan yayinlaniyor; Search Console
 *     anahtarini oraya tasimak yerine RanksUp sunucusundaki cron saatte bir
 *     `--degistiyse` ile cagirir — site haritasindaki en yeni <lastmod>, Search
 *     Console'daki son gonderimden yeniyse gonderir (src/audit/sitemap-degisim.ts).
 * Google'in bugun destekledigi kanal Search Console API'dir (sitemap ping 2023'te kapandi).
 * Gonderim dizine almayi garanti etmez; Google site haritasini sirasina alir.
 *
 * CALISTIRMA (apps/api icinden):
 *   npx tsx scripts/gsc-sitemap-gonder.ts                         # ranksup.ai, <origin>/sitemap.xml
 *   npx tsx scripts/gsc-sitemap-gonder.ts --host=kobipratik.com \
 *     --sitemap=https://www.kobipratik.com/sitemap.xml --degistiyse
 * Secenekler:
 *   --host=<alan adi>   RanksUp'taki site (Search Console'a bagli olmali, kapsam 'webmasters')
 *   --sitemap=<adres>   gonderilecek site haritasi (tekrarlanabilir); yoksa <site origin>/sitemap.xml
 *   --degistiyse        yalniz son gonderimden sonra degistiyse gonder
 * Token / kimlik bilgisi yazdirilmaz.
 * Cikis kodu: 0 gonderildi ya da degisiklik yok, 1 gonderilemedi (yayin betigi uyari sayar).
 */
// dotenv once: @luviai/shared sifreleme anahtarini modul yuklenirken okur
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { google } from 'googleapis';
import { GscOAuthService } from '../src/auth/gsc-oauth.service.js';
import { urlHostMatches } from '../src/audit/host-match.js';
import { childSitemaps, newestLastmod, submitKarari } from '../src/audit/sitemap-degisim.js';

const HOST = (process.argv.find((a) => a.startsWith('--host='))?.split('=')[1] ?? 'ranksup.ai')
  .trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
const SITEMAPS = process.argv.filter((a) => a.startsWith('--sitemap=')).map((a) => a.slice('--sitemap='.length).trim()).filter(Boolean);
const DEGISTIYSE = process.argv.includes('--degistiyse');
const ZAMAN = new Date().toISOString().slice(0, 16).replace('T', ' ');

const prisma = new PrismaClient();
const gsc = new GscOAuthService(prisma as never);

async function oku(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'RanksUp-Sitemap-Check/1.0 (+https://ranksup.ai/bot)' }, signal: AbortSignal.timeout(20_000) });
    return r.ok ? await r.text() : null;
  } catch { return null; }
}

/** Site haritasi ve (dizinse) ayni sitedeki alt haritalarinin en yeni lastmod'u */
async function enYeniDegisim(url: string): Promise<Date | null> {
  const xml = await oku(url);
  if (!xml) return null;
  let enYeni = newestLastmod(xml);
  for (const cocuk of childSitemaps(xml).filter((u) => urlHostMatches(u, HOST))) {
    const cx = await oku(cocuk);
    const t = cx ? newestLastmod(cx) : null;
    if (t && (!enYeni || t > enYeni)) enYeni = t;
  }
  return enYeni;
}

async function main(): Promise<number> {
  const adaylar = await prisma.site.findMany({
    where: { url: { contains: HOST }, gscRefreshToken: { not: null } },
    select: { id: true, url: true, gscPropertyUrl: true },
  });
  // "contains" alt alan adlarini da getirir; tam host eslesmesi aranir
  const site = adaylar.find((s) => {
    try { return new URL(s.url).hostname.toLowerCase().replace(/^www\./, '') === HOST; } catch { return false; }
  });
  if (!site) {
    console.log(`${ZAMAN} GSC: ${HOST} için Search Console'a bağlı site yok — gönderilmedi`);
    return 1;
  }
  const hedefler = SITEMAPS.length ? SITEMAPS : [`${new URL(site.url).origin}/sitemap.xml`];
  let kod = 0;
  for (const sitemap of hedefler) {
    if (DEGISTIYSE) {
      let lastSubmitted: string | null = null;
      try {
        const client = await gsc.getAuthenticatedClient(site.id);
        if (client && site.gscPropertyUrl) {
          const wm = google.webmasters({ version: 'v3', auth: client as any });
          lastSubmitted = (await wm.sitemaps.get({ siteUrl: site.gscPropertyUrl, feedpath: sitemap })).data.lastSubmitted ?? null;
        }
      } catch (err: any) {
        // 404: Search Console'da kayitli degil → ilk gonderim
        if ((err?.code ?? err?.response?.status) !== 404) {
          console.log(`${ZAMAN} GSC: ${sitemap} durumu okunamadı (${String(err?.message ?? err).slice(0, 120)})`);
          kod = 1;
          continue;
        }
      }
      const karar = submitKarari(await enYeniDegisim(sitemap), lastSubmitted);
      if (!karar.gonder) {
        console.log(`${ZAMAN} GSC: ${sitemap} gönderilmedi — ${karar.neden}`);
        continue;
      }
      console.log(`${ZAMAN} GSC: ${sitemap} değişmiş — ${karar.neden}`);
    }
    const r = await gsc.submitSitemap(site.id, sitemap);
    if (r.ok) console.log(`${ZAMAN} GSC: ${sitemap} gönderildi`);
    else { console.log(`${ZAMAN} GSC: ${sitemap} gönderilemedi (${r.skipped ?? r.error ?? 'bilinmeyen'})`); kod = 1; }
  }
  return kod;
}

main()
  .then((kod) => { process.exitCode = kod; })
  .catch((err) => { console.log(`${ZAMAN} GSC: hata — ${String(err?.message ?? err).slice(0, 200)}`); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
