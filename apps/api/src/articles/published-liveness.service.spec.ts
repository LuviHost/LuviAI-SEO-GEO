import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Gunluk "yazi sitede gercekten yayinda mi" denetimi (published-liveness.service.ts).
 *
 * NEDEN VAR: uretimde (18.10.2026) isgetkinlikleri.com'daki 5 yayindaki yazinin adresi
 * 404 veriyordu (musteri kaldirmis, ana sayfa 200); RanksUp onlari hala "yayında"
 * gosteriyor, sitemap-ai.xml ve llms-full'da ilan ediyordu. Denetim kopyayi YALNIZ
 * dogrulanmis 404/410'da dusurmeli: ayni turda ana sayfa acik, 20+ saat arayla iki
 * basarisiz denetim; engel / hiz siniri / sunucu hatasi / zaman asimi asla dusurmez.
 * Vitest dekorator metadata'si uretmedigi icin servis elle kurulur.
 */

vi.mock('../prisma/prisma.service.js', () => ({ PrismaService: class {} }));
vi.mock('../notifications/notifications.service.js', () => ({ NotificationsService: class {} }));
vi.mock('../audit/llms-full-builder.service.js', () => ({ LlmsFullBuilderService: class {} }));

const safeFetch = await import('../common/safe-fetch.js');
const {
  PublishedLivenessService, classifyLivenessResponse, livenessCheckTarget, planSiteChecks, recordedRemoteDir, wordPressPlainLink, retirementNotice,
  retirementSummaryNotice, LIVENESS_FETCH, LIVENESS_SITE_MAX_CHECKS, LIVENESS_SPACING_MS, LIVENESS_NOTIFY_PER_SITE,
} = await import('./published-liveness.service.js');
const { LIVENESS_MISSING_REASON } = await import('./republish-policy.js');
const { publicUrlFetchOptions, QUERY_URL_MAX_BYTES } = await import('./public-url-probe.js');
const { advertisedArticleEntry } = await import('../audit/ai-sitemap.service.js');

/** Satir ici CSS'i 32 KB'tan uzun <head>: kanonik baglanti govdenin 32 KB'tan sonraki kisminda */
const UZUN_HEAD_CSS = `<style>${'.x{color:#123456}\n'.repeat(2_500)}</style>`;

const H = 3_600_000;
const T0 = new Date('2026-10-19T02:20:00.000Z');
const after = (ms: number) => new Date(T0.getTime() + ms);

// ─────────────────────────────────────────────────────────────────────────
//  Siniflandirma — GERCEK safe-fetch tasimasiyla (yerel sunucuya acilmis test ornegi)
// ─────────────────────────────────────────────────────────────────────────

const yerelFetch = safeFetch.makeSafeTextFetch({ isBlocked: () => false, allowAnyPort: true, ipv4Only: true });
let sunucu: http.Server;
let kok = '';
const gelen: Array<{ path: string; ua: string }> = [];

