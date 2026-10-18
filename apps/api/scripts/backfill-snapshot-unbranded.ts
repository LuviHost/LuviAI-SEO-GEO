/**
 * Tek seferlik geri doldurma — AiCitationSnapshot'in markasiz yonteme cekilmesi
 *
 * NEDEN GEREKLI: skor zinciri artik yalnizca markasiz sorgulardan hesaplaniyor
 * (citation-score.ts). Eski snapshot'lar karisik havuzdan uretildi; birakilirsa
 * grafikte "duzeltme gunu" yapay bir kirilma olusur ve GEO Score Card /
 * donem raporu / pivot karari eski gunler icin sisik degeri okumaya devam eder.
 *
 * NE YAPAR: her snapshot'in probes JSON'undaki probe'lara brandInQuery
 * damgasi vurur (sorgu metni + site markasi, TS'teki kuralin AYNISI) ve
 * score / citedCount / mentionedCount degerlerini markasiz probe'lardan
 * yeniden hesaplar. Probe'larin kendisi SILINMEZ — ham veri korunur, yalnizca
 * ozet alanlar yeni tanima cekilir.
 *
 * CALISTIRMA (apps/api icinden):
 *   npx tsx scripts/backfill-snapshot-unbranded.ts           # kuru calisma
 *   npx tsx scripts/backfill-snapshot-unbranded.ts --apply   # yaz
 *
 * Tekrar calistirilabilir: dogru degerleri bastan hesaplar, yalnizca farkli
 * olanlari yazar.
 *
 * HOST: snapshot probe'larini canli yol (runForSite → buildProbe) site
 * host'uyla damgalar; jenerik turetilmis markada ("emlak" ← emlak.com) yalin
 * kelime markali sayilmaz. Script host'suz eslestirseydi her kosum bu
 * sorulari yeniden markali damgalayip skoru eski karisik tanima cekerdi.
 *
 * SURUM: host'lu kural CITATION_MATCH_VERSION 4 ile geldi (host-match.ts).
 * matchVersion < 4 snapshot'larda cevaptaki anilma da yalin kelimeyle
 * olculdu; onlara host'lu damga vurulursa "emlak" gecen sorular markasiz
 * havuza girip eski (sisik) anilmayla skoru yukseltir. Her snapshot OLCULDUGU
 * kuralla damgalanir: >= 4 host'lu, oncesi host'suz.
 *
 * HATA SATIRLARI (v4 ile ayni surumde): 'HATA:' onekli probe'lar (429, 503,
 * bos cevap) artik skora/sayaclara girmez; hic olculebilen probe kalmayan
 * snapshot canli yoldaki gibi available=false + score=null olur
 * (citation-score.ts providerOutcome). Eskiden bu satirlar "0 puan" olarak
 * saklaniyordu. Bu kural matchVersion'dan bagimsizdir — eski (v3) kayitlar da
 * ayni fonksiyonla duzeltilir; probe'lar yine silinmez.
 *
 * SIRA (v4 deploy'undan sonra): once bu script, sonra
 * scripts/backfill-citation-runs.ts (kosum kayitlarini da ayni kurala ceker).
 */
import { PrismaClient } from '@prisma/client';
import { containsBrand, resolveSiteBrand, MIN_BRAND_LEN } from '../src/audit/brand-in-query.js';
import { citationCounts, providerOutcome } from '../src/audit/citation-score.js';
import { brandHostFromUrl } from '../src/analytics/organic-brand-split.js';

const APPLY = process.argv.includes('--apply');
const prisma = new PrismaClient();

/** Jenerik marka korumasinin (host'lu eslesme) geldigi olcum surumu — host-match.ts */
const GENERIC_GUARD_VERSION = 4;

