import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { groupLockedByPlan, lockedEnginesFrom, planEngineCount } from './locked-engines';

/**
 * Ucretsiz test sonucunda kilitli asistanlar (sahip istegi 15.11.2026).
 * Kural: liste ve plan adi sunucunun plan yanitindan; web asistan tablosu tutmaz ve
 * olculmeyen bir asistani vaat etmez.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(path.resolve(HERE, rel), 'utf8');

const FREE = ['openai', 'gemini', 'anthropic', 'perplexity'];
// GET /billing/plans sirasi (dusukten yuksege); Muse anahtari tanimli kurulum
const PLANS = [
  { id: 'trial', name: 'Deneme', engines: FREE },
  { id: 'starter', name: 'Başlangıç', engines: FREE },
  { id: 'pro', name: 'Profesyonel', engines: [...FREE, 'xai', 'deepseek', 'meta'] },
  { id: 'enterprise', name: 'Kurumsal', engines: [...FREE, 'xai', 'deepseek', 'meta'] },
];

describe('lockedEnginesFrom', () => {
  it('testin sormadigi asistanlar, onlari olcen EN DUSUK planin adiyla', () => {
    expect(lockedEnginesFrom(PLANS, FREE)).toEqual([
      { provider: 'xai', planName: 'Profesyonel' },
      { provider: 'deepseek', planName: 'Profesyonel' },
      { provider: 'meta', planName: 'Profesyonel' },
    ]);
  });

  it('Muse anahtari yoksa (sunucu listelemiyor) gosterilmez: vaat sunucunun olctugu kadar', () => {
    const musesiz = PLANS.map((p) => ({ ...p, engines: p.engines.filter((e) => e !== 'meta') }));
    expect(lockedEnginesFrom(musesiz, FREE).map((e) => e.provider)).toEqual(['xai', 'deepseek']);
  });

  it('sorulan asistan kilitli sayilmaz; hepsi sorulduysa (uye testi) liste bos', () => {
    expect(lockedEnginesFrom(PLANS, [...FREE, 'xai'])).toEqual([
      { provider: 'deepseek', planName: 'Profesyonel' },
      { provider: 'meta', planName: 'Profesyonel' },
    ]);
    expect(lockedEnginesFrom(PLANS, [...FREE, 'xai', 'deepseek', 'meta'])).toEqual([]);
  });

  it('plan listesi okunamadi / eski API (engines yok) / bos sonuc: hicbir sey gosterilmez', () => {
    expect(lockedEnginesFrom(null, FREE)).toEqual([]);
    expect(lockedEnginesFrom(undefined, FREE)).toEqual([]);
    expect(lockedEnginesFrom([{ id: 'pro', name: 'Profesyonel' }], FREE)).toEqual([]);
    expect(lockedEnginesFrom([{ id: 'pro', name: 'Profesyonel', engines: null }], FREE)).toEqual([]);
    expect(lockedEnginesFrom(PLANS, [])).toEqual([]);
    // Adsiz plan: "… planda ölçülür" yazilamaz
    expect(lockedEnginesFrom([{ id: 'pro', name: ' ', engines: ['xai'] }], FREE)).toEqual([]);
  });

  it('bicim disi satirlar atlanir, tekrar eden asistan bir kez doner', () => {
    const karisik = [
      { id: 'pro', name: 'Profesyonel', engines: ['xai', '', 42 as unknown as string, 'xai'] },
      { id: 'enterprise', name: 'Kurumsal', engines: ['xai', 'yeni'] },
    ];
    expect(lockedEnginesFrom(karisik, FREE)).toEqual([
      { provider: 'xai', planName: 'Profesyonel' },
      { provider: 'yeni', planName: 'Kurumsal' },
    ]);
  });
});

describe('groupLockedByPlan / planEngineCount', () => {
  it('plan basina tek grup, sira korunur', () => {
    expect(groupLockedByPlan(lockedEnginesFrom(PLANS, FREE))).toEqual([
      { planName: 'Profesyonel', providers: ['xai', 'deepseek', 'meta'] },
    ]);
    expect(groupLockedByPlan([])).toEqual([]);
  });

  it('planin olctugu asistan sayisi; bilinmiyorsa null (sayi uydurulmaz)', () => {
    expect(planEngineCount(PLANS, 'starter')).toBe(4);
    expect(planEngineCount(PLANS, 'pro')).toBe(7);
    expect(planEngineCount(PLANS, 'yok')).toBeNull();
    expect(planEngineCount(null, 'pro')).toBeNull();
    expect(planEngineCount([{ id: 'pro', name: 'Profesyonel' }], 'pro')).toBeNull();
  });
});

describe('sonuc ekrani baglantisi', () => {
  const overlay = read('../components/landing/checker-overlay.tsx');
  const card = read('../components/citation/query-card.tsx');
  const copy = read('../components/landing/checker-copy.ts');

  it('liste sunucunun plan yanitindan turetilir; sabit asistan listesi yok', () => {
    expect(overlay).toContain('api.getPlans(locale)');
    expect(overlay).toContain('lockedEnginesFrom(plans, asked)');
    expect(overlay).toContain('lockedEngines={lockedEngines}');
  });

  // Bagimsiz inceleme (15.11.2026): saglayici duzeyinde dusen asistan sonuca satir olarak girmez.
  // "Sorulanlar" yalniz satirlardan cikarilirsa o asistan, onu listeleyen ILK planin (deneme)
  // adiyla kilitli cizilirdi: "Gemini — Ücretsiz Deneme planda ölçülür".
  it('testin kapsamindaki asistan sonucta satir olarak yoksa da kilitli SAYILMAZ', () => {
    const satirlar = ['openai', 'anthropic', 'perplexity']; // gemini saglayici duzeyinde dustu
    expect(lockedEnginesFrom(PLANS, satirlar).map((e) => `${e.provider}@${e.planName}`)).toContain('gemini@Deneme');
    expect(lockedEnginesFrom(PLANS, [...FREE, ...satirlar])).toEqual([
      { provider: 'xai', planName: 'Profesyonel' },
      { provider: 'deepseek', planName: 'Profesyonel' },
      { provider: 'meta', planName: 'Profesyonel' },
    ]);
    // Ekran: kapsam ayni yanittan (freeTestEngines); alan yoksa hic kilitli asistan cizilmez
    expect(overlay).toContain('freeTestEngines');
    expect(overlay).toContain('if (!result || !freeEngines) return [];');
    expect(overlay).toContain('const asked = [...freeEngines, ...result.queries');
  });

  it('kilitli grup dar ekranda tasmaz: kendi icinde alt satira inebilir', () => {
    const blok = card.slice(card.indexOf('{lockedGroups.map('), card.indexOf('<ResponsesToggle'));
    expect(blok).toContain('flex min-w-0 flex-wrap items-center');
  });

  it('kilitli asistan bir sonuc gibi cizilmez: kilit rozeti var, sayiya girmez', () => {
    const blok = card.slice(card.indexOf('{lockedGroups.map('), card.indexOf('<ResponsesToggle'));
    expect(blok).toContain('<Lock ');
    expect(blok).not.toMatch(/<Check |<X /);
    // Sayi sunucunun citedCount / totalProviders'i; kilitli asistan eklenmez
    expect(card).toContain('{q.citedCount}');
    expect(card).toContain('{q.totalProviders}');
    expect(card).not.toMatch(/totalProviders\s*\+/);
  });

  it('metindeki asistan sayilari yer tutucu: sabit "6 AI motorunda" kalmadi', () => {
    for (const dil of ['tr', 'en'] as const) {
      const blok = copy.slice(copy.indexOf(`${dil}: {`));
      const body = blok.slice(blok.indexOf('unlockBody:'), blok.indexOf('unlockCta:'));
      expect(body).toContain('{starter}');
      expect(body).toContain('{pro}');
      expect(body).not.toMatch(/\b[4-7] AI (motor|engine)/);
      expect(body).toContain('lockedEngines:');
      expect(body).toContain('{plan}');
    }
    expect(overlay).toContain(".replace('{starter}', String(planEngineCount(plans, 'starter') ?? 4))");
    expect(overlay).toContain(".replace('{pro}', String(planEngineCount(plans, 'pro') ?? 6))");
  });
});
