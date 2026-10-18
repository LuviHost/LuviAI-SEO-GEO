import { describe, it, expect } from 'vitest';
import {
  buildReadinessLevels, summarizeLevels, accessFromLevels, buildLevel, SCORE_VERSION,
  planCommerceProbes, validateProductFeed, spreadSample, sitemapLocs, pageStructure,
  type ScanContext, type ReadinessCheck,
} from './agent-readiness-checks.js';
import type { Probe } from './axo-fetch.js';

const ORIGIN = 'https://kuafor.com';

function probe(state: Probe['state'], status: number, text = '', opts: { contentType?: string; kind?: string; binary?: boolean } = {}): Probe {
  const unmeasured = state === 'blocked' || state === 'unreachable';
  return {
    url: '', finalUrl: '', state, status, text, contentType: opts.contentType ?? 'text/plain', headers: {}, truncated: false, binary: !!opts.binary,
    block: unmeasured ? { kind: opts.kind ?? 'waf', reason: 'Cloudflare güvenlik duvarı RanksUp tarayıcısını engelledi (HTTP 403).', hint: 'Cloudflare panelinde "RanksUpBot" için izin kuralı ekleyin.', vendor: 'cloudflare', status } : null,
  };
}
const ok = (text: string, contentType = 'text/plain') => probe('ok', 200, text, { contentType });
const missing = () => probe('missing', 404);
const wall = () => probe('blocked', 403, '<title>Attention Required! | Cloudflare</title>', { kind: 'waf' });

const HOME = `<!doctype html><html><head><title>Kuaför</title>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"HairSalon","name":"Kuaför","sameAs":["https://instagram.com/k","https://facebook.com/k"]}</script>
</head><body><a href="/hizmetler">Hizmetler</a><a href="tel:+902165550000">Ara</a></body></html>`;
const ROBOTS = 'User-agent: *\nAllow: /\nSitemap: https://kuafor.com/sitemap.xml\n';
const SPA = '<!doctype html><html><head><title>App</title></head><body><div id="root"></div></body></html>';

type ProbeKey = keyof ScanContext['probes'];

function makeCtx(over: Partial<Record<ProbeKey, Probe | null>> = {}, extra: Partial<ScanContext> = {}): ScanContext {
  return {
    siteUrl: ORIGIN,
    origin: ORIGIN,
    brandName: 'Kuaför',
    niche: 'güzellik salonu',
    llmsFullInDb: null,
    trackedApp: null,
    probes: {
      home: ok(HOME, 'text/html'), homeMd: ok(HOME, 'text/html'), robots: ok(ROBOTS), llms: missing(), llmsFull: missing(),
      catchAll: missing(), authMd: missing(), authMdWk: missing(), openapi: missing(), apiCatalog: missing(), aiCatalog: missing(),
      agentCard: missing(), agentLegacy: missing(), mcpLegacy: missing(), mcpLegacyCard: missing(), aasa: null,
      ...over,
    } as ScanContext['probes'],
    sitemap: {
      found: { url: `${ORIGIN}/sitemap.xml`, kind: 'urlset', source: 'robots', body: '<urlset><url><loc>https://kuafor.com/hizmetler</loc></url></urlset>' },
      tried: [{ url: `${ORIGIN}/sitemap.xml`, probe: ok('<urlset></urlset>', 'application/xml'), source: 'robots' }],
    },
    mcpCards: [],
    a2aCards: [],
    ...extra,
  };
}

const run = (ctx: ScanContext) => {
  const { levels, stance } = buildReadinessLevels(ctx);
  return { levels, stance, summary: summarizeLevels(levels), check: (id: string) => levels.flatMap((l) => l.checks).find((c) => c.id === id) as ReadinessCheck };
};

describe('SCORE_VERSION', () => {
  it('v3', () => expect(SCORE_VERSION).toBe(3));
});

