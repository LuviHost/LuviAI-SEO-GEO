import { trialEndsAtFrom } from './trial-policy.js';

/**
 * Tek seferlik: bitis tarihi hic yazilmamis deneme hesaplarina 14 gun (sahip karari
 * 21.10.2026). NEDEN: ensureTrialStarted yazildigindan beri hicbir kayit yolu onu
 * cagirmiyordu; bugunku deneme hesaplarinin hepsinde trialEndsAt bos. Kayit tarihinden
 * saymak onlarin cogunu ANINDA bitmis (salt okunur) yapardi; sahip "dagitimdan itibaren
 * 14 gun" dedi. Baslangic = betigin calistigi an.
 *
 * Kapsam: plan TRIAL + durum TRIAL + trialEndsAt bos + silme talebi yok + yonetici degil.
 * Ucretli hesaba, EXPIRED'a (iptal edip dusen abonelik) ve zaten tarihi olana dokunulmaz.
 * Yazma kosullu (ayni kosullar where'de): arada kayit yolu tarih yazdiysa ezilmez.
 * Idempotent: ikinci kosu 0 hesap bulur. LLM cagrisi yok.
 */
export interface TrialBackfillPrisma {
  user: {
    findMany(args: unknown): Promise<Array<{ id: string; email: string; createdAt: Date }>>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
}

export const TRIAL_BACKFILL_WHERE = {
  plan: 'TRIAL',
  subscriptionStatus: 'TRIAL',
  trialEndsAt: null,
  deletionRequestedAt: null,
  role: { not: 'ADMIN' },
} as const;

export interface TrialBackfillResult {
  /** Kapsama giren hesap sayisi */
  found: number;
  /** Yazilan (kuru calismada 0) */
  updated: number;
  /** Yazilacak bitis */
  trialEndsAt: Date;
  /** Satir satir rapor */
  lines: string[];
}

export async function runTrialBackfill(
  prisma: TrialBackfillPrisma,
  opts: { apply: boolean; now?: Date },
): Promise<TrialBackfillResult> {
  const now = opts.now ?? new Date();
  const trialEndsAt = trialEndsAtFrom(now);
  const users = await prisma.user.findMany({
    where: TRIAL_BACKFILL_WHERE,
    select: { id: true, email: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  const lines: string[] = [];
  let updated = 0;
  for (const u of users) {
    lines.push(`  ${u.email} (kayıt ${u.createdAt.toISOString().slice(0, 10)}): deneme bitişi → ${trialEndsAt.toISOString()}`);
    if (!opts.apply) continue;
    const r = await prisma.user.updateMany({ where: { id: u.id, ...TRIAL_BACKFILL_WHERE }, data: { trialEndsAt } });
    updated += r.count;
  }
  lines.push(`${users.length} deneme hesabı bulundu; ${opts.apply ? `${updated} hesaba bitiş yazıldı` : 'kuru çalışma, hiçbir şey yazılmadı (yazmak için --apply)'}.`);
  return { found: users.length, updated, trialEndsAt, lines };
}
