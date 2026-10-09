/**
 * Tek seferlik düzeltme — hero yer tutucusu (placeholder-hero.webp) kalıntıları
 *
 * NEDEN GEREKLI: yazar şablonu her makaleye `![Hero](placeholder-hero.webp)` ve
 * frontmatter `hero_image: "placeholder-hero.webp"` yazdırıyordu.
 *   1) QA kapısı satırı "doldurulmamış görsel" sayıp makaleyi BLOCKED yaptı.
 *      → Yalnızca hero-yer-tutucusu kaynaklı placeholder_image ENGELLERİ silinir;
 *        LLM'in ve diğer kuralların engellerine DOKUNULMAZ. Engel kalmazsa durum
 *        uyarı varsa WARN, yoksa PASS olur.
 *   2) JSON-LD `image` alanına göreli "placeholder-hero.webp" yazıldı.
 *      → Kayıttaki değer gerçek hero URL'iyle değişir; hero yoksa alan silinir
 *        (yayın anında publisher gerçek URL'i yeniden ekler).
 *      → YAYINDAKİ sayfalar bu betikle DEĞİŞMEZ; liste olarak basılır. Canlı
 *        sayfayı düzeltmek yeniden yayın ister — o karar kullanıcının.
 *
 * LLM çağrısı YOK. Idempotent: ikinci koşu 0 satır bulur.
 *
 * CALISTIRMA (apps/api icinden):
 *   npx tsx scripts/backfill-hero-placeholder-qa.ts           # kuru calisma
 *   npx tsx scripts/backfill-hero-placeholder-qa.ts --apply   # yaz
 */
import { PrismaClient } from '@prisma/client';
import { applyHeroImageToJsonLd, isHeroPlaceholder } from '../src/articles/hero-placeholder.js';

const APPLY = process.argv.includes('--apply');
const prisma = new PrismaClient();

// Yalnizca TEK gorsellik govde engeli ve alintisi hero yer tutucusu olan kayit.
// "2 görsel placeholder'ı..." gibi coklu kayitta alinti yine hero satirini
// gosterebilir ama baska bir yer tutucu da vardir → dokunulmaz (temkinli).
const isHeroBlocker = (b: any) =>
  b?.type === 'placeholder_image'
  && typeof b?.excerpt === 'string' && /!\[[^\]]*\]\(\s*placeholder-hero\.webp\s*\)/i.test(b.excerpt)
  && /^1 görsel placeholder/.test(String(b?.detail ?? ''));

async function fixQa(): Promise<number> {
  const rows = await prisma.article.findMany({
    where: { qaStatus: 'BLOCKED' as any },
    select: { id: true, slug: true, qaReport: true },
  });
  let n = 0;
  for (const a of rows) {
    const report: any = a.qaReport ?? {};
    const blockers: any[] = Array.isArray(report.blockers) ? report.blockers : [];
    const kept = blockers.filter((b) => !isHeroBlocker(b));
    if (kept.length === blockers.length) continue;
    const warnings: any[] = Array.isArray(report.warnings) ? report.warnings : [];
    const status = kept.length > 0 ? 'BLOCKED' : warnings.length > 0 ? 'WARN' : 'PASS';
    console.log(`  QA  ${a.slug}: ${blockers.length - kept.length} hero-yer-tutucusu engeli → ${status}`);
    n++;
    if (APPLY) {
      await prisma.article.update({
        where: { id: a.id },
        data: {
          qaStatus: status as any,
          qaReport: {
            ...report,
            blockers: kept,
            backfill: { by: 'backfill-hero-placeholder-qa', at: new Date().toISOString(), removed: blockers.length - kept.length },
          },
        },
      });
    }
  }
  return n;
}

async function fixJsonLd(): Promise<{ fixed: number; published: string[] }> {
  // JSON kolonunda metin araması yerine kayıtları süz: makale sayısı küçük
  // (yüzler), schemaMarkup yalnızca seçilen alan.
  const rows = await prisma.article.findMany({
    select: { id: true, slug: true, status: true, heroImageUrl: true, schemaMarkup: true },
  });
  let fixed = 0;
  const published: string[] = [];
  for (const a of rows) {
    const sm: any = a.schemaMarkup;
    if (!sm || !Array.isArray(sm.jsonLd)) continue;
    if (!JSON.stringify(sm.jsonLd).includes('placeholder-hero.webp')) continue;
    const hero = a.heroImageUrl && !isHeroPlaceholder(a.heroImageUrl) ? a.heroImageUrl : null;
    const jsonLd = structuredClone(sm.jsonLd);
    if (applyHeroImageToJsonLd(jsonLd, hero) === 0) continue;
    fixed++;
    if (String(a.status) === 'PUBLISHED') published.push(`${a.slug}${hero ? '' : ' (hero yok)'}`);
    if (APPLY) {
      await prisma.article.update({ where: { id: a.id }, data: { schemaMarkup: { ...sm, jsonLd } } });
    }
  }
  return { fixed, published };
}

async function main(): Promise<void> {
  console.log(APPLY ? 'YAZMA modu\n' : 'KURU CALISMA — hicbir sey yazilmayacak\n');
  const qa = await fixQa();
  const ld = await fixJsonLd();
  console.log(`\nQA: ${qa} makalenin hero-yer-tutucusu engeli ${APPLY ? 'kaldirildi' : 'kaldirilacak'}`);
  console.log(`JSON-LD: ${ld.fixed} makalenin kaydi ${APPLY ? 'duzeltildi' : 'duzeltilecek'}`);
  if (ld.published.length > 0) {
    console.log(`\nYAYINDA olan ${ld.published.length} makalenin CANLI sayfasi hala eski JSON-LD tasiyor`);
    console.log('(duzeltmek icin yeniden yayin gerekir — bu betik yayin yapmaz):');
    for (const s of ld.published) console.log(`  - ${s}`);
  }
  if (!APPLY && (qa > 0 || ld.fixed > 0)) console.log('\nYazmak icin: npx tsx scripts/backfill-hero-placeholder-qa.ts --apply');
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
