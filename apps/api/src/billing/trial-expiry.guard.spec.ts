import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TrialExpiryGuard } from './trial-expiry.guard.js';
import { TRIAL_EXPIRED_CODE } from './trial-policy.js';
import { BillingController } from './billing.controller.js';
import { MeController } from '../me/me.controller.js';
import { NotificationsController } from '../notifications/notifications.controller.js';
import { AuthController } from '../auth/auth.controller.js';
import { ArticlesController } from '../articles/articles.controller.js';
import { AuditController } from '../audit/audit.controller.js';
import { VideosController } from '../videos/videos.controller.js';
import { AsaController } from '../aso/asa/asa.controller.js';
import { AnalyticsController } from '../analytics/analytics.controller.js';

/**
 * Suresi dolan deneme SUNUCUDA salt okunur (sahip karari 21.10.2026) — ama YALNIZ satin
 * alma acikken. PayTR test modunda (yonetici disinda kimse odeyemez) kilit yok.
 * Gercek denetleyici siniflari ve metotlari kullanilir: dekorator metadatasi (izin
 * listesi, @AiAction) gercekten okunur.
 */
const EXPIRED = { id: 'u1', role: 'USER', plan: 'TRIAL', subscriptionStatus: 'EXPIRED', trialEndsAt: new Date(Date.now() - 86_400_000) };
const ACTIVE_TRIAL = { ...EXPIRED, subscriptionStatus: 'TRIAL', trialEndsAt: new Date(Date.now() + 5 * 86_400_000) };

function ctx(cls: any, handler: string, method: string, user: unknown): ExecutionContext {
  const fn = cls.prototype[handler];
  if (typeof fn !== 'function') throw new Error(`${cls.name}.${handler} yok`);
  return {
    getType: () => 'http',
    getHandler: () => fn,
    getClass: () => cls,
    switchToHttp: () => ({ getRequest: () => ({ method, user }) }),
  } as unknown as ExecutionContext;
}

function guard(open: boolean) {
  const paytr = { checkoutStatus: vi.fn(async () => ({ open, testMode: !open, message: open ? null : 'test' })) };
  return { g: new TrialExpiryGuard(new Reflector(), paytr as any), paytr };
}

async function outcome(p: Promise<boolean>): Promise<'allow' | string> {
  try { return (await p) ? 'allow' : 'deny'; } catch (e: any) {
    expect(e).toBeInstanceOf(ForbiddenException);
    return e.getResponse().code;
  }
}

// Yapay zeka maliyeti olan eylemler: uretim, olcum/tarama, video
const AI_ACTIONS: Array<[any, string]> = [
  [ArticlesController, 'generate'],
  [ArticlesController, 'triggerNow'],
  [AuditController, 'agentReadinessRun'],
  [VideosController, 'request'],
];

describe('TrialExpiryGuard — satin alma ACIK (canli mod): salt okunur', () => {
  it('yapay zeka eylemleri 403 + code TRIAL_EXPIRED', async () => {
    const { g } = guard(true);
    for (const [cls, h] of AI_ACTIONS) expect(await outcome(g.canActivate(ctx(cls, h, 'POST', EXPIRED))), `${cls.name}.${h}`).toBe(TRIAL_EXPIRED_CODE);
  });

  it('yapay zeka maliyeti olan GET (@AiAction: ASA kampanya onerisi) de 403', async () => {
    const { g } = guard(true);
    expect(await outcome(g.canActivate(ctx(AsaController, 'suggestCampaign', 'GET', EXPIRED)))).toBe(TRIAL_EXPIRED_CODE);
  });

  it('goruntuleme ve disa aktarma (GET) acik: liste, rapor CSV', async () => {
    const { g } = guard(true);
    expect(await outcome(g.canActivate(ctx(ArticlesController, 'list', 'GET', EXPIRED)))).toBe('allow');
    expect(await outcome(g.canActivate(ctx(AnalyticsController, 'reportCsv', 'GET', EXPIRED)))).toBe('allow');
  });

  it('odeme, hesap silme, bildirim, auth: degistirici olsalar da acik (izin listesi)', async () => {
    const { g } = guard(true);
    expect(await outcome(g.canActivate(ctx(BillingController, 'subscribe', 'POST', EXPIRED)))).toBe('allow');
    expect(await outcome(g.canActivate(ctx(MeController, 'deleteAccount', 'POST', EXPIRED)))).toBe('allow');
    expect(await outcome(g.canActivate(ctx(NotificationsController, 'readAll', 'POST', EXPIRED)))).toBe('allow');
    expect(await outcome(g.canActivate(ctx(AuthController, 'welcomeHook', 'POST', EXPIRED)))).toBe('allow');
  });

  it('deneme suruyor, ucretli plan, yonetici ve oturumsuz istek: dokunulmaz (satin alma sorulmaz)', async () => {
    const { g, paytr } = guard(true);
    for (const user of [ACTIVE_TRIAL, { ...EXPIRED, plan: 'PRO', subscriptionStatus: 'ACTIVE' }, { ...EXPIRED, role: 'ADMIN' }, undefined]) {
      expect(await outcome(g.canActivate(ctx(ArticlesController, 'generate', 'POST', user)))).toBe('allow');
    }
    expect(paytr.checkoutStatus).not.toHaveBeenCalled();
  });

  it('bitis gecmis ama gunluk is henuz EXPIRED yazmamis hesap da kilitli', async () => {
    const { g } = guard(true);
    const pending = { ...EXPIRED, subscriptionStatus: 'TRIAL' };
    expect(await outcome(g.canActivate(ctx(ArticlesController, 'generate', 'POST', pending)))).toBe(TRIAL_EXPIRED_CODE);
  });
});

describe('TrialExpiryGuard — satin alma KAPALI (PayTR test modu): sert kilit YOK', () => {
  it('suresi dolan deneme hesabi yapay zeka eylemlerine devam eder (yalniz 2 makale hakki kurali)', async () => {
    const { g, paytr } = guard(false);
    for (const [cls, h] of AI_ACTIONS) expect(await outcome(g.canActivate(ctx(cls, h, 'POST', EXPIRED))), `${cls.name}.${h}`).toBe('allow');
    expect(await outcome(g.canActivate(ctx(AsaController, 'suggestCampaign', 'GET', EXPIRED)))).toBe('allow');
    expect(paytr.checkoutStatus).toHaveBeenCalledWith('u1');
  });
});

describe('kayit: global guard, plan kapisindan sonra', () => {
  it('app.module APP_GUARD sirasi', () => {
    const mod = readFileSync(new URL('../app.module.ts', import.meta.url), 'utf8');
    const plan = mod.indexOf('{ provide: APP_GUARD, useClass: PlanFeatureGuard }');
    const trial = mod.indexOf('{ provide: APP_GUARD, useClass: TrialExpiryGuard }');
    expect(plan).toBeGreaterThan(-1);
    expect(trial).toBeGreaterThan(plan);
  });
});
