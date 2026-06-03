import { Instrument_Serif, Geist, Geist_Mono } from 'next/font/google';

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

export const fontVariables = `${fontDisplay.variable} ${fontSans.variable} ${fontMono.variable}`;
