import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE_ENGINES, measuredEngines } from './measured-engines.js';
import { BASE_PLANS, planEngines } from './plans.js';

/**
 * Ana sayfadaki "N asistanda ölçülür" seridi = bu kurulumda gercekten olculenler.
 *
 * NEDEN: Muse (Meta) yalniz META_MODEL_API_KEY tanimliyken olculur. Serit onu
 * sabit listeden gosterirse anahtar yokken (ya da kaldirilinca) olcmedigimiz
 * bir asistani vaat eder. Kaynak GET /billing/plans → measuredEngines.
 */
describe('measuredEngines', () => {
  it('anahtar yokken yalniz 6 sabit asistan — Meta yok', () => {
    expect(measuredEngines({})).toEqual([...BASE_ENGINES]);
    expect(measuredEngines({ META_MODEL_API_KEY: '' })).not.toContain('meta');
  });

  it('META_MODEL_API_KEY tanimliyken Meta (Muse) sona eklenir', () => {
    expect(measuredEngines({ META_MODEL_API_KEY: 'x' })).toEqual([...BASE_ENGINES, 'meta']);
  });

  // 11.11.2026 (uc paket): sabit liste urunun EN GENIS kapsami. Eskiden her plan bu sayiyi
  // vaat ediyordu; artik Baslangic ve deneme dort asistan olcer (plans.ts planEngines).
  it('sabit liste = Profesyonel ve ustunun vaat ettigi sayi; Baslangic ve deneme kapsamindaki dort (aiProviders)', () => {
    for (const p of BASE_PLANS) {
      const kapsam = planEngines(p.id).filter((e) => BASE_ENGINES.includes(e));
      expect(p.aiProviders, p.id).toBe(kapsam.length);
      // Hicbir plan, her kurulumda olculenden fazlasini vaat etmez
      expect(p.aiProviders, p.id).toBeLessThanOrEqual(BASE_ENGINES.length);
    }
    for (const id of ['pro', 'agency', 'enterprise']) expect(BASE_PLANS.find((p) => p.id === id)!.aiProviders, id).toBe(BASE_ENGINES.length);
    for (const id of ['trial', 'starter']) expect(BASE_PLANS.find((p) => p.id === id)!.aiProviders, id).toBe(4);
    expect(BASE_ENGINES).toHaveLength(6);
  });
});

