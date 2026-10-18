import { describe, it, expect } from 'vitest';
import { SafeFetchError, type SafeTextResult } from '../common/safe-fetch.js';
import {
  napFromCrawledPages, parseNapHtml, readHomepageNap, readSiteNap, recordSiteNap, resolveSiteNap,
  SITE_NAP_FRESH_MS, siteNapKey, type SiteNapKv, type StoredSiteNap,
} from './site-nap.js';

const LD = (obj: unknown) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;
const SALON_LD = {
  '@type': 'HairSalon',
  name: 'Lavanta Kuaför',
  telephone: '+90 216 555 00 00',
  address: { '@type': 'PostalAddress', streetAddress: 'Moda Cd. 1', addressLocality: 'Kadıköy', addressRegion: 'İstanbul' },
};

function res(url: string, status: number, text: string, headers: Record<string, string> = {}): SafeTextResult {
  return { status, ok: status >= 200 && status < 300, url, redirected: false, contentType: 'text/html', headers, text, truncated: false, binary: false };
}

/** Adres → yanit; istenen adresler kaydedilir */
function fakeFetcher(routes: Record<string, SafeTextResult | Error>) {
  const calls: string[] = [];
  const fetcher = async (url: string): Promise<SafeTextResult> => {
    calls.push(url);
    const r = routes[url];
    if (!r) return res(url, 404, 'yok');
    if (r instanceof Error) throw r;
    return r;
  };
  return { fetcher, calls };
}

function fakeKv(): SiteNapKv & { rows: Map<string, { value: string; expiresAt: Date | null }> } {
  const rows = new Map<string, { value: string; expiresAt: Date | null }>();
  return {
    rows,
    kvStore: {
      async findUnique({ where }) { const r = rows.get(where.key); return r ? { value: r.value } : null; },
      async upsert({ where, create, update }) {
        rows.set(where.key, rows.has(where.key) ? { value: update.value, expiresAt: update.expiresAt } : { value: create.value, expiresAt: create.expiresAt });
        return null;
      },
    },
  };
}

describe('parseNapHtml', () => {
  it('JSON-LD bloklari, tel: baglantilari ve ayni sitedeki iletisim sayfasi', () => {
    const html = `<html><head>${LD(SALON_LD)}<script type="application/ld+json">{bozuk</script></head><body>
      <a href="tel:+902165550000">Ara</a><a href="TEL:0532 111 22 33">Cep</a>
      <a href="/iletisim">İletişim</a><a href="https://baska.com/contact">dış</a><a href="mailto:a@b.com">e</a>
    </body></html>`;
    const p = parseNapHtml(html, 'https://www.lavantakuafor.com/');
    expect(p.jsonLdBlocks).toHaveLength(1);
    expect(p.telHrefs).toEqual(['tel:+902165550000', 'TEL:0532 111 22 33']);
    expect(p.contactLinks).toEqual(['https://www.lavantakuafor.com/iletisim']);
  });
});

describe('napFromCrawledPages — denetim taramasindan', () => {
  it('JSON-LD bulgularini birlestirir; tel: taranmadiysa isaretler', () => {
    const nap = napFromCrawledPages([
      { url: 'https://x.com/', jsonLdBlocks: [SALON_LD] },
      { url: 'https://x.com/hakkimizda', jsonLdBlocks: [SALON_LD] },
      { url: 'https://x.com/blog', jsonLdBlocks: [{ '@type': 'Article' }] },
    ], new Date('2026-10-01T00:00:00Z'));
    expect(nap).toMatchObject({ status: 'ok', origin: 'audit', telScanned: false, phones: ['+902165550000'] });
    expect(nap.addresses).toHaveLength(1);
    expect(nap.pages).toEqual(['https://x.com/', 'https://x.com/hakkimizda']);
  });

  it('tarayici telLinks verince tel: bulgulari birlesir ve kayit "tarandi" isaretlenir', () => {
    const nap = napFromCrawledPages([
      { url: 'https://x.com/', jsonLdBlocks: [SALON_LD], telLinks: ['tel:+902165550000'] },
      { url: 'https://x.com/iletisim', jsonLdBlocks: [], telLinks: ['tel:0532 111 22 33'] },
      { url: 'https://x.com/blog', jsonLdBlocks: [], telLinks: [] },
    ], new Date('2026-10-01T00:00:00Z'));
    expect(nap).toMatchObject({ status: 'ok', telScanned: true, phones: ['+902165550000', '+905321112233'] });
    expect(nap.sources).toEqual(['json-ld', 'tel-link']);
    expect(nap.pages).toEqual(['https://x.com/', 'https://x.com/iletisim']);
  });

  it('bos sonuc nedeni gercekte neye bakildigini soyler', () => {
    const scanned = napFromCrawledPages([{ url: 'https://x.com/', jsonLdBlocks: [], telLinks: [] }]);
    expect(scanned.status).toBe('empty');
    expect(scanned.reason).toContain('tel: bağlantısı');
    const ldOnly = napFromCrawledPages([{ url: 'https://x.com/', jsonLdBlocks: [] }]);
    expect(ldOnly.reason).not.toContain('tel:');
  });
});

