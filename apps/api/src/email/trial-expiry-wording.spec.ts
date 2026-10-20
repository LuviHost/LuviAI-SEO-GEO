import { describe, it, expect } from 'vitest';
import { EmailService, type EmailTemplate } from './email.service.js';
import { PURCHASABLE_PLAN_IDS, findPlan } from '../billing/plans.js';
import { MEASUREMENT_WINDOW_MS, computeAllowance } from '../billing/measurement-allowance.js';

/**
 * Deneme bitisi e-postalari plana gecen musteriye ne vaat ediyor.
 *
 * NEDEN VAR: d11 / d13 / trial_expired "Daha fazla makale, site ve AI görünürlük ölçümü için
 * bir plan seçebilirsin" diyordu. Ucretli plan olcum SIKLIGINI artirmaz: her hesap kayan
 * 7 gunde 1 AI olcumu yapar (billing/measurement-allowance.ts, plana bakmaz). Planlar makale,
 * site ve AYLIK AI gorunurluk calistirmasi tavaninda ayrisir (plans.ts). Metin artik yalniz
 * dogru olani soyler ve bu spec onu plan sayilarina baglar.
 */

const svc = new EmailService({ emailLog: { create: async () => {} } } as never);
const render = (t: EmailTemplate, d: Record<string, unknown> = {}) =>
  (svc as any).renderTemplate(t, d) as { subject: string; html: string };

const SABLONLAR: EmailTemplate[] = ['trial_expiry_d11', 'trial_expiry_d13', 'trial_expired'];

describe('deneme bitisi e-postalari — plan daha sik AI olcumu vaat etmiyor', () => {
  it('"AI görünürlük ölçümü" vaadi yok; plan daha fazla makale, site ve aylik AI gorunurluk calistirmasi verir', () => {
    for (const t of SABLONLAR) {
      const { subject, html } = render(t, { name: 'Test' });
      const metin = `${subject} ${html}`;
      expect(metin, t).not.toContain('AI görünürlük ölçümü');
      expect(metin, t).not.toMatch(/daha (fazla|sık)[^.]{0,40}ölçüm/i);
      expect(html, t).toContain('Daha fazla makale, site ve aylık AI görünürlük çalıştırması için');
    }
    // d11 onizleme metni de ayni dili kullanir
    expect(render('trial_expiry_d11').html).toContain('Daha fazla makale, site ve aylık AI görünürlük çalıştırması için planlara göz atabilirsin.');
  });

  it('dayanak: satin alinabilir her plan denemeden fazla makale, site ve aylik calistirma verir; olcum hakki her hesapta ayni pencere', () => {
    const trial = findPlan('trial')!;
    expect(PURCHASABLE_PLAN_IDS.length).toBeGreaterThan(0);
    for (const id of PURCHASABLE_PLAN_IDS) {
      const plan = findPlan(id)!;
      expect(plan.articlesPerMonth, id).toBeGreaterThan(trial.articlesPerMonth);
      expect(plan.sites, id).toBeGreaterThan(trial.sites);
      expect(plan.aiRunsPerMonth, id).toBeGreaterThan(trial.aiRunsPerMonth);
    }
    expect(MEASUREMENT_WINDOW_MS).toBe(7 * 24 * 60 * 60 * 1000);
    // Hak hesabi plan almaz: son olcumden 7 gun sonra, plan ne olursa olsun
    const last = '2026-10-10T10:00:00.000Z';
    expect(computeAllowance(last, new Date('2026-10-16T10:00:00.000Z')).allowed).toBe(false);
    expect(computeAllowance(last, new Date('2026-10-17T10:00:00.000Z')).allowed).toBe(true);
  });
});