beforeAll(async () => {
  sunucu = http.createServer((req, res) => {
    gelen.push({ path: String(req.url), ua: String(req.headers['user-agent'] ?? '') });
    const yaz = (status: number, body: string, headers: Record<string, string> = {}) => {
      res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...headers });
      res.end(body);
    };
    switch (req.url) {
      case '/': return yaz(200, '<html><title>Ana sayfa</title></html>');
      case '/canli/': return yaz(200, `<html><body>${'Yazı metni. '.repeat(20_000)}</body></html>`);
      case '/silinmis/': return yaz(404, '<html>Sayfa bulunamadı</html>');
      case '/kaldirildi/': return yaz(410, '<html>Gone</html>');
      case '/formlu-404/': return yaz(404, '<html><form><div class="g-recaptcha"></div></form></html>');
      case '/tasindi/': return yaz(301, '', { location: '/canli/' });
      case '/tasindi-olu/': return yaz(301, '', { location: '/silinmis/' });
      case '/anasayfaya/': return yaz(301, '', { location: '/' });
      case '/yasak/': return yaz(403, '<html>Forbidden</html>');
      case '/cf-engel/': return yaz(403, '<html><title>Attention Required! | Cloudflare</title>Sorry, you have been blocked</html>', { server: 'cloudflare', 'cf-ray': 'x' });
      case '/cf-dogrulama/': return yaz(200, '<html><title>Just a moment...</title></html>', { 'cf-mitigated': 'challenge', server: 'cloudflare' });
      case '/datadome-404/': return yaz(404, '<iframe src="https://geo.captcha-delivery.com/captcha/"></iframe>');
      case '/cok-istek/': return yaz(429, 'slow down');
      case '/hata/': return yaz(500, 'boom');
      case '/bakim/': return yaz(503, 'maintenance');
      case '/giris/': return yaz(401, 'login');
      // Sorguyu yok sayan onbellek: ?p=42 icin yonlendirmesiz 200 ile ana sayfa (kanonik = ana sayfa)
      case '/?p=42': return yaz(200, `<html><head><title>Ana sayfa</title>${UZUN_HEAD_CSS}<link rel="canonical" href="/"></head><body>Ana sayfa</body></html>`);
      // "Plain" kalici baglanti ayarli sitede yayindaki yazi: kendi ?p= adresini bildirir
      case '/?p=43': return yaz(200, `<html><head><title>Yazı</title>${UZUN_HEAD_CSS}<link rel="canonical" href="/?p=43"></head><body>Yazı</body></html>`);
      default: return yaz(404, 'yok');
    }
  });
  await new Promise<void>((resolve) => sunucu.listen(0, '127.0.0.1', resolve));
  kok = `http://127.0.0.1:${(sunucu.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => sunucu.close(() => resolve()));
});

async function sinifla(path: string): Promise<string> {
  const url = `${kok}${path}`;
  try {
    return classifyLivenessResponse(await yerelFetch(url, LIVENESS_FETCH), { requested: url, homepage: `${kok}/` });
  } catch {
    return 'unknown';
  }
}

describe('classifyLivenessResponse — gercek tasima', () => {
  it('404 / 410: gone; formlu siradan 404 de gone (reCAPTCHA engel sayilmaz)', async () => {
    expect(await sinifla('/silinmis/')).toBe('gone');
    expect(await sinifla('/kaldirildi/')).toBe('gone');
    expect(await sinifla('/formlu-404/')).toBe('gone');
    expect(await sinifla('/tasindi-olu/')).toBe('gone');
  });

  it('2xx ve izlenen yonlendirme: live; govde kucuk tavanda kesilir, durust bot kimligi gider', async () => {
    expect(await sinifla('/canli/')).toBe('live');
    expect(await sinifla('/tasindi/')).toBe('live');
    const r = await yerelFetch(`${kok}/canli/`, LIVENESS_FETCH);
    expect(r.text.length).toBeLessThanOrEqual(32 * 1024);
    expect(gelen.at(-1)?.ua).toBe(safeFetch.RANKSUP_BOT_UA);
  });

  it('401 / 403 / 429 / 5xx / WAF engeli / bot dogrulamasi / ana sayfaya yonlendirme: unknown (asla emekliye ayirmaz)', async () => {
    for (const p of ['/yasak/', '/cf-engel/', '/cf-dogrulama/', '/datadome-404/', '/cok-istek/', '/hata/', '/bakim/', '/giris/', '/anasayfaya/']) {
      expect(await sinifla(p), p).toBe('unknown');
    }
  });

  it('C1 madde 3: sorgulu adreste govdenin uzun on kismi okunur; ana sayfayi kanonik bildiren onbellek yaniti unknown, yayindaki ?p= yazisi live', async () => {
    const sor = async (path: string, opts: Parameters<typeof yerelFetch>[1]) => {
      const url = `${kok}${path}`;
      return classifyLivenessResponse(await yerelFetch(url, opts), { requested: url, homepage: `${kok}/` });
    };
    // Kanonik baglanti ilk 32 KB'ta degil: eski istek secenekleriyle hic gorulmezdi (sahte canli gorulme)
    expect(UZUN_HEAD_CSS.length).toBeGreaterThan(32 * 1024);
    expect(await sor('/?p=42', LIVENESS_FETCH)).toBe('live');
    expect(await sor('/?p=42', publicUrlFetchOptions(`${kok}/?p=42`))).toBe('unknown');
    expect(await sor('/?p=43', publicUrlFetchOptions(`${kok}/?p=43`))).toBe('live');
    // Servisin kendi yoklamasi da bu secenekleri kullanir
    const svc = new PublishedLivenessService({} as any, {} as any, {} as any);
    Object.assign(svc as any, { fetchText: yerelFetch });
    expect(await (svc as any).probe(`${kok}/?p=42`, `${kok}/`)).toBe('unknown');
    expect(await (svc as any).probe(`${kok}/?p=43`, `${kok}/`)).toBe('live');
    expect(await (svc as any).probe(`${kok}/canli/`, `${kok}/`)).toBe('live');
  });

  it('uretim ornegi ic adrese baglanmaz: hata unknown sayilir (servis probe hata firlatmaz)', async () => {
    const svc = new PublishedLivenessService({} as any, {} as any, {} as any);
    // Varsayilan fetchText = safeFetchText (uretim): 127.0.0.1 engelli
    expect(await (svc as any).probe(`${kok}/silinmis/`, null)).toBe('unknown');
  });
});

// ─────────────────────────────────────────────────────────────────────────
//  Hangi kopya, hangi adres
// ─────────────────────────────────────────────────────────────────────────

describe('livenessCheckTarget', () => {
  const site = new URL('https://isgetkinlikleri.com');
  const wpEntry = { targetId: 'wp', targetType: 'WORDPRESS_REST', ok: true, externalId: '7', externalUrl: 'https://www.isgetkinlikleri.com/etkinlik/' };

  // Hedefin bugunku "Yayın durumu" ayarinin her hali: karar hicbirine bagli olmamali
  const AYARLAR = [{ postStatus: 'publish' }, { postStatus: 'draft' }, {}, null];
  const hedefler = (type = 'WORDPRESS_REST') => [...AYARLAR.map((config) => ({ type, config })), undefined];

  it('WordPress: RanksUp\'in son yaziminda durum "publish" ise adres (duz ?p= de) dogrudan kanit — hedefin bugunku ayari ne olursa olsun', () => {
    const yayinda = { ...wpEntry, remoteStatus: 'publish' };
    for (const t of hedefler()) {
      expect(livenessCheckTarget(site, 'etkinlik', yayinda, t), JSON.stringify(t)).toEqual({ url: 'https://isgetkinlikleri.com/etkinlik/', needsSighting: false });
    }
    // XML-RPC yayinda her zaman ?p= kaydeder; durum 'publish' okunduysa o da sitenin sayfasidir
    const xmlrpc = { ...wpEntry, targetType: 'WORDPRESS_XMLRPC', externalUrl: 'https://isgetkinlikleri.com/?p=7', remoteStatus: 'publish' };
    for (const t of hedefler('WORDPRESS_XMLRPC')) {
      expect(livenessCheckTarget(site, 'x', xmlrpc, t), JSON.stringify(t)).toEqual({ url: 'https://isgetkinlikleri.com/?p=7', needsSighting: false });
    }
  });

  it('WordPress: taslak / bekleyen / ozel / zamanlanmis yazi once bir kez canli gorulmeli — hedef sonradan "Yayında"ya alinsa da (rv18 F2)', () => {
    for (const remoteStatus of ['draft', 'pending', 'private', 'future', 'DRAFT ']) {
      for (const externalUrl of ['https://isgetkinlikleri.com/?p=7', 'https://isgetkinlikleri.com/etkinlik/']) {
        for (const t of hedefler()) {
          expect(livenessCheckTarget(site, 'etkinlik', { ...wpEntry, externalUrl, remoteStatus }, t)?.needsSighting, `${remoteStatus} ${externalUrl} ${JSON.stringify(t)}`).toBe(true);
        }
      }
    }
  });

  it('WordPress: durumu kayitli olmayan eski kayit — duz ?p= once canli gorulmeli (hedef yayin modunda olsa da), guzel kalici baglanti dogrudan kanit', () => {
    const duz = { ...wpEntry, externalUrl: 'https://isgetkinlikleri.com/?p=7' };
    for (const t of [...hedefler(), ...hedefler('WORDPRESS_XMLRPC')]) {
      expect(livenessCheckTarget(site, 'x', duz, t)?.needsSighting, JSON.stringify(t)).toBe(true);
      // WordPress guzel baglantiyi yalniz herkese acik yaziya verir: musteri yaziyi yayina almis
      expect(livenessCheckTarget(site, 'etkinlik', wpEntry, t)?.needsSighting, JSON.stringify(t)).toBe(false);
    }
    // Bos / gecersiz durum bilinmiyor sayilir
    expect(livenessCheckTarget(site, 'x', { ...duz, remoteStatus: '' }, hedefler()[0])?.needsSighting).toBe(true);
    expect(livenessCheckTarget(site, 'x', { ...duz, remoteStatus: 42 }, hedefler()[0])?.needsSighting).toBe(true);
  });

  it('adres baska host\'ta ise denetlenmez (site haritasi kurali)', () => {
    expect(livenessCheckTarget(site, 'x', { ...wpEntry, externalUrl: 'https://blog.baska.com/x/' }, { type: 'WORDPRESS_REST', config: {} })).toBeNull();
  });

  it('dosya hedefleri: kayitli adres sitede degilse kanonik adres, dosya adi kayittaki yoldan; her zaman once canli gorulmeli', () => {
    const ftp = { targetId: 'ftp', targetType: 'FTP', ok: true, externalUrl: 'ftp://ftp.host/public_html/blog/eski-slug.html' };
    expect(livenessCheckTarget(site, 'yeni-slug', ftp, { type: 'FTP', config: { remotePath: '/public_html/blog' } }))
      .toEqual({ url: 'https://isgetkinlikleri.com/blog/eski-slug.html', needsSighting: true });
    const sftp = { targetId: 'sftp', targetType: 'SFTP', ok: true, externalUrl: '/var/www/html/rehber/yazi.html' };
    expect(livenessCheckTarget(site, 'yazi', sftp, { type: 'SFTP', config: { remotePath: '/var/www/html/rehber' } })?.url).toBe('https://isgetkinlikleri.com/rehber/yazi.html');
    // Hedef silinmis: kanonik adres kurulamaz
    expect(livenessCheckTarget(site, 'yazi', sftp, undefined)).toBeNull();
    const cpanel = { targetId: 'cp', targetType: 'CPANEL_API', ok: true, externalUrl: 'https://isgetkinlikleri.com/blog/yazi' };
    expect(livenessCheckTarget(site, 'yazi', cpanel, { type: 'CPANEL_API', config: {} })).toEqual({ url: 'https://isgetkinlikleri.com/blog/yazi', needsSighting: true });
  });

  it('dosya hedefleri: klasor KAYITTAKI dosya yolundan; musteri hedefin klasorunu sonradan degistirse de eski sayfanin adresi yoklanir (rv18 F1)', () => {
    const ftp = { targetId: 'ftp', targetType: 'FTP', ok: true, externalUrl: 'ftp://ftp.host/public_html/blog/yazi.html' };
    expect(livenessCheckTarget(site, 'yazi', ftp, { type: 'FTP', config: { remotePath: '/public_html/makaleler' } }))
      .toEqual({ url: 'https://isgetkinlikleri.com/blog/yazi.html', needsSighting: true });
    const sftp = { targetId: 'sftp', targetType: 'SFTP', ok: true, externalUrl: '/var/www/html/rehber/yazi.html' };
    expect(livenessCheckTarget(site, 'yazi', sftp, { type: 'SFTP', config: { remotePath: '/var/www/html/yeni' } })?.url)
      .toBe('https://isgetkinlikleri.com/rehber/yazi.html');
    // Yolu kayitli olmayan eski kayit: hedefin ayarina duser
    expect(livenessCheckTarget(site, 'yazi', { targetId: 'ftp', targetType: 'FTP', ok: true }, { type: 'FTP', config: { remotePath: '/public_html/blog' } })?.url)
      .toBe('https://isgetkinlikleri.com/blog/yazi.html');
  });

  it('recordedRemoteDir: FTP adresinin ve SFTP yolunun klasoru; http(s) adresi dosya yolu degildir', () => {
    expect(recordedRemoteDir('ftp://ftp.host/public_html/blog/yazi.html')).toBe('/public_html/blog');
    expect(recordedRemoteDir('ftp://ftp.host//yazi.html')).toBe('/');
    expect(recordedRemoteDir('ftp://ftp.host/public_html/%C3%A7ay%20blog/yazi.html')).toBe('/public_html/çay blog');
    expect(recordedRemoteDir('/var/www/html/rehber/yazi.html')).toBe('/var/www/html/rehber');
    expect(recordedRemoteDir('public_html/blog/yazi.html')).toBe('public_html/blog');
    expect(recordedRemoteDir('https://isgetkinlikleri.com/blog/yazi')).toBeNull();
    expect(recordedRemoteDir('yazi.html')).toBeNull();
    expect(recordedRemoteDir(undefined)).toBeNull();
  });

  it('C1 madde 1: dosya kopyasinin yoklanan adresi site haritasi / llms-full / persona sohbetinin ilan ettigi adresle AYNI (tek islev)', () => {
    const hedefler = new Map<string, { type: string; config: unknown }>([
      ['ftp', { type: 'FTP', config: { remotePath: '/public_html/makaleler' } }],
      ['sftp', { type: 'SFTP', config: { remotePath: '/var/www/html/yeni' } }],
      ['cp', { type: 'CPANEL_API', config: { remotePath: 'public_html/yeni' } }],
      ['ftp-yapisik', { type: 'FTP', config: { remotePath: 'blog' } }],
    ]);
    const durumlar: Array<[string, string, Record<string, unknown>, string]> = [
      // Klasor degisti: eski sayfa eski klasorde
      ['klasor', 'yazi', { targetId: 'ftp', targetType: 'FTP', ok: true, externalUrl: 'ftp://ftp.host/public_html/blog/yazi.html' }, 'https://isgetkinlikleri.com/blog/yazi.html'],
      // Slug degisti: dosya eski adla duruyor
      ['slug', 'yeni-slug', { targetId: 'ftp', targetType: 'FTP', ok: true, externalUrl: 'ftp://ftp.host/public_html/makaleler/eski-slug.html' }, 'https://isgetkinlikleri.com/makaleler/eski-slug.html'],
      // Konumu kayitli olmayan eski kayit: bugunku ayar + yazinin slug'i (eski davranis)
      ['eski kayit', 'yazi', { targetId: 'ftp', targetType: 'FTP', ok: true }, 'https://isgetkinlikleri.com/makaleler/yazi.html'],
      ['sftp', 'yazi', { targetId: 'sftp', targetType: 'SFTP', ok: true, externalUrl: '/var/www/html/rehber/yazi.html' }, 'https://isgetkinlikleri.com/rehber/yazi.html'],
      // cPanel genel adresi baska host'ta (cPanel sunucu adindan tahmin): yolu dosyanin yeri
      ['cpanel', 'yazi', { targetId: 'cp', targetType: 'CPANEL_API', ok: true, externalUrl: 'https://srv12.hosting.com/blog/yazi' }, 'https://isgetkinlikleri.com/blog/yazi.html'],
      // remotePath '/' ile baslamiyor (sunucu adi yola yapisik), ayar degismedi: eski davranis
      ['yapisik', 'yazi', { targetId: 'ftp-yapisik', targetType: 'FTP', ok: true, externalUrl: 'ftp://ftp.hostblog/yazi.html' }, 'https://isgetkinlikleri.com/blog/yazi.html'],
    ];
    for (const [ad, slug, entry, beklenen] of durumlar) {
      const t = hedefler.get(String(entry.targetId));
      expect(livenessCheckTarget(site, slug, entry as any, t)?.url, ad).toBe(beklenen);
      expect(advertisedArticleEntry(site, slug, [entry], hedefler)?.url, ad).toBe(beklenen);
    }
  });

  it('KobiPratik sitedeyse (once canli gorulmeli); GitHub dosya gorunumu, yalniz yeni kayit acan CMS ve Markdown ZIP denetlenmez', () => {
    const kp = new URL('https://www.kobipratik.com');
    expect(livenessCheckTarget(kp, 'x', { targetId: 'k', targetType: 'KOBIPRATIK', ok: true, externalUrl: 'https://www.kobipratik.com/pratik-kobi-rehberi/x' }, { type: 'KOBIPRATIK', config: {} }))
      .toEqual({ url: 'https://www.kobipratik.com/pratik-kobi-rehberi/x', needsSighting: true });
    expect(livenessCheckTarget(site, 'x', { targetId: 'g', targetType: 'GITHUB', ok: true, externalUrl: 'https://github.com/o/r/blob/main/x.md' }, { type: 'GITHUB', config: {} })).toBeNull();
    for (const type of ['GHOST', 'STRAPI', 'WEBFLOW', 'SANITY', 'CONTENTFUL', 'WHMCS_KB', 'CUSTOM_PHP', 'SHOPIFY', 'WIX', 'MARKDOWN_ZIP']) {
      expect(livenessCheckTarget(site, 'x', { targetId: 't', targetType: type, ok: true, externalUrl: 'https://isgetkinlikleri.com/x/' }, { type, config: {} }), type).toBeNull();
    }
  });

  it('wordPressPlainLink: yalniz sayisal p parametresi', () => {
    expect(wordPressPlainLink('https://site.com/?p=12')).toBe(true);
    expect(wordPressPlainLink('https://site.com/blog/?p=12&preview=true')).toBe(true);
    expect(wordPressPlainLink('https://site.com/yazi/')).toBe(false);
    expect(wordPressPlainLink('https://site.com/?p=abc')).toBe(false);
    expect(wordPressPlainLink('bozuk adres')).toBe(false);
  });
});

describe('planSiteChecks', () => {
  const slots = Array.from({ length: 10 }, (_, i) => ({ url: `u${i}`, pending: i === 7 }));
  it('ilk basarisizligi kayitli adres once; kapasite gunden gune donusumlu', () => {
    const d1 = planSiteChecks(slots, 4, 1).map((s) => s.url);
    const d2 = planSiteChecks(slots, 4, 2).map((s) => s.url);
    expect(d1[0]).toBe('u7');
    expect(d2[0]).toBe('u7');
    expect(d1).toHaveLength(4);
    expect(new Set([...d1.slice(1), ...d2.slice(1)]).size).toBe(6);
    expect(planSiteChecks(slots, 0, 1)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
//  Tur — sahte veritabani + sahte ag
// ─────────────────────────────────────────────────────────────────────────

type Row = { id: string; siteId: string; title: string; slug: string; status: string; publishedAt: Date | null; publishedTo: unknown; updatedAt: Date };
type Reply = { status: number; headers?: Record<string, string>; text?: string; url?: string; redirected?: boolean } | Error;

const SITE_URL = 'https://isgetkinlikleri.com';
const wpTarget = (config: unknown = { postStatus: 'publish' }) => ({ id: 'wp', type: 'WORDPRESS_REST', config });
const wpEntry = (slug: string, over: Record<string, unknown> = {}) => ({
  targetId: 'wp', targetType: 'WORDPRESS_REST', ok: true, externalId: String(slug.length), externalUrl: `${SITE_URL}/${slug}/`,
  publishedAt: '2026-09-10T08:00:00.000Z', updatedAt: '2026-09-10T08:00:00.000Z', contentHash: `h-${slug}`, ...over,
});
/** Kayitli ilk basarisiz denetim — yoklanan adresiyle (kanit adrese bagli: goneUrl) */
const ilk404 = (slug: string, since: string) => ({ goneSince: since, goneUrl: `${SITE_URL}/${slug}/` });
const row = (id: string, slug: string, publishedTo: unknown[], over: Partial<Row> = {}): Row => ({
  id, siteId: 's1', title: `Yazı ${id}`, slug, status: 'PUBLISHED', publishedAt: new Date('2026-09-10T08:00:00Z'),
  publishedTo, updatedAt: new Date('2026-09-10T08:00:00Z'), ...over,
});

function world(opts: {
  sites?: Array<{ id: string; url: string; userId: string; name: string; publishTargets: Array<{ id: string; type: string; config: unknown }> }>;
  rows: Row[];
  replies: Record<string, Reply | ((n: number) => Reply)>;
  lock?: boolean;
}) {
  const sites = opts.sites ?? [{ id: 's1', url: SITE_URL, userId: 'u1', name: 'İş Etkinlikleri', publishTargets: [wpTarget()] }];
  const db = new Map(opts.rows.map((r) => [r.id, structuredClone(r)]));
  let tick = 0;
  const prisma = {
    kvStore: {
      create: vi.fn(async () => {
        if (opts.lock === false) throw Object.assign(new Error('Unique constraint'), { code: 'P2002' });
        return {};
      }),
    },
    site: { findMany: vi.fn(async () => sites) },
    article: {
      findMany: vi.fn(async ({ where }: any) => [...db.values()]
        .filter((r) => r.siteId === where.siteId)
        .filter((r) => r.status === 'PUBLISHED' || (['READY_TO_PUBLISH', 'REVIZE_NEEDED'].includes(r.status) && r.publishedAt !== null))
        .map((r) => structuredClone(r))),
      findUnique: vi.fn(async ({ where }: any) => (db.has(where.id) ? structuredClone(db.get(where.id)!) : null)),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const r = db.get(where.id);
        if (!r || r.updatedAt.getTime() !== where.updatedAt.getTime()) return { count: 0 };
        const prev = r.updatedAt.getTime();
        const rest = { ...data };
        delete rest.updatedAt;
        Object.assign(r, structuredClone(rest));
        tick += 1;
        // Kilit icin gercek DB gibi her yazimda ilerler
        r.updatedAt = new Date(prev + tick);
        return { count: 1 };
      }),
    },
  };
  const notifications = { create: vi.fn(async (n: any) => ({ id: `n${notifications.create.mock.calls.length}`, ...n })) };
  const llmsFull = { build: vi.fn(async () => ({ siteId: 's1', bytes: 1, articles: 0 })) };
  const svc = new PublishedLivenessService(prisma as any, llmsFull as any, notifications as any);
  const counts = new Map<string, number>();
  const fetchText = vi.fn(async (url: string) => {
    const n = (counts.get(url) ?? 0) + 1;
    counts.set(url, n);
    const spec = opts.replies[url];
    const r = typeof spec === 'function' ? spec(n) : spec ?? { status: 404 };
    if (r instanceof Error) throw r;
    return { status: r.status, ok: r.status >= 200 && r.status < 300, url: r.url ?? url, redirected: r.redirected ?? false, contentType: 'text/html', headers: r.headers ?? {}, text: r.text ?? '', truncated: false, binary: false };
  });
  let clock = T0;
  const sleep = vi.fn(async () => {});
  Object.assign(svc as any, { fetchText, sleep, now: () => clock });
  return {
    svc, prisma, notifications, llmsFull, fetchText, sleep, db,
    at(d: Date) { clock = d; },
    entry(id: string, i = 0) { return (db.get(id)!.publishedTo as any[])[i]; },
  };
}

const HOME = `${SITE_URL}/`;
const ok = { status: 200 } as const;
const yok = { status: 404 } as const;

describe('tur — uretimdeki durum: 5 yazinin adresi 404, ana sayfa 200', () => {
  const slugs = ['yaz-senligi', 'ekim-fuari', 'kariyer-gunu', 'muzik-gecesi', 'kitap-fuari'];
  const setup = () => world({
    rows: slugs.map((s, i) => row(`a${i + 1}`, s, [wpEntry(s)])),
    replies: { [HOME]: ok, ...Object.fromEntries(slugs.map((s) => [`${SITE_URL}/${s}/`, yok])) },
  });

  it('ilk tur: yalniz ilk 404 kaydi (goneSince); yazi yayinda kalir, bildirim ve llms yok', async () => {
    const w = setup();
    const s = await w.svc.run();
    expect(s).toMatchObject({ sites: 1, sitesDown: 0, requests: 6, gone: 5, goneMarked: 5, retired: 0, movedOut: 0, notified: 0 });
    for (let i = 1; i <= 5; i += 1) {
      expect(w.db.get(`a${i}`)!.status).toBe('PUBLISHED');
      expect(w.entry(`a${i}`)).toEqual(wpEntry(slugs[i - 1], ilk404(slugs[i - 1], T0.toISOString())));
    }
    expect(w.notifications.create).not.toHaveBeenCalled();
    expect(w.llmsFull.build).not.toHaveBeenCalled();
    // Nazik tarama: her adres isteginden once bekleme; ana sayfa once
    expect(w.fetchText.mock.calls[0][0]).toBe(HOME);
    expect(w.sleep).toHaveBeenCalledTimes(5);
    expect(w.sleep).toHaveBeenCalledWith(LIVENESS_SPACING_MS);
  });

  it('ertesi gun (24 saat): kopyalar yayinda sayilmaz, yazilar READY_TO_PUBLISH, ilk yayin tarihi kalir; llms yenilenir, 5 bildirim', async () => {
    const w = setup();
    await w.svc.run();
    w.at(after(24 * H));
    const s = await w.svc.run();
    expect(s).toMatchObject({ requests: 6, gone: 5, goneMarked: 0, retired: 5, movedOut: 5, notified: 5 });
    for (let i = 1; i <= 5; i += 1) {
      const r = w.db.get(`a${i}`)!;
      expect(r.status).toBe('READY_TO_PUBLISH');
      expect(r.publishedAt).toEqual(new Date('2026-09-10T08:00:00Z'));
      expect(w.entry(`a${i}`)).toEqual(wpEntry(slugs[i - 1], { missingAt: after(24 * H).toISOString(), missingReason: LIVENESS_MISSING_REASON }));
    }
    expect(w.llmsFull.build).toHaveBeenCalledTimes(1);
    expect(w.llmsFull.build).toHaveBeenCalledWith('s1');
    expect(w.notifications.create).toHaveBeenCalledTimes(5);
    expect(w.notifications.create.mock.calls[0][0]).toEqual({
      userId: 'u1',
      type: 'SYSTEM',
      title: '“Yazı a1” yazısı sitende artık yayında görünmüyor',
      body: '“Yazı a1” yazısı sitende artık yayında görünmüyor (adres 404 veriyor). RanksUp bu yazıyı yayında saymıyor; yeniden yayınlamak istersen yazının sayfasından yayınlayabilirsin.',
      link: '/sites/s1/articles/a1',
      refKind: 'article',
      refId: 'a1',
      channels: ['inapp'],
    });

    // Ucuncu tur: emekli kopya denetlenmez, hicbir sey yazilmaz ya da bildirilmez
    w.at(after(48 * H));
    const third = await w.svc.run();
    expect(third.requests).toBe(0);
    expect(w.notifications.create).toHaveBeenCalledTimes(5);
  });

  it('uctan uca gercek tasimayla (yerel sunucu): 404 veren kopya ertesi gun duser, canli kopya yerinde kalir', async () => {
    const w = world({
      sites: [{ id: 's1', url: kok, userId: 'u1', name: 'Yerel', publishTargets: [wpTarget()] }],
      rows: [
        row('a1', 'silinmis', [wpEntry('silinmis', { externalUrl: `${kok}/silinmis/` })]),
        row('a2', 'canli', [wpEntry('canli', { externalUrl: `${kok}/canli/` })]),
      ],
      replies: {},
    });
    Object.assign(w.svc as any, { fetchText: yerelFetch });
    expect(await w.svc.run()).toMatchObject({ sites: 1, gone: 1, live: 1, goneMarked: 1, retired: 0 });
    w.at(after(24 * H));
    expect(await w.svc.run()).toMatchObject({ retired: 1, movedOut: 1, notified: 1 });
    expect(w.db.get('a1')!.status).toBe('READY_TO_PUBLISH');
    expect(w.db.get('a2')!.status).toBe('PUBLISHED');
    expect(w.entry('a2')).toEqual(wpEntry('canli', { externalUrl: `${kok}/canli/` }));
  });

  it('ikinci tur 20 saatten erkense (ayni gun iki kez kossa da) hicbir kopya dusmez', async () => {
    const w = setup();
    await w.svc.run();
    w.at(after(10 * H));
    const s = await w.svc.run();
    expect(s).toMatchObject({ gone: 5, goneMarked: 0, retired: 0 });
    expect(w.prisma.article.updateMany).toHaveBeenCalledTimes(5);
    expect(w.db.get('a1')!.status).toBe('PUBLISHED');
  });

  it('ana sayfa acilmiyorsa (5xx / engel / zaman asimi) o site icin hicbir sey yazilmaz ve adresler yoklanmaz', async () => {
    for (const home of [{ status: 503 }, { status: 403, headers: { 'cf-mitigated': 'challenge' } }, new Error('Zaman asimi')] as Reply[]) {
      const w = world({ rows: [row('a1', 'x', [wpEntry('x', { goneSince: after(-30 * H).toISOString() })])], replies: { [HOME]: home } });
      const s = await w.svc.run();
      expect(s).toMatchObject({ sites: 0, sitesDown: 1, requests: 1 });
      expect(w.fetchText).toHaveBeenCalledTimes(1);
      expect(w.prisma.article.updateMany).not.toHaveBeenCalled();
    }
  });
});

describe('tur — belirsiz yanit ve yeniden gorulme', () => {
  it('403 / 429 / 5xx / zaman asimi: ilk 404 kaydi oldugu gibi kalir, kopya dusmez, yazim yok', async () => {
    const since = after(-30 * H).toISOString();
    const replies: Record<string, Reply> = {
      [HOME]: ok,
      [`${SITE_URL}/a/`]: { status: 403 },
      [`${SITE_URL}/b/`]: { status: 429 },
      [`${SITE_URL}/c/`]: { status: 502 },
      [`${SITE_URL}/d/`]: new Error('Zaman asimi'),
    };
    const w = world({ rows: ['a', 'b', 'c', 'd'].map((s) => row(s, s, [wpEntry(s, { goneSince: since })])), replies });
    const s = await w.svc.run();
    expect(s).toMatchObject({ unknown: 4, gone: 0, retired: 0 });
    expect(w.prisma.article.findUnique).not.toHaveBeenCalled();
    expect(w.prisma.article.updateMany).not.toHaveBeenCalled();
  });

  it('saglikli kopya ve kanit sayilmayan 404: yazi yeniden okunmaz, hicbir sey yazilmaz', async () => {
    const w = world({
      sites: [{ id: 's1', url: SITE_URL, userId: 'u1', name: 'S', publishTargets: [wpTarget({ postStatus: 'draft' })] }],
      rows: [row('a1', 'canli', [wpEntry('canli')]), row('a2', 'taslak', [wpEntry('taslak', { externalUrl: `${SITE_URL}/?p=5` })])],
      replies: { [HOME]: ok, [`${SITE_URL}/canli/`]: ok, [`${SITE_URL}/?p=5`]: yok },
    });
    expect(await w.svc.run()).toMatchObject({ live: 1, gone: 1, goneMarked: 0 });
    expect(w.prisma.article.findUnique).not.toHaveBeenCalled();
    expect(w.prisma.article.updateMany).not.toHaveBeenCalled();
  });

  it('adres yeniden aciliyorsa ilk 404 kaydi silinir; silinen sayfayi ana sayfaya yonlendiren site belirsiz sayilir', async () => {
    const since = after(-30 * H).toISOString();
    const w = world({
      rows: [row('a1', 'geri', [wpEntry('geri', ilk404('geri', since))]), row('a2', 'yonlenen', [wpEntry('yonlenen', ilk404('yonlenen', since))])],
      replies: { [HOME]: ok, [`${SITE_URL}/geri/`]: ok, [`${SITE_URL}/yonlenen/`]: { status: 200, url: HOME, redirected: true } },
    });
    const s = await w.svc.run();
    expect(s).toMatchObject({ live: 1, unknown: 1, cleared: 1, retired: 0 });
    // Ilk basarisizlik adresiyle birlikte silinir
    expect(w.entry('a1')).toEqual(wpEntry('geri'));
    expect(w.entry('a2')).toEqual(wpEntry('yonlenen', ilk404('yonlenen', since)));
  });

  it('taslak modundaki WordPress hedefi: hic canli gorulmemis kopyanin 404u hicbir sey yazmaz; canli goruldukten sonra normal kural', async () => {
    let state: 'draft' | 'published' | 'deleted' = 'draft';
    const w = world({
      sites: [{ id: 's1', url: SITE_URL, userId: 'u1', name: 'S', publishTargets: [wpTarget({ postStatus: 'draft' })] }],
      rows: [row('a1', 'taslak', [wpEntry('taslak', { externalUrl: `${SITE_URL}/?p=6` })])],
      replies: { [HOME]: ok, [`${SITE_URL}/?p=6`]: () => (state === 'published' ? ok : yok) },
    });
    expect(await w.svc.run()).toMatchObject({ gone: 1, goneMarked: 0 });
    expect(w.prisma.article.updateMany).not.toHaveBeenCalled();
    state = 'published';
    w.at(after(24 * H));
    expect(await w.svc.run()).toMatchObject({ live: 1, seen: 1 });
    expect(w.entry('a1').liveSeenAt).toBe(after(24 * H).toISOString());
    // Gorulme goruldugu adrese bagli
    expect(w.entry('a1').liveSeenUrl).toBe(`${SITE_URL}/?p=6`);
    state = 'deleted';
    w.at(after(48 * H));
    expect(await w.svc.run()).toMatchObject({ goneMarked: 1 });
    w.at(after(72 * H));
    expect(await w.svc.run()).toMatchObject({ retired: 1, movedOut: 1 });
    expect(w.db.get('a1')!.status).toBe('READY_TO_PUBLISH');
  });
});

describe('tur — durum karari ve bildirim metni', () => {
  const since = after(-25 * H).toISOString();

  it('baska hedefte canli kopya kalan yazi PUBLISHED kalir; bildirim yalniz o kopyayi soyler', async () => {
    const ftp = { targetId: 'ftp', targetType: 'FTP', ok: true, externalUrl: 'ftp://ftp.host/public_html/blog/yazi.html', liveSeenAt: since };
    const w = world({
      sites: [{ id: 's1', url: SITE_URL, userId: 'u1', name: 'S', publishTargets: [wpTarget(), { id: 'ftp', type: 'FTP', config: { remotePath: '/public_html/blog' } }] }],
      rows: [row('a1', 'yazi', [wpEntry('yazi', ilk404('yazi', since)), ftp])],
      replies: { [HOME]: ok, [`${SITE_URL}/yazi/`]: yok, [`${SITE_URL}/blog/yazi.html`]: ok },
    });
    const s = await w.svc.run();
    expect(s).toMatchObject({ retired: 1, movedOut: 0, notified: 1 });
    expect(w.db.get('a1')!.status).toBe('PUBLISHED');
    const n = w.notifications.create.mock.calls[0][0] as any;
    expect(n.title).toBe('“Yazı a1” yazısının bir kopyası sitende artık yayında görünmüyor');
    expect(n.body).toContain('WordPress üzerindeki kopyası sitende artık yayında görünmüyor (adres 404 veriyor)');
    expect(n.body).toContain('diğer yayın hedeflerindeki kopyaları yayında sayılmaya devam ediyor');
    expect(n.body).not.toContain('RanksUp bu yazıyı yayında saymıyor');
  });

  // canli-oncesi-21 madde 3: FTP sayfasinin canonical'i WordPress kopyasiydi; WordPress emekliye
  // ayrilinca site haritasi FTP adresini ilan eder, FTP sayfasi ise 404 veren adresi kanonik bildirir
  it('emekliye ayrilan WordPress adresini canonical bildiren FTP kopyasi "elle guncelleme bekliyor"; kendi adresini bildiren isaretlenmez', async () => {
    const ftpTarget = { id: 'ftp', type: 'FTP', config: { remotePath: '/public_html/blog' } };
    const ftp = (canonicalUrl: string) => ({ targetId: 'ftp', targetType: 'FTP', ok: true, externalUrl: 'ftp://ftp.host/public_html/blog/yazi.html', liveSeenAt: since, contentHash: 'h-yazi', canonicalUrl });
    const w = world({
      sites: [{ id: 's1', url: SITE_URL, userId: 'u1', name: 'S', publishTargets: [wpTarget(), ftpTarget] }],
      rows: [
        row('a1', 'yazi', [wpEntry('yazi', ilk404('yazi', since)), ftp(`${SITE_URL}/yazi/`)]),
        row('a2', 'yazi', [wpEntry('yazi', ilk404('yazi', since)), ftp(`${SITE_URL}/blog/yazi.html`)]),
      ],
      replies: { [HOME]: ok, [`${SITE_URL}/yazi/`]: yok, [`${SITE_URL}/blog/yazi.html`]: ok },
    });
    expect(await w.svc.run()).toMatchObject({ retired: 2, movedOut: 0 });
    expect(advertisedArticleEntry(new URL(SITE_URL), 'yazi', w.db.get('a1')!.publishedTo, new Map([['wp', { type: 'WORDPRESS_REST', config: {} }], ['ftp', { type: 'FTP', config: ftpTarget.config }]]))?.url)
      .toBe(`${SITE_URL}/blog/yazi.html`);
    expect(w.entry('a1', 1)).toMatchObject({ manualUpdatePending: true, manualUpdatePendingSince: T0.toISOString() });
    expect(w.entry('a2', 1)).not.toHaveProperty('manualUpdatePending');
    expect(w.db.get('a1')!.status).toBe('PUBLISHED');
  });

  it('yalniz Markdown ZIP disa aktarimi kalan yazi sitede yayinda sayilmaz: READY_TO_PUBLISH', async () => {
    const zip = { targetId: 'zip', targetType: 'MARKDOWN_ZIP', ok: true, externalUrl: '/srv/exports/yazi.zip' };
    const w = world({
      sites: [{ id: 's1', url: SITE_URL, userId: 'u1', name: 'S', publishTargets: [wpTarget(), { id: 'zip', type: 'MARKDOWN_ZIP', config: {} }] }],
      rows: [row('a1', 'yazi', [wpEntry('yazi', ilk404('yazi', since)), zip])],
      replies: { [HOME]: ok, [`${SITE_URL}/yazi/`]: yok },
    });
    expect(await w.svc.run()).toMatchObject({ retired: 1, movedOut: 1 });
    expect(w.db.get('a1')!.status).toBe('READY_TO_PUBLISH');
    expect((w.notifications.create.mock.calls[0][0] as any).body).toContain('RanksUp bu yazıyı yayında saymıyor');
  });

  it('yeniden yazimi onay bekleyen yazinin (READY_TO_PUBLISH) kopyasi da denetlenir; durum degismez', async () => {
    const w = world({
      rows: [row('a1', 'yazi', [wpEntry('yazi', ilk404('yazi', since))], { status: 'REVIZE_NEEDED' })],
      replies: { [HOME]: ok, [`${SITE_URL}/yazi/`]: yok },
    });
    expect(await w.svc.run()).toMatchObject({ retired: 1, movedOut: 0, notified: 1 });
    expect(w.db.get('a1')!.status).toBe('REVIZE_NEEDED');
    expect(w.entry('a1').missingReason).toBe(LIVENESS_MISSING_REASON);
  });

  it('bir sitede cok yazi dusunce ilk LIVENESS_NOTIFY_PER_SITE tek tek, kalani tek ozet bildirimde', async () => {
    const n = LIVENESS_NOTIFY_PER_SITE + 2;
    const slugs = Array.from({ length: n }, (_, i) => `y${i}`);
    const w = world({
      rows: slugs.map((s, i) => row(`a${i}`, s, [wpEntry(s, ilk404(s, since))])),
      replies: { [HOME]: ok, ...Object.fromEntries(slugs.map((s) => [`${SITE_URL}/${s}/`, yok])) },
    });
    expect(await w.svc.run()).toMatchObject({ retired: n, notified: LIVENESS_NOTIFY_PER_SITE + 1 });
    const last = w.notifications.create.mock.calls.at(-1)![0] as any;
    expect(last.title).toBe('2 yazı daha sitende artık yayında görünmüyor');
    expect(last.link).toBe('/sites/s1/articles');
    expect(last.body).toContain('İş Etkinlikleri sitesinde 2 yazının adresi daha 404 veriyor');
  });

  it('retirementNotice: bos baslik ve uzun baslik', () => {
    expect(retirementNotice({ articleId: 'a', title: '  ', labels: [], otherLiveCopies: false }).body.startsWith('“Adsız yazı” yazısı')).toBe(true);
    const uzun = 'Ç'.repeat(200);
    const n = retirementNotice({ articleId: 'a', title: uzun, labels: ['WordPress'], otherLiveCopies: false });
    expect(n.title.length).toBeLessThan(130);
    expect(n.body).toContain(uzun);
  });
});

describe('tur — guvenli yazim, sinirlar ve hata yalitimi', () => {
  const since = after(-25 * H).toISOString();

  it('yarisan yazim: guncel kayit yeniden okunup karar ona gore verilir; arada yeniden yayinlanan kopya dusmez', async () => {
    const w = world({ rows: [row('a1', 'yazi', [wpEntry('yazi', ilk404('yazi', since))])], replies: { [HOME]: ok, [`${SITE_URL}/yazi/`]: yok } });
    const realUpdate = w.prisma.article.updateMany.getMockImplementation()!;
    // Ilk yazim yarisir: arada yayinci kopyayi yeniden olusturdu (yeni kayit, goneSince yok, denetimden sonra yazildi)
    w.prisma.article.updateMany.mockImplementationOnce(async (args: any) => {
      const r = w.db.get('a1')!;
      r.publishedTo = [wpEntry('yazi', { updatedAt: after(1000).toISOString(), publishedAt: after(1000).toISOString() })];
      r.updatedAt = new Date(r.updatedAt.getTime() + 999);
      return realUpdate({ ...args });
    });
    const s = await w.svc.run();
    expect(s.retired).toBe(0);
    expect(w.db.get('a1')!.status).toBe('PUBLISHED');
    expect(w.entry('a1')).not.toHaveProperty('missingAt');
    expect(w.entry('a1')).not.toHaveProperty('goneSince');
  });

  it('kayit surekli degisiyorsa bu tur yazilmaz (kosulsuz yazim yok)', async () => {
    const w = world({ rows: [row('a1', 'yazi', [wpEntry('yazi', ilk404('yazi', since))])], replies: { [HOME]: ok, [`${SITE_URL}/yazi/`]: yok } });
    w.prisma.article.updateMany.mockImplementation(async () => ({ count: 0 }));
    const s = await w.svc.run();
    expect(s.retired).toBe(0);
    expect(w.prisma.article.updateMany).toHaveBeenCalledTimes(3);
    expect(w.notifications.create).not.toHaveBeenCalled();
  });

  it('site basina adres tavani: fazlasi sonraki gunlere kalir; ayni adres tek istek', async () => {
    const n = LIVENESS_SITE_MAX_CHECKS + 5;
    const slugs = Array.from({ length: n }, (_, i) => `z${i}`);
    const rows = slugs.map((s, i) => row(`a${i}`, s, [wpEntry(s)]));
    // Ayni adresi gosteren ikinci kayit (eski yayincidan kalma yinelenen kayit)
    rows.push(row('dup', 'z0', [wpEntry('z0')]));
    const w = world({ rows, replies: { [HOME]: ok } });
    const s = await w.svc.run();
    expect(s.requests).toBe(LIVENESS_SITE_MAX_CHECKS + 1);
    expect(s.capped).toBe(true);
    const urls = w.fetchText.mock.calls.map((c) => c[0]);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('bir sitenin hatasi turu durdurmaz; bildirim ve llms hatasi yazimi geri almaz', async () => {
    const w = world({
      sites: [
        { id: 's0', url: 'https://bozuk.example', userId: 'u0', name: 'Bozuk', publishTargets: [] },
        { id: 's1', url: SITE_URL, userId: 'u1', name: 'S', publishTargets: [wpTarget()] },
      ],
      rows: [row('a1', 'yazi', [wpEntry('yazi', ilk404('yazi', since))])],
      replies: { [HOME]: ok, [`${SITE_URL}/yazi/`]: yok },
    });
    const realFind = w.prisma.article.findMany.getMockImplementation()!;
    w.prisma.article.findMany.mockImplementation(async (args: any) => {
      if (args.where.siteId === 's0') throw new Error('db koptu');
      return realFind(args);
    });
    w.llmsFull.build.mockRejectedValueOnce(new Error('llms yok'));
    w.notifications.create.mockRejectedValueOnce(new Error('bildirim yok'));
    const s = await w.svc.run();
    expect(s).toMatchObject({ errors: 1, retired: 1, notified: 0 });
    expect(w.db.get('a1')!.status).toBe('READY_TO_PUBLISH');
  });

  it('cron: gunluk kilidi alamayan proses (API ile worker ikisi de tetiklenir) hicbir sey yapmaz; hata cron\'u dusurmez', async () => {
    const w = world({ rows: [], replies: {}, lock: false });
    await w.svc.cron();
    expect((w.prisma.kvStore.create.mock.calls[0] as any)[0].data.key).toMatch(/^cron-lock:published-liveness:\d{4}-\d{2}-\d{2}$/);
    expect(w.prisma.site.findMany).not.toHaveBeenCalled();

    const ok2 = world({ rows: [], replies: {} });
    ok2.prisma.site.findMany.mockRejectedValueOnce(new Error('db yok'));
    await expect(ok2.svc.cron()).resolves.toBeUndefined();
  });

  it('site sorgusu: hesap silme talebi olan kullanici disarida, yalniz okunan yazisi olan siteler, kimlik bilgisi okunmaz', async () => {
    const w = world({ rows: [], replies: {} });
    await w.svc.run();
    const args = (w.prisma.site.findMany.mock.calls[0] as any)[0];
    expect(args.where.user).toEqual({ deletionRequestedAt: null });
    expect(args.where.articles.some.OR).toEqual([
      { status: 'PUBLISHED' },
      { status: { in: ['READY_TO_PUBLISH', 'REVIZE_NEEDED'] }, publishedAt: { not: null } },
    ]);
    expect(JSON.stringify(args.select)).not.toContain('credentials');
  });
});

// ─────────────────────────────────────────────────────────────────────────
//  Inceleme turu (rv18) tekrar uretim testleri: kanit yoklanan ADRESE ve yazim
//  anindaki WordPress DURUMUNA bagli; ?p= baglantisinin ana sayfaya yonlenmesi
//  canli gorulme sayilmaz. Her biri duzeltme olmadan kirilir.
// ─────────────────────────────────────────────────────────────────────────

describe('rv18 F1 — kanit yoklanan adrese bagli (dosya hedefinin klasoru sonradan degisir)', () => {
  const SITE = 'https://ornek.com.tr';
  const ftpKaydi = (over: Record<string, unknown> = {}) => ({
    targetId: 'ftp', targetType: 'FTP', ok: true, externalUrl: 'ftp://ftp.ornek.com.tr/public_html/blog/yazi.html',
    publishedAt: '2026-05-01T08:00:00.000Z', updatedAt: '2026-05-01T08:00:00.000Z', ...over,
  });
  const eskiYazi = (publishedTo: unknown[]) => row('a1', 'yazi', publishedTo, {
    title: 'Kurumsal Web Sitesi Rehberi', publishedAt: new Date('2026-05-01T08:00:00Z'), updatedAt: new Date('2026-05-01T08:00:00Z'),
  });

  it('musteri FTP hedefinin klasorunu degistirince eski adreste yayindaki sayfa emekliye ayrilmaz, "artik yayinda gorunmuyor" bildirimi gitmez', async () => {
    const target: { id: string; type: string; config: unknown } = { id: 'ftp', type: 'FTP', config: { remotePath: '/public_html/blog' } };
    const w = world({
      sites: [{ id: 's1', url: SITE, userId: 'u1', name: 'Örnek', publishTargets: [target] }],
      rows: [eskiYazi([ftpKaydi()])],
      // Dosya yazildigi yerde duruyor; yeni klasorde boyle bir sayfa yok (varsayilan 404)
      replies: { [`${SITE}/`]: ok, [`${SITE}/blog/yazi.html`]: ok },
    });
    await w.svc.run();
    expect(w.entry('a1')).toMatchObject({ liveSeenAt: T0.toISOString(), liveSeenUrl: `${SITE}/blog/yazi.html` });

    // Ayarlar'da yeni yazilar icin klasor degisti; eski dosya yerinde
    target.config = { remotePath: '/public_html/makaleler' };
    w.at(after(24 * H));
    await w.svc.run();
    w.at(after(48 * H));
    const s = await w.svc.run();

    expect(new Set(w.fetchText.mock.calls.map((c) => c[0]))).toEqual(new Set([`${SITE}/`, `${SITE}/blog/yazi.html`]));
    expect(s).toMatchObject({ retired: 0, movedOut: 0, notified: 0 });
    expect(w.db.get('a1')!.status).toBe('PUBLISHED');
    expect(w.entry('a1')).not.toHaveProperty('missingAt');
    expect(w.entry('a1')).not.toHaveProperty('goneSince');
    expect(w.notifications.create).not.toHaveBeenCalled();
    expect(w.llmsFull.build).not.toHaveBeenCalled();
  });

  it('adresi kayitli olmayan eski canli gorulme (liveSeenAt, liveSeenUrl yok) bu adresin 404unu kanitlamaz: once bu adres canli gorulmeli', async () => {
    const w = world({
      sites: [{ id: 's1', url: SITE, userId: 'u1', name: 'Örnek', publishTargets: [{ id: 'ftp', type: 'FTP', config: { remotePath: '/public_html/blog' } }] }],
      rows: [eskiYazi([ftpKaydi({ liveSeenAt: '2026-10-10T02:20:00.000Z' })])],
      replies: { [`${SITE}/`]: ok },
    });
    for (const t of [0, 24, 48]) {
      w.at(after(t * H));
      expect(await w.svc.run()).toMatchObject({ gone: 1, goneMarked: 0, retired: 0 });
    }
    expect(w.prisma.article.updateMany).not.toHaveBeenCalled();
    expect(w.db.get('a1')!.status).toBe('PUBLISHED');
  });

  it('ilk basarisizlik baska bir adres icin (ya da adressiz eski kayitta) kayitliysa sayim yeniden baslar; emekliye ayirma ayni adresin ikinci 404unu bekler', async () => {
    const eski = after(-30 * H).toISOString();
    const w = world({
      rows: [
        row('a1', 'yazi', [wpEntry('yazi', { goneSince: eski, goneUrl: `${SITE_URL}/eski-adres/` })]),
        row('a2', 'adressiz', [wpEntry('adressiz', { goneSince: eski })]),
      ],
      replies: { [HOME]: ok, [`${SITE_URL}/yazi/`]: yok, [`${SITE_URL}/adressiz/`]: yok },
    });
    expect(await w.svc.run()).toMatchObject({ gone: 2, goneMarked: 2, retired: 0, notified: 0 });
    expect(w.entry('a1')).toEqual(wpEntry('yazi', ilk404('yazi', T0.toISOString())));
    expect(w.entry('a2')).toEqual(wpEntry('adressiz', ilk404('adressiz', T0.toISOString())));
    w.at(after(24 * H));
    expect(await w.svc.run()).toMatchObject({ retired: 2 });
  });
});

describe('rv18 F2 — WordPress kopyasinin kanit kosulu yazim anindaki durumdan (hedefin bugunku ayarindan degil)', () => {
  const SITE = 'https://ornek.com.tr';
  const taslakKaydi = (over: Record<string, unknown> = {}) => ({
    targetId: 'wp', targetType: 'WORDPRESS_REST', ok: true, externalId: '42', externalUrl: `${SITE}/?p=42`,
    publishedAt: '2026-09-01T08:00:00.000Z', updatedAt: '2026-09-01T08:00:00.000Z', ...over,
  });

  it('hedef Taslak\'tan Yayında\'ya alinsa da WordPress\'te hic yayina alinmamis taslak emekliye ayrilmaz; yeniden yayin (durum degismez) dongu kurmaz', async () => {
    const target: { id: string; type: string; config: unknown } = { id: 'wp', type: 'WORDPRESS_REST', config: { postStatus: 'draft' } };
    const w = world({
      sites: [{ id: 's1', url: SITE, userId: 'u1', name: 'Örnek', publishTargets: [target] }],
      // Eski kayit: durum kayitli degil (bilinmiyor)
      rows: [row('a1', 'taslak-yazi', [taslakKaydi()], { title: 'Taslak kalan yazı', publishedAt: new Date('2026-09-01T08:00:00Z'), updatedAt: new Date('2026-09-01T08:00:00Z') })],
      // WordPress taslagi: anonim ?p=42 → 404
      replies: { [`${SITE}/`]: ok, [`${SITE}/?p=42`]: yok },
    });
    await w.svc.run();
    w.at(after(24 * H));
    await w.svc.run();

    // Musteri "Yayın durumu"nu "Yayında"ya aldi; eski yazi WordPress'te taslak kaldi
    target.config = { postStatus: 'publish' };
    w.at(after(48 * H));
    await w.svc.run();
    w.at(after(72 * H));
    await w.svc.run();
    expect(w.db.get('a1')!.status).toBe('PUBLISHED');
    expect(w.entry('a1')).not.toHaveProperty('missingAt');
    expect(w.notifications.create).not.toHaveBeenCalled();

    // Musteri yazinin sayfasindan yeniden yayinladi: update() durumu degistirmez, WordPress
    // 'draft' bildirir, yayinci bunu kayda yazar (mergePublishedTo kaydi yenisiyle degistirir)
    const r = w.db.get('a1')!;
    r.publishedTo = [taslakKaydi({ action: 'updated', remoteStatus: 'draft', updatedAt: after(80 * H).toISOString() })];
    r.updatedAt = after(80 * H);
    w.at(after(96 * H));
    await w.svc.run();
    w.at(after(120 * H));
    await w.svc.run();
    expect(w.db.get('a1')!.status).toBe('PUBLISHED');
    expect(w.entry('a1')).not.toHaveProperty('missingAt');
    expect(w.notifications.create).not.toHaveBeenCalled();
    expect(w.prisma.article.updateMany).not.toHaveBeenCalled();
  });

  it('WordPress yaziyi yazim aninda herkese acik bildirdiyse (publish) ?p= adresi dogrudan kanit: hedef sonradan Taslak\'a alinsa da iki 404 ile emekliye ayrilir', async () => {
    const w = world({
      sites: [{ id: 's1', url: SITE, userId: 'u1', name: 'Örnek', publishTargets: [{ id: 'wp', type: 'WORDPRESS_REST', config: { postStatus: 'draft' } }] }],
      rows: [row('a1', 'yazi', [taslakKaydi({ remoteStatus: 'publish' })])],
      replies: { [`${SITE}/`]: ok, [`${SITE}/?p=42`]: yok },
    });
    expect(await w.svc.run()).toMatchObject({ goneMarked: 1 });
    w.at(after(24 * H));
    expect(await w.svc.run()).toMatchObject({ retired: 1, movedOut: 1, notified: 1 });
    // Bilinen "herkese acik" yazi: urun sahibinin genel metni
    expect((w.notifications.create.mock.calls[0][0] as any).body).toBe('“Yazı a1” yazısı sitende artık yayında görünmüyor (adres 404 veriyor). RanksUp bu yazıyı yayında saymıyor; yeniden yayınlamak istersen yazının sayfasından yayınlayabilirsin.');
  });

  it('RanksUp\'in en son taslak olarak yazdigi kopya (bir kez canli gorulmus) dusunce bildirim "WordPress\'te yayina al" der, "yazinin sayfasindan yeniden yayinla" demez', async () => {
    const url = `${SITE_URL}/?p=9`;
    const w = world({
      sites: [{ id: 's1', url: SITE_URL, userId: 'u1', name: 'S', publishTargets: [wpTarget({ postStatus: 'publish' })] }],
      rows: [row('a1', 'taslak', [wpEntry('taslak', {
        externalUrl: url, remoteStatus: 'draft', liveSeenAt: after(-72 * H).toISOString(), liveSeenUrl: url, goneSince: after(-25 * H).toISOString(), goneUrl: url,
      })])],
      replies: { [HOME]: ok, [url]: yok },
    });
    expect(await w.svc.run()).toMatchObject({ retired: 1, movedOut: 1, notified: 1 });
    const n = w.notifications.create.mock.calls[0][0] as any;
    expect(n.title).toBe('“Yazı a1” yazısı sitende artık yayında görünmüyor');
    expect(n.body).toBe(
      '“Yazı a1” yazısı sitende artık yayında görünmüyor (adres 404 veriyor). RanksUp bu yazıyı yayında saymıyor. '
      + 'RanksUp yazıyı WordPress’e en son taslak olarak yazdı ve WordPress’teki yazının durumunu değiştirmez; bu yüzden yazının sayfasından yeniden yayınlamak onu sitende yayına almaz. '
      + 'Yeniden yayında görmek istersen yazıyı WordPress’te yayına al (çöp kutusundaysa önce geri yükle); ardından yazının sayfasından WordPress hedefini seçerek yayınlarsan RanksUp onu yeniden yayında sayar.',
    );
    expect(n.body).not.toContain('yeniden yayınlamak istersen yazının sayfasından yayınlayabilirsin');
  });

  it('retirementNotice / retirementSummaryNotice: herkese acik olmayan WordPress kopyasinda yeniden yayin onerisi yerine WordPress\'te yayina alma', () => {
    const wp = { articleId: 'a', title: 'Ödeme Rehberi', labels: ['WordPress'], otherLiveCopies: true, wordPressNonPublicStatus: 'private' };
    const n = retirementNotice(wp);
    expect(n.title).toBe('“Ödeme Rehberi” yazısının bir kopyası sitende artık yayında görünmüyor');
    expect(n.body).toContain('RanksUp WordPress’teki kopyayı en son özel bir yazı olarak yazdı ve WordPress’teki yazının durumunu değiştirmez');
    expect(n.body).toContain('yazıyı WordPress’te yayına al');
    expect(n.body).not.toContain('seçerek yayınlayabilirsin');
    expect(retirementNotice({ ...wp, otherLiveCopies: false, wordPressNonPublicStatus: 'pending' }).body).toContain('en son onay bekleyen bir yazı olarak yazdı');
    expect(retirementNotice({ ...wp, otherLiveCopies: false, wordPressNonPublicStatus: 'tuhaf' }).body).toContain('en son herkese açık olmayan bir yazı olarak yazdı');
    // Durumu bilinmeyen ya da 'publish' kopya: eski metinler aynen
    const genel = retirementNotice({ articleId: 'a', title: 'Ödeme Rehberi', labels: ['WordPress'], otherLiveCopies: true });
    expect(genel.body).toBe('“Ödeme Rehberi” yazısının WordPress üzerindeki kopyası sitende artık yayında görünmüyor (adres 404 veriyor). RanksUp bu kopyayı yayında saymıyor; yazının diğer yayın hedeflerindeki kopyaları yayında sayılmaya devam ediyor. Bu kopyayı yeniden yayınlamak istersen yazının sayfasından WordPress hedefini seçerek yayınlayabilirsin.');

    const ozetGenel = retirementSummaryNotice('Örnek', [{ articleId: 'b', title: 'B', labels: ['FTP'], otherLiveCopies: false }]);
    expect(ozetGenel.body).not.toContain('WordPress’te yayına al');
    const ozet = retirementSummaryNotice('Örnek', [{ articleId: 'b', title: 'B', labels: ['FTP'], otherLiveCopies: false }, { ...wp, otherLiveCopies: false, wordPressNonPublicStatus: 'draft' }]);
    expect(ozet.body).toContain('herkese açık olmayan (taslak, onay bekleyen ya da özel) bir yazı olarak yazdıklarını yeniden yayınlamak onları sitende yayına almaz: önce WordPress’te yayına al.');
  });
});

describe('rv18 F3 — ?p= baglantisinin ana sayfaya yonlenmesi canli gorulme sayilmaz', () => {
  it('hic yayina alinmamis taslagin ?p= adresi (404\'u ana sayfaya ceviren eklenti) ana sayfaya yonlenince liveSeenAt yazilmaz', async () => {
    const w = world({
      sites: [{ id: 's1', url: SITE_URL, userId: 'u1', name: 'S', publishTargets: [wpTarget({ postStatus: 'draft' })] }],
      rows: [row('a1', 'taslak', [wpEntry('taslak', { externalUrl: `${SITE_URL}/?p=42` })])],
      replies: { [HOME]: ok, [`${SITE_URL}/?p=42`]: { status: 200, url: HOME, redirected: true } },
    });
    expect(await w.svc.run()).toMatchObject({ unknown: 1, live: 0, seen: 0 });
    expect(w.entry('a1')).not.toHaveProperty('liveSeenAt');
    expect(w.prisma.article.updateMany).not.toHaveBeenCalled();
  });

  it('silinmis (yazim aninda herkese acik) ?p= yazisi ana sayfaya yonlenirse belirsiz: ilk 404 kaydi silinmez', async () => {
    const url = `${SITE_URL}/?p=43`;
    const since = after(-30 * H).toISOString();
    const w = world({
      rows: [row('a1', 'silinen', [wpEntry('silinen', { externalUrl: url, remoteStatus: 'publish', goneSince: since, goneUrl: url })])],
      replies: { [HOME]: ok, [url]: { status: 200, url: HOME, redirected: true } },
    });
    expect(await w.svc.run()).toMatchObject({ unknown: 1, cleared: 0 });
    expect(w.entry('a1')).toMatchObject({ goneSince: since, goneUrl: url });
    expect(w.prisma.article.updateMany).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────
//  C1 — ilan edilen adresler ve canlilik takipleri
// ─────────────────────────────────────────────────────────────────────────

describe('C1 madde 2 — ilk canli gorulmeyle ilan edilir olan adres llms-full\'u site icin bir kez yeniden urettirir', () => {
  const taslakSite = (publishTargets = [wpTarget({ postStatus: 'draft' })]) => [{ id: 's1', url: SITE_URL, userId: 'u1', name: 'S', publishTargets }];

  it('durumu bilinmeyen eski duz ?p= kopya ilk kez canli: yeniden uretim (sitemap-ai sonraki uretimde zaten alir); ertesi tur tekrar etmez', async () => {
    const w = world({
      sites: taslakSite(),
      rows: [row('a1', 'taslak', [wpEntry('taslak', { externalUrl: `${SITE_URL}/?p=6` })])],
      replies: { [HOME]: ok, [`${SITE_URL}/?p=6`]: ok },
    });
    expect(await w.svc.run()).toMatchObject({ live: 1, seen: 1, advertised: 1, retired: 0, notified: 0 });
    expect(w.llmsFull.build).toHaveBeenCalledTimes(1);
    expect(w.llmsFull.build).toHaveBeenCalledWith('s1');
    expect(w.notifications.create).not.toHaveBeenCalled();
    w.at(after(24 * H));
    expect(await w.svc.run()).toMatchObject({ live: 1, seen: 0, advertised: 0 });
    expect(w.llmsFull.build).toHaveBeenCalledTimes(1);
  });

  it('RanksUp\'in taslak olarak yazdigi kopya (remoteStatus draft) WordPress\'te yayina alindi: ayni', async () => {
    const w = world({
      sites: taslakSite([wpTarget({ postStatus: 'publish' })]),
      rows: [row('a1', 'yayina-alindi', [wpEntry('yayina-alindi', { remoteStatus: 'draft' })])],
      replies: { [HOME]: ok, [`${SITE_URL}/yayina-alindi/`]: ok },
    });
    expect(await w.svc.run()).toMatchObject({ seen: 1, advertised: 1 });
    expect(w.llmsFull.build).toHaveBeenCalledTimes(1);
  });

  it('ayni sitede iki yeni ilan + bir emeklilik ayni turda: llms-full TEK kez uretilir, bildirim yalniz emeklilik icin', async () => {
    const w = world({
      sites: taslakSite([wpTarget({ postStatus: 'draft' })]),
      rows: [
        row('a1', 't1', [wpEntry('t1', { externalUrl: `${SITE_URL}/?p=6` })]),
        row('a2', 't2', [wpEntry('t2', { externalUrl: `${SITE_URL}/?p=7` })]),
        row('a3', 'silinen', [wpEntry('silinen', { remoteStatus: 'publish', ...ilk404('silinen', after(-25 * H).toISOString()) })]),
      ],
      replies: { [HOME]: ok, [`${SITE_URL}/?p=6`]: ok, [`${SITE_URL}/?p=7`]: ok, [`${SITE_URL}/silinen/`]: yok },
    });
    expect(await w.svc.run()).toMatchObject({ seen: 2, advertised: 2, retired: 1, notified: 1 });
    expect(w.llmsFull.build).toHaveBeenCalledTimes(1);
  });

  it('yeniden uretim hatasi turu durdurmaz: kayit yazilir, sonraki site denetlenir ve onun icin de uretilir', async () => {
    const w = world({
      sites: [
        { id: 's1', url: SITE_URL, userId: 'u1', name: 'S1', publishTargets: [wpTarget({ postStatus: 'draft' })] },
        { id: 's2', url: 'https://ikinci.com.tr', userId: 'u2', name: 'S2', publishTargets: [wpTarget({ postStatus: 'draft' })] },
      ],
      rows: [
        row('a1', 'x', [wpEntry('x', { externalUrl: `${SITE_URL}/?p=6` })]),
        { ...row('b1', 'y', [wpEntry('y', { externalUrl: 'https://ikinci.com.tr/?p=9' })]), siteId: 's2' },
      ],
      replies: { [HOME]: ok, [`${SITE_URL}/?p=6`]: ok, 'https://ikinci.com.tr/': ok, 'https://ikinci.com.tr/?p=9': ok },
    });
    w.llmsFull.build.mockRejectedValueOnce(new Error('llms yok'));
    const s = await w.svc.run();
    expect(s).toMatchObject({ sites: 2, seen: 2, advertised: 2, errors: 0 });
    expect(w.llmsFull.build).toHaveBeenCalledTimes(2);
    expect(w.entry('a1').liveSeenUrl).toBe(`${SITE_URL}/?p=6`);
    expect(w.entry('b1').liveSeenUrl).toBe('https://ikinci.com.tr/?p=9');
  });

  it('ilan edilen adresi degistirmeyen gorulme yeniden urettirmez: dosya hedefi (her zaman ilan edilir) ve once gelen ilan edilmis kopya', async () => {
    const w = world({
      sites: taslakSite([
        wpTarget({ postStatus: 'publish' }),
        { id: 'wp2', type: 'WORDPRESS_REST', config: { postStatus: 'draft' } },
        { id: 'ftp', type: 'FTP', config: { remotePath: '/public_html/blog' } },
      ]),
      rows: [
        row('a1', 'dosya', [{ targetId: 'ftp', targetType: 'FTP', ok: true, externalUrl: 'ftp://ftp.host/public_html/blog/dosya.html' }]),
        row('a2', 'iki-kopya', [wpEntry('iki-kopya'), { ...wpEntry('iki-kopya'), targetId: 'wp2', externalUrl: `${SITE_URL}/?p=8` }]),
      ],
      replies: { [HOME]: ok, [`${SITE_URL}/blog/dosya.html`]: ok, [`${SITE_URL}/iki-kopya/`]: ok, [`${SITE_URL}/?p=8`]: ok },
    });
    expect(await w.svc.run()).toMatchObject({ seen: 2, advertised: 0 });
    expect(w.llmsFull.build).not.toHaveBeenCalled();
  });
});

describe('C1 madde 3 — sorguyu yok sayan onbellegin ana sayfasi canli gorulme sayilmaz', () => {
  const anaSayfa = '<html><head><title>Ana sayfa</title><link rel="canonical" href="https://isgetkinlikleri.com/"></head><body>Ana sayfa</body></html>';

  it('hic yayina alinmamis taslagin ?p= adresine yonlendirmesiz 200 ile ana sayfa: liveSeenAt yazilmaz, ilan edilmez, llms uretilmez', async () => {
    const w = world({
      sites: [{ id: 's1', url: SITE_URL, userId: 'u1', name: 'S', publishTargets: [wpTarget({ postStatus: 'draft' })] }],
      rows: [row('a1', 'taslak', [wpEntry('taslak', { externalUrl: `${SITE_URL}/?p=42` })])],
      replies: { [HOME]: ok, [`${SITE_URL}/?p=42`]: { status: 200, text: anaSayfa } },
    });
    expect(await w.svc.run()).toMatchObject({ unknown: 1, live: 0, seen: 0, advertised: 0 });
    expect(w.entry('a1')).not.toHaveProperty('liveSeenAt');
    expect(w.prisma.article.updateMany).not.toHaveBeenCalled();
    expect(w.llmsFull.build).not.toHaveBeenCalled();
  });

  it('yayindaki ?p= yazisi (kendi adresini kanonik bildirir) eskisi gibi canli gorulur', async () => {
    const url = `${SITE_URL}/?p=42`;
    const w = world({
      sites: [{ id: 's1', url: SITE_URL, userId: 'u1', name: 'S', publishTargets: [wpTarget({ postStatus: 'draft' })] }],
      rows: [row('a1', 'taslak', [wpEntry('taslak', { externalUrl: url })])],
      replies: { [HOME]: { status: 200, text: anaSayfa }, [url]: { status: 200, text: `<html><head><link rel="canonical" href="${url}"></head></html>` } },
    });
    expect(await w.svc.run()).toMatchObject({ sites: 1, live: 1, seen: 1 });
    expect(w.entry('a1').liveSeenUrl).toBe(url);
  });

  it('istek secenekleri: yalniz sorgulu adreste uzun govde; ana sayfa ve guzel kalici baglanti eskisi gibi 32 KB', async () => {
    const w = world({
      sites: [{ id: 's1', url: SITE_URL, userId: 'u1', name: 'S', publishTargets: [wpTarget({ postStatus: 'draft' })] }],
      rows: [row('a1', 'taslak', [wpEntry('taslak', { externalUrl: `${SITE_URL}/?p=42` })]), row('a2', 'guzel', [wpEntry('guzel')])],
      replies: { [HOME]: ok, [`${SITE_URL}/?p=42`]: yok, [`${SITE_URL}/guzel/`]: ok },
    });
    await w.svc.run();
    const secenek = (url: string) => (w.fetchText.mock.calls.find((c) => c[0] === url) as any)?.[1];
    expect(secenek(HOME)).toBe(LIVENESS_FETCH);
    expect(secenek(`${SITE_URL}/guzel/`)).toBe(LIVENESS_FETCH);
    expect(secenek(`${SITE_URL}/?p=42`)).toEqual({ ...LIVENESS_FETCH, maxBytes: QUERY_URL_MAX_BYTES });
  });
});
