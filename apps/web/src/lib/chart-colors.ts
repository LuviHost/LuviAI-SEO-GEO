/**
 * Grafik paleti — TEK kaynak. Renk degerleri globals.css'teki --chart-N
 * degiskenlerinden gelir (light/dark orada ayri tanimli; recharts ve SVG'ler
 * hsl(var(--chart-N)) string'ini dogrudan kabul eder → dark mode otomatik).
 *
 * NEDEN: paletler dosya ici hex map olarak 3+ yerde kopyaliydi
 * (citation-history-chart, ai-kpi-strip, analytics-tab) ve dark modda tek
 * tondaydi. Yeni grafik yazan HERKES buradan import eder; bilesen icinde hex yasak.
 */

export const CHART = {
  1: 'hsl(var(--chart-1))', // brand orange
  2: 'hsl(var(--chart-2))', // emerald
  3: 'hsl(var(--chart-3))', // blue
  4: 'hsl(var(--chart-4))', // violet
  5: 'hsl(var(--chart-5))', // sky
  6: 'hsl(var(--chart-6))', // red
  7: 'hsl(var(--chart-7))', // amber
  8: 'hsl(var(--chart-8))', // slate — "diger"
} as const;

/** AI saglayici → renk. Grafiklerde ve rozetlerde ayni eslesme kullanilir. */
export const PROVIDER_COLORS: Record<string, string> = {
  anthropic: CHART[4],  // mor — Claude
  gemini: CHART[3],     // mavi — Gemini
  openai: CHART[2],     // yesil — ChatGPT
  perplexity: CHART[1], // turuncu — Perplexity
  xai: CHART[6],        // kirmizi — Grok (backend "xai" dondurur)
  grok: CHART[6],       // alias (geri uyum)
  deepseek: CHART[5],   // sky — DeepSeek
  meta: CHART[8],       // slate — meta
};

export const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Claude',
  gemini: 'Gemini',
  openai: 'ChatGPT',
  perplexity: 'Perplexity',
  xai: 'Grok (xAI)',
  grok: 'Grok (xAI)',
  deepseek: 'DeepSeek',
  meta: 'meta',
};

/** Bilinmeyen saglayici icin guvenli varsayilan */
export const PROVIDER_FALLBACK = CHART[8];

/** Semantik grafik renkleri (delta/olumlu/olumsuz) */
export const CHART_SEMANTIC = {
  good: CHART[2],
  warn: CHART[7],
  crit: CHART[6],
} as const;
