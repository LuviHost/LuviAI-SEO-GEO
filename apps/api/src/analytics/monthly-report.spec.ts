import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  MONTHLY_EDGE_TOLERANCE_DAYS, MONTHLY_REPORT_MAX_SITES_PER_USER, gunAy, monthlyReportData, oncekiAy, type MonthlyOverview,
} from './monthly-report.js';
import { MONTHLY_REPORT_CRON, MONTHLY_REPORT_DEMO_URL, MonthlyReportCron, monthlySentKey } from './monthly-report.cron.js';
import { ReportsService, donemHesapla } from './reports.service.js';
import { EmailService, type EmailTemplate } from '../email/email.service.js';

/**
 * Aylik rapor e-postasi GONDERILIR (15.11.2026, sahip: "gönderilmeyen mailler vardı, bunları da
 * bağlamamız gerekli").
 *
 * NEDEN VAR: `monthly_report` sablonu ve otomatik rapor alani (SiteReport.trigger = 'cron')
 * vardi; ikisini calistiran kod yoktu. Bu spec baglantinin kurallarini sabitler:
 *  - donem onceki takvim ayi, UTC gun sinirlariyla; kiyas ayni uzunluktaki hemen onceki donem,
 *  - rapor dondurulur, e-posta o rapora baglanir ve ayni sayilari soyler,
 *  - olculemeyen 0 gosterilmez; yarim olculmus donemle kiyas yapilmaz; hareketsiz siteye e-posta
 *    gitmez,
 *  - kilitli, hesap basina sinirli, bir sitenin hatasi digerlerini durdurmaz, yarida kalan tur
 *    sonraki gun tamamlanir ve ayni siteye iki kez gitmez.
 */

const EKIM = { windowFrom: '2026-10-01', windowTo: '2026-10-31' };
const ozet = (o: Partial<{
  clicks: number; impressions: number; delta: number | null; prevVar: boolean; prevTam: boolean;
  from: string | null; to: string | null;
  citation: number | null; seo: number | null; geo: number | null; tarama: number; makale: number;
}> = {}): MonthlyOverview => ({
  search: {
    totalClicks: o.clicks ?? 0, totalImpressions: o.impressions ?? 0,
    clicksDelta: o.delta === undefined ? null : o.delta,
    oncekiDonemVeriVar: o.prevVar ?? (o.delta !== undefined && o.delta !== null),
    oncekiDonemTam: o.prevTam ?? (o.delta !== undefined && o.delta !== null),
    coverage: { ...EKIM, from: o.from === undefined ? '2026-10-01' : o.from, to: o.to === undefined ? '2026-10-31' : o.to },
  },
  ai: { citationScore: o.citation === undefined ? null : o.citation },
  audit: { overallScore: o.seo === undefined ? null : o.seo, geoScore: o.geo === undefined ? null : o.geo, kullaniciTaramaSayisi: o.tarama ?? 0 },
  articles: { published: o.makale ?? 0 },
});
const SITE = { id: 's1', name: 'Örnek Klinik' };
const DONEM = { label: 'Ekim 2026', days: 31 };

