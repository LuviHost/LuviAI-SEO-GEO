import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./places-istemci.js', async (orig) => {
  const gercek = await orig<typeof import('./places-istemci.js')>();
  return { ...gercek, placeAra: vi.fn(), placeDetay: vi.fn(), placeFotoUrl: vi.fn() };
});
vi.mock('../audit/site-nap.js', () => ({ readSiteNap: vi.fn(async () => ({ phones: ['+902165551122'], addresses: [], sources: ['tel-link'], businessTypes: [] })) }));

import { adayYap, placeAra, placeDetay, placeFotoUrl, type PlaceAdayHam } from './places-istemci.js';
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
beforeEach(() => { for (const [k, v] of Object.entries(ENV)) { eski[k] = process.env[k]; process.env[k] = v; } vi.mocked(placeAra).mockReset(); vi.mocked(placeDetay).mockReset(); vi.mocked(placeFotoUrl).mockReset(); });
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
    await svc.ara('kahve kadıköy'); // 0.035
    await svc.ara('kahve kadıköy'); // 0.070
    await expect(svc.ara('kahve kadıköy')).rejects.toThrow(/kapasite/); // 0.105 > 0.1
    expect(placeAra).toHaveBeenCalledTimes(2);
  });

  it('aday kartlari: foto alinir, site eslesmesi en uste; foto tavana takilirsa kart fotosuz doner', async () => {
    const p = sahtePrisma();
    const svc = new GbpService(p as any, {} as any);
    const ham = (id: string, web?: string): PlaceAdayHam => adayYap({
      id, displayName: { text: id }, websiteUri: web,
      photos: [{ name: `places/${id}/photos/AbCdEfGhIjKl`, authorAttributions: [{ displayName: 'Ayşe', uri: 'https://maps.google.com/maps/contrib/1' }] }],
    });
    vi.mocked(placeAra).mockResolvedValue([ham('ChIJbaskasi01', 'https://baska.com'), ham('ChIJbizimki01', 'https://www.kahveduragi.com/iletisim')]);
    vi.mocked(placeFotoUrl).mockResolvedValue('https://lh3.googleusercontent.com/x');
    const r = await svc.ara('kahve kadıköy', false, 'u1', 's1');
    expect(r.map((a) => [a.placeId, a.siteEslesme])).toEqual([['ChIJbizimki01', true], ['ChIJbaskasi01', false]]);
    expect(r[0].foto).toEqual({ url: 'https://lh3.googleusercontent.com/x', yazar: { ad: 'Ayşe', uri: 'https://maps.google.com/maps/contrib/1' } });
    expect(r[0]).not.toHaveProperty('fotoAdi');
    // Ilk arama 0.035 + 2×0.007 = 0.049. Ikinci: 0.084 + iki foto payi 0.098 (tavan 0.1 icinde);
    // biri hata verir → payi geri alinir → 0.091
    vi.mocked(placeFotoUrl).mockRejectedValueOnce(new Error('zaman asimi'));
    const r2 = await svc.ara('kahve kadıköy', false, 'u1', 's1');
    expect(r2.filter((a) => a.foto === null)).toHaveLength(1); // hata veren foto iade edildi, kart fotosuz
    expect(Number(p.kv.get([...p.kv.keys()].find((k) => k.startsWith('places-cost:'))!))).toBeCloseTo(0.091, 5);
  });

  it('foto butcesi yetmezse arama yine doner (fotosuz)', async () => {
    process.env.PLACES_DAILY_BUDGET_USD = '0.04';
    const svc = new GbpService(sahtePrisma() as any, {} as any);
    vi.mocked(placeAra).mockResolvedValue([adayYap({ id: 'ChIJbaskasi01', photos: [{ name: 'places/ChIJbaskasi01/photos/AbCdEfGhIjKl' }] })]);
    vi.mocked(placeFotoUrl).mockResolvedValue('https://lh3.googleusercontent.com/x');
    const r = await svc.ara('kahve kadıköy');
    expect(r[0].foto).toBeNull();
    expect(placeFotoUrl).not.toHaveBeenCalled();
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
