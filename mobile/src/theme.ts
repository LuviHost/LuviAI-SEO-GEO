/**
 * RanksUp — tasarım token'ları.
 * Claude Design projesindeki "RanksUp Mobile" tasarımından birebir çıkarıldı.
 * Sıcak-koyu ("AI Ajan") dil: espresso zemin + turuncu ateş gradyanı.
 */

export const colors = {
  // zeminler
  bg: '#17100B', // espresso-siyah app zemini
  bgElev: '#211712', // yükseltilmiş kart
  bgElev2: '#2E211A', // ikinci kat / timeline nokta

  // metin
  text: '#F7F0EA', // krem beyaz
  textDim: 'rgba(247,240,234,0.62)',
  textMute: 'rgba(247,240,234,0.5)',
  textFaint: 'rgba(247,240,234,0.4)',
  textGhost: 'rgba(247,240,234,0.35)',

  // marka ateşi
  ember: '#F36D32', // ateş turuncu (gradyan başı)
  emberDeep: '#B63325', // koyu kızıl (gradyan sonu)
  emberLite: '#F47F46', // açık turuncu (vurgu metin)
  emberMid: '#E04E24', // link/aksiyon

  // semantik
  good: '#34D399',
  warn: '#FBBF24',
  info: '#4CBAF0',
  crit: '#FB7185',

  // çizgi / hairline
  line: 'rgba(247,240,234,0.08)',
  lineSoft: 'rgba(247,240,234,0.07)',
  lineStrong: 'rgba(247,240,234,0.14)',
} as const;

/** Marka gradyanı (butonlar, orb, skor kartı) */
export const emberGradient = [colors.ember, colors.emberDeep] as const;

export const radii = {
  sm: 8,
  md: 12,
  lg: 14,
  xl: 18,
  pill: 999,
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
} as const;

/** Yüklenen font aileleri (bkz. src/fonts.ts — expo-font ile map'lenir) */
export const fonts = {
  // Sora — display / başlıklar
  displayBold: 'Sora_700Bold',
  displayXBold: 'Sora_800ExtraBold',
  displaySemi: 'Sora_600SemiBold',
  // Plus Jakarta Sans — gövde / UI
  body: 'PlusJakartaSans_400Regular',
  bodyMed: 'PlusJakartaSans_500Medium',
  bodySemi: 'PlusJakartaSans_600SemiBold',
  bodyBold: 'PlusJakartaSans_700Bold',
  // JetBrains Mono — veri / etiket
  mono: 'JetBrainsMono_400Regular',
  monoMed: 'JetBrainsMono_500Medium',
  monoSemi: 'JetBrainsMono_600SemiBold',
} as const;

export type ColorKey = keyof typeof colors;
