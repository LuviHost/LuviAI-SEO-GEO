import { describe, it, expect, vi } from 'vitest';
import {
  STUCK_AUTO_RECOVER_PER_SITE, STUCK_AUTO_RECOVER_SCAN, STUCK_AUTO_RECOVER_SCAN_BUDGET, planStuckRepublish, republishBlockText, runStuckPageSweep,
} from './stuck-page-autopilot.js';

/**
 * Haftalik tarama aday okumasi (S20) ve WordPress kisa baglantili kaydin
 * metni (S21).
 *
 * S20 NEDEN: tarama yalniz en yuksek puanli 25 DETECTED satiri okuyup SONRA
 * eliyordu. Taslak akisinda kalici olarak ?p= adresiyle kayitli (her zaman
 * url_mismatch) eski yazilar en yuksek puanliysa her pazartesi ayni 25 satir
 * okunup elendi, altlarindaki uygun sayfalar hic kuyruga girmedi: ucretli
 * otopilot o sitede hicbir sey duzeltmedi. Simdi adaylar sayfa sayfa
 * (stuckScore azalan, esitlikte id; imlec) okunur, uygun sayfa bulunana ya da
 * satir bitene kadar; okuma tavani taramayi sinirlar.
 * Sahne: scratchpad rv13/e2e/sweep-starvation, rv13/sweep-verify.
 *
 * S21 NEDEN: varsayilan WordPress hedefi taslak gonderir ve kayda WordPress'in
 * taslak baglantisini (?p=41) yazar. Bu yazinin takili adresi icin "Yazı
 * sitende başka bir adreste de yayında olabilir (örneğin eski bir kopya)"
 * deniyordu: musteriyi olmayan bir kopyayi aramaya gonderiyordu. Sahne:
 * scratchpad rv13/vf-draft-link.
 */

type Row = { id: string; siteId: string; status: string; articleId: string | null; stuckScore: number; url: string; article: Record<string, unknown> };

const WP = { id: 'wp1', type: 'WORDPRESS_REST', isActive: true };
const NOW = new Date('2026-10-19T06:00:00.000Z');
const old = new Date(NOW.getTime() - 90 * 864e5);

/** Taslak doneminden kalma yazi: kayitta yalniz ?p= adresi — takili kalici adresle hic eslesmez */
const draftEra = (i: number, score: number): Row => ({
  id: `draft-${String(i).padStart(3, '0')}`, siteId: 's1', status: 'DETECTED', articleId: `ad${i}`, stuckScore: score,
  url: `https://s.com/eski-yazi-${i}/`,
  article: {
    status: 'PUBLISHED', slug: `eski-yazi-${i}`, title: 'x', bodyMd: 'metin', publishedAt: old,
    publishedTo: [{ targetId: 'wp1', targetType: 'WORDPRESS_REST', ok: true, externalId: String(100 + i), externalUrl: `https://s.com/?p=${100 + i}`, updatedAt: old.toISOString() }],
  },
});
/** Dogrudan yayin doneminden yazi: kayitli kalici adres takili adres — yerinde guncellenebilir */
const direct = (i: number, score: number): Row => ({
  id: `direct-${i}`, siteId: 's1', status: 'DETECTED', articleId: `an${i}`, stuckScore: score,
  url: `https://s.com/yeni-yazi-${i}/`,
  article: {
    status: 'PUBLISHED', slug: `yeni-yazi-${i}`, title: 'x', bodyMd: 'metin', publishedAt: old,
    publishedTo: [{ targetId: 'wp1', targetType: 'WORDPRESS_REST', ok: true, externalId: String(500 + i), externalUrl: `https://s.com/yeni-yazi-${i}/`, updatedAt: old.toISOString() }],
  },
});

