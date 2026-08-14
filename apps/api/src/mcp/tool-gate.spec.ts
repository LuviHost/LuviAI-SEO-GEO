import { describe, it, expect } from 'vitest';
import { McpToolsService, type ToolUser } from './mcp-tools.service.js';
import { QuotaService } from '../billing/quota.service.js';
import { CHAT_SKILLS, visibleSkills } from '../chat/chat-skills.js';
import { FEATURE_MIN_PLAN, PLAN_RANK, type PlanFeature, type PlanId } from '../billing/plans.js';

/**
 * Chat/MCP tool kapisinin davranis testi.
 *
 * NEDEN VAR: AXO, icerik firsatlari ve Product Radar uclari controller'da
 * @RequiresPlan ile kilitliyken chat ayni verilere tool'lar uzerinden
 * KILITSIZ eriyordu — Buyume planindaki kullanici kilitli uca hic gitmeden
 * chat'e sorup ayni veriyi alabiliyordu. Bu dosya kapinin iki noktada da
 * (listeleme + cagri) durdugunu ve ADMIN'in muaf kaldigini sabitler.
 * Test dusserse plan kartindaki katmanlama yeniden bos vaat olmus demektir.
 */

/** Yalnizca user.findUniqueOrThrow kullanan sahte Prisma (plan kapisi icin yeterli). */
function fakePrisma(plan: string) {
  return { user: { findUniqueOrThrow: async () => ({ plan }) } } as never;
}

/**
 * Servisi gercek tool tanimlariyla kurar. Handler bagimliliklari null —
 * kapi handler'dan ONCE calistigi icin kilitli tool testlerinde hic
 * dokunulmaz; bu da kapinin gercekten once oldugunun kaniti.
 */
function toolsService(plan: string): McpToolsService {
  const prisma = fakePrisma(plan);
  const quota = new QuotaService(prisma);
  const n = null as never;
  return new McpToolsService(prisma, n, quota, n, n, n, n, n, n, n);
}

const userOf = (plan: string, role = 'USER'): ToolUser => ({ id: 'u1', role, plan });

const ALL_PLANS: PlanId[] = ['trial', 'starter', 'pro', 'agency', 'enterprise'];

/** Kilitlenmesi BEKLENEN tool -> ozellik. Yeni kilit eklenirse buraya da yazilmali. */
/**
 * Kapili araclar — REST ucuyla BIREBIR AYNI olmali.
 *
 * audit.controller.ts'te @RequiresPlan yalnizca EYLEM uclarinda var
 * (POST agent-readiness/run, opportunities/derive, opportunities/:id/generate,
 * product-radar/run); listeleme GET'leri acik. Bu tablo o gercegi yansitir.
 *
 * OKUMA araclarina kapi konursa iki sey bozulur, ikisi de yasandi:
 *  1. Chat panelden daha siki davranir — kullanici veriyi ekranda gorur ama
 *     chat'e sorunca "planina dahil degil" cevabi alir.
 *  2. Haftalik plan cron'u STARTER sitelerde patlar (weekly-plan skill'i iki
 *     okuma aracina bagli).
 * Kapiyi genisletmek isteniyorsa ONCE REST GET ucuna @RequiresPlan konmali.
 */
const EXPECTED_GATES: Record<string, PlanFeature> = {
  run_agent_readiness_scan: 'agentReadiness',
  derive_content_opportunities: 'contentOpportunities',
  generate_article_from_opportunity: 'contentOpportunities',
};

describe('tool kapisi — tanimlar', () => {
  it('kilitli tool seti EXPECTED_GATES ile birebir ayni', () => {
    const actual: Record<string, PlanFeature> = {};
    for (const t of toolsService('TRIAL').list()) {
      if (t.requiresFeature) actual[t.name] = t.requiresFeature;
    }
    expect(actual).toEqual(EXPECTED_GATES);
  });

  it('kapisiz tool\'lar TRIAL dahil her planda goruluyor', () => {
    const all = toolsService('TRIAL').list();
    const open = all.filter((t) => !t.requiresFeature).map((t) => t.name);
    for (const plan of ALL_PLANS) {
      const svc = toolsService(plan.toUpperCase());
      const visible = svc.listForUser(userOf(plan.toUpperCase())).map((t) => t.name);
      for (const name of open) {
        expect(visible, `${plan} planinda ${name} kaybolmus`).toContain(name);
      }
    }
  });
});

describe('tool kapisi — listeleme (a: model olmayan araci gormesin)', () => {
  it('her plan tam olarak hak ettigi tool\'lari goruyor', () => {
    for (const plan of ALL_PLANS) {
      const svc = toolsService(plan.toUpperCase());
      const visible = new Set(svc.listForUser(userOf(plan.toUpperCase())).map((t) => t.name));
      for (const [tool, feature] of Object.entries(EXPECTED_GATES)) {
        const beklenen = PLAN_RANK[plan] >= PLAN_RANK[FEATURE_MIN_PLAN[feature]];
        expect(visible.has(tool), `${plan} / ${tool} (min: ${FEATURE_MIN_PLAN[feature]})`).toBe(beklenen);
      }
    }
  });

  it('Buyume (starter) planinda kilitli tool\'lardan HICBIRI gorunmuyor', () => {
    const svc = toolsService('STARTER');
    const visible = svc.listForUser(userOf('STARTER')).map((t) => t.name);
    for (const tool of Object.keys(EXPECTED_GATES)) {
      expect(visible, `${tool} sizmis`).not.toContain(tool);
    }
    // Ama liste bosalmiyor — acik tool'lar duruyor
    expect(visible.length).toBeGreaterThan(15);
  });

  it('Anthropic ve MCP formatlari ayni suzgeci kullaniyor', () => {
    const svc = toolsService('STARTER');
    const u = userOf('STARTER');
    const anthropic = svc.listForAnthropic(u).map((t) => t.name);
    const mcp = svc.listForMcp(u).map((t) => t.name);
    expect(anthropic).toEqual(mcp);
    expect(anthropic).not.toContain('run_agent_readiness_scan');
  });

  it('ADMIN muaf — TRIAL planiyla bile tum tool\'lari goruyor', () => {
    const svc = toolsService('TRIAL');
    const visible = svc.listForUser(userOf('TRIAL', 'ADMIN')).map((t) => t.name);
    expect(visible.length).toBe(svc.list().length);
    for (const tool of Object.keys(EXPECTED_GATES)) {
      expect(visible).toContain(tool);
    }
  });
});

