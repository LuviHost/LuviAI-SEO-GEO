import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SafeTextResult } from '../common/safe-fetch.js';

vi.mock('../prisma/prisma.service.js', () => ({ PrismaService: class {} }));
const fetchMock = vi.fn();
vi.mock('../common/safe-fetch.js', async (orig) => {
  const real: any = await orig();
  return { ...real, safeFetchText: (...a: any[]) => fetchMock(...a) };
});

const { CompetitorService } = await import('./competitor.service.js');

type Reply = { status: number; text?: string; headers?: Record<string, string> };
const res = (url: string, r: Reply): SafeTextResult => ({
  status: r.status, ok: r.status >= 200 && r.status < 300, url, redirected: false, contentType: 'text/html',
  headers: r.headers ?? {}, text: r.text ?? '', truncated: false, binary: false,
});
function serve(map: Record<string, Reply>, fallback: Reply = { status: 404 }) {
  fetchMock.mockImplementation(async (url: string) => res(url, map[url] ?? fallback));
}
const svc = () => new CompetitorService({} as any) as any;

beforeEach(() => { fetchMock.mockReset(); });

describe('CompetitorService.fetchBlogPosts', () => {
  it('RSS bulunursa yazilari okur; istek tavanli ve durust bot kimligiyle', async () => {
    serve({ 'https://rakip.com/feed': { status: 200, text: '<rss><item><title>Yeni yazi</title><link>https://rakip.com/y</link></item></rss>' } });
    expect(await svc().fetchBlogPosts('https://rakip.com')).toEqual([{ title: 'Yeni yazi', link: 'https://rakip.com/y' }]);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ timeoutMs: 8000 });
    expect(fetchMock.mock.calls[0][1].userAgent).toBeUndefined();
  });

  it('bot dogrulama sayfasindaki linkler "rakip yazisi" sayilmaz', async () => {
    const challenge = '<html><head><title>Just a moment...</title></head><body><a href="/blog/dogrulama-sayfasi-linki-burada">Dogrulama sayfasindaki uzun bir link basligi</a></body></html>';
    serve({}, { status: 200, text: challenge });
    expect(await svc().fetchBlogPosts('https://rakip.com')).toEqual([]);
  });
});
