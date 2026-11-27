import { describe, expect, it, vi } from 'vitest';
import { dataforseoBakiye, deepseekBakiye, KREDI_SAGLAYICILARI, satirDurumu } from './saglayici-kredi.js';
import {
  _basariSeyreltmeSifirla, krediDurumu, saglayiciBasariKaydet, saglayiciKrediHatasiKaydet, SAGLAYICI_DURUM_KV,
} from '../audit/saglayici-durum.js';
import { POOL_ENV_KEY } from '../audit/citation-providers.js';

describe('saglayici kredi durumu', () => {
  it('kredi hatasi son basaridan yeniyse "bitti", eskiyse "calisiyor"', () => {
    expect(krediDurumu({})).toBe('BILINMIYOR');
    expect(krediDurumu({ sonBasari: '2026-11-27T10:00:00Z' })).toBe('CALISIYOR');
    expect(krediDurumu({ sonKrediHatasi: '2026-11-25T10:00:00Z' })).toBe('KREDI_BITTI');
    expect(krediDurumu({ sonBasari: '2026-11-24T10:00:00Z', sonKrediHatasi: '2026-11-25T10:00:00Z' })).toBe('KREDI_BITTI');
    // Yukleme sonrasi ilk basari "bitti"yi kaldirir
    expect(krediDurumu({ sonBasari: '2026-11-26T10:00:00Z', sonKrediHatasi: '2026-11-25T10:00:00Z' })).toBe('CALISIYOR');
  });

  it('satir: anahtar yok > bakiye 0 / kullanilamaz > kredi hatasi > dusuk bakiye', () => {
    expect(satirDurumu({ anahtarVar: false, kayit: 'KREDI_BITTI', bakiyeUsd: 0 })).toBe('ANAHTAR_YOK');
    expect(satirDurumu({ anahtarVar: true, kayit: 'CALISIYOR', bakiyeUsd: 0 })).toBe('KREDI_BITTI');
    expect(satirDurumu({ anahtarVar: true, kayit: 'CALISIYOR', bakiyeUsd: 9, bakiyeKullanilabilir: false })).toBe('KREDI_BITTI');
    expect(satirDurumu({ anahtarVar: true, kayit: 'KREDI_BITTI', bakiyeUsd: null })).toBe('KREDI_BITTI');
    expect(satirDurumu({ anahtarVar: true, kayit: 'CALISIYOR', bakiyeUsd: 0.19 })).toBe('AZALDI');
    // Bakiye bilinen saglayicida eski kredi hatasi degil anlik bakiye gecerli
    expect(satirDurumu({ anahtarVar: true, kayit: 'KREDI_BITTI', bakiyeUsd: 9.04 })).toBe('CALISIYOR');
    expect(satirDurumu({ anahtarVar: true, kayit: 'BILINMIYOR', bakiyeUsd: null })).toBe('BILINMIYOR');
  });

  it('DeepSeek ve DataForSEO bakiye cevaplari (27.11 canli cevap bicimi)', () => {
    expect(deepseekBakiye({ is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '5.00' }, { currency: 'USD', total_balance: '9.04' }] }))
      .toEqual({ bakiye: 9.04, paraBirimi: 'USD', kullanilabilir: true });
    expect(deepseekBakiye({})).toEqual({ bakiye: null, paraBirimi: null, kullanilabilir: null });
    expect(dataforseoBakiye({ tasks: [{ result: [{ money: { total: 1, balance: 0.19399999999999995 } }] }] })).toBeCloseTo(0.194);
    expect(dataforseoBakiye({ tasks: [] })).toBeNull();
  });

  it('env adlari olcum havuzuyla ayni; yukleme linkleri https', () => {
    const t = Object.fromEntries(KREDI_SAGLAYICILARI.map((s) => [s.id, s]));
    for (const p of ['anthropic', 'openai', 'gemini', 'perplexity', 'xai', 'deepseek', 'meta'] as const) {
      expect(t[p].envAnahtari).toBe(POOL_ENV_KEY[p]);
    }
    expect(t.dataforseo.envAnahtari).toBe(POOL_ENV_KEY.google_ai_mode);
    for (const s of KREDI_SAGLAYICILARI) expect(s.yukleUrl).toMatch(/^https:\/\//);
  });

  it('basari kaydi seyreltilir; kredi hatasi hemen yazilir ve sonraki basariyi acar', async () => {
    _basariSeyreltmeSifirla();
    const depo = new Map<string, string>();
    const prisma = {
      kvStore: {
        findUnique: vi.fn(async ({ where }: any) => (depo.has(where.key) ? { value: depo.get(where.key)! } : null)),
        upsert: vi.fn(async ({ where, create }: any) => { depo.set(where.key, create.value); }),
      },
    };
    const t0 = new Date('2026-11-27T10:00:00Z');
    await saglayiciBasariKaydet(prisma, 'gemini', t0);
    await saglayiciBasariKaydet(prisma, 'gemini', new Date(t0.getTime() + 60_000)); // 1 dk sonra: yazilmaz
    expect(prisma.kvStore.upsert).toHaveBeenCalledTimes(1);
    await saglayiciKrediHatasiKaydet(prisma, 'gemini', 'HATA: billing', new Date(t0.getTime() + 120_000));
    expect(krediDurumu(JSON.parse(depo.get(SAGLAYICI_DURUM_KV + 'gemini')!))).toBe('KREDI_BITTI');
    await saglayiciBasariKaydet(prisma, 'gemini', new Date(t0.getTime() + 180_000)); // yukleme sonrasi: hemen yazilir
    expect(krediDurumu(JSON.parse(depo.get(SAGLAYICI_DURUM_KV + 'gemini')!))).toBe('CALISIYOR');
  });

  it('veritabani hatasi olcumu bozmaz', async () => {
    _basariSeyreltmeSifirla();
    await expect(saglayiciBasariKaydet({} as any, 'openai')).resolves.toBeUndefined();
    await expect(saglayiciKrediHatasiKaydet({} as any, 'openai', 'x')).resolves.toBeUndefined();
  });
});
