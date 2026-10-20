import { describe, it, expect, vi } from 'vitest';

vi.mock('../prisma/prisma.service.js', () => ({ PrismaService: class {} }));
vi.mock('../notifications/notifications.service.js', () => ({ NotificationsService: class {} }));
vi.mock('../audit/llms-full-builder.service.js', () => ({ LlmsFullBuilderService: class {} }));

const { classifyLivenessResponse, siteHomepage, publicUrlFetchOptions, PUBLIC_URL_FETCH, QUERY_URL_MAX_BYTES } = await import('./public-url-probe.js');
const liveness = await import('./published-liveness.service.js');

/**
 * Yayindaki kopyanin herkese acik adresinin siniflandirmasi tek kaynakta
 * (public-url-probe.ts): yayincinin "kimlik 404, adres de 404 mu" sorusu ile gunluk
 * canlilik denetimi ayni yaniti ayni sekilde okumali. Engel / bot dogrulama sayfasi
 * 404 dese de 'gone' DEGILDIR (common/block-detect.ts).
 */

const HOME = 'https://site.com/';
const yanit = (status: number, over: { headers?: Record<string, string>; text?: string; url?: string; redirected?: boolean } = {}) => ({
  status, headers: over.headers ?? {}, text: over.text ?? '', url: over.url ?? 'https://site.com/yazi/', redirected: over.redirected ?? false,
});

const TABLO: Array<[string, ReturnType<typeof yanit>, 'live' | 'gone' | 'unknown']> = [
  ['siradan 404', yanit(404, { text: '<html>Sayfa bulunamadı</html>' }), 'gone'],
  ['410', yanit(410), 'gone'],
  ['formlu 404 (reCAPTCHA engel degil)', yanit(404, { text: '<form><div class="g-recaptcha"></div></form>' }), 'gone'],
  ['404 + cf-mitigated: challenge', yanit(404, { headers: { 'cf-mitigated': 'challenge', server: 'cloudflare' } }), 'unknown'],
  ['404 + Cloudflare JS dogrulamasi (yalniz govde)', yanit(404, { text: '<script>window._cf_chl_opt={}</script>' }), 'unknown'],
  ['404 + DataDome captcha', yanit(404, { text: '<iframe src="https://geo.captcha-delivery.com/captcha/"></iframe>' }), 'unknown'],
  ['200 "Just a moment..." dogrulama sayfasi', yanit(200, { text: '<html><title>Just a moment...</title></html>' }), 'unknown'],
  ['200', yanit(200, { text: '<html>Yazı</html>' }), 'live'],
  ['izlenen yonlendirme sonrasi 200', yanit(200, { url: 'https://site.com/yeni-adres/', redirected: true }), 'live'],
  ['ana sayfaya yonlendirme', yanit(200, { url: HOME, redirected: true }), 'unknown'],
  ['403 Cloudflare engeli', yanit(403, { text: 'Sorry, you have been blocked', headers: { server: 'cloudflare' } }), 'unknown'],
  ['429', yanit(429), 'unknown'],
  ['500', yanit(500), 'unknown'],
  ['503', yanit(503), 'unknown'],
];

