import { describe, it, expect, afterEach } from 'vitest';
import {
  BASE_ENGINES, BASE_PLANS, CONDITIONAL_ENGINES, ENGINES_BULLET, ENGINE_LABELS, STANDARD_ENGINES,
  enginesBullet, findPlan, planEngines, publicPlans, type BasePlan, type MeasurementEngine,
} from './plans.js';
import { BillingService, planFeatures } from './billing.service.js';
import { measuredEngines } from './measured-engines.js';

/**
 * aiProviders = bir calistirmada OLCULEN AI asistani sayisi; kart maddesi ayni sayiyi soyler.
 *
 * NEDEN VAR: alan 7 yaziyordu ama Llama (Groq) yalniz GROQ_LLAMA_MODEL
 * tanimliyken olculuyor (ai-citation.service.ts); varsayilan kurulumda 6
 * asistan olculur. Kart maddeleri zaten 6 adi listeliyor — plan alani da
 * ayni sayiyi tasimali, yoksa /billing/plans cevabi kendi maddesiyle celisir.
 *
 * 11.11.2026 (uc paket): sayi artik plana bagli. Baslangic ve deneme DORT asistan
 * olcer (ChatGPT, Gemini, Claude, Perplexity); Profesyonel ve ustu ALTI (Grok ve
 * DeepSeek eklenir) ve — yalniz META_MODEL_API_KEY tanimliyken — Muse. Kart maddesi
 * elle yazilmaz: plans.ts'teki yer tutucu (ENGINES_BULLET) billing.service
 * planFeatures'ta enginesBullet ile, o an olculen listeden uretilir. Bu dosya
 * maddeyi, sayiyi ve /billing/plans `engines` alanini ayni kurala (planEngines) baglar.
 * Beklentiler madde CUMLESINE degil kurala dayanir: madde kisalirsa test kirilmaz,
 * sayi ya da ad degisirse kirilir.
 */

/** Anahtar yokken (her kurulumda) olculenler ve Muse tanimliyken olculenler */
const OLCULEN = { musesiz: measuredEngines({}), museli: measuredEngines({ META_MODEL_API_KEY: 'x' }) } as const;
const DILLER = ['tr', 'en'] as const;

/** Maddede adi gecen asistanlar (kart adlariyla) */
const adlar = (madde: string): MeasurementEngine[] =>
  (Object.keys(ENGINE_LABELS) as MeasurementEngine[]).filter((e) => madde.includes(ENGINE_LABELS[e]));
/** Maddenin soyledigi asistan sayisi (maddedeki ilk tam sayi) */
const sayi = (madde: string): number => Number(madde.match(/\d+/)?.[0] ?? NaN);
/** Planin asistan maddesi: kendi maddesi, yoksa miras aldigi planinki (kart "X'teki her sey, arti" der) */
function asistanMaddesi(p: BasePlan, dil: 'tr' | 'en', olculen: readonly string[]): string | undefined {
  const ham = dil === 'tr' ? p.features_tr : p.features_en;
  if (ham.includes(ENGINES_BULLET)) return enginesBullet(p.id, dil, olculen);
  return p.inheritsFrom ? asistanMaddesi(findPlan(p.inheritsFrom)!, dil, olculen) : undefined;
}

describe('plans.ts aiProviders', () => {
  it('plan kapsami: Baslangic ve deneme dort asistan, Profesyonel ve ustu alti + (kosullu) Muse; Llama yok', () => {
    const dort = ['openai', 'gemini', 'anthropic', 'perplexity'];
    expect([...STANDARD_ENGINES]).toEqual(dort);
    expect([...BASE_ENGINES]).toEqual([...dort, 'xai', 'deepseek']);
    expect([...CONDITIONAL_ENGINES]).toEqual(['meta']);
    for (const id of ['trial', 'starter'] as const) expect(planEngines(id), id).toEqual(dort);
    for (const id of ['pro', 'agency', 'enterprise'] as const) {
      expect(planEngines(id), id).toEqual([...dort, 'xai', 'deepseek', 'meta']);
    }
    expect(Object.values(ENGINE_LABELS).sort()).toEqual(['ChatGPT', 'Claude', 'DeepSeek', 'Gemini', 'Grok', 'Muse', 'Perplexity']);
    expect(Object.values(ENGINE_LABELS).join(' ')).not.toMatch(/llama/i);
  });

  it('her planin aiProviders degeri, kapsamindaki HER ZAMAN olculen asistan sayisiyla ayni (Muse sayilmaz)', () => {
    for (const p of BASE_PLANS) {
      const kapsam = planEngines(p.id).filter((e) => OLCULEN.musesiz.includes(e));
      expect(p.aiProviders, p.id).toBe(kapsam.length);
    }
    expect(findPlan('trial')!.aiProviders).toBe(4);
    expect(findPlan('starter')!.aiProviders).toBe(4);
    for (const id of ['pro', 'agency', 'enterprise']) expect(findPlan(id)!.aiProviders, id).toBe(6);
  });
});