/** Prisma gibi: where (durum, makaleli, imlec OR), orderBy (puan azalan, id artan), take ve select uygulanir */
function sweepDeps(rows: Row[], extra: { liveJobs?: Record<string, string> } = {}) {
  const findMany = vi.fn(async ({ where, orderBy, take }: any) => {
    expect(orderBy).toEqual([{ stuckScore: 'desc' }, { id: 'asc' }]);
    let list = rows.filter((r) => r.siteId === where.siteId && r.status === where.status && (where.articleId?.not !== null || r.articleId !== null));
    if (where.OR) {
      list = list.filter((r) => (where.OR as any[]).some((c) => (c.stuckScore?.lt !== undefined && r.stuckScore < c.stuckScore.lt)
        || (typeof c.stuckScore === 'number' && r.stuckScore === c.stuckScore && r.id > c.id.gt)));
    }
    list.sort((a, b) => b.stuckScore - a.stuckScore || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return list.slice(0, take).map((r) => ({ id: r.id, url: r.url, stuckScore: r.stuckScore, article: r.article }));
  });
  const enqueue = vi.fn(async () => ({ dbJobId: 'j' }));
  const liveJobs = extra.liveJobs ?? {};
  const deps: any = {
    prisma: {
      site: { findMany: vi.fn(async () => [{ id: 's1', userId: 'u1', autopilot: true, publishApprovalMode: 'auto_publish', user: { plan: 'PRO' } }]) },
      stuckPage: { findMany, findFirst: vi.fn(async () => null) },
      publishTarget: { findMany: vi.fn(async () => [WP]) },
      // Bekleyen is tablosu (yalniz istenen testte)
      ...(extra.liveJobs ? {
        job: {
          findMany: vi.fn(async ({ where }: any) => (where.OR as any[])
            .map((c) => c.payload.equals)
            .filter((id: string) => liveJobs[id])
            .map((id: string) => ({ id: `job-${id}`, bullJobId: liveJobs[id], queuedAt: NOW, payload: { stuckPageId: id } }))),
        },
      } : {}),
    },
    detector: { detect: vi.fn(async () => ({ found: rows.length })) },
    jobs: { enqueue, getJobState: vi.fn(async () => 'waiting') },
    log: { log: vi.fn(), warn: vi.fn() },
    now: () => NOW,
  };
  return { deps, findMany, enqueue };
}
const queuedIds = (enqueue: any) => enqueue.mock.calls.map((c: any[]) => c[0].payload.stuckPageId);

describe('S20 — uygun olmayan yuksek puanli satirlar uygun sayfalari kilitlemez', () => {
  it('30 kalici url_mismatch (?p=) satiri 5 uygun sayfanin ustunde: 5 sayfa yine kuyruga girer', async () => {
    const rows = [
      ...Array.from({ length: 30 }, (_, i) => draftEra(i, 95 - i)),
      ...Array.from({ length: 5 }, (_, i) => direct(i, 40 - i)),
    ];
    const { deps, findMany, enqueue } = sweepDeps(rows);
    const summary = await runStuckPageSweep(deps);
    expect(summary).toMatchObject({ autoRecoveryQueued: 5, notUpdatablePages: 30 });
    expect(queuedIds(enqueue)).toEqual(['direct-0', 'direct-1', 'direct-2', 'direct-3', 'direct-4']);
    // Iki sayfa okundu (25 + 10); ikinci sayfa imlecle devam etti
    expect(findMany).toHaveBeenCalledTimes(2);
    expect(findMany.mock.calls[0][0].take).toBe(STUCK_AUTO_RECOVER_SCAN);
    expect(findMany.mock.calls[1][0].where.OR).toEqual([{ stuckScore: { lt: 71 } }, { stuckScore: 71, id: { gt: 'draft-024' } }]);
  });

  it('esit puanli satirlar imlecte kaybolmaz ve iki kez okunmaz (puan esitliginde id sirasi)', async () => {
    const rows = [
      ...Array.from({ length: 27 }, (_, i) => draftEra(i, 50)),
      direct(0, 50),
    ];
    const { deps, enqueue } = sweepDeps(rows);
    const summary = await runStuckPageSweep(deps);
    expect(queuedIds(enqueue)).toEqual(['direct-0']);
    expect(summary).toMatchObject({ autoRecoveryQueued: 1, notUpdatablePages: 27 });
  });

  it('okuma tavani: hic uygun sayfa yoksa en fazla STUCK_AUTO_RECOVER_SCAN_BUDGET satir okunur, tarama biter', async () => {
    const rows = Array.from({ length: STUCK_AUTO_RECOVER_SCAN_BUDGET + 120 }, (_, i) => draftEra(i, 99999 - i));
    const { deps, findMany, enqueue } = sweepDeps(rows);
    const summary = await runStuckPageSweep(deps);
    expect(enqueue).not.toHaveBeenCalled();
    expect(summary.notUpdatablePages).toBe(STUCK_AUTO_RECOVER_SCAN_BUDGET);
    expect(findMany).toHaveBeenCalledTimes(Math.ceil(STUCK_AUTO_RECOVER_SCAN_BUDGET / STUCK_AUTO_RECOVER_SCAN));
  });

  it('yeterince uygun sayfa bulununca okuma durur (site basina STUCK_AUTO_RECOVER_PER_SITE)', async () => {
    const rows = Array.from({ length: 60 }, (_, i) => direct(i, 90 - i));
    const { deps, findMany, enqueue } = sweepDeps(rows);
    await runStuckPageSweep(deps);
    expect(enqueue).toHaveBeenCalledTimes(STUCK_AUTO_RECOVER_PER_SITE);
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('bekleyen kurtarma isi olan sayfa (toplu onarim sirada) ikinci kez kuyruga alinmaz; siradaki uygun sayfa alinir', async () => {
    const rows = [direct(0, 90), direct(1, 80)];
    const { deps, enqueue } = sweepDeps(rows, { liveJobs: { 'direct-0': 'b-batch' } });
    const summary = await runStuckPageSweep(deps);
    expect(queuedIds(enqueue)).toEqual(['direct-1']);
    expect(summary).toMatchObject({ autoRecoveryQueued: 1, alreadyQueuedPages: 1 });
  });
});

describe('S21 — kayitli adresi yalniz WordPress ?p= baglantisi olan yazi: dogru metin', () => {
  const entry = (externalUrl: string) => ({ targetId: 'wp1', targetType: 'WORDPRESS_REST', ok: true, externalId: '41', externalUrl });

  it('taslak baglantisi (?p=41): draft_link; metin kalici adresin kayitli olmadigini soyler, "eski bir kopya" demez, musterinin yayinladigini iddia etmez', () => {
    const plan = planStuckRepublish({ publishedTo: [entry('https://site.com/?p=41')], targets: [WP], slug: 'yazi', url: 'https://site.com/yazi/' });
    expect(plan).toEqual({ kind: 'proposal', block: 'draft_link', labels: ['https://site.com/?p=41'] });
    const text = republishBlockText(plan as any, 'proposal');
    expect(text).toContain("RanksUp'ta bu yazı için yalnız WordPress'in kısa ?p= bağlantısı var (https://site.com/?p=41)");
    expect(text).toContain('yayındaki kalıcı adresi henüz kayıtlı değil');
    expect(text).toContain('yazıyı taslaktan sen yayınladıysan RanksUp onu kendiliğinden düzenlemez');
    expect(text).not.toMatch(/eski bir kopya|başka bir adreste/);
    expect(text).toContain('Öneriler kaydedildi');
    // Onizleme baglantisi ve alt dizine kurulu WordPress de ayni kural
    for (const u of ['https://site.com/?p=41&preview=true', 'https://site.com/blog/?p=41']) {
      expect(planStuckRepublish({ publishedTo: [entry(u)], targets: [WP], slug: 'yazi', url: 'https://site.com/yazi/' })).toMatchObject({ block: 'draft_link' });
    }
  });

  it('kalici adresli eski kopya (/yazi-2/) ve karisik kayitlar url_mismatch kalir; ?p= adresi takili adresin kendisiyse (duz kalici baglanti) yerinde guncellenir', () => {
    expect(planStuckRepublish({ publishedTo: [entry('https://site.com/yazi-2/')], targets: [WP], slug: 'yazi', url: 'https://site.com/yazi/' }))
      .toMatchObject({ block: 'url_mismatch' });
    const ftp = { id: 'f1', type: 'FTP', isActive: true };
    expect(planStuckRepublish({
      publishedTo: [entry('https://site.com/?p=41'), { targetId: 'f1', targetType: 'FTP', ok: true, externalUrl: 'ftp://h/public_html/arsiv/yazi.html' }],
      targets: [WP, ftp], slug: 'yazi', url: 'https://site.com/yazi/',
    })).toMatchObject({ block: 'url_mismatch' });
    expect(planStuckRepublish({ publishedTo: [entry('https://site.com/?p=41')], targets: [WP], slug: 'yazi', url: 'https://site.com/?p=41' }))
      .toEqual({ kind: 'republish', targetIds: ['wp1'], targetTypes: ['WORDPRESS_REST'] });
  });
});
