import { describe, it, expect, vi } from 'vitest';
import { ReportsService, siteSkorHucresi, kismiKarsilastirmaNotu, citationDegerlendir } from './reports.service.js';

/**
 * F25 — rapor, CSV ve dondurulmus rapor eski skoru GUNCEL diye gostermez.
 *
 * NEDEN VAR: anasayfa okunamayan tarama Audit satiri yazmaz; overview() son
 * Audit satirini erisim kaydina bakmadan aliyordu. Site 3 Eylul'de
 * RanksUpBot'u engellemeye basladiysa 1 Ekim'de dondurulan Eylul raporu
 * 28 Agustos taramasinin "Site skoru 78"ini tarihsiz yaziyordu — panel ve
 * MCP ise "olculemiyor" diyordu. Kural tek yerde: crawl-access.ts.
 */

const WAF_KAYDI = (at: string) => ({
  state: 'blocked', kind: 'waf', url: 'https://site.com/', status: 403, vendor: 'cloudflare',
  reason: 'Cloudflare güvenlik duvarı RanksUp tarayıcısını engelledi (HTTP 403).', hint: '"RanksUpBot" için izin verin.',
  at, source: 'audit',
});

const SON_DENETIM = {
  id: 'a1', ranAt: new Date('2026-08-28T10:00:00Z'), overallScore: 78, geoScore: 55, issues: [{ type: 'x' }],
  checks: {
    geo: { score: 55, blocked: null, sample: { measured: 4, blocked: 1 } },
    aiCitations: { score: 42, providers: [{ provider: 'openai', label: 'OpenAI ChatGPT', available: true, score: 42 }] },
  },
};

function fakePrisma(lastAudit: any, erisim: any, opts: { auditsInRange?: any[]; social?: number } = {}) {
  const defaults: Record<string, (...a: any[]) => any> = {
    findMany: async () => [], findFirst: async () => null, findUnique: async () => null,
    count: async () => 0, aggregate: async () => ({ _avg: {}, _sum: {} }), groupBy: async () => [],
  };
  const models: Record<string, Record<string, (...a: any[]) => any>> = {
    audit: { findFirst: async () => lastAudit, findMany: async () => opts.auditsInRange ?? [] },
    site: { findUnique: async () => ({ name: 'Site', url: 'https://site.com' }) },
    kvStore: { findUnique: async () => (erisim ? { value: JSON.stringify(erisim), expiresAt: null } : null) },
    socialPost: { findMany: async () => [], count: async () => opts.social ?? 0 },
  };
  return new Proxy({}, {
    get: (_t, model: string) => new Proxy({}, {
      get: (_m, method: string) => vi.fn(models[model]?.[method] ?? defaults[method] ?? (async () => null)),
    }),
  });
}

const EYLUL = { from: new Date('2026-09-01T00:00:00Z'), to: new Date('2026-09-30T23:59:59Z') };
const satir = (csv: string, anahtar: string) => csv.split('\n').find((l) => l.startsWith(`${anahtar},`));

describe('ReportsService.overview — denetimden sonra erisim engellendi', () => {
  it('skorlar null, neden + son basarili tarama TARIHIYLE; eski GEO engeli/orneklemi tasinmaz', async () => {
    const svc = new ReportsService(fakePrisma(SON_DENETIM, WAF_KAYDI('2026-09-03T08:00:00Z')) as never);
    const r = await svc.overview('s1', EYLUL);
    expect(r.audit.overallScore).toBeNull();
    expect(r.audit.geoScore).toBeNull();
    expect(r.audit.ranAt).toBe('2026-08-28T10:00:00.000Z');
    expect(r.audit.accessBlocked).toMatchObject({ state: 'blocked', kind: 'waf', at: '2026-09-03T08:00:00Z' });
    expect(r.audit.sonBasarili).toEqual({ ranAt: '2026-08-28T10:00:00.000Z', overallScore: 78, geoScore: 55 });
    expect(r.audit.geoBlocked).toBeNull();
    expect(r.audit.geoSample).toBeNull();
    // AI degeri de ayni denetimden: guncel diye verilmez, tarihiyle anilir
    expect(r.ai.citationScore).toBeNull();
    expect(r.ai.citationOlcumYok).toBe('Son tarama denemesi siteye erişemediği için AI ölçümü yapılmadı; son başarılı ölçüm 2026-08-28: 42/100.');
    expect(r.ai.providers).toEqual([]);
  });

  it('CSV: site_skoru ve geo_skoru "olcum yok (Erişim engellendi: …; son başarılı tarama …)"', async () => {
    const svc = new ReportsService(fakePrisma(SON_DENETIM, WAF_KAYDI('2026-09-03T08:00:00Z')) as never);
    const csv = svc.toCsv(await svc.overview('s1', EYLUL));
    expect(satir(csv, 'site_skoru')).toBe(
      'site_skoru,"olcum yok (Erişim engellendi: Cloudflare güvenlik duvarı RanksUp tarayıcısını engelledi (HTTP 403). ""RanksUpBot"" için izin verin.; son başarılı tarama 2026-08-28: 78/100)"',
    );
    expect(satir(csv, 'geo_skoru')).toContain('son başarılı tarama 2026-08-28: 55/100');
    expect(satir(csv, 'geo_orneklem')).toBeUndefined();
  });

  it('erisim denetimden ONCE kaydedilmisse (sonra duzelmis) skorlar aynen', async () => {
    const svc = new ReportsService(fakePrisma(SON_DENETIM, WAF_KAYDI('2026-08-20T08:00:00Z')) as never);
    const r = await svc.overview('s1', EYLUL);
    expect(r.audit).toMatchObject({ overallScore: 78, geoScore: 55, accessBlocked: null, sonBasarili: null });
    expect(r.ai.citationScore).toBe(42);
    expect(satir(svc.toCsv(r), 'site_skoru')).toBe('site_skoru,78');
  });

  it('donem SONRASINDAKI erisim kaydi gecmis donemin raporunu etkilemez', async () => {
    const svc = new ReportsService(fakePrisma(SON_DENETIM, WAF_KAYDI('2026-10-05T08:00:00Z')) as never);
    const r = await svc.overview('s1', EYLUL);
    expect(r.audit.overallScore).toBe(78);
    expect(r.audit.accessBlocked).toBeNull();
  });

  it('hic puanli denetim yok ama denemeler engelli: "—" degil neden', async () => {
    const svc = new ReportsService(fakePrisma(null, WAF_KAYDI('2026-09-03T08:00:00Z')) as never);
    const r = await svc.overview('s1', EYLUL);
    expect(r.audit.accessBlocked).toBeTruthy();
    expect(r.audit.sonBasarili).toBeNull();
    expect(satir(svc.toCsv(r), 'site_skoru')).toContain('olcum yok (Erişim engellendi:');
  });

  it('bu alanlardan once dondurulmus govde: CSV eski ciktisini korur', () => {
    expect(siteSkorHucresi({ overallScore: null })).toBe('olcum yok');
    expect(siteSkorHucresi({ overallScore: 64 })).toBe(64);
  });
});

