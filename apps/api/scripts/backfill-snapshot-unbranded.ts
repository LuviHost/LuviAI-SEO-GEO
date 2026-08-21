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
 */
import { PrismaClient } from '@prisma/client';
import { containsBrand, resolveSiteBrand, MIN_BRAND_LEN } from '../src/audit/brand-in-query.js';
import { citationCounts } from '../src/audit/citation-score.js';

const APPLY = process.argv.includes('--apply');
const prisma = new PrismaClient();

async function main(): Promise<void> {
  const sites = await prisma.site.findMany({ select: { id: true, name: true, url: true } });
  console.log(`${sites.length} site taranacak${APPLY ? '' : '  (KURU CALISMA)'}\n`);

  let scanned = 0;
  let changed = 0;

  for (const site of sites) {
    const brand = resolveSiteBrand(site.name, site.url);
    if (brand.trim().length < MIN_BRAND_LEN) {
      console.log(`  ${site.url} — marka "${brand}" kisa, ATLANDI.`);
      console.log('    UYARI: bu sitenin snapshot gecmisi eski (karisik) yontemde kaliyor;');
      console.log('    yeni gunlerle kiyaslanan grafiklerde degisim gunu yapay kirilma olusur.');
      continue;
    }

    // Ayni sorgu metni her gunun snapshot'inda tekrarlanir — katlama+regex
    // sonucu site basina bir kez hesaplanir.
    const memo = new Map<string, boolean>();
    const isBranded = (q: string): boolean => {
      let v = memo.get(q);
      if (v === undefined) { v = containsBrand(q, brand); memo.set(q, v); }
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
        select: { id: true, score: true, citedCount: true, mentionedCount: true, probes: true },
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
          const want = isBranded(String(pr?.query ?? ''));
          if (pr.brandInQuery !== want) { pr.brandInQuery = want; stamped = true; }
        }

        // Canli yol (tracker) ile AYNI fonksiyon — sayim kurali kopyalanmaz.
        const { score, cited, mentioned } = citationCounts(probes);

        const differs = stamped || s.score !== score || s.citedCount !== cited || s.mentionedCount !== mentioned;
        if (!differs) continue;

        siteChanged++;
        changed++;
        if (APPLY) {
          await prisma.aiCitationSnapshot.update({
            where: { id: s.id },
            data: { probes: probes as any, score, citedCount: cited, mentionedCount: mentioned },
          });
        }
      }
      if (snaps.length < 200) break;
    }
    if (siteSnaps > 0) console.log(`  ${site.url} — ${siteSnaps} snapshot, ${siteChanged} guncellenecek`);
  }

  console.log(`\nToplam ${scanned} snapshot tarandi, ${changed}${APPLY ? ' YAZILDI' : ' fark bulundu (yazilmadi)'}`);
  if (!APPLY && changed > 0) console.log('Yazmak icin: npx tsx scripts/backfill-snapshot-unbranded.ts --apply');
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
