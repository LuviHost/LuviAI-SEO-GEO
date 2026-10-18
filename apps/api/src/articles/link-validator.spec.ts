import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SafeTextResult } from '../common/safe-fetch.js';

const fetchMock = vi.fn();
vi.mock('../common/safe-fetch.js', async (orig) => {
  const real: any = await orig();
  return { ...real, safeFetchText: (...a: any[]) => fetchMock(...a) };
});

const { LinkValidatorService } = await import('./link-validator.service.js');
const { SafeFetchError } = await import('../common/safe-fetch.js');

type Reply = { status: number; text?: string; headers?: Record<string, string> };
const res = (url: string, r: Reply): SafeTextResult => ({
  status: r.status, ok: r.status >= 200 && r.status < 300, url, redirected: false,
  contentType: 'text/html', headers: r.headers ?? {}, text: r.text ?? '', truncated: false, binary: false,
});

/** HEAD ve GET yanitlari ayri; GET tanimsizsa HEAD ile ayni */
function serve(head: Reply | Error, get?: Reply | Error) {
  fetchMock.mockImplementation(async (url: string, opts: any = {}) => {
    const r = opts.method === 'HEAD' ? head : (get ?? head);
    if (r instanceof Error) throw r;
    return res(url, r);
  });
}

const SITE = 'https://site.com';
function build() {
  const prisma = { site: { findUnique: vi.fn(async () => ({ id: 's1', url: SITE })) } };
  const inventory = {
    getInventory: vi.fn(async () => [{ url: `${SITE}/a`, path: '/a', title: 'A' }]),
    isInternal: (href: string, base: string) => !href.startsWith('http') || new URL(href).host === new URL(base).host,
    normalizePath: (href: string, base: string) => new URL(href, base).pathname,
    suggestReplacement: () => null,
  };
  return new LinkValidatorService(prisma as any, inventory as any);
}

const MD = 'Bkz. [dis kaynak](https://dis.com/yazi) ve [ic](/a).';
async function check() {
  return build().validateArticleMarkdown('s1', MD, { checkExternal: true });
}

const CF_WAF: Reply = {
  status: 403,
  headers: { server: 'cloudflare', 'cf-ray': 'x' },
  text: '<title>Attention Required! | Cloudflare</title>Sorry, you have been blocked',
};

beforeEach(() => { fetchMock.mockReset(); });

describe('LinkValidatorService — harici link hukmu', () => {
  it('HEAD 404 + GET 404 → olu link, duz metne cevrilir', async () => {
    serve({ status: 404 });
    const { bodyMd, report } = await check();
    expect(bodyMd).toContain('Bkz. dis kaynak ve');
    expect(report.unlinked).toBe(1);
    expect(report.issues).toContainEqual(expect.objectContaining({ original: 'https://dis.com/yazi', action: 'unlinked', reason: 'harici link 404' }));
    // Once HEAD, sonra teyit icin GET
    expect(fetchMock.mock.calls.map((c) => c[1]?.method ?? 'GET')).toEqual(['HEAD', 'GET']);
  });

  it('HEAD 405 → GET 410 → olu link', async () => {
    serve({ status: 405 }, { status: 410 });
    const { report } = await check();
    expect(report.issues).toContainEqual(expect.objectContaining({ action: 'unlinked', reason: 'harici link 410' }));
  });

  it('HEAD\'e yanlis 404 donen sunucu: GET 200 ise link KALIR', async () => {
    serve({ status: 404 }, { status: 200, text: '<html>ok</html>' });
    const { bodyMd, report } = await check();
    expect(bodyMd).toBe(MD);
    expect(report.unlinked).toBe(0);
  });

  it('Cloudflare WAF 403 (HEAD ya da GET) hukum degildir — link kalir', async () => {
    serve({ status: 405 }, CF_WAF);
    expect((await check()).report.unlinked).toBe(0);
    serve({ status: 403, headers: { server: 'cloudflare', 'cf-mitigated': 'challenge' } });
    expect((await check()).report.unlinked).toBe(0);
  });

  it('404 govdesi bot dogrulamasi iceriyorsa (challenge) link silinmez', async () => {
    serve({ status: 404 }, { status: 404, text: '<script src="https://geo.captcha-delivery.com/captcha/"></script>' });
    const { report } = await check();
    expect(report.unlinked).toBe(0);
  });

  it('429 hiz siniri link bozmaz', async () => {
    serve({ status: 429, headers: { 'retry-after': '60' } });
    expect((await check()).report.unlinked).toBe(0);
  });

  it('ic/ozel adres (blocked_address) ve zaman asimi → hukum yok', async () => {
    serve(new SafeFetchError('blocked_address', 'ozel adres'));
    expect((await check()).report.unlinked).toBe(0);
    serve(new SafeFetchError('timeout', 'Zaman asimi'));
    expect((await check()).report.unlinked).toBe(0);
  });

  it('istekler durust bot kimligiyle gider (UA ezilmez)', async () => {
    serve({ status: 200 });
    await check();
    expect(fetchMock.mock.calls[0][1].userAgent).toBeUndefined();
  });
});
