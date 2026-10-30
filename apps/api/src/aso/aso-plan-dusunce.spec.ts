import { describe, it, expect, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PLAN_FEATURE_KEY } from '../billing/plan-feature.decorator.js';
import { PlanFeatureGuard } from '../billing/plan-feature.guard.js';
import { QuotaService } from '../billing/quota.service.js';
import { AsaController } from './asa/asa.controller.js';
import { AsaService } from './asa/asa.service.js';
import { AsaCronService } from './asa/asa.cron.js';
import { AscController } from './asc/asc.controller.js';
import { AscService } from './asc/asc.service.js';

vi.mock('../common/cron-lock.js', () => ({ acquireCronLock: vi.fn(async () => true) }));

/**
 * ASA / ASC plan kapisi PLAN DUSUNCE DE tutar — yalniz baglarken degil.
 *
 * NEDEN VAR: kapi yalniz connect uclarindaydi. Profesyonel'de Apple Search
 * Ads / App Store Connect baglayip sonra (odeme yok, iptal) denemeye dusen
 * kullanici kampanya acmaya, teklif degistirmeye, otopilotu calistirmaya,
 * senkron ve canli yorum okumaya devam ediyordu; gunluk cron'lar da sahibin
 * planina bakmadan musterinin reklam hesabinda otopilot calistiriyordu.
 */

type Handler = { cls: any; handler: string };
const featureOf = ({ cls, handler }: Handler) => Reflect.getMetadata(PLAN_FEATURE_KEY, cls.prototype[handler]);

const ASA_GATED = ['connect', 'syncCampaigns', 'createCampaign', 'updateBid', 'runAutoPilotNow', 'searchTermPopularity', 'impressionShare'];
// Kayitli verinin okunmasi + baglantiyi kesme: plani dusen kullanici gecmisini gorup cikabilmeli
const ASA_OPEN = ['listAccounts', 'disconnect', 'listCampaigns', 'suggestCampaign', 'performance'];
const ASC_GATED = ['connect', 'syncApps', 'syncReleases', 'reviews', 'draftReply', 'replyReview'];
const ASC_OPEN = ['listAccounts', 'disconnect', 'alerts', 'ackAlert'];

