import type { Config } from 'tailwindcss';

/**
 * RanksUp Tailwind — Apple-grade design tokens.
 *
 * Degisiklikler:
 *  - fontFamily: display (Instrument Serif), sans (Geist), mono (Geist Mono)
 *  - fontSize: Apple-scale display sizes (96px down to body)
 *  - spacing: 'section' (her zaman kullanilir), 'shoulder' (yan marj)
 *  - boxShadow: cok katmanli premium golge sistemi (multi-layer subtle)
 *  - borderRadius: ek 'apple' radius (28px Apple card)
 *  - colors: muted-warm gri tonlari (Apple #1d1d1f, #86868b, #f5f5f7)
 *  - transitionTimingFunction: Apple-style ease (out-expo, smooth-spring)
 *  - backgroundImage: hazir gradient mesh + subtle radial
 *  - keyframes: stagger reveal, float, shine
 *
 * brand color = mevcut orange korunur (sadece tonal stops eklenir).
 */
const config: Config = {
  darkMode: 'class',
  content: [
    './src/app/**/*.{ts,tsx,mdx}',
    './src/components/**/*.{ts,tsx,mdx}',
    './src/**/*.{ts,tsx,mdx}',
  ],
  theme: {
    container: {
      center: true,
      padding: { DEFAULT: '1.25rem', sm: '2rem', lg: '3rem' },
      screens: { '2xl': '1440px' },
    },
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        display: ['var(--font-display)', 'Georgia', 'Times New Roman', 'serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        // Apple-scale type. Body = 17px (default 16). Then up.
        'body': ['1.0625rem', { lineHeight: '1.6', letterSpacing: '-0.005em' }],
        'eyebrow': ['0.75rem', { lineHeight: '1.2', letterSpacing: '0.08em', fontWeight: '500' }],
        'h6': ['1.125rem', { lineHeight: '1.4', letterSpacing: '-0.01em' }],
        'h5': ['1.375rem', { lineHeight: '1.35', letterSpacing: '-0.015em' }],
        'h4': ['1.75rem', { lineHeight: '1.25', letterSpacing: '-0.02em' }],
        'h3': ['2.25rem', { lineHeight: '1.15', letterSpacing: '-0.025em' }],
        'h2': ['3rem', { lineHeight: '1.05', letterSpacing: '-0.03em' }],
        'h1': ['4rem', { lineHeight: '1.0', letterSpacing: '-0.035em' }],
        'display-sm': ['4.5rem', { lineHeight: '0.95', letterSpacing: '-0.04em' }],
        'display': ['5.5rem', { lineHeight: '0.92', letterSpacing: '-0.045em' }],
        'display-lg': ['7rem', { lineHeight: '0.9', letterSpacing: '-0.05em' }],
        'display-xl': ['8.5rem', { lineHeight: '0.88', letterSpacing: '-0.055em' }],
        // Dashboard analitik olcegi (02.09.2026 "temiz analitik UI"):
        // metrik degeri / etiket / filtre — TEK sozlesme, sayfa sayfa degisen
        // text-2xl/3xl + font-bold/semibold karmasasinin yerine.
        'metric':    ['1.125rem',  { lineHeight: '1.5rem', letterSpacing: '-0.006em', fontWeight: '600' }],
        'metric-lg': ['1.75rem',   { lineHeight: '2rem',   letterSpacing: '-0.02em',  fontWeight: '600' }],
        'label':     ['0.75rem',   { lineHeight: '1rem',   fontWeight: '500' }],
        'filter':    ['0.8125rem', { lineHeight: '1rem',   fontWeight: '500' }],
      },
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        border: 'hsl(var(--border))',
        ring: 'hsl(var(--ring))',
        sidebar: {
          DEFAULT: 'hsl(var(--sidebar))',
          foreground: 'hsl(var(--sidebar-foreground))',
          muted: 'hsl(var(--sidebar-muted))',
          border: 'hsl(var(--sidebar-border))',
          hover: 'hsl(var(--sidebar-hover))',
        },
        // Apple-style neutrals — sicak gri tonu
        neutral: {
          50:  '#fafafa',
          100: '#f5f5f7',  // Apple bg-light
          200: '#e8e8ed',
          300: '#d2d2d7',
          400: '#86868b',  // Apple secondary text
          500: '#6e6e73',
          600: '#515154',
          700: '#3a3a3d',
          800: '#222226',
          900: '#1d1d1f',  // Apple primary text
          950: '#0b0b0d',
        },
        brand: {
          DEFAULT: '#f97316',  // orange-500 (mevcut)
          50:  '#fff7ed',
          100: '#ffedd5',
          200: '#fed7aa',
          300: '#fdba74',
          400: '#fb923c',
          500: '#f97316',
          600: '#ea580c',
          700: '#c2410c',
          800: '#9a3412',
          900: '#7c2d12',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        // Apple 28px buyuk kart — yalniz .card-apple (globals) kullaniyor
        'apple': '1.75rem',
        // Filtre cipleri (28px yukseklik + 6px yaricap sozlesmesi)
        'chip': '6px',
      },
      boxShadow: {
        // Premium multi-layer shadows — kart, button, modal icin
        'apple-sm': '0 1px 2px rgba(0, 0, 0, 0.04), 0 1px 1px rgba(0, 0, 0, 0.03)',
        'apple':    '0 4px 16px rgba(0, 0, 0, 0.06), 0 1px 3px rgba(0, 0, 0, 0.04)',
        'apple-md': '0 8px 32px rgba(0, 0, 0, 0.08), 0 2px 8px rgba(0, 0, 0, 0.05)',
        'apple-lg': '0 24px 64px rgba(0, 0, 0, 0.10), 0 8px 24px rgba(0, 0, 0, 0.06)',
        'apple-xl': '0 48px 128px rgba(0, 0, 0, 0.14), 0 16px 48px rgba(0, 0, 0, 0.08)',
        // Inset for inputs / cards
        'apple-inset': 'inset 0 1px 0 rgba(255, 255, 255, 0.6)',
      },
      backgroundImage: {
        // Hero gradient mesh — premium, soft, multi-color blend
        'mesh-warm': 'radial-gradient(at 20% 30%, rgba(249, 115, 22, 0.18) 0px, transparent 50%), radial-gradient(at 80% 20%, rgba(244, 63, 94, 0.12) 0px, transparent 50%), radial-gradient(at 70% 80%, rgba(245, 158, 11, 0.10) 0px, transparent 50%), radial-gradient(at 20% 80%, rgba(168, 85, 247, 0.08) 0px, transparent 50%)',
        // Noise overlay — Anthropic skill specifically mentions "noise textures"
        'noise': "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E\")",
      },
      transitionTimingFunction: {
        // Apple-grade easings
        'apple':       'cubic-bezier(0.16, 1, 0.3, 1)',         // ease-out-expo, default Apple
        'apple-in':    'cubic-bezier(0.7, 0, 0.84, 0)',
        'apple-inout': 'cubic-bezier(0.87, 0, 0.13, 1)',
        'spring':      'cubic-bezier(0.34, 1.56, 0.64, 1)',     // overshoot
        'snappy':      'cubic-bezier(0.45, 0, 0.55, 1)',
      },
      animation: {
        'fade-up': 'fade-up 0.9s cubic-bezier(0.16, 1, 0.3, 1) both',
        'fade-in': 'fade-in 0.6s cubic-bezier(0.16, 1, 0.3, 1) both',
        'scale-in': 'scale-in 0.7s cubic-bezier(0.16, 1, 0.3, 1) both',
        'float-slow': 'float 8s ease-in-out infinite',
        'float-slower': 'float 14s ease-in-out infinite',
        'shine': 'shine 3s ease-in-out infinite',
        'breath': 'breath 6s ease-in-out infinite',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(24px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.96)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'float': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-12px)' },
        },
        'shine': {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
        },
        'breath': {
          '0%, 100%': { transform: 'scale(1)', opacity: '0.5' },
          '50%': { transform: 'scale(1.05)', opacity: '0.7' },
        },
      },
      letterSpacing: {
        'tightest': '-0.055em',
      },
    },
  },
  plugins: [require('tailwindcss-animate'), require('@tailwindcss/typography')],
};
export default config;