describe('kalibrasyon — API/ajan arayuzu olmayan yerel isletme cezalandirilmaz', () => {
  it('auth.md / API katalogu / A2A / MCP info; payda 16 (v2: 24)', () => {
    const { summary, check } = run(makeCtx());
    for (const id of ['auth-md', 'api-catalog', 'a2a-agent-card', 'mcp-declaration']) {
      expect(check(id).impact, id).toBe('info');
      expect(check(id).state, id).toBe('info');
      expect(check(id).scoreNote, id).toMatch(/arayüz/);
      expect(summary.nextUpToFix.map((n) => n.checkId)).not.toContain(id);
    }
    // L1 12 (robots 3 + sitemap 3 + AI kurallari 3 + content-signal 2 + llms 1) + L2 3 (llms-full 1 + org 2) + L3 1 (markdown)
    expect(summary.scoring.max).toBe(16);
    expect(check('agentic-checkout').impact).toBe('info');
    expect(summary.status).not.toBe('blocked');
  });

  it('API (openapi.json) varsa API katalogu ve auth.md puanlanir; auth.md sablonu yer tutucu tasir, uydurma deger tasimaz', () => {
    const { check } = run(makeCtx({ openapi: ok('{"openapi":"3.1.0","info":{"title":"x"}}', 'application/json') }));
    expect(check('api-catalog')).toMatchObject({ impact: 'medium', ok: true, state: 'pass' });
    const auth = check('auth-md');
    expect(auth).toMatchObject({ impact: 'medium', ok: false, state: 'fail' });
    expect(auth.fixKey).toBeUndefined();
    expect(auth.manualTemplate?.content).toContain('<IDENTITY_ENDPOINT>');
    expect(auth.manualTemplate?.content).not.toMatch(/\/giris|60 istek|e-posta \+ şifre/);
    // A2A / MCP bu kanitla puanlanmaz: farkli protokoller
    expect(check('a2a-agent-card').impact).toBe('info');
    expect(check('mcp-declaration').impact).toBe('info');
  });
});

describe('engel eksik degildir', () => {
  it('robots.txt engelliyse robots kontrolleri blocked, paydadan duser, duzelt dugmesi yok, tarama blocked', () => {
    const { summary, check } = run(makeCtx({ robots: wall() }));
    for (const id of ['robots-txt', 'ai-crawler-rules', 'content-signals']) {
      expect(check(id).state, id).toBe('blocked');
      expect(check(id).fixKey, id).toBeUndefined();
      expect(check(id).blocked?.hint).toMatch(/RanksUpBot/);
    }
    expect(summary.scoring.max).toBe(16 - 8);
    expect(summary.status).toBe('blocked');
    expect(summary.access).toMatchObject({ state: 'blocked', scope: 'robots' });
    expect(summary.nextUpToFix.map((n) => n.checkId)).not.toContain('robots-txt');
  });

  it('ana sayfa engelliyse tarama blocked; ana sayfaya bagli kontroller puana girmez', () => {
    const { summary, check, levels } = run(makeCtx({ home: wall(), homeMd: wall() }));
    expect(summary.status).toBe('blocked');
    expect(summary.access?.scope).toBe('homepage');
    expect(check('homepage-access').state).toBe('blocked');
    expect(check('org-schema').state).toBe('blocked');
    expect(check('markdown-negotiation').state).toBe('blocked');
    expect(accessFromLevels(levels)?.reason).toMatch(/Cloudflare/);
  });

  it('zaman asimi → unreachable (engel degil ama olculemedi)', () => {
    const t = probe('unreachable', 0, '', { kind: 'timeout' });
    const { summary } = run(makeCtx({ home: t, homeMd: t }));
    expect(summary.status).toBe('unreachable');
  });

  it('yalniz llms.txt engelliyse yalniz o kontrol duser; tarama durumu skora gore', () => {
    const { summary, check } = run(makeCtx({ llms: wall() }));
    expect(check('llms-txt').state).toBe('blocked');
    expect(summary.access).toBeNull();
    expect(summary.scoring.max).toBe(15);
  });

  it('buildLevel: blocked kontrol hem max hem earned disinda', () => {
    const c = (id: string, ok: boolean, blocked = false): ReadinessCheck => ({
      id, name: id, ok, impact: 'high', statusText: '', howTo: '', audit: [], fixKey: 'robots_txt',
      ...(blocked ? { blocked: { kind: 'waf', reason: 'r', hint: 'h', status: 403, vendor: null } } : {}),
    });
    const level = buildLevel('x', 'X', [c('a', true), c('b', false, true), c('c', false)], true);
    expect(level).toMatchObject({ max: 6, earned: 3, score: 50, scoredChecks: 2, passedChecks: 1, blockedChecks: 1 });
    expect(level.checks[1].fixKey).toBeUndefined();
  });
});

