import { describe, it, expect } from 'vitest';
import { probeUrl, describeProbe, isUnmeasured, createLimiter } from './axo-fetch.js';
import { SafeFetchError, type SafeTextResult } from '../common/safe-fetch.js';

const res = (status: number, text = '', headers: Record<string, string> = {}, contentType = 'text/plain'): SafeTextResult => ({
  status, ok: status >= 200 && status < 300, url: 'https://x.com/robots.txt', redirected: false, contentType, headers, text, truncated: false, binary: false,
});
const fetchReturning = (r: SafeTextResult) => async () => r;

describe('probeUrl — engel eksik degildir', () => {
  it('Cloudflare 403 engel sayfasi → blocked + izin ipucu', async () => {
    const p = await probeUrl('https://x.com/robots.txt', {}, fetchReturning(res(403, '<title>Attention Required! | Cloudflare</title>Sorry, you have been blocked', { server: 'cloudflare', 'cf-ray': 'abc' })));
    expect(p.state).toBe('blocked');
    expect(p.block?.kind).toBe('waf');
    expect(p.block?.hint).toMatch(/RanksUpBot/);
    expect(isUnmeasured(p)).toBe(true);
    expect(describeProbe(p)).toBe('403 (erişim engellendi, cloudflare)');
  });

  it('429 ve 503 de olculemedi sayilir', async () => {
    expect((await probeUrl('u', {}, fetchReturning(res(429)))).state).toBe('blocked');
    expect((await probeUrl('u', {}, fetchReturning(res(503)))).state).toBe('blocked');
  });

  it('200 ama challenge sayfasi → blocked', async () => {
    const p = await probeUrl('u', {}, fetchReturning(res(200, '<html><head><title>Just a moment...</title></head></html>', { 'cf-mitigated': 'challenge' }, 'text/html')));
    expect(p.state).toBe('blocked');
    expect(p.block?.kind).toBe('challenge');
  });

  it('404/410 missing, 500 http_error, 200 ok', async () => {
    expect((await probeUrl('u', {}, fetchReturning(res(404)))).state).toBe('missing');
    expect((await probeUrl('u', {}, fetchReturning(res(410)))).state).toBe('missing');
    expect((await probeUrl('u', {}, fetchReturning(res(500)))).state).toBe('http_error');
    const ok = await probeUrl('u', {}, fetchReturning(res(200, 'User-agent: *')));
    expect(ok.state).toBe('ok');
    expect(ok.text).toBe('User-agent: *');
    expect(isUnmeasured(ok)).toBe(false);
  });

  it('SafeFetchError → unreachable (zaman asimi / ic adres)', async () => {
    const t = await probeUrl('u', {}, async () => { throw new SafeFetchError('timeout', 'x'); });
    expect(t).toMatchObject({ state: 'unreachable', status: 0 });
    expect(t.block?.reason).toMatch(/zaman aşımı/);
    const b = await probeUrl('u', {}, async () => { throw new SafeFetchError('blocked_address', 'x'); });
    expect(b.block?.kind).toBe('blocked_address');
    expect(describeProbe(b)).toBe('erişilemedi (blocked_address)');
  });

  it('varsayilan zaman asimi ve tavan; cagiranin secenekleri ustun', async () => {
    let seen: any;
    await probeUrl('u', { accept: 'application/json', timeoutMs: 3000 }, async (_u, o) => { seen = o; return res(200); });
    expect(seen).toMatchObject({ accept: 'application/json', timeoutMs: 3000, maxBytes: 512 * 1024 });
  });

  it('skipBinary:false safeFetchText\'e iletilir (kok dosyalar Content-Type\'tan bagimsiz okunur); tavan 512 KB kalir', async () => {
    let seen: any;
    const p = await probeUrl('https://x.com/robots.txt', { skipBinary: false }, async (_u, o) => {
      seen = o;
      return res(200, 'User-agent: *\nDisallow: /admin/', {}, 'application/octet-stream');
    });
    expect(seen).toMatchObject({ skipBinary: false, maxBytes: 512 * 1024 });
    expect(p).toMatchObject({ state: 'ok', binary: false, text: 'User-agent: *\nDisallow: /admin/' });
  });

  it('cozulemeyen Content-Encoding → olculemedi, "baglanti kurulamadi" denmez', async () => {
    const p = await probeUrl('u', {}, async () => { throw new SafeFetchError('content_encoding', 'x'); });
    expect(p.state).toBe('unreachable');
    expect(p.block?.reason).toMatch(/çözülemedi/);
  });
});

describe('createLimiter', () => {
  it('ayni anda en fazla n gorev calisir, hepsi tamamlanir', async () => {
    const limit = createLimiter(2);
    let active = 0;
    let peak = 0;
    const task = (v: number) => limit(async () => {
      active++; peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return v;
    });
    const out = await Promise.all([1, 2, 3, 4, 5].map(task));
    expect(out).toEqual([1, 2, 3, 4, 5]);
    expect(peak).toBe(2);
  });

  it('hata veren gorev kuyrugu kilitlemez', async () => {
    const limit = createLimiter(1);
    await expect(limit(async () => { throw new Error('x'); })).rejects.toThrow('x');
    await expect(limit(async () => 7)).resolves.toBe(7);
  });
});
