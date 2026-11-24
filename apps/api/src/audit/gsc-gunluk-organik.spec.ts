import { describe, it, expect, vi } from 'vitest';
import { GscSitemapRefreshService } from './gsc-sitemap-refresh.service.js';
import { organicRows, promptRunRows } from './prompt-run-rows.js';
import { buildLatestRun } from './prompt-latest-run.js';

/**
 * 24.11.2026:
 *  1. Gunluk site haritasi yenilemesi — yalniz Search Console'da KAYITLI ve
 *     son gonderimden sonra degisen site haritalari gonderilir.
 *  2. Google organik sira AI Bakisi cikmayan aramada da kaydedilir.
 */

type Sm = { path: string; lastSubmitted?: string; isPending?: boolean };

function kur(sitemaps: Sm[], dosyalar: Record<string, string>) {
  const submit = vi.fn().mockResolvedValue({});
  const gsc = { getAuthenticatedClient: vi.fn().mockResolvedValue({}) };
  const svc = new GscSitemapRefreshService({} as never, gsc as never);
  const s = svc as any;
  s.webmasters = () => ({ sitemaps: { list: vi.fn().mockResolvedValue({ data: { sitemap: sitemaps } }), submit } });
  s.fetchText = vi.fn(async (u: string) => (u in dosyalar ? { ok: true, text: dosyalar[u] } : { ok: false, text: '' }));
  s.bekle = async () => {};
  return { svc, submit, fetchText: s.fetchText };
}

const site = { id: 's1', url: 'https://kobipratik.com', gscPropertyUrl: 'sc-domain:kobipratik.com' };
const urlset = (d: string) => `<urlset><url><loc>x</loc><lastmod>${d}</lastmod></url></urlset>`;

describe('gunluk site haritasi yenilemesi', () => {
  it('dizin + alt harita: alt haritada son gonderimden yeni tarih varsa gonderir', async () => {
    const { svc, submit } = kur(
      [{ path: 'https://www.kobipratik.com/sitemap.xml', lastSubmitted: '2026-11-24T16:04:15Z' }],
      {
        'https://www.kobipratik.com/sitemap.xml': '<sitemapindex><sitemap><loc>https://www.kobipratik.com/sitemap-full.xml</loc></sitemap><sitemap><loc>https://baska.com/s.xml</loc></sitemap></sitemapindex>',
        'https://www.kobipratik.com/sitemap-full.xml': urlset('2026-11-25'),
      },
    );
    const r = await svc.refreshSite(site);
    expect(r).toEqual([expect.objectContaining({ eylem: 'gonderildi' })]);
    expect(submit).toHaveBeenCalledWith({ siteUrl: 'sc-domain:kobipratik.com', feedpath: 'https://www.kobipratik.com/sitemap.xml' });
  });

  it('degismediyse gondermez', async () => {
    const { svc, submit } = kur(
      [{ path: 'https://www.kobipratik.com/sitemap-full.xml', lastSubmitted: '2026-11-24T16:04:15Z' }],
      { 'https://www.kobipratik.com/sitemap-full.xml': urlset('2026-11-24') },
    );
    expect((await svc.refreshSite(site))[0].eylem).toBe('degismedi');
    expect(submit).not.toHaveBeenCalled();
  });

  it('llms.txt, .gz, baska alan adi, siradaki ve okunamayan kayitlara dokunmaz', async () => {
    const { svc, submit, fetchText } = kur([
      { path: 'https://kobipratik.com/llms.txt', lastSubmitted: '2026-06-20T00:00:00Z' },
      { path: 'https://kobipratik.com/s.xml.gz', lastSubmitted: '2026-06-20T00:00:00Z' },
      { path: 'https://baska.com/sitemap.xml', lastSubmitted: '2026-06-20T00:00:00Z' },
      { path: 'https://kobipratik.com/bekleyen.xml', lastSubmitted: '2026-06-20T00:00:00Z', isPending: true },
      { path: 'https://kobipratik.com/yok.xml', lastSubmitted: '2026-06-20T00:00:00Z' },
    ], {});
    const r = await svc.refreshSite(site);
    expect(r.map((x) => x.eylem)).toEqual(['atlandi', 'atlandi', 'atlandi', 'atlandi', 'atlandi']);
    expect(r[4].neden).toBe('site haritası okunamadı');
    expect(submit).not.toHaveBeenCalled();
    expect(fetchText).toHaveBeenCalledTimes(1); // yalniz yok.xml denendi
  });

  it('Search Console bagli degilse hicbir sey yapmaz', async () => {
    const { svc } = kur([], {});
    (svc as any).gsc.getAuthenticatedClient = vi.fn().mockResolvedValue(null);
    expect(await svc.refreshSite(site)).toEqual([]);
  });

  it('runAll: bir sitenin hatasi digerlerini durdurmaz, ozet doner', async () => {
    const { svc } = kur([{ path: 'https://www.kobipratik.com/sitemap-full.xml', lastSubmitted: '2026-11-24T16:00:00Z' }], { 'https://www.kobipratik.com/sitemap-full.xml': urlset('2026-11-25') });
    (svc as any).prisma = { site: { findMany: vi.fn().mockResolvedValue([{ id: 'bozuk', url: 'https://kobipratik.com', gscPropertyUrl: 'x' }, site]) } };
    const asil = svc.refreshSite.bind(svc);
    svc.refreshSite = vi.fn(async (s: any) => { if (s.id === 'bozuk') throw new Error('token'); return asil(s); });
    expect(await svc.runAll({ siteArasiMs: 0 })).toEqual({ site: 2, gonderildi: 1, degismedi: 0, atlandi: 0, hata: 1 });
  });
});

