import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Gonderim saglayicisi yokken (RESEND_API_KEY bos) e-posta GITMEDI kaydedilir.
 *
 * NEDEN VAR: eskiden yalniz loglanip 'sent' kaydediliyor ve { ok: true }
 * donuyordu. Uretimde anahtar dusunce kayitlar "gitti" diyor, bildirim ve
 * ozet "e-postalandi" damgasi aliyor, karsilama kancasi ilk kaydi gorup bir
 * daha denemiyordu. Resend SDK'si API hatasinda firlatmayip { error } doner;
 * o da 'sent' sayiliyordu.
 */

const resendSend = vi.fn<(...a: any[]) => Promise<any>>(async () => ({ data: { id: 're_1' }, error: null }));
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: resendSend };
  },
}));

const { EmailService, EMAIL_STATUS_NO_PROVIDER, EMAIL_NOT_SENT_STATUSES } = await import('./email.service.js');

function makePrisma() {
  return {
    user: { findUnique: vi.fn(async () => ({ deletionRequestedAt: null })) },
    emailLog: { create: vi.fn(async (_a: any) => ({})) },
  };
}

describe('EmailService — saglayici yok', () => {
  let prevKey: string | undefined;
  beforeEach(() => { prevKey = process.env.RESEND_API_KEY; delete process.env.RESEND_API_KEY; resendSend.mockClear(); });
  afterEach(() => { if (prevKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = prevKey; });

  it('send(): ok false + no_provider, kayit "sent" DEGIL', async () => {
    const prisma = makePrisma();
    const r = await new EmailService(prisma as never).send({ userId: 'u1', to: 'a@b.co', template: 'weekly_report', data: { name: 'A' } });
    expect(r).toEqual({ ok: false, skipped: 'no_provider' });
    expect(prisma.emailLog.create.mock.calls[0][0].data.status).toBe(EMAIL_STATUS_NO_PROVIDER);
  });

  it('sendRaw(): ok false + no_provider, kayit "sent" DEGIL (bildirim emailSentAt damgalanmaz)', async () => {
    const prisma = makePrisma();
    const r = await new EmailService(prisma as never).sendRaw({ to: 'a@b.co', subject: 'S', html: '<p>x</p>' });
    expect(r).toEqual({ ok: false, skipped: 'no_provider' });
    expect(prisma.emailLog.create.mock.calls[0][0].data.status).toBe(EMAIL_STATUS_NO_PROVIDER);
  });

  it('karsilama kancasi gonderilmemis kaydi "zaten gitti" saymaz', async () => {
    expect(EMAIL_NOT_SENT_STATUSES).toContain(EMAIL_STATUS_NO_PROVIDER);
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../auth/auth.controller.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/template: 'welcome_day0', status: \{ notIn: \[\.\.\.EMAIL_NOT_SENT_STATUSES\] \}/);
  });
});

describe('EmailService — Resend hata nesnesi', () => {
  let prevKey: string | undefined;
  beforeEach(() => { prevKey = process.env.RESEND_API_KEY; process.env.RESEND_API_KEY = 're_test'; resendSend.mockClear(); });
  afterEach(() => { if (prevKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = prevKey; });

  it('{ error } donerse failed kaydedilir, ok false', async () => {
    resendSend.mockResolvedValueOnce({ data: null, error: { message: 'domain not verified' } });
    const prisma = makePrisma();
    const r = await new EmailService(prisma as never).send({ userId: 'u1', to: 'a@b.co', template: 'weekly_report', data: { name: 'A' } });
    expect(r.ok).toBe(false);
    expect(prisma.emailLog.create.mock.calls[0][0].data.status).toBe('failed');
  });

  it('sendRaw {error} → ok false', async () => {
    resendSend.mockResolvedValueOnce({ data: null, error: { message: 'x' } });
    const r = await new EmailService(makePrisma() as never).sendRaw({ to: 'a@b.co', subject: 'S', html: '<p>x</p>' });
    expect(r.ok).toBe(false);
  });

  it('basarili gonderim sent + resendId', async () => {
    const prisma = makePrisma();
    const r = await new EmailService(prisma as never).send({ userId: 'u1', to: 'a@b.co', template: 'weekly_report', data: { name: 'A' } });
    expect(r).toEqual({ ok: true, resendId: 're_1' });
    expect(prisma.emailLog.create.mock.calls[0][0].data.status).toBe('sent');
  });
});