describe('kaynak: serit Muse\'u yalniz API yanitiyla gosterir', () => {
  const HERE = path.dirname(fileURLToPath(import.meta.url));
  const WEB = path.resolve(HERE, '../../../web/src');
  const read = (rel: string) => fs.readFileSync(path.join(WEB, rel), 'utf8');

  it('GET /billing/plans yaniti measuredEngines tasir', () => {
    const controller = fs.readFileSync(path.join(HERE, 'billing.controller.ts'), 'utf8');
    expect(controller).toContain('const olculen = measuredEngines();');
    expect(controller).toContain('measuredEngines: olculen,');
    // Ucretsiz testin sordugu asistanlar da ayni yanitta: plan-engines FREE_TEST_ENGINES ∩ olculenler
    expect(controller).toContain('freeTestEngines: FREE_TEST_ENGINES.filter((e) => olculen.includes(e))');
  });

  // 11.11.2026 (canli olcum): ucretsiz test yedi asistana sorarken test basina ~1.34 USD tutuyordu
  // (Grok tek basina ~0.70); dort asistanla ~0.21 USD. Ucretsiz test deneme ve Baslangic ile ayni
  // dort asistana sorar; Grok, DeepSeek ve Muse Profesyonel ozelligi.
  it('ucretsiz testin asistanlari = deneme ve Baslangic kapsami (dort); Profesyonel ozelligi olanlar yok', async () => {
    const { FREE_TEST_ENGINES } = await import('./plan-engines.js');
    const { planEngines, STANDARD_ENGINES } = await import('./plans.js');
    expect([...FREE_TEST_ENGINES]).toEqual([...STANDARD_ENGINES]);
    expect([...FREE_TEST_ENGINES]).toEqual(planEngines('trial'));
    expect([...FREE_TEST_ENGINES]).toEqual(planEngines('starter'));
    for (const e of ['xai', 'deepseek', 'meta']) expect(FREE_TEST_ENGINES, e).not.toContain(e);
    // Her biri her kurulumda olculen asistanlardan (kosullu asistan ucretsiz teste girmez)
    for (const e of FREE_TEST_ENGINES) expect(BASE_ENGINES, e).toContain(e);
  });

  // 11.11.2026 (bagimsiz inceleme): ucretsiz test dort asistana inince onu anlatan dort metin
  // hala "ChatGPT, Claude, Gemini, Perplexity, Grok ve DeepSeek" diyordu (rehber sayfalarindaki
  // test ipucu, mobil ana ekran, abone e-postasi — o sonuncusu artik koddan uretiliyor:
  // public-citation-subscriber.spec). Ucretsiz testi anlatan metin sormadigimiz asistani saymaz.
  it('ucretsiz testi anlatan metinler yalniz sorulan dort asistani sayar (rehber ipuclari, mobil ana ekran)', async () => {
    const { FREE_TEST_ENGINES } = await import('./plan-engines.js');
    const { ENGINE_LABELS } = await import('./plans.js');
    const adlar = FREE_TEST_ENGINES.map((e) => ENGINE_LABELS[e]);
    expect(adlar).toEqual(['ChatGPT', 'Gemini', 'Claude', 'Perplexity']);
    const tr = `${adlar.slice(0, -1).join(', ')} ve ${adlar[adlar.length - 1]}`;
    const en = `${adlar.slice(0, -1).join(', ')} and ${adlar[adlar.length - 1]}`;
    for (const rel of ['content/rehber/chatgpt-markam-gorunuyor-mu.ts', 'content/rehber/yapay-zeka-gorunurlugu.ts']) {
      const ipucu = read(rel).split('\n').filter((l) => l.includes('Alan adını yaz; sitene uygun alıcı sorularını'));
      expect(ipucu, rel).toHaveLength(1);
      expect(ipucu[0], rel).toContain(`sitene uygun alıcı sorularını ${tr}’ye soralım`);
      expect(ipucu[0], rel).not.toMatch(/Grok|DeepSeek|Muse/);
    }
    const mobil = fs.readFileSync(path.resolve(HERE, '../../../../mobile/src/i18n.ts'), 'utf8');
    const anaEkran = mobil.split('\n').filter((l) => /^\s*home_sub: '/.test(l));
    expect(anaEkran).toHaveLength(2);
    expect(anaEkran[0]).toContain(`${tr}’nin sektörüne dair sorulara`);
    expect(anaEkran[1]).toContain(`whether ${en} mention your brand`);
    for (const l of anaEkran) expect(l).not.toMatch(/Grok|DeepSeek|Muse/);
  });

  it('web: Muse sabit MEASURED listesinde degil, kosullu ekleniyor', () => {
    const sheet = read('components/landing/answer-sheet.tsx');
    const measured = sheet.slice(sheet.indexOf('export const MEASURED'), sheet.indexOf('];', sheet.indexOf('export const MEASURED')));
    expect(measured).not.toMatch(/muse|meta/i);
    expect(sheet).toContain("measuredProviders?.includes('meta') ? [...MEASURED, MUSE] : MEASURED");
    // Sayfa listeyi API'den alip hero'ya geciriyor; sayi metne sabit yazilmiyor
    expect(read('app/page.tsx')).toContain('<AiCheckerHero engines={engines} testEngines={testEngines} />');
    const hero = read('components/landing/ai-checker-hero.tsx');
    // Serit: urunun olctugu butun asistanlar (API measuredEngines)
    expect(hero).toContain("t('land3.engines').replace('{n}', String(strip.length))");
    // "N AI asistaninda test edelim": UCRETSIZ TESTIN sayisi (API freeTestEngines); seridin sayisi
    // yazilirsa ziyaretciye sormayacagimiz asistanlar vaat edilir. Alan yoksa (eski API) seride duser.
    expect(hero).toContain("t('land3.hero.checker').replace('{n}', String(testEngines?.length ? testEngines.length : strip.length))");
    expect(read('app/page.tsx')).toContain('fetchFreeTestEngines()');
    expect(read('components/landing/landing-data.ts')).toContain('data?.freeTestEngines');
  });
});
