import { describe, it, expect, vi, afterEach } from 'vitest';
import { EmailService, denemeSonu, type EmailTemplate } from './email.service.js';
import { EmailCron } from './email.cron.js';

/**
 * d11/d13 e-postalari "deneme bitince ne olur"u DOGRU soyler (sahip karari 21.10.2026):
 * satin alma acikken hesap salt okunur olur (trial-expiry.guard.ts); PayTR test modunda
 * kilit yok, metin de kilit demez.
 */
const svc = new EmailService({ emailLog: { create: async () => {} } } as never);
const render = (t: EmailTemplate, d: Record<string, unknown>) => (svc as any).renderTemplate(t, d) as { subject: string; html: string };

describe('deneme bitis metni', () => {
  it('satin alma acik: salt okunur, gorme/indirme acik, veri kalir', () => {
    for (const t of ['trial_expiry_d11', 'trial_expiry_d13'] as const) {
      const { html } = render(t, { name: 'A', readOnlyAtEnd: true });
      expect(html, t).toContain('salt okunur');
      expect(html, t).toContain('Verilerin hesabında kalır.');
    }
    expect(denemeSonu(true)).toContain('görmeye ve indirmeye devam edersin');
  });

  it('satin alma kapali ya da bilinmiyor: kilit iddiasi yok, test asamasi soylenir', () => {
    for (const v of [false, undefined]) {
      const { html } = render('trial_expiry_d13', { name: 'A', readOnlyAtEnd: v });
      expect(html).not.toContain('salt okunur');
      expect(html).toContain('test aşamasında');
    }
  });
});

describe('EmailCron — d11/d13 metnine satin alma durumunu verir', () => {
  const env = { ...process.env };
  afterEach(() => { process.env = { ...env }; vi.useRealTimers(); });

  async function run(testMode: string) {
    process.env.PAYTR_TEST_MODE = testMode;
    const now = Date.now();
    const users = [{ id: 'u1', email: 'a@ornek.com', name: 'A', role: 'USER', createdAt: new Date(now - 11 * 86_400_000), trialEndsAt: new Date(now + 2.5 * 86_400_000) }];
    const email = { send: vi.fn(async () => ({ ok: true })) };
    const cron = new EmailCron({ user: { findMany: vi.fn(async () => users) } } as any, email as any);
    await cron.dailyEmails();
    return email.send.mock.calls.map((c: any[]) => c[0]);
  }

  it('canli mod: readOnlyAtEnd true; test modu: false', async () => {
    expect((await run('0')).find((m: any) => m.template === 'trial_expiry_d11')?.data).toMatchObject({ readOnlyAtEnd: true });
    expect((await run('1')).find((m: any) => m.template === 'trial_expiry_d11')?.data).toMatchObject({ readOnlyAtEnd: false });
  });
});
