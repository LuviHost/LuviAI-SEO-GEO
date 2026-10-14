/**
 * RanksUp marka token'lari — Remotion kompozisyonlari icin TEK kaynak.
 *
 * Degerler web uygulamasindan birebir alindi:
 *   - brand / neutral  -> apps/web/tailwind.config.ts (colors.brand, colors.neutral)
 *   - durum tonlari ve yuzeyler -> apps/web/src/app/globals.css (:root ve .dark HSL degiskenleri)
 *
 * Remotion Tailwind calistirmadigi icin renkler burada duz string olarak durur;
 * web tarafinda bir token degisirse bu dosya da guncellenmeli (videolar yeniden render edilir).
 */

export const brand = {
  DEFAULT: '#f97316',
  50: '#fff7ed',
  100: '#ffedd5',
  200: '#fed7aa',
  300: '#fdba74',
  400: '#fb923c',
  500: '#f97316',
  600: '#ea580c',
  700: '#c2410c',
  800: '#9a3412',
  900: '#7c2d12',
} as const;

/** Logo paleti — apps/web/src/components/brand-logo.tsx ("Bridge" isareti) */
export const logo = {
  ink: '#271610',
  inkReversed: '#ffffff',
  accent: '#E04E24',
  accentReversed: '#F47F46',
  gradFrom: '#F36D32',
  gradTo: '#B63325',
} as const;

export const neutral = {
  50: '#fafafa',
  100: '#f5f5f7',
  200: '#e8e8ed',
  300: '#d2d2d7',
  400: '#86868b',
  500: '#6e6e73',
  600: '#515154',
  700: '#3a3a3d',
  800: '#222226',
  900: '#1d1d1f',
  950: '#0b0b0d',
} as const;

export type ThemeName = 'light' | 'dark';

export type Theme = {
  name: ThemeName;
  background: string;
  foreground: string;
  card: string;
  muted: string;
  mutedForeground: string;
  border: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
  /** Grafik paleti (globals.css --chart-1/2/3/7) — marka, zumrut, mavi, kehribar */
  chart: [string, string, string, string];
};

/** globals.css :root */
export const light: Theme = {
  name: 'light',
  background: 'hsl(0 0% 100%)',
  foreground: 'hsl(222 47% 11%)',
  card: 'hsl(0 0% 100%)',
  muted: 'hsl(210 40% 96%)',
  mutedForeground: 'hsl(215 16% 47%)',
  border: 'hsl(214 32% 91%)',
  success: 'hsl(152 61% 34%)',
  warning: 'hsl(32 95% 40%)',
  danger: 'hsl(0 72% 48%)',
  info: 'hsl(217 91% 48%)',
  chart: ['hsl(24 95% 53%)', 'hsl(160 84% 39%)', 'hsl(217 91% 60%)', 'hsl(43 96% 50%)'],
};

/** globals.css .dark */
export const dark: Theme = {
  name: 'dark',
  background: 'hsl(222 47% 11%)',
  foreground: 'hsl(210 40% 98%)',
  card: 'hsl(222 47% 13%)',
  muted: 'hsl(217 33% 17%)',
  mutedForeground: 'hsl(215 20% 65%)',
  border: 'hsl(217 33% 20%)',
  success: 'hsl(152 55% 52%)',
  warning: 'hsl(38 92% 58%)',
  danger: 'hsl(0 84% 66%)',
  info: 'hsl(213 94% 68%)',
  chart: ['hsl(24 95% 58%)', 'hsl(160 74% 47%)', 'hsl(217 91% 66%)', 'hsl(43 96% 62%)'],
};

export const themes: Record<ThemeName, Theme> = { light, dark };

/** HSL/hex rengine alfa ekler (hsl(a b c) -> hsl(a b c / x), #rrggbb -> rgba) */
export function alpha(color: string, a: number): string {
  if (color.startsWith('hsl(')) return color.replace(/\)$/, ` / ${a})`);
  const hex = color.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Sistem font yigini — web'deki Geist yerine render ortaminda her zaman bulunan fontlar */
export const fontSans =
  "'Geist', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif";
export const fontMono = "'Geist Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace";
