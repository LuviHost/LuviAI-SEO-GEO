/**
 * Gecmis AiCitationSnapshot satirlarindan AiCitationRun (kosum kaydi) uret ve
 * mevcut kosum kayitlarini guncel sayim kuralina cek.
 *
 * NEDEN (1 — eksik kosumlar): Kosum kaydi 27.08.2026'da geldi; oncesindeki
 * testler yalniz gunluk snapshot olarak duruyor (gun x saglayici). "Test
 * gecmisi" listesi bos baslamasin ve o gunlerin sonucu da karsilastirilabilsin
 * diye her (siteId, date) grubu tek kosum olarak geri doldurulur. Kosum,
 * snapshot'larin olcum yontemi surumunu (matchVersion) tasir — eskiden
 * yazilmiyordu ve her geri doldurulan kosum varsayilan 1 ile kaliyordu.
 *
 * NEDEN (2 — mevcut kosumlarin yeniden hesabi, CITATION_MATCH_VERSION 4 ile
 * ayni surum): 'HATA:' onekli probe'lar (429, 503, bos cevap) artik skora,
 * sayaclara ve havuz buyuklugune girmez; tum sorulari HATA olan saglayici
 * available=false + score=null olur (citation-score.ts providerOutcome —
 * canli runProvider ile AYNI fonksiyon). Eski kosumlarda bu satirlar "0 puan"
 * ve poolSize'a dahil saklandi; bu gecis saglayici skorlarini, manseti
 * (headlineOfProviders) ve citedCount/mentionedCount/poolSize'i saklanan
 * probe'lardan yeniden hesaplar. Probe'lar degismez.
 *
 *   npx tsx scripts/backfill-citation-runs.ts            # kuru kosum
 *   npx tsx scripts/backfill-citation-runs.ts --apply    # yaz
 *
 * SIRA (v4 deploy'undan sonra): once scripts/backfill-snapshot-unbranded.ts,
 * sonra bu script.
 *
 * Idempotent: ayni gun icin zaten (snapshot createdAt'e esit runAt'li) bir
 * kosum varsa atlanir; yeniden hesapta yalniz farkli olan kosum yazilir.
 * trigger: cron saatinde (04:0x UTC) 'system', digerleri 'user' — snapshot
 * hangisinin tetikledigini tutmuyor, bu makul bir tahmin.
 */
import { PrismaClient } from '@prisma/client';
import { headlineOfProviders, type RunProvider } from '../src/audit/citation-run-compare.js';
import { citationCounts, providerOutcome } from '../src/audit/citation-score.js';

const APPLY = process.argv.includes('--apply');

