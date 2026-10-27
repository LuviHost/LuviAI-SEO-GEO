import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EpostaKampanyaService } from './eposta-kampanya.service.js';

/** Bellek ici sahte Prisma — yalniz servisin kullandigi cagrilar */
function sahtePrisma(hedefler: any[]) {
  const kv = new Map<string, { key: string; value: string; expiresAt: Date | null }>();
  const alan = (h: any, k: string, v: any): boolean => {
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('in' in v && !v.in.includes(h[k])) return false;
      if ('gte' in v && !(h[k] && h[k] >= v.gte)) return false;
      if ('lt' in v && !(h[k] && h[k] < v.lt)) return false;
      if ('startsWith' in v && !(typeof h[k] === 'string' && h[k].startsWith(v.startsWith))) return false;
      if ('not' in v && (h[k] == null || h[k] === v.not)) return false;
      return true;
    }
    return v === null ? h[k] == null : h[k] === v;
  };
  const eslesir = (h: any, w: any): boolean => {
    if (!w) return true;
    for (const [k, v] of Object.entries<any>(w)) {
      if (k === 'OR') { if (!v.some((x: any) => eslesir(h, x))) return false; continue; }
      if (k === 'NOT') { if (eslesir(h, v)) return false; continue; }
      if (!alan(h, k, v)) return false;
    }
    return true;
  };
  return {
    hedefler,
    kvStore: {
      findUnique: async ({ where }: any) => kv.get(where.key) ?? null,
      create: async ({ data }: any) => { if (kv.has(data.key)) throw new Error('P2002'); kv.set(data.key, { expiresAt: null, ...data }); },
      upsert: async ({ where, create, update }: any) => { kv.set(where.key, { ...(kv.get(where.key) ?? create), ...update, key: where.key }); },
      deleteMany: async ({ where }: any) => { const r = kv.get(where.key); if (r && eslesir(r, { ...where, key: undefined })) kv.delete(where.key); },
    },
    epostaHedef: {
      count: async ({ where }: any = {}) => hedefler.filter((h) => eslesir(h, where)).length,
      findMany: async ({ where, take }: any = {}) => hedefler.filter((h) => eslesir(h, where)).slice(0, take ?? 1e9),
      findUnique: async ({ where }: any) => hedefler.find((h) => h.email === where.email) ?? null,
      updateMany: async ({ where, data }: any) => { const m = hedefler.filter((h) => eslesir(h, where)); m.forEach((h) => Object.assign(h, data)); return { count: m.length }; },
      update: async ({ where, data }: any) => { const h = hedefler.find((x) => x.id === where.id); Object.assign(h, data); return h; },
    },
    linkedinProspect: { findMany: async () => [] },
  };
}

const hedef = (i: number, durum = 'SIRADA') => ({
  id: `h${i}`, email: `info@firma${i}.com.tr`, firma: `Firma${i} A.Ş.`, marka: null, sektor: 'ajans', varyant: 'A',
  durum, sonOlay: null, sonOlayAt: null, gonderildiAt: null, acildiAt: null, tiklandiAt: null, iysYuklendiAt: new Date(),
});

