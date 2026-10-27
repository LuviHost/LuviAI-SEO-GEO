import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./places-istemci.js', async (orig) => {
  const gercek = await orig<typeof import('./places-istemci.js')>();
  return { ...gercek, placeAra: vi.fn(), placeDetay: vi.fn() };
});
vi.mock('../audit/site-nap.js', () => ({ readSiteNap: vi.fn(async () => ({ phones: ['+902165551122'], addresses: [], sources: ['tel-link'], businessTypes: [] })) }));

import { placeAra, placeDetay } from './places-istemci.js';
import { GbpService } from './gbp.service.js';

function sahtePrisma() {
  const kv = new Map<string, string>();
  const gbp = new Map<string, any>();
  return {
    kv,
    kvStore: { findUnique: async ({ where }: any) => (kv.has(where.key) ? { key: where.key, value: kv.get(where.key) } : null) },
    $executeRawUnsafe: async (_sql: string, key: string, _v: string, n: number) => { kv.set(key, String((Number(kv.get(key)) || 0) + n)); },
    siteGbp: {
      findUnique: async ({ where }: any) => gbp.get(where.siteId) ?? null,
      upsert: async ({ where, create, update }: any) => { gbp.set(where.siteId, { ...(gbp.get(where.siteId) ?? create), ...update }); },
      updateMany: async ({ where, data }: any) => { if (gbp.has(where.siteId)) Object.assign(gbp.get(where.siteId), data); },
    },
    site: { findUnique: async () => ({ url: 'https://kahveduragi.com', name: 'Kahve', userId: 'u1' }) },
  };
}

const ENV = { GOOGLE_PLACES_API_KEY: 'k', PLACES_DAILY_BUDGET_USD: '0.1', PLACES_PUBLIC_DAILY_BUDGET_USD: '0.05' };
const eski: Record<string, string | undefined> = {};
beforeEach(() => { for (const [k, v] of Object.entries(ENV)) { eski[k] = process.env[k]; process.env[k] = v; } vi.mocked(placeAra).mockReset(); vi.mocked(placeDetay).mockReset(); });
afterEach(() => { for (const k of Object.keys(ENV)) { if (eski[k] === undefined) delete process.env[k]; else process.env[k] = eski[k]; } });

describe('GbpService', () => {
  it('denetim: place secilmeden olmaz; secilince site NAP ile denetler ve yerel oneri doner', async () => {
    const p = sahtePrisma();
    const svc = new GbpService(p as any, {} as any);
    await expect(svc.denetle('s1')).rejects.toThrow(/seçin/);
    await svc.placeBagla('s1', 'ChIJabcdefghij');
    vi.mocked(placeDetay).mockResolvedValue({
      id: 'ChIJabcdefghij', displayName: { text: 'Kahve Durağı' }, primaryType: 'cafe', primaryTypeDisplayName: { text: 'Kafe' },
      internationalPhoneNumber: '+90 216 555 11 22', websiteUri: 'https://kahveduragi.com',
      addressComponents: [{ longText: 'Kadıköy', types: ['administrative_area_level_2'] }, { longText: 'İstanbul', types: ['administrative_area_level_1'] }],
    });
    const r = await svc.denetle('s1');
    expect(r.maddeler.find((m) => m.kod === 'telefon')?.durum).toBe('iyi');
    expect(r.yerelOneri).toEqual({ il: 'İstanbul', ilceler: ['Kadıköy'], hizmetler: ['kafe'] });
  });

  it('gunluk harcama tavani asilinca Google cagrilmaz (503)', async () => {
    const p = sahtePrisma();
    const svc = new GbpService(p as any, {} as any);
    vi.mocked(placeAra).mockResolvedValue([]);
    await svc.ara('kahve kadıköy'); // 0.032
    await svc.ara('kahve kadıköy'); // 0.064
    await svc.ara('kahve kadıköy'); // 0.096
    await expect(svc.ara('kahve kadıköy')).rejects.toThrow(/kapasite/);
    expect(placeAra).toHaveBeenCalledTimes(3);
  });

  it('herkese acik tavan ayri ve daha dusuk', async () => {
    const p = sahtePrisma();
    const svc = new GbpService(p as any, {} as any);
    vi.mocked(placeAra).mockResolvedValue([]);
    await svc.ara('kahve kadıköy', true);
    await expect(svc.ara('kahve kadıköy', true)).rejects.toThrow(/kapasite/);
  });

  it('IP gunluk hakki dolar', async () => {
    const svc = new GbpService(sahtePrisma() as any, {} as any);
    for (let i = 0; i < GbpService.PUBLIC_IP_GUNLUK * 2; i++) await svc.publicHakKontrol('1.2.3.4', true);
    await expect(svc.publicHakKontrol('1.2.3.4', true)).rejects.toThrow(/hakkınız doldu/);
    await expect(svc.publicHakKontrol('5.6.7.8', true)).resolves.toBeUndefined();
  });

  it('anahtar yoksa ve API onayi yoksa acik mesaj', async () => {
    delete process.env.GOOGLE_PLACES_API_KEY;
    const svc = new GbpService(sahtePrisma() as any, {} as any);
    await expect(svc.ara('kahve kadıköy')).rejects.toThrow(/anahtarı/);
    delete process.env.GBP_API_ENABLED;
    expect(() => svc.yetkiUrl('x')).toThrow(/onayı/);
    await expect(svc.gonderiOlustur('s1', { metin: 'Bizi arayın 0532 123 45 67, yeni sezon başladı!' })).rejects.toThrow(/telefon/);
  });
});