describe('Google organik sira — AI Bakisi cikmayan arama dahil', () => {
  const yok = { query: 'q', cited: false, brandMentioned: false, excerpt: 'YOK: Google bu aramada AI Bakışı göstermedi.', surfaceAbsent: true as const, googleOrganic: { rank: 4, knowledgePanel: null } };

  it('YOK satiri olcum satiri olmaz ama organik sira yazilir', () => {
    const rows = [{ provider: 'google_ai_overview', probe: yok }];
    expect(promptRunRows('s', 'p', null, new Date('2026-11-24'), rows)).toHaveLength(0);
    expect(organicRows('s', 'p', null, new Date('2026-11-24'), rows)).toEqual([
      { siteId: 's', promptId: 'p', date: new Date('2026-11-24'), rank: 4, knowledgePanel: null, aiOverview: false },
    ]);
  });

  it('fan-out dali ve diger saglayicilar yazilmaz', () => {
    expect(organicRows('s', 'p', 'f1', new Date(), [{ provider: 'google_ai_overview', probe: yok }])).toEqual([]);
    expect(organicRows('s', 'p', null, new Date(), [{ provider: 'openai', probe: yok }])).toEqual([]);
  });

  it('son olcum gorunumu: tablo kaydi oncelikli, yoksa AI Bakisi satirindaki alan', () => {
    const satir = {
      provider: 'google_ai_overview', date: new Date('2026-11-24'), createdAt: new Date(), cited: false, brandMentioned: false,
      brandInQuery: false, position: null, sentiment: null, excerpt: null, competitors: null, sources: null, sourcesVersion: null,
      googleOrganic: { rank: 2, knowledgePanel: null },
    };
    const ctx = { ownHost: 'kobipratik.com', competitors: [] };
    expect(buildLatestRun([satir], ctx, {}, { rank: 7, knowledgePanel: null, aiOverview: false }).googleOrganic).toEqual({ rank: 7, knowledgePanel: null, aiOverview: false });
    expect(buildLatestRun([satir], ctx, {}).googleOrganic).toEqual({ rank: 2, knowledgePanel: null, aiOverview: true });
    expect(buildLatestRun([{ ...satir, provider: 'openai', googleOrganic: undefined }], ctx, {}).googleOrganic).toBeNull();
  });
});
