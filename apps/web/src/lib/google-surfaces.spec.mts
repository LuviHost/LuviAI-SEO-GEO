import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { isProbeAbsentText, isProbeErrorText, probeErrorText } from './probe-error-text';
import { planEngineCount, lockedEnginesFrom } from './locked-engines';
import { GOOGLE_SURFACES, PROVIDER_LABELS, isGoogleSurface } from './chart-colors';

/**
 * Google AI Modu ve AI Bakisi panelde (sahip, 16.11.2026): "ekle ve landing page'e logolarını da
 * koy"; "AI Bakışı'nın görünmediği soruları ayrı yazalım, 'anılmadın' diye göstermeyiz".
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const oku = (rel: string) => readFileSync(path.join(HERE, rel), 'utf8');

describe('"Bu soruda AI Bakışı yok" satiri', () => {
  const YOK = 'YOK: Google bu aramada AI Bakışı göstermedi.';

  it('olcum disi (skor, sayac, "anildi / anilmadi" disinda) ama hata degil; kendi cumlesiyle yazilir', () => {
    expect(isProbeErrorText(YOK)).toBe(true);
    expect(isProbeAbsentText(YOK)).toBe(true);
    expect(isProbeAbsentText('HATA: rate_limited')).toBe(false);
    expect(probeErrorText(YOK)).toBe('Google bu aramada AI Bakışı göstermedi.');
    expect(probeErrorText('YOK:')).toBe('Google bu aramada yapay zekâ cevabı göstermedi.');
    // Siradan cevap metni dokunulmaz
    expect(isProbeErrorText('Örnek Lojistik önerilir')).toBe(false);
  });

  it('gecmis tablosu "Bahsetmedi" ya da "Ölçülemedi" degil "Bu soruda yok" yazar', () => {
    const grafik = oku('../components/citation-history-chart.tsx');
    expect(grafik).toContain("if (isProbeAbsentText(p?.excerpt)) return { label: 'Bu soruda yok · skor dışı'");
    expect(grafik).toContain('Google bu sorularda yapay zekâ cevabı göstermedi; skor hesaplanmadı.');
    // Siralama: "yok" kontrolu hata kontrolunden ONCE (yoksa "Ölçülemedi" yazardi)
    expect(grafik.indexOf("isProbeAbsentText(p?.excerpt)) return")).toBeLessThan(grafik.indexOf("if (isProbeErrorText(p?.excerpt)) return"));
  });
});

describe('ad, logo ve sayilar', () => {
  it('adlar ve Google isareti', () => {
    expect([...GOOGLE_SURFACES]).toEqual(['google_ai_mode', 'google_ai_overview']);
    expect(PROVIDER_LABELS.google_ai_mode).toBe('Google AI Modu');
    expect(PROVIDER_LABELS.google_ai_overview).toBe('Google AI Bakışı');
    const logo = oku('../components/engine-logo.tsx');
    expect(logo).toMatch(/google_ai_mode: 'google',\s*google_ai_overview: 'google',/);
    expect(isGoogleSurface('openai')).toBe(false);
  });

  it('plan "N AI motorunda ölçer" sayisi asistanlari sayar, Google yuzeylerini degil', () => {
    const plans = [
      { id: 'starter', name: 'Başlangıç', engines: ['openai', 'gemini', 'anthropic', 'perplexity', 'google_ai_mode', 'google_ai_overview'] },
      { id: 'pro', name: 'Profesyonel', engines: ['openai', 'gemini', 'anthropic', 'perplexity', 'xai', 'deepseek', 'meta', 'google_ai_mode', 'google_ai_overview'] },
    ];
    expect(planEngineCount(plans, 'starter')).toBe(4);
    expect(planEngineCount(plans, 'pro')).toBe(7);
    // Ucretsiz testte sorulmayan Google yuzeyleri Baslangic planinin adiyla kilitli gorunur
    const kilitli = lockedEnginesFrom(plans, ['openai', 'gemini', 'anthropic', 'perplexity']);
    expect(kilitli.filter((k) => isGoogleSurface(k.provider))).toEqual([
      { provider: 'google_ai_mode', planName: 'Başlangıç' },
      { provider: 'google_ai_overview', planName: 'Başlangıç' },
    ]);
  });
});

describe('ana sayfa seridi', () => {
  it('Google yuzeyleri YALNIZ API "su an olculuyor" derse girer (anahtar yoksa vaat yok)', () => {
    const serit = oku('../components/landing/answer-sheet.tsx');
    expect(serit).toContain("{ provider: 'google_ai_mode', label: 'Google AI Modu', vendor: 'google' }");
    expect(serit).toContain("{ provider: 'google_ai_overview', label: 'Google AI Bakışı', vendor: 'google' }");
    expect(serit).toContain('GOOGLE_STRIP.filter((g) => measuredProviders?.includes(g.provider))');
    // Ayni logo iki satirda: React anahtari ad
    expect(oku('../components/landing/ai-checker-hero.tsx')).toContain('key={label}');
  });

  it('serit "N AI platformunda" der (Google aramasi bir asistan degil)', () => {
    const i18n = oku('./i18n.ts');
    expect(i18n).toContain("'land3.engines': '{n} AI platformunda ölçülür'");
    expect(i18n).toContain("'land3.engines': 'Measured across {n} AI platforms'");
  });
});

describe('uye tam raporu (query-card, checker-overlay)', () => {
  it('Google satiri logoyla gelir; "yok" satiri "yanıt alınamadı" degil "bu soruda yok" yazar', () => {
    const kart = oku('../components/citation/query-card.tsx');
    expect(kart).toMatch(/google_ai_mode: 'google',\s*google_ai_overview: 'google',/);
    expect(kart).toContain("google_ai_overview: 'AI Bakışı'");
    expect(kart).toContain('const yok = isProbeAbsentText(p.excerpt);');
    expect(kart).toContain('bu soruda yok, skor dışı');
    const pano = oku('../components/landing/checker-overlay.tsx');
    expect(pano).toContain('isProbeAbsentText(p.excerpt) ? c.paneSurfaceAbsent : c.paneNoAnswer');
    const metin = oku('../components/landing/checker-copy.ts');
    expect(metin).toContain("paneSurfaceAbsent: 'Bu soruda yok · skor dışı'");
    expect(metin).toContain("paneSurfaceAbsent: 'Not shown for this query · not scored'");
  });
});