describe('readHomepageNap — yalniz sitenin kendi sayfalari', () => {
  it('anasayfada NAP yoksa bagli iletisim sayfasina bakar (en fazla 3 istek)', async () => {
    const { fetcher, calls } = fakeFetcher({
      'https://lavantakuafor.com/robots.txt': res('https://lavantakuafor.com/robots.txt', 200, 'User-agent: *\nDisallow: /admin'),
      'https://lavantakuafor.com/': res('https://lavantakuafor.com/', 200, '<a href="/iletisim">İletişim</a>'),
      'https://lavantakuafor.com/iletisim': res('https://lavantakuafor.com/iletisim', 200, `${LD(SALON_LD)}<a href="tel:+905321112233">c</a>`),
    });
    const nap = await readHomepageNap('https://lavantakuafor.com/', fetcher);
    expect(nap).toMatchObject({ status: 'ok', origin: 'homepage', telScanned: true });
    expect(nap.phones).toEqual(['+902165550000', '+905321112233']);
    expect(nap.sources).toEqual(['json-ld', 'tel-link']);
    expect(calls).toHaveLength(3);
  });

  it('robots.txt RanksUpBot grubunu yasaklarsa sayfa istenmez', async () => {
    const { fetcher, calls } = fakeFetcher({
      'https://x.com/robots.txt': res('https://x.com/robots.txt', 200, 'User-agent: RanksUpBot\nDisallow: /'),
    });
    const nap = await readHomepageNap('https://x.com/', fetcher);
    expect(nap.status).toBe('unavailable');
    expect(nap.reason).toContain('robots.txt');
    expect(calls).toEqual(['https://x.com/robots.txt']);
  });

  it('guvenlik duvari sayfasi icerik sanilmaz; izin yolu soylenir', async () => {
    const { fetcher } = fakeFetcher({
      'https://x.com/': res('https://x.com/', 403, '<title>Attention Required! | Cloudflare</title>Sorry, you have been blocked', { server: 'cloudflare' }),
    });
    const nap = await readHomepageNap('https://x.com/', fetcher);
    expect(nap.status).toBe('unavailable');
    expect(nap.reason).toContain('RanksUpBot');
  });

  it('sikistirmasi cozulemeyen anasayfa: dogru neden (baglanti hatasi denmez)', async () => {
    const { fetcher } = fakeFetcher({ 'https://x.com/': new SafeFetchError('content_encoding', 'Desteklenmeyen icerik kodlamasi: zstd') });
    const nap = await readHomepageNap('https://x.com/', fetcher);
    expect(nap.status).toBe('unavailable');
    expect(nap.reason).toBe('Site yanıtı çözülemedi (desteklenmeyen ya da bozuk sıkıştırma).');
  });

  it('NAP bulunmayan okunabilir site "empty"', async () => {
    const { fetcher } = fakeFetcher({ 'https://x.com/': res('https://x.com/', 200, '<h1>Merhaba</h1>') });
    const nap = await readHomepageNap('https://x.com/', fetcher);
    expect(nap.status).toBe('empty');
    expect(nap.reason).toContain('LocalBusiness');
  });
});

