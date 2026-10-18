import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SafeTextResult } from '../common/safe-fetch.js';

const fetchMock = vi.fn();
vi.mock('../common/safe-fetch.js', async (orig) => {
  const real: any = await orig();
  return { ...real, safeFetchText: (...a: any[]) => fetchMock(...a) };
});

const { IntelCollectorService, isRetryableFetchError, retryDelayMs, cutToLastCompleteItem } = await import('./collector.service.js');
const { SafeFetchError } = await import('../common/safe-fetch.js');

const res = (r: { status: number; text?: string; headers?: Record<string, string>; truncated?: boolean }): SafeTextResult => ({
  status: r.status, ok: r.status >= 200 && r.status < 300, url: 'https://feed.example/rss', redirected: false,
  contentType: 'application/rss+xml', headers: r.headers ?? {}, text: r.text ?? '', truncated: r.truncated ?? false, binary: false,
});

const svc = () => new IntelCollectorService({} as any, {} as any, {} as any, {} as any) as any;

/** Promise'i fake timer ilerlerken sonuclandir — reddi de yakalar */
function settle<T>(p: Promise<T>) {
  const out: { value?: T; error?: any; done: boolean } = { done: false };
  p.then((v) => { out.value = v; out.done = true; }, (e) => { out.error = e; out.done = true; });
  return out;
}

beforeEach(() => { fetchMock.mockReset(); });
afterEach(() => { vi.useRealTimers(); });

describe('isRetryableFetchError — hangi hata yeniden denenir', () => {
  it('gecici ag katmani: timeout / network / dns', () => {
    for (const c of ['timeout', 'network', 'dns'] as const) expect(isRetryableFetchError(new SafeFetchError(c, 'x')), c).toBe(true);
  });
  it('kalici: ic adres, protokol, port, yonlendirme dongusu — ve HTTP hatasi', () => {
    for (const c of ['blocked_address', 'protocol', 'port', 'redirect'] as const) expect(isRetryableFetchError(new SafeFetchError(c, 'x')), c).toBe(false);
    expect(isRetryableFetchError(new Error('HTTP 404 — https://x'))).toBe(false);
    expect(isRetryableFetchError('boom')).toBe(false);
  });
});

describe('retryDelayMs — 429/503 bekleme suresi', () => {
  it('retry-after (sn) + 1 sn pay', () => {
    expect(retryDelayMs({ 'retry-after': '2' })).toBe(3000);
  });
  it('Reddit: retry-after yok, x-ratelimit-reset var', () => {
    expect(retryDelayMs({ 'x-ratelimit-reset': '33' })).toBe(34_000);
  });
  it('baslik yoksa ya da sayi degilse varsayilan 4 sn', () => {
    expect(retryDelayMs({})).toBe(4000);
    expect(retryDelayMs({ 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT' })).toBe(4000);
  });
  it('45 sn tavan', () => {
    expect(retryDelayMs({ 'retry-after': '600' })).toBe(45_000);
  });
});

describe('IntelCollectorService.httpText — tek yeniden deneme', () => {
  it('429 + retry-after: bekler, bir kez daha dener', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(res({ status: 429, headers: { 'retry-after': '2' } }))
      .mockResolvedValueOnce(res({ status: 200, text: '<rss/>' }));
    const out = settle<SafeTextResult>(svc().httpText('https://feed.example/rss'));
    await vi.advanceTimersByTimeAsync(2999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(out.value?.text).toBe('<rss/>');
  });

  it('503 iki kez → HTTP 503 hatasi (ikinci deneme yok)', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(res({ status: 503 }));
    const out = settle<SafeTextResult>(svc().httpText('https://feed.example/rss'));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(out.error?.message).toMatch(/^HTTP 503/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('zaman asimi → 4 sn sonra tekrar dener', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockRejectedValueOnce(new SafeFetchError('timeout', 'Zaman asimi'))
      .mockResolvedValueOnce(res({ status: 200, text: 'ok' }));
    const out = settle<SafeTextResult>(svc().httpText('https://feed.example/rss'));
    await vi.advanceTimersByTimeAsync(4000);
    expect(out.value?.text).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('ic/ozel adres ve yonlendirme dongusu yeniden DENENMEZ', async () => {
    for (const code of ['blocked_address', 'redirect', 'protocol', 'port'] as const) {
      fetchMock.mockReset();
      fetchMock.mockRejectedValue(new SafeFetchError(code, 'x'));
      await expect(svc().httpText('https://feed.example/rss')).rejects.toMatchObject({ code });
      expect(fetchMock, code).toHaveBeenCalledTimes(1);
    }
  });

  it('404 kalicidir — tek istek, HTTP hatasi', async () => {
    fetchMock.mockResolvedValue(res({ status: 404 }));
    await expect(svc().httpText('https://feed.example/rss')).rejects.toThrow(/^HTTP 404/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('feed istegi: tavanli, durust bot kimligi (UA ezilmez), feed accept basligi', async () => {
    fetchMock.mockResolvedValue(res({ status: 200, text: '<rss/>' }));
    await svc().httpText('https://feed.example/rss');
    const opts = fetchMock.mock.calls[0][1];
    expect(opts).toMatchObject({ maxBytes: 5 * 1024 * 1024, timeoutMs: 20_000, skipBinary: false });
    expect(opts.accept).toContain('application/rss+xml');
    expect(opts.userAgent).toBeUndefined();
  });
});

describe('kesik feed — yarim kalan son kayit yazilmaz', () => {
  const FULL = '<rss><channel>'
    + '<item><title>Bir</title><link>https://a.com/1</link></item>'
    + '<item><title>Iki</title><link>https://a.com/2</link></item>';
  const CUT = FULL + '<item><title>Uc</title><link>https://a.co';

  it('cutToLastCompleteItem: RSS ve Atom', () => {
    expect(cutToLastCompleteItem(CUT)).toBe(FULL);
    expect(cutToLastCompleteItem('<feed><entry><title>A</title></entry><entry><title>B')).toBe('<feed><entry><title>A</title></entry>');
    expect(cutToLastCompleteItem('<rss><channel><item><title>yarim')).toBe('');
  });

  it('fetchFeed kesik govdede yalniz tam kayitlari dondurur', async () => {
    fetchMock.mockResolvedValue(res({ status: 200, text: CUT, truncated: true }));
    const items = await svc().fetchFeed('https://feed.example/rss');
    expect(items.map((i: any) => i.url)).toEqual(['https://a.com/1', 'https://a.com/2']);
  });
});
