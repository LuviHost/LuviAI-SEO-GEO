import { pollJob, type JobSnapshot } from './publish-result';

/**
 * Panelden baslatilan site taramasi: KUYRUGA atilir, is kaydi yoklanir.
 *
 * NEDEN: tarama (100 sayfa crawl + 14 kontrol + PageSpeed + GEO + AI olcumu)
 * uretimde 1-3,5 dakika suruyor. Senkron /audit/run-now istegi bu kadar acik
 * kalinca vekil sunucu (Cloudflare ~100 sn) kesip 504 donuyordu; kullanici
 * "Sunucu su an cevap vermiyor" goruyordu, tarama ise sunucuda bitiyordu.
 */

/** Ust sinir — audit-reports-panel ile ayni: olculen tam tarama 208 sn */
export const AUDIT_POLL_TIMEOUT_MS = 10 * 60_000;

export type AuditRunOutcome =
  | { kind: 'done' }
  | { kind: 'failed'; error: string }
  /** Sure siniri icinde bitmedi ya da ekran kapandi — tarama arka planda suruyor olabilir */
  | { kind: 'pending' };

export const AUDIT_PENDING_TITLE = 'Tarama beklenenden uzun sürüyor';
export const AUDIT_PENDING_DESC = 'Arka planda devam ediyor; birazdan sayfayı yenile.';

/** Kuyruga atma hatasi (yetki, deneme kilidi...) firlatilir; cagiran gosterir. */
export async function runQueuedAudit(
  deps: {
    queue: () => Promise<{ id: string }>;
    getJob: (jobId: string) => Promise<JobSnapshot>;
  },
  opts: {
    isAlive?: () => boolean;
    timeoutMs?: number;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
  } = {},
): Promise<AuditRunOutcome> {
  const job = await deps.queue();
  const snap = await pollJob(() => deps.getJob(job.id), {
    timeoutMs: opts.timeoutMs ?? AUDIT_POLL_TIMEOUT_MS,
    isAlive: opts.isAlive,
    sleep: opts.sleep,
    now: opts.now,
  });
  if (!snap) return { kind: 'pending' };
  if (snap.status === 'COMPLETED') return { kind: 'done' };
  return { kind: 'failed', error: snap.error || 'Tarama başarısız' };
}
