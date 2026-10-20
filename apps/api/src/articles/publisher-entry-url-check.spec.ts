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
const { PUBLIC_URL_FETCH, QUERY_URL_MAX_BYTES } = await import('./public-url-probe.js');

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
    const yaz = (status: number, body: string, headers: Record<string, string> = {}) => {
      res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...headers });
      res.end(body);
    };
    // <head>'i 32 KB'tan uzun sayfa: kanonik baglanti satir ici CSS'ten SONRA (tema / eklenti)
    const uzunBasli = (canonical: string) => `<html><head><style>${'.x{color:red}'.repeat(4_000)}</style><link rel="canonical" href="${canonical}"></head><body>Metin</body></html>`;
    switch (req.url) {
      case '/': return yaz(200, '<html><title>Ana sayfa</title></html>');
      // Sorguyu yok sayan onbellek / CDN ?p= istegine ana sayfayi sundu (kanonik: ana sayfa)
      case '/?p=42': return yaz(200, uzunBasli(`${kok}/`));
      // Yayindaki yazi ?p= adresinde kendi kalici baglantisini kanonik bildirir
      case '/?p=43': return yaz(200, uzunBasli(`${kok}/yazi-43/`));
      // Guvenlik duvari / bot dogrulama sayfasi 404 durumuyla (yazi orada olabilir)
      case '/cf-dogrulama-404/': return yaz(404, '<html><title>Just a moment...</title></html>', { 'cf-mitigated': 'challenge', server: 'cloudflare' });
      // Basliksiz: yalniz govdeden taninir (govde okunmasaydi 'gone' sayilirdi)
      case '/js-dogrulama-404/': return yaz(404, `<html><head><title>Kontrol</title></head><body>${'<!-- dolgu -->'.repeat(50)}<script>window._cf_chl_opt={cvId:'3'};</script></body></html>`);
      case '/datadome-404/': return yaz(404, '<html><body><iframe src="https://geo.captcha-delivery.com/captcha/?initialCid=x"></iframe></body></html>');
      // Siradan 404: sayfadaki iletisim formunun reCAPTCHA'si engel sayilmaz
      case '/formlu-404/': return yaz(404, '<html><body>Sayfa bulunamadı<form><div class="g-recaptcha" data-sitekey="x"></div></form></body></html>');
      // Silinen yaziyi ana sayfaya yonlendiren site (404-to-homepage eklentileri)
      case '/anasayfaya/': return git(301, '/');
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
  // Govdenin yalniz basi okunan (32 KB tavan) buyuk yanitlarin baglantisi sunucu tarafinda
  // yazim surerken acik kalir; close() onlari beklemesin
  sunucu.closeAllConnections();
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

  it('404 durumuyla donen guvenlik duvari / bot dogrulama sayfasi: unknown — yazinin silindigi kanitlanmadi (canlilik denetimiyle ayni kural, block-detect)', async () => {
    // Eskiden yalniz durum koduna bakiliyordu: bu yanitlar 'gone' sayilip otomasyon
    // musterinin yayindaki kopyasini emekliye ayiriyordu (live_entry_missing)
    for (const yol of ['/cf-dogrulama-404/', '/js-dogrulama-404/', '/datadome-404/']) {
      expect(await checkEntryPublicUrl(`${kok}${yol}`, yerelFetch), yol).toBe('unknown');
    }
    // Siradan 404 sayfasindaki form reCAPTCHA'si engel degil: yazi gercekten yok
    expect(await checkEntryPublicUrl(`${kok}/formlu-404/`, yerelFetch)).toBe('gone');
  });

  it('silinen yaziyi ana sayfaya yonlendiren site: ana sayfa verilince unknown (adres "hala aciliyor" sayilmaz); ana sayfa verilmezse eski davranis', async () => {
    const homepage = `${kok}/`;
    expect(await checkEntryPublicUrl(`${kok}/anasayfaya/`, yerelFetch, { homepage })).toBe('unknown');
    expect(await checkEntryPublicUrl(`${kok}/anasayfaya/`, yerelFetch)).toBe('live');
    // Yazinin kendi adresi ana sayfa olsa (statik on sayfa) yonlendirmesiz 200 yine live
    expect(await checkEntryPublicUrl(homepage, yerelFetch, { homepage })).toBe('live');
    expect(await checkEntryPublicUrl(`${kok}/tasindi/`, yerelFetch, { homepage })).toBe('live');
  });

  it('sorgulu adres (?p=): kanonik baglanti 32 KB\'tan sonra da okunur — ana sayfayi kanonik bildiren yanit unknown, yazinin kendi kanonigi live (canlilik denetimiyle ayni secenek)', async () => {
    // Eskiden sabit 32 KB okunuyordu: kanonik baglanti okunan kismin disinda kaliyor, onbellegin
    // sundugu ana sayfa 'live' sayiliyordu (canlilik denetimi ayni yaniti 'unknown' okur)
    const homepage = `${kok}/`;
    expect(await checkEntryPublicUrl(`${kok}/?p=42`, yerelFetch, { homepage })).toBe('unknown');
    expect(await checkEntryPublicUrl(`${kok}/?p=42`, yerelFetch)).toBe('unknown');
    expect(await checkEntryPublicUrl(`${kok}/?p=43`, yerelFetch, { homepage })).toBe('live');
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

  it('onModuleInit gercek yoklayiciyi uretim safeFetchText ile baglar: canlilik denetimiyle ayni secenekler (govdenin basi 32 KB, en fazla 3 yonlendirme, 10 sn)', async () => {
    const svc = yayinci() as any;
    expect(svc.entryUrlCheck).toBeNull();
    svc.onModuleInit();
    vi.mocked(safeFetch.safeFetchText).mockResolvedValueOnce({ status: 410 } as any);
    expect(await svc.entryUrlCheck('https://site.example/yazi/')).toBe('gone');
    expect(safeFetch.safeFetchText).toHaveBeenCalledWith('https://site.example/yazi/', PUBLIC_URL_FETCH);
    expect(PUBLIC_URL_FETCH).toEqual({ method: 'GET', maxBytes: 32 * 1024, errorBodyBytes: 32 * 1024, maxRedirects: 3, timeoutMs: 10_000 });
  });

  it('sorgulu adreste uretim yoklayicisi govdenin ilk 256 KB\'ini okur (publicUrlFetchOptions); guzel kalici baglanti 32 KB', async () => {
    const svc = yayinci() as any;
    svc.onModuleInit();
    vi.mocked(safeFetch.safeFetchText).mockResolvedValueOnce({ status: 410 } as any).mockResolvedValueOnce({ status: 410 } as any);
    await svc.entryUrlCheck('https://site.example/?p=42');
    await svc.entryUrlCheck('https://site.example/yazi/');
    expect(safeFetch.safeFetchText).toHaveBeenNthCalledWith(1, 'https://site.example/?p=42', { ...PUBLIC_URL_FETCH, maxBytes: QUERY_URL_MAX_BYTES });
    expect(safeFetch.safeFetchText).toHaveBeenNthCalledWith(2, 'https://site.example/yazi/', PUBLIC_URL_FETCH);
    expect(QUERY_URL_MAX_BYTES).toBe(256 * 1024);
  });

  it('uretim yoklayicisi ana sayfayi siniflandirmaya iletir; 404 + bot dogrulama basligi gone sayilmaz', async () => {
    const svc = yayinci() as any;
    svc.onModuleInit();
    vi.mocked(safeFetch.safeFetchText).mockResolvedValueOnce({
      status: 200, ok: true, redirected: true, url: 'https://site.example/', headers: {}, text: '<html>Ana sayfa</html>',
    } as any);
    expect(await svc.entryUrlCheck('https://site.example/yazi/', { homepage: 'https://site.example/' })).toBe('unknown');
    vi.mocked(safeFetch.safeFetchText).mockResolvedValueOnce({
      status: 404, ok: false, redirected: false, url: 'https://site.example/yazi/', headers: { 'cf-mitigated': 'challenge' }, text: '',
    } as any);
    expect(await svc.entryUrlCheck('https://site.example/yazi/', { homepage: 'https://site.example/' })).toBe('unknown');
  });

  it('onceden verilmis yoklayici (test) ezilmez', () => {
    const svc = yayinci() as any;
    const sahte = vi.fn();
    svc.entryUrlCheck = sahte;
    svc.onModuleInit();
    expect(svc.entryUrlCheck).toBe(sahte);
  });
});
