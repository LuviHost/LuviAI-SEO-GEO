import { describe, it, expect } from 'vitest';
import { BASE_PLANS } from './plans.js';

/**
 * aiProviders = bir calistirmada OLCULEN AI asistani sayisi.
 *
 * NEDEN VAR: alan 7 yaziyordu ama Llama (Groq) yalniz GROQ_LLAMA_MODEL
 * tanimliyken olculuyor (ai-citation.service.ts); varsayilan kurulumda 6
 * asistan olculur. Kart maddeleri zaten 6 adi listeliyor — plan alani da
 * ayni sayiyi tasimali, yoksa /billing/plans cevabi kendi maddesiyle celisir.
 */
describe('plans.ts aiProviders', () => {
  const liste = BASE_PLANS.flatMap((p) => p.features_tr).find((m) => m.startsWith('ChatGPT · '));

  it('listelenen asistanlar Llama icermez ve 6 tanedir', () => {
    expect(liste).toBeDefined();
    const adlar = liste!.split(' · ');
    expect(adlar).toEqual(['ChatGPT', 'Claude', 'Gemini', 'Perplexity', 'Grok', 'DeepSeek']);
  });

  it('her planin aiProviders degeri listelenen asistan sayisiyla ayni', () => {
    const n = liste!.split(' · ').length;
    for (const p of BASE_PLANS) expect(p.aiProviders, p.id).toBe(n);
  });
});
