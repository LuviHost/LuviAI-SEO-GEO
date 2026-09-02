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

/**
 * Acik "rapor kagidi" paleti — analiz sonucu ekrani (sicak kagit uzerine murekkep).
 * analyze.tsx'ten tasindi (02.09.2026): ekran-ici paralel palet kalmasin diye TEK kaynak.
 */
export const paper = {
  surface: '#F6F1EA', // rapor zemini (sıcak kâğıt)
  card: '#FFFFFF', // soru / sıralama alt kartları
  ink: '#221711', // birincil metin (sıcak siyaha yakın)
  inkDim: 'rgba(34,23,17,0.6)',
  inkFaint: 'rgba(34,23,17,0.42)',
  line: 'rgba(34,23,17,0.10)',
  lineSoft: 'rgba(34,23,17,0.06)',
  muted: '#ECE5DC', // nötr rozet kutucuğu
  good: '#0E9F6E',
  goodBg: '#E4F5EC',
  goodRing: 'rgba(14,159,110,0.55)',
  warn: '#B7791F',
  warnBg: '#FBF3DE',
  warnRing: 'rgba(183,121,31,0.5)',
  ember: '#E0551F',
  emberDeep: '#B63325',
  brandTint: 'rgba(224,85,31,0.10)',
  info: '#2E7DB8',
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

/**
 * Tip olcegi — web'deki "temiz analitik" sozlesmesinin RN esleseni (02.09.2026):
 * metrik degeri / etiket / filtre TEK yerden. Ekranlarda fontSize: N yazmak yerine
 * type.* kullanilir (ratchet bekcisi sayimi dusurur).
 */
export const type = {
  /** buyuk metrik degeri — skor, para, sayac */
  metricLg: { fontFamily: fonts.displayXBold, fontSize: 28, lineHeight: 32, letterSpacing: -0.6 },
  /** satir ici metrik */
  metric: { fontFamily: fonts.displaySemi, fontSize: 18, lineHeight: 24, letterSpacing: -0.2 },
  /** etiket — kart basligi ustu, birim */
  label: { fontFamily: fonts.bodyMed, fontSize: 12, lineHeight: 16 },
  /** filtre cipi / kucuk buton metni */
  filter: { fontFamily: fonts.bodySemi, fontSize: 13, lineHeight: 16 },
  /** mono veri etiketi (tarih, kod, oran) */
  data: { fontFamily: fonts.monoMed, fontSize: 10, lineHeight: 14, letterSpacing: 0.3 },
  /** en kucuk mono rozet */
  micro: { fontFamily: fonts.monoSemi, fontSize: 9, lineHeight: 12, letterSpacing: 0.5 },
} as const;

/**
 * Alfa-tint yardimcisi: hex rengi rgba'ya cevirir. Ekranlardaki elle yazilmis
 * 'rgba(243,109,50,0.25)' kaliplarinin yerine tint(colors.ember, 0.25).
 */
export function tint(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

export type ColorKey = keyof typeof colors;
