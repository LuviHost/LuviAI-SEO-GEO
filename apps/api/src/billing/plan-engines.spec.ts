import { describe, it, expect } from 'vitest';
import { ownerEngines, ownerModelTier } from './plan-engines.js';
import { BASE_ENGINES, BASE_PLANS, CONDITIONAL_ENGINES, PLAN_RANK, STANDARD_ENGINES, planEngines, planModelTier } from './plans.js';

/**
 * Site SAHIBININ planina gore olcum kapsami ve model kademesi (plan-engines.ts).
 *
 * NEDEN VAR (11.11.2026, uc paket): fiyat karti Baslangic'i dort asistan ve hizli
 * modellerle, Profesyonel ve ustunu butun asistanlar ve gelismis modellerle satiyor.
 * Olcum motoru (audit/ai-citation.service) kapsami ve kademeyi BURADAN okur; kural
 * burada gevserse alt paket musterisi ust paketi bedavaya alir, siki kalirsa ust paket
 * musterisi parasini verdigi asistani alamaz. Iki yon de asagida kilitli.
 */

const DORT = ['openai', 'gemini', 'anthropic', 'perplexity'];
const HEPSI = [...DORT, 'xai', 'deepseek', 'meta'];

describe('ownerEngines / ownerModelTier — plan', () => {
  it('deneme ve Baslangic: dort asistan (ChatGPT, Gemini, Claude, Perplexity), standard kademe', () => {
    for (const plan of ['TRIAL', 'STARTER']) {
      expect(ownerEngines({ plan, role: 'USER' }), plan).toEqual(DORT);
      expect(ownerModelTier({ plan, role: 'USER' }), plan).toBe('standard');
      for (const e of ['xai', 'deepseek', 'meta']) expect(ownerEngines({ plan, role: 'USER' }), `${plan}/${e}`).not.toContain(e);
    }
  });

  it('Profesyonel, Ajans (satistan kalkan plan, mevcut hesaplar) ve Kurumsal: alti asistan + Muse, premium kademe', () => {
    for (const plan of ['PRO', 'AGENCY', 'ENTERPRISE']) {
      expect(ownerEngines({ plan, role: 'USER' }), plan).toEqual(HEPSI);
      expect(ownerModelTier({ plan, role: 'USER' }), plan).toBe('premium');
    }
  });

  it('plan dizgesi buyuk/kucuk harfe bakmaz; rol verilmese de plan kurali uygulanir', () => {
    expect(ownerEngines({ plan: 'pro' })).toEqual(HEPSI);
    expect(ownerEngines({ plan: 'Starter' })).toEqual(DORT);
    expect(ownerModelTier({ plan: 'enterprise' })).toBe('premium');
    expect(ownerModelTier({ plan: 'trial', role: null })).toBe('standard');
  });

  it('her tanimli plan icin plans.ts kuraliyla (planEngines / planModelTier) birebir ayni', () => {
    for (const p of BASE_PLANS) {
      const owner = { plan: p.id.toUpperCase(), role: 'USER' };
      expect(ownerEngines(owner), p.id).toEqual(planEngines(p.id));
      expect(ownerModelTier(owner), p.id).toBe(planModelTier(p.id));
      // Esik tek: Profesyonel'in altinda dar kapsam + standard, ustunde genis + premium
      const dar = PLAN_RANK[p.id] < PLAN_RANK.pro;
      expect(planEngines(p.id), p.id).toEqual(dar ? [...STANDARD_ENGINES] : [...BASE_ENGINES, ...CONDITIONAL_ENGINES]);
      expect(planModelTier(p.id), p.id).toBe(dar ? 'standard' : 'premium');
    }
  });
});

describe('ownerEngines / ownerModelTier — ADMIN muaf', () => {
  it('ADMIN her planda (bilinmeyen / bos plan dahil) butun asistanlar ve premium kademe', () => {
    for (const plan of ['TRIAL', 'STARTER', 'PRO', 'AGENCY', 'ENTERPRISE', 'YOKBOYLEPLAN', '', null, undefined]) {
      expect(ownerEngines({ plan, role: 'ADMIN' }), String(plan)).toEqual(HEPSI);
      expect(ownerModelTier({ plan, role: 'ADMIN' }), String(plan)).toBe('premium');
    }
  });

  it('muafiyet yalniz ADMIN rolunde: baska rol (ajans sahibi dahil) plana gore kalir', () => {
    for (const role of ['USER', 'AGENCY_OWNER', 'admin', '', null, undefined]) {
      expect(ownerEngines({ plan: 'STARTER', role }), String(role)).toEqual(DORT);
      expect(ownerModelTier({ plan: 'STARTER', role }), String(role)).toBe('standard');
    }
  });
});