describe('soft-404 / catch-all', () => {
  it('robots.txt yerine HTML → gecersiz (fail, blocked degil)', () => {
    const { check } = run(makeCtx({ robots: ok(SPA, 'text/html') }));
    expect(check('robots-txt')).toMatchObject({ ok: false, state: 'fail' });
    expect(check('robots-txt').statusText).toMatch(/HTML/);
    expect(check('ai-crawler-rules').ok).toBe(false);
  });

  it('rastgele yolla ayni govde → catch-all, robots yok sayilir', () => {
    const body = 'User-agent: *\nAllow: /';
    const { check } = run(makeCtx({ robots: ok(body), catchAll: ok(body) }));
    expect(check('robots-txt').ok).toBe(false);
    expect(check('robots-txt').statusText).toMatch(/catch-all/);
  });

  it('auth.md / openapi.json / api-catalog SPA HTML donerse var sayilmaz ve arayuz kaniti olmaz', () => {
    const html = ok(SPA, 'text/html');
    const { check } = run(makeCtx({ authMd: html, authMdWk: html, openapi: html, apiCatalog: html, aiCatalog: html, agentCard: html }));
    expect(check('auth-md').ok).toBe(false);
    expect(check('auth-md').statusText).toMatch(/HTML/);
    expect(check('api-catalog').impact).toBe('info');
    expect(check('a2a-agent-card').impact).toBe('info');
  });
});

describe('kimlik grafigi — alt turler', () => {
  it('HairSalon + 2 sameAs gecer', () => {
    const { check } = run(makeCtx());
    expect(check('org-schema')).toMatchObject({ ok: true, state: 'pass' });
    expect(check('org-schema').statusText).toMatch(/HairSalon/);
  });

  it('@graph icindeki Dentist de bulunur', () => {
    const home = `<script type="application/ld+json">{"@graph":[{"@type":"WebSite"},{"@type":["Dentist"],"sameAs":["a","b","c"]}]}</script>`;
    const { check } = run(makeCtx({ home: ok(home, 'text/html') }));
    expect(check('org-schema').statusText).toMatch(/Dentist schema var, 3 sameAs/);
  });
});

describe('llms-full canli siteden', () => {
  it('DB\'de var ama sitede yok → acik metin, gecmez', () => {
    const { check } = run(makeCtx({}, { llmsFullInDb: { at: new Date('2026-10-01') } }));
    expect(check('llms-full')).toMatchObject({ ok: false, impact: 'low' });
    expect(check('llms-full').statusText).toBe('llms-full.txt RanksUp\'ta üretildi ama sitede yayında değil');
  });
  it('sitede yayindaysa gecer', () => {
    const { check } = run(makeCtx({ llmsFull: ok(`# Kuaför\n\n${'Hizmet açıklaması. '.repeat(30)}`) }));
    expect(check('llms-full').ok).toBe(true);
  });
});

describe('MCP (SEP-2127) ve A2A v1.0', () => {
  const card = { $schema: 'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json', name: 'com.kuafor/randevu', version: '1.0.0', description: 'Randevu' };

  it('ai-catalog MCP girdisi + gecerli kart → puanlanan ve gecen kontrol', () => {
    const catalog = ok(JSON.stringify({ specVersion: '1.0', entries: [{ identifier: 'urn:air:kuafor.com:mcp:randevu', type: 'application/mcp-server-card+json', url: `${ORIGIN}/mcp/server-card` }] }), 'application/ai-catalog+json');
    const { check } = run(makeCtx({ aiCatalog: catalog }, {
      mcpCards: [{ identifier: 'urn:air:kuafor.com:mcp:randevu', url: `${ORIGIN}/mcp/server-card`, probe: ok(JSON.stringify(card), 'application/json'), check: { ok: true, errors: [], name: card.name } }],
    }));
    expect(check('mcp-declaration')).toMatchObject({ ok: true, impact: 'low', state: 'pass' });
    // MCP de bir ajan arayuzu → auth.md artik puanlanir
    expect(check('auth-md').impact).toBe('medium');
  });

  it('yalniz eski /.well-known/mcp.json → bilgi notu, gecmez, puanlanmaz', () => {
    const { check } = run(makeCtx({ mcpLegacy: ok('{"servers":[{"url":"https://kuafor.com/mcp"}]}', 'application/json') }));
    expect(check('mcp-declaration')).toMatchObject({ ok: false, impact: 'info' });
    expect(check('mcp-declaration').statusText).toMatch(/eski\/standart dışı/);
  });

  it('RanksUp\'in eski agent.json karti → kaldirma onerisi, puanlanmaz', () => {
    const legacy = { protocolVersion: '0.3.0', name: 'Kuaför', description: 'x', url: ORIGIN, preferredTransport: 'none', capabilities: {}, defaultInputModes: ['text/plain'], defaultOutputModes: ['text/html'], skills: [], generatedBy: 'RanksUp — 2026-08-20' };
    const { check } = run(makeCtx({ agentLegacy: ok(JSON.stringify(legacy), 'application/json') }));
    expect(check('a2a-agent-card')).toMatchObject({ ok: false, impact: 'info' });
    expect(check('a2a-agent-card').statusText).toMatch(/kaldırmanızı öneririz/);
  });

  it('gecerli v1.0 kart agent-card.json\'da → gecer; v0.3 bicimi → eski diye basarisiz', () => {
    const v1 = { name: 'Ajan', description: 'd', version: '1.0.0', supportedInterfaces: [{ url: `${ORIGIN}/a2a`, protocolBinding: 'JSONRPC', protocolVersion: '1.0' }], capabilities: {}, defaultInputModes: ['text/plain'], defaultOutputModes: ['text/plain'], skills: [{ id: 's', name: 'S', description: 'd', tags: ['t'] }] };
    expect(run(makeCtx({ agentCard: ok(JSON.stringify(v1), 'application/json') })).check('a2a-agent-card')).toMatchObject({ ok: true, impact: 'medium' });
    const v03 = { protocolVersion: '0.3.0', name: 'Ajan', description: 'd', url: `${ORIGIN}/a2a`, preferredTransport: 'JSONRPC', capabilities: {}, defaultInputModes: [], defaultOutputModes: [], skills: [] };
    const r = run(makeCtx({ agentCard: ok(JSON.stringify(v03), 'application/json') })).check('a2a-agent-card');
    expect(r).toMatchObject({ ok: false, impact: 'medium', state: 'fail' });
    expect(r.statusText).toMatch(/eski A2A biçiminde/);
  });
});

