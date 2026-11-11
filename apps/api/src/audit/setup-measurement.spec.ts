import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { Logger } from '@nestjs/common';
import { AuditService } from './audit.service.js';
import { AuditChecksService } from './audit-checks.service.js';
import { AiCitationTrackerService } from './ai-citation-tracker.service.js';
import { SITE_MEASUREMENT_VERSION, siteMeasurementVersion } from './host-match.js';
import { BASE_PLANS } from '../billing/plans.js';
import {
  SETUP_REUSE_WINDOW_MS, releaseSetupMeasurement, reserveSetupMeasurement, runSetupMeasurement, setupLimitSkip, setupMeasurementKey,
} from './setup-measurement.js';
import { SETUP_MEASUREMENT_WINDOW_MS, parseSetupRecords, setupLimitMessage } from './setup-measurement-limit.js';

/**
 * Site kurulumunun TEK otomatik AI olcumu + siniri (sahip karari 11.11.2026).
 *
 * NEDEN VAR: kurulum zinciri iki kez olcuyordu (denetimin AI testi + baslangic olcumu),
 * ikisi de sayilmayan "sistem" olcumu; siteyi silip yeniden eklemek bunu sinirsiz
 * tekrarlatiyordu. Burada sabitlenenler:
 *  - kurulumda asistanlara TAM BIR KEZ sorulur; ayni sonuc hem gecmise hem denetime yazilir,
 *  - hesap basina 30 gunde planin site siniri kadar, ayni alan adi icin 1 (ADMIN muaf),
 *  - sinir dolunca kurulum surer, denetimin AI bolumu hata degil NEDEN tasir,
 *  - es zamanli kurulumlar tavani asamaz; sonuc vermeyen olcum siniri yakmaz.
 *
 * Sahte kv_store gercek tablo gibi davranir: okuma da yazma da bir tur bekler (iki is
 * ayni degeri okur, SONRA yazar — yaris gercekten olusur), kosullu yazim yalniz satir
 * okunan degerdeyse tutar, ayni anahtar iki kez acilamaz.
 */

vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