describe('tool kapisi — cagri (b: eski konusma / dogrudan MCP istegi)', () => {
  it('kilitli tool cagrilinca reddediliyor ve mesaj plan adini iceriyor', async () => {
    const svc = toolsService('STARTER');
    await expect(
      svc.call(userOf('STARTER'), 'run_agent_readiness_scan', { site_id: 's1' }),
    ).rejects.toThrow(/Profesyonel planına dahildir/);
  });

  it('red mesaji tool adini ve yukseltme yolunu soyluyor (ciplak exception degil)', async () => {
    const svc = toolsService('STARTER');
    const err = await svc
      .call(userOf('STARTER'), 'derive_content_opportunities', { site_id: 's1' })
      .then(() => null, (e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toContain('İçerik fırsatları');
    expect(err!.message).toContain('Profesyonel');
    expect(err!.message).toMatch(/yükselt/i);
  });

  it('plani yeten kullanicida kapi gecilir (handler\'a kadar ilerler)', async () => {
    const svc = toolsService('AGENCY');
    // Kapi gecince handler calisir; handler bagimliligi null oldugu icin
    // ORADA patlamasi beklenir — plan hatasi DEGIL. Kapinin acildiginin kaniti.
    const err = await svc
      .call(userOf('AGENCY'), 'run_agent_readiness_scan', { site_id: 's1' })
      .then(() => null, (e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).not.toMatch(/planına dahildir/);
  });

  it('ADMIN muaf — kapi hic devreye girmiyor', async () => {
    const svc = toolsService('TRIAL');
    const tool = svc.list().find((t) => t.name === 'run_agent_readiness_scan')!;
    await expect(svc.assertToolAllowed(userOf('TRIAL', 'ADMIN'), tool)).resolves.toBeUndefined();
  });

  it('kapisiz tool hicbir planda plan hatasi vermiyor', async () => {
    const svc = toolsService('TRIAL');
    const tool = svc.list().find((t) => t.name === 'list_sites')!;
    await expect(svc.assertToolAllowed(userOf('TRIAL'), tool)).resolves.toBeUndefined();
  });
});

describe('chat skill kartlari — plana gore suzme', () => {
  const allToolNames = new Set(toolsService('ENTERPRISE').list().map((t) => t.name));

  it('skill\'lerin requiresTools alanlari gercek tool adlarina isaret ediyor', () => {
    for (const s of CHAT_SKILLS) {
      for (const t of s.requiresTools ?? []) {
        expect(allToolNames, `${s.key} bilinmeyen tool istiyor: ${t}`).toContain(t);
      }
    }
  });

  it('haftalik plan karti HER planda gorunuyor — cron STARTER sitelerde de calismali', () => {
    // Bu test bir regresyonu sabitliyor: weekly-plan skill'i bir ara iki OKUMA
    // aracina bagliydi ve o araclar kilitliydi; sonuc olarak kart STARTER'da
    // gizleniyor ve haftalik plan cron'u STARTER sitelerinde
    // ForbiddenException ile dusuyordu (plan, bildirim, e-posta hic uretilmiyordu).
    for (const plan of ['STARTER', 'PRO', 'AGENCY', 'ENTERPRISE'] as const) {
      const svc = toolsService(plan);
      const allowed = new Set(svc.listForUser(userOf(plan)).map((t) => t.name));
      const keys = visibleSkills(allowed, { hasTrackedApp: true }).map((s) => s.key);
      expect(keys, `${plan} planinda weekly-plan karti kayip`).toContain('weekly-plan');
    }
  });

  it('okuma araclari her planda acik — chat panelden daha siki olmamali', () => {
    const svc = toolsService('STARTER');
    const gorunur = svc.listForUser(userOf('STARTER')).map((t) => t.name);
    for (const t of ['get_agent_readiness', 'list_content_opportunities', 'get_product_radar']) {
      expect(gorunur, `${t} REST'te acikken chat'te kilitli`).toContain(t);
    }
  });

  it('izlenen uygulama yokken ASO karti gizleniyor', () => {
    const svc = toolsService('ENTERPRISE');
    const allowed = new Set(svc.listForUser(userOf('ENTERPRISE')).map((t) => t.name));
    const keys = visibleSkills(allowed, { hasTrackedApp: false }).map((s) => s.key);
    expect(keys).not.toContain('aso-pulse');
    expect(visibleSkills(allowed, { hasTrackedApp: true }).map((s) => s.key)).toContain('aso-pulse');
  });
});