describe('sitemap kesfi ve isletilebilirlik', () => {
  it('robots.txt\'de bildirilen site haritasi kaynagiyla raporlanir', () => {
    const { check } = run(makeCtx());
    expect(check('sitemap').statusText).toMatch(/robots\.txt'de bildirilmiş/);
  });

  it('site haritasi adaylari engelliyse sitemap kontrolu blocked', () => {
    const { check } = run(makeCtx({}, { sitemap: { found: null, tried: [{ url: `${ORIGIN}/sitemap.xml`, probe: wall(), source: 'standard' }] } }));
    expect(check('sitemap').state).toBe('blocked');
  });

  it('tel: linki bilgi kontrolunde gorunur; puana girmez', () => {
    const { check } = run(makeCtx());
    expect(check('contact-actions')).toMatchObject({ ok: true, impact: 'info', state: 'info' });
  });

  it('Shopify izi ticaret seviyesini acar ama feed YOKLANMADAN "sunuluyor" denmez; agentic-checkout bilgi', () => {
    const shop = `${HOME}<script src="https://cdn.shopify.com/x.js"></script>`;
    const { levels, check, summary } = run(makeCtx({ home: ok(shop, 'text/html') }));
    expect(levels.find((l) => l.id === 'commerce')?.applicable).toBe(true);
    expect(check('product-feed')).toMatchObject({ ok: false, impact: 'info', state: 'info' });
    expect(check('product-feed').statusText).not.toMatch(/sunuluyor/);
    expect(check('product-feed').scoreNote).toMatch(/doğrulayabildiğinde puanlanır/);
    expect(summary.nextUpToFix.map((n) => n.checkId)).not.toContain('product-feed');
    expect(check('agentic-checkout')).toMatchObject({ impact: 'info', state: 'info' });
  });

  it('Shopify /products.json gercekten urun listesi donerse feed puanlanir ve gecer', () => {
    const shop = `${HOME}<script src="https://cdn.shopify.com/x.js"></script>`;
    const feed = ok('{"products":[{"id":1,"title":"Tarak","variants":[{"price":"99.00"}]}]}', 'application/json');
    const { check } = run(makeCtx({ home: ok(shop, 'text/html') }, {
      commerce: { productSitemap: null, productPages: [], feeds: [{ kind: 'shopify', url: `${ORIGIN}/products.json?limit=1`, probe: feed }] },
    }));
    expect(check('product-feed')).toMatchObject({ ok: true, impact: 'medium', state: 'pass' });
    expect(check('product-feed').statusText).toMatch(/Shopify \/products\.json herkese açık ürün listesi/);
  });
});

describe('ticaret seviyesi — olculmeyen sey cezalandirilmaz', () => {
  const WOO_HOME = `<!doctype html><html><head><title>Mağaza</title>
<link rel="stylesheet" href="https://magaza.com/wp-content/plugins/woocommerce/assets/css/woocommerce.css">
<script type="application/ld+json">{"@type":"Organization","name":"Mağaza","sameAs":["https://instagram.com/m","https://facebook.com/m"]}</script>
</head><body class="home woocommerce-no-js"><a href="/urun/tarak">Tarak</a></body></html>`;
  const PRODUCT_PAGE = `<html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Tarak","offers":{"@type":"Offer","price":"99.00","priceCurrency":"TRY","availability":"https://schema.org/InStock"}}</script></head><body>Tarak</body></html>`;
  const BARE_PAGE = '<html><head><title>Tarak</title></head><body>Tarak 99 TL</body></html>';
  const pages = (body: string, n = 3) => Array.from({ length: n }, (_, i) => ({ url: `${ORIGIN}/urun/u${i}`, probe: ok(body, 'text/html') }));
  const wooFeed = (body: string) => ({ kind: 'woocommerce' as const, url: `${ORIGIN}/wp-json/wc/store/v1/products?per_page=1`, probe: ok(body, 'application/json') });

  it('WooCommerce + e-ticaret: ana sayfada Product yok ama urun sayfalarinda var → product-schema gecer; Store API urun donerse feed gecer', () => {
    const { levels, check, summary } = run(makeCtx({ home: ok(WOO_HOME, 'text/html') }, {
      niche: 'e-ticaret',
      commerce: { productSitemap: null, productPages: pages(PRODUCT_PAGE), feeds: [wooFeed('[{"id":12,"name":"Tarak","prices":{"price":"9900"}}]')] },
    }));
    const commerce = levels.find((l) => l.id === 'commerce')!;
    expect(commerce.applicable).toBe(true);
    expect(check('product-schema')).toMatchObject({ ok: true, impact: 'high', state: 'pass' });
    expect(check('product-schema').statusText).toMatch(/3\/3 örneklenen sayfa/);
    expect(check('product-feed')).toMatchObject({ ok: true, impact: 'medium', state: 'pass' });
    expect(commerce).toMatchObject({ score: 100, max: 5 });
    expect(summary.nextUpToFix.map((n) => n.checkId)).not.toContain('product-schema');
  });

  it('urun sayfalari okunup Product + offers bulunamazsa olculmus eksik (fail); feed yoksa info', () => {
    const { check, summary } = run(makeCtx({ home: ok(WOO_HOME, 'text/html') }, {
      niche: 'e-ticaret',
      commerce: { productSitemap: null, productPages: pages(BARE_PAGE, 2), feeds: [] },
    }));
    expect(check('product-schema')).toMatchObject({ ok: false, impact: 'high', state: 'fail' });
    expect(check('product-schema').statusText).toMatch(/Örneklenen 2 ürün sayfasında Product schema/);
    expect(check('product-feed')).toMatchObject({ impact: 'info', state: 'info' });
    expect(summary.nextUpToFix.map((n) => n.checkId)).toContain('product-schema');
  });

  it('urun sayfasi orneklenemezse product-schema info (yalniz ana sayfa kontrol edildi), seviye puansiz', () => {
    const { levels, check, summary } = run(makeCtx({ home: ok(WOO_HOME, 'text/html') }, { niche: 'e-ticaret' }));
    expect(check('product-schema')).toMatchObject({ ok: false, impact: 'info', state: 'info' });
    expect(check('product-schema').statusText).toMatch(/ürün sayfası .*bulunamadı — yalnız ana sayfa kontrol edildi/);
    expect(check('product-schema').scoreNote).toMatch(/puana girmedi/);
    expect(levels.find((l) => l.id === 'commerce')).toMatchObject({ applicable: true, max: 0 });
    expect(summary.nextUpToFix.map((n) => n.checkId)).not.toContain('product-schema');
    // Puansiz seviye skoru dusurmez: kalibrasyon paydasi (16) + groundwork'te org (zaten var)
    expect(summary.scoring.max).toBe(16);
  });

  it('urun sayfalari engelliyse product-schema olculemedi (blocked)', () => {
    const { check } = run(makeCtx({ home: ok(WOO_HOME, 'text/html') }, {
      niche: 'e-ticaret',
      commerce: { productSitemap: null, productPages: [{ url: `${ORIGIN}/urun/a`, probe: wall() }], feeds: [wooFeed('[]')] },
    }));
    expect(check('product-schema').state).toBe('blocked');
    expect(check('product-schema').blocked?.hint).toMatch(/RanksUpBot/);
    // Bos Store API listesi gecerli feed degil
    expect(check('product-feed')).toMatchObject({ ok: false, impact: 'info' });
    expect(check('product-feed').statusText).toMatch(/boş/);
  });

  it('microdata Product + offers da gecer', () => {
    const md = '<html><body><div itemscope itemtype="https://schema.org/Product"><span itemprop="name">Tarak</span><div itemprop="offers" itemscope itemtype="https://schema.org/Offer"><meta itemprop="price" content="99"></div></div></body></html>';
    const { check } = run(makeCtx({ home: ok(WOO_HOME, 'text/html') }, {
      niche: 'e-ticaret',
      commerce: { productSitemap: null, productPages: pages(md, 1), feeds: [] },
    }));
    expect(check('product-schema')).toMatchObject({ ok: true, state: 'pass' });
    expect(check('product-schema').statusText).toMatch(/microdata/);
  });

  it('nis tam kelimeyle eslesir: "dijital marketing" / "photoshop eğitimi" ticaret degil', () => {
    for (const niche of ['dijital marketing', 'photoshop eğitimi', 'market araştırması', 'store yönetimi danışmanlığı']) {
      expect(run(makeCtx({}, { niche })).levels.find((l) => l.id === 'commerce')?.applicable, niche).toBe(false);
    }
    for (const niche of ['e-ticaret', 'E-Ticaret sitesi', 'ecommerce', 'online mağaza']) {
      expect(run(makeCtx({}, { niche })).levels.find((l) => l.id === 'commerce')?.applicable, niche).toBe(true);
    }
  });

  it('fiyatsiz urun katalogu (offers yok) tek basina ticaret seviyesini acmaz', () => {
    const catalog = '<html><head><script type="application/ld+json">{"@type":"Product","name":"Vana"}</script></head></html>';
    const { levels } = run(makeCtx({}, { niche: 'üretim/sanayi', commerce: { productSitemap: null, productPages: pages(catalog, 2), feeds: [] } }));
    expect(levels.find((l) => l.id === 'commerce')?.applicable).toBe(false);
  });
});

describe('planCommerceProbes / feed dogrulama', () => {
  const sitemap = (kind: 'urlset' | 'sitemapindex', locs: string[]): ScanContext['sitemap'] => ({
    found: { url: `${ORIGIN}/sitemap.xml`, kind, source: 'robots', body: `<${kind}>${locs.map((l) => `<${kind === 'urlset' ? 'url' : 'sitemap'}><loc>${l}</loc></${kind === 'urlset' ? 'url' : 'sitemap'}>`).join('')}</${kind}>` },
    tried: [],
  });
  const base = { origin: ORIGIN, siteUrl: ORIGIN, niche: null as string | null, homeHtml: '' };

  it('ipucu yoksa (yerel isletme) hic ek istek planlanmaz', () => {
    const p = planCommerceProbes({ ...base, niche: 'güzellik/bakım', homeHtml: HOME, sitemap: sitemap('urlset', [`${ORIGIN}/hizmetler`]) });
    expect(p).toMatchObject({ hinted: false, shopify: false, woo: false, productSitemap: null, productUrls: [], feedCandidates: [] });
  });

  it('sitemapindex: urun alt haritasi secilir; kategori/etiket haritasi secilmez; baska host yok sayilir', () => {
    const p = planCommerceProbes({ ...base, sitemap: sitemap('sitemapindex', [
      'https://cdn.baska.com/product-sitemap.xml',
      `${ORIGIN}/product_cat-sitemap.xml`,
      `${ORIGIN}/post-sitemap.xml`,
      `${ORIGIN}/product-sitemap.xml`,
    ]) });
    expect(p.productSitemap).toBe(`${ORIGIN}/product-sitemap.xml`);
    expect(p.hinted).toBe(true);
    // Shopify alt haritasi da tanınır (sorgu dizesi dahil, &amp; cozulur)
    const shopify = planCommerceProbes({ ...base, sitemap: sitemap('sitemapindex', [`${ORIGIN}/sitemap_collections_1.xml`, `${ORIGIN}/sitemap_products_1.xml?from=1&amp;to=9`]) });
    expect(shopify.productSitemap).toBe(`${ORIGIN}/sitemap_products_1.xml?from=1&to=9`);
  });

  it('urlset: /urun/, /product/, /p/ yollari aday; listeler ve diger sayfalar degil', () => {
    const p = planCommerceProbes({ ...base, sitemap: sitemap('urlset', [
      `${ORIGIN}/`, `${ORIGIN}/urun/tarak`, `${ORIGIN}/urunler/`, `${ORIGIN}/products/firca`, `${ORIGIN}/p/123`, `${ORIGIN}/blog/yazi`,
    ]) });
    expect(p.productUrls).toEqual([`${ORIGIN}/urun/tarak`, `${ORIGIN}/products/firca`, `${ORIGIN}/p/123`]);
  });

  it('Shopify / WooCommerce izleri ve <link rel="alternate"> Merchant feed\'i', () => {
    const html = '<html><head><script src="https://cdn.shopify.com/s.js"></script><link rel="alternate" type="application/rss+xml" title="Ürün kataloğu" href="/feeds/merchant.xml"><link rel="alternate" type="application/rss+xml" href="/feed/"></head><body class="woocommerce-no-js"></body></html>';
    const p = planCommerceProbes({ ...base, homeHtml: html, sitemap: { found: null, tried: [] } });
    expect(p).toMatchObject({ shopify: true, woo: true, hinted: true });
    expect(p.feedCandidates).toEqual([`${ORIGIN}/feeds/merchant.xml`]);
  });

  it('spreadSample: bas, orta, son', () => {
    expect(spreadSample(['a', 'b', 'c', 'd', 'e'])).toEqual(['a', 'c', 'e']);
    expect(spreadSample(['a', 'a', 'b'])).toEqual(['a', 'b']);
  });

  it('sitemapLocs CDATA ve XML varliklarini cozer', () => {
    expect(sitemapLocs('<url><loc><![CDATA[https://x.com/a?b=1&c=2]]></loc></url><url><loc> https://x.com/d?e=1&amp;f=2 </loc></url><image:loc>https://x.com/i.jpg</image:loc>'))
      .toEqual(['https://x.com/a?b=1&c=2', 'https://x.com/d?e=1&f=2']);
  });

  it('validateProductFeed: yalniz gercek urun listesi gecer', () => {
    const merchant = '<?xml version="1.0"?><rss xmlns:g="http://base.google.com/ns/1.0" version="2.0"><channel><item><g:id>TV_1</g:id><g:price>49.99 TRY</g:price></item></channel></rss>';
    expect(validateProductFeed('merchant', ok(merchant, 'application/rss+xml')).valid).toBe(true);
    expect(validateProductFeed('merchant', ok('<rss version="2.0"><channel><item><title>Blog</title></item></channel></rss>', 'application/rss+xml')).valid).toBe(false);
    expect(validateProductFeed('shopify', ok('{"products":[]}', 'application/json'))).toMatchObject({ valid: false, detail: 'ürün listesi boş döndü' });
    expect(validateProductFeed('shopify', ok(SPA, 'text/html')).valid).toBe(false);
    expect(validateProductFeed('woocommerce', ok('{"code":"rest_no_route"}', 'application/json')).valid).toBe(false);
    expect(validateProductFeed('woocommerce', missing())).toMatchObject({ valid: false, detail: '404 (yok)' });
  });
});

describe('JSON-LD cikarimi — cheerio, tirnaksiz type', () => {
  it('kucultulmus HTML: tirnaksiz type=application/ld+json → org-schema gecer', () => {
    const home = '<!doctype html><html><head><title>K</title><script type=application/ld+json>{"@type":"HairSalon","name":"K","sameAs":["https://instagram.com/k","https://facebook.com/k"]}</script></head><body></body></html>';
    const { check } = run(makeCtx({ home: ok(home, 'text/html') }));
    expect(check('org-schema')).toMatchObject({ ok: true, state: 'pass' });
  });

  it('buyuk harf ve parametreli type da okunur; data-type ya da baska tur okunmaz', () => {
    expect(pageStructure('<script TYPE="Application/LD+JSON; charset=utf-8">{"@type":"Organization"}</script>').nodes.length).toBe(1);
    expect(pageStructure('<script data-type="application/ld+json">{"@type":"Organization"}</script>').nodes.length).toBe(0);
    expect(pageStructure('<script type="application/ld+jsonx">{"@type":"Organization"}</script>').nodes.length).toBe(0);
    expect(pageStructure('<script type=\'application/ld+json\'>{"@graph":[{"@type":"WebSite"},{"@type":"Product","offers":{}}]}</script>').nodes.length).toBe(2);
  });
});

describe('ai-catalog karti engelli — eksik degil, olculemedi', () => {
  const catalog = ok(JSON.stringify({ specVersion: '1.0', entries: [
    { identifier: 'urn:air:kuafor.com:mcp:randevu', type: 'application/mcp-server-card+json', url: `${ORIGIN}/mcp/server-card` },
    { identifier: 'urn:air:kuafor.com:a2a:ajan', type: 'application/a2a-agent-card+json', url: `${ORIGIN}/a2a/card` },
  ] }), 'application/ai-catalog+json');
  // Servis okunamayan kart icin dogrulama yapmaz; bu kontrol nesnesini uretir
  const unread = { ok: false, errors: ['kart okunamadı (403 (erişim engellendi, cloudflare))'] };
  const blockedCtx = () => makeCtx({ aiCatalog: catalog }, {
    mcpCards: [{ identifier: 'urn:air:kuafor.com:mcp:randevu', url: `${ORIGIN}/mcp/server-card`, probe: wall(), check: unread }],
    a2aCards: [{ identifier: 'urn:air:kuafor.com:a2a:ajan', url: `${ORIGIN}/a2a/card`, probe: wall(), check: { ...unread, legacy: false, ranksupGenerated: false } }],
  });

  it('MCP ve A2A kartlari WAF arkasindaysa iki kontrol de blocked; auth.md arayuz kaniti sayilmaz', () => {
    const { check, summary } = run(blockedCtx());
    for (const id of ['mcp-declaration', 'a2a-agent-card']) {
      expect(check(id).state, id).toBe('blocked');
      expect(check(id).blocked?.hint, id).toMatch(/RanksUpBot/);
      expect(check(id).statusText, id).toMatch(/okunamadı/);
      expect(check(id).statusText, id).not.toMatch(/JSON nesnesi değil|geçersiz/);
    }
    const auth = check('auth-md');
    expect(auth).toMatchObject({ impact: 'info', state: 'info' });
    expect(auth.scoreNote).toMatch(/kartı .*okunamadı/);
    expect(auth.manualTemplate?.filename).toBe('auth.md');
    // Kalibrasyon paydasi (16) korunur: hicbir sey olculmeden puan kaybedilmez
    expect(summary.scoring.max).toBe(16);
    expect(summary.nextUpToFix.map((n) => n.checkId)).not.toEqual(expect.arrayContaining(['mcp-declaration', 'a2a-agent-card', 'auth-md']));
  });

  it('karsilastirma: kartlar okunabilip gecersizse fail olarak puanlanir (MCP 1 + A2A 2 + auth.md 2)', () => {
    const bad = ok('{"foo":1}', 'application/json');
    const { check, summary } = run(makeCtx({ aiCatalog: catalog }, {
      mcpCards: [{ identifier: 'm', url: `${ORIGIN}/mcp/server-card`, probe: bad, check: { ok: false, errors: ['$schema eksik'] } }],
      a2aCards: [{ identifier: 'a', url: `${ORIGIN}/a2a/card`, probe: bad, check: { ok: false, errors: ['name eksik'], legacy: false, ranksupGenerated: false } }],
    }));
    expect(check('mcp-declaration').state).toBe('fail');
    expect(check('a2a-agent-card').state).toBe('fail');
    expect(check('auth-md')).toMatchObject({ impact: 'medium', state: 'fail' });
    expect(summary.scoring.max).toBe(16 + 5);
  });

  it('kart adresi 404 → olculmus eksik (fail), "kart okunamadı" metniyle', () => {
    const gone = missing();
    const { check } = run(makeCtx({ aiCatalog: catalog }, {
      mcpCards: [{ identifier: 'm', url: `${ORIGIN}/mcp/server-card`, probe: gone, check: { ok: false, errors: ['kart okunamadı (404 (yok))'] } }],
    }));
    expect(check('mcp-declaration').state).toBe('fail');
    expect(check('mcp-declaration').statusText).toMatch(/kart okunamadı \(404/);
  });
});

describe('Content-Signal rehberi — beyan, engel degil', () => {
  it('howTo ai-train=no secimini Googlebot/Bingbot engeline baglamaz, "ai-train=yes birak" diye yonlendirmez', () => {
    const { check } = run(makeCtx());
    const howTo = check('content-signals').howTo;
    expect(howTo).not.toMatch(/görünürlük öncelikliyse/);
    expect(howTo).not.toMatch(/ai-train=no seçen sitelerde/);
    expect(howTo).toMatch(/beyandır/);
    expect(howTo).toMatch(/hiçbir botu teknik olarak engellemez/);
    expect(howTo).toMatch(/Disallow AI Training/);
    expect(howTo).toMatch(/"Block"/);
  });
});

describe('robots.txt yalniz CR satir sonu — AXO durusu', () => {
  it('"User-agent: * / Disallow: /" (CR) tum botlari engelli gosterir; 27/27 izinli denmez', () => {
    const { stance } = run(makeCtx({ robots: ok('User-agent: *\rDisallow: /\r') }));
    expect(stance!.bots.every((b) => b.effective === 'block')).toBe(true);
  });
});
