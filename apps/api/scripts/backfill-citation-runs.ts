/**
 * Gecmis AiCitationSnapshot satirlarindan AiCitationRun (kosum kaydi) uret.
 *
 * NEDEN: Kosum kaydi 27.08.2026'da geldi; oncesindeki testler yalniz gunluk
 * snapshot olarak duruyor (gun x saglayici). "Test gecmisi" listesi bos
 * baslamasin ve o gunlerin sonucu da karsilastirilabilsin diye her
 * (siteId, date) grubu tek kosum olarak geri doldurulur.
 *
 *   npx tsx scripts/backfill-citation-runs.ts            # kuru kosum
 *   npx tsx scripts/backfill-citation-runs.ts --apply    # yaz
 *
 * Idempotent: ayni gun icin zaten (snapshot createdAt'e esit runAt'li) bir
 * kosum varsa atlanir. trigger: cron saatinde (04:0x UTC) 'system', digerleri
 * 'user' — snapshot hangisinin tetikledigini tutmuyor, bu makul bir tahmin.
 */
import { PrismaClient } from '@prisma/client';
import { headlineOfProviders, type RunProvider } from '../src/audit/citation-run-compare.js';
import { citationCounts } from '../src/audit/citation-score.js';

const APPLY = process.argv.includes('--apply');

async function main() {
  const prisma = new PrismaClient();
  try {
    const snaps = await prisma.aiCitationSnapshot.findMany({
      orderBy: [{ siteId: 'asc' }, { date: 'asc' }],
      select: { siteId: true, date: true, provider: true, available: true, score: true, probes: true, citedCount: true, mentionedCount: true, createdAt: true },
    });
    const groups = new Map<string, typeof snaps>();
    for (const s of snaps) {
      const k = `${s.siteId}|${s.date.toISOString().slice(0, 10)}`;
      const arr = groups.get(k) ?? [];
      arr.push(s);
      groups.set(k, arr);
    }
    const existing = await prisma.aiCitationRun.findMany({ select: { siteId: true, runAt: true } });
    const have = new Set(existing.map((r) => `${r.siteId}|${r.runAt.toISOString()}`));

    let planned = 0;
    let skipped = 0;
    const perSite = new Map<string, number>();
    for (const [key, rows] of groups) {
      const runAt = rows.reduce((a, b) => (a.createdAt > b.createdAt ? a : b)).createdAt;
      if (have.has(`${rows[0].siteId}|${runAt.toISOString()}`)) { skipped++; continue; }
      const providers: RunProvider[] = rows.map((r) => ({
        provider: r.provider,
        available: r.available,
        score: r.score,
        probes: (Array.isArray(r.probes) ? (r.probes as any[]) : []).map((pr) => ({
          query: String(pr.query ?? ''),
          cited: !!pr.cited,
          brandMentioned: !!pr.brandMentioned,
          brandInQuery: pr.brandInQuery ?? false,
          position: pr.position ?? null,
          sentiment: pr.sentiment ?? null,
          excerpt: typeof pr.excerpt === 'string' ? pr.excerpt.slice(0, 400) : null,
          ...(Array.isArray(pr.citedPages) && pr.citedPages.length ? { citedPages: pr.citedPages } : {}),
        })),
      }));
      const counts = citationCounts(providers.flatMap((p) => p.probes) as any[]);
      const h = runAt.getUTCHours();
      const trigger = h === 4 ? 'system' : 'user';
      planned++;
      perSite.set(rows[0].siteId, (perSite.get(rows[0].siteId) ?? 0) + 1);
      if (APPLY) {
        await prisma.aiCitationRun.create({
          data: {
            siteId: rows[0].siteId,
            runAt,
            trigger,
            headlineScore: headlineOfProviders(providers),
            citedCount: counts.cited,
            mentionedCount: counts.mentioned,
            poolSize: counts.poolSize,
            providers: providers as any,
          },
        });
      }
      void key;
    }
    for (const [site, n] of perSite) console.log(`  ${site}: ${n} kosum`);
    console.log(`Toplam ${groups.size} gun-grubu; ${planned} kosum ${APPLY ? 'YAZILDI' : 'yazilacak (kuru kosum)'}, ${skipped} zaten vardi`);
    if (!APPLY && planned > 0) console.log('Yazmak icin: npx tsx scripts/backfill-citation-runs.ts --apply');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
