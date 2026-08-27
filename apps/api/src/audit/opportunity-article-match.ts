import { foldForMatch } from '../common/text-normalize.js';

/**
 * Firsat sorgusu ↔ mevcut makale eslesmesi — saf.
 *
 * NEDEN: Kapali dongu LOST/WEAK soruya HEP yeni makale uretiyordu. Iki
 * bagimsiz kaynak (defter: ai-freshness-comes-from-updates-not-new-publishing
 * + Semrush AI arama playbook'u madde 11 "eski icerigi guncelle") ayni seyi
 * soyluyor: AI atif tazeligi yeni yayindan degil GUNCELLEMEDEN geliyor; yakin
 * kopyalar sinyali boler. Bu yuzden once "bu soruyu zaten cevaplayan bir
 * makalemiz var mi?" diye bakilir; varsa yeni uretim yerine guncelleme.
 *
 * ESLESME KURALI (LLM yok, deterministik): sorgunun anlamli kelimeleri
 * (>=3 harf, stop-word disi, TR katlamali) makalenin baslik+konu metninde
 * gecme orani. Esik 0.6 — "damga vergisi hesaplama" ↔ "Damga Vergisi Nasil
 * Hesaplanir? 2026" eslesir (damga, vergisi ✓; hesaplama ~ hesaplanir ✗ ->
 * govde eslemesi icin ilk 5 harf karsilastirilir: "hesap" ✓).
 */

const STOP = new Set([
  've', 'ile', 'icin', 'için', 'mi', 'mı', 'mu', 'mü', 'nedir', 'nasil', 'nasıl', 'ne', 'en', 'iyi', 'bir', 'the', 'a', 'an',
  'of', 'for', 'to', 'in', 'on', 'is', 'are', 'how', 'what', 'which', 'best', 'hangi', 'neden', 'kac', 'kaç', '2024', '2025', '2026',
]);

export function significantTokens(text: string): string[] {
  return foldForMatch(text || '')
    .split(/[^a-z0-9ğüşöçı]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !STOP.has(t));
}

/** Govde esitligi: ilk 5 harf ayni ise (hesaplama ~ hesaplanir, kredisi ~ kredi) */
function stemEq(a: string, b: string): boolean {
  if (a === b) return true;
  const n = Math.min(5, a.length, b.length);
  return n >= 4 && a.slice(0, n) === b.slice(0, n);
}

export interface MatchableArticle {
  id: string;
  title: string;
  topic?: string | null;
  slug?: string | null;
}

export interface ArticleMatch {
  article: MatchableArticle;
  /** sorgu kelimelerinin makalede bulunma orani 0-1 */
  coverage: number;
}

export const ARTICLE_MATCH_THRESHOLD = 0.6;

export function matchArticleForQuery(query: string, articles: MatchableArticle[], threshold = ARTICLE_MATCH_THRESHOLD): ArticleMatch | null {
  const q = significantTokens(query);
  if (q.length === 0) return null;
  let best: ArticleMatch | null = null;
  for (const a of articles) {
    const hay = significantTokens(`${a.title} ${a.topic ?? ''} ${(a.slug ?? '').replace(/-/g, ' ')}`);
    if (hay.length === 0) continue;
    const hit = q.filter((t) => hay.some((h) => stemEq(t, h))).length;
    const coverage = hit / q.length;
    if (coverage >= threshold && (!best || coverage > best.coverage)) best = { article: a, coverage };
  }
  return best;
}
