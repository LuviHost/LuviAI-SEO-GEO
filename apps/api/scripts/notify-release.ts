/**
 * Surum notu bildirimi — aktif sitesi olan her kullaniciya TEK in-app bildirim.
 *
 * Kullanim (apps/api icinde):
 *   npx tsx scripts/notify-release.ts --ref 2026-08-r1            # kuru kosum: kim alacak
 *   npx tsx scripts/notify-release.ts --ref 2026-08-r1 --apply    # yaz
 *
 * Idempotent: ayni --ref ile ikinci kosum, zaten bildirim alanlari atlar
 * (refKind='release-note', refId=ref). Geri almak icin:
 *   DELETE FROM notifications WHERE refKind='release-note' AND refId='<ref>';
 *
 * Metin bu dosyada versiyonlanir (RELEASE_NOTES) — musteriye ne soylendigi
 * commit gecmisinden okunabilsin.
 */
import { PrismaClient } from '@prisma/client';

const RELEASE_NOTES: Record<string, { title: string; body: string; link: string }> = {
  '2026-08-r1': {
    title: 'Ölçümü daha dürüst hale getirdik — bazı sayılar düşebilir',
    body: [
      'Markanızın adının geçtiği sorular (örn. "X güvenilir mi?") artık manşet AI görünürlük skoruna girmiyor: o sorularda anılmak görünürlük değil, tanınırlıktı.',
      'Geçmiş ölçümler de aynı kuralla yeniden hesaplandı; bu yüzden skorlarınız düşmüş görünebilir — siteniz kötüleşmedi, ölçüm netleşti.',
      'Yakında ikinci aşama: manşet skor 7 günlük ortalamaya geçecek, Agent Readiness metodolojisi v2 olacak ve bazı puanlar yeniden oynayabilir. Ayrıntılar panelde sayıların yanındaki açıklamalarda.',
    ].join('\n\n'),
    link: '/sites',
  },
};

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const refIdx = args.indexOf('--ref');
const REF = refIdx >= 0 ? args[refIdx + 1] : '';

async function main() {
  const note = RELEASE_NOTES[REF];
  if (!note) {
    console.error(`Bilinmeyen --ref: "${REF}". Tanimli: ${Object.keys(RELEASE_NOTES).join(', ')}`);
    process.exit(1);
  }
  const prisma = new PrismaClient();
  try {
    const sites = await prisma.site.findMany({
      where: { status: { in: ['ACTIVE', 'AUDIT_COMPLETE'] as any } },
      select: { userId: true },
    });
    const userIds = [...new Set(sites.map((s) => s.userId))];
    const already = await prisma.notification.findMany({
      where: { refKind: 'release-note', refId: REF, userId: { in: userIds } },
      select: { userId: true },
    });
    const done = new Set(already.map((n) => n.userId));
    const targets = userIds.filter((u) => !done.has(u));

    console.log(`Aktif siteli kullanici: ${userIds.length} · zaten bildirim alan: ${done.size} · gonderilecek: ${targets.length}`);
    console.log(`Baslik: ${note.title}`);
    if (!APPLY) {
      console.log('(kuru kosum — yazilmadi) Yazmak icin: --apply');
      return;
    }
    let sent = 0;
    for (const userId of targets) {
      await prisma.notification.create({
        data: {
          userId,
          type: 'SYSTEM' as any,
          title: note.title,
          body: note.body,
          link: note.link,
          refKind: 'release-note',
          refId: REF,
          channels: ['inapp'] as any,
        },
      });
      sent++;
    }
    console.log(`Gonderildi: ${sent}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