async function main(): Promise<void> {
  const sites = await prisma.site.findMany({ select: { id: true, name: true, url: true } });
  console.log(`${sites.length} site taranacak${APPLY ? '' : '  (KURU CALISMA)'}\n`);

  let scanned = 0;
  let changed = 0;
  /** Tum probe'lari HATA oldugu halde "0 puan" saklanmis snapshot'lar */
  let unmeasured = 0;

  for (const site of sites) {
    const brand = resolveSiteBrand(site.name, site.url);
    if (brand.trim().length < MIN_BRAND_LEN) {
      console.log(`  ${site.url} — marka "${brand}" kisa, ATLANDI.`);
      console.log('    UYARI: bu sitenin snapshot gecmisi eski (karisik) yontemde kaliyor;');
      console.log('    yeni gunlerle kiyaslanan grafiklerde degisim gunu yapay kirilma olusur.');
      continue;
    }

    // Ayni sorgu metni her gunun snapshot'inda tekrarlanir — katlama+regex
    // sonucu site basina (kural basina) bir kez hesaplanir.
    const host = brandHostFromUrl(site.url);
    const memo = new Map<string, boolean>();
    const isBranded = (q: string, matchVersion: number | null | undefined): boolean => {
      const hostAware = (matchVersion ?? 1) >= GENERIC_GUARD_VERSION;
      const key = `${hostAware ? 'h' : 'w'}|${q}`;
      let v = memo.get(key);
      if (v === undefined) { v = containsBrand(q, brand, hostAware ? host : null); memo.set(key, v); }
      return v;
    };

    // probes JSON tablonun en buyuk kolonu — hepsini tek dizide tutma, sayfala.
    let cursor: string | undefined;
    let siteSnaps = 0;
    let siteChanged = 0;
    for (;;) {
      const snaps = await prisma.aiCitationSnapshot.findMany({
        where: { siteId: site.id },
        orderBy: { id: 'asc' },
        take: 200,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        select: { id: true, available: true, score: true, citedCount: true, mentionedCount: true, probes: true, matchVersion: true },
      });
      if (snaps.length === 0) break;
      cursor = snaps[snaps.length - 1].id;
      siteSnaps += snaps.length;

      for (const s of snaps) {
        scanned++;
        const probes: any[] = Array.isArray(s.probes) ? (s.probes as any[]) : [];
        if (probes.length === 0) continue;

        // Damga: alan zaten dogruysa dokunma (idempotent kosum)
        let stamped = false;
        for (const pr of probes) {
          const want = isBranded(String(pr?.query ?? ''), s.matchVersion);
          if (pr.brandInQuery !== want) { pr.brandInQuery = want; stamped = true; }
        }

        // Canli yol (tracker + runProvider) ile AYNI fonksiyonlar — sayim ve
        // "hepsi HATA = olculemedi" kurali kopyalanmaz.
        const { cited, mentioned } = citationCounts(probes);
        const { available, score } = providerOutcome(probes, { available: s.available });

        const differs = stamped || s.score !== score || s.available !== available
          || s.citedCount !== cited || s.mentionedCount !== mentioned;
        if (!differs) continue;

        if (s.available && !available) unmeasured++;
        siteChanged++;
        changed++;
        if (APPLY) {
          await prisma.aiCitationSnapshot.update({
            where: { id: s.id },
            data: { probes: probes as any, available, score, citedCount: cited, mentionedCount: mentioned },
          });
        }
      }
      if (snaps.length < 200) break;
    }
    if (siteSnaps > 0) console.log(`  ${site.url} — ${siteSnaps} snapshot, ${siteChanged} guncellenecek`);
  }

  console.log(`\nToplam ${scanned} snapshot tarandi, ${changed}${APPLY ? ' YAZILDI' : ' fark bulundu (yazilmadi)'}`);
  if (unmeasured > 0) console.log(`  bunlarin ${unmeasured} tanesi tum sorulari HATA iken skorlu saklanmisti → olculemedi (available=false, score=null)`);
  if (!APPLY && changed > 0) console.log('Yazmak icin: npx tsx scripts/backfill-snapshot-unbranded.ts --apply');
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
