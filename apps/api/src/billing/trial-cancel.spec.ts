import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { PaytrService } from './paytr.service.js';
import { isTrialExpired, trialAccess, TRIAL_CANCEL_NOT_ALLOWED_MESSAGE } from './trial-policy.js';

/**
 * Inceleme (MEDIUM): denemedeki hesap POST /billing/users/:id/cancel ile durumunu
 * CANCELED yapip salt okunur kilidi kalici olarak atlatabiliyordu (isTrialExpired yalniz
 * EXPIRED ya da TRIAL durumuna bakiyordu, hicbir gunluk is plan TRIAL + CANCELED satiri
 * yakalamiyordu). Artik iptal plan TRIAL'da 400; kural da durumdan bagimsiz bitise bakar.
 */
const PAST = new Date(Date.now() - 86_400_000);

function svcWith(row: Record<string, any>, opts: { raceToTrial?: boolean } = {}) {
  const state = { ...row };
  const prisma = {
    user: {
      findUnique: vi.fn(async () => ({ plan: state.plan })),
      update: vi.fn(async ({ where, data }: any) => {
        // Kosullu yazim: arada gunluk is plani dusurduyse Prisma P2025 atar
        if (opts.raceToTrial || (where.plan?.not && state.plan === where.plan.not)) throw Object.assign(new Error('Record not found'), { code: 'P2025' });
        Object.assign(state, data);
        return { id: state.id, email: state.email, name: state.name, plan: state.plan, subscriptionStatus: state.subscriptionStatus };
      }),
    },
    invoice: { findFirst: vi.fn(async () => null) },
  };
  const email = { send: vi.fn(async () => ({ ok: true })) };
  const svc = new PaytrService(prisma as any, { recordCommission: vi.fn() } as any, email as any, {} as any);
  return { svc, prisma, email, state };
}

describe('cancelSubscription — denemede iptal edilecek abonelik yok', () => {
  it('suresi dolmus deneme: 400 + Turkce metin, satir degismez, kilit yerinde kalir', async () => {
    const { svc, prisma, email, state } = svcWith({ id: 'u1', role: 'USER', plan: 'TRIAL', subscriptionStatus: 'EXPIRED', trialEndsAt: PAST });
    const err = await svc.cancelSubscription('u1').catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toBe(TRIAL_CANCEL_NOT_ALLOWED_MESSAGE);
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(email.send).not.toHaveBeenCalled();
    expect(state.subscriptionStatus).toBe('EXPIRED');
    expect(isTrialExpired(state)).toBe(true);
    expect(trialAccess(state, { checkoutOpen: true, everPaid: false })).toMatchObject({ phase: 'expired', readOnly: true });
  });

  it('suren deneme ve plani zaten dusmus eski musteri de 400', async () => {
    for (const row of [
      { id: 'u1', plan: 'TRIAL', subscriptionStatus: 'TRIAL', trialEndsAt: new Date(Date.now() + 5 * 86_400_000) },
      { id: 'u1', plan: 'TRIAL', subscriptionStatus: 'EXPIRED', trialEndsAt: null },
    ]) {
      await expect(svcWith(row).svc.cancelSubscription('u1')).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('ucretli plan: iptal eskisi gibi (CANCELED, yenileme kapali, e-posta); yazim plan kosulunu tasir', async () => {
    const { svc, prisma, email } = svcWith({ id: 'u1', email: 'a@b.co', name: 'A', plan: 'PRO', subscriptionStatus: 'ACTIVE' });
    await expect(svc.cancelSubscription('u1')).resolves.toMatchObject({ plan: 'PRO', status: 'CANCELED' });
    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'u1', plan: { not: 'TRIAL' } },
      data: { subscriptionStatus: 'CANCELED', autoRenew: false },
    }));
    expect(email.send).toHaveBeenCalledWith(expect.objectContaining({ template: 'plan_canceled' }));
  });

  it('okuma ile yazma arasinda plan dustuyse (P2025) CANCELED yazilmaz, 400', async () => {
    const { svc, email } = svcWith({ id: 'u1', plan: 'PRO', subscriptionStatus: 'ACTIVE' }, { raceToTrial: true });
    await expect(svc.cancelSubscription('u1')).rejects.toBeInstanceOf(BadRequestException);
    expect(email.send).not.toHaveBeenCalled();
  });
});
