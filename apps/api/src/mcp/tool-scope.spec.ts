import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { ForbiddenException, RequestMethod, type Type } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { Reflector } from '@nestjs/core';
import { McpController } from './mcp.controller.js';
import { McpToolsService, type ToolDef } from './mcp-tools.service.js';
import { ApiKeysService, DEFAULT_SCOPES } from '../api-keys/api-keys.service.js';
import { AuthGuard } from '../auth/auth.guard.js';

/**
 * Arac bazinda scope: API anahtari MCP'den REST ile AYNI kaynak scope'una
 * takilir.
 *
 * NEDEN VAR: eskiden TUM mutating araclar herhangi bir :write ile geciyordu
 * (social:write anahtari audit isi baslatabiliyordu); okuma araclarinda ise
 * hic scope aranmiyordu. AuthGuard /api/mcp'yi yol bazli denetimden muaf
 * tuttugu icin yalniz 'social:read' tasiyan bir anahtar MCP'den makale,
 * denetim ve analitik okuyabiliyor; 'social:write' anahtari run_audit,
 * run_prompt ve create_article ile olcum hakki ve makale kotasi
 * harcayabiliyordu. Ayni anahtar REST'te 403 aliyordu (inceleme R21).
 */
function build(defs?: ToolDef[]) {
  const tools = {
    list: () => defs ?? [
      { name: 'suggest_image_alts', mutating: true, scope: 'audit:write' },
      { name: 'list_image_alt_issues', scope: 'audit:read' },
    ],
    listForMcp: () => [],
    call: vi.fn(async () => ({ ok: true })),
  };
  const quota = { enforcePlanFeature: vi.fn(async () => {}) };
  const paytr = { checkoutStatus: vi.fn(async () => ({ open: true })), hasEverPaid: vi.fn(async () => false) };
  const ctrl = new McpController(tools as any, quota as any, new ApiKeysService(null as any), paytr as any);
  return { ctrl, tools };
}

async function call(ctrl: McpController, name: string, scopes: string[] | null) {
  let payload: any;
  const res: any = { status: () => res, json: (b: any) => { payload = b; return res; }, end: () => res };
  const req: any = { user: { id: 'u1', role: 'USER' }, ...(scopes ? { apiKey: { scopes } } : {}) };
  await ctrl.handle(req, res, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { site_id: 's1' } } } as any);
  return payload.result;
}

describe('MCP arac bazinda scope', () => {
  it('social:write anahtari audit:write gerektiren araci CAGIRAMAZ', async () => {
    const { ctrl, tools } = build();
    const r = await call(ctrl, 'suggest_image_alts', ['social:write']);
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/audit:write/);
    expect(tools.call).not.toHaveBeenCalled();
  });

  it('audit:write anahtari cagirabilir; ayni anahtar audit:read aracini da kapsar', async () => {
    const { ctrl, tools } = build();
    expect((await call(ctrl, 'suggest_image_alts', ['audit:write'])).isError).toBe(false);
    expect((await call(ctrl, 'list_image_alt_issues', ['audit:write'])).isError).toBe(false);
    expect(tools.call).toHaveBeenCalledTimes(2);
  });

  it('salt-okuma anahtari okuma aracini cagirir, mutating araci cagiramaz', async () => {
    const { ctrl } = build();
    expect((await call(ctrl, 'list_image_alt_issues', ['audit:read'])).isError).toBe(false);
    expect((await call(ctrl, 'suggest_image_alts', ['audit:read'])).isError).toBe(true);
  });

  it('oturumla (API anahtarisiz) gelen cagri scope denetimine takilmaz', async () => {
    const { ctrl } = build();
    expect((await call(ctrl, 'suggest_image_alts', null)).isError).toBe(false);
  });
});

/**
 * Her aracin REST ikizi (yontem + global onek dahil yol sablonu). Ikizin
 * AuthGuard'da istedigi scope araca da konur; kaynaga eslesmeyen ikiz
 * (requiredScope null: aksiyon plani, ASO) aracin scope'suz kalmasi
 * demektir ve iki tarafta da ayni kaba kural gecerlidir.
 */
