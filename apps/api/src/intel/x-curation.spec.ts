import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SafeTextResult } from '../common/safe-fetch.js';

vi.mock('../prisma/prisma.service.js', () => ({ PrismaService: class {} }));
const fetchMock = vi.fn();
vi.mock('../common/safe-fetch.js', async (orig) => {
  const real: any = await orig();
  return { ...real, safeFetchText: (...a: any[]) => fetchMock(...a) };
});

const { XCurationService } = await import('./x-curation.service.js');
const { SafeFetchError, RANKSUP_BOT_UA } = await import('../common/safe-fetch.js');

const res = (r: Partial<SafeTextResult> & { status: number }): SafeTextResult => ({
  ok: r.status >= 200 && r.status < 300, url: 'https://dis.com/makale', redirected: false, contentType: 'text/html',
  headers: {}, text: '', truncated: false, binary: false, ...r,
});
const svc = () => new XCurationService({} as any) as any;

/** t.co'nun ilk adimi (sabit host) global fetch ile gider */
function tco(status: number, location?: string) {
  const f = vi.fn(async () => new Response(null, { status, headers: location ? { location } : {} }));
  vi.stubGlobal('fetch', f);
  return f;
}

beforeEach(() => { fetchMock.mockReset(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('XCurationService.fetchTitle', () => {
  it('basligi okur; tavanli (64 KB) ve hata govdesi indirilmez', async () => {
    fetchMock.mockResolvedValue(res({ status: 200, text: '<html><head><title>  Yeni   Google\nGuncellemesi </title>' }));
    expect(await svc().fetchTitle('https://dis.com/makale')).toBe('Yeni Google Guncellemesi');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ maxBytes: 64 * 1024, errorBodyBytes: 0 });
    expect(fetchMock.mock.calls[0][1].userAgent).toBeUndefined();
  });
  it('bot dogrulama ekraninin basligi ("Just a moment...") makale basligi sayilmaz', async () => {
    fetchMock.mockResolvedValue(res({ status: 200, text: '<html><head><title>Just a moment...</title></head></html>' }));
    expect(await svc().fetchTitle('https://dis.com/makale')).toBeNull();
  });
  it('403 / ic adres → null', async () => {
    fetchMock.mockResolvedValue(res({ status: 403, text: '<title>Forbidden</title>' }));
    expect(await svc().fetchTitle('https://dis.com/makale')).toBeNull();
    fetchMock.mockRejectedValue(new SafeFetchError('blocked_address', 'ozel'));
    expect(await svc().fetchTitle('https://dis.com/makale')).toBeNull();
  });
});

describe('XCurationService.resolveRedirect — t.co', () => {
  it('ilk adim yalnizca t.co\'ya, durust bot kimligiyle; hedef SSRF korumali izlenir', async () => {
    const f = tco(301, 'https://dis.com/makale');
    fetchMock.mockResolvedValue(res({ status: 200, url: 'https://dis.com/makale' }));
    expect(await svc().resolveRedirect('https://t.co/abc123')).toBe('https://dis.com/makale');
    const [calledUrl, init] = (f.mock.calls[0] as unknown) as [string, RequestInit];
    expect(calledUrl).toBe('https://t.co/abc123');
    expect(init).toMatchObject({ method: 'HEAD', redirect: 'manual' });
    expect((init.headers as Record<string, string>)['user-agent']).toBe(RANKSUP_BOT_UA);
    expect(fetchMock.mock.calls[0]).toEqual(['https://dis.com/makale', expect.objectContaining({ method: 'HEAD' })]);
  });

  it('ikinci kisaltici (bit.ly → hedef) izlenir', async () => {
    tco(301, 'https://bit.ly/x');
    fetchMock.mockResolvedValue(res({ status: 200, url: 'https://son.com/yazi', redirected: true }));
    expect(await svc().resolveRedirect('https://t.co/abc123')).toBe('https://son.com/yazi');
  });

  it('t.co ic/ozel adrese yonlendirirse null — hedefe hic baglanilmaz', async () => {
    tco(301, 'http://169.254.169.254/latest/meta-data/');
    expect(await svc().resolveRedirect('https://t.co/abc123')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('hedef yavas/erisilemez: t.co\'nun verdigi adres elde kalir; ic adrese yonlenirse null', async () => {
    tco(301, 'https://dis.com/makale');
    fetchMock.mockRejectedValue(new SafeFetchError('timeout', 'Zaman asimi'));
    expect(await svc().resolveRedirect('https://t.co/abc123')).toBe('https://dis.com/makale');
    fetchMock.mockRejectedValue(new SafeFetchError('blocked_address', 'ozel'));
    expect(await svc().resolveRedirect('https://t.co/abc123')).toBeNull();
  });

  it('t.co disi adres ya da yonlendirmeyen yanit → null', async () => {
    const f = tco(200);
    expect(await svc().resolveRedirect('https://evil.com/?r=//t.co/x')).toBeNull();
    expect(f).not.toHaveBeenCalled();
    expect(await svc().resolveRedirect('https://t.co/abc123')).toBeNull();
  });
});