describe('asistan maddesi (ENGINES_BULLET → enginesBullet) = plan kapsami', () => {
  it('yer tutucu musteriye ulasmaz: hicbir planin acilmis maddelerinde yok (TR + EN, Muse var/yok)', () => {
    expect(ENGINES_BULLET).toMatch(/^@.+@$/);
    for (const p of BASE_PLANS) {
      for (const dil of DILLER) {
        for (const [ad, olculen] of Object.entries(OLCULEN)) {
          const maddeler = planFeatures(p, dil, olculen);
          expect(maddeler, `${p.id}/${dil}/${ad}`).not.toContain(ENGINES_BULLET);
          // Madde icine gomulu ya da baska adla acilmamis yer tutucu da olmaz
          expect(maddeler.join('\n'), `${p.id}/${dil}/${ad}`).not.toContain(ENGINES_BULLET);
          expect(maddeler.join('\n'), `${p.id}/${dil}/${ad}`).not.toMatch(/@[\p{L}_]+@/u);
          expect(maddeler, `${p.id}/${dil}/${ad} madde sayisi`).toHaveLength((dil === 'tr' ? p.features_tr : p.features_en).length);
        }
      }
    }
    // Olculen liste verilmezse de (varsayilan: bu kurulum) yer tutucu acilir
    for (const p of publicPlans()) expect(planFeatures(p, 'tr').join('\n'), p.id).not.toContain(ENGINES_BULLET);
  });

  it('satistaki her ucretli planin (kendi ya da miras) asistan maddesi var; TR ve EN ayni yerde', () => {
    for (const p of publicPlans()) {
      if (p.id === 'trial') continue;
      for (const dil of DILLER) expect(asistanMaddesi(p, dil, OLCULEN.musesiz), `${p.id}/${dil}`).toBeTruthy();
      expect(p.features_tr.indexOf(ENGINES_BULLET), p.id).toBe(p.features_en.indexOf(ENGINES_BULLET));
    }
  });

  /**
   * Maddenin IMA ETTIGI asistan sayisi. Madde dort temel asistani adiyla yaziyorsa sayi =
   * yazilan adlar. Yazmiyorsa (ust paket yalniz EKLENENLERI yazar; kart "X'teki her sey,
   * arti:" der) sayi = miras alinan dort + yazilan adlar. Dort temel asistanin bir kismi
   * yazilip bir kismi yazilmamissa sayi tutmaz — NaN doner, test kirilir.
   */
  function imaEdilen(madde: string, p: BasePlan): number {
    const yazilan = adlar(madde);
    const temel = yazilan.filter((e) => STANDARD_ENGINES.includes(e));
    if (temel.length === STANDARD_ENGINES.length) return yazilan.length;
    if (temel.length === 0 && p.inheritsFrom) return STANDARD_ENGINES.length + yazilan.length;
    return NaN;
  }

  it('maddedeki sayi = ima ettigi adlar = planin o an olculen kapsami; kapsam disi ad yok, eklenen her asistan adiyla yazili', () => {
    const maddeli = BASE_PLANS.filter((p) => p.features_tr.includes(ENGINES_BULLET));
    expect(maddeli.map((p) => p.id)).toEqual(expect.arrayContaining(['starter', 'pro']));
    for (const p of maddeli) {
      for (const dil of DILLER) {
        for (const [ad, olculen] of Object.entries(OLCULEN)) {
          const etiket = `${p.id}/${dil}/${ad}`;
          const madde = enginesBullet(p.id, dil, olculen);
          const kapsam = planEngines(p.id).filter((e) => olculen.includes(e));
          const yazilan = adlar(madde);
          for (const e of yazilan) expect(kapsam, `${etiket}: ${e} kapsam disi`).toContain(e);
          for (const e of kapsam.filter((x) => !STANDARD_ENGINES.includes(x))) expect(yazilan, `${etiket}: eklenen ${e} yazilmamis`).toContain(e);
          expect(sayi(madde), etiket).toBe(kapsam.length);
          expect(imaEdilen(madde, p), etiket).toBe(sayi(madde));
          expect(madde, etiket).not.toMatch(/llama/i);
        }
      }
    }
  });

  it('Baslangic maddesi: dort asistan adiyla; Grok, DeepSeek ve Muse HICBIR kosulda yok', () => {
    for (const dil of DILLER) {
      for (const [ad, olculen] of Object.entries(OLCULEN)) {
        const madde = enginesBullet('starter', dil, olculen);
        expect(adlar(madde).sort(), `${dil}/${ad}`).toEqual([...STANDARD_ENGINES].sort());
        expect(sayi(madde), `${dil}/${ad}`).toBe(4);
        expect(sayi(madde), `${dil}/${ad}`).toBe(findPlan('starter')!.aiProviders);
        expect(madde, `${dil}/${ad}`).not.toMatch(/Grok|DeepSeek|Muse/);
      }
    }
  });

  it('Profesyonel maddesi: alti asistan, Grok ve DeepSeek adiyla; Muse YALNIZ olculuyorsa (o zaman yedi)', () => {
    for (const dil of DILLER) {
      const musesiz = enginesBullet('pro', dil, OLCULEN.musesiz);
      expect(adlar(musesiz), dil).toEqual(expect.arrayContaining(['xai', 'deepseek']));
      expect(sayi(musesiz), dil).toBe(6);
      expect(sayi(musesiz), dil).toBe(findPlan('pro')!.aiProviders);
      expect(musesiz, dil).not.toContain(ENGINE_LABELS.meta);

      const museli = enginesBullet('pro', dil, OLCULEN.museli);
      expect(adlar(museli), dil).toEqual(expect.arrayContaining(['xai', 'deepseek', 'meta']));
      expect(museli, dil).toContain(ENGINE_LABELS.meta);
      expect(sayi(museli), dil).toBe(findPlan('pro')!.aiProviders + 1);
    }
  });

  it('madde yalniz OLCULEN asistani sayar: olculmeyen (anahtarsiz) asistan ne sayida ne metinde', () => {
    for (const dil of DILLER) {
      const eksik = enginesBullet('pro', dil, OLCULEN.musesiz.filter((e) => e !== 'deepseek'));
      expect(eksik, dil).not.toContain(ENGINE_LABELS.deepseek);
      expect(sayi(eksik), dil).toBe(findPlan('pro')!.aiProviders - 1);
    }
  });
});

