import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ClientReportService, tanimliRakipler } from './client-report.service.js';
import { mukellefGirdisi } from './client-report.fixture.js';
import { SITE_BASINA_PAYLASIM, paylasimAnahtari } from './client-report-share.js';

/**
 * Paylasim ve veri toplama.
 *
 * NEDEN VAR: paylasilan baglanti musteriye gider. Musteri "paylasilan neyse
 * onu" gormeli (snapshot sonradan degismez), geri alinan / suresi dolan /
 * baska sitenin linki 404 olmali ve kv_store'un harf duyarsiz harmanlamasi
 * (utf8mb4_unicode_ci) ile LIKE '_' jokeri yanlis rapora goturmemeli.
 */
const SITE = 'cmsitemukellef00000000001';
const BASKA = 'cmsitebaska00000000000001';
const NOW = new Date('2026-10-22T10:00:00.000Z');
const DAY = 86_400_000;

type KvRow = { key: string; value: string; expiresAt: Date | null; updatedAt: Date };

/** MySQL davranisini taklit eden kv: esitlik ve onek harf DUYARSIZ, LIKE '_' tek karakter joker */
function fakeKv() {
  const rows = new Map<string, KvRow>();
  const ci = (s: string) => s.toLowerCase();
  const like = (key: string, prefix: string) => {
    if (key.length < prefix.length) return false;
    for (let i = 0; i < prefix.length; i++) {
      if (prefix[i] === '_') continue;
      if (ci(prefix[i]) !== ci(key[i])) return false;
    }
    return true;
  };
  const match = (r: KvRow, w: any): boolean => {
    if (!w) return true;
    if (w.AND) return w.AND.every((x: any) => match(r, x)) && match(r, { ...w, AND: undefined });
    if (typeof w.key === 'string' && ci(r.key) !== ci(w.key)) return false;
    const k = w.key && typeof w.key === 'object' ? w.key : {};
    if (k.startsWith && !like(r.key, k.startsWith)) return false;
    if (k.endsWith && !ci(r.key).endsWith(ci(k.endsWith))) return false;
    if (w.expiresAt?.gt && !(r.expiresAt && r.expiresAt > w.expiresAt.gt)) return false;
    if (w.expiresAt?.lte && !(r.expiresAt && r.expiresAt <= w.expiresAt.lte)) return false;
    return true;
  };
  const find = (w: any) => [...rows.values()].filter((r) => match(r, w));
  return {
    rows,
    findMany: vi.fn(async ({ where, take }: any) => find(where).slice(0, take ?? 1000)),
    count: vi.fn(async ({ where }: any) => find(where).length),
    findUnique: vi.fn(async ({ where }: any) => find({ key: where.key })[0] ?? null),
    create: vi.fn(async ({ data }: any) => {
      if (find({ key: data.key }).length) throw new Error('P2002');
      const row = { key: data.key, value: data.value, expiresAt: data.expiresAt ?? null, updatedAt: new Date(NOW) };
      rows.set(data.key, row);
      return row;
    }),
    deleteMany: vi.fn(async ({ where }: any) => {
      const hit = find(where);
      for (const r of hit) rows.delete(r.key);
      return { count: hit.length };
    }),
  };
}

