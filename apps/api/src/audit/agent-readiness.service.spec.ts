import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Probe } from './axo-fetch.js';

/**
 * AgentReadinessService — kayit, gecmis ve bildirim kurallari (ag sahte).
 *  - engelli tarama "skor dustu" bildirimi uretmez; engel bir kez bildirilir
 *  - dusus yalniz ayni metodoloji surumundeki olculmus taramayla kiyaslanir
 *  - gecmiste engelli taramanin skoru null
 *  - kok dosyalar site adresinin alt yolunda degil ORIGIN kokunde aranir
 */

let homeBlocked = false;
const requested: string[] = [];
/** url → probeUrl'e verilen secenekler */
const optsByUrl = new Map<string, any>();
/** yol+sorgu → sahte yanit (varsayilanlari ezer) */
const routes = new Map<string, { text: string; contentType?: string; blocked?: boolean }>();
const DEFAULT_HOME = '<html><head><title>X</title></head><body>Merhaba</body></html>';
let homeHtml = DEFAULT_HOME;
const WAF_BLOCK = { kind: 'waf', reason: 'Cloudflare güvenlik duvarı RanksUp tarayıcısını engelledi (HTTP 403).', hint: '"RanksUpBot" için izin verin.', vendor: 'cloudflare', status: 403 };

vi.mock('./axo-fetch.js', async (orig) => {
  const actual = await orig<typeof import('./axo-fetch.js')>();
  return {
    ...actual,
    probeUrl: vi.fn(async (url: string, opts: any = {}): Promise<Probe> => {
      requested.push(url);
      optsByUrl.set(url, opts);
      const base = { url, finalUrl: url, headers: {}, truncated: false, binary: false };
      const u = new URL(url);
      const path = u.pathname;
      const isHome = path === '/tr' || path === '/';
      if (homeBlocked && (isHome || path === '/robots.txt')) {
        return { ...base, state: 'blocked', status: 403, text: '', contentType: 'text/html', block: WAF_BLOCK };
      }
      const r = routes.get(`${path}${u.search}`);
      if (r?.blocked) return { ...base, state: 'blocked', status: 403, text: '', contentType: 'text/html', block: WAF_BLOCK };
      if (r) return { ...base, state: 'ok', status: 200, text: r.text, contentType: r.contentType ?? 'text/plain', block: null };
      if (isHome) return { ...base, state: 'ok', status: 200, text: homeHtml, contentType: 'text/html', block: null };
      if (path === '/robots.txt') return { ...base, state: 'ok', status: 200, text: 'User-agent: *\nAllow: /\n', contentType: 'text/plain', block: null };
      return { ...base, state: 'missing', status: 404, text: '', contentType: 'text/html', block: null };
    }),
  };
});

const { AgentReadinessService, readinessForResponse } = await import('./agent-readiness.service.js');

function build(prev: Array<{ status: string; overallScore: number; scoreVersion: number }> = []) {
  const created: any[] = [];
  const prisma = {
    site: { findUniqueOrThrow: vi.fn(async () => ({ id: 's1', userId: 'u1', name: 'X', url: 'https://x.com/tr/', niche: null, trackedApps: [], brain: null, llmsFullTxt: null })) },
    agentReadinessScan: {
      findFirst: vi.fn(async ({ where }: any) => {
        let rows = prev;
        if (where.scoreVersion) rows = rows.filter((r) => r.scoreVersion === where.scoreVersion);
        if (where.status?.notIn) rows = rows.filter((r) => !where.status.notIn.includes(r.status));
        return rows[0] ?? null;
      }),
      create: vi.fn(async ({ data }: any) => { created.push(data); return data; }),
      findMany: vi.fn(async () => [
        { ranAt: new Date('2026-10-01'), overallScore: 70, status: 'mostly_ready', agentsAllowed: 27, agentsTotal: 27, scoreVersion: 2 },
        { ranAt: new Date('2026-10-08'), overallScore: 12, status: 'blocked', agentsAllowed: null, agentsTotal: null, scoreVersion: 3 },
      ]),
    },
  };
  const notifications = { create: vi.fn(async () => ({})) };
  const svc = new AgentReadinessService(prisma as any, notifications as any);
  return { svc, prisma, notifications, created };
}

beforeEach(() => {
  homeBlocked = false;
  requested.length = 0;
  optsByUrl.clear();
  routes.clear();
  homeHtml = DEFAULT_HOME;
});

const checkOf = (r: { levels: Array<{ checks: Array<{ id: string }> }> }, id: string) => r.levels.flatMap((l) => l.checks).find((c) => c.id === id) as any;