describe('classifyLivenessResponse (public-url-probe.ts)', () => {
  it.each(TABLO)('%s', (_ad, res, beklenen) => {
    expect(classifyLivenessResponse(res, { requested: 'https://site.com/yazi/', homepage: HOME })).toBe(beklenen);
  });

  it('canlilik servisinin siniflandirmasiyla birebir ayni karar (tek kural)', () => {
    for (const [ad, res] of TABLO) {
      for (const homepage of [HOME, null]) {
        const opts = { requested: 'https://site.com/yazi/', homepage };
        expect(classifyLivenessResponse(res, opts), `${ad} ${homepage}`).toBe(liveness.classifyLivenessResponse(res, opts));
      }
    }
  });

  it('rv18 F3: WordPress duz baglantisi (?p=42) ana sayfaya yonlenirse unknown — sorgulu adres ana sayfanin kendisi degildir', () => {
    const anaSayfayaYonlendi = yanit(200, { url: HOME, redirected: true, text: '<html>ana sayfa</html>' });
    // Eskiden yalniz yol karsilastiriliyordu: ?p=42 "ana sayfa" sayilip bu yanit 'live' oluyordu
    expect(classifyLivenessResponse(anaSayfayaYonlendi, { requested: 'https://site.com/?p=42', homepage: HOME })).toBe('unknown');
    expect(classifyLivenessResponse(anaSayfayaYonlendi, { requested: 'https://www.site.com/?p=42&preview=true', homepage: HOME })).toBe('unknown');
    expect(classifyLivenessResponse(yanit(200, { url: 'https://site.com/blog/', redirected: true }), { requested: 'https://site.com/blog/?p=42', homepage: 'https://site.com/blog/' })).toBe('unknown');
    // Yonlendirmenin vardigi ana sayfa parametre tasisa da ana sayfadir (eklenti parametre ekleyebilir)
    expect(classifyLivenessResponse(yanit(200, { url: 'https://site.com/?utm_source=404', redirected: true }), { requested: 'https://site.com/?p=42', homepage: HOME })).toBe('unknown');
    // Yayindaki yazi: WordPress ?p=42'yi kalici baglantiya yonlendirir (redirect_canonical): canli
    expect(classifyLivenessResponse(yanit(200, { url: 'https://site.com/yazi/', redirected: true }), { requested: 'https://site.com/?p=42', homepage: HOME })).toBe('live');
    // "Plain" kalici baglanti ayarli sitede yayindaki yazi ?p=42'de yonlenmeden acilir: canli
    expect(classifyLivenessResponse(yanit(200, { url: 'https://site.com/?p=42' }), { requested: 'https://site.com/?p=42', homepage: HOME })).toBe('live');
    // Ana sayfanin kendisi (http → https, www) yonlenince canli kalir
    expect(classifyLivenessResponse(yanit(200, { url: HOME, redirected: true }), { requested: 'http://www.site.com/', homepage: HOME })).toBe('live');
  });

  it('ana sayfa verilmezse yonlendirme kurali uygulanmaz; basliksiz yanit hata vermez', () => {
    expect(classifyLivenessResponse(yanit(200, { url: HOME, redirected: true }))).toBe('live');
    expect(classifyLivenessResponse({ status: 410 } as any)).toBe('gone');
  });

  it('istek secenekleri canlilik denetimininkiyle ayni; ana sayfa adresi canlilik denetiminin bicimi', () => {
    expect(PUBLIC_URL_FETCH).toEqual(liveness.LIVENESS_FETCH);
    expect(siteHomepage(new URL('https://site.com'))).toBe('https://site.com/');
    expect(siteHomepage(new URL('https://www.site.com/blog/?utm=1#x'))).toBe('https://www.site.com/blog/');
  });
});

/**
 * C1 madde 3 — sorguyu yok sayan onbellek / CDN https://site/?p=42 istegine yonlendirmesiz 200 ile
 * ana sayfayi sunar; yanit 'live' okunur ve hic yayina alinmamis taslak canli goruldu sayilirdi.
 * Sorgulu adreste sayfa kanonik adres olarak (link rel=canonical, yoksa og:url) sitenin ana
 * sayfasini bildiriyorsa sonuc 'unknown'. Yayindaki WordPress yazisi ?p=42'de kendi kalici
 * baglantisini bildirir (rel_canonical / wp_get_canonical_url, link-template.php): 'live' kalir.
 */