async function createMissingRuns(prisma: PrismaClient): Promise<void> {
  const snaps = await prisma.aiCitationSnapshot.findMany({
    orderBy: [{ siteId: 'asc' }, { date: 'asc' }],
    select: { siteId: true, date: true, provider: true, available: true, score: true, probes: true, citedCount: true, mentionedCount: true, createdAt: true, matchVersion: true },
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
    const providers: RunProvider[] = rows.map((r) => {
      const probes = (Array.isArray(r.probes) ? (r.probes as any[]) : []).map((pr) => ({
        query: String(pr.query ?? ''),
        cited: !!pr.cited,
        brandMentioned: !!pr.brandMentioned,
        brandInQuery: pr.brandInQuery ?? false,
        position: pr.position ?? null,
        sentiment: pr.sentiment ?? null,
        excerpt: typeof pr.excerpt === 'string' ? pr.excerpt.slice(0, 400) : null,
        ...(Array.isArray(pr.citedPages) && pr.citedPages.length ? { citedPages: pr.citedPages } : {}),
        // Kaynak listesi (GEO Faz 2) snapshot'ta varsa kosuma da tasinir — tracker ile ayni bicim
        ...(Array.isArray(pr.sources) ? { sources: pr.sources } : {}),
        ...(typeof pr.sourcesVersion === 'number' ? { sourcesVersion: pr.sourcesVersion } : {}),
      }));
      // Snapshot backfill'i kosmamis olsa bile kosum guncel kuralla yazilsin
      const o = providerOutcome(probes, { available: r.available });
      return { provider: r.provider, available: o.available, score: o.score, reason: o.reason, probes };
    });
    const counts = citationCounts(providers.flatMap((p) => p.probes));
    // Gun ici yontem karisikligi (deploy gunu) nadir; eski yontemi tasiyan
    // surum yazilir ki yeni yontemli bir kosumla "ayni yontem" sanilmasin.
    const versions = [...new Set(rows.map((r) => r.matchVersion ?? 1))];
    const matchVersion = Math.min(...versions);
    if (versions.length > 1) console.log(`  UYARI ${key}: gun icinde birden fazla olcum surumu (${versions.join(', ')}) — kosuma ${matchVersion} yazilir`);
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
          matchVersion,
        },
      });
    }
  }
  for (const [site, n] of perSite) console.log(`  ${site}: ${n} kosum`);
  console.log(`Eksik kosumlar: ${groups.size} gun-grubu; ${planned} kosum ${APPLY ? 'YAZILDI' : 'yazilacak (kuru kosum)'}, ${skipped} zaten vardi`);
}

async function recomputeRuns(prisma: PrismaClient): Promise<void> {
  // providers JSON buyuk — hepsini tek dizide tutma, sayfala.
  let cursor: string | undefined;
  let scanned = 0;
  let changed = 0;
  let unmeasuredProviders = 0;
  for (;;) {
    const runs = await prisma.aiCitationRun.findMany({
      orderBy: { id: 'asc' },
      take: 200,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: { id: true, headlineScore: true, citedCount: true, mentionedCount: true, poolSize: true, providers: true },
    });
    if (runs.length === 0) break;
    cursor = runs[runs.length - 1].id;

    for (const r of runs) {
      scanned++;
      const providers: RunProvider[] = Array.isArray(r.providers) ? (r.providers as unknown as RunProvider[]) : [];
      let providersChanged = false;
      const next = providers.map((p) => {
        const probes = Array.isArray(p.probes) ? p.probes : [];
        const o = providerOutcome(probes, { available: !!p.available, reason: p.reason ?? null });
        if (o.available === !!p.available && o.score === (p.score ?? null) && o.reason === (p.reason ?? null)) return p;
        providersChanged = true;
        if (p.available && !o.available) unmeasuredProviders++;
        return { ...p, available: o.available, score: o.score, reason: o.reason };
      });
      const counts = citationCounts(next.flatMap((p) => (Array.isArray(p.probes) ? p.probes : [])));
      const headlineScore = headlineOfProviders(next);
      const differs = providersChanged || r.headlineScore !== headlineScore || r.citedCount !== counts.cited
        || r.mentionedCount !== counts.mentioned || r.poolSize !== counts.poolSize;
      if (!differs) continue;
      changed++;
      if (APPLY) {
        await prisma.aiCitationRun.update({
          where: { id: r.id },
          data: {
            providers: next as any,
            headlineScore,
            citedCount: counts.cited,
            mentionedCount: counts.mentioned,
            poolSize: counts.poolSize,
          },
        });
      }
    }
    if (runs.length < 200) break;
  }
  console.log(`Yeniden hesap: ${scanned} kosum tarandi, ${changed} ${APPLY ? 'YAZILDI' : 'farkli (yazilmadi)'}; ${unmeasuredProviders} saglayici sonucu "olculemedi"ye cekildi (tum sorulari HATA)`);
}

async function main() {
  const prisma = new PrismaClient();
  try {
    await createMissingRuns(prisma);
    await recomputeRuns(prisma);
    if (!APPLY) console.log('Yazmak icin: npx tsx scripts/backfill-citation-runs.ts --apply');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