const ENV = {
  MAILJET_API_KEY: 'k', MAILJET_SECRET: 's', MAILJET_FROM_EMAIL: 'emir@ranksup.ai', MAILJET_GONDEREN_ADRES: 'Osmangazi/Bursa',
  MAILJET_KIMLIK: 'Emirhan Burgazlı · VKN 1 · Osmangazi V.D.',
};
const eski: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) { eski[k] = process.env[k]; process.env[k] = v; }
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-27T08:00:00Z')); // Sali 11:00 TR
});
afterEach(() => {
  for (const k of Object.keys(ENV)) { if (eski[k] === undefined) delete process.env[k]; else process.env[k] = eski[k]; }
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('EpostaKampanyaService.tick', () => {
  it('anahtar kapaliyken Mailjet cagrilmaz', async () => {
    const p = sahtePrisma([hedef(1)]);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const r = await new EpostaKampanyaService(p as any).tick();
    expect(r.neden).toBe('Kapalı');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('yalniz SIRADA gonderilir; basari/hata satir satir islenir; IYS bekleyen gitmez', async () => {
    const p = sahtePrisma([hedef(1), hedef(2), hedef(3, 'IYS_DOSYADA'), hedef(4, 'YENI')]);
    const fetchMock = vi.fn(async (_url: string, init: any) => {
      const body = JSON.parse(init.body);
      expect(body.Messages).toHaveLength(2);
      expect(body.Messages[0].TextPart).toContain('Merhaba {{var:firma}} ekibi,');
      expect(body.Messages[0].Variables.firma).toBe('Firma1');
      expect(body.Messages[0].TextPart).toContain('VKN 1');
      return { status: 200, text: async () => JSON.stringify({ Messages: [{ Status: 'success', To: [{ MessageID: 111 }] }, { Status: 'error', Errors: [{ ErrorMessage: 'x' }] }] }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    const svc = new EpostaKampanyaService(p as any);
    await svc.setAcik(true);
    const r = await svc.tick();
    expect(r).toMatchObject({ gonderildi: 1, hata: 1 });
    expect(p.hedefler[0]).toMatchObject({ durum: 'GONDERILDI', messageId: '111', sonOlay: 'sent' });
    expect(p.hedefler[1].durum).toBe('HATA');
    expect(p.hedefler[2].durum).toBe('IYS_DOSYADA');
    expect(p.hedefler[3].durum).toBe('YENI');
  });

  it('pencere disinda ve zorla verilmezse gondermez', async () => {
    vi.setSystemTime(new Date('2026-10-31T09:00:00Z')); // Cumartesi
    const p = sahtePrisma([hedef(1)]);
    const svc = new EpostaKampanyaService(p as any);
    await svc.setAcik(true);
    expect((await svc.tick()).neden).toMatch(/pencere/i);
  });

  it('ag hatasinda isaret kalir ve gonderim duraklar (ikinci mail riski yok)', async () => {
    const p = sahtePrisma([hedef(1)]);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('timeout'); }));
    const svc = new EpostaKampanyaService(p as any);
    await svc.setAcik(true);
    const r = await svc.tick();
    expect(r.neden).toMatch(/ulaşılamadı/);
    expect(p.hedefler[0].durum).toBe('SIRADA');
    expect(p.hedefler[0].sonOlay).toMatch(/^gonderiliyor:/);
    expect((await svc.tick()).neden).toMatch(/Duraklatıldı/);
  });

  it('son 7 gunde geri donme %3 ustundeyse durur', async () => {
    const gonderilmis = Array.from({ length: 40 }, (_, i) => ({ ...hedef(100 + i, i < 3 ? 'BOUNCE' : 'GONDERILDI'), gonderildiAt: new Date('2026-10-26T08:00:00Z') }));
    const p = sahtePrisma([...gonderilmis, hedef(1)]);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const svc = new EpostaKampanyaService(p as any);
    await svc.setAcik(true);
    expect((await svc.tick()).neden).toMatch(/geri dönme/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('Mailjet olaylari', () => {
  it('belirtec dogrulanir; olay acilma/ret isler, kapali durumu geri almaz', async () => {
    const h1 = { ...hedef(1, 'GONDERILDI') };
    const h2 = { ...hedef(2, 'RET') };
    const p = sahtePrisma([h1, h2]);
    const svc = new EpostaKampanyaService(p as any);
    expect(svc.belirtecGecerli('yanlis')).toBe(false);
    expect(svc.belirtecGecerli(svc.webhookBelirteci())).toBe(true);
    await svc.olaylariIsle([
      { event: 'open', email: h1.email, time: 1793000000, CustomID: `kurumsal-2026-10:${h1.email}` },
      { event: 'open', email: h1.email, CustomID: 'baska' },
      { event: 'bounce', email: h2.email, hard_bounce: true },
    ]);
    expect(h1.acildiAt).toBeInstanceOf(Date);
    expect(h2.durum).toBe('RET');
  });

  it('gonderiliyor isaretli SIRADA satira bizim olay gelirse GONDERILDI olur (yeniden gonderilmez); baska mesaj dokunmaz', async () => {
    const h = { ...hedef(5), sonOlay: 'gonderiliyor:x', sonOlayAt: new Date() };
    const p = sahtePrisma([h]);
    const svc = new EpostaKampanyaService(p as any);
    await svc.olaylariIsle({ event: 'open', email: h.email, CustomID: 'baska-sistem' });
    expect(h.durum).toBe('SIRADA');
    expect(h.sonOlay).toBe('gonderiliyor:x');
    await svc.olaylariIsle({ event: 'open', email: h.email, CustomID: `kurumsal-2026-10:${h.email}` });
    expect(h.durum).toBe('GONDERILDI');
    expect(h.gonderildiAt).toBeInstanceOf(Date);
  });
});

describe('kilit ve sahiplenme', () => {
  it('ikinci es zamanli tur kilidi alamaz; arada HARIC yapilan satir gonderilmez', async () => {
    const p = sahtePrisma([hedef(1), hedef(2)]);
    let birinciTur: Promise<any> | null = null;
    const svc = new EpostaKampanyaService(p as any);
    const fetchMock = vi.fn(async (_u: string, init: any) => {
      const body = JSON.parse(init.body);
      // POST surerken ikinci tur denenir → kilit yuzunden girmez
      expect((await svc.tick()).neden).toBe('Başka bir tur çalışıyor');
      return { status: 200, text: async () => JSON.stringify({ Messages: body.Messages.map(() => ({ Status: 'success', To: [{ MessageID: 12345678901234567890 }] })) }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    await svc.setAcik(true);
    p.hedefler[1].durum = 'HARIC';
    birinciTur = svc.tick();
    const r = await birinciTur;
    expect(r.gonderildi).toBe(1);
    expect(p.hedefler[1].durum).toBe('HARIC');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sahiplenme isareti sonOlay sutununa sigar (VarChar 64)', async () => {
    const p = sahtePrisma([hedef(1)]);
    let gorulen = '';
    vi.stubGlobal('fetch', vi.fn(async () => {
      gorulen = p.hedefler[0].sonOlay;
      return { status: 200, text: async () => '{"Messages":[{"Status":"success","To":[{"MessageID":1}]}]}' };
    }));
    const svc = new EpostaKampanyaService(p as any);
    await svc.setAcik(true);
    await svc.tick();
    expect(gorulen).toMatch(/^gonderiliyor:/);
    expect(gorulen.length).toBeLessThanOrEqual(64);
  });

  it('64-bit MessageID hassasiyetini kaybetmez', async () => {
    const p = sahtePrisma([hedef(1)]);
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200, text: async () => '{"Messages":[{"Status":"success","To":[{"MessageID":1152921510123456789}]}]}' })));
    const svc = new EpostaKampanyaService(p as any);
    await svc.setAcik(true);
    await svc.tick();
    expect(p.hedefler[0].messageId).toBe('1152921510123456789');
  });
});