describe('oncekiAy — onceki takvim ayi', () => {
  it('ayin 4\'u 09:00 Turkiye: bir onceki ay, UTC gun sinirlariyla', () => {
    const d = oncekiAy(new Date('2026-11-04T06:00:00Z'));
    expect(d).toMatchObject({ label: 'Ekim 2026', key: '2026-10', days: 31 });
    expect(d.from.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(d.to.toISOString()).toBe('2026-10-31T23:59:59.999Z');
  });

  it('yil donumu ve subat', () => {
    const aralik = oncekiAy(new Date('2027-01-04T06:00:00Z'));
    expect(aralik).toMatchObject({ label: 'Aralık 2026', key: '2026-12', days: 31 });
    expect(aralik.from.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    const subat = oncekiAy(new Date('2027-03-04T06:00:00Z'));
    expect(subat).toMatchObject({ label: 'Şubat 2027', key: '2027-02', days: 28 });
    expect(subat.to.toISOString()).toBe('2027-02-28T23:59:59.999Z');
  });

  it('ayin 4–7\'sindeki dort tur da AYNI donemi ve anahtari verir (tekrar gonderim kaydi tutarli)', () => {
    const anahtarlar = [4, 5, 6, 7].map((g) => oncekiAy(new Date(`2026-11-0${g}T06:00:00Z`)).key);
    expect(new Set(anahtarlar)).toEqual(new Set(['2026-10']));
  });

  it('hangi ayin "onceki" oldugu Turkiye saatine gore: UTC\'de hala ayin son gunu olsa da', () => {
    // 30 Kasim 22:00 UTC = 1 Aralik 01:00 Turkiye → onceki ay Kasim
    expect(oncekiAy(new Date('2026-11-30T22:00:00Z')).label).toBe('Kasım 2026');
    expect(oncekiAy(new Date('2026-11-30T20:00:00Z')).label).toBe('Ekim 2026');
  });

  it('rapor servisi bu donemi 31 gun sayar; onceki donem ayni uzunlukta ve ortak gunu yok', () => {
    const d = oncekiAy(new Date('2026-11-04T06:00:00Z'));
    const r = donemHesapla({ from: d.from, to: d.to });
    const gun = (x: Date) => x.toISOString().slice(0, 10);
    expect(r.days).toBe(d.days);
    expect([gun(r.rangeStart), gun(r.rangeEnd)]).toEqual(['2026-10-01', '2026-10-31']);
    // Kiyas onceki TAKVIM AYI degil, onceki 31 gun: e-posta da "önceki 31 güne göre" der
    expect([gun(r.prevStart), gun(r.prevEnd)]).toEqual(['2026-08-31', '2026-09-30']);
  });

  it('gunAy', () => {
    expect(gunAy('2026-10-14')).toBe('14 Ekim');
    expect(gunAy('2027-02-01')).toBe('1 Şubat');
  });
});

describe('ReportsService.overview — yarim olculmus onceki donemle fark verilmez', () => {
  // Onceki donem 31 Agustos – 30 Eylul; Ekim tam
  const ekimGunleri = Array.from({ length: 31 }, (_, i) => ({ date: new Date(Date.UTC(2026, 9, i + 1)), totalClicks: 40, totalImpressions: 1000, avgPosition: 10, queryDetails: [], pageDetails: [] }));
  const eylulSon7 = Array.from({ length: 7 }, (_, i) => ({ date: new Date(Date.UTC(2026, 8, 24 + i)), totalClicks: 40, totalImpressions: 1000, avgPosition: 10, queryDetails: [], pageDetails: [] }));

  function fakePrisma(prev: any[], oncesindeOlcumVar: boolean) {
    const defaults: Record<string, (...a: any[]) => any> = {
      findMany: async () => [], findFirst: async () => null, findUnique: async () => null,
      count: async () => 0, aggregate: async () => ({ _avg: {}, _sum: {} }), groupBy: async () => [],
    };
    const snapshotFindFirst = vi.fn(async () => (oncesindeOlcumVar ? { id: 'eski' } : null));
    const models: Record<string, Record<string, (...a: any[]) => any>> = {
      site: { findUnique: async () => ({ name: 'Site', url: 'https://site.com' }) },
      analyticsSnapshot: {
        findMany: async ({ where }: any) => (where.date.gte.getTime() >= Date.UTC(2026, 9, 1) ? ekimGunleri : prev),
        findFirst: snapshotFindFirst,
      },
    };
    const prisma = new Proxy({}, {
      get: (_t, model: string) => new Proxy({}, { get: (_m, method: string) => models[model]?.[method] ?? defaults[method] }),
    });
    return { prisma, snapshotFindFirst };
  }
  const donem = { from: new Date('2026-10-01T00:00:00.000Z'), to: new Date('2026-10-31T23:59:59.999Z') };

  it('olcum onceki donemin ORTASINDA basladiysa (7 gun): veri var ama fark YOK', async () => {
    const { prisma, snapshotFindFirst } = fakePrisma(eylulSon7, false);
    const o = await new ReportsService(prisma as never).overview('s1', donem);
    expect(o.search.totalClicks).toBe(1240);
    expect(o.search.oncekiDonemVeriVar).toBe(true);
    expect(o.search.oncekiDonemTam).toBe(false);
    // Eskiden: 1.240 − 280 = "+960" — 7 gunluk toplam 31 gunun yanina konuyordu
    expect(o.search.clicksDelta).toBeNull();
    expect(o.search.impressionsDelta).toBeNull();
    // Sorulan: olcum onceki donemin ilk gununde ya da daha once var mi
    expect((snapshotFindFirst.mock.calls[0] as any[])[0].where).toEqual({ siteId: 's1', date: { lte: new Date('2026-08-31T00:00:00.000Z') } });
  });

  it('olcum onceki donemden once basladiysa fark verilir (aradaki bos gunler engel degil)', async () => {
    const { prisma } = fakePrisma(eylulSon7, true);
    const o = await new ReportsService(prisma as never).overview('s1', donem);
    expect(o.search.oncekiDonemTam).toBe(true);
    expect(o.search.clicksDelta).toBe(1240 - 280);
  });

  it('onceki donemde hic veri yoksa eskisi gibi null; ek sorgu atilmaz', async () => {
    const { prisma, snapshotFindFirst } = fakePrisma([], true);
    const o = await new ReportsService(prisma as never).overview('s1', donem);
    expect(o.search).toMatchObject({ oncekiDonemVeriVar: false, oncekiDonemTam: false, clicksDelta: null });
    expect(snapshotFindFirst).not.toHaveBeenCalled();
  });

  it('CSV fark yokken nedenini ayirir', async () => {
    const svc = new ReportsService(fakePrisma(eylulSon7, false).prisma as never);
    expect(svc.toCsv(await svc.overview('s1', donem))).toContain('onceki donem bastan sona olculmedi');
    const bos = new ReportsService(fakePrisma([], false).prisma as never);
    expect(bos.toCsv(await bos.overview('s1', donem))).toContain('onceki donemde olcum yok');
  });
});

describe('monthlyReportData — olculemeyen 0 gosterilmez, yarim donem kiyaslanmaz', () => {
  it('hareketsiz donem: null (rapor ve e-posta yok)', () => {
    expect(monthlyReportData(SITE, DONEM, ozet())).toBeNull();
    // Skor tek basina hareket degildir: gecen aydan kalan tarama skoru e-posta nedeni olmaz
    expect(monthlyReportData(SITE, DONEM, ozet({ seo: 80, geo: 70, citation: 40 }))).toBeNull();
    expect(monthlyReportData(SITE, DONEM, ozet({ seo: 80 }), { aiMeasured: false })).toBeNull();
  });

  it('donemde AI olcumu yapildiysa hareket sayilir (Search Console\'suz, makalesiz Baslangic hesabi da rapor alir)', () => {
    const d = monthlyReportData(SITE, DONEM, ozet({ geo: 64 }), { aiMeasured: true, aiVisibility: 22, reportId: 'r1' })!;
    expect(d).toMatchObject({ siteId: 's1', aiVisibility: 22, articlesPublished: 0, auditCount: 0, reportId: 'r1' });
    expect('totalClicks' in d).toBe(false);
  });

  it('arama verisi yokken tiklama alani HIC yok (sablon buyuk "0 tıklama" basmasin)', () => {
    const d = monthlyReportData(SITE, DONEM, ozet({ makale: 3, tarama: 1, seo: 82 }))!;
    expect(d).toMatchObject({ siteName: 'Örnek Klinik', siteId: 's1', periodLabel: 'Ekim 2026', periodDays: 31, articlesPublished: 3, auditCount: 1, seoScore: 82 });
    expect('totalClicks' in d).toBe(false);
    expect('prevClicks' in d).toBe(false);
    expect('prevPartial' in d).toBe(false);
  });

  it('arama verisi var, onceki donemde hic olcum yok: tiklama var, fark yok, "yarim" de degil', () => {
    const d = monthlyReportData(SITE, DONEM, ozet({ clicks: 1200, impressions: 40_000, delta: null, prevVar: false }))!;
    expect(d.totalClicks).toBe(1200);
    expect('prevClicks' in d).toBe(false);
    expect('prevPartial' in d).toBe(false);
  });

  it('onceki donemde veri var ama bastan sona olculmemis: fark yok ve bunu soyleyen isaret var', () => {
    const d = monthlyReportData(SITE, DONEM, ozet({ clicks: 1250, impressions: 40_000, delta: null, prevVar: true, prevTam: false }))!;
    expect('prevClicks' in d).toBe(false);
    expect(d.prevPartial).toBe(true);
  });

  it('iki donem de olculduyse onceki tiklama = toplam − fark (dusus de dogru)', () => {
    expect(monthlyReportData(SITE, DONEM, ozet({ clicks: 1200, impressions: 40_000, delta: 200 }))!.prevClicks).toBe(1000);
    expect(monthlyReportData(SITE, DONEM, ozet({ clicks: 800, impressions: 40_000, delta: -400 }))!.prevClicks).toBe(1200);
    // Gosterim var, tiklama 0: olculmus gercek bir sifir, yazilir
    expect(monthlyReportData(SITE, DONEM, ozet({ clicks: 0, impressions: 500, delta: 0 }))).toMatchObject({ totalClicks: 0, prevClicks: 0 });
  });

  it('aradaki bos gunler EKSIK sayilmaz: gosterimi olmayan gunun kaydi yazilmaz (az trafikli site)', () => {
    // Ayin 27 gununde veri var, bas ve son tolerans icinde
    const d = monthlyReportData(SITE, DONEM, ozet({ clicks: 90, impressions: 2000, delta: 10, from: '2026-10-03', to: '2026-10-29' }))!;
    expect('dataFrom' in d).toBe(false);
    expect(d.prevClicks).toBe(80);
  });

  it('veri donemin ORTASINDA basliyor ve oncesinde olcum yok: aralik yazilir, kiyas yok', () => {
    const d = monthlyReportData(SITE, DONEM, ozet({ clicks: 600, impressions: 20_000, delta: null, prevVar: false, from: '2026-10-14' }))!;
    expect(d).toMatchObject({ totalClicks: 600, dataFrom: '14 Ekim', dataTo: '31 Ekim' });
    expect('prevClicks' in d).toBe(false);
  });

  it('bastaki bosluk, olcum ONCEDEN suruyorsa eksik degildir (gosterimsiz gunler)', () => {
    const d = monthlyReportData(SITE, DONEM, ozet({ clicks: 600, impressions: 20_000, delta: 100, from: '2026-10-14' }))!;
    expect('dataFrom' in d).toBe(false);
    expect(d.prevClicks).toBe(500);
  });

  it('veri donem bitmeden KESILIYOR (baglanti koptu): aralik yazilir, onceki donem olculmus olsa da kiyas yok', () => {
    const d = monthlyReportData(SITE, DONEM, ozet({ clicks: 300, impressions: 9000, delta: -900, to: '2026-10-09' }))!;
    expect(d).toMatchObject({ dataFrom: '1 Ekim', dataTo: '9 Ekim' });
    expect('prevClicks' in d).toBe(false);
    expect('prevPartial' in d).toBe(false);
    // Tolerans siniri: son gunden tam tolerans kadar once biten veri eksik degil
    const sinir = `2026-10-${31 - MONTHLY_EDGE_TOLERANCE_DAYS}`;
    expect('dataFrom' in monthlyReportData(SITE, DONEM, ozet({ clicks: 300, impressions: 9000, delta: 5, to: sinir }))!).toBe(false);
  });

  it('dondurulmus rapor verildiyse kimligi ve o raporun AI skoru kullanilir (null dahil)', () => {
    const o = ozet({ makale: 1, citation: 55 });
    expect(monthlyReportData(SITE, DONEM, o)).toMatchObject({ aiVisibility: 55 });
    expect(monthlyReportData(SITE, DONEM, o, { reportId: 'r1', aiVisibility: 61 })).toMatchObject({ reportId: 'r1', aiVisibility: 61 });
    expect(monthlyReportData(SITE, DONEM, o, { reportId: 'r1', aiVisibility: null })).toMatchObject({ aiVisibility: null });
  });
});

describe('MonthlyReportCron', () => {
  const NOW = new Date('2026-11-04T06:00:00Z');
  const hareketli = ozet({ clicks: 1200, impressions: 40_000, delta: 200, seo: 82, geo: 71, citation: 40, makale: 4, tarama: 2 });

  function kur(opts: {
    users?: any[];
    overview?: (siteId: string) => Promise<MonthlyOverview> | MonthlyOverview;
    generate?: (siteId: string, o: any) => Promise<any>;
    send?: (o: any) => Promise<any>;
    lock?: boolean;
    /** Onceden var olan anahtar-deger kayitlari (gonderildi kayitlari) */
    kv?: Set<string>;
    /** Onceki turda uretilmis otomatik raporlar: siteId → rapor */
    mevcutRapor?: Record<string, any>;
    aiOlcum?: number;
  } = {}) {
    const users = opts.users ?? [{ id: 'u1', email: 'a@ornek.com', name: 'Ayşe', sites: [{ id: 's1', name: 'Örnek Klinik' }] }];
    const kv = opts.kv ?? new Set<string>();
    const findMany = vi.fn(async () => users);
    const prisma = {
      user: { findMany },
      kvStore: {
        create: vi.fn(async ({ data }: any) => {
          if (data.key.startsWith('cron-lock:')) { if (opts.lock === false) throw new Error('unique'); return {}; }
          kv.add(data.key);
          return {};
        }),
        findMany: vi.fn(async ({ where }: any) => (where.key.in as string[]).filter((k) => kv.has(k)).map((key) => ({ key }))),
      },
      aiCitationSnapshot: { count: vi.fn(async () => opts.aiOlcum ?? 0) },
      siteReport: { findFirst: vi.fn(async ({ where }: any) => opts.mevcutRapor?.[where.siteId] ?? null) },
    };
    const reports = { overview: vi.fn(async (siteId: string) => (opts.overview ? opts.overview(siteId) : hareketli)) };
    const siteReports = {
      generate: vi.fn(opts.generate ?? (async (siteId: string) => ({ id: `rapor-${siteId}`, aiVisibility: 63, data: { seo: hareketli } }))),
    };
    const email = { send: vi.fn(opts.send ?? (async () => ({ ok: true }))) };
    const cron = new MonthlyReportCron(prisma as any, reports as any, siteReports as any, email as any);
    return { cron, prisma, kv, findMany, reports, siteReports, email };
  }
  const BOS = { sent: 0, already: 0, inactive: 0, failed: 0 };

  it('ayin 4–7\'si 09:00 Turkiye (Search Console gecikmesi icin 1\'i degil; dort gun, yarida kalan tur tamamlansin)', () => {
    expect(MONTHLY_REPORT_CRON).toBe('0 9 4-7 * *');
    const src = readFileSync(fileURLToPath(new URL('./monthly-report.cron.ts', import.meta.url)), 'utf8');
    expect(src).toContain("@Cron(MONTHLY_REPORT_CRON, { timeZone: 'Europe/Istanbul' })");
  });

  it('kilit alinamazsa hicbir sey yapmaz (API + worker ayni modulu yukler)', async () => {
    const { cron, findMany, email } = kur({ lock: false });
    expect(await cron.monthlyReports(NOW)).toEqual(BOS);
    expect(findMany).not.toHaveBeenCalled();
    expect(email.send).not.toHaveBeenCalled();
  });

  it('kime: ucretli plan, dogrulanmis, silme talebi yok; abonelik durumuna bakilmaz; ornek site haric', async () => {
    const { cron, findMany } = kur();
    await cron.monthlyReports(NOW);
    const arg = (findMany.mock.calls[0] as any[])[0];
    expect(arg.where).toEqual({
      plan: { not: 'TRIAL' },
      emailVerified: { not: null },
      deletionRequestedAt: null,
      sites: { some: { status: 'ACTIVE', url: { not: MONTHLY_REPORT_DEMO_URL } } },
    });
    expect(arg.select.sites.where).toEqual({ status: 'ACTIVE', url: { not: MONTHLY_REPORT_DEMO_URL } });
  });

  it('ornek site adresi makale zamanlayicisindaki sabitle ayni', () => {
    const src = readFileSync(fileURLToPath(new URL('../articles/article-scheduler.service.ts', import.meta.url)), 'utf8');
    expect(src).toContain(`export const DEMO_SITE_URL = '${MONTHLY_REPORT_DEMO_URL}';`);
  });

  it('rapor DONDURULUR (tetikleyici cron), e-posta o rapora baglanir, sayilar dondurulmus govdeden; gonderildi kaydi yazilir', async () => {
    // Canli ozet ile dondurulmus govde farkli olsun: e-posta dondurulmusu soylemeli
    const dondurulmus = ozet({ clicks: 1250, impressions: 41_000, delta: 250, seo: 82, geo: 71, makale: 4, tarama: 2 });
    const { cron, reports, siteReports, email, kv, prisma } = kur({
      generate: async () => ({ id: 'cmrapor1', aiVisibility: 63, data: { seo: dondurulmus } }),
    });
    expect(await cron.monthlyReports(NOW)).toEqual({ ...BOS, sent: 1 });

    const donem = { from: new Date('2026-10-01T00:00:00.000Z'), to: new Date('2026-10-31T23:59:59.999Z') };
    expect(reports.overview).toHaveBeenCalledWith('s1', donem);
    expect(prisma.siteReport.findFirst.mock.calls[0][0].where).toEqual({ siteId: 's1', trigger: 'cron', periodStart: donem.from });
    expect(siteReports.generate).toHaveBeenCalledWith('s1', { ...donem, userId: 'u1', trigger: 'cron' });
    expect(email.send).toHaveBeenCalledTimes(1);
    expect((email.send.mock.calls[0] as any[])[0]).toEqual({
      userId: 'u1', to: 'a@ornek.com', template: 'monthly_report',
      data: {
        name: 'Ayşe', siteName: 'Örnek Klinik', siteId: 's1', periodLabel: 'Ekim 2026', periodDays: 31, reportId: 'cmrapor1',
        totalClicks: 1250, prevClicks: 1000, seoScore: 82, geoScore: 71, aiVisibility: 63, articlesPublished: 4, auditCount: 2,
      },
    });
    expect(kv.has(monthlySentKey('s1', '2026-10'))).toBe(true);
    expect(monthlySentKey('s1', '2026-10')).toBe('monthly-report-sent:s1:2026-10');
  });

  it('IKINCI TUR (ertesi gun): gonderilmis siteye yeniden gitmez, rapor yeniden uretilmez', async () => {
    const ortam = kur();
    expect(await ortam.cron.monthlyReports(NOW)).toEqual({ ...BOS, sent: 1 });
    expect(await ortam.cron.monthlyReports(new Date('2026-11-05T06:00:00Z'))).toEqual({ ...BOS, already: 1 });
    expect(ortam.email.send).toHaveBeenCalledTimes(1);
    expect(ortam.siteReports.generate).toHaveBeenCalledTimes(1);
    expect(ortam.reports.overview).toHaveBeenCalledTimes(1);
  });

  it('gonderim basarisizsa kayit YAZILMAZ; ertesi gun yeniden denenir ve AYNI rapor kullanilir', async () => {
    let basarili = false;
    const ilkRapor = { id: 'cmrapor1', aiVisibility: 63, data: { seo: hareketli } };
    const mevcutRapor: Record<string, any> = {};
    const ortam = kur({
      send: async () => (basarili ? { ok: true } : { ok: false, skipped: 'no_provider' }),
      generate: async (siteId) => { mevcutRapor[siteId] = ilkRapor; return ilkRapor; },
      mevcutRapor,
    });
    expect(await ortam.cron.monthlyReports(NOW)).toEqual({ ...BOS, failed: 1 });
    expect(ortam.kv.size).toBe(0);

    basarili = true;
    expect(await ortam.cron.monthlyReports(new Date('2026-11-05T06:00:00Z'))).toEqual({ ...BOS, sent: 1 });
    // Ikinci rapor uretilmedi: musteri gecmiste tek "otomatik" Ekim raporu gorur
    expect(ortam.siteReports.generate).toHaveBeenCalledTimes(1);
    expect((ortam.email.send.mock.calls[1] as any[])[0].data.reportId).toBe('cmrapor1');
    expect(ortam.kv.has(monthlySentKey('s1', '2026-10'))).toBe(true);
  });

  it('hareketsiz site: rapor uretilmez, e-posta gitmez, kayit yazilmaz', async () => {
    const { cron, siteReports, email, kv } = kur({ overview: () => ozet({ seo: 80 }) });
    expect(await cron.monthlyReports(NOW)).toEqual({ ...BOS, inactive: 1 });
    expect(siteReports.generate).not.toHaveBeenCalled();
    expect(email.send).not.toHaveBeenCalled();
    expect(kv.size).toBe(0);
  });

  it('yalniz AI olcumu olan site hareketlidir: rapor uretilir, e-posta gider', async () => {
    const { cron, prisma, email } = kur({ overview: () => ozet({ geo: 64 }), aiOlcum: 12, generate: async () => ({ id: 'r9', aiVisibility: 22, data: { seo: ozet({ geo: 64 }) } }) });
    expect(await cron.monthlyReports(NOW)).toEqual({ ...BOS, sent: 1 });
    expect(((prisma.aiCitationSnapshot.count.mock.calls as any[])[0] as any[])[0].where).toEqual({
      siteId: 's1', available: true, date: { gte: new Date('2026-10-01T00:00:00.000Z'), lte: new Date('2026-10-31T23:59:59.999Z') },
    });
    expect((email.send.mock.calls[0] as any[])[0].data).toMatchObject({ reportId: 'r9', aiVisibility: 22, geoScore: 64, articlesPublished: 0 });
  });

  it('bir sitenin hatasi digerlerini durdurmaz', async () => {
    const { cron, email } = kur({
      users: [
        { id: 'u1', email: 'a@ornek.com', name: 'A', sites: [{ id: 'bozuk', name: 'Bozuk' }, { id: 's2', name: 'İkinci' }] },
        { id: 'u2', email: 'b@ornek.com', name: 'B', sites: [{ id: 's3', name: 'Üçüncü' }] },
      ],
      overview: (siteId) => { if (siteId === 'bozuk') throw new Error('veritabani'); return hareketli; },
    });
    expect(await cron.monthlyReports(NOW)).toEqual({ ...BOS, sent: 2, failed: 1 });
    expect(email.send.mock.calls.map((c: any[]) => c[0].data.siteId)).toEqual(['s2', 's3']);
  });

  it(`hesap basina AYDA en fazla ${MONTHLY_REPORT_MAX_SITES_PER_USER} site: hareketsiz site sinirdan yemez, sonraki gunlerde sinir asilmaz`, async () => {
    const sites = Array.from({ length: MONTHLY_REPORT_MAX_SITES_PER_USER + 3 }, (_, i) => ({ id: `s${i}`, name: `Site ${i}` }));
    const ortam = kur({
      users: [{ id: 'u1', email: 'a@ornek.com', name: 'A', sites }],
      overview: (siteId) => (siteId === 's0' ? ozet() : hareketli),
    });
    expect(await ortam.cron.monthlyReports(NOW)).toEqual({ ...BOS, sent: MONTHLY_REPORT_MAX_SITES_PER_USER, inactive: 1 });
    expect(ortam.email.send.mock.calls.map((c: any[]) => c[0].data.siteId)).toEqual(['s1', 's2', 's3', 's4', 's5']);
    // Ertesi gun: gonderilmis bes site sinira sayilir, kalan sitelere rapor GITMEZ (ozet bile hesaplanmaz)
    const ozetCagrisi = ortam.reports.overview.mock.calls.length;
    expect(await ortam.cron.monthlyReports(new Date('2026-11-05T06:00:00Z'))).toEqual({ ...BOS, already: MONTHLY_REPORT_MAX_SITES_PER_USER });
    expect(ortam.email.send).toHaveBeenCalledTimes(MONTHLY_REPORT_MAX_SITES_PER_USER);
    expect(ortam.reports.overview.mock.calls.length).toBe(ozetCagrisi);
  });

  it('sinir, basarisiz siteyi sonraki gun yeniden denerken de asilmaz (inceleme: 7 site, biri ilk gun basarisiz → 6 e-posta gidiyordu)', async () => {
    const sites = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((id) => ({ id, name: `Site ${id}` }));
    let cBozuk = true;
    const ortam = kur({
      users: [{ id: 'u1', email: 'a@ornek.com', name: 'A', sites }],
      overview: (siteId) => { if (siteId === 'C' && cBozuk) throw new Error('gecici'); return hareketli; },
    });
    expect(await ortam.cron.monthlyReports(NOW)).toEqual({ ...BOS, sent: 5, failed: 1 });
    expect(ortam.email.send.mock.calls.map((c: any[]) => c[0].data.siteId)).toEqual(['A', 'B', 'D', 'E', 'F']);
    cBozuk = false;
    expect(await ortam.cron.monthlyReports(new Date('2026-11-05T06:00:00Z'))).toEqual({ ...BOS, already: 5 });
    expect(ortam.email.send).toHaveBeenCalledTimes(MONTHLY_REPORT_MAX_SITES_PER_USER);
  });
});

describe('monthly_report sablonu', () => {
  const svc = new EmailService({ emailLog: { create: async () => {} } } as never);
  const render = (d: Record<string, unknown>) => (svc as any).renderTemplate('monthly_report' as EmailTemplate, d) as { subject: string; html: string };
  const TABAN = { name: 'Ayşe', siteName: 'Örnek Klinik', siteId: 's1', periodLabel: 'Ekim 2026', periodDays: 31, seoScore: 82, geoScore: 71, aiVisibility: 63, articlesPublished: 4, auditCount: 2 };
  const metin = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  it('baglanti dondurulmus raporu acar; "saklandı" cumlesi yalniz rapor kimligi varken', () => {
    const { subject, html } = render({ ...TABAN, reportId: 'cmrapor1', totalClicks: 1250, prevClicks: 1000 });
    expect(subject).toBe('Örnek Klinik — aylık rapor hazır');
    expect(html).toContain('/sites/s1/report?rapor=cmrapor1"');
    expect(html).toContain('Rapor, oluşturulduğu andaki sayılarla saklandı; sonradan değişmez.');

    const kimliksiz = render({ ...TABAN, totalClicks: 1250 }).html;
    expect(kimliksiz).toContain('/sites/s1/report"');
    expect(kimliksiz).not.toContain('saklandı');
    // Bozuk kimlik baglantiya girmez
    expect(render({ ...TABAN, reportId: '"><script>' }).html).not.toContain('rapor=');
  });

  it('fark "önceki 31 güne göre" yazilir — kiyas onceki takvim ayi degil, ayni uzunluktaki onceki donem', () => {
    const m = metin(render({ ...TABAN, reportId: 'r1', totalClicks: 1250, prevClicks: 1000 }).html);
    expect(m).toContain('1.250');
    expect(m).toContain('organik tıklama');
    expect(m).toContain('önceki 31 güne göre +250');
    expect(m).not.toMatch(/geçen aya göre|önceki aya göre/);
    expect(metin(render({ ...TABAN, periodDays: 28, totalClicks: 800, prevClicks: 1000 }).html)).toContain('önceki 28 güne göre -200');
  });

  it('fark yokken NEDENI yazilir: hic olcum yok / onceki donem yarim / bu donemin verisi hangi gunlerde', () => {
    const yok = metin(render({ ...TABAN, totalClicks: 1250 }).html);
    expect(yok).toContain('Önceki dönemde ölçüm yok');
    expect(yok).not.toContain('güne göre');

    const yarim = metin(render({ ...TABAN, totalClicks: 1250, prevPartial: true }).html);
    expect(yarim).toContain('Önceki dönem baştan sona ölçülmedi; kıyas yapılmadı');
    expect(yarim).not.toContain('Önceki dönemde ölçüm yok');

    const eksik = metin(render({ ...TABAN, totalClicks: 600, dataFrom: '14 Ekim', dataTo: '31 Ekim' }).html);
    expect(eksik).toContain('Arama verisi 14 Ekim – 31 Ekim arası için var; kıyas yapılmadı');
    expect(eksik).not.toContain('güne göre');
  });

  it('arama verisi yokken "0 tıklama" ve "organik tıklama" HIC yok; kart skorlarla baslar', () => {
    const m = metin(render(TABAN).html);
    expect(m).not.toContain('organik tıklama');
    expect(m).not.toMatch(/\b0 tıklama/);
    expect(m).toContain('SEO skoru');
    expect(m).toContain('4 makale, 2 tarama');
  });

  it('olculemeyen skor 0 degil tire', () => {
    const m = metin(render({ ...TABAN, seoScore: null, geoScore: null, aiVisibility: null }).html);
    // Olcu seridi: deger ustte, etiket altta
    expect(m).toMatch(/— SEO skoru\s+— GEO skoru\s+— AI görünürlük/);
    expect(m).not.toMatch(/\b0 SEO skoru/);
  });

  it('site adi HTML\'de bir kez kacislanir; konu satiri duz metindir (gelen kutusunda "&amp;" gorunmesin)', () => {
    const { subject, html } = render({ ...TABAN, siteName: 'Koç & Koç <b>Hukuk</b>' });
    expect(subject).toBe('Koç & Koç <b>Hukuk</b> — aylık rapor hazır');
    expect(html).not.toContain('<b>Hukuk</b>');
    expect(html).toContain('Koç &amp; Koç &lt;b&gt;Hukuk&lt;/b&gt;');
    expect(html).not.toContain('&amp;amp;');
  });
});
