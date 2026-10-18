import { describe, it, expect, vi } from 'vitest';
import { clientIp, isInternalHop, normalizeIp } from './client-ip.js';
import { ProxyThrottlerGuard } from './proxy-throttler.guard.js';
import { BillingController } from '../billing/billing.controller.js';
import { SettingsController } from '../settings/settings.controller.js';

/**
 * Istemci IP'si — tek kural (rate limit, Turnstile remoteip, PayTR user_ip, denetim kaydi).
 *
 * NEDEN VAR: uclar X-Forwarded-For'un ILK adresini aliyordu. O adres istemcinin
 * kendi yazdigi basliktan gelir (Cloudflare var olan basligi silmez, sona ekler:
 * https://developers.cloudflare.com/fundamentals/reference/http-headers/);
 * her istekte baska bir deger yazilip IP limitleri sifirlanabiliyordu.
 */

const istek = (headers: Record<string, unknown>, remoteAddress: string | null = '127.0.0.1') => ({ headers, socket: { remoteAddress } });

describe('clientIp', () => {
  it('CF-Connecting-IP varsa o (Cloudflare edge yazar)', () => {
    expect(clientIp(istek({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '6.6.6.6, 198.51.100.1' }))).toBe('203.0.113.7');
    expect(clientIp(istek({ 'cf-connecting-ip': ' 2001:4860:4860::8888 ' }))).toBe('2001:4860:4860::8888');
  });

  it('XFF: soldaki istemci yazimi yok sayilir, nginx\'in SONA ekledigi adres alinir', () => {
    // istemci "1.1.1.1" yazdi; Cloudflare'siz dogrudan origin: nginx gercek TCP esini ekledi
    expect(clientIp(istek({ 'x-forwarded-for': '1.1.1.1, 198.51.100.20' }))).toBe('198.51.100.20');
    expect(clientIp(istek({ 'x-forwarded-for': '198.51.100.20' }))).toBe('198.51.100.20');
  });

  it('XFF: sagdaki bizim proxy adimlarimiz (Next.js → API loopback, ozel ag) atlanir', () => {
    expect(clientIp(istek({ 'x-forwarded-for': '1.1.1.1, 198.51.100.20, 127.0.0.1' }))).toBe('198.51.100.20');
    expect(clientIp(istek({ 'x-forwarded-for': '198.51.100.20, 10.0.0.3, ::1' }))).toBe('198.51.100.20');
    // istemcinin sona ozel adres yazmasi bir sey degistirmez: nginx kendi adresini yine en sona ekler
    expect(clientIp(istek({ 'x-forwarded-for': '1.1.1.1, 10.0.0.1, 198.51.100.20' }))).toBe('198.51.100.20');
  });

  it('gecersiz ya da cok degerli CF-Connecting-IP yok sayilir → XFF kuyrugu', () => {
    expect(clientIp(istek({ 'cf-connecting-ip': '1.1.1.1, 2.2.2.2', 'x-forwarded-for': '198.51.100.20' }))).toBe('198.51.100.20');
    expect(clientIp(istek({ 'cf-connecting-ip': 'kotu-deger', 'x-forwarded-for': '198.51.100.20' }))).toBe('198.51.100.20');
    expect(clientIp(istek({ 'cf-connecting-ip': ['1.1.1.1', '2.2.2.2'], 'x-forwarded-for': '198.51.100.20' }))).toBe('198.51.100.20');
  });

  it('baslik yoksa ya da yalniz ic adresler varsa soket adresi (IPv4-esli yazim sadelesir)', () => {
    expect(clientIp(istek({}, '::ffff:198.51.100.5'))).toBe('198.51.100.5');
    expect(clientIp(istek({ 'x-forwarded-for': '127.0.0.1' }, '::1'))).toBe('::1');
    expect(clientIp({ headers: {}, socket: null, ip: '198.51.100.6' })).toBe('198.51.100.6');
    expect(clientIp(null)).toBe('');
    expect(clientIp(istek({ 'x-forwarded-for': 'cop, ' }, null))).toBe('');
  });

  it('normalizeIp ve isInternalHop', () => {
    expect(normalizeIp('198.51.100.5:4431')).toBe('198.51.100.5');
    expect(normalizeIp('[2001:db8::1]:443')).toBe('2001:db8::1');
    expect(normalizeIp('::FFFF:10.1.2.3')).toBe('10.1.2.3');
    expect(normalizeIp('999.1.1.1')).toBeNull();
    expect(normalizeIp('')).toBeNull();
    for (const ic of ['127.0.0.1', '10.2.3.4', '172.20.0.1', '192.168.1.1', '169.254.1.1', '::1', 'fd00::1', 'fe80::1']) {
      expect(isInternalHop(ic)).toBe(true);
    }
    for (const dis of ['198.51.100.20', '8.8.8.8', '2001:4860:4860::8888']) expect(isInternalHop(dis)).toBe(false);
  });
});

