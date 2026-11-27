import { describe, expect, it, vi } from 'vitest';
import { BAKIYE_KV, BAKIYE_TURU, bakiyeGirisiOku, satirDurumu, tahminiBakiye, tahminiBorc, FATURA_ESIGI, uyariMetni } from './saglayici-kredi.js';
import { SaglayiciKrediService } from './saglayici-kredi.service.js';

describe('tahmini bakiye kurallari', () => {
  it('USD: giris − harcama; TRY: harcama kurla cevrilir', () => {
    const usd = { tutar: 120.7, paraBirimi: 'USD' as const, girisAt: '2026-11-27T16:00:00Z', olcumToplamAnlikUsd: 3, otomatikYukleme: false };
    expect(tahminiBakiye(usd, 20.25, 42)).toEqual({ tutar: 100.45, usd: 100.45 });
    const tl = { tutar: 943.98, paraBirimi: 'TRY' as const, girisAt: '2026-11-27T16:00:00Z', olcumToplamAnlikUsd: 0, otomatikYukleme: false };
    // 2 USD x 42 = 84 TL
    expect(tahminiBakiye(tl, 2, 42)).toEqual({ tutar: 859.98, usd: 20.48 });
    // Kur yoksa TL tahmini dusulemez: giris aynen, USD bilinmez
    expect(tahminiBakiye(tl, 2, null)).toEqual({ tutar: 943.98, usd: null });
  });

  it('giris okuma bozuk veriyi reddeder', () => {
    expect(bakiyeGirisiOku(JSON.stringify({ tutar: 10, paraBirimi: 'USD', girisAt: 'x', olcumToplamAnlikUsd: 1 }))).toMatchObject({ tutar: 10 });
    expect(bakiyeGirisiOku(JSON.stringify({ tutar: 10, paraBirimi: 'EUR', girisAt: 'x' }))).toBeNull();
    expect(bakiyeGirisiOku('bozuk')).toBeNull();
  });

  it('tahmin yalniz "Azaldı" uretir; gercek 402 "Kredi bitti"yi ezmez', () => {
    expect(satirDurumu({ anahtarVar: true, kayit: 'CALISIYOR', bakiyeUsd: null, tahminiUsd: 3 })).toBe('AZALDI');
    expect(satirDurumu({ anahtarVar: true, kayit: 'CALISIYOR', bakiyeUsd: null, tahminiUsd: -2 })).toBe('AZALDI');
    expect(satirDurumu({ anahtarVar: true, kayit: 'CALISIYOR', bakiyeUsd: null, tahminiUsd: 80 })).toBe('CALISIYOR');
    expect(satirDurumu({ anahtarVar: true, kayit: 'KREDI_BITTI', bakiyeUsd: null, tahminiUsd: 80 })).toBe('KREDI_BITTI');
  });

  it('bakiye turleri: Meta kartla, DeepSeek ve DataForSEO API, digerleri manuel', () => {
    expect(BAKIYE_TURU.meta).toBe('fatura');
    expect(BAKIYE_TURU.deepseek).toBe('api');
    expect(BAKIYE_TURU.dataforseo).toBe('api');
    for (const id of ['anthropic', 'openai', 'gemini', 'perplexity', 'xai'] as const) expect(BAKIYE_TURU[id]).toBe('manuel');
  });

  it('uyari metni tahmini tutari "tahmini" diye yazar', () => {
    const m = uyariMetni({ ad: 'xAI (Grok)', kullanim: 'Grok ölçümü', durum: 'AZALDI', yukleUrl: 'u', bakiye: null, tahmin: { tutar: 4.2, paraBirimi: 'USD' } });
    expect(m.title).toBe('xAI (Grok) bakiyesi azaldı: tahmini 4,20 USD');
  });
});