const NOW = new Date('2026-11-11T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const tick = () => new Promise((r) => setTimeout(r, 0));
const sessiz = { log: vi.fn(), warn: vi.fn() };

type KvRow = { value: string; expiresAt: Date | null };

function kvTable(initial: Record<string, KvRow> = {}) {
  const rows = new Map<string, KvRow>(Object.entries(initial));
  const kvStore = {
    findUnique: vi.fn(async ({ where }: any) => {
      await tick();
      const r = rows.get(where.key);
      return r ? { value: r.value } : null;
    }),
    create: vi.fn(async ({ data }: any) => {
      await tick();
      if (rows.has(data.key)) throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
      rows.set(data.key, { value: data.value, expiresAt: data.expiresAt ?? null });
      return data;
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      await tick();
      const r = rows.get(where.key);
      if (!r || (where.value !== undefined && r.value !== where.value)) return { count: 0 };
      rows.set(where.key, { value: data.value ?? r.value, expiresAt: data.expiresAt ?? r.expiresAt });
      return { count: 1 };
    }),
    deleteMany: vi.fn(async ({ where }: any) => {
      await tick();
      const r = rows.get(where.key);
      if (!r || (where.value !== undefined && r.value !== where.value)) return { count: 0 };
      rows.delete(where.key);
      return { count: 1 };
    }),
  };
  const kayitlar = (userId = 'u1') => parseSetupRecords(rows.get(setupMeasurementKey(userId))?.value);
  return { rows, kvStore, kayitlar };
}

const onceki = (hosts: string[], daysAgo = 1): Record<string, KvRow> => ({
  [setupMeasurementKey('u1')]: {
    value: JSON.stringify(hosts.map((host) => ({ host, at: new Date(NOW.getTime() - daysAgo * DAY).toISOString() }))),
    expiresAt: new Date(NOW.getTime() + 29 * DAY),
  },
});

const ayir = (kv: ReturnType<typeof kvTable>, host: string, over: Partial<{ plan: string; role: string; userId: string; now: Date }> = {}) =>
  reserveSetupMeasurement(kv as any, { userId: 'u1', plan: 'PRO', role: 'USER', host, now: NOW, ...over }, sessiz);

describe('reserveSetupMeasurement — karar + kayit tek kosullu yazimda', () => {
  it('ilk olcum: kayit acilir (alan adi + an), 30 gun sonra silinmek uzere; anahtar KULLANICIYA bagli', async () => {
    const kv = kvTable();
    const r = await ayir(kv, 'ornek.com');
    expect(r).toEqual({ allowed: true, key: 'kurulum-olcumu:u1', entry: { host: 'ornek.com', at: NOW.toISOString() } });
    expect(kv.kayitlar()).toEqual([{ host: 'ornek.com', at: NOW.toISOString() }]);
    expect(kv.rows.get('kurulum-olcumu:u1')!.expiresAt!.getTime()).toBe(NOW.getTime() + SETUP_MEASUREMENT_WINDOW_MS);
  });

  it('site silinince kayit SILINMEZ: anahtar site kimligi tasimaz (sil + yeniden ekle kuralinin dayanagi)', () => {
    expect(setupMeasurementKey('u1')).toBe('kurulum-olcumu:u1');
    // Site silme, anahtarinda site kimligi gecen gecici kayitlari siler (sites.service siteKvFilter)
    const sites = readFileSync(new URL('../sites/sites.service.ts', import.meta.url), 'utf8');
    expect(sites).toMatch(/function siteKvFilter\(siteId: string\)[^{]*\{\s*return siteId\.length >= 20 \? \{ key: \{ contains: siteId \} \} : \{ key: crawlAccessKey\(siteId\) \};/);
  });

  it('her planda tavan = planin site siniri: N. olcum yazilir, N+1. kesilir ve kayit degismez', async () => {
    for (const p of BASE_PLANS) {
      const kv = kvTable();
      for (let i = 0; i < p.sites; i++) {
        expect((await ayir(kv, `site${i}.com`, { plan: p.id.toUpperCase() })).allowed, `${p.id} ${i + 1}.`).toBe(true);
      }
      expect(await ayir(kv, 'fazla.com', { plan: p.id.toUpperCase() }), `${p.id} N+1.`).toEqual({ allowed: false, reason: 'account', limit: p.sites });
      expect(kv.kayitlar()).toHaveLength(p.sites);
    }
  });

  it('ayni alan adi 30 gun icinde ikinci kez olculmez (sil + yeniden ekle); baska alan adi olculur', async () => {
    const kv = kvTable(onceki(['ornek.com'], 3));
    expect(await ayir(kv, 'ornek.com')).toEqual({ allowed: false, reason: 'domain', limit: 5 });
    expect(kv.kayitlar()).toHaveLength(1);
    expect((await ayir(kv, 'baska.com')).allowed).toBe(true);
    expect(kv.kayitlar().map((r) => r.host)).toEqual(['ornek.com', 'baska.com']);
  });

  it('30 gunden eski kayitlar yazimda budanir (kayit kucuk kalir) ve tavani doldurmaz', async () => {
    const eski = Array.from({ length: 5 }, (_, i) => `eski${i}.com`);
    const kv = kvTable(onceki(eski, 31));
    expect((await ayir(kv, 'yeni.com')).allowed).toBe(true);
    expect(kv.kayitlar()).toEqual([{ host: 'yeni.com', at: NOW.toISOString() }]);
  });

  it('kayit hesap basina: baska kullanicinin kayitlari tavani doldurmaz', async () => {
    const kv = kvTable(onceki(['a.com', 'b.com', 'c.com', 'd.com', 'e.com']));
    expect((await ayir(kv, 'yeni.com')).allowed).toBe(false);
    expect((await ayir(kv, 'yeni.com', { userId: 'u2' })).allowed).toBe(true);
  });

  it('ADMIN muaf: depoya hic gidilmez, kayit yazilmaz', async () => {
    const kv = kvTable(onceki(['ornek.com']));
    expect(await ayir(kv, 'ornek.com', { role: 'ADMIN', plan: 'TRIAL' })).toEqual({ allowed: true, key: null, entry: null });
    expect(kv.kvStore.findUnique).not.toHaveBeenCalled();
    expect(kv.kayitlar()).toHaveLength(1);
  });

  it('ES ZAMANLI kurulumlar tavani asamaz: son yer icin yarisan iki isten yalniz biri olcer', async () => {
    const kv = kvTable(onceki(['a.com', 'b.com', 'c.com', 'd.com'])); // Profesyonel: 1 yer kaldi
    const [r1, r2] = await Promise.all([ayir(kv, 'x.com'), ayir(kv, 'y.com')]);
    expect([r1.allowed, r2.allowed].filter(Boolean)).toHaveLength(1);
    expect(kv.kayitlar()).toHaveLength(5);
  });

  it('ES ZAMANLI ilk kurulumlar (satir henuz yok): deneme hesabinda (1) ucunden yalniz biri olcer', async () => {
    const kv = kvTable();
    const sonuc = await Promise.all(['a.com', 'b.com', 'c.com'].map((h) => ayir(kv, h, { plan: 'TRIAL' })));
    expect(sonuc.filter((r) => r.allowed)).toHaveLength(1);
    expect(kv.kayitlar()).toHaveLength(1);
  });

  it('ES ZAMANLI ayni alan adi (cift istek): yalniz biri olcer', async () => {
    const kv = kvTable();
    const [r1, r2] = await Promise.all([ayir(kv, 'ornek.com'), ayir(kv, 'ornek.com')]);
    expect([r1.allowed, r2.allowed].filter(Boolean)).toHaveLength(1);
    expect(kv.kayitlar()).toHaveLength(1);
  });

  it('depo okunamiyor: olcum YAPILIR (sinir denetimi urunu durdurmaz), kayit yazilmaz, uyari loglanir', async () => {
    const kv = kvTable();
    kv.kvStore.findUnique.mockImplementation(async () => { throw new Error('db yok'); });
    const warn = vi.fn();
    const r = await reserveSetupMeasurement(kv as any, { userId: 'u1', plan: 'TRIAL', role: 'USER', host: 'ornek.com', now: NOW }, { warn });
    expect(r).toEqual({ allowed: true, key: null, entry: null });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('okunamadi/yazilamadi'));
  });

  it('depo yazilamiyor (P2002 disi hata): yine izin verilir ve loglanir', async () => {
    const kv = kvTable();
    kv.kvStore.create.mockImplementation(async () => { throw new Error('disk dolu'); });
    const warn = vi.fn();
    expect((await reserveSetupMeasurement(kv as any, { userId: 'u1', plan: 'TRIAL', role: 'USER', host: 'ornek.com', now: NOW }, { warn })).allowed).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('releaseSetupMeasurement — sonuc vermeyen olcum siniri yakmaz', () => {
  it('yalniz kendi kaydini siler; digerleri ve sureleri kalir', async () => {
    const kv = kvTable(onceki(['a.com'], 2));
    const r = await ayir(kv, 'ornek.com');
    await releaseSetupMeasurement(kv as any, r, sessiz);
    expect(kv.kayitlar().map((x) => x.host)).toEqual(['a.com']);
    // Sure kalan en yeni kayda gore: 2 gun onceki kayit + 30 gun
    expect(kv.rows.get('kurulum-olcumu:u1')!.expiresAt!.getTime()).toBe(NOW.getTime() - 2 * DAY + SETUP_MEASUREMENT_WINDOW_MS);
  });

  it('tek kayit kendi kaydiysa satir silinir; geri alinan yer yeniden kullanilabilir', async () => {
    const kv = kvTable();
    const r = await ayir(kv, 'ornek.com', { plan: 'TRIAL' });
    await releaseSetupMeasurement(kv as any, r, sessiz);
    expect(kv.rows.size).toBe(0);
    expect((await ayir(kv, 'ornek.com', { plan: 'TRIAL' })).allowed).toBe(true);
  });

  it('kayitsiz izin (ADMIN / depo hatasi) ve red icin hicbir sey yapmaz', async () => {
    const kv = kvTable(onceki(['a.com']));
    await releaseSetupMeasurement(kv as any, { allowed: true, key: null, entry: null }, sessiz);
    await releaseSetupMeasurement(kv as any, { allowed: false, reason: 'account', limit: 1 }, sessiz);
    expect(kv.kvStore.findUnique).not.toHaveBeenCalled();
    expect(kv.kayitlar()).toHaveLength(1);
  });
});

// ── runSetupMeasurement: karar + tek olcum ───────────────────────────────────

const OLCUM = [
  { provider: 'openai', label: 'OpenAI ChatGPT', available: true, score: 50, probes: [{ query: 'en iyi hosting', cited: false, brandMentioned: true, excerpt: 'Ornek iyi bir secenek' }], modelTier: 'premium' },
  { provider: 'gemini', label: 'Google Gemini', available: true, score: 0, probes: [{ query: 'en iyi hosting', cited: false, brandMentioned: false, excerpt: 'Baskalari' }], modelTier: 'premium' },
];

function kurulum(opts: {
  kv?: ReturnType<typeof kvTable>;
  site?: { url?: string; userId?: string; plan?: string; role?: string } | null;
  runs?: Array<{ siteId: string; runAt: Date; providers: unknown; matchVersion: number }>;
  snapshot?: () => Promise<any>;
} = {}) {
  const kv = opts.kv ?? kvTable();
  const site = opts.site === null ? null : { url: 'https://www.ornek.com', userId: 'u1', plan: 'PRO', role: 'USER', ...opts.site };
  const runs = opts.runs ?? [];
  const prisma = {
    kvStore: kv.kvStore,
    site: {
      findUnique: vi.fn(async () => (site ? { url: site.url, userId: site.userId, user: { plan: site.plan, role: site.role } } : null)),
    },
    aiCitationRun: {
      findFirst: vi.fn(async ({ where }: any) => runs
        .filter((r) => r.siteId === where.siteId && r.runAt.getTime() >= where.runAt.gte.getTime())
        .sort((a, b) => b.runAt.getTime() - a.runAt.getTime())[0] ?? null),
    },
  };
  const tracker = {
    snapshotSite: vi.fn(opts.snapshot ?? (async () => ({ saved: 2, results: OLCUM, runAt: NOW.toISOString(), runId: 'r1', tekrar: 3, soruSayisi: 1, gorunme: null }))),
  };
  const olc = (siteId = 's1') => runSetupMeasurement({ prisma: prisma as any, tracker: tracker as any, log: sessiz }, siteId, { now: NOW });
  return { kv, prisma, tracker, olc };
}

describe('runSetupMeasurement — kurulumun tek otomatik olcumu', () => {
  it('izin varken: asistanlara BIR kez, SISTEM olcumu olarak sorulur; sonuc ve olcum ani doner, kayit yazilir', async () => {
    const t = kurulum();
    const r = await t.olc();
    expect(t.tracker.snapshotSite).toHaveBeenCalledTimes(1);
    // Sistem olcumu: aylik calistirma tavanina ve haftalik olcum hakkina sayilmaz
    expect(t.tracker.snapshotSite).toHaveBeenCalledWith('s1', { trigger: 'system' });
    expect(r).toEqual({ results: OLCUM, ranAt: NOW.toISOString() });
    expect(t.kv.kayitlar()).toEqual([{ host: 'ornek.com', at: NOW.toISOString() }]);
  });

  it('hesap tavani dolu: asistanlara SORULMAZ; hata degil, Turkce nedeniyle atlama doner', async () => {
    const t = kurulum({ kv: kvTable(onceki(['a.com', 'b.com', 'c.com', 'd.com', 'e.com'])) });
    const r = await t.olc();
    expect(t.tracker.snapshotSite).not.toHaveBeenCalled();
    expect(r).toEqual({
      skipped: {
        code: 'SETUP_MEASUREMENT_LIMIT',
        message: 'Otomatik kurulum ölçümü sınırı doldu (30 günde en fazla 5 site); ilk ölçümü haftalık ölçüm hakkınla başlatabilirsin.',
        nextAvailableAt: null,
      },
    });
    expect(t.kv.kayitlar()).toHaveLength(5);
  });

  it('sil + yeniden ekle: ayni alan adi yeni site kimligiyle (ve www / yol farkiyla) gelse de yeniden olculmez', async () => {
    const kv = kvTable();
    const ilk = kurulum({ kv, site: { url: 'https://ornek.com' } });
    await ilk.olc('s-eski');
    expect(ilk.tracker.snapshotSite).toHaveBeenCalledTimes(1);
    // Site silindi (kosumlari da gitti), 5 gun sonra ayni alan adi yeniden eklendi
    const yeniden = kurulum({ kv, site: { url: 'https://www.Ornek.com/' } });
    const r = await runSetupMeasurement({ prisma: yeniden.prisma as any, tracker: yeniden.tracker as any, log: sessiz }, 's-yeni', { now: new Date(NOW.getTime() + 5 * DAY) });
    expect(yeniden.tracker.snapshotSite).not.toHaveBeenCalled();
    expect(r).toEqual({ skipped: setupLimitSkip('domain', 5) });
    expect((r as any).skipped.message).toBe(setupLimitMessage('domain', 5));
    // 30 gun dolunca ayni alan adi yeniden olculur
    const sonra = kurulum({ kv, site: { url: 'https://ornek.com' } });
    await runSetupMeasurement({ prisma: sonra.prisma as any, tracker: sonra.tracker as any, log: sessiz }, 's-yeni2', { now: new Date(NOW.getTime() + 31 * DAY) });
    expect(sonra.tracker.snapshotSite).toHaveBeenCalledTimes(1);
  });

  it('deneme hesabi (1 site): ilk site olculur, silip BASKA bir site ekleyince olculmez', async () => {
    const kv = kvTable();
    const ilk = kurulum({ kv, site: { plan: 'TRIAL', url: 'https://a.com' } });
    expect(await ilk.olc('s1')).toHaveProperty('results');
    const ikinci = kurulum({ kv, site: { plan: 'TRIAL', url: 'https://b.com' } });
    expect(await ikinci.olc('s2')).toEqual({ skipped: setupLimitSkip('account', 1) });
    expect(ikinci.tracker.snapshotSite).not.toHaveBeenCalled();
  });

  it('ADMIN sitesi: sinir uygulanmaz, kayit yazilmaz', async () => {
    const t = kurulum({ kv: kvTable(onceki(['ornek.com', 'b.com', 'c.com', 'd.com', 'e.com'])), site: { role: 'ADMIN' } });
    expect(await t.olc()).toHaveProperty('results');
    expect(t.tracker.snapshotSite).toHaveBeenCalledTimes(1);
    expect(t.kv.kayitlar()).toHaveLength(5);
  });

  it('olcum hata verdi: ayirma geri alinir (yer yanmaz), hata cagirana gider', async () => {
    const t = kurulum({ snapshot: async () => { throw new Error('saglayici coktu'); } });
    await expect(t.olc()).rejects.toThrow('saglayici coktu');
    expect(t.kv.kayitlar()).toEqual([]);
  });

  it('olcum hic gercek sonuc vermedi (anahtar yok / butce dolu / tum cevaplar HATA): ayirma geri alinir', async () => {
    const bos = [
      { provider: 'openai', label: 'OpenAI ChatGPT', available: false, score: null, probes: [], reason: 'NO_KEY' },
      { provider: 'gemini', label: 'Google Gemini', available: true, score: null, probes: [{ query: 'q', cited: false, brandMentioned: false, excerpt: 'HATA: zaman asimi' }] },
    ];
    const t = kurulum({ snapshot: async () => ({ saved: 0, results: bos, runAt: NOW.toISOString(), runId: null, tekrar: 1, soruSayisi: 0, gorunme: null }) });
    expect(await t.olc()).toEqual({ results: bos, ranAt: NOW.toISOString() });
    expect(t.kv.kayitlar()).toEqual([]);
  });

  it('site bulunamadi: olcum yok, "calistirilmadi" nedeni', async () => {
    const t = kurulum({ site: null });
    expect(await t.olc()).toEqual({ skipped: { code: 'NOT_RUN', message: 'Bu taramada AI ölçümü çalıştırılmadı.', nextAvailableAt: null } });
    expect(t.tracker.snapshotSite).not.toHaveBeenCalled();
  });
});

describe('runSetupMeasurement — ayni kurulumun yeniden denemesi olcmez', () => {
  const kosum = (runAt: Date, over: Partial<{ providers: unknown; matchVersion: number }> = {}) => ({
    siteId: 's1',
    runAt,
    matchVersion: SITE_MEASUREMENT_VERSION,
    providers: [
      { provider: 'openai', label: 'OpenAI ChatGPT', available: true, score: 50, reason: null, tekrar: 3, probes: [{ query: 'q', cited: false, brandMentioned: true, excerpt: 'x' }] },
      { provider: 'meta', label: 'Meta AI (Muse)', available: false, score: null, reason: 'NO_KEY', probes: [] },
    ],
    ...over,
  });

  it('zincir yeniden denendi (ilk denemede olculmustu): asistanlara SORULMAZ, o olcum denetime verilir; "sinir doldu" yazilmaz', async () => {
    const birSaatOnce = new Date(NOW.getTime() - 60 * 60 * 1000);
    // Ilk deneme alan adini kaydetmisti: yeniden kullanim olmasa ikinci deneme 'domain' ile kesilirdi
    const t = kurulum({ kv: kvTable(onceki(['ornek.com'], 0)), runs: [kosum(birSaatOnce)] });
    const r: any = await t.olc();
    expect(t.tracker.snapshotSite).not.toHaveBeenCalled();
    expect(r.skipped).toBeUndefined();
    expect(r.ranAt).toBe(birSaatOnce.toISOString());
    expect(r.results.map((x: any) => [x.provider, x.available, x.score, x.modelTier])).toEqual([
      ['openai', true, 50, 'premium'],
      ['meta', false, null, 'premium'],
    ]);
    expect(r.results[0].probes).toHaveLength(1);
    // Yeniden kullanim sinirdan yer harcamaz
    expect(t.kv.kayitlar()).toHaveLength(1);
  });

  it('kademe kosumun yontem surumunden okunur (Baslangic / deneme: standard)', async () => {
    const t = kurulum({ runs: [kosum(new Date(NOW.getTime() - 1000), { matchVersion: siteMeasurementVersion('standard') })] });
    const r: any = await t.olc();
    expect(r.results[0].modelTier).toBe('standard');
  });

  it('24 saatten eski kosum yeniden kullanilmaz; baska sitenin kosumu da', async () => {
    const eski = kurulum({ runs: [kosum(new Date(NOW.getTime() - SETUP_REUSE_WINDOW_MS - 1000))] });
    await eski.olc();
    expect(eski.tracker.snapshotSite).toHaveBeenCalledTimes(1);
    const baska = kurulum({ runs: [{ ...kosum(new Date(NOW.getTime() - 1000)), siteId: 's-baska' }] });
    await baska.olc();
    expect(baska.tracker.snapshotSite).toHaveBeenCalledTimes(1);
  });

  it('onceki kosum hic skor uretmediyse yeniden kullanilmaz (olculur)', async () => {
    const skorsuz = kosum(new Date(NOW.getTime() - 1000), { providers: [{ provider: 'openai', label: 'OpenAI ChatGPT', available: false, score: null, probes: [] }] });
    const t = kurulum({ runs: [skorsuz] });
    await t.olc();
    expect(t.tracker.snapshotSite).toHaveBeenCalledTimes(1);
  });

  it('kosum okunamazsa yok sayilir; sinir yine de ikinci olcumu keser', async () => {
    const t = kurulum({ kv: kvTable(onceki(['ornek.com'], 0)) });
    t.prisma.aiCitationRun.findFirst.mockImplementation(async () => { throw new Error('db'); });
    expect(await t.olc()).toEqual({ skipped: setupLimitSkip('domain', 5) });
    expect(t.tracker.snapshotSite).not.toHaveBeenCalled();
  });
});

// ── Denetim: AI adimini cagiran saglar (runAudit opts.aiOlcumu) ────────────────

function denetim() {
  const auditCreate = vi.fn(async ({ data }: any) => ({ id: 'a1', ...data }));
  const prisma = {
    kvStore: { upsert: vi.fn(async () => ({})), deleteMany: vi.fn(async () => ({})), findUnique: vi.fn(async () => null) },
    site: { findUniqueOrThrow: async () => ({ id: 's1', userId: 'u1', url: 'https://ornek.com' }), update: vi.fn(async () => ({})), updateMany: vi.fn(async () => ({ count: 1 })) },
    audit: { create: auditCreate },
  };
  const crawler = { crawl: vi.fn(async () => ({ baseUrl: 'https://ornek.com', pages: [], sitemapUrl: null, robotsTxt: null, llmsTxt: null, totalPages: 0 })) };
  const pagespeed = { runAudit: vi.fn(async () => null) };
  const geo = { runAudit: vi.fn(async () => ({ score: 50, methods: [], queries: [], details: { methodVersion: 2 } })) };
  const aiCitation = { runForSite: vi.fn(async () => [{ provider: 'openai', label: 'OpenAI ChatGPT', available: true, score: 99, probes: [] }]) };
  const svc = new AuditService(prisma as never, crawler as never, new AuditChecksService(), pagespeed as never, geo as never, aiCitation as never, null as never);
  return { svc, aiCitation, ai: () => auditCreate.mock.calls[0][0].data.checks.aiCitations, data: () => auditCreate.mock.calls[0][0].data };
}

describe('runAudit opts.aiOlcumu — kurulumda denetim asistanlara kendisi sormaz', () => {
  it('verilen sonuc AI bolumune yazilir (ortalama skor, saglayicilar, olcum ani); runForSite CAGRILMAZ', async () => {
    const t = denetim();
    const ranAt = '2026-11-11T11:58:00.000Z';
    await t.svc.runAudit('s1', { trigger: 'system', aiOlcumu: async () => ({ results: OLCUM as any, ranAt }) });
    expect(t.aiCitation.runForSite).not.toHaveBeenCalled();
    expect(t.ai().score).toBe(25);
    expect(t.ai().providers.map((p: any) => p.provider)).toEqual(['openai', 'gemini']);
    expect(t.ai().ranAt).toBe(ranAt);
    expect(t.ai()).not.toHaveProperty('skipped');
    expect(t.ai().details).toEqual({ methodVersion: SITE_MEASUREMENT_VERSION });
    // Dusuk skor sorunu eskisi gibi uretilir
    expect((t.data().issues as any[]).some((i) => i.type === 'ai_citation_low')).toBe(true);
    expect(t.data().trigger).toBe('system');
  });

  it('sinir doldu: skor null + neden (0 degil, hata degil); ai_citation_low uretilmez; denetimin geri kalani yazilir', async () => {
    const t = denetim();
    const skipped = setupLimitSkip('account', 5);
    await t.svc.runAudit('s1', { trigger: 'system', aiOlcumu: async () => ({ skipped }) });
    expect(t.aiCitation.runForSite).not.toHaveBeenCalled();
    expect(t.ai().score).toBeNull();
    expect(t.ai().providers).toEqual([]);
    expect(t.ai().skipped).toEqual(skipped);
    expect((t.data().issues as any[]).some((i) => i.type === 'ai_citation_low')).toBe(false);
    expect(typeof t.data().overallScore).toBe('number');
  });

  it('kurulum olcumu hata firlatti (brain / saglayici): denetim dusmez, AI bolumu "tamamlanamadi"', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    for (const aiOlcumu of [async () => { throw new Error('brain uretilemedi'); }, () => { throw new Error('es zamanli hata'); }]) {
      const t = denetim();
      await t.svc.runAudit('s1', { trigger: 'system', aiOlcumu: aiOlcumu as any });
      expect(t.aiCitation.runForSite).not.toHaveBeenCalled();
      expect(t.ai().skipped).toEqual({ code: 'ERROR', message: 'AI ölçümü bu taramada tamamlanamadı.', nextAvailableAt: null });
      expect(typeof t.data().overallScore).toBe('number');
    }
    warn.mockRestore();
  });

  it('secenek verilmezse eski davranis: denetim kendi olcer (panelden baslatilan tarama degismedi)', async () => {
    const t = denetim();
    await t.svc.runAudit('s1');
    expect(t.aiCitation.runForSite).toHaveBeenCalledWith('s1', 5, { trigger: 'user' });
    expect(t.ai().score).toBe(99);
  });
});

// ── Uctan uca: kurulum zincirinin AI adimi (worker'in aynasi) ─────────────────

describe('kurulum zinciri — TEK olcum hem gecmise hem denetime yazilir', () => {
  /** Gercek AiCitationTrackerService + sahte olcum motoru: motor kac kez cagrildi sayilir */
  function zincir(opts: { kv?: ReturnType<typeof kvTable>; site?: { url?: string; plan?: string; role?: string } } = {}) {
    const kv = opts.kv ?? kvTable();
    const motor = { runForSite: vi.fn(async () => OLCUM) };
    const snapshots: any[] = [];
    const runs: any[] = [];
    const site = { url: 'https://ornek.com', plan: 'PRO', role: 'USER', ...opts.site };
    const prisma = {
      kvStore: kv.kvStore,
      site: { findUnique: vi.fn(async () => ({ url: site.url, userId: 'u1', user: { plan: site.plan, role: site.role } })) },
      aiCitationSnapshot: { upsert: vi.fn(async ({ create }: any) => { snapshots.push(create); return create; }) },
      aiCitationRun: {
        create: vi.fn(async ({ data }: any) => { runs.push({ siteId: data.siteId, ...data }); return { id: `r${runs.length}` }; }),
        findFirst: vi.fn(async ({ where }: any) => runs
          .filter((r) => r.siteId === where.siteId && r.runAt.getTime() >= where.runAt.gte.getTime())
          .sort((a, b) => b.runAt.getTime() - a.runAt.getTime())[0] ?? null),
      },
    };
    const tracker = new AiCitationTrackerService(prisma as any, motor as any);
    const d = denetim();
    // apps/worker/src/index.ts ONBOARDING_CHAIN ile ayni kablolama (asagidaki test metni sabitler)
    const brainPromise = Promise.resolve(null);
    const kurulumOlcumu = () => brainPromise.then(() => runSetupMeasurement({ prisma: prisma as any, tracker, log: sessiz }, 's1'));
    const kos = () => d.svc.runAudit('s1', { trigger: 'system', aiOlcumu: kurulumOlcumu });
    return { kv, motor, snapshots, runs, d, kos };
  }

  it('asistanlara TAM BIR KEZ sorulur; kosum + gunluk snapshot yazilir ve denetimin AI bolumu ayni skorlari tasir', async () => {
    const t = zincir();
    await t.kos();
    // Eskiden 2: denetimin AI testi + baslangic olcumu
    expect(t.motor.runForSite).toHaveBeenCalledTimes(1);
    expect(t.motor.runForSite).toHaveBeenCalledWith('s1', 5, { trigger: 'system' });
    expect(t.d.aiCitation.runForSite).not.toHaveBeenCalled();
    // (b) gecmis: kosum satiri + saglayici basina gunluk snapshot
    expect(t.runs).toHaveLength(1);
    expect(t.runs[0]).toMatchObject({ siteId: 's1', trigger: 'system' });
    expect(t.snapshots.map((s) => [s.provider, s.score])).toEqual([['openai', 50], ['gemini', 0]]);
    // (a) denetim: ayni olcum
    expect(t.d.ai().score).toBe(25);
    expect(t.d.ai().providers.map((p: any) => [p.provider, p.score])).toEqual([['openai', 50], ['gemini', 0]]);
    expect(t.d.ai().ranAt).toBe(t.runs[0].runAt.toISOString());
    expect(t.kv.kayitlar().map((r) => r.host)).toEqual(['ornek.com']);
  });

  it('sinir dolu: asistanlara hic sorulmaz, gecmise bos kayit yazilmaz, denetim nedeni tasir ve tamamlanir', async () => {
    const t = zincir({ kv: kvTable(onceki(['ornek.com'], 10)) });
    await t.kos();
    expect(t.motor.runForSite).not.toHaveBeenCalled();
    expect(t.runs).toEqual([]);
    expect(t.snapshots).toEqual([]);
    expect(t.d.ai().skipped).toEqual(setupLimitSkip('domain', 5));
    expect(t.d.ai().score).toBeNull();
  });

  it('denetim dustukten sonraki yedek cagri (worker): AI adimi kostuysa ikinci kez olculmez; kosmadiysa bir kez olculur', async () => {
    // AI adimi kosmus, denetim sonradan dusmus: yedek cagri ayni olcumu yeniden kullanir
    const t = zincir();
    await t.kos();
    const prisma = { kvStore: t.kv.kvStore, site: { findUnique: async () => ({ url: 'https://ornek.com', userId: 'u1', user: { plan: 'PRO', role: 'USER' } }) }, aiCitationRun: { findFirst: async () => t.runs[0] } };
    const tracker = { snapshotSite: vi.fn() };
    const yedek = await runSetupMeasurement({ prisma: prisma as any, tracker: tracker as any, log: sessiz }, 's1');
    expect(tracker.snapshotSite).not.toHaveBeenCalled();
    expect(yedek).toHaveProperty('results');
    expect(t.motor.runForSite).toHaveBeenCalledTimes(1);
    // AI adimi hic kosmamis (denetim taramada dustu): yedek cagri olcer ve kaydeder
    const hic = kurulum();
    await hic.olc();
    expect(hic.tracker.snapshotSite).toHaveBeenCalledTimes(1);
    expect(hic.kv.kayitlar()).toHaveLength(1);
  });

  it('zincir yeniden denenirse (ayni site) ikinci deneme olcmez ve denetim ilk olcumu gosterir', async () => {
    const t = zincir();
    await t.kos();
    const ikinci = denetim();
    const prisma = { kvStore: t.kv.kvStore, site: { findUnique: async () => ({ url: 'https://ornek.com', userId: 'u1', user: { plan: 'PRO', role: 'USER' } }) }, aiCitationRun: { findFirst: async () => t.runs[0] } };
    const tracker = { snapshotSite: vi.fn() };
    await ikinci.svc.runAudit('s1', { trigger: 'system', aiOlcumu: () => runSetupMeasurement({ prisma: prisma as any, tracker: tracker as any, log: sessiz }, 's1') });
    expect(tracker.snapshotSite).not.toHaveBeenCalled();
    expect(t.motor.runForSite).toHaveBeenCalledTimes(1);
    expect(ikinci.ai().score).toBe(25);
    expect(ikinci.ai()).not.toHaveProperty('skipped');
  });
});

describe('worker kablolamasi (apps/worker/src/index.ts) — kurulumda tek otomatik olcum', () => {
  // Worker'in test kosucusu yok; kural bu modulden gelmeli
  const src = readFileSync(new URL('../../../worker/src/index.ts', import.meta.url), 'utf8');
  const zincir = src.slice(src.indexOf('ONBOARDING_CHAIN: async'), src.indexOf('PROCESS_SCHEDULED: async'));

  it('kurulum olcumu api/dist\'teki fonksiyondan gelir; brain bittikten sonra, worker\'in kendi servisleriyle', () => {
    expect(src).toContain("import { runSetupMeasurement } from '../../api/dist/audit/setup-measurement.js';");
    expect(zincir).toMatch(
      /const kurulumOlcumu = \(\) => brainPromise\.then\(\(\) => runSetupMeasurement\(\s*\{ prisma: services\.prisma, tracker: services\.citationTracker, log \},\s*siteId,\s*\)\);/,
    );
    expect(zincir.indexOf('const brainPromise =')).toBeLessThan(zincir.indexOf('const kurulumOlcumu ='));
  });

  it('denetim AI adimini kurulum olcumunden alir (sistem taramasi); TEST modunda eski cagri', () => {
    expect(zincir).toMatch(
      /const auditPromise = \(aiGlobalOff\s*\? services\.audit\.runAudit\(siteId, \{ trigger: 'system' \}\)\s*: services\.audit\.runAudit\(siteId, \{ trigger: 'system', aiOlcumu: kurulumOlcumu \}\)\s*\)\.catch\(/,
    );
    // Kurulumda kullanici tetikli (haftalik hakki yiyen) tarama yok
    expect(zincir).not.toMatch(/runAudit\(siteId\)/);
    expect(zincir.match(/services\.audit\.runAudit\(/g)).toHaveLength(2);
  });

  it('zincirde IKINCI bir olcum yok: baslangic olcumu ayrica alinmaz, olcum motoru dogrudan cagrilmaz', () => {
    expect(zincir).not.toContain('snapshotSite(');
    expect(zincir).not.toContain('runForSite(');
    expect(zincir.match(/runSetupMeasurement\(/g)).toHaveLength(1);
  });

  it('denetim dustuyse kurulum olcumu yine alinir (gecmise yazilsin); TEST modunda alinmaz', () => {
    expect(zincir).toMatch(
      /if \(!audit && !aiGlobalOff\) \{\s*await kurulumOlcumu\(\)\.catch\(\(err: any\) => log\.warn\(`\[\$\{siteId\}\] Kurulum olcumu alinamadi: \$\{err\.message\}`\)\);\s*\}/,
    );
    // Yedek cagri denetim bittikten SONRA: denetimin AI adimi kostuysa ayni olcum yeniden kullanilir
    expect(zincir.indexOf('const [audit] = await Promise.all([auditPromise, platformPromise]);')).toBeLessThan(zincir.indexOf('if (!audit && !aiGlobalOff) {'));
    // Kurulum olcumunun cagrildigi yerler: denetimin AI adimi + bu yedek (tanim dahil 3 kullanim)
    expect(zincir.match(/kurulumOlcumu\b/g)).toHaveLength(3);
  });

  it('olcumu yapan ve siniri uygulayan kod: sistem olcumu, tek cagri (kaynak)', () => {
    const kaynak = readFileSync(new URL('./setup-measurement.ts', import.meta.url), 'utf8');
    expect(kaynak.match(/snapshotSite\(siteId, \{ trigger: 'system' \}\)/g)).toHaveLength(1);
    expect(kaynak.indexOf('await reserveSetupMeasurement(')).toBeLessThan(kaynak.indexOf("deps.tracker.snapshotSite(siteId, { trigger: 'system' })"));
  });
});
