import { Logger } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AiCitationTrackerService } from './ai-citation-tracker.service.js';
import type { CitationResult } from './ai-citation.service.js';
import { aiCitationSkipFromResults, type AiCitationSkip, type AuditAiOlcumu } from './audit.service.js';
import { isErrorProbe } from './citation-score.js';
import { isStandardTierVersion } from './host-match.js';
import {
  SETUP_MEASUREMENT_LIMIT_CODE, SETUP_MEASUREMENT_WINDOW_MS, decideSetupMeasurement, parseSetupRecords, pruneSetupRecords,
  setupHost, setupLimitMessage, type SetupMeasurementBlock, type SetupMeasurementRecord,
} from './setup-measurement-limit.js';

/**
 * SITE KURULUMUNUN TEK OTOMATIK AI OLCUMU (sahip karari 11.11.2026).
 *
 * Eskiden kurulum zinciri (worker ONBOARDING_CHAIN) IKI kez olcuyordu: denetimin AI testi
 * (audit.service runAudit → runForSite) ve, akis acikken, baslangic olcumu
 * (ai-citation-tracker snapshotSite). Ikisi de "sistem" olcumu: aylik calistirma tavanina
 * ve haftalik olcum hakkina sayilmaz. Profesyonel'de site basina iki olcum, sil-yeniden
 * ekle ile sinirsiz. Artik:
 *
 *  - TEK olcum: brain hazir olunca (sorular brain'den gelir) snapshotSite bir kez olcer;
 *    sonuc gecmise (gunluk snapshot + kosum) yazilir ve AYNI sonuc denetimin AI bolumune
 *    verilir (runAudit opts.aiOlcumu). Denetim asistanlara ayrica sormaz.
 *  - SINIR: hesap basina kayan 30 gunde planin site siniri kadar, ayni alan adi icin 1
 *    (setup-measurement-limit.ts; ADMIN muaf). Dolunca kurulum olcumsuz surer, denetimin
 *    AI bolumu nedeni tasir (SETUP_MEASUREMENT_LIMIT); musteri olcumu haftalik hakkiyla
 *    kendisi baslatir.
 *  - AYNI KURULUMUN YENIDEN DENEMESI olcmez: zincir yeniden denenirse (BullMQ, 3 deneme)
 *    sitenin son 24 saatteki olcumu denetime verilir. Yoksa ikinci deneme "sinir doldu"
 *    yazardi (alan adi az once olculdu) — olcum varken yanlis bir neden.
 *
 * DEPO: kv_store `kurulum-olcumu:<userId>` = [{ host, at }] (JSON), expiresAt = son
 * kayit + 30 gun (KvSweepCron siler). Anahtar KULLANICIYA baglidir, siteye degil: site
 * silinince kayit silinmez (sites.service siteKvFilter anahtarda site kimligi arar) —
 * sil + yeniden ekle kuralinin dayanagi. Migration yok.
 *
 * ESZAMANLILIK: kayit olcumden ONCE yazilir (ayir → olc). Yazim kosulludur (satirin
 * okunan degeri hala ayniysa; measurement-allowance.service ile ayni iyimser kalip):
 * ayni hesabin iki sitesi ayni anda kurulurken ikisi de "yer var" okuyup tavani asamaz.
 * Olcum hata verir ya da hic gercek sonuc uretmezse (anahtar yok, havuz butcesi dolu,
 * tum cevaplar hata) ayirma geri alinir: sonuc vermeyen olcum hakki yakmaz.
 *
 * HATA YONU: sinir kaydi okunamaz / yazilamazsa olcum YAPILIR ve uyari loglanir (sinir
 * denetimi urunu durdurmaz). Site okunamazsa ya da olcum hata verirse hata cagirana
 * gider; denetim AI bolumunu "tamamlanamadi" diye yazar ve surer.
 */

const defaultLog = new Logger('SetupMeasurement');

/** Ayni kurulumun yeniden denemesi sayilan sure: bu kadar taze bir olcum varsa yeniden olculmez */
export const SETUP_REUSE_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Kosullu yazim yarisi kaybedilirse en fazla bu kadar deneme */
const CAS_ATTEMPTS = 3;

export const setupMeasurementKey = (userId: string) => `kurulum-olcumu:${userId}`;

type Db = Pick<PrismaService, 'site' | 'kvStore' | 'aiCitationRun'>;

export interface SetupMeasurementDeps {
  prisma: Db;
  tracker: Pick<AiCitationTrackerService, 'snapshotSite'>;
  log?: Pick<Logger, 'log' | 'warn'>;
}

