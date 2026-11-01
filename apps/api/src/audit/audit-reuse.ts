/**
 * Ayni site icin kullanicinin baslattigi bir tarama zaten kuyrukta ya da
 * calisiyorsa yenisi eklenmez, mevcut is dondurulur.
 *
 * NEDEN: iki kez basma, iki acik sekme ya da "birazdan sayfayi yenile"
 * sonrasi tekrar basma ayni siteyi art arda iki kez taratiyordu. Sonuc
 * bozulmuyordu ama AI olcumu iki kez kosuyor, kullanicinin aylik olcum hakki
 * iki kez dusuyordu.
 *
 * Yalnizca KULLANICI taramasi (payload.trigger yok) yeniden kullanilir:
 * haftalik sistem taramasi saatler sonrasina ertelenmis olabilir; kullaniciyi
 * ona baglamak yoklamayi zaman asimina dusururdu.
 */

/** Tam tarama ~2-3,5 dk; 3 deneme + geri cekilme ile en kotu ~11 dk. Bundan
 * eski QUEUED/PROCESSING kaydi kopmus is sayilir, yeniden kullanilmaz. */
export const AUDIT_REUSE_WINDOW_MS = 20 * 60_000;

export type AuditJobCandidate = {
  id: string;
  status: string;
  payload: unknown;
  queuedAt: Date;
  bullJobId: string | null;
};

export function pickReusableAuditJob(
  jobs: AuditJobCandidate[],
  now: Date,
): (AuditJobCandidate & { bullJobId: string }) | null {
  const since = now.getTime() - AUDIT_REUSE_WINDOW_MS;
  for (const j of jobs) {
    if (j.status !== 'QUEUED' && j.status !== 'PROCESSING') continue;
    if (!j.bullJobId) continue; // kuyruga hic eklenememis kayit
    if (j.queuedAt.getTime() < since) continue;
    const trigger = (j.payload as { trigger?: unknown } | null)?.trigger;
    if (trigger !== undefined && trigger !== 'user') continue;
    return j as AuditJobCandidate & { bullJobId: string };
  }
  return null;
}