const REST_IKIZI: Record<string, { method: 'GET' | 'POST' | 'PATCH'; path: string }> = {
  list_sites: { method: 'GET', path: '/api/sites' },
  get_site_overview: { method: 'GET', path: '/api/sites/:id' },
  get_audit: { method: 'GET', path: '/api/sites/:siteId/audit/latest' },
  run_audit: { method: 'POST', path: '/api/sites/:siteId/audit/run' },
  list_image_alt_issues: { method: 'GET', path: '/api/sites/:siteId/audit/images' },
  suggest_image_alts: { method: 'POST', path: '/api/sites/:siteId/audit/images/suggest' },
  get_geo_score_card: { method: 'GET', path: '/api/sites/:siteId/audit/score-card' },
  get_agent_readiness: { method: 'GET', path: '/api/sites/:siteId/audit/agent-readiness/latest' },
  run_agent_readiness_scan: { method: 'POST', path: '/api/sites/:siteId/audit/agent-readiness/run' },
  get_ai_kpis: { method: 'GET', path: '/api/sites/:siteId/audit/ai-kpis' },
  list_prompts: { method: 'GET', path: '/api/sites/:siteId/audit/prompts' },
  run_prompt: { method: 'POST', path: '/api/sites/:siteId/audit/prompts/:promptId/run' },
  get_prompt_coverage: { method: 'GET', path: '/api/sites/:siteId/audit/prompts/coverage' },
  get_cited_sources: { method: 'GET', path: '/api/sites/:siteId/audit/cited-sources' },
  list_content_opportunities: { method: 'GET', path: '/api/sites/:siteId/audit/opportunities' },
  derive_content_opportunities: { method: 'POST', path: '/api/sites/:siteId/audit/opportunities/derive' },
  generate_article_from_opportunity: { method: 'POST', path: '/api/sites/:siteId/audit/opportunities/:id/generate' },
  list_articles: { method: 'GET', path: '/api/sites/:siteId/articles' },
  get_article: { method: 'GET', path: '/api/sites/:siteId/articles/:id' },
  create_article: { method: 'POST', path: '/api/sites/:siteId/articles/generate' },
  get_action_plan: { method: 'GET', path: '/api/sites/:siteId/action-plan' },
  add_action_plan_item: { method: 'POST', path: '/api/sites/:siteId/action-plan' },
  update_action_plan_item: { method: 'PATCH', path: '/api/sites/:siteId/action-plan/:id' },
  get_product_radar: { method: 'GET', path: '/api/sites/:siteId/audit/product-radar' },
  get_community_opportunities: { method: 'GET', path: '/api/sites/:siteId/audit/community' },
  get_analytics_summary: { method: 'GET', path: '/api/sites/:siteId/analytics/overview' },
  list_tracked_apps: { method: 'GET', path: '/api/sites/:siteId/aso/apps' },
  get_app_keywords: { method: 'GET', path: '/api/sites/:siteId/aso/apps/:appId' },
  get_app_reviews_summary: { method: 'GET', path: '/api/sites/:siteId/aso/apps/:appId/reviews/stats' },
};

/** Gercek arac tanimlari (handler'lar cagrilmaz; list() yalniz tanimlari kurar) */
const GERCEK = new McpToolsService(...(Array(13).fill(null) as [any, any, any, any, any, any, any, any, any, any, any, any, any])).list();
const keys = new ApiKeysService(null as any);
const somut = (sablon: string) => sablon.replace(/:[A-Za-z]+/g, 'x1');

async function gercekRotalar(): Promise<Set<string>> {
  const { SitesController } = await import('../sites/sites.controller.js');
  const { ArticlesController } = await import('../articles/articles.controller.js');
  const { AuditController } = await import('../audit/audit.controller.js');
  const { ImageAltController } = await import('../audit/image-alt/image-alt.controller.js');
  const { AnalyticsController } = await import('../analytics/analytics.controller.js');
  const { ActionPlansController } = await import('../action-plans/action-plans.controller.js');
  const { AsoController } = await import('../aso/aso.controller.js');
  const out = new Set<string>();
  for (const ctl of [SitesController, ArticlesController, AuditController, ImageAltController, AnalyticsController, ActionPlansController, AsoController] as Type[]) {
    const kok = String(Reflect.getMetadata(PATH_METADATA, ctl));
    for (const ad of Object.getOwnPropertyNames(ctl.prototype)) {
      const handler = (ctl.prototype as Record<string, unknown>)[ad];
      if (typeof handler !== 'function') continue;
      const yol = Reflect.getMetadata(PATH_METADATA, handler);
      if (yol === undefined) continue;
      const yontem = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as number];
      out.add(`${yontem} ${`/api/${kok}/${String(yol)}`.replace(/\/+/g, '/').replace(/\/$/, '')}`);
    }
  }
  return out;
}

