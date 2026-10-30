/**
 * Tek seferlik onarim: yeniden tarama / beyin uretimi yuzunden ACTIVE'den
 * AUDIT_COMPLETE / AUDIT_PENDING'e dusmus siteleri ACTIVE'e geri alir.
 * Kural ve kok neden: site-status.ts. Betik: scripts/repair-site-status.ts.
 *
 * "Kurulumu bitmis" olcutu — iki kanittan BIRI:
 *  1. onboardingCompletedAt dolu: yalniz kurulum "Kaydet"i (completeOnboarding)
 *     yazar ve ayni anda status=ACTIVE yapar.
 *  2. Basariyla bitmis (COMPLETED) bir ONBOARDING_CHAIN isi: worker zinciri
 *     ACTIVE'i en sonda yazar ama onboardingCompletedAt YAZMAZ; yeni sitelerin
 *     cogu yalniz bu yoldan ACTIVE olur, o yuzden 1. tek basina eksik kalir.
 *     COMPLETED yalniz handler hata vermeden dondugunde yazilir (worker
 *     'completed' olayi); hesap silme/iptal atlamasi CANCELED kalir.
 * Ikisi de yoksa site kurulumu hic bitirmemistir (zincir dustu, demo verisi
 * vb.) — dokunulmaz.
 *
 * Disarida birakilanlar: silme talebi olan hesaplar (dondurma PAUSED yazar;
 * eski kod bunu da AUDIT_COMPLETE'e cevirmis olabilir — ACTIVE yapmak
 * otomasyonu yeniden acardi). ACTIVE/PAUSED/ERROR/ONBOARDING'e dokunulmaz.
 *
 * Yazma kosullu (ayni where): arada durum degistiyse ezilmez. Idempotent:
 * ikinci kosu 0 site bulur. Cikti yalniz sayi ve site kimligi — sir yok.
 */
export interface SiteStatusRepairPrisma {
  site: {
    findMany(args: unknown): Promise<Array<{ id: string; status: string }>>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
}

export const SITE_STATUS_REPAIR_WHERE = {
  status: { in: ['AUDIT_COMPLETE', 'AUDIT_PENDING'] },
  user: { deletionRequestedAt: null },
  OR: [
    { onboardingCompletedAt: { not: null } },
    { jobs: { some: { type: 'ONBOARDING_CHAIN', status: 'COMPLETED' } } },
  ],
} as const;

export async function runSiteStatusRepair(
  prisma: SiteStatusRepairPrisma,
  opts: { apply: boolean },
): Promise<{ found: number; updated: number; lines: string[] }> {
  const rows = await prisma.site.findMany({
    where: SITE_STATUS_REPAIR_WHERE,
    select: { id: true, status: true },
    orderBy: { createdAt: 'asc' },
  });
  const lines: string[] = [];
  const byStatus = new Map<string, string[]>();
  for (const r of rows) byStatus.set(r.status, [...(byStatus.get(r.status) ?? []), r.id]);

  lines.push(`${opts.apply ? 'UYGULA' : 'KURU CALISMA'} — kurulumu bitmis ama ACTIVE olmayan site: ${rows.length}`);
  for (const [status, ids] of byStatus) {
    lines.push(`  ${status}: ${ids.length}`);
    for (const id of ids) lines.push(`    ${id}`);
  }

  let updated = 0;
  if (opts.apply && rows.length > 0) {
    const res = await prisma.site.updateMany({
      where: { ...SITE_STATUS_REPAIR_WHERE, id: { in: rows.map((r) => r.id) } },
      data: { status: 'ACTIVE' },
    });
    updated = res.count;
    lines.push(`ACTIVE yapildi: ${updated}`);
  } else if (!opts.apply) {
    lines.push('Yazmak icin --apply ile tekrar calistir.');
  }
  return { found: rows.length, updated, lines };
}
