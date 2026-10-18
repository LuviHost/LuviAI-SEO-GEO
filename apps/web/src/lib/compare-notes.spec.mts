/**
 * Tarama karsilastirmasi notlari: asistan kapsami farki ve yontem degisimi
 * "iyilesti / kotulesti" hukmune donmez.
 * Calistirma: cd apps/web && ../api/node_modules/.bin/vitest run --root . src/lib
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GENEL_SKOR_KONTROLLERI, aiProviderScopeNote, feedsOverallScore, methodChangeNote, overallDeltaComparable } from './compare-notes';

/** API'deki genel skor agirlik tablosunun anahtarlari (kaynak metinden; API modulu import edilmez) */
function apiOverallScoreKeys(): string[] {
  const src = readFileSync(fileURLToPath(new URL('../../../api/src/audit/audit-checks.service.ts', import.meta.url)), 'utf8');
  const start = src.indexOf('export const OVERALL_SCORE_WEIGHTS');
  expect(start, 'OVERALL_SCORE_WEIGHTS bulunamadi').toBeGreaterThan(-1);
  const body = src.slice(src.indexOf('{', start) + 1, src.indexOf('};', start));
  return [...body.matchAll(/^\s*([a-z0-9_]+)\s*:/gim)].map((m) => m[1]);
}

const AD: Record<string, string> = { anthropic: 'Claude', openai: 'ChatGPT', gemini: 'Gemini', perplexity: 'Perplexity' };
const ad = (p: string) => AD[p] ?? p;

describe('aiProviderScopeNote', () => {
  it('farki ortak asistanlarla hesaplandigini ve sorunlarin cozulen/yeni sayilmadigini soyler', () => {
    const n = aiProviderScopeNote({ ortak: ['gemini', 'openai'], yalnizOnceki: ['anthropic'], yalnizSonraki: [] }, ad);
    expect(n).toBe(
      'AI görünürlük ölçümünde iki taramada ölçülen asistanlar farklı: Claude yalnız önceki taramada ölçüldü. '
      + 'AI görünürlük farkı yalnız iki taramada da ölçülen asistanlar (Gemini, ChatGPT) üzerinden hesaplandı; bu ölçümün sorunları çözülen ya da yeni sayılmadı.',
    );
  });

  it('ortak asistan yoksa karsilastirilmadigini soyler', () => {
    const n = aiProviderScopeNote({ ortak: [], yalnizOnceki: ['anthropic'], yalnizSonraki: ['perplexity'] }, ad);
    expect(n).toContain('Claude yalnız önceki taramada, Perplexity yalnız son taramada ölçüldü.');
    expect(n).toContain('ortak asistan olmadığı için AI görünürlük karşılaştırılmadı');
  });
});

describe('methodChangeNote', () => {
  it('yalniz AI gorunurluk yontemi degistiyse genel skor etkilendi denmez', () => {
    const n = methodChangeNote(['aiCitations'], () => 'AI görünürlük ölçümü');
    expect(n).not.toMatch(/Genel skor/);
    expect(n).toContain('farkı hesaplanmadı');
    expect(n).toContain('Bu kontrolün sorunları çözülen ya da yeni sayılmadı.');
  });

  it('genel skora giren kontrolde genel skor notu var', () => {
    const n = methodChangeNote(['image_alt', 'geo'], (id) => (id === 'image_alt' ? 'Görsel alt metni' : 'AI arama (GEO)'));
    expect(n).toContain('Ölçüm yöntemi güncellendi: Görsel alt metni, AI arama (GEO).');
    expect(n).toContain('Genel skor farkının bir kısmı');
    expect(n).toContain('GEO skor farkı bu yüzden hesaplanmadı.');
    expect(n).toContain('Bu kontrollerin sorunları');
  });
});

describe('genel skora giren kontroller = API OVERALL_SCORE_WEIGHTS', () => {
  it('panel listesi API tablosuyla ayni (CSV olcumYontemiNotu ayni tabloyu kullanir)', () => {
    const keys = apiOverallScoreKeys();
    expect(keys.length).toBe(14);
    expect([...GENEL_SKOR_KONTROLLERI].sort()).toEqual([...keys].sort());
  });

  it('tabloda olmayan anahtar (eski / skor disi olcum) genel skor notu ve notr rozet uretmez', () => {
    for (const id of ['crawlCoverage', 'pagespeed', 'geo', 'aiCitations', 'local_pack']) expect(feedsOverallScore(id), id).toBe(false);
    expect(methodChangeNote(['local_pack'])).not.toMatch(/Genel skor/);
    expect(overallDeltaComparable({ metodolojiDegisen: ['local_pack'] })).toBe(true);
  });
});

describe('overallDeltaComparable', () => {
  it('genel skora giren kontrolun yontemi degistiyse ya da kapsami farkliysa hukum yok', () => {
    expect(overallDeltaComparable({ metodolojiDegisen: ['image_alt'] })).toBe(false);
    expect(overallDeltaComparable({ kismi: { skorKapsamiFarkli: ['robots_txt'] } })).toBe(false);
  });

  it('yalniz GEO / AI gorunurluk yontemi degistiyse genel skor hukmu gecerli', () => {
    expect(overallDeltaComparable({ metodolojiDegisen: ['aiCitations', 'geo'] })).toBe(true);
    expect(overallDeltaComparable({})).toBe(true);
    expect(overallDeltaComparable({ kismi: { skorKapsamiFarkli: [] } })).toBe(true);
  });
});
