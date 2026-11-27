import { describe, expect, it } from 'vitest';
import { SonucKasasi, kapiEposta, kilitliSonuc, yeniKapiAnahtari } from './public-check-gate.js';

const sonuc = {
  domain: 'ornek.com',
  brand: 'Ornek',
  queries: [
    { query: 'a', providers: [{ provider: 'openai', excerpt: 'gizli' }, { provider: 'gemini' }] },
    { query: 'b', providers: [{ provider: 'openai' }, { provider: 'perplexity' }] },
    { query: 'c', locked: true, providers: [] },
  ],
  competitorRanking: [{ name: 'Rakip', mentions: 2, pct: 50 }],
};

describe('ucretsiz test e-posta kapisi', () => {
  it('kilitli sonuc soru ve rakip verisi tasimaz; ozet sayilari dogru', () => {
    const k = kilitliSonuc(sonuc, 'x');
    expect(k.queries).toEqual([]);
    expect(k.competitorRanking).toEqual([]);
    expect(JSON.stringify(k)).not.toContain('gizli');
    expect(k.kilit).toEqual({ anahtar: 'x', soru: 2, asistan: 3 });
    expect(k.domain).toBe('ornek.com');
  });

  it('e-posta dogrulama', () => {
    expect(kapiEposta('  Ali@Firma.com.tr ')).toBe('ali@firma.com.tr');
    expect(kapiEposta('ali@firma')).toBeNull();
    expect(kapiEposta('ali firma@x.com')).toBeNull();
    expect(kapiEposta(42)).toBeNull();
  });

  it('anahtar 48 hex', () => {
    expect(yeniKapiAnahtari()).toMatch(/^[a-f0-9]{48}$/);
  });

  it('kasa: sure dolunca bos, tavan dolunca en eski atilir', () => {
    let t = 0;
    const kasa = new SonucKasasi<number>(1000, 2, () => t);
    kasa.koy('a', { sonuc: 1, domain: 'a.com', ipHash: 'h' });
    kasa.koy('b', { sonuc: 2, domain: 'b.com', ipHash: 'h' });
    kasa.koy('c', { sonuc: 3, domain: 'c.com', ipHash: 'h' });
    expect(kasa.al('a')).toBeNull();
    expect(kasa.al('b')?.sonuc).toBe(2);
    t = 1000;
    expect(kasa.al('c')).toBeNull();
  });
});
