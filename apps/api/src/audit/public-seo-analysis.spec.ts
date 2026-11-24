import { describe, it, expect, vi } from 'vitest';
import { analizOzeti, hizCumlesi, hizOzeti, IP_GUNLUK, GLOBAL_GUNLUK, KONTROL_ADI_TR } from './public-seo-analysis.js';
import { PublicSeoAnalysisService, PUBLIC_SEO_JOB, eposta } from './public-seo-analysis.service.js';
import { isObviousBotUa } from './public-seo-analysis.controller.js';
import { OVERALL_SCORE_WEIGHTS, type CheckResult } from './audit-checks.service.js';

const check = (id: string, score: number, issues: CheckResult['issues'] = [], details?: Record<string, unknown>): CheckResult =>
  ({ id, name: id, found: true, valid: score >= 90, score, issues, details });

describe('ucretsiz SEO analizi — ozet', () => {
  it('puanli kontrollerde puan, bilgi ve olculemeyende null; Turkce ad', () => {
    const o = analizOzeti({
      domain: 'ornek.com', url: 'https://ornek.com/', puan: 71.6, taranan: 7, psi: null,
      checks: [
        check('meta_title', 80, [{ severity: 'warning', type: 'meta_title_long', description: 'Uzun başlık', fixable: false }]),
        check('llms_txt', 0),
        check('robots_txt', 0, [], { unverified: true }),
      ],
      puanliKontroller: new Set(Object.keys(OVERALL_SCORE_WEIGHTS)),
    });
    expect(o.puan).toBe(72);
    expect(o.kontroller.map((k) => [k.id, k.puan])).toEqual([['meta_title', 80], ['llms_txt', null], ['robots_txt', null]]);
    expect(o.kontroller[0].ad).toBe(KONTROL_ADI_TR.meta_title);
  });

  it('oncelikli: once kritik sonra uyari, bilgi yok, en fazla 12', () => {
    const issues = (sev: 'critical' | 'warning' | 'info', n: number) =>
      Array.from({ length: n }, (_, i) => ({ severity: sev, type: 't', description: `${sev}${i}`, fixable: false }));
    const o = analizOzeti({
      domain: 'a.com', url: 'https://a.com/', puan: 50, taranan: 3, psi: null,
      checks: [check('https', 40, [...issues('info', 3), ...issues('warning', 8)]), check('sitemap_xml', 0, issues('critical', 6))],
      puanliKontroller: new Set(['https', 'sitemap_xml']),
    });
    expect(o.oncelikli).toHaveLength(12);
    expect(o.oncelikli.slice(0, 6).every((b) => b.severity === 'critical')).toBe(true);
    expect(o.oncelikli.some((b) => b.severity === 'info')).toBe(false);
  });

  it('hiz: saha verisi varsa cumle onu soyler; yoksa laboratuvar puani', () => {
    const saha = { kapsam: 'site' as const, genel: 'FAST' as const, lcpMs: 1992, inpMs: 190, cls: 0, fcpMs: 1000, ttfbMs: 900, gecti: true };
    const h = hizOzeti({ performanceScore: 62, lcp: 4123.4, cls: 0.0123, tbt: 310.6, field: saha });
    expect(h).toMatchObject({ puan: 62, lcpMs: 4123, cls: 0.012, tbtMs: 311, sahaGecti: true });
    expect(hizCumlesi(h)).toMatch(/geçiyor .*2,0 sn/);
    expect(hizCumlesi(hizOzeti({ performanceScore: 38, field: null }))).toMatch(/laboratuvar .*38\/100/);
    expect(hizOzeti(null)).toBeNull();
  });

  it('bot suzgeci', () => {
    expect(isObviousBotUa('curl/8.0')).toBe(true);
    expect(isObviousBotUa('')).toBe(true);
    expect(isObviousBotUa('Mozilla/5.0 (Macintosh) Chrome/131')).toBe(false);
  });
});