describe('GET /billing/plans — engines alani ve madde ayni listeden', () => {
  const ORJ = process.env.META_MODEL_API_KEY;
  afterEach(() => {
    if (ORJ === undefined) delete process.env.META_MODEL_API_KEY;
    else process.env.META_MODEL_API_KEY = ORJ;
  });
  const svc = new BillingService(null as never, { getRate: async () => ({ rate: 40, fetchedAt: '', source: 'TCMB', stale: false }) } as never);

  it('satistaki her planda engines.length = asistan maddesinin soyledigi sayi (TR + EN, Muse var/yok); yer tutucu yok', async () => {
    for (const [ad, anahtar] of [['musesiz', undefined], ['museli', 'mm-test']] as const) {
      if (anahtar === undefined) delete process.env.META_MODEL_API_KEY;
      else process.env.META_MODEL_API_KEY = anahtar;
      const olculen = measuredEngines();
      expect(olculen.includes('meta'), ad).toBe(ad === 'museli');
      for (const dil of DILLER) {
        const liste = await svc.getPlans(dil);
        expect(liste.map((p) => p.id), `${dil}/${ad}`).toEqual(publicPlans().map((p) => p.id));
        for (const d of liste) {
          const etiket = `${d.id}/${dil}/${ad}`;
          const plan = findPlan(d.id)!;
          expect(d.features.join('\n'), etiket).not.toContain(ENGINES_BULLET);
          expect(d.engines, etiket).toEqual(planEngines(d.id).filter((e) => olculen.includes(e)));
          const madde = asistanMaddesi(plan, dil, olculen);
          if (madde) expect(d.engines.length, etiket).toBe(sayi(madde));
          // Kendi maddesi olan planin kartinda madde birebir yer alir
          if ((dil === 'tr' ? plan.features_tr : plan.features_en).includes(ENGINES_BULLET)) expect(d.features, etiket).toContain(madde);
          // aiProviders her zaman olculenleri sayar; engines buna yalniz (olculuyorsa) Muse'u ekler
          expect(d.engines.filter((e) => e !== 'meta'), etiket).toHaveLength(d.aiProviders);
          // Plan adinin altindaki tanim plans.ts'ten, secilen dilde
          expect(d.tagline, etiket).toBe(dil === 'tr' ? plan.tagline_tr : plan.tagline_en);
        }
      }
    }
  });

  it('deneme ve Baslangic: Grok, DeepSeek ve Muse HICBIR kosulda engines\'te yok; Profesyonel ve Kurumsal\'da var (Muse yalniz anahtarliyken)', async () => {
    for (const anahtar of [undefined, 'mm-test']) {
      if (anahtar === undefined) delete process.env.META_MODEL_API_KEY;
      else process.env.META_MODEL_API_KEY = anahtar;
      const by = Object.fromEntries((await svc.getPlans('tr')).map((p) => [p.id, p]));
      for (const id of ['trial', 'starter']) {
        expect(by[id].engines, id).toEqual([...STANDARD_ENGINES]);
        for (const e of ['xai', 'deepseek', 'meta']) expect(by[id].engines, `${id}/${e}`).not.toContain(e);
      }
      for (const id of ['pro', 'enterprise']) {
        expect(by[id].engines, id).toEqual(anahtar ? [...BASE_ENGINES, 'meta'] : [...BASE_ENGINES]);
      }
    }
  });
});