function setup() {
  const kv = fakeKv();
  const g = mukellefGirdisi();
  const state = { audit: { ...(g.audit as any), id: 'a1' } as any, sites: new Set([SITE, BASKA]) };
  const prisma: any = {
    kvStore: kv,
    site: {
      findUnique: vi.fn(async ({ where }: any) => (state.sites.has(where.id)
        ? { id: where.id, name: 'Mükellef', url: 'https://mukellef.co', userId: 'u1', ingestSecret: 'x', brain: { competitors: [{ name: 'Rakip A' }, 'Mükellef', 'ab'] } }
        : null)),
    },
    aiCitationRun: { findFirst: vi.fn(async () => g.aiKosum) },
    aiCrawlerHit: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
    article: { count: vi.fn(async () => 0), findMany: vi.fn(async () => []) },
    geoPromptRun: { findMany: vi.fn(async () => []) },
    siteImage: { count: vi.fn(async () => 0), findFirst: vi.fn(async () => ({ id: 'img' })) },
    agentReadinessScan: { findFirst: vi.fn(async () => null) },
    user: { findUnique: vi.fn(async () => null) },
  };
  const audit = { getLatest: vi.fn(async () => state.audit) };
  const kpis = { getKpis: vi.fn(async () => ({ mentionRate: { value: null }, shareOfVoice: { value: null }, queryMix: { branded: 0, unbranded: 0 } })) };
  const tracker = { getHistory: vi.fn(async () => ({ headline: { score: 17, method: 'first-run' } })) };
  const actionPlans = { list: vi.fn(async () => []) };
  const quota = { articleLimitFor: vi.fn(() => 2) };
  const svc = new ClientReportService(prisma, audit as any, kpis as any, tracker as any, actionPlans as any, quota as any);
  return { svc, kv, prisma, state, audit, kpis };
}