describe('ucretsiz SEO analizi — servis', () => {
  function kur(opts: { son?: any; ipAlanlari?: number; bugun?: number } = {}) {
    const prisma: any = {
      publicSeoAnalysis: {
        findFirst: vi.fn().mockResolvedValue(opts.son ?? null),
        findMany: vi.fn().mockResolvedValue(Array.from({ length: opts.ipAlanlari ?? 0 }, (_, i) => ({ domain: `d${i}.com` }))),
        count: vi.fn().mockResolvedValue(opts.bugun ?? 0),
        create: vi.fn().mockImplementation(async ({ data }: any) => ({ id: 'c'.repeat(25), status: 'queued', result: null, error: null, createdAt: new Date(), ...data })),
        update: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn(),
      },
      user: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const queue: any = { enqueueSystem: vi.fn().mockResolvedValue({ bullJobId: '1' }) };
    const svc = new PublicSeoAnalysisService(prisma, queue, {} as any, {} as any, {} as any, {} as any);
    return { svc, prisma, queue };
  }

  it('onbellek: ziyaretciye kendi kopya kaydi acilir; yeni is yok, sinira sayilmaz, sonuc e-postasiz donmez', async () => {
    const son = { id: 'x'.repeat(25), domain: 'ornek.com', status: 'done', result: { puan: 70 }, error: null, createdAt: new Date() };
    const { svc, prisma, queue } = kur({ son, ipAlanlari: 99 });
    const d = await svc.start('ornek.com', '1.2.3.4');
    expect(d).toMatchObject({ status: 'done', result: null, emailVar: false });
    expect(prisma.publicSeoAnalysis.create.mock.calls[0][0].data).toMatchObject({ onbellek: true, status: 'done', result: { puan: 70 } });
    expect(queue.enqueueSystem).not.toHaveBeenCalled();
  });

  it('sinir sayimlari onbellek kopyalarini disarida birakir', async () => {
    const { svc, prisma } = kur();
    await svc.start('ornek.com', '1.2.3.4').catch(() => undefined);
    expect(prisma.publicSeoAnalysis.findMany.mock.calls[0][0].where).toMatchObject({ onbellek: false });
    expect(prisma.publicSeoAnalysis.count.mock.calls[0][0].where).toMatchObject({ onbellek: false });
  });

  it('e-posta: gecersiz 400; gecerli yazilir, sonuc doner, ticari izin yalniz true ise', async () => {
    const { svc, prisma } = kur();
    const id = 'z'.repeat(25);
    const row = { id, domain: 'ornek.com', status: 'done', result: { puan: 80 }, error: null, createdAt: new Date(), email: null as string | null };
    prisma.publicSeoAnalysis.findUnique.mockResolvedValue(row);
    prisma.publicSeoAnalysis.update.mockImplementation(async ({ data }: any) => { Object.assign(row, data); return row; });
    await expect(svc.setEmail(id, 'yanlis', false)).rejects.toMatchObject({ status: 400 });
    const d = await svc.setEmail(id, '  Ali@Ornek.COM ', 'evet');
    expect(prisma.publicSeoAnalysis.update.mock.calls[0][0].data).toEqual({ email: 'ali@ornek.com', pazarlamaIzni: false });
    expect(d).toMatchObject({ emailVar: true, result: { puan: 80 } });
  });

  it(`IP basina ${IP_GUNLUK} alan adi siniri 429, genel tavan ${GLOBAL_GUNLUK} 503`, async () => {
    await expect(kur({ ipAlanlari: IP_GUNLUK }).svc.start('ornek.com', '1.2.3.4')).rejects.toMatchObject({ status: 429 });
    await expect(kur({ bugun: GLOBAL_GUNLUK }).svc.start('ornek.com', '1.2.3.4')).rejects.toMatchObject({ status: 503 });
  });

  it('gecersiz ya da ic adres 400', async () => {
    await expect(kur().svc.start('localhost', '1.2.3.4')).rejects.toMatchObject({ status: 400 });
    await expect(kur().svc.start('http://127.0.0.1', '1.2.3.4')).rejects.toMatchObject({ status: 400 });
  });

  it('get: bicimsiz kimlik null; takilmis kayit hata olarak doner', async () => {
    const { svc, prisma } = kur();
    expect(await svc.get('../etc')).toBeNull();
    prisma.publicSeoAnalysis.findUnique.mockResolvedValue({ id: 'y'.repeat(25), domain: 'a.com', status: 'running', result: null, error: null, createdAt: new Date(Date.now() - 60 * 60_000) });
    expect((await svc.get('y'.repeat(25)))?.status).toBe('error');
  });

  it('is adi worker ile ayni', () => {
    expect(PUBLIC_SEO_JOB).toBe('PUBLIC_SEO_ANALYSIS');
  });
});

describe('ucretsiz SEO analizi — modul kaydi', () => {
  // 25.11.2026: denetleyici modulun controllers listesine eklenmemisti (metin degisimi eslesmedi);
  // birim testleri servisi dogrudan kurdugu icin yakalamadi, canlida 404 verdi.
  it('denetleyici ve servis AuditModule metadata\'sinda', async () => {
    const { AuditModule } = await import('./audit.module.js');
    const { PublicSeoAnalysisController } = await import('./public-seo-analysis.controller.js');
    expect(Reflect.getMetadata('controllers', AuditModule)).toContain(PublicSeoAnalysisController);
    expect(Reflect.getMetadata('providers', AuditModule)).toContain(PublicSeoAnalysisService);
  });
});

describe('ucretsiz SEO analizi — yonetici satiri', () => {
  it('sonuc ozetinden puan, hiz ve bulgu sayilari; ham IP yok', async () => {
    const { yoneticiSatiri } = await import('./public-seo-analysis.js');
    const s = yoneticiSatiri({
      id: 'a', domain: 'ornek.com', status: 'done', createdAt: new Date('2026-11-25T10:00:00Z'), ipHash: 'abcdef1234567890',
      result: {
        puan: 71, taranan: 9, engel: null, hiz: { puan: 40, sahaGecti: false },
        kontroller: [{ bulgular: [{ severity: 'critical' }, { severity: 'warning' }, { severity: 'warning' }, { severity: 'info' }] }],
      },
    });
    expect(s).toMatchObject({ puan: 71, taranan: 9, hizPuani: 40, sahaGecti: false, kritik: 1, uyari: 2, ip: 'abcdef12' });
    expect(yoneticiSatiri({ id: 'b', domain: 'x.com', status: 'queued', createdAt: new Date(), ipHash: '', result: null }))
      .toMatchObject({ puan: null, kritik: 0, uyari: 0, engel: null });
  });
});

describe('ucretsiz SEO analizi — e-posta bicimi', () => {
  it('gecerli / gecersiz', () => {
    expect(eposta('ali@ornek.com')).toBe('ali@ornek.com');
    expect(eposta('ALI@Ornek.com.tr')).toBe('ali@ornek.com.tr');
    for (const x of ['ali', 'ali@', '@ornek.com', 'ali@ornek', 'a b@ornek.com', 42, null]) expect(eposta(x)).toBeNull();
  });
});
