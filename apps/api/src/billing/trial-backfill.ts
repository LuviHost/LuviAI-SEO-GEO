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
 *
 * ONCE durum duzeltmesi (inceleme): plan TRIAL ama durumu ACTIVE / PAST_DUE / CANCELED
 * olan tutarsiz satirlar. Eskiden denemedeki hesap "aboneligi iptal et" ile CANCELED
 * olabiliyordu (artik cancelSubscription 400); kilit kurali bu satirlari artik bitise
 * gore yakaliyor (trial-policy.ts isTrialExpired) ama satirlar yine de tutarli yazilir:
 *  - bitisi gecmis YA DA en az bir PAID faturasi var (plani dusmus eski musteri) → EXPIRED
 *    (gunluk is ve abonelik dusurmeleri de bunu yazar);
 *  - aksi halde → TRIAL (suren ya da tarihsiz deneme; tarihsizse ayni kosuda asagidaki
 *    bitis yazimi onu da kapsar).
 * Ayni salt okunur denetim SQL olarak scripts/backfill-trial-end.ts basinda.
 */
export interface TrialBackfillPrisma {
  user: {
    findMany(args: unknown): Promise<Array<{ id: string; email: string; createdAt: Date }>>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
}

/** Durum duzeltmesinin okudugu satir */
export interface TrialStatusFixRow {
  id: string;
  email: string;
  subscriptionStatus: string;
  trialEndsAt: Date | null;
  invoices: Array<{ id: string }>;
}

export const TRIAL_BACKFILL_WHERE = {
  plan: 'TRIAL',
  subscriptionStatus: 'TRIAL',
  trialEndsAt: null,
  deletionRequestedAt: null,
  role: { not: 'ADMIN' },
} as const;

/** Plan TRIAL + deneme disi durum: tutarsiz satirlar (silme talebi ve yonetici haric) */
export const TRIAL_STATUS_FIX_WHERE = {
  plan: 'TRIAL',
  subscriptionStatus: { in: ['ACTIVE', 'PAST_DUE', 'CANCELED'] },
  deletionRequestedAt: null,
  role: { not: 'ADMIN' },
} as const;

/** Tutarsiz satirin olmasi gereken durumu (saf; trial-backfill.spec.ts) */
export function consistentTrialStatus(row: Pick<TrialStatusFixRow, 'trialEndsAt' | 'invoices'>, now: Date): 'EXPIRED' | 'TRIAL' {
  const ended = !!row.trialEndsAt && row.trialEndsAt.getTime() <= now.getTime();
  return ended || row.invoices.length > 0 ? 'EXPIRED' : 'TRIAL';
}

export interface TrialBackfillResult {
  /** Durumu duzeltilecek tutarsiz satir sayisi (plan TRIAL + ACTIVE/PAST_DUE/CANCELED) */
  statusFixFound: number;
  /** Durumu yazilan (kuru calismada 0) */
  statusFixed: number;
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
  const lines: string[] = [];

  // 1) Durum duzeltmesi — bitis yaziminden ONCE: TRIAL'a donen tarihsiz satir 2. adimda bitis alir
  const bad = (await prisma.user.findMany({
    where: TRIAL_STATUS_FIX_WHERE,
    select: { id: true, email: true, subscriptionStatus: true, trialEndsAt: true, invoices: { where: { status: 'PAID' }, select: { id: true }, take: 1 } },
    orderBy: { createdAt: 'asc' },
  })) as unknown as TrialStatusFixRow[];
  let statusFixed = 0;
  for (const u of bad) {
    const target = consistentTrialStatus(u, now);
    lines.push(`  ${u.email}: plan TRIAL + durum ${u.subscriptionStatus} → ${target}${u.invoices.length > 0 ? ' (ödemiş, eski müşteri)' : ''}`);
    if (!opts.apply) continue;
    // Kosullu: arada durum degistiyse (odeme, iptal) ezilmez
    const r = await prisma.user.updateMany({ where: { id: u.id, ...TRIAL_STATUS_FIX_WHERE, subscriptionStatus: u.subscriptionStatus }, data: { subscriptionStatus: target } });
    statusFixed += r.count;
  }
  lines.push(`${bad.length} tutarsız deneme durumu bulundu; ${opts.apply ? `${statusFixed} hesabın durumu düzeltildi` : 'kuru çalışma, hiçbir şey yazılmadı'}.`);

  // 2) Bitis yazimi
  const users = await prisma.user.findMany({
    where: TRIAL_BACKFILL_WHERE,
    select: { id: true, email: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  let updated = 0;
  for (const u of users) {
    lines.push(`  ${u.email} (kayıt ${u.createdAt.toISOString().slice(0, 10)}): deneme bitişi → ${trialEndsAt.toISOString()}`);
    if (!opts.apply) continue;
    const r = await prisma.user.updateMany({ where: { id: u.id, ...TRIAL_BACKFILL_WHERE }, data: { trialEndsAt } });
    updated += r.count;
  }
  lines.push(`${users.length} deneme hesabı bulundu; ${opts.apply ? `${updated} hesaba bitiş yazıldı` : 'kuru çalışma, hiçbir şey yazılmadı (yazmak için --apply)'}.`);
  if (!opts.apply) {
    const willTrial = bad.filter((u) => !u.trialEndsAt && consistentTrialStatus(u, now) === 'TRIAL').length;
    if (willTrial > 0) lines.push(`(--apply ile durumu TRIAL'a dönen ${willTrial} tarihsiz hesap da bitiş alır.)`);
  }
  return { statusFixFound: bad.length, statusFixed, found: users.length, updated, trialEndsAt, lines };
}
