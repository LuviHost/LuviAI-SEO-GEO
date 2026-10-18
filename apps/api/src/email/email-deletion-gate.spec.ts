import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Silme talebi olan hesaba sablon e-postasi gitmez; silme e-postalari (sendRaw)
 * gitmeye devam eder.
 *
 * NEDEN VAR: silme talebi emailVerified'i bosaltip cron'lari durduruyor ama
 * send() cagiran baska yollar (makale hazir, odeme bildirimi, haftalik plan,
 * karsilama kancasi) kullaniciyi kendileri okuyup dogrudan gonderiyordu.
 */

const resendSend = vi.fn(async () => ({ data: { id: 're_123' } }));
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: resendSend };
  },
}));

const { EmailService } = await import('./email.service.js');

const REQUESTED = new Date('2026-10-01T10:00:00Z');

function makePrisma(users: Record<string, { deletionRequestedAt: Date | null }>) {
  return {
    user: { findUnique: vi.fn(async ({ where }: any) => users[where.id] ?? null) },
    emailLog: { create: vi.fn(async () => ({})) },
  };
}

describe.each([
  ['Resend anahtari var', 're_test_key'],
  ['gelistirme modu (anahtar yok)', undefined],
])('EmailService — silme talebi kapisi (%s)', (_label, key) => {
  let prevKey: string | undefined;
  beforeEach(() => {
    prevKey = process.env.RESEND_API_KEY;
    if (key) process.env.RESEND_API_KEY = key;
    else delete process.env.RESEND_API_KEY;
    resendSend.mockClear();
  });
  afterEach(() => {
    if (prevKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = prevKey;
  });

  it('silme talebi olan hesaba send() gondermez, iz birakmaz', async () => {
    const prisma = makePrisma({ u1: { deletionRequestedAt: REQUESTED } });
    const svc = new EmailService(prisma as never);
    const r = await svc.send({ userId: 'u1', to: 'a@b.co', template: 'weekly_report', data: { name: 'Ayşe' } });
    expect(r).toEqual({ ok: false, skipped: 'account_deletion' });
    expect(resendSend).not.toHaveBeenCalled();
    expect(prisma.emailLog.create).not.toHaveBeenCalled();
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'u1' }, select: { deletionRequestedAt: true } });
  });

  it('normal hesapta send() gonderir ve kaydeder', async () => {
    const prisma = makePrisma({ u2: { deletionRequestedAt: null } });
    const svc = new EmailService(prisma as never);
    const r = await svc.send({ userId: 'u2', to: 'c@d.co', template: 'article_ready', data: { name: 'Can', title: 'Başlık' } });
    expect(r.ok).toBe(true);
    expect(r.skipped).toBeUndefined();
    expect(resendSend).toHaveBeenCalledTimes(key ? 1 : 0);
    expect(prisma.emailLog.create).toHaveBeenCalledTimes(1);
  });

  it('userId verilmezse (yonetici test gonderimi) kullanici sorgulanmaz', async () => {
    const prisma = makePrisma({});
    const svc = new EmailService(prisma as never);
    const r = await svc.send({ to: 'test@ranksup.ai', template: 'welcome_day0', data: { name: 'Test' } });
    expect(r.ok).toBe(true);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('silme e-postalari sendRaw ile gitmeye devam eder (talep sonrasi userId dolu)', async () => {
    const prisma = makePrisma({ u1: { deletionRequestedAt: REQUESTED } });
    const svc = new EmailService(prisma as never);
    const r = await svc.sendRaw({ userId: 'u1', to: 'a@b.co', subject: 'Hesap silme talebin alındı', html: '<p>x</p>' });
    expect(r.ok).toBe(true);
    expect(resendSend).toHaveBeenCalledTimes(key ? 1 : 0);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});
