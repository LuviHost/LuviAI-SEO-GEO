import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../prisma/prisma.service.js', () => ({ PrismaService: class {} }));
vi.mock('../auth/gsc-oauth.service.js', () => ({ GscOAuthService: class {} }));
const { AiIndexingPingerService } = await import('./ai-indexing-pinger.service.js');

/**
 * Dizin bildirimi — yalniz kurallara uyan kanallar.
 *
 * NEDEN VAR: (1) her makale adresi RanksUp'in ortak hizmet hesabiyla Google
 * Indexing API'ye gonderiliyordu; Google bu API'yi yalniz JobPosting /
 * BroadcastEvent sayfalarina aciyor. (2) IndexNow, anahtar dosyasi bildirilen
 * host'ta olmadan gonderimi kabul etmez; RanksUp'in ortak anahtari musteri
 * alan adinda yok ama sonuc "indexnow: true" donuyordu. (3) Bing anonim
 * ping'i 2022'de kaldirildi (410 Gone).
 */

const KEY = '0d417ed7b90466e097dbf9fbe7db6a90';

function setup(opts: {
  keyFile?: (url: string) => Promise<any>;
  indexNowStatus?: number;
  gsc?: { ok: boolean; skipped?: string; error?: string };
} = {}) {
  const gscOAuth = { submitSitemap: vi.fn(async () => opts.gsc ?? { ok: true }) };
  const svc = new AiIndexingPingerService({} as any, gscOAuth as any);
  const fetchText = vi.fn(opts.keyFile ?? (async () => ({ ok: true, status: 200, text: `${KEY}\n`, binary: false })));
  (svc as any).fetchText = fetchText;
  const fetchMock = vi.fn(async () => new Response('', { status: opts.indexNowStatus ?? 202 }));
  vi.stubGlobal('fetch', fetchMock);
  return { svc, gscOAuth, fetchText, fetchMock };
}

const calledHosts = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.map((c) => new URL(String(c[0])).host);

describe('AiIndexingPingerService.pingUrl', () => {
  const backup = { key: process.env.INDEXNOW_KEY, sa: process.env.GOOGLE_INDEXING_SA_JSON };
  beforeEach(() => {
    process.env.INDEXNOW_KEY = KEY;
    process.env.GOOGLE_INDEXING_SA_JSON = Buffer.from('{"type":"service_account"}').toString('base64');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const [k, v] of [['INDEXNOW_KEY', backup.key], ['GOOGLE_INDEXING_SA_JSON', backup.sa]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('Google Indexing API ve Bing ping cagrilmaz (hizmet hesabi tanimli olsa bile); alanlar false + neden', async () => {
    const { svc, fetchMock } = setup();
    const r = await svc.pingUrl('s1', 'https://ornek.com/blog/a.html');
    expect(calledHosts(fetchMock)).toEqual(['api.indexnow.org']);
    expect(r.google).toBe(false);
    expect(r.bing).toBe(false);
    expect(r.skipped.google).toMatch(/JobPosting/);
    expect(r.skipped.bing).toMatch(/2022/);
  });

  it('anahtar dosyasi bildirilen host\'ta ve icerigi anahtar: IndexNow keyLocation ile gonderilir', async () => {
    const { svc, fetchText, fetchMock } = setup();
    const r = await svc.pingUrl('s1', 'https://www.ornek.com/blog/a.html');
    expect(fetchText).toHaveBeenCalledWith(`https://www.ornek.com/${KEY}.txt`, expect.objectContaining({ maxRedirects: 0 }));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.indexnow.org/IndexNow');
    expect(JSON.parse(String(init.body))).toEqual({
      host: 'www.ornek.com', key: KEY, keyLocation: `https://www.ornek.com/${KEY}.txt`, urlList: ['https://www.ornek.com/blog/a.html'],
    });
    expect(r.indexnow).toBe(true);
    expect(r.skipped.indexnow).toBeUndefined();
  });

  it.each([
    ['404', async () => ({ ok: false, status: 404, text: '', binary: false })],
    ['icerik baska anahtar', async () => ({ ok: true, status: 200, text: 'baska-anahtar-123', binary: false })],
    ['yonlendirme / ag hatasi', async () => { throw new Error('Cok fazla yonlendirme'); }],
  ])('anahtar dosyasi yok (%s): IndexNow gonderilmez, sonuc false + neden', async (_ad, keyFile) => {
    const { svc, fetchMock } = setup({ keyFile });
    const r = await svc.pingUrl('s1', 'https://ornek.com/blog/a.html');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(r.indexnow).toBe(false);
    expect(r.skipped.indexnow).toContain('ornek.com');
    expect(r.skipped.indexnow).toContain(`https://ornek.com/${KEY}.txt`);
  });

  it('anahtar tanimsiz ya da bicimi gecersiz: dosya okunmaz, gonderilmez', async () => {
    for (const [deger, neden] of [['', /tanımlı değil/], ['kisa', /biçimi geçersiz/], ['a/b?c=1&d=xxxxxxxx', /biçimi geçersiz/]] as const) {
      process.env.INDEXNOW_KEY = deger;
      const { svc, fetchText, fetchMock } = setup();
      const r = await svc.pingUrl('s1', 'https://ornek.com/a');
      expect(fetchText).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(r.indexnow).toBe(false);
      expect(r.skipped.indexnow).toMatch(neden);
    }
  });

  it('IndexNow reddederse (403/422/429) false + HTTP durumu', async () => {
    const { svc } = setup({ indexNowStatus: 422 });
    const r = await svc.pingUrl('s1', 'https://ornek.com/a');
    expect(r.indexnow).toBe(false);
    expect(r.skipped.indexnow).toContain('HTTP 422');
  });

  it('GSC: sitenin kendi mulkune <origin>/sitemap.xml; bagli degilse neden', async () => {
    const ok = setup();
    const r1 = await ok.svc.pingUrl('s1', 'https://ornek.com/blog/a.html?x=1');
    expect(ok.gscOAuth.submitSitemap).toHaveBeenCalledWith('s1', 'https://ornek.com/sitemap.xml');
    expect(r1.gsc).toBe(true);
    expect(r1.skipped.gsc).toBeUndefined();

    const yok = setup({ gsc: { ok: false, skipped: 'not_connected' } });
    expect((await yok.svc.pingUrl('s1', 'https://ornek.com/a')).skipped.gsc).toBe('Search Console bağlı değil.');
    const izin = setup({ gsc: { ok: false, error: 'insufficient_scope (reconnect GSC)' } });
    expect((await izin.svc.pingUrl('s1', 'https://ornek.com/a')).skipped.gsc).toMatch(/yazma izni yok/);
  });
});
