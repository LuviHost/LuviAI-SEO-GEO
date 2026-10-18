/**
 * F20 — e-posta takibi kullanıcının gerçek onayını gönderir; sabit consent:true yok.
 * Çalıştırma: cd mobile && ../apps/api/node_modules/.bin/vitest run --root . src
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SUBSCRIBE_CONSENT_REQUIRED, subscribeCitation, subscribeErrorMessage } from './api';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

const BASE = { email: 'kisi@ornek.com', domain: 'ornek.com', brand: 'Ornek', niche: 'muhasebe', locale: 'tr' };

describe('subscribeCitation', () => {
  it('onay verilmediyse istek hiç gönderilmez', async () => {
    const fn = mockFetch(200, { ok: true, status: 'PENDING', alreadyActive: false });
    await expect(subscribeCitation({ ...BASE, consent: false })).rejects.toThrow(SUBSCRIBE_CONSENT_REQUIRED);
    expect(fn).not.toHaveBeenCalled();
  });

  it('onayın gerçek değerini ve yalnız sunucunun bildiği alanları gönderir', async () => {
    const fn = mockFetch(200, { ok: true, status: 'PENDING', alreadyActive: false });
    const r = await subscribeCitation({ ...BASE, consent: true });
    expect(r.status).toBe('PENDING');
    expect(fn).toHaveBeenCalledTimes(1);
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.ranksup.ai/api/public/citation-check/subscribe');
    const sent = JSON.parse(String(init.body));
    expect(sent).toMatchObject({ email: BASE.email, domain: BASE.domain, brand: BASE.brand, locale: 'tr', consent: true });
    // forbidNonWhitelisted DTO'ya geçilirse fazla alan 400 alır — yalnız SubscribeBody alanları
    const allowed = ['brand', 'consent', 'customNiche', 'domain', 'email', 'locale', 'niche'];
    expect(Object.keys(sent).filter((k) => !allowed.includes(k))).toEqual([]);
  });

  it('sunucu hatasını anlaşılır metne çevirir', async () => {
    mockFetch(400, { message: 'Gecerli bir email girin' });
    await expect(subscribeCitation({ ...BASE, consent: true })).rejects.toThrow('Gecerli bir email girin');
    mockFetch(429, { message: 'ThrottlerException: Too Many Requests' });
    await expect(subscribeCitation({ ...BASE, consent: true })).rejects.toThrow('Kısa sürede çok fazla deneme yapıldı');
  });

  it('ağ hatasında bağlantı mesajı verir', async () => {
    globalThis.fetch = vi.fn(async () => { throw new TypeError('Network request failed'); }) as unknown as typeof fetch;
    await expect(subscribeCitation({ ...BASE, consent: true })).rejects.toThrow('Bağlantı kurulamadı');
  });
});

describe('subscribeErrorMessage', () => {
  it('403 doğrulama hatası açıkça söylenir', () => {
    expect(subscribeErrorMessage(403, '')).toBe('Takip isteği doğrulanamadı. Biraz sonra tekrar dene.');
    expect(subscribeErrorMessage(403, 'Insan dogrulamasi basarisiz')).toBe('Takip isteği doğrulanamadı: Insan dogrulamasi basarisiz');
  });

  it('diğer durumlarda sunucu metni, yoksa durum kodu', () => {
    expect(subscribeErrorMessage(400, 'Gecersiz domain')).toBe('Gecersiz domain');
    expect(subscribeErrorMessage(500, '')).toBe('Abonelik başarısız (500).');
  });
});