describe('ownerEngines / ownerModelTier — bilinmeyen plan EN DAR kapsami alir (kapi acik unutulmaz)', () => {
  it('bilinmeyen, bos, null plan ya da sahip yok: dort asistan, standard', () => {
    const girdiler = [
      { plan: 'YOKBOYLEPLAN', role: 'USER' }, { plan: '', role: 'USER' }, { plan: null, role: 'USER' },
      { plan: undefined }, {}, null, undefined,
    ];
    for (const g of girdiler) {
      expect(ownerEngines(g), JSON.stringify(g)).toEqual(DORT);
      expect(ownerModelTier(g), JSON.stringify(g)).toBe('standard');
    }
  });

  it('nesne prototipindeki adlar plan sayilmaz (toString, constructor, __proto__)', () => {
    for (const plan of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
      expect(ownerEngines({ plan, role: 'USER' }), plan).toEqual(DORT);
      expect(ownerModelTier({ plan, role: 'USER' }), plan).toBe('standard');
    }
  });

  it('donen dizi kopyadir: cagiran degistirirse kural degismez', () => {
    const a = ownerEngines({ plan: 'STARTER' });
    a.push('xai' as never);
    expect(ownerEngines({ plan: 'STARTER' })).toEqual(DORT);
    const b = ownerEngines({ plan: 'PRO' });
    b.length = 0;
    expect(ownerEngines({ plan: 'PRO' })).toEqual(HEPSI);
    const c = ownerEngines({ plan: 'TRIAL', role: 'ADMIN' });
    c.pop();
    expect(ownerEngines({ plan: 'TRIAL', role: 'ADMIN' })).toEqual(HEPSI);
    expect([...STANDARD_ENGINES]).toEqual(DORT);
  });
});

/**
 * Panelin okudugu haklar (GET /me → entitlements.engines): hesabin SU AN olctugu asistanlar.
 * Panel "N AI asistaninda" sayisini ve logo seridini bundan yazar; sabit "6" yazarsa Baslangic
 * hesabina olcmedigimiz iki asistani gosterir. Liste = plan kapsami ∩ bu kurulumda olculenler.
 */
describe('entitlementsFor(...).engines — panelin gosterdigi asistanlar', () => {
  const withMetaKey = async (key: string | undefined, fn: () => Promise<void>) => {
    const eski = process.env.META_MODEL_API_KEY;
    if (key === undefined) delete process.env.META_MODEL_API_KEY; else process.env.META_MODEL_API_KEY = key;
    try { await fn(); } finally {
      if (eski === undefined) delete process.env.META_MODEL_API_KEY; else process.env.META_MODEL_API_KEY = eski;
    }
  };

  it('Baslangic ve deneme dort; Profesyonel ve ustu alti; Muse yalniz anahtari tanimliyken sayilir', async () => {
    const { entitlementsFor } = await import('./entitlements.js');
    await withMetaKey(undefined, async () => {
      expect(entitlementsFor('TRIAL').engines).toEqual(DORT);
      expect(entitlementsFor('STARTER').engines).toEqual(DORT);
      for (const p of ['PRO', 'AGENCY', 'ENTERPRISE']) expect(entitlementsFor(p).engines, p).toEqual([...DORT, 'xai', 'deepseek']);
    });
    await withMetaKey('onizleme', async () => {
      // Kapsam disi planda anahtar olsa da Muse yok
      expect(entitlementsFor('STARTER').engines).toEqual(DORT);
      for (const p of ['PRO', 'AGENCY', 'ENTERPRISE']) expect(entitlementsFor(p).engines, p).toEqual(HEPSI);
    });
  });

  it('ADMIN muaf (olcum motoruyla ayni kural); taninmayan plan en dar kapsam', async () => {
    const { entitlementsFor } = await import('./entitlements.js');
    await withMetaKey(undefined, async () => {
      expect(entitlementsFor('TRIAL', 'ADMIN').engines).toEqual([...DORT, 'xai', 'deepseek']);
      expect(entitlementsFor('BILINMEYEN').engines).toEqual(DORT);
    });
  });

  it('liste her planda olcum motorunun sordugu kumeyle ayni (ownerEngines ∩ olculenler)', async () => {
    const { entitlementsFor } = await import('./entitlements.js');
    const { measuredEngines } = await import('./measured-engines.js');
    for (const p of BASE_PLANS) {
      const olculen = measuredEngines();
      expect(entitlementsFor(p.id.toUpperCase()).engines, p.id)
        .toEqual(ownerEngines({ plan: p.id.toUpperCase() }).filter((e) => olculen.includes(e)));
    }
  });
});

