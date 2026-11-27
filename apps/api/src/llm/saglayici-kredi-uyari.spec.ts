import { describe, expect, it, vi } from 'vitest';
import { satirDurumu, uyariGerekli, uyariMetni, UYARI_KV } from './saglayici-kredi.js';
import { SaglayiciKrediCron } from './saglayici-kredi.cron.js';
import { _basariSeyreltmeSifirla, durumOku, krediDurumu, saglayiciKontrolKaydet, SAGLAYICI_DURUM_KV } from '../audit/saglayici-durum.js';

const t0 = new Date('2026-11-27T15:00:00Z');
const saat = (h: number) => new Date(t0.getTime() + h * 3_600_000);

describe('kredi uyarisi kurallari', () => {
  it('ilk sorunda uyar; ayni durumda 24 saatte bir; kotulesince hemen; duzelmede uyarma', () => {
    expect(uyariGerekli('CALISIYOR', null, t0)).toBe(false);
    expect(uyariGerekli('HATA', null, t0)).toBe(false);
    expect(uyariGerekli('KREDI_BITTI', null, t0)).toBe(true);
    expect(uyariGerekli('AZALDI', null, t0)).toBe(true);
    const bitti = { durum: 'KREDI_BITTI' as const, at: t0.toISOString() };
    expect(uyariGerekli('KREDI_BITTI', bitti, saat(5))).toBe(false);
    expect(uyariGerekli('KREDI_BITTI', bitti, saat(24))).toBe(true);
    const azaldi = { durum: 'AZALDI' as const, at: t0.toISOString() };
    expect(uyariGerekli('KREDI_BITTI', azaldi, saat(1))).toBe(true);
    // Bitti → Azaldi (kismi yukleme) iyilesmedir: yeni uyari yok, 24 saat kurali surer
    expect(uyariGerekli('AZALDI', bitti, saat(1))).toBe(false);
  });

  it('metin: saglayici, etki ve yukleme linki', () => {
    const m = uyariMetni({ ad: 'Google Gemini', kullanim: 'Gemini ölçümü', durum: 'KREDI_BITTI', yukleUrl: 'https://ai.studio/projects', bakiye: null });
    expect(m.title).toBe('Google Gemini kredisi bitti');
    expect(m.body).toContain('gemini ölçümü çalışmıyor');
    expect(m.body).toContain('https://ai.studio/projects');
    const d = uyariMetni({ ad: 'DataForSEO', kullanim: 'Google AI Modu ve AI Bakışı ölçümü', durum: 'AZALDI', yukleUrl: 'https://app.dataforseo.com/', bakiye: { tutar: 0.194, paraBirimi: 'USD' } });
    expect(d.title).toBe('DataForSEO bakiyesi azaldı: 0,19 USD');
  });

  it('elle kontrol: kredi disi hata "Bağlantı hatası", sonraki basari temizler', async () => {
    _basariSeyreltmeSifirla();
    const depo = new Map<string, string>();
    const prisma = {
      kvStore: {
        findUnique: vi.fn(async ({ where }: any) => (depo.has(where.key) ? { value: depo.get(where.key)! } : null)),
        upsert: vi.fn(async ({ where, create }: any) => { depo.set(where.key, create.value); }),
      },
    };
    await saglayiciKontrolKaydet(prisma, 'meta', { tur: 'ok' }, t0);
    await saglayiciKontrolKaydet(prisma, 'meta', { tur: 'hata', mesaj: 'HTTP 401: invalid key' }, saat(1));
    let k = durumOku(depo.get(SAGLAYICI_DURUM_KV + 'meta'));
    expect(k.sonKontrolHatasi).toBe('HTTP 401: invalid key');
    expect(satirDurumu({ anahtarVar: true, kayit: krediDurumu(k), bakiyeUsd: null, kontrolHatasiGuncel: true })).toBe('HATA');
    await saglayiciKontrolKaydet(prisma, 'meta', { tur: 'kredi', mesaj: 'HTTP 402' }, saat(2));
    expect(krediDurumu(durumOku(depo.get(SAGLAYICI_DURUM_KV + 'meta')))).toBe('KREDI_BITTI');
    await saglayiciKontrolKaydet(prisma, 'meta', { tur: 'ok' }, saat(3));
    k = durumOku(depo.get(SAGLAYICI_DURUM_KV + 'meta'));
    expect(krediDurumu(k)).toBe('CALISIYOR');
    expect(k.sonKontrolHatasi).toBeNull();
  });
});

describe('SaglayiciKrediCron', () => {
  function kur(satirlar: any[], kv: Record<string, string> = {}) {
    const depo = new Map(Object.entries(kv));
    const prisma: any = {
      kvStore: {
        create: vi.fn(async () => ({})), // saatlik kilit
        findUnique: vi.fn(async ({ where }: any) => (depo.has(where.key) ? { key: where.key, value: depo.get(where.key) } : null)),
        upsert: vi.fn(async ({ where, create }: any) => { depo.set(where.key, create.value); }),
        delete: vi.fn(async ({ where }: any) => { depo.delete(where.key); }),
      },
      user: { findFirst: vi.fn(async () => ({ id: 'kurucu' })) },
    };
    const kredi: any = { tablo: vi.fn(async () => ({ satirlar, at: t0.toISOString() })) };
    const notifications: any = { create: vi.fn(async () => ({})) };
    return { depo, prisma, notifications, cron: new SaglayiciKrediCron(prisma, kredi, notifications) };
  }
  const satir = (id: string, durum: string, bakiye: any = null) => ({ id, ad: id, kullanim: `${id} ölçümü`, yukleUrl: `https://${id}.example/billing`, durum, anahtarVar: true, bakiye, sonBasari: null, sonKrediHatasi: null });

  it('kredi biten ve azalan saglayici icin kurucuya zil + e-posta; ikinci saatte tekrar yok', async () => {
    const t = kur([satir('gemini', 'KREDI_BITTI'), satir('dataforseo', 'AZALDI', { tutar: 0.19, paraBirimi: 'USD' }), satir('deepseek', 'CALISIYOR')]);
    await t.cron.run(t0);
    expect(t.notifications.create).toHaveBeenCalledTimes(2);
    const ilk = t.notifications.create.mock.calls[0][0];
    expect(ilk).toMatchObject({ userId: 'kurucu', type: 'SYSTEM', link: '/admin/spend', channels: ['inapp', 'email'], refKind: 'saglayici_kredi', refId: 'gemini' });
    expect(t.depo.has(UYARI_KV + 'gemini')).toBe(true);
    await t.cron.run(saat(1));
    expect(t.notifications.create).toHaveBeenCalledTimes(2);
  });

  it('duzelen saglayicinin uyari kaydi silinir', async () => {
    const t = kur([satir('gemini', 'CALISIYOR')], { [UYARI_KV + 'gemini']: JSON.stringify({ durum: 'KREDI_BITTI', at: t0.toISOString() }) });
    await t.cron.run(saat(2));
    expect(t.notifications.create).not.toHaveBeenCalled();
    expect(t.depo.has(UYARI_KV + 'gemini')).toBe(false);
  });

  it('kilidi alamayan proses calismaz', async () => {
    const t = kur([satir('gemini', 'KREDI_BITTI')]);
    t.prisma.kvStore.create.mockRejectedValueOnce(new Error('unique'));
    await t.cron.run(t0);
    expect(t.notifications.create).not.toHaveBeenCalled();
  });
});