/**
 * Kurumsal TEKLIFLE satilir (contactSales): liste fiyati herkese acik plan listesine YAZILMAZ.
 * Kart "Özel" gosterse de GET /billing/plans yaniti /pricing ve ana sayfanin kaynagina prop olarak
 * giriyor; tutar orada okunabiliyordu (bagimsiz inceleme, 11.11.2026).
 */
describe('GET /billing/plans — teklifle satilan planin fiyati yanitta yok', () => {
  const fx = { getRate: async () => ({ rate: 40, fetchedAt: '', source: 'TCMB', stale: false }) };

  it('contactSales planin USD ve TL tutarlari 0; fiyatli planlar plans.ts ile ayni', async () => {
    const { BillingService } = await import('./billing.service.js');
    const { BASE_PLANS: PLANLAR } = await import('./plans.js');
    for (const dil of ['tr', 'en'] as const) {
      const liste = await new BillingService(null as any, fx as any).getPlans(dil);
      const teklifle = liste.filter((p) => p.contactSales);
      expect(teklifle.map((p) => p.id)).toEqual(['enterprise']);
      for (const p of teklifle) {
        expect([p.monthly, p.annual, p.monthlyTry, p.annualTry], `${dil} ${p.id}`).toEqual([0, 0, 0, 0]);
      }
      for (const p of liste.filter((x) => !x.contactSales && x.id !== 'trial')) {
        const tanim = PLANLAR.find((x) => x.id === p.id)!;
        expect(p.monthly, `${dil} ${p.id}`).toBe(tanim.monthly_usd);
        expect(p.annual, `${dil} ${p.id}`).toBe(tanim.annual_usd);
        expect(p.monthlyTry, `${dil} ${p.id}`).toBe(tanim.monthly_usd * 40);
      }
      // Yanitin hicbir yerinde Kurumsal'in liste tutari gecmez
      const kurumsal = PLANLAR.find((x) => x.id === 'enterprise')!;
      const govde = JSON.stringify(liste);
      expect(govde).not.toContain(String(kurumsal.monthly_usd));
      expect(govde).not.toContain(String(kurumsal.annual_usd));
    }
  });

  it('sozlesme tabani tanimda durur; hesabin KENDI plan ozeti (PLANS) etkilenmez', async () => {
    const { PLANS } = await import('./billing.service.js');
    const { findPlan: bul } = await import('./plans.js');
    expect(bul('enterprise')!.monthly_usd).toBeGreaterThan(0);
    expect(PLANS.find((p) => p.id === 'enterprise')!.monthly).toBe(bul('enterprise')!.monthly_usd);
  });
});