describe('SaglayiciKrediService bakiye girisi', () => {
  function kur() {
    const depo = new Map<string, string>([['ai-gercek-toplam:gemini', '1.5']]);
    const prisma: any = {
      kvStore: {
        findMany: vi.fn(async ({ where }: any) => {
          const out: any[] = [];
          for (const [key, value] of depo) {
            if (where.key.startsWith && key.startsWith(where.key.startsWith)) out.push({ key, value });
            if (where.key.in && where.key.in.includes(key)) out.push({ key, value });
          }
          return out;
        }),
        upsert: vi.fn(async ({ where, create }: any) => { depo.set(where.key, create.value); }),
        delete: vi.fn(async ({ where }: any) => { depo.delete(where.key); }),
        findUnique: vi.fn(async ({ where }: any) => (depo.has(where.key) ? { key: where.key, value: depo.get(where.key) } : null)),
      },
      tokenUsageRecord: { aggregate: vi.fn(async () => ({ _sum: { costUsd: 0 } })) },
    };
    const fx: any = { getUsdToTryRate: vi.fn(async () => 42) };
    return { depo, svc: new SaglayiciKrediService(prisma, fx) };
  }

  it('giris anindaki olcum toplami saklanir; sonraki olcum harcamasi tahminden dusulur', async () => {
    const t = kur();
    await t.svc.bakiyeGir('gemini', '943,98', 'TRY');
    const g = JSON.parse(t.depo.get(BAKIYE_KV + 'gemini')!);
    expect(g).toMatchObject({ tutar: 943.98, paraBirimi: 'TRY', olcumToplamAnlikUsd: 1.5 });
    t.depo.set('ai-gercek-toplam:gemini', '3.5'); // girişten sonra 2 USD olcum
    const { satirlar } = await t.svc.tablo();
    const gem = satirlar.find((s) => s.id === 'gemini')!;
    expect(gem.tahmin).toMatchObject({ tutar: 859.98, paraBirimi: 'TRY', kullanilanUsd: 2 });
    expect(gem.bakiyeTuru).toBe('manuel');
  });

  it('Meta (fatura): girilen odenecek tutara olcum harcamasi EKLENIR; "Azaldı" uretmez', async () => {
    const t = kur();
    const eski = process.env.META_MODEL_API_KEY;
    process.env.META_MODEL_API_KEY = 'test';
    try {
      await t.svc.bakiyeGir('meta', '483,01', 'TRY');
      t.depo.set('ai-gercek-toplam:meta', '0.5'); // girisAn 0 → 0,5 USD × 42 = 21 TL
      const m = (await t.svc.tablo()).satirlar.find((s) => s.id === 'meta')!;
      expect(m.tahmin).toMatchObject({ tutar: 504.01, paraBirimi: 'TRY', kullanilanUsd: 0.5 });
      expect(m.faturaEsigi).toEqual({ tutar: 500, paraBirimi: 'TRY' });
      expect(m.durum).not.toBe('AZALDI');
      await t.svc.bakiyeGir('meta', 0, 'TRY'); // kart cekildi
      const m2 = (await t.svc.tablo()).satirlar.find((s) => s.id === 'meta')!;
      expect(m2.tahmin).toMatchObject({ tutar: 0 });
      expect(m2.durum).not.toBe('AZALDI');
    } finally {
      if (eski === undefined) delete process.env.META_MODEL_API_KEY; else process.env.META_MODEL_API_KEY = eski;
    }
  });

  it('API saglayicisina giris reddedilir; bos tutar reddedilir; null siler', async () => {
    const t = kur();
    await expect(t.svc.bakiyeGir('deepseek', 10, 'USD')).rejects.toThrow('girilmez');
    await expect(t.svc.bakiyeGir('xai', '', 'USD')).rejects.toThrow('Tutar girin');
    await expect(t.svc.bakiyeGir('xai', 10, 'EUR')).rejects.toThrow('USD ya da TRY');
    await t.svc.bakiyeGir('xai', 11.15, 'USD');
    expect(t.depo.has(BAKIYE_KV + 'xai')).toBe(true);
    await t.svc.bakiyeGir('xai', null, undefined);
    expect(t.depo.has(BAKIYE_KV + 'xai')).toBe(false);
  });

  it('otomatik yukleme: bayrak yalniz degisir, harcama tabani korunur; tahmin "Azaldı" uretmez', async () => {
    const t = kur();
    const eskiAnahtar = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'sk-test';
    try {
    await t.svc.bakiyeGir('openai', 7.95, 'USD', true);
    expect(JSON.parse(t.depo.get(BAKIYE_KV + 'openai')!)).toMatchObject({ tutar: 7.95, otomatikYukleme: true });
    const once = JSON.parse(t.depo.get(BAKIYE_KV + 'openai')!).girisAt;
    // 7.95 USD girildi, esik 5 USD: otomatik yuklemede tahmin dusse de Azaldi yok
    t.depo.set('ai-gercek-toplam:openai', '4');
    let o = (await t.svc.tablo()).satirlar.find((s) => s.id === 'openai')!;
    expect(o.tahmin).toMatchObject({ tutar: 3.95, otomatikYukleme: true });
    expect(o.durum).not.toBe('AZALDI');
    // Yalniz bayrak: tutar ve giris ani degismez
    await t.svc.bakiyeGir('openai', undefined, undefined, false);
    const g = JSON.parse(t.depo.get(BAKIYE_KV + 'openai')!);
    expect(g).toMatchObject({ tutar: 7.95, otomatikYukleme: false, girisAt: once });
    o = (await t.svc.tablo()).satirlar.find((s) => s.id === 'openai')!;
    expect(o.durum).toBe('AZALDI');
    // Giris yokken yalniz bayrak reddedilir
    await expect(t.svc.bakiyeGir('xai', undefined, undefined, true)).rejects.toThrow('Önce bakiye');
    } finally {
      if (eskiAnahtar === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = eskiAnahtar;
    }
  });
});

describe('tahminiBorc (fatura: Meta)', () => {
  const g = { tutar: 483.01, paraBirimi: 'TRY' as const, girisAt: '2026-11-28T10:00:00Z', olcumToplamAnlikUsd: 0, otomatikYukleme: false };
  it('harcama borca EKLENIR (TL, kurla)', () => {
    expect(tahminiBorc(g, 0.5, 40)).toEqual({ tutar: 503.01, usd: 12.58 });
  });
  it('kur yoksa girilen tutar kalir', () => {
    expect(tahminiBorc(g, 1, null)).toEqual({ tutar: 483.01, usd: null });
  });
  it('Meta esigi 500 TL', () => {
    expect(FATURA_ESIGI.meta).toEqual({ tutar: 500, paraBirimi: 'TRY' });
  });
});