describe('ClientReportService.build — kayitli olcumden, yeni olcum yok', () => {
  it('panel KPI kaynaklarini okur; site yoksa 404', async () => {
    const { svc, audit, kpis } = setup();
    const r = await svc.build(SITE, NOW);
    expect(audit.getLatest).toHaveBeenCalledWith(SITE);
    expect(kpis.getKpis).toHaveBeenCalledWith(SITE);
    expect(r.ozet.kpiler[0]).toMatchObject({ deger: 76 });
    expect(r.ai.rakipler.tanimli).toEqual(['Rakip A']);
    await expect(svc.build('cmyok0000000000000000000x', NOW)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('bir kaynak hata verirse rapor dusmez, o bolum "olculemedi" olur (sifir yazilmaz)', async () => {
    const { svc, audit, kpis } = setup();
    audit.getLatest.mockRejectedValueOnce(new Error('db down'));
    kpis.getKpis.mockRejectedValueOnce(new Error('db down'));
    const r = await svc.build(SITE, NOW);
    expect(r.seo.olculemedi).toBe(true);
    expect(r.ai.anilmaOrani.olculemedi).toBe(true);
    expect(r.ozet.kpiler[0].deger).toBeNull();
  });
});

describe('paylasim — snapshot, geri alma, sure, erisim', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => { ctx = setup(); });

  it('olusturma: anahtar siteId tasir (site silinince kv temizligi yakalar), varsayilan 30 gun', async () => {
    const p = await ctx.svc.createShare(SITE, 'u1', undefined, NOW);
    expect(p.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(p.yol).toBe(`/rapor/${p.token}`);
    expect(new Date(p.sonGecerlilik).getTime() - NOW.getTime()).toBe(30 * DAY);
    const row = ctx.kv.rows.get(paylasimAnahtari(p.token, SITE))!;
    expect(row.key).toContain(SITE);
    expect(row.expiresAt!.toISOString()).toBe(p.sonGecerlilik);
    expect(Buffer.byteLength(row.value)).toBeLessThan(60_000);
  });

  it('snapshot DEGISMEZ: veri sonra degisse de musteri paylasilani gorur', async () => {
    const p = await ctx.svc.createShare(SITE, 'u1', 7, NOW);
    ctx.state.audit = { ...ctx.state.audit, overallScore: 91 };
    const canli = await ctx.svc.build(SITE, NOW);
    expect(canli.ozet.kpiler[0].deger).toBe(91);
    const pub = await ctx.svc.getPublic(p.token, new Date(NOW.getTime() + DAY));
    expect(pub.rapor.ozet.kpiler[0].deger).toBe(76);
    expect(pub.rapor.generatedAt).toBe(NOW.toISOString());
    expect(pub.paylasim.sonGecerlilik).toBe(new Date(NOW.getTime() + 7 * DAY).toISOString());
  });

  it('gecersiz bicimli token DB\'ye gitmeden 404', async () => {
    for (const t of ['kisa', '../../etc', 'a'.repeat(65), 'x'.repeat(31), 'a b'.repeat(12)]) {
      await expect(ctx.svc.getPublic(t, NOW)).rejects.toBeInstanceOf(NotFoundException);
    }
    expect(ctx.kv.findMany).not.toHaveBeenCalled();
  });

  it('olmayan token 404', async () => {
    await expect(ctx.svc.getPublic('A'.repeat(32), NOW)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('geri alinan paylasim 404', async () => {
    const p = await ctx.svc.createShare(SITE, 'u1', 30, NOW);
    await ctx.svc.revokeShare(SITE, p.token);
    await expect(ctx.svc.getPublic(p.token, NOW)).rejects.toBeInstanceOf(NotFoundException);
    expect(ctx.kv.rows.size).toBe(0);
  });

  it('suresi dolan paylasim 404 ve satir hemen silinir (gunluk temizlik beklenmez)', async () => {
    const p = await ctx.svc.createShare(SITE, 'u1', 1, NOW);
    await expect(ctx.svc.getPublic(p.token, new Date(NOW.getTime() + DAY + 1))).rejects.toBeInstanceOf(NotFoundException);
    expect(ctx.kv.rows.size).toBe(0);
  });

  it('baska sitenin tokeni bu siteden geri alinamaz (404, satir yerinde)', async () => {
    const p = await ctx.svc.createShare(BASKA, 'u2', 30, NOW);
    await expect(ctx.svc.revokeShare(SITE, p.token)).rejects.toBeInstanceOf(NotFoundException);
    expect(ctx.kv.rows.size).toBe(1);
    expect(await ctx.svc.listShares(SITE, NOW)).toEqual([]);
    expect((await ctx.svc.listShares(BASKA, NOW)).map((s) => s.token)).toEqual([p.token]);
  });

  it('harf duyarsiz harmanlama / LIKE jokeri: tokenin farkli yazimi baska raporu acmaz', async () => {
    const p = await ctx.svc.createShare(SITE, 'u1', 30, NOW);
    const ters = p.token.replace(/[a-zA-Z]/g, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
    if (ters !== p.token) await expect(ctx.svc.getPublic(ters, NOW)).rejects.toBeInstanceOf(NotFoundException);
    const joker = `${p.token.slice(0, 31)}_`;
    if (joker !== p.token) await expect(ctx.svc.getPublic(joker, NOW)).rejects.toBeInstanceOf(NotFoundException);
    await expect(ctx.svc.revokeShare(SITE, ters === p.token ? 'Z'.repeat(32) : ters)).rejects.toBeInstanceOf(NotFoundException);
    await expect(ctx.svc.getPublic(p.token, NOW)).resolves.toBeTruthy();
  });

  it('sitesi silinmis paylasim 404', async () => {
    const p = await ctx.svc.createShare(SITE, 'u1', 30, NOW);
    ctx.state.sites.delete(SITE);
    await expect(ctx.svc.getPublic(p.token, NOW)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('liste govdeyi okumaz, yalniz etkin paylasimlar; site basina sinir', async () => {
    const a = await ctx.svc.createShare(SITE, 'u1', 30, NOW);
    await ctx.svc.createShare(SITE, 'u1', 1, NOW);
    const liste = await ctx.svc.listShares(SITE, new Date(NOW.getTime() + 2 * DAY));
    expect(liste.map((s) => s.token)).toEqual([a.token]);
    expect(ctx.kv.findMany.mock.calls.at(-1)![0].select).toEqual({ key: true, expiresAt: true, updatedAt: true });
    for (let i = ctx.kv.rows.size; i < SITE_BASINA_PAYLASIM; i++) await ctx.svc.createShare(SITE, 'u1', 30, NOW);
    await expect(ctx.svc.createShare(SITE, 'u1', 30, NOW)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('tanimliRakipler', () => {
  it('dize ya da {name}; marka ve kisa adlar disarida; tekil', () => {
    expect(tanimliRakipler(['A', 'Rakip', { name: 'Rakip' }, { name: 'Marka' }, null, 5], 'marka')).toEqual(['Rakip']);
  });
});
