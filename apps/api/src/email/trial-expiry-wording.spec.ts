import { describe, it, expect } from 'vitest';
import { EmailService, MAKALE_PLANI, type EmailTemplate } from './email.service.js';
import { PLAN_RANK, PURCHASABLE_PLAN_IDS, findPlan, publicPlans } from '../billing/plans.js';
import { MEASUREMENT_WINDOW_MS, computeAllowance } from '../billing/measurement-allowance.js';

/**
 * Deneme bitisi e-postalari plana gecen musteriye ne vaat ediyor.
 *
 * NEDEN VAR: d11 / d13 / trial_expired "Daha fazla makale, site ve AI görünürlük ölçümü için
 * bir plan seçebilirsin" diyordu. Ucretli plan olcum SIKLIGINI artirmaz: her hesap kayan
 * 7 gunde 1 AI olcumu yapar (billing/measurement-allowance.ts, plana bakmaz). Planlar makale,
 * site ve AYLIK AI gorunurluk calistirmasi tavaninda ayrisir (plans.ts). Metin artik yalniz
 * dogru olani soyler ve bu spec onu plan sayilarina baglar.
 *
 * 11.11.2026 (uc paket): "Daha fazla makale ... için bir plan seçebilirsin" de artik yanlis —
 * Baslangic'ta makale uretimi yok (0; denemenin toplam 2 makalesinden az). Her satin alinabilir
 * planin denemeden fazla verdigi site ve aylik calistirmadir; makale icin e-posta plani ADIYLA
 * soyler (makale ureten en dusuk satistaki plan ve ustu).
 */

const svc = new EmailService({ emailLog: { create: async () => {} } } as never);
const render = (t: EmailTemplate, d: Record<string, unknown> = {}) =>
  (svc as any).renderTemplate(t, d) as { subject: string; html: string };

const SABLONLAR: EmailTemplate[] = ['trial_expiry_d11', 'trial_expiry_d13', 'trial_expired'];

describe('deneme bitisi e-postalari — plan daha sik AI olcumu vaat etmiyor', () => {
  it('"AI görünürlük ölçümü" vaadi yok; plan daha fazla site ve aylik AI gorunurluk calistirmasi verir; makale yalniz adi verilen plan ve ustunde', () => {
    for (const t of SABLONLAR) {
      const { subject, html } = render(t, { name: 'Test' });
      const metin = `${subject} ${html}`;
      expect(metin, t).not.toContain('AI görünürlük ölçümü');
      expect(metin, t).not.toMatch(/daha (fazla|sık)[^.]{0,40}ölçüm/i);
      expect(html, t).toContain('Daha fazla site ve aylık AI görünürlük çalıştırması için');
      // "Bir plan sec, daha fazla makale" yok: makale HER planda yok
      expect(metin, t).not.toMatch(/daha fazla makale/i);
      expect(metin, t).not.toMatch(/daha fazla[^.(;]{0,40}makale/i);
      // Makale ureten plan adiyla soylenir (plans.ts)
      expect(html, t).toContain(`makale üretimi ${MAKALE_PLANI} ve üzeri planlarda`);
    }
    // d11 onizleme metni de ayni dili kullanir
    expect(render('trial_expiry_d11').html).toContain(
      `Daha fazla site ve aylık AI görünürlük çalıştırması için planlara göz atabilirsin (makale üretimi ${MAKALE_PLANI} ve üzeri planlarda).`,
    );
  });

  it('dayanak: satin alinabilir her plan denemeden fazla site ve aylik calistirma verir; makale yalniz e-postanin adini verdigi plandan itibaren; olcum hakki her hesapta ayni pencere', () => {
    const trial = findPlan('trial')!;
    expect(PURCHASABLE_PLAN_IDS.length).toBeGreaterThan(0);
    for (const id of PURCHASABLE_PLAN_IDS) {
      const plan = findPlan(id)!;
      expect(plan.sites, id).toBeGreaterThan(trial.sites);
      expect(plan.aiRunsPerMonth, id).toBeGreaterThan(trial.aiRunsPerMonth);
    }
    // "Daha fazla makale" neden yazilamaz: satin alinabilir planlardan biri (Baslangic) denemeden AZ makale verir
    const makalesiz = PURCHASABLE_PLAN_IDS.filter((id) => findPlan(id)!.articlesPerMonth <= trial.articlesPerMonth);
    expect(makalesiz).toEqual(['starter']);
    expect(findPlan('starter')!.articlesPerMonth).toBe(0);
    // E-postanin adini verdigi plan = makale ureten en dusuk satistaki ucretli plan; o ve ustundeki
    // satistaki her plan denemeden fazla makale verir, altindaki hicbir ucretli plan vermez
    const makalePlani = publicPlans().find((p) => p.monthly_usd > 0 && p.articlesPerMonth > 0)!;
    expect(makalePlani.id).toBe('pro');
    expect(MAKALE_PLANI).toBe(makalePlani.name_tr);
    expect(MAKALE_PLANI).toBe('Profesyonel');
    for (const p of publicPlans()) {
      if (p.monthly_usd <= 0) continue;
      if (PLAN_RANK[p.id] >= PLAN_RANK[makalePlani.id]) expect(p.articlesPerMonth, p.id).toBeGreaterThan(trial.articlesPerMonth);
      else expect(p.articlesPerMonth, p.id).toBe(0);
    }
    expect(MEASUREMENT_WINDOW_MS).toBe(7 * 24 * 60 * 60 * 1000);
    // Hak hesabi plan almaz: son olcumden 7 gun sonra, plan ne olursa olsun
    const last = '2026-10-10T10:00:00.000Z';
    expect(computeAllowance(last, new Date('2026-10-16T10:00:00.000Z')).allowed).toBe(false);
    expect(computeAllowance(last, new Date('2026-10-17T10:00:00.000Z')).allowed).toBe(true);
  });
});