describe('sorgulu adres: kanonik adres ana sayfa ise belirsiz (sorguyu yok sayan onbellek)', () => {
  const sayfa = (head: string, body = '<p>içerik</p>') => `<!doctype html><html><head><title>x</title>${head}</head><body>${body}</body></html>`;
  const ana = (head: string, url = 'https://site.com/?p=42') => yanit(200, { url, text: sayfa(head) });
  const sinifla = (res: ReturnType<typeof yanit>, requested = 'https://site.com/?p=42', homepage: string | null = HOME) =>
    classifyLivenessResponse(res, { requested, homepage });

  it('CDN ana sayfayi sundu (200, yonlendirme yok, canonical = ana sayfa): unknown', () => {
    expect(sinifla(ana('<link rel="canonical" href="https://site.com/">'))).toBe('unknown');
    // Sema, www ve sondaki egik cizgi yok sayilir; goreli adres son adrese gore cozulur
    expect(sinifla(ana('<link rel="canonical" href="http://www.site.com">'))).toBe('unknown');
    expect(sinifla(ana('<link rel="canonical" href="/">'))).toBe('unknown');
    expect(sinifla(ana('<LINK REL="Canonical" HREF="https://site.com/">'))).toBe('unknown');
    // Kanonik baglanti yoksa og:url
    expect(sinifla(ana('<meta property="og:url" content="https://www.site.com/">'))).toBe('unknown');
    // Ana sayfa verilmese de sitenin kok adresi
    expect(sinifla(ana('<link rel="canonical" href="https://site.com/">'), 'https://site.com/?p=42', null)).toBe('unknown');
  });

  it('yayindaki yazi ("Plain" kalici baglanti, yonlendirmesiz 200): kendi ?p= adresini bildirir — live', () => {
    expect(sinifla(ana('<link rel="canonical" href="https://site.com/?p=42">'))).toBe('live');
    expect(sinifla(ana('<link rel="canonical" href="/?p=42">'))).toBe('live');
    // canonical yazinin kendisi, og:url yanlis yapilandirilmis olsa da canonical oncelikli
    expect(sinifla(ana('<link rel="canonical" href="https://site.com/?p=42"><meta property="og:url" content="https://site.com/">'))).toBe('live');
    // ?p=42 kalici baglantiya yonlenen yayindaki yazi
    expect(sinifla(yanit(200, { url: 'https://site.com/yazi/', redirected: true, text: sayfa('<link rel="canonical" href="https://site.com/yazi/">') }))).toBe('live');
  });

  it('kanonik baglanti yoksa ya da baska bir sayfayi gosteriyorsa eskisi gibi live', () => {
    expect(sinifla(ana(''))).toBe('live');
    expect(sinifla(ana('<link rel="canonical" href="">'))).toBe('live');
    expect(sinifla(ana('<link rel="canonical" href="https://site.com/baska-yazi/">'))).toBe('live');
    // Baska sitenin ana sayfasi bu sitenin ana sayfasi degildir
    expect(sinifla(ana('<link rel="canonical" href="https://baska.com/">'))).toBe('live');
    // Sorgulu kanonik adres ana sayfa sayilmaz
    expect(sinifla(ana('<link rel="canonical" href="https://site.com/?lang=tr">'))).toBe('live');
  });

  it('WordPress alt klasorde: ?p= baglantisinin yolu WordPress\'in ana sayfasidir; kayitli site adresi de ana sayfa', () => {
    const blogAna = yanit(200, { url: 'https://site.com/blog/?p=42', text: sayfa('<link rel="canonical" href="https://site.com/blog/">') });
    expect(sinifla(blogAna, 'https://site.com/blog/?p=42', HOME)).toBe('unknown');
    expect(sinifla(blogAna, 'https://site.com/blog/?p=42', null)).toBe('unknown');
    expect(sinifla(yanit(200, { url: 'https://site.com/blog/?p=42', text: sayfa('<link rel="canonical" href="https://site.com/blog/?p=42">') }), 'https://site.com/blog/?p=42', HOME)).toBe('live');
  });

  it('degismeyenler: sorgusuz adres (guzel kalici baglanti, ana sayfanin kendisi) kanonik adrese bakilmadan okunur', () => {
    const anaSayfaKanonik = sayfa('<link rel="canonical" href="https://site.com/">');
    // Ana sayfanin kendi yoklamasi (canlilik denetimi once ana sayfaya bakar)
    expect(classifyLivenessResponse(yanit(200, { url: HOME, text: anaSayfaKanonik }), { requested: HOME, homepage: null })).toBe('live');
    expect(classifyLivenessResponse(yanit(200, { url: HOME, text: anaSayfaKanonik }), { requested: HOME, homepage: HOME })).toBe('live');
    // Kanonigi yanlis yapilandirilmis guzel kalici baglanti
    expect(sinifla(yanit(200, { url: 'https://site.com/yazi/', text: anaSayfaKanonik }), 'https://site.com/yazi/')).toBe('live');
    // 404 / engel kurallari aynen
    expect(sinifla(yanit(404, { url: 'https://site.com/?p=42', text: anaSayfaKanonik }))).toBe('gone');
    expect(sinifla(yanit(200, { url: 'https://site.com/?p=42', text: '<html><title>Just a moment...</title></html>' }))).toBe('unknown');
  });

  it('uzun govde engel kararini degistirmez: engel denetimi eskisi gibi govdenin yalniz ilk 32 KB\'ina bakar', () => {
    // Yazinin metninde 32 KB'tan sonra gecen dogrulama isareti (or. Cloudflare'i anlatan yazi) engel sayilmaz
    const metin = sayfa('<link rel="canonical" href="https://site.com/?p=42">', `${'<p>Yazı metni.</p>'.repeat(3_000)}<code>window._cf_chl_opt</code>`);
    expect(metin.indexOf('_cf_chl_opt')).toBeGreaterThan(32 * 1024);
    expect(sinifla(yanit(200, { url: 'https://site.com/?p=42', text: metin }))).toBe('live');
    // Govdenin basindaki dogrulama sayfasi yine engel
    expect(sinifla(yanit(200, { url: 'https://site.com/?p=42', text: `<script>window._cf_chl_opt={}</script>${metin}` }))).toBe('unknown');
  });

  it('istek secenekleri: yalniz sorgulu adreste govdenin ilk 256 KB\'i okunur; diger her sey ayni', () => {
    expect(QUERY_URL_MAX_BYTES).toBe(256 * 1024);
    expect(publicUrlFetchOptions('https://site.com/?p=42')).toEqual({ ...PUBLIC_URL_FETCH, maxBytes: 256 * 1024 });
    expect(publicUrlFetchOptions('https://site.com/yazi/')).toBe(PUBLIC_URL_FETCH);
    expect(publicUrlFetchOptions('https://site.com/yazi/?')).toBe(PUBLIC_URL_FETCH);
    expect(publicUrlFetchOptions('bozuk adres')).toBe(PUBLIC_URL_FETCH);
    // Hata govdesi tavani (engel sayfasi tanima) degismez
    expect(publicUrlFetchOptions('https://site.com/?p=42').errorBodyBytes).toBe(PUBLIC_URL_FETCH.errorBodyBytes);
  });
});