describe('ASA/ASC rota kapilari', () => {
  it('Apple hesabina yazan / canli okuyan her ASA ucu asaEnabled ister', () => {
    for (const h of ASA_GATED) expect(featureOf({ cls: AsaController, handler: h }), h).toBe('asaEnabled');
    for (const h of ASA_OPEN) expect(featureOf({ cls: AsaController, handler: h }), h).toBeUndefined();
  });

  it('App Store Connect: senkron, surum senkronu ve canli yorumlar ascEnabled ister', () => {
    for (const h of ASC_GATED) expect(featureOf({ cls: AscController, handler: h }), h).toBe('ascEnabled');
    for (const h of ASC_OPEN) expect(featureOf({ cls: AscController, handler: h }), h).toBeUndefined();
  });

  it('guard: TRIAL\'a dusen kullanici 403, Profesyonel ve ADMIN gecer', () => {
    const guard = new PlanFeatureGuard(new Reflector(), new QuotaService(null as never));
    const ctx = (handler: string, user: any) => ({
      getHandler: () => (AsaController.prototype as any)[handler],
      getClass: () => AsaController,
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as any;
    for (const h of ['syncCampaigns', 'createCampaign', 'updateBid', 'runAutoPilotNow']) {
      expect(() => guard.canActivate(ctx(h, { id: 'u1', plan: 'TRIAL', role: 'USER' })), h).toThrow(ForbiddenException);
      expect(guard.canActivate(ctx(h, { id: 'u1', plan: 'PRO', role: 'USER' })), h).toBe(true);
      expect(guard.canActivate(ctx(h, { id: 'u1', plan: 'TRIAL', role: 'ADMIN' })), h).toBe(true);
    }
  });
});

describe('ASA otopilot ac/kapa — kapatmak plan istemez', () => {
  const kur = () => {
    const asa = { setAutoPilot: vi.fn(async () => ({ ok: true })) };
    const ctrl = new AsaController(asa as any, new QuotaService(null as never));
    return { ctrl, asa };
  };
  const req = (plan: string, role = 'USER') => ({ user: { id: 'u1', plan, role } }) as any;

  it('alt planda ACMA 403, servis cagrilmaz', () => {
    const { ctrl, asa } = kur();
    expect(() => ctrl.setAutoPilot(req('TRIAL'), 'acc1', { enabled: true } as any)).toThrow(/Apple Search Ads Profesyonel/);
    expect(asa.setAutoPilot).not.toHaveBeenCalled();
  });

  it('alt planda KAPATMA serbest — reklam otomasyonunu kullanici kendisi durdurabilmeli', async () => {
    const { ctrl, asa } = kur();
    await ctrl.setAutoPilot(req('TRIAL'), 'acc1', { enabled: false } as any);
    expect(asa.setAutoPilot).toHaveBeenCalledWith('acc1', { enabled: false }, expect.objectContaining({ id: 'u1' }));
  });

  it('Profesyonel ve ADMIN acabilir', async () => {
    const { ctrl, asa } = kur();
    await ctrl.setAutoPilot(req('PRO'), 'acc1', { enabled: true } as any);
    await ctrl.setAutoPilot(req('STARTER', 'ADMIN'), 'acc1', { enabled: true } as any);
    expect(asa.setAutoPilot).toHaveBeenCalledTimes(2);
  });
});

/** Prisma `site` suzgecinin (siteWhereForFeatureOrAdmin) kucuk degerlendiricisi */
function siteMatches(where: any, owner: { plan: string; role: string }): boolean {
  if (!where) return true;
  if (Array.isArray(where.OR)) return where.OR.some((w: any) => siteMatches(w, owner));
  const u = where.user ?? {};
  if (u.plan?.in && !u.plan.in.includes(owner.plan)) return false;
  if (u.role && u.role !== owner.role) return false;
  return true;
}

const OWNERS = [
  { plan: 'TRIAL', role: 'USER', beklenen: false },
  { plan: 'STARTER', role: 'USER', beklenen: false },
  { plan: 'PRO', role: 'USER', beklenen: true },
  { plan: 'ENTERPRISE', role: 'USER', beklenen: true },
  // Platformun kendi uygulamasi yonetici hesabinda: planindan bagimsiz surer
  { plan: 'TRIAL', role: 'ADMIN', beklenen: true },
];

describe('gunluk cron\'lar sahibin planina bakar', () => {
  it('ASA otopilot: yalniz asaEnabled sahipli hesaplar', async () => {
    const findMany = vi.fn(async () => []);
    const svc = new AsaService({ asaAccount: { findMany } } as any);
    await svc.runAllAutoPilots();
    const where = (findMany.mock.calls[0] as any)[0].where;
    expect(where).toMatchObject({ autoPilotEnabled: true, isActive: true });
    for (const o of OWNERS) expect(siteMatches(where.site, o), `${o.plan}/${o.role}`).toBe(o.beklenen);
  });

  it('ASA otopilot: suzgecten gecmeyen hesap icin runAutoPilot hic cagrilmaz', async () => {
    const accounts = [
      { id: 'pro-hesap', owner: { plan: 'PRO', role: 'USER' } },
      { id: 'dusen-hesap', owner: { plan: 'TRIAL', role: 'USER' } },
    ];
    const findMany = vi.fn(async ({ where }: any) => accounts.filter((a) => siteMatches(where.site, a.owner)));
    const svc = new AsaService({ asaAccount: { findMany } } as any);
    const run = vi.spyOn(svc, 'runAutoPilot').mockResolvedValue({} as any);
    await svc.runAllAutoPilots();
    expect(run.mock.calls.map((c) => c[0])).toEqual(['pro-hesap']);
  });

  it('ASA performans senkronu: ayni suzgec', async () => {
    const findMany = vi.fn(async () => []);
    const cron = new AsaCronService({ fetchPerformanceScheduled: vi.fn() } as any, { asaAccount: { findMany } } as any);
    await cron.dailyPerformanceFetch();
    const where = (findMany.mock.calls[0] as any)[0].where;
    expect(where.isActive).toBe(true);
    for (const o of OWNERS) expect(siteMatches(where.site, o), `${o.plan}/${o.role}`).toBe(o.beklenen);
  });

  it('ASC gunluk senkron: yalniz ascEnabled sahipli hesaplar', async () => {
    const findMany = vi.fn(async () => []);
    const svc = new AscService({ ascAccount: { findMany } } as any);
    await svc.runDailySyncAll();
    const where = (findMany.mock.calls[0] as any)[0].where;
    expect(where.isActive).toBe(true);
    for (const o of OWNERS) expect(siteMatches(where.site, o), `${o.plan}/${o.role}`).toBe(o.beklenen);
  });
});