describe('readinessForResponse — POST /run yaniti', () => {
  const result = (status: string, overallScore: number) => ({
    overallScore, status, scoreVersion: 3, levels: [], robotsAiStance: null, agentsAllowed: null, agentsTotal: null,
    nextUpToFix: [], ranAt: '2026-10-18T00:00:00.000Z', durationMs: 10, access: null,
    scoring: { earned: 1, max: 4, scoredChecks: 2, blockedChecks: 5 },
  }) as any;

  it('engelli / ulasilamaz taramada overallScore null, measured false; diger alanlar aynen', () => {
    for (const status of ['blocked', 'unreachable']) {
      const r = readinessForResponse(result(status, 25));
      expect(r, status).toMatchObject({ overallScore: null, measured: false, status, scoring: { blockedChecks: 5 } });
    }
  });

  it('olculmus taramada skor aynen, measured true', () => {
    expect(readinessForResponse(result('needs_work', 52))).toMatchObject({ overallScore: 52, measured: true });
  });

  it('engelli tarama: kayit ham skoru tutar, REST yaniti null doner', async () => {
    homeBlocked = true;
    const { svc, created } = build();
    const raw = await svc.scan('s1');
    expect(typeof created[0].overallScore).toBe('number');
    expect(readinessForResponse(raw)).toMatchObject({ overallScore: null, measured: false, status: 'blocked' });
  });
});