/** Sinir dolu: denetimin AI bolumune yazilan atlama nedeni (checks.aiCitations.skipped) */
export function setupLimitSkip(reason: SetupMeasurementBlock, limit: number): AiCitationSkip {
  // nextAvailableAt yok: musteri olcumu haftalik hakkiyla hemen baslatabilir (beklenecek bir an yok)
  return { code: SETUP_MEASUREMENT_LIMIT_CODE, message: setupLimitMessage(reason, limit), nextAvailableAt: null };
}

export type SetupReservation =
  /** key/entry null: kayit yazilmadi (ADMIN muaf ya da depo hatasi) — geri alinacak bir sey yok */
  | { allowed: true; key: string | null; entry: SetupMeasurementRecord | null }
  | { allowed: false; reason: SetupMeasurementBlock; limit: number };

/**
 * Otomatik kurulum olcumu icin yer ayir: karar + kayit TEK kosullu yazimda.
 * Depo hatasinda izin verilir (kayitsiz); yarisi CAS_ATTEMPTS kez kaybeden de izin alir
 * (asim en fazla o an paralel kosan is sayisi kadar olabilir; worker eszamanliligi 2).
 */
export async function reserveSetupMeasurement(
  prisma: Pick<PrismaService, 'kvStore'>,
  args: { userId: string; plan: string | null | undefined; role: string | null | undefined; host: string; now: Date },
  log: Pick<Logger, 'warn'> = defaultLog,
): Promise<SetupReservation> {
  if (args.role === 'ADMIN') return { allowed: true, key: null, entry: null };
  const key = setupMeasurementKey(args.userId);
  const entry: SetupMeasurementRecord = { host: args.host, at: args.now.toISOString() };
  const expiresAt = new Date(args.now.getTime() + SETUP_MEASUREMENT_WINDOW_MS);
  try {
    for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
      const row = await prisma.kvStore.findUnique({ where: { key }, select: { value: true } });
      const records = pruneSetupRecords(parseSetupRecords(row?.value), args.now);
      const d = decideSetupMeasurement(args.now, records, args.plan, args.role, args.host);
      if (!d.allowed) return { allowed: false, reason: d.reason, limit: d.limit };
      const value = JSON.stringify([...records, entry]);
      if (!row) {
        try {
          await prisma.kvStore.create({ data: { key, value, expiresAt } });
          return { allowed: true, key, entry };
        } catch (err: any) {
          if (err?.code !== 'P2002') throw err; // satiri baska bir is az once acti: yeniden oku
          continue;
        }
      }
      // Kosul: satir okundugundan beri degismedi (ayni hesabin paralel kurulumu yazmadi)
      const res = await prisma.kvStore.updateMany({ where: { key, value: row.value }, data: { value, expiresAt } });
      if (res.count === 1) return { allowed: true, key, entry };
    }
    log.warn(`[${args.userId}] Kurulum olcumu siniri yazilamadi (yaris ${CAS_ATTEMPTS} kez kaybedildi); olcum sinir kaydi olmadan yapiliyor`);
  } catch (err: any) {
    log.warn(`[${args.userId}] Kurulum olcumu siniri okunamadi/yazilamadi; olcum sinir kaydi olmadan yapiliyor: ${err?.message ?? err}`);
  }
  return { allowed: true, key: null, entry: null };
}

/** Ayirmayi geri al (olcum sonuc vermedi). Yalniz kendi kaydini siler; hata loglanir ve yutulur. */
export async function releaseSetupMeasurement(
  prisma: Pick<PrismaService, 'kvStore'>,
  r: SetupReservation,
  log: Pick<Logger, 'warn'> = defaultLog,
): Promise<void> {
  if (!r.allowed || !r.key || !r.entry) return;
  const { key, entry } = r;
  try {
    for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
      const row = await prisma.kvStore.findUnique({ where: { key }, select: { value: true } });
      if (!row) return;
      const records = parseSetupRecords(row.value);
      const i = records.findIndex((x) => x.host === entry.host && x.at === entry.at);
      if (i === -1) return;
      const rest = [...records.slice(0, i), ...records.slice(i + 1)];
      const res = rest.length === 0
        ? await prisma.kvStore.deleteMany({ where: { key, value: row.value } })
        : await prisma.kvStore.updateMany({
          where: { key, value: row.value },
          data: { value: JSON.stringify(rest), expiresAt: new Date(Math.max(...rest.map((x) => Date.parse(x.at))) + SETUP_MEASUREMENT_WINDOW_MS) },
        });
      if (res.count === 1) return;
    }
  } catch (err: any) {
    log.warn(`[${key}] Kurulum olcumu ayirmasi geri alinamadi: ${err?.message ?? err}`);
  }
}

