import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * S18 yan etkisi: yerinde guncellemede kimligin 404'u yaziyi emekliye
 * ayirmadan once yazinin herkese acik adresi yoklanir (checkEntryPublicUrl).
 *
 * NEDEN VAR: WordPress, kimlik bir sayfaya ait oldugunda ya da WXR yeniden ice
 * aktarimi kimlikleri degistirdiginde de 404 rest_post_invalid_id doner; kalici
 * adres yaziyi sunmaya devam eder. Yayinci yalniz kimlige bakip canli yaziyi
 * emekliye ayiriyordu. Burada GERCEK safe-fetch tasimasi (yerel sunucuya
 * acilmis test ornegi) ile siniflandirma, durust bot kimligi, yonlendirme
 * izleme ve uretim orneginin ic adrese baglanmamasi sinanir. Yayincidaki uctan
 * uca akis publisher-live-guards.spec.ts'te (S18 yan etkisi).
 */

vi.mock('@luviai/shared', async (orig) => ({ ...(await orig() as any), decryptCredentials: (c: any) => c ?? {} }));
vi.mock('../prisma/prisma.service.js', () => ({ PrismaService: class {} }));
vi.mock('./image-generator.service.js', () => ({ ImageGeneratorService: class {} }));
vi.mock('../audit/ai-indexing-pinger.service.js', () => ({ AiIndexingPingerService: class {} }));
vi.mock('../audit/llms-full-builder.service.js', () => ({ LlmsFullBuilderService: class {} }));
vi.mock('./link-validator.service.js', () => ({ LinkValidatorService: class {} }));
vi.mock('../sites/site-url-inventory.service.js', () => ({ SiteUrlInventoryService: class {} }));
vi.mock('./qa-gate.service.js', () => ({ QaGateService: class {} }));
vi.mock('../llm/llm-provider.service.js', () => ({ LLMProviderService: class {} }));
vi.mock('./hero-alt.js', () => ({ describeHeroImage: vi.fn(async () => null) }));
// Uretim ornegi (safeFetchText) gercek davranisiyla calisir; cagrilari gozlemek icin sarili
vi.mock('../common/safe-fetch.js', async (orig) => {
  const real = await orig() as typeof import('../common/safe-fetch.js');
  return { ...real, safeFetchText: vi.fn(real.safeFetchText) };
});

const safeFetch = await import('../common/safe-fetch.js');
const { PublisherService, checkEntryPublicUrl } = await import('./publisher.service.js');

/** Yerel sunucuya baglanabilen test ornegi (uretimde ic adres ve 80/443 disi port yasak) */
const yerelFetch = safeFetch.makeSafeTextFetch({ isBlocked: () => false, allowAnyPort: true, ipv4Only: true });

let sunucu: http.Server;
let kok = '';
let gelen: Array<{ method: string; path: string; ua: string }> = [];