describe('ProxyThrottlerGuard — bucket anahtari ortak kuraldan', () => {
  const tracker = (req: Record<string, unknown>) => (ProxyThrottlerGuard.prototype as any).getTracker.call({}, req) as Promise<string>;

  it('XFF\'in soluna yazilan IP bucket secmez', async () => {
    await expect(tracker(istek({ 'x-forwarded-for': 'rastgele-1.2.3.4, 198.51.100.20' }))).resolves.toBe('198.51.100.20');
    await expect(tracker(istek({ 'x-forwarded-for': '9.9.9.9, 198.51.100.20' }))).resolves.toBe('198.51.100.20');
    await expect(tracker(istek({ 'cf-connecting-ip': '203.0.113.7' }))).resolves.toBe('203.0.113.7');
    await expect(tracker({ headers: {} })).resolves.toBe('unknown');
  });
});

describe('PayTR user_ip ve ayar denetim kaydi ayni kurali kullanir', () => {
  it('billing subscribe: user_ip CF-Connecting-IP (XFF\'in ilk adresi degil)', async () => {
    const paytr = { createPaymentToken: vi.fn(async () => ({ token: 't' })) };
    const ctrl = new BillingController({} as never, paytr as never, {} as never, {} as never);
    const req = { user: { id: 'u1' }, headers: { 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '6.6.6.6, 198.51.100.1' }, socket: { remoteAddress: '127.0.0.1' } };
    await ctrl.subscribe(req as never, { userId: 'u1', planId: 'pro', cycle: 'monthly', userEmail: 'a@b.co', userName: 'A' });
    expect(paytr.createPaymentToken).toHaveBeenCalledWith(expect.objectContaining({ userIp: '203.0.113.7' }));

    const req2 = { user: { id: 'u1' }, headers: {}, socket: { remoteAddress: null } };
    await ctrl.subscribe(req2 as never, { userId: 'u1', planId: 'pro', cycle: 'monthly', userEmail: 'a@b.co', userName: 'A' });
    expect(paytr.createPaymentToken).toHaveBeenLastCalledWith(expect.objectContaining({ userIp: '127.0.0.1' }));
  });

  it('admin ayar degisikligi: denetim kaydina nginx\'in ekledigi adres yazilir', async () => {
    const settings = { set: vi.fn(async () => ({})) };
    const ctrl = new SettingsController(settings as never);
    const req = { user: { id: 'admin-1', role: 'ADMIN' }, headers: { 'x-forwarded-for': '6.6.6.6, 198.51.100.20', 'user-agent': 'ua' }, socket: { remoteAddress: '127.0.0.1' } };
    await ctrl.update(req as never, 'ARTICLE_GENERATION_DISABLED', { value: true });
    expect(settings.set).toHaveBeenCalledWith('ARTICLE_GENERATION_DISABLED', 'true', 'admin-1', { ipAddress: '198.51.100.20', userAgent: 'ua' });
  });
});
