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
    expect(controller).toContain('measuredEngines: measuredEngines()');
  });

  it('web: Muse sabit MEASURED listesinde degil, kosullu ekleniyor', () => {
    const sheet = read('components/landing/answer-sheet.tsx');
    const measured = sheet.slice(sheet.indexOf('export const MEASURED'), sheet.indexOf('];', sheet.indexOf('export const MEASURED')));
    expect(measured).not.toMatch(/muse|meta/i);
    expect(sheet).toContain("measuredProviders?.includes('meta') ? [...MEASURED, MUSE] : MEASURED");
    // Sayfa listeyi API'den alip hero'ya geciriyor; sayi metne sabit yazilmiyor
    expect(read('app/page.tsx')).toContain('<AiCheckerHero engines={engines} />');
    expect(read('components/landing/ai-checker-hero.tsx')).toContain("replace('{n}', String(strip.length))");
  });
});