describe('MCP arac scope\'lari REST ikiziyle ayni (inceleme R21)', () => {
  it('her aracin bir REST ikizi var ve ikiz GERCEK bir controller rotasi (yeni arac eslenmeden eklenemez)', async () => {
    expect(GERCEK.map((t) => t.name).sort()).toEqual(Object.keys(REST_IKIZI).sort());
    const rotalar = await gercekRotalar();
    for (const [ad, ikiz] of Object.entries(REST_IKIZI)) {
      expect(rotalar.has(`${ikiz.method} ${ikiz.path}`), `${ad}: ${ikiz.method} ${ikiz.path}`).toBe(true);
    }
  });

  it.each(Object.entries(REST_IKIZI))('%s: scope = AuthGuard\'in REST ikizi icin istedigi scope', (ad, ikiz) => {
    const tool = GERCEK.find((t) => t.name === ad)!;
    const gereken = keys.requiredScope(ikiz.method, somut(ikiz.path));
    expect(tool.scope ?? null).toBe(gereken);
    // Yazma ikizi olan arac mutating, okuma ikizi olan degil (kaba kural ayni tarafa dussun)
    expect(!!tool.mutating, ad).toBe(ikiz.method !== 'GET');
  });

  it('karar matrisi: her arac x her anahtar icin MCP kabul/ret = gercek AuthGuard\'in REST ikizindeki karari', async () => {
    const anahtarlar: string[][] = [
      ['social:read'], ['social:write'], ['articles:read'], ['articles:write'], ['audit:read'], ['audit:write'],
      ['sites:read'], ['sites:write'], ['analytics:read'], ['ads:write'], [...DEFAULT_SCOPES], ['*'],
    ];
    const { ctrl, tools } = build(GERCEK);
    let denenen = 0;
    for (const scopes of anahtarlar) {
      const realKeys = new ApiKeysService({} as never);
      const guard = new AuthGuard(
        // REST API anahtari Kurumsal planda (auth.guard apiAccess) — kapinin kendisi api-key-plan.spec'te
        { user: { findUnique: vi.fn(async () => ({ id: 'u1', deletionRequestedAt: null, plan: 'ENTERPRISE' })) } } as any,
        new Reflector(),
        { validate: vi.fn(async () => ({ userId: 'u1', scopes, keyId: 'k1' })), requiredScope: realKeys.requiredScope.bind(realKeys), hasScopeForRoute: realKeys.hasScopeForRoute.bind(realKeys) } as any,
      );
      for (const [ad, ikiz] of Object.entries(REST_IKIZI)) {
        const req: any = { method: ikiz.method, path: somut(ikiz.path), headers: { authorization: 'Bearer luvi_test' } };
        const ctx: any = { getHandler: () => function ikizHandler() {}, getClass: () => class Ikiz {}, switchToHttp: () => ({ getRequest: () => req }) };
        const rest = await guard.canActivate(ctx).then(() => true, (e) => {
          if (e instanceof ForbiddenException) return false;
          throw e;
        });
        tools.call.mockClear();
        const mcp = await call(ctrl, ad, scopes);
        expect(mcp.isError, `${ad} [${scopes.join(',')}] REST=${rest}`).toBe(!rest);
        expect(tools.call, `${ad} [${scopes.join(',')}]`).toHaveBeenCalledTimes(rest ? 1 : 0);
        denenen++;
      }
    }
    expect(denenen).toBe(12 * Object.keys(REST_IKIZI).length);
  });

  it('inceleme ornekleri: social anahtari makale/denetim araclarina ulasamaz; mesaj eksik yetkiyi Turkce soyler', async () => {
    const { ctrl, tools } = build(GERCEK);
    const okuma = await call(ctrl, 'get_article', ['social:read']);
    expect(okuma.isError).toBe(true);
    expect(okuma.content[0].text).toBe('Hata: bu API anahtarında "articles:read" yetkisi yok. Bu aracı kullanmak için anahtarı bu yetkiyle yeniden üret.');
    for (const [ad, scope] of [['create_article', 'articles:write'], ['run_audit', 'audit:write'], ['run_prompt', 'audit:write'], ['generate_article_from_opportunity', 'audit:write']]) {
      const r = await call(ctrl, ad, ['social:write']);
      expect(r.isError, ad).toBe(true);
      expect(r.content[0].text, ad).toContain(`"${scope}"`);
    }
    expect(tools.call).not.toHaveBeenCalled();
    // Kaynaga eslesmeyen mutating arac: REST gibi herhangi bir :write yeter, salt-okuma anahtari ret
    expect((await call(ctrl, 'add_action_plan_item', ['social:write'])).isError).toBe(false);
    const salt = await call(ctrl, 'add_action_plan_item', ['social:read']);
    expect(salt.isError).toBe(true);
    expect(salt.content[0].text).toBe('Hata: bu API anahtarı salt okunur; add_action_plan_item için en az bir yazma (:write) yetkisi olan anahtar gerekli.');
  });

  it('oturum (sohbet / panel) cagrilari degismedi: anahtarsiz her arac denetimsiz gecer', async () => {
    const { ctrl, tools } = build(GERCEK);
    for (const t of GERCEK) expect((await call(ctrl, t.name, null)).isError, t.name).toBe(false);
    expect(tools.call).toHaveBeenCalledTimes(GERCEK.length);
  });
});
