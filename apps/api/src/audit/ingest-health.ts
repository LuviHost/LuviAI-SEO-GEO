/**
 * Edge kaynagi (Worker / WordPress / nginx) sagligi — panelde "veri gercekten
 * akiyor mu, dusen istek var mi, kod guncel mi" sorularinin tek kaynagi.
 *
 *  - lastEventAt: RanksUp'a ulasan son bot isabeti (ham tablo).
 *  - throttled7d: son 7 gunde site tavanina takilip 429 alan imzali istek
 *    sayisi (kvStore, gun basina tek anahtar). Eskiden 429'lar iz birakmadan
 *    dusuyordu; sayi eksik sayimin gorunur nedeni olsun.
 *  - noIp24h: son 24 saatte IP'siz gelen isabet — kurulu kod eski (IP
 *    gondermiyor), isabetler dogrulanamiyor → panel "Worker kodunu güncelle" der.
 */

export const INGEST_THROTTLE_KEY_PREFIX = 'ingest-429:';

export function throttleKey(siteId: string, day: string): string {
  return `${INGEST_THROTTLE_KEY_PREFIX}${siteId}:${day}`;
}

export interface ThrottleValue {
  n: number;
  /** ISO — son 429 */
  last: string | null;
}

export function parseThrottleValue(raw: string | null | undefined): ThrottleValue {
  try {
    const v = JSON.parse(raw ?? '');
    const n = Number(v?.n);
    return { n: Number.isFinite(n) && n > 0 ? Math.floor(n) : 0, last: typeof v?.last === 'string' ? v.last : null };
  } catch {
    return { n: 0, last: null };
  }
}

export interface IngestHealth {
  lastEventAt: string | null;
  lastEventSource: string | null;
  /** Son 7 gunde 429 ile dusen imzali istek */
  throttled7d: number;
  lastThrottledAt: string | null;
  /** Son 24 saatteki isabet sayisi ve IP'siz olanlar */
  events24h: number;
  noIp24h: number;
  /** Kurulu kod IP gondermiyor — panel guncelleme ister */
  needsCodeUpdate: boolean;
}

/** Saf karar: son 24 saatte IP'siz isabet varsa kod eski demektir */
export function needsCodeUpdate(events24h: number, noIp24h: number): boolean {
  return events24h > 0 && noIp24h > 0;
}

interface HealthDb {
  crawlerHitEvent: {
    findFirst(args: unknown): Promise<{ ts: Date; source: string } | null>;
    groupBy(args: any): Promise<any[]>;
  };
  kvStore: { findMany(args: unknown): Promise<Array<{ key: string; value: string }>> };
}

export async function readIngestHealth(db: HealthDb, siteId: string, now = Date.now()): Promise<IngestHealth> {
  const days: string[] = [];
  for (let i = 0; i < 7; i++) days.push(new Date(now - i * 86_400_000).toISOString().slice(0, 10));
  // Saglik bilgisi yardimcidir: okunamazsa panel bos gosterir, istek dusmez
  const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    try { return (await fn()) ?? fallback; } catch { return fallback; }
  };
  const [last, reasons, kv] = await Promise.all([
    safe(() => db.crawlerHitEvent.findFirst({ where: { siteId }, orderBy: { ts: 'desc' }, select: { ts: true, source: true } }), null),
    safe(() => db.crawlerHitEvent.groupBy({
      by: ['verifyReason'],
      where: { siteId, ts: { gte: new Date(now - 86_400_000) } },
      _count: { _all: true },
    }), [] as any[]),
    safe(() => db.kvStore.findMany({ where: { key: { in: days.map((d) => throttleKey(siteId, d)) } }, select: { key: true, value: true } }), [] as Array<{ key: string; value: string }>),
  ]);
  let events24h = 0;
  let noIp24h = 0;
  for (const r of reasons ?? []) {
    const n = Number(r?._count?._all) || 0;
    events24h += n;
    if (r?.verifyReason === 'no-ip') noIp24h += n;
  }
  let throttled7d = 0;
  let lastThrottledAt: string | null = null;
  for (const row of kv ?? []) {
    const v = parseThrottleValue(row.value);
    throttled7d += v.n;
    if (v.last && (!lastThrottledAt || v.last > lastThrottledAt)) lastThrottledAt = v.last;
  }
  return {
    lastEventAt: last?.ts instanceof Date ? last.ts.toISOString() : null,
    lastEventSource: last?.source ?? null,
    throttled7d,
    lastThrottledAt,
    events24h,
    noIp24h,
    needsCodeUpdate: needsCodeUpdate(events24h, noIp24h),
  };
}
