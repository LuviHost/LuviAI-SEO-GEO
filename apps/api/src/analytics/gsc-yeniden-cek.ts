import type { AnalyticsService } from './analytics.service.js';
import type { GscLiveService } from './gsc-live.service.js';
import { addDays, isoDay, sumTotals } from './gsc-aggregate.js';

/**
 * GSC snapshot'larini DOGRU tanimla yeniden yazar (scripts/gsc-yeniden-cek.ts).
 *
 * NEDEN: eski gunluk cron toplami ilk 50 sayfanin toplamindan, pozisyonu 50
 * sayfanin duz ortalamasindan yaziyordu (gosterim %30-40 eksik, pozisyon
 * oldugundan iyi); yeni baglanan siteler yalniz 14 gun dolduruluyordu.
 * Yeni tanim: gun toplami GSC `['date']` agregasi (analytics.service.ts
 * writeDay). Bu kosum gecmis gunleri ayni tanima ceker.
 *
 * KURU CALISMA (varsayilan): GSC'den yalniz gun toplamlarini okur (site
 * basina 1 istek), mevcut kayitlarla kiyaslar, YAZMAZ.
 * --apply: syncSnapshots ile yazar (toplamlar tum aralik, detay son N gun).
 * Tekrar calistirilabilir: upsert; ayni veri ayni sonucu yazar.
 * Token ya da kimlik bilgisi YAZDIRILMAZ.
 */

export interface RefetchPrisma {
  site: {
    findMany(args: unknown): Promise<Array<{ id: string; url: string | null }>>;
  };
  analyticsSnapshot: {
    findMany(args: unknown): Promise<Array<{ date: Date; totalClicks: number; totalImpressions: number; avgPosition: number }>>;
  };
}

export interface RefetchOptions {
  apply: boolean;
  days: number;
  detailDays: number;
  sleepMs: number;
  siteId?: string;
  today?: string;
  log?: (line: string) => void;
  sleep?: (ms: number) => Promise<void>;
}

export interface RefetchSiteResult {
  siteId: string;
  host: string;
  status: 'ok' | 'skipped' | 'error';
  gscDays?: number;
  storedDays?: number;
  changedDays?: number;
  last30?: { oldClicks: number; newClicks: number; oldImpressions: number; newImpressions: number; oldPosition: number; newPosition: number };
  written?: number;
  detailed?: number;
  error?: string;
}

const hostOf = (url: string | null) => {
  try { return url ? new URL(url).hostname.replace(/^www\./, '') : '?'; } catch { return '?'; }
};

/** Hata metninden olasi token/anahtar parcalarini temizler */
export function safeError(err: unknown): string {
  return String((err as any)?.message ?? err)
    .replace(/(ya29\.|1\/\/)[\w.-]+/g, '[gizli]')
    .replace(/(token|secret|key)=([^&\s]+)/gi, '$1=[gizli]')
    .slice(0, 200);
}

export async function runGscRefetch(
  prisma: RefetchPrisma,
  analytics: Pick<AnalyticsService, 'syncSnapshots'>,
  live: Pick<GscLiveService, 'handle' | 'dailyTotals' | 'invalidate'>,
  opts: RefetchOptions,
): Promise<RefetchSiteResult[]> {
  const log = opts.log ?? ((l: string) => console.log(l));
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const today = opts.today ?? isoDay(new Date());
  const to = today;
  const from = addDays(today, -opts.days);
  const last30From = addDays(today, -32); // GSC gecikmesi: son ~30 veri gunu

  const sites = await prisma.site.findMany({
    where: {
      gscRefreshToken: { not: null },
      gscPropertyUrl: { not: null },
      ...(opts.siteId ? { id: opts.siteId } : {}),
    },
    select: { id: true, url: true },
    orderBy: { createdAt: 'asc' },
  });
  log(`${opts.apply ? 'YAZ' : 'KURU CALISMA'} — ${sites.length} GSC bagli site, aralik ${from}..${to}, detay son ${opts.detailDays} gun`);

  const results: RefetchSiteResult[] = [];
  for (const [i, site] of sites.entries()) {
    const host = hostOf(site.url);
    try {
      const h = await live.handle(site.id);
      if (!h) {
        results.push({ siteId: site.id, host, status: 'skipped', error: 'GSC istemcisi kurulamadi' });
        log(`- ${site.id} ${host}: ATLANDI (GSC istemcisi kurulamadi)`);
        continue;
      }
      const gscDays = await live.dailyTotals(h, from, to);
      const stored = await prisma.analyticsSnapshot.findMany({
        where: { siteId: site.id, date: { gte: new Date(`${from}T00:00:00.000Z`) } },
        select: { date: true, totalClicks: true, totalImpressions: true, avgPosition: true },
      });
      const storedBy = new Map(stored.map((s) => [isoDay(s.date), s]));
      const changedDays = gscDays.filter((d) => {
        const s = storedBy.get(d.date);
        return !s || s.totalClicks !== Math.round(d.clicks) || s.totalImpressions !== Math.round(d.impressions)
          || Math.abs(s.avgPosition - d.position) > 0.005;
      }).length;
      const oldT = sumTotals(stored.filter((s) => isoDay(s.date) >= last30From)
        .map((s) => ({ clicks: s.totalClicks, impressions: s.totalImpressions, position: s.avgPosition })));
      const newT = sumTotals(gscDays.filter((d) => d.date >= last30From));
      const r: RefetchSiteResult = {
        siteId: site.id,
        host,
        status: 'ok',
        gscDays: gscDays.length,
        storedDays: stored.length,
        changedDays,
        last30: {
          oldClicks: oldT.clicks, newClicks: newT.clicks,
          oldImpressions: oldT.impressions, newImpressions: newT.impressions,
          oldPosition: Math.round(oldT.position * 100) / 100, newPosition: Math.round(newT.position * 100) / 100,
        },
      };
      if (opts.apply && gscDays.length > 0) {
        const w = await analytics.syncSnapshots(site.id, h, from, to, { detailDays: opts.detailDays });
        live.invalidate(site.id);
        r.written = w.saved;
        r.detailed = w.detailed;
      }
      results.push(r);
      log(
        `- ${site.id} ${host}: GSC ${r.gscDays} gun, kayitli ${r.storedDays}, degisen ${r.changedDays}` +
        ` | son 30 gun tiklama ${r.last30!.oldClicks} → ${r.last30!.newClicks}, gosterim ${r.last30!.oldImpressions} → ${r.last30!.newImpressions}` +
        `, sira ${r.last30!.oldPosition} → ${r.last30!.newPosition}` +
        (opts.apply ? ` | yazilan ${r.written ?? 0} gun, detay ${r.detailed ?? 0} gun` : ''),
      );
    } catch (err) {
      results.push({ siteId: site.id, host, status: 'error', error: safeError(err) });
      log(`- ${site.id} ${host}: HATA ${safeError(err)}`);
    }
    if (i < sites.length - 1 && opts.sleepMs > 0) await sleep(opts.sleepMs);
  }

  const ok = results.filter((r) => r.status === 'ok').length;
  const err = results.filter((r) => r.status === 'error').length;
  const skip = results.filter((r) => r.status === 'skipped').length;
  log(`Bitti: ${ok} tamam, ${skip} atlandi, ${err} hata.${opts.apply ? '' : ' Yazmak icin --apply ekle.'}`);
  return results;
}