describe('AgentReadinessService.collect — kok dosyalar, katalog kartlari, ticaret', () => {
  it('metin kok dosyalari Content-Type\'tan bagimsiz okunur (skipBinary:false)', async () => {
    const { svc } = build();
    await svc.scan('s1');
    for (const u of ['https://x.com/robots.txt', 'https://x.com/llms.txt', 'https://x.com/llms-full.txt', 'https://x.com/auth.md']) {
      expect(optsByUrl.get(u)?.skipBinary, u).toBe(false);
    }
  });

  it('ticaret ipucu olmayan sitede hicbir ticaret istegi atilmaz', async () => {
    const { svc } = build();
    const r = await svc.scan('s1');
    expect(requested.some((u) => /products\.json|wc\/store|urun|product/.test(u))).toBe(false);
    expect(r.levels.find((l) => l.id === 'commerce')?.applicable).toBe(false);
  });

  it('WooCommerce: urun alt haritasindan 3 urun sayfasi orneklenir, Store API yoklanir; ikisi de gecer', async () => {
    homeHtml = '<html><head><title>M</title><link rel="stylesheet" href="https://x.com/wp-content/plugins/woocommerce/assets/css/woocommerce.css"></head><body class="woocommerce-no-js">Mağaza</body></html>';
    routes.set('/robots.txt', { text: 'User-agent: *\nAllow: /\nSitemap: https://x.com/sitemap_index.xml\n' });
    routes.set('/sitemap_index.xml', { text: '<sitemapindex><sitemap><loc>https://x.com/post-sitemap.xml</loc></sitemap><sitemap><loc>https://x.com/product_cat-sitemap.xml</loc></sitemap><sitemap><loc>https://x.com/product-sitemap.xml</loc></sitemap></sitemapindex>', contentType: 'application/xml' });
    const products = ['a', 'b', 'c', 'd', 'e'].map((s) => `https://x.com/urun/${s}`);
    routes.set('/product-sitemap.xml', { text: `<urlset>${products.map((p) => `<url><loc>${p}</loc></url>`).join('')}</urlset>`, contentType: 'application/xml' });
    const productPage = '<html><head><script type="application/ld+json">{"@type":"Product","name":"T","offers":{"price":"10","priceCurrency":"TRY"}}</script></head></html>';
    for (const s of ['a', 'c', 'e']) routes.set(`/urun/${s}`, { text: productPage, contentType: 'text/html' });
    routes.set('/wp-json/wc/store/v1/products?per_page=1', { text: '[{"id":7,"name":"T","prices":{"price":"1000"}}]', contentType: 'application/json' });

    const { svc } = build();
    const r = await svc.scan('s1');
    expect(requested).toContain('https://x.com/product-sitemap.xml');
    expect(requested).not.toContain('https://x.com/product_cat-sitemap.xml');
    expect(requested.filter((u) => u.includes('/urun/'))).toEqual(['https://x.com/urun/a', 'https://x.com/urun/c', 'https://x.com/urun/e']);
    expect(requested).toContain('https://x.com/wp-json/wc/store/v1/products?per_page=1');
    expect(requested.some((u) => u.includes('/products.json'))).toBe(false);
    expect(checkOf(r, 'product-schema')).toMatchObject({ ok: true, state: 'pass' });
    expect(checkOf(r, 'product-feed')).toMatchObject({ ok: true, state: 'pass' });
    expect(r.levels.find((l) => l.id === 'commerce')?.applicable).toBe(true);
  });

  it('ai-catalog\'daki MCP karti WAF arkasinda: kart dogrulanmaz, "kart okunamadı", kontrol blocked', async () => {
    routes.set('/.well-known/ai-catalog.json', {
      text: JSON.stringify({ specVersion: '1.0', entries: [{ identifier: 'urn:air:x.com:mcp:m', type: 'application/mcp-server-card+json', url: 'https://x.com/mcp/server-card' }] }),
      contentType: 'application/json',
    });
    routes.set('/mcp/server-card', { text: '', blocked: true });
    const { svc } = build();
    const r = await svc.scan('s1');
    const mcp = checkOf(r, 'mcp-declaration');
    expect(mcp.state).toBe('blocked');
    expect(mcp.audit.map((s: any) => s.detail).join(' ')).toMatch(/kart okunamadı \(403/);
    expect(mcp.audit.map((s: any) => s.detail).join(' ')).not.toMatch(/JSON nesnesi değil/);
    expect(checkOf(r, 'auth-md').impact).toBe('info');
  });
});

describe('AgentReadinessService.scan', () => {
  it('kok dosyalar origin kokunde aranir, ana sayfa site adresinden okunur; v3 kaydedilir', async () => {
    const { svc, created } = build();
    const r = await svc.scan('s1');
    expect(requested).toContain('https://x.com/robots.txt');
    expect(requested).toContain('https://x.com/.well-known/ai-catalog.json');
    expect(requested).toContain('https://x.com/tr');
    expect(requested).not.toContain('https://x.com/tr/robots.txt');
    expect(created[0].scoreVersion).toBe(3);
    expect(r.scoreVersion).toBe(3);
  });

  it('engelli tarama: status blocked, skor dustu bildirimi YOK, engel bir kez bildirilir', async () => {
    homeBlocked = true;
    const { svc, notifications, created } = build([{ status: 'ready', overallScore: 90, scoreVersion: 3 }]);
    const r = await svc.scan('s1');
    expect(r.status).toBe('blocked');
    expect(r.access).toMatchObject({ state: 'blocked', scope: 'homepage+robots', vendor: 'cloudflare' });
    expect(created[0].status).toBe('blocked');
    expect(notifications.create).toHaveBeenCalledTimes(1);
    expect((notifications.create.mock.calls[0] as any[])[0].title).toMatch(/erişim engellendi/);
  });

  it('engel suruyorsa her hafta yeniden bildirilmez', async () => {
    homeBlocked = true;
    const { svc, notifications } = build([{ status: 'blocked', overallScore: 10, scoreVersion: 3 }]);
    await svc.scan('s1');
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it('v2 → v3 gecisi sahte "skor dustu" bildirimi uretmez', async () => {
    const { svc, notifications } = build([{ status: 'ready', overallScore: 99, scoreVersion: 2 }]);
    await svc.scan('s1');
    expect(notifications.create).not.toHaveBeenCalled();
  });
});

describe('AgentReadinessService.getLatest — REST, MCP ve KPI ile ayni kural', () => {
  const LEVELS = [{
    id: 'l1', title: 'L1', applicable: true, score: 50, earned: 2, max: 4,
    checks: [{
      id: 'homepage-access', name: 'Ana sayfa', ok: false, impact: 'high', state: 'blocked',
      blocked: { kind: 'waf', reason: 'Cloudflare güvenlik duvarı RanksUp tarayıcısını engelledi (HTTP 403).', hint: '"RanksUpBot" için izin verin.', vendor: 'cloudflare', status: 403, scope: 'homepage' },
    }],
  }];
  function withScans(rows: any[]) {
    const prisma = { agentReadinessScan: { findMany: vi.fn(async () => rows) } };
    return new AgentReadinessService(prisma as any, {} as any);
  }
  const scan = (status: string, overallScore: number) => ({
    id: `scan-${status}`, overallScore, status, scoreVersion: 3, levels: status === 'blocked' ? LEVELS : [],
    robotsAiStance: null, agentsAllowed: null, agentsTotal: null, nextUpToFix: [], ranAt: new Date('2026-10-15'), durationMs: 900,
  });

  it('engelli / ulasilamaz taramada overallScore null, measured false; neden access alaninda', async () => {
    for (const status of ['blocked', 'unreachable']) {
      const r: any = await withScans([scan(status, 12)]).getLatest('s1');
      expect(r, status).toMatchObject({ overallScore: null, measured: false, status });
    }
    const blocked: any = await withScans([scan('blocked', 12)]).getLatest('s1');
    expect(blocked.access).toMatchObject({ state: 'blocked', vendor: 'cloudflare' });
  });

  it('olculmus taramada skor aynen doner, measured true', async () => {
    const r: any = await withScans([scan('mostly_ready', 72), scan('ready', 90)]).getLatest('s1');
    expect(r).toMatchObject({ overallScore: 72, measured: true, status: 'mostly_ready', prevScoreVersion: 3 });
  });

  it('hic tarama yoksa null', async () => {
    expect(await withScans([]).getLatest('s1')).toBeNull();
  });
});

describe('AgentReadinessService.history', () => {
  it('engelli taramanin skoru null; her nokta scoreVersion tasir', async () => {
    const { svc } = build();
    const h = await svc.history('s1');
    expect(h).toEqual([
      { date: '2026-10-01', score: 70, status: 'mostly_ready', scoreVersion: 2, agentsAllowed: 27, agentsTotal: 27 },
      { date: '2026-10-08', score: null, status: 'blocked', scoreVersion: 3, agentsAllowed: null, agentsTotal: null },
    ]);
  });
});
