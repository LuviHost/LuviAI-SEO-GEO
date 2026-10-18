import { describe, it, expect, vi } from 'vitest';
import { ReportsService, geoAccessFromChecks, geoSkorHucresi, geoOrneklemNotu } from './reports.service.js';

/**
 * Rapor — GEO olcumu erisim engeline takildiginda NEDEN raporla birlikte gelir.
 *
 * NEDEN VAR: report.audit yalniz geoScore donuyordu; engelli taramada null
 * kaliyor, panel nedeni canli SiteContext'teki checks.geo'dan okuyordu.
 * Dondurulmus raporda o, raporun degil bugunun taramasidir; CSV'de ise GEO
 * hucresi nedensiz "olcum yok" kaliyordu. Alanlar (geoBlocked / geoSample)
 * son taramanin checks.geo JSON'undan gelir ve rapor govdesiyle birlikte donar.
 */

const WAF = {
  kind: 'waf', vendor: 'cloudflare', status: 403,
  reason: 'Cloudflare güvenlik duvarı RanksUp tarayıcısını engelledi (HTTP 403).',
  hint: '"RanksUpBot" için izin verin.',
  url: 'https://site.com',
};

/** Bilinmeyen her prisma cagrisina bos ama gecerli cevap; testin konusu olanlar ayrica verilir */
function fakePrisma(lastAudit: any) {
  const defaults: Record<string, (...a: any[]) => any> = {
    findMany: async () => [], findFirst: async () => null, findUnique: async () => null,
    count: async () => 0, aggregate: async () => ({ _avg: {}, _sum: {} }), groupBy: async () => [],
  };
  const models: Record<string, Record<string, (...a: any[]) => any>> = {
    audit: { findFirst: async () => lastAudit },
    site: { findUnique: async () => ({ name: 'Site', url: 'https://site.com' }) },
  };
  return new Proxy({}, {
    get: (_t, model: string) => new Proxy({}, {
      get: (_m, method: string) => vi.fn(models[model]?.[method] ?? defaults[method] ?? (async () => null)),
    }),
  });
}

const overview = (lastAudit: any) =>
  new ReportsService(fakePrisma(lastAudit) as never).overview('s1', { from: new Date('2026-10-01'), to: new Date('2026-10-31') });

describe('ReportsService.overview — audit.geoBlocked / geoSample', () => {
  it('engelli GEO taramasi: geoScore null, neden ve cozum geoBlocked\'ta', async () => {
    const r = await overview({
      overallScore: 70, geoScore: null, issues: [],
      checks: { geo: { score: null, methods: [], queries: [], blocked: { ...WAF, ekAlan: 'tasinmaz' }, sample: { measured: 0, blocked: 1 } } },
    });
    expect(r.audit.geoScore).toBeNull();
    expect(r.audit.geoBlocked).toEqual(WAF);
    expect(r.audit.geoSample).toEqual({ measured: 0, blocked: 1 });
  });

  it('kismen engelli orneklem: skor var, geoBlocked null, geoSample dolu', async () => {
    const r = await overview({ overallScore: 70, geoScore: 62, issues: [], checks: { geo: { score: 62, blocked: null, sample: { measured: 3, blocked: 2 } } } });
    expect(r.audit).toMatchObject({ geoScore: 62, geoBlocked: null, geoSample: { measured: 3, blocked: 2 } });
  });

  it('checks.geo tasimayan eski tarama ve hic tarama yok: ikisi de null (engel uydurulmaz)', async () => {
    expect((await overview({ overallScore: 50, geoScore: 40, issues: [], checks: {} })).audit).toMatchObject({ geoBlocked: null, geoSample: null });
    expect((await overview(null)).audit).toMatchObject({ geoScore: null, geoBlocked: null, geoSample: null });
  });
});

describe('geoAccessFromChecks', () => {
  it('bozuk JSON patlamaz, null doner', () => {
    expect(geoAccessFromChecks(null)).toEqual({ blocked: null, sample: null });
    expect(geoAccessFromChecks({ geo: { blocked: { kind: 'waf' }, sample: { measured: 'x', blocked: 1 } } })).toEqual({ blocked: null, sample: null });
    expect(geoAccessFromChecks({ geo: { blocked: 'metin' } })).toEqual({ blocked: null, sample: null });
  });
});

describe('CSV — GEO hucresi bos kalmaz, neden yazilir (canli ve dondurulmus rapor ayni toCsv)', () => {
  const satir = (csv: string, anahtar: string) => csv.split('\n').find((l) => l.startsWith(`${anahtar},`));

  it('engelde "olcum yok (neden + cozum)"; tirnak iceren ipucu tek hucrede kalir', async () => {
    const svc = new ReportsService(fakePrisma(null) as never);
    const r = await svc.overview('s1', { from: new Date('2026-10-01'), to: new Date('2026-10-31') });
    const csv = svc.toCsv({ ...r, audit: { ...r.audit, geoScore: null, geoBlocked: WAF as any, geoSample: { measured: 0, blocked: 1 } } });
    expect(satir(csv, 'geo_skoru')).toBe(
      'geo_skoru,"olcum yok (Cloudflare güvenlik duvarı RanksUp tarayıcısını engelledi (HTTP 403). ""RanksUpBot"" için izin verin.)"',
    );
    expect(satir(csv, 'geo_orneklem')).toBeUndefined();
  });

  it('skor varsa sayi; orneklemin bir kismi engelliyse ayri not satiri', async () => {
    const svc = new ReportsService(fakePrisma(null) as never);
    const r = await svc.overview('s1', { from: new Date('2026-10-01'), to: new Date('2026-10-31') });
    const csv = svc.toCsv({ ...r, audit: { ...r.audit, geoScore: 62, geoBlocked: null, geoSample: { measured: 3, blocked: 2 } } });
    expect(satir(csv, 'geo_skoru')).toBe('geo_skoru,62');
    expect(satir(csv, 'geo_orneklem')).toBe('geo_orneklem,2 sayfa erişim engeline takıldı; skor 3 sayfadan hesaplandı.');
  });

  it('bu alanlardan ONCE dondurulmus govde (geoBlocked yok) eskisi gibi "olcum yok"', async () => {
    const svc = new ReportsService(fakePrisma(null) as never);
    const r: any = await svc.overview('s1', { from: new Date('2026-10-01'), to: new Date('2026-10-31') });
    const eskiAudit = { ...r.audit };
    delete eskiAudit.geoBlocked;
    delete eskiAudit.geoSample;
    const csv = svc.toCsv({ ...r, audit: eskiAudit });
    expect(satir(csv, 'geo_skoru')).toBe('geo_skoru,olcum yok');
    expect(satir(csv, 'geo_orneklem')).toBeUndefined();
  });

  it('yardimcilar: skor varken engel metni yazilmaz; olculen sayfa yoksa orneklem notu yok', () => {
    expect(geoSkorHucresi({ geoScore: 0, geoBlocked: WAF as any })).toBe(0);
    expect(geoSkorHucresi({ geoScore: null, geoBlocked: { ...WAF, hint: '' } as any })).toBe(`olcum yok (${WAF.reason})`);
    expect(geoOrneklemNotu({ geoScore: null, geoSample: { measured: 0, blocked: 1 } })).toBeNull();
    expect(geoOrneklemNotu({ geoScore: 70, geoSample: { measured: 4, blocked: 0 } })).toBeNull();
  });
});
