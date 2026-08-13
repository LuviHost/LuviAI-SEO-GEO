import { describe, it, expect } from 'vitest';
import { BASE_PLANS } from './plans.js';
import { QuotaService } from './quota.service.js';

/**
 * plans.ts (REKLAM) ile QuotaService.LIMITS (DAYATMA) senkron testi.
 *
 * NEDEN VAR: bu iki tablo bagimsiz olarak kaydi ve kimse fark etmedi.
 * Fiyatlandirma sayfasi PRO icin "5 site" satiyordu, QuotaService 3'te
 * blokluyordu; ayrica plans.ts'te promptRunsPerMonth (400) ve
 * llmResponsesPerMonth (20.000) alanlari duruyordu ama arkalarinda HICBIR
 * sayac yoktu — musteriye karsiligi olmayan sayilar gosteriliyordu.
 *
 * Bir plan alanini degistirirken bu test kirmizi yaniyorsa, iki tabloyu da
 * guncelleyin. Testi zayiflatmayin: kirilmasi bu dosyanin isini yapmasidir.
 */

// LIMITS private; test disinda okunan yer yok. Prisma'ya dokunmadigimiz icin
// bagimlilik null gecilebiliyor.
const LIMITS = Reflect.get(new QuotaService(null as never), 'LIMITS') as Record<
  string,
  { articles: number; sites: number; citationTests: number }
>;

describe('plans.ts <-> QuotaService.LIMITS', () => {
  it('her plan icin bir kota kaydi var', () => {
    for (const p of BASE_PLANS) {
      expect(LIMITS[p.id.toUpperCase()], `${p.id} icin LIMITS kaydi yok`).toBeDefined();
    }
  });

  it('articlesPerMonth reklam ile dayatma ayni', () => {
    for (const p of BASE_PLANS) {
      expect(p.articlesPerMonth, `${p.id} makale`).toBe(LIMITS[p.id.toUpperCase()].articles);
    }
  });

  it('sites reklam ile dayatma ayni', () => {
    for (const p of BASE_PLANS) {
      expect(p.sites, `${p.id} site`).toBe(LIMITS[p.id.toUpperCase()].sites);
    }
  });

  it('aiRunsPerMonth, citationTests kovasiyla ayni (Prompt Lab ayni kovadan duser)', () => {
    for (const p of BASE_PLANS) {
      expect(p.aiRunsPerMonth, `${p.id} calistirma`).toBe(LIMITS[p.id.toUpperCase()].citationTests);
    }
  });
});

describe('fiyat karti maddeleri', () => {
  it('satin alinabilir her planin maddesi var', () => {
    for (const p of BASE_PLANS) {
      expect(p.features_tr.length, `${p.id} TR madde`).toBeGreaterThan(0);
      expect(p.features_en.length, `${p.id} EN madde`).toBeGreaterThan(0);
    }
  });

  it('TR ve EN madde sayilari esit — biri guncellenip digeri unutulmasin', () => {
    for (const p of BASE_PLANS) {
      expect(p.features_en.length, `${p.id} TR/EN madde sayisi farkli`).toBe(p.features_tr.length);
    }
  });

  it('inheritsFrom var olan bir plani gosteriyor ve dongu yok', () => {
    const ids = new Set(BASE_PLANS.map((p) => p.id));
    for (const p of BASE_PLANS) {
      if (!p.inheritsFrom) continue;
      expect(ids.has(p.inheritsFrom), `${p.id} -> ${p.inheritsFrom} yok`).toBe(true);
      expect(p.inheritsFrom, `${p.id} kendini miras aliyor`).not.toBe(p.id);
    }
  });

  it('takip edilen uygulama sayisi merdiveni geri gitmiyor', () => {
    const ladder = ['trial', 'starter', 'pro', 'agency', 'enterprise'] as const;
    for (let i = 1; i < ladder.length; i++) {
      const prev = BASE_PLANS.find((p) => p.id === ladder[i - 1])!;
      const cur = BASE_PLANS.find((p) => p.id === ladder[i])!;
      expect(cur.trackedApps, `${cur.id} uygulama < ${prev.id}`).toBeGreaterThanOrEqual(prev.trackedApps);
    }
  });

  it('ucretli planlar artan kota siralamasinda', () => {
    const ladder = ['trial', 'starter', 'pro', 'agency', 'enterprise'] as const;
    for (let i = 1; i < ladder.length; i++) {
      const prev = BASE_PLANS.find((p) => p.id === ladder[i - 1])!;
      const cur = BASE_PLANS.find((p) => p.id === ladder[i])!;
      expect(cur.articlesPerMonth, `${cur.id} makale <= ${prev.id}`).toBeGreaterThan(prev.articlesPerMonth);
      expect(cur.aiRunsPerMonth, `${cur.id} calistirma <= ${prev.id}`).toBeGreaterThan(prev.aiRunsPerMonth);
      expect(cur.sites, `${cur.id} site < ${prev.id}`).toBeGreaterThanOrEqual(prev.sites);
    }
  });
});

describe('Turkce bulunma hali eki', () => {
  // inheritsLabel dolayli test edilir: getPlans locale'e gore uretir.
  it('sert unsuzle biten plan adinda ek sertlesir', async () => {
    const { BillingService } = await import('./billing.service.js');
    const svc = new BillingService(null as never, { getRate: async () => ({ rate: 1 }) } as never);
    const plans = await svc.getPlans('tr');
    const byId = Object.fromEntries(plans.map((p) => [p.id, p]));
    // Ajans sert unsuz 's' ile biter -> 'taki', 'deki' DEGIL
    expect(byId.enterprise.inheritsLabel).toBe("Ajans'taki her şey, artı:");
    // Buyume unluyle, Profesyonel yumusak 'l' ile biter -> 'deki'
    expect(byId.pro.inheritsLabel).toBe("Büyüme'deki her şey, artı:");
    expect(byId.agency.inheritsLabel).toBe("Profesyonel'deki her şey, artı:");
    // Kok planda baslik olmaz
    expect(byId.starter.inheritsLabel).toBeUndefined();
  });

  it('EN tarafinda ek mantigi devreye girmez', async () => {
    const { BillingService } = await import('./billing.service.js');
    const svc = new BillingService(null as never, { getRate: async () => ({ rate: 1 }) } as never);
    const plans = await svc.getPlans('en');
    const byId = Object.fromEntries(plans.map((p) => [p.id, p]));
    expect(byId.enterprise.inheritsLabel).toBe('Everything in Agency, plus:');
    expect(byId.pro.inheritsLabel).toBe('Everything in Growth, plus:');
  });
});