describe('Rapor — olculemeyen sorunlar ve kismi karsilastirma (F5)', () => {
  const denetim = (id: string, ranAt: string, checks: any, issues: any[]) => ({ id, ranAt: new Date(ranAt), overallScore: 70, geoScore: null, checks, issues });

  it('olculemeyenSayisi ve CSV olculemeyen_sorun + kismi_karsilastirma satiri; cozulen_sorun sismez', async () => {
    const ilk = denetim('a', '2026-09-02T00:00:00Z', { llms_txt: { score: 30 } }, [{ type: 'llms_missing', checkId: 'llms_txt' }]);
    const son = denetim('b', '2026-09-28T00:00:00Z', { llms_txt: { score: 0, details: { unverified: true } } }, []);
    const svc = new ReportsService(fakePrisma(son, null, { auditsInRange: [ilk, son] }) as never);
    const r = await svc.overview('s1', EYLUL);
    expect(r.audit).toMatchObject({ cozulenSayisi: 0, olculemeyenSayisi: 1 });
    const csv = svc.toCsv(r);
    expect(satir(csv, 'cozulen_sorun')).toBe('cozulen_sorun,0');
    expect(satir(csv, 'olculemeyen_sorun')).toBe('olculemeyen_sorun,1');
    expect(satir(csv, 'kismi_karsilastirma')).toContain('son taramada ölçülemeyen kontroller: llms_txt');
  });

  it('kismiKarsilastirmaNotu: tam karsilastirmada ve eski raporda null', () => {
    expect(kismiKarsilastirmaNotu(null)).toBeNull();
    expect(kismiKarsilastirmaNotu({ ozet: { cozulenSayisi: 0, yeniSayisi: 0, devamEdenSayisi: 0, olculemeyenSayisi: 0 } } as any)).toBeNull();
  });
});

describe('CSV — sosyal_post sutunu (K10)', () => {
  it('sosyal modul kaldirildi: yeni raporda sutun ve ozet satiri yok', async () => {
    const svc = new ReportsService(fakePrisma(null, null) as never);
    const csv = svc.toCsv(await svc.overview('s1', EYLUL));
    expect(csv).not.toContain('sosyal_post');
    expect(csv).toContain('tarih,yayinlanan_makale,tiklama,gosterim');
  });

  it('modul varken dondurulmus eski rapor degerini korur', async () => {
    const svc = new ReportsService(fakePrisma(null, null) as never);
    const r = await svc.overview('s1', EYLUL);
    const eski = { ...r, social: { ...r.social, posts: 3 }, timeSeries: { ...r.timeSeries, socialPosts: r.timeSeries.dates.map((_, i) => (i === 0 ? 3 : 0)) } };
    const csv = svc.toCsv(eski);
    expect(satir(csv, 'sosyal_post')).toBe('sosyal_post,3');
    expect(csv).toContain('tarih,yayinlanan_makale,sosyal_post,tiklama,gosterim');
  });
});

describe('citationDegerlendir — atlanan olcum (F6)', () => {
  it('skipped nedeni aynen; eski "score 0, providers []" kaydi 0 degil', () => {
    expect(citationDegerlendir({ score: null, providers: [], skipped: { code: 'WEEKLY_MEASUREMENT_LIMIT', message: 'Haftalık AI ölçüm hakkı kullanıldığı için bu taramada AI ölçümü yapılmadı.' } }))
      .toEqual({ skor: null, olcumYok: 'Haftalık AI ölçüm hakkı kullanıldığı için bu taramada AI ölçümü yapılmadı.' });
    expect(citationDegerlendir({ score: 0, providers: [] })).toEqual({ skor: null, olcumYok: 'Bu taramada AI ölçümü yapılmadı.' });
  });
});
