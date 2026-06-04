import { Instrument_Serif, Geist, Geist_Mono, Sora, Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google';

/**
 * RanksUp tipografi sistemi — Apple-grade premium pair.
 *
 * Anthropic frontend-design skill prensibi: "NEVER use Inter/Roboto/Arial."
 * Bizim secimimiz:
 *   - DISPLAY: Instrument Serif (italic) — editorial, sicak, Apple "Pages"
 *     veya "Newsroom" hissi. Hero ve buyuk basliklarda kullanilir.
 *   - SANS: Geist (Vercel) — Apple SF Pro'ya en yakin OFW alternatif.
 *     Body, button, label, dashboard UI hepsi.
 *   - MONO: Geist Mono — code blok, badge, sayisal data.
 *
 * Tum fontlar latin-ext destekli (Turkce karakter sorunsuz).
 * Variable CSS degiskenleri: --font-display, --font-sans, --font-mono.
 */

export const fontDisplay = Instrument_Serif({
  subsets: ['latin', 'latin-ext'],
  weight: '400',
  style: ['normal', 'italic'],
  variable: '--font-display',
  display: 'swap',
});

export const fontSans = Geist({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-sans',
  display: 'swap',
});

export const fontMono = Geist_Mono({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-mono',
  display: 'swap',
});

/**
 * Bridge marka sistemi fontları:
 *   - SORA → logotype (Ranks↗Up) + başlıklar. Markanın imza fontu.
 *   - PLUS JAKARTA SANS → gövde metni alternatifi.
 *   - JETBRAINS MONO → kicker/etiket/kod.
 */
export const fontSora = Sora({
  subsets: ['latin', 'latin-ext'],
  weight: ['500', '600', '700', '800'],
  variable: '--font-sora',
  display: 'swap',
});

export const fontJakarta = Plus_Jakarta_Sans({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-jakarta',
  display: 'swap',
});

export const fontJetbrains = JetBrains_Mono({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-jetbrains',
  display: 'swap',
});

export const fontVariables = `${fontDisplay.variable} ${fontSans.variable} ${fontMono.variable} ${fontSora.variable} ${fontJakarta.variable} ${fontJetbrains.variable}`;
