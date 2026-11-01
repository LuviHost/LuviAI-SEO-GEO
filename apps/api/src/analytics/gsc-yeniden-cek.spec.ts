import { describe, it, expect, vi } from 'vitest';
import { runGscRefetch, safeError } from './gsc-yeniden-cek.js';

/**
 * scripts/gsc-yeniden-cek.ts cekirdegi: kuru calisma YAZMAZ, --apply yazar,
 * site hatasi digerlerini durdurmaz, token yazdirilmaz.
 */

function deps(opts: { failSite?: string } = {}) {
  const prisma = {
    site: {
      findMany: vi.fn(async () => [
        { id: 's1', url: 'https://www.ornek.com' },
        { id: 's2', url: 'https://ornek2.com' },
      ]),
    },
    analyticsSnapshot: {
      // eski tanim: ilk 50 sayfa toplami (eksik) ve duz ortalama sira
      findMany: vi.fn(async () => [{ date: new Date('2026-10-30T00:00:00Z'), totalClicks: 650, totalImpressions: 30_000, avgPosition: 5.6 }]),
    },
  };
  const live = {
    handle: vi.fn(async (siteId: string) => {
      if (siteId === opts.failSite) throw new Error('invalid_grant refresh_token=1//gizli-deger');
      return { api: { query: async () => ({ data: { rows: [] } }) }, siteUrl: `sc-domain:${siteId}` };
    }),
    dailyTotals: vi.fn(async () => [
      { date: '2026-10-29', clicks: 740, impressions: 47_000, ctr: 0.0157, position: 7.3 },
      { date: '2026-10-30', clicks: 760, impressions: 48_000, ctr: 0.0158, position: 7.1 },
    ]),
    invalidate: vi.fn(),
  };
  const analytics = { syncSnapshots: vi.fn(async () => ({ saved: 2, detailed: 2, totalClicks: 1500, totalImpressions: 95_000, days: [] })) };
  const lines: string[] = [];
  return { prisma, live, analytics, lines, log: (l: string) => lines.push(l) };
}

const base = { days: 90, detailDays: 30, sleepMs: 0, today: '2026-11-02' };

describe('runGscRefetch', () => {
  it('kuru calisma: GSC okunur, kiyas raporlanir, HICBIR SEY YAZILMAZ', async () => {
    const d = deps();
    const r = await runGscRefetch(d.prisma as never, d.analytics as never, d.live as never, { ...base, apply: false, log: d.log });
    expect(d.analytics.syncSnapshots).not.toHaveBeenCalled();
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ status: 'ok', gscDays: 2, storedDays: 1, changedDays: 2 });
    expect(r[0].last30).toMatchObject({ oldClicks: 650, newClicks: 1500, oldImpressions: 30_000, newImpressions: 95_000 });
    expect(d.lines.at(-1)).toContain('--apply');
  });

  it('--apply: her site icin syncSnapshots (aralik + detay gun sayisi) ve onbellek temizligi', async () => {
    const d = deps();
    await runGscRefetch(d.prisma as never, d.analytics as never, d.live as never, { ...base, apply: true, log: d.log });
    expect(d.analytics.syncSnapshots).toHaveBeenCalledTimes(2);
    expect(d.analytics.syncSnapshots.mock.calls[0]).toEqual(['s1', expect.anything(), '2026-08-04', '2026-11-02', { detailDays: 30 }]);
    expect(d.live.invalidate).toHaveBeenCalledWith('s1');
  });

  it('bir sitenin hatasi digerini durdurmaz; hata metninde token yok', async () => {
    const d = deps({ failSite: 's1' });
    const r = await runGscRefetch(d.prisma as never, d.analytics as never, d.live as never, { ...base, apply: true, log: d.log });
    expect(r[0].status).toBe('error');
    expect(r[1].status).toBe('ok');
    expect(d.lines.join('\n')).not.toContain('1//gizli-deger');
    expect(safeError(new Error('access ya29.abc-def token=xyz'))).toBe('access [gizli] token=[gizli]');
  });
});
