import { describe, it, expect } from 'vitest';
import { DEFAULT_COMPARE_SCOPE, compareScopeFrom, fillCompareScope } from './compare-scope';

/** /compare asistan sayilari o an olculen kapsamdan (16.11.2026, sahip: "değiştir") */
const BAS = ['openai', 'gemini', 'anthropic', 'perplexity', 'google_ai_mode', 'google_ai_overview'];
const PRO = ['openai', 'gemini', 'anthropic', 'perplexity', 'xai', 'deepseek', 'meta', 'google_ai_mode', 'google_ai_overview'];

describe('compareScopeFrom', () => {
  it('Muse olculurken Profesyonel 7, Baslangic 4; Google yuzeyleri asistan sayilmaz', () => {
    expect(compareScopeFrom([{ id: 'starter', engines: BAS }, { id: 'pro', engines: PRO }])).toEqual({ pro: 7, bas: 4, muse: true });
  });

  it('Muse anahtari yoksa 6', () => {
    expect(compareScopeFrom([{ id: 'starter', engines: BAS }, { id: 'pro', engines: PRO.filter((e) => e !== 'meta') }])).toEqual({ pro: 6, bas: 4, muse: false });
  });

  it('API yaniti yok ya da eski (engines alani yok): her zaman olculen 6 / 4 — dogrulanamayan vaat yok', () => {
    expect(compareScopeFrom([])).toEqual(DEFAULT_COMPARE_SCOPE);
    expect(compareScopeFrom([{ id: 'starter' }, { id: 'pro' }])).toEqual({ pro: 6, bas: 4, muse: false });
  });
});

describe('fillCompareScope', () => {
  const muse = { pro: 7, bas: 4, muse: true };
  it('TR ve EN yer tutucular', () => {
    expect(fillCompareScope('{PRO} asistan (Başlangıç’ta {BAS})', 'tr', muse)).toBe('7 asistan (Başlangıç’ta 4)');
    expect(fillCompareScope('{EK} Profesyonel ve üstü planlarda', 'tr', muse)).toBe('Grok, DeepSeek ve Muse Profesyonel ve üstü planlarda');
    expect(fillCompareScope('{EK} included', 'en', muse)).toBe('Grok, DeepSeek and Muse included');
    expect(fillCompareScope('{TUM};', 'tr', DEFAULT_COMPARE_SCOPE)).toBe('ChatGPT, Claude, Gemini, Perplexity, Grok ve DeepSeek;');
    expect(fillCompareScope('{TUM};', 'en', muse)).toBe('ChatGPT, Claude, Gemini, Perplexity, Grok, DeepSeek and Muse;');
  });
});
