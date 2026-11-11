import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE_ENGINES, measuredEngines } from './measured-engines.js';
import { BASE_PLANS } from './plans.js';

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

  it('sabit liste plan kartlarinin vaat ettigi sayiyla ayni (aiProviders)', () => {
    for (const p of BASE_PLANS) expect(p.aiProviders, p.id).toBe(BASE_ENGINES.length);
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
