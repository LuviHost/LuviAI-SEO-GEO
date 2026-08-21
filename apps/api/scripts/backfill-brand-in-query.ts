/**
 * Tek seferlik geri doldurma — GeoPromptRun.brandInQuery
 *
 * NEDEN GEREKLI: sutun `DEFAULT false` ile eklendi; migration'dan onceki tum
 * satirlar "markasiz" gorunuyor. Birakilirsa manset gorunurluk metrigi
 * gecmiste sisik, bugunden itibaren dogru olur — grafikte gercek olmayan bir
 * dusus cikar.
 *
 * IKI AYRI HAVUZ, IKI AYRI MARKA — karistirilamaz:
 *   - SITE promptlari (prompt.trackedAppId = null): site markasiyla
 *     (resolveSiteBrand) damgalanir.
 *   - APP promptlari (trackedAppId dolu): canli yazici (aso-prompt-lab)
 *     UYGULAMA ADIYLA damgalar. Ilk surum bu ayrimi atlayip app satirlarini
 *     site markasiyla eziyordu — her kosum canli yazicinin dogru degerini
 *     tersine ceviriyor, "tekrar calistirilabilir" scriptte kalici salinim
 *     uretiyordu.
 *
 * SET-BAZLI: deger yalnizca prompt/dal METNINE baglidir; site basina yuzbin
 * satiri belege cekmek yerine yuzlerce metin siniflanir ve updateMany ile
 * kume kume yazilir. O(#satir) degil O(#metin).
 *
 * NEDEN SQL DEGIL: eslesme Turkce katlama gerektirir ("İddaa" LOWER() ile
 * eslesmez). Kural TS'te tek yerde: src/audit/brand-in-query.ts.
 *
 * CALISTIRMA (apps/api icinden):
 *   npx tsx scripts/backfill-brand-in-query.ts           # kuru calisma
 *   npx tsx scripts/backfill-brand-in-query.ts --apply   # yaz
 */
import { PrismaClient } from '@prisma/client';
import { containsBrand, resolveSiteBrand, MIN_BRAND_LEN } from '../src/audit/brand-in-query.js';

const APPLY = process.argv.includes('--apply');
const prisma = new PrismaClient();

/** Sinifla ve (apply modunda) kume kume yaz. Dondurulen sayi: etkilenen satir. */
async function stampPool(opts: {
  siteId: string;
  brand: string;
  /** null = site havuzu; string = o app'in havuzu */
  trackedAppId: string | null;
  label: string;
}): Promise<{ rows: number; branded: number; prompts: number }> {
  const { siteId, brand, trackedAppId, label } = opts;

  const prompts = await prisma.geoPrompt.findMany({
    where: { siteId, trackedAppId },
    select: { id: true, text: true },
  });
  if (prompts.length === 0) return { rows: 0, branded: 0, prompts: 0 };

  const promptIds = prompts.map((p) => p.id);
  const fanouts = await prisma.geoFanoutQuery.findMany({
    where: { promptId: { in: promptIds } },
    select: { id: true, text: true },
  });

  const brandedPromptIds = prompts.filter((p) => containsBrand(p.text, brand)).map((p) => p.id);
  const cleanPromptIds = promptIds.filter((id) => !brandedPromptIds.includes(id));
  const brandedFanoutIds = fanouts.filter((f) => containsBrand(f.text, brand)).map((f) => f.id);
  const cleanFanoutIds = fanouts.map((f) => f.id).filter((id) => !brandedFanoutIds.includes(id));

  // Yalnizca YANLIS olan satirlar sayilir/yazilir — script gercekten idempotent.
  const sets: Array<{ where: any; value: boolean }> = [
    { where: { siteId, fanoutId: null, promptId: { in: brandedPromptIds }, brandInQuery: false }, value: true },
    { where: { siteId, fanoutId: null, promptId: { in: cleanPromptIds }, brandInQuery: true }, value: false },
    { where: { siteId, fanoutId: { in: brandedFanoutIds }, brandInQuery: false }, value: true },
    { where: { siteId, fanoutId: { in: cleanFanoutIds }, brandInQuery: true }, value: false },
  ];

  let rows = 0;
  for (const s of sets) {
    const idList = (s.where.promptId?.in ?? s.where.fanoutId?.in) as string[];
    if (idList.length === 0) continue;
    if (APPLY) {
      const r = await prisma.geoPromptRun.updateMany({ where: s.where, data: { brandInQuery: s.value } });
      rows += r.count;
    } else {
      rows += await prisma.geoPromptRun.count({ where: s.where });
    }
  }

  const branded = brandedPromptIds.length + brandedFanoutIds.length;
  const total = promptIds.length + fanouts.length;
  console.log(`    ${label} — ${total} metin (%${total ? Math.round((branded / total) * 100) : 0} markali), ${rows} satir duzeltilecek`);
  return { rows, branded, prompts: total };
}

async function main(): Promise<void> {
  const sites = await prisma.site.findMany({ select: { id: true, name: true, url: true } });
  console.log(`${sites.length} site taranacak${APPLY ? '' : '  (KURU CALISMA — hicbir sey yazilmayacak)'}\n`);

  let totalRows = 0;

  for (const site of sites) {
    console.log(`  ${site.url}`);

    // ── Site havuzu ──
    const siteBrand = resolveSiteBrand(site.name, site.url);
    if (siteBrand.trim().length < MIN_BRAND_LEN) {
      console.log(`    site havuzu ATLANDI — marka "${siteBrand}" ${MIN_BRAND_LEN} karakterden kisa.`);
      console.log('    UYARI: bu sitenin gecmisi eski (karisik) yontemde kalacak; yeni olcumlerle');
      console.log('    kiyaslanan grafiklerde degisim gunu yapay bir kirilma gorulebilir.');
    } else {
      const r = await stampPool({ siteId: site.id, brand: siteBrand, trackedAppId: null, label: `site havuzu ("${siteBrand}")` });
      totalRows += r.rows;
    }

    // ── App havuzlari — canli yazicinin markasi: UYGULAMA ADI ──
    const apps = await prisma.trackedApp.findMany({
      where: { siteId: site.id },
      select: { id: true, name: true },
    });
    for (const app of apps) {
      if ((app.name ?? '').trim().length < MIN_BRAND_LEN) {
        console.log(`    app "${app.name}" ATLANDI — ad ${MIN_BRAND_LEN} karakterden kisa`);
        continue;
      }
      const r = await stampPool({ siteId: site.id, brand: app.name, trackedAppId: app.id, label: `app havuzu ("${app.name}")` });
      totalRows += r.rows;
    }
  }

  console.log(`\nToplam ${totalRows} satir ${APPLY ? 'YAZILDI' : 'duzeltilecek (yazilmadi)'}`);
  if (!APPLY && totalRows > 0) console.log('Yazmak icin: npx tsx scripts/backfill-brand-in-query.ts --apply');
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