beforeAll(async () => {
  sunucu = http.createServer((req, res) => {
    gelen.push({ method: String(req.method), path: String(req.url), ua: String(req.headers['user-agent'] ?? '') });
    const git = (status: number, location?: string) => {
      res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...(location ? { location } : {}) });
      res.end(status === 200 ? `<html><body>${'Yazı metni. '.repeat(20_000)}</body></html>` : '<html>yok</html>');
    };
    switch (req.url) {
      case '/canli/': return git(200);
      case '/silinmis/': return git(404);
      case '/kaldirildi/': return git(410);
      case '/tasindi/': return git(301, '/canli/');
      case '/tasindi-olu/': return git(301, '/silinmis/');
      case '/dongu/': return git(302, '/dongu/');
      case '/yasak/': return git(403);
      case '/hata/': return git(503);
      case '/cok-istek/': return git(429);
      default: return git(404);
    }
  });
  await new Promise<void>((resolve) => sunucu.listen(0, '127.0.0.1', resolve));
  kok = `http://127.0.0.1:${(sunucu.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => sunucu.close(() => resolve()));
});

beforeEach(() => {
  gelen = [];
  vi.mocked(safeFetch.safeFetchText).mockClear();
});

describe('checkEntryPublicUrl — gercek safe-fetch tasimasiyla', () => {
  it('404 ve 410: gone (yazi o adreste yok); 200: live', async () => {
    expect(await checkEntryPublicUrl(`${kok}/silinmis/`, yerelFetch)).toBe('gone');
    expect(await checkEntryPublicUrl(`${kok}/kaldirildi/`, yerelFetch)).toBe('gone');
    expect(await checkEntryPublicUrl(`${kok}/canli/`, yerelFetch)).toBe('live');
  });

  it('yonlendirme izlenir, karari son yanit verir: 301 -> 200 live, 301 -> 404 gone; dongu dogrulanamaz', async () => {
    expect(await checkEntryPublicUrl(`${kok}/tasindi/`, yerelFetch)).toBe('live');
    expect(gelen.map((g) => g.path)).toEqual(['/tasindi/', '/canli/']);
    expect(await checkEntryPublicUrl(`${kok}/tasindi-olu/`, yerelFetch)).toBe('gone');
    expect(await checkEntryPublicUrl(`${kok}/dongu/`, yerelFetch)).toBe('unknown');
  });

  it('baska durum (403, 429, 503) ve ag hatasi: unknown — kaldirildigi kanitlanmadi', async () => {
    for (const yol of ['/yasak/', '/cok-istek/', '/hata/']) {
      expect(await checkEntryPublicUrl(`${kok}${yol}`, yerelFetch), yol).toBe('unknown');
    }
    // Kapali port: baglanti reddedildi
    const kapali = http.createServer();
    await new Promise<void>((resolve) => kapali.listen(0, '127.0.0.1', resolve));
    const port = (kapali.address() as AddressInfo).port;
    await new Promise<void>((resolve) => kapali.close(() => resolve()));
    expect(await checkEntryPublicUrl(`http://127.0.0.1:${port}/x/`, yerelFetch)).toBe('unknown');
  });

  it('durust bot kimligi (RanksUpBot) ile tek GET; adres yoksa hic istek atilmaz', async () => {
    await checkEntryPublicUrl(`${kok}/canli/`, yerelFetch);
    expect(gelen).toEqual([{ method: 'GET', path: '/canli/', ua: safeFetch.RANKSUP_BOT_UA }]);
    gelen = [];
    for (const adres of [undefined, '', '   ']) {
      expect(await checkEntryPublicUrl(adres, yerelFetch), String(adres)).toBe('unknown');
    }
    expect(gelen).toEqual([]);
  });

  it('uretim ornegi (safeFetchText) ic adrese baglanmaz: musterinin WordPress\'i link alanina ic adres yazsa da istek gitmez', async () => {
    for (const adres of ['http://127.0.0.1/yazi/', 'http://169.254.169.254/latest/meta-data/', `${kok}/canli/`]) {
      expect(await checkEntryPublicUrl(adres), adres).toBe('unknown');
    }
    expect(gelen).toEqual([]);
    expect(safeFetch.safeFetchText).toHaveBeenCalledTimes(3);
  });
});

describe('PublisherService — yoklayici Nest yasam dongusunde kurulur', () => {
  const yayinci = () => new PublisherService({} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);

  it('onModuleInit gercek yoklayiciyi uretim safeFetchText ile baglar: govde okunmaz, en fazla 3 yonlendirme, 10 sn', async () => {
    const svc = yayinci() as any;
    expect(svc.entryUrlCheck).toBeNull();
    svc.onModuleInit();
    vi.mocked(safeFetch.safeFetchText).mockResolvedValueOnce({ status: 410 } as any);
    expect(await svc.entryUrlCheck('https://site.example/yazi/')).toBe('gone');
    expect(safeFetch.safeFetchText).toHaveBeenCalledWith('https://site.example/yazi/', { maxBytes: 0, errorBodyBytes: 0, maxRedirects: 3, timeoutMs: 10_000 });
  });

  it('onceden verilmis yoklayici (test) ezilmez', () => {
    const svc = yayinci() as any;
    const sahte = vi.fn();
    svc.entryUrlCheck = sahte;
    svc.onModuleInit();
    expect(svc.entryUrlCheck).toBe(sahte);
  });
});
