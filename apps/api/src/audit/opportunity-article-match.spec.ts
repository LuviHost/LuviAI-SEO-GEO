import { describe, it, expect } from 'vitest';
import { matchArticleForQuery, significantTokens } from './opportunity-article-match.js';

const A = [
  { id: 'a1', title: 'Damga Vergisi Nasıl Hesaplanır? 2026 Oranları', topic: 'damga vergisi hesaplama', slug: 'damga-vergisi-nasil-hesaplanir' },
  { id: 'a2', title: 'Rotatif Kredi Nedir, Faizi Nasıl Hesaplanır?', topic: 'rotatif kredi', slug: 'rotatif-kredi-faiz-hesaplama' },
  { id: 'a3', title: 'KOBİ\'ler için E-Fatura Rehberi', topic: 'e-fatura', slug: 'kobi-e-fatura-rehberi' },
];

describe('matchArticleForQuery — firsat sorgusu ↔ mevcut makale', () => {
  it('ayni konudaki makale eslesir (govde esitligi: hesaplama ~ hesaplanir)', () => {
    const m = matchArticleForQuery('damga vergisi hesaplama', A);
    expect(m?.article.id).toBe('a1');
    expect(m!.coverage).toBeGreaterThanOrEqual(0.6);
  });

  it('TR katlama: buyuk harf / I-ı farki eslesmeyi bozmaz', () => {
    expect(matchArticleForQuery('ROTATİF KREDİ FAİZİ', A)?.article.id).toBe('a2');
  });

  it('farkli konu eslesmez (yeni makale uretilir)', () => {
    expect(matchArticleForQuery('yaş hesaplama 2026', A)).toBeNull();
    expect(matchArticleForQuery('en iyi ön muhasebe programı', A)).toBeNull();
  });

  it('stop-word ve yil atilir; bos sorgu null', () => {
    expect(significantTokens('en iyi 2026 nedir mi')).toEqual([]);
    expect(matchArticleForQuery('nedir', A)).toBeNull();
  });

  it('en yuksek kapsamli makale secilir', () => {
    const m = matchArticleForQuery('rotatif kredi faiz hesaplama', [...A, { id: 'a4', title: 'Kredi Hesaplama Araçları', topic: 'kredi' }]);
    expect(m?.article.id).toBe('a2');
  });
});