describe('resolveSiteNap — kayit, tazelik, yeniden deneme', () => {
  const site = { id: 's1', url: 'https://x.com/' };
  const okHome = { 'https://x.com/': res('https://x.com/', 200, LD(SALON_LD)) };

  it('taze kayit varsa siteye gidilmez', async () => {
    const kv = fakeKv();
    const now = new Date('2026-10-10T00:00:00Z');
    const first = fakeFetcher(okHome);
    await resolveSiteNap(kv, site, { fetcher: first.fetcher, now });
    const second = fakeFetcher(okHome);
    const nap = await resolveSiteNap(kv, site, { fetcher: second.fetcher, now: new Date(now.getTime() + 3 * 86400_000) });
    expect(nap.status).toBe('ok');
    expect(second.calls).toEqual([]);
    expect(kv.rows.has(siteNapKey('s1'))).toBe(true);
  });

  it('eski kayit yeniden okunur; okuma basarisizsa son bilinen korunur ve bir gun denenmez', async () => {
    const kv = fakeKv();
    const t0 = new Date('2026-09-01T00:00:00Z');
    await resolveSiteNap(kv, site, { fetcher: fakeFetcher(okHome).fetcher, now: t0 });
    const t1 = new Date(t0.getTime() + SITE_NAP_FRESH_MS + 86400_000);
    const failing = fakeFetcher({ 'https://x.com/': new Error('ag yok') });
    const kept = await resolveSiteNap(kv, site, { fetcher: failing.fetcher, now: t1 });
    expect(kept.status).toBe('ok');
    expect(kept.phones).toEqual(['+902165550000']);
    expect(kept.attemptError).toBeTruthy();
    const again = fakeFetcher(okHome);
    await resolveSiteNap(kv, site, { fetcher: again.fetcher, now: new Date(t1.getTime() + 3600_000) });
    expect(again.calls).toEqual([]);
  });

  it('tel: taranmis taze denetim kaydi: olcumde siteye ayrica gidilmez', async () => {
    const kv = fakeKv();
    const now = new Date('2026-10-10T00:00:00Z');
    await recordSiteNap(kv, 's1', napFromCrawledPages([{ url: 'https://x.com/', jsonLdBlocks: [], telLinks: ['tel:0216 555 00 00'] }], now));
    const home = fakeFetcher(okHome);
    const nap = await resolveSiteNap(kv, site, { fetcher: home.fetcher, now: new Date(now.getTime() + 60_000) });
    expect(home.calls).toEqual([]);
    expect(nap).toMatchObject({ status: 'ok', origin: 'audit', telScanned: true, phones: ['+902165550000'] });
  });

  it('tel: taranmis ama telefonsuz denetim kaydi: iletisim sayfasi bir kez okunur, sonra kayittan', async () => {
    const kv = fakeKv();
    const now = new Date('2026-10-10T00:00:00Z');
    // Tarama sinirinda iletisim sayfasi siraya girmemis: yalniz anasayfa (telefonsuz)
    await recordSiteNap(kv, 's1', napFromCrawledPages([{ url: 'https://x.com/', jsonLdBlocks: [], telLinks: [] }], now));
    const routes = {
      'https://x.com/': res('https://x.com/', 200, '<a href="/iletisim">İletişim</a>'),
      'https://x.com/iletisim': res('https://x.com/iletisim', 200, `${LD(SALON_LD)}`),
    };
    const first = fakeFetcher(routes);
    const nap = await resolveSiteNap(kv, site, { fetcher: first.fetcher, now: new Date(now.getTime() + 60_000) });
    expect(nap).toMatchObject({ status: 'ok', phones: ['+902165550000'] });
    expect(first.calls).toEqual(['https://x.com/robots.txt', 'https://x.com/', 'https://x.com/iletisim']);
    const again = fakeFetcher(routes);
    await resolveSiteNap(kv, site, { fetcher: again.fetcher, now: new Date(now.getTime() + 120_000) });
    expect(again.calls).toEqual([]);
  });

  it('denetimden gelen bos kayit (tel: taranmadi) anasayfayla tamamlanir', async () => {
    const kv = fakeKv();
    const now = new Date('2026-10-10T00:00:00Z');
    await recordSiteNap(kv, 's1', napFromCrawledPages([{ url: 'https://x.com/', jsonLdBlocks: [] }], now));
    const home = fakeFetcher({ 'https://x.com/': res('https://x.com/', 200, '<a href="tel:0216 555 00 00">Ara</a>') });
    const nap = await resolveSiteNap(kv, site, { fetcher: home.fetcher, now: new Date(now.getTime() + 60_000) });
    expect(nap.status).toBe('ok');
    expect(nap.phones).toEqual(['+902165550000']);
    expect(nap.telScanned).toBe(true);
    const stored = (await readSiteNap(kv, 's1')) as StoredSiteNap;
    expect(stored.phones).toEqual(['+902165550000']);
  });
});