/** En az bir asistan gercek (HATA olmayan) cevap dondurdu mu — motorun hasRealProbes kuraliyla ayni */
function olcumVar(results: Array<{ available?: boolean; probes?: Array<{ excerpt?: unknown }> | null }>): boolean {
  return results.some((r) => r.available === true && (r.probes ?? []).some((p) => !isErrorProbe(p)));
}

/**
 * Sitenin son 24 saatteki OLCULMUS kosumu → denetime verilecek sonuc; yoksa null.
 * Kosum kaydi saglayici bazinda skoru ve (kirpilmis) probe'lari tasir; kaynak listeleri
 * denetime zaten yazilmaz. Kademe, kosumun yontem surumunden okunur (host-match).
 */
async function recentMeasuredRun(prisma: Pick<PrismaService, 'aiCitationRun'>, siteId: string, now: Date): Promise<AuditAiOlcumu | null> {
  const run = await prisma.aiCitationRun.findFirst({
    where: { siteId, runAt: { gte: new Date(now.getTime() - SETUP_REUSE_WINDOW_MS) } },
    orderBy: { runAt: 'desc' },
    select: { runAt: true, providers: true, matchVersion: true },
  });
  const providers = Array.isArray(run?.providers) ? (run!.providers as unknown[]) : [];
  const modelTier = isStandardTierVersion(run?.matchVersion ?? 1) ? 'standard' as const : 'premium' as const;
  const results = providers
    .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object' && typeof (p as { provider?: unknown }).provider === 'string')
    .map((p) => ({
      ...p,
      available: p.available === true,
      score: typeof p.score === 'number' ? p.score : null,
      probes: Array.isArray(p.probes) ? p.probes : [],
      modelTier,
    })) as unknown as CitationResult[];
  if (!run || !results.some((r) => r.available && typeof r.score === 'number')) return null;
  return { results, ranAt: run.runAt.toISOString() };
}

/**
 * Kurulumun AI adimi (worker ONBOARDING_CHAIN → audit.runAudit opts.aiOlcumu).
 * Doner: denetimin AI bolumune yazilacak sonuc ya da atlama nedeni.
 * TEST modunda (AI_GLOBAL_DISABLED) worker bunu hic cagirmaz.
 */
export async function runSetupMeasurement(
  deps: SetupMeasurementDeps,
  siteId: string,
  opts: { now?: Date } = {},
): Promise<AuditAiOlcumu> {
  const log = deps.log ?? defaultLog;
  const now = opts.now ?? new Date();

  const site = await deps.prisma.site.findUnique({
    where: { id: siteId },
    select: { url: true, userId: true, user: { select: { plan: true, role: true } } },
  });
  if (!site) return { skipped: aiCitationSkipFromResults([]) };

  // Ayni kurulumun yeniden denemesi: taze olcum denetime verilir, yeniden olculmez.
  // Okunamazsa yok sayilir (asagidaki sinir yine de ikinci olcumu keser).
  const taze = await recentMeasuredRun(deps.prisma, siteId, now).catch(() => null);
  if (taze) {
    log.log(`[${siteId}] Kurulum olcumu: son 24 saatte olcum var, yeniden olculmedi (denetime o sonuc verildi)`);
    return taze;
  }

  const reservation = await reserveSetupMeasurement(
    deps.prisma,
    { userId: site.userId, plan: site.user?.plan, role: site.user?.role, host: setupHost(site.url), now },
    log,
  );
  if (!reservation.allowed) {
    const skipped = setupLimitSkip(reservation.reason, reservation.limit);
    log.log(`[${siteId}] Otomatik kurulum olcumu yapilmadi (${reservation.reason}): ${skipped.message}`);
    return { skipped };
  }

  let snapshot: Awaited<ReturnType<AiCitationTrackerService['snapshotSite']>>;
  try {
    // SISTEM olcumu: aylik calistirma tavanina ve haftalik olcum hakkina sayilmaz
    snapshot = await deps.tracker.snapshotSite(siteId, { trigger: 'system' });
  } catch (err) {
    await releaseSetupMeasurement(deps.prisma, reservation, log);
    throw err;
  }
  // Sonuc vermeyen olcum (anahtar yok, havuz butcesi dolu, tum cevaplar hata) siniri yakmaz
  if (!olcumVar(snapshot.results)) await releaseSetupMeasurement(deps.prisma, reservation, log);
  return { results: snapshot.results, ranAt: snapshot.runAt };
}
