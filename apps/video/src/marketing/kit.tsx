/**
 * Pazarlama videolari (ProductIntro, SocialAd, FeatureExplainer) icin ortak parcalar.
 *
 * Gorsel dil: reklam/sosyal kartlariyla ayni — krem zemin (#FCFAF8), murekkep (#1C0F09),
 * Sora 800 basliklar, tek vurgu (marka turuncusu / logo degradesi). Mor yok, ucuncu taraf
 * logosu yok (AI motorlari metin etiketi), animasyon yalniz Remotion kare fonksiyonlariyla.
 */
import React, { useEffect, useState } from 'react';
import { AbsoluteFill, Easing, Html5Audio, cancelRender, continueRender, delayRender, interpolate, spring, staticFile } from 'remotion';
import { alpha, brand, fontMono, fontSans, logo } from '../tokens';
import type { Timeline } from './timeline';

/* ───────────── palet + yazi ───────────── */

export const M = {
  cream: '#FCFAF8',
  paper: '#FFFFFF',
  ink: '#1C0F09',
  inkSoft: '#3A241B',
  body: '#6B564B',
  muted: '#8A7469',
  hair: 'rgba(28, 15, 9, 0.09)',
  hairStrong: 'rgba(28, 15, 9, 0.16)',
  fill: '#F4EFEB',
  success: '#2E7D4F',
  warn: '#B45309',
  grad: `linear-gradient(135deg, ${logo.gradFrom}, ${logo.gradTo})`,
  gradH: `linear-gradient(90deg, ${logo.gradFrom}, ${logo.gradTo})`,
} as const;

export const fontDisplay = `'Sora', ${fontSans}`;
export const fontUI = `'Plus Jakarta Sans', ${fontSans}`;
export { fontMono };

let fontsPromise: Promise<void> | null = null;
function loadFonts(): Promise<void> {
  if (!fontsPromise) {
    // OFL fontlar: public/fonts (lisans: public/fonts/OFL.txt)
    const faces = [
      new FontFace('Sora', `url('${staticFile('fonts/Sora.ttf')}') format('truetype')`, { weight: '100 800' }),
      new FontFace('Plus Jakarta Sans', `url('${staticFile('fonts/PlusJakartaSans.ttf')}') format('truetype')`, { weight: '200 800' }),
    ];
    fontsPromise = Promise.all(faces.map((f) => f.load())).then((loaded) => {
      loaded.forEach((f) => document.fonts.add(f));
    });
  }
  return fontsPromise;
}

/**
 * Fontlar yuklenmeden ilk kare cekilmesin. Donen deger: fontlar hazir mi — metni canvas ile
 * olcen sablonlar (ArticleShort) olcumu ancak true olduktan sonra yapar.
 */
export function useBrandFonts(): boolean {
  const [handle] = useState(() => delayRender('Marka fontlari (Sora, Plus Jakarta Sans)'));
  const [ready, setReady] = useState(false);
  useEffect(() => {
    loadFonts()
      .then(() => setReady(true))
      .catch((err) => cancelRender(err));
  }, []);
  // fontlu yeniden cizim DOM'a islendikten SONRA kare cekilsin
  useEffect(() => {
    if (ready) continueRender(handle);
  }, [ready, handle]);
  return ready;
}

/* ───────────── zaman yardimcilari ───────────── */

export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function ramp(frame: number, start: number, end: number, ease: (t: number) => number = Easing.out(Easing.cubic)) {
  return interpolate(frame, [start, end], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
}

/** Izgaraya oturan giris: hizli cikis + kucuk asma, hemen yerlesir (vurustan ~4 kare once baslar) */
export function snap(frame: number, at: number, fps = 30, lead = 4) {
  return spring({ frame: frame - (at - lead), fps, config: { damping: 15, stiffness: 210, mass: 0.7 } });
}

/** Yumusak giris (asmasiz) */
export function soft(frame: number, at: number, fps = 30) {
  return spring({ frame: frame - at, fps, config: { damping: 200 } });
}

/** Anahtar karelerden deger: [[kare, deger], ...] arasi inOut kubik */
export function keyed(frame: number, keys: Array<[number, number]>, ease = Easing.inOut(Easing.cubic)) {
  if (frame <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [f1, v1] = keys[i];
    const [f0, v0] = keys[i - 1];
    if (frame <= f1) return interpolate(frame, [f0, f1], [v0, v1], { easing: ease });
  }
  return keys[keys.length - 1][1];
}

/* ───────────── ses ───────────── */

/** Tek muzik + efekt izi (scripts/audio/synth.mjs uretir). muted=true sessiz varyant. */
export function Soundtrack({ tl, muted }: { tl: Timeline; muted: boolean }) {
  if (muted) return null;
  return <Html5Audio src={staticFile(`audio/${tl.audio}`)} />;
}

/* ───────────── sahne zemini ───────────── */

export function Stage({ grid = true, children }: { grid?: boolean; children?: React.ReactNode }) {
  return (
    <AbsoluteFill style={{ background: M.cream, fontFamily: fontUI, color: M.ink, overflow: 'hidden' }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(1100px 700px at 92% -8%, ${alpha(brand[500], 0.11)}, transparent 70%), radial-gradient(900px 600px at -5% 108%, ${alpha(logo.gradTo, 0.06)}, transparent 70%)`,
        }}
      />
      {grid ? (
        <AbsoluteFill
          style={{
            backgroundImage: `linear-gradient(${alpha(M.ink, 0.035)} 1px, transparent 1px), linear-gradient(90deg, ${alpha(M.ink, 0.035)} 1px, transparent 1px)`,
            backgroundSize: '48px 48px',
            maskImage: 'radial-gradient(ellipse 75% 70% at 50% 45%, black 30%, transparent 100%)',
          }}
        />
      ) : null}
      {children}
    </AbsoluteFill>
  );
}

/* ───────────── tipografi ───────────── */

export function GradText({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <span
      style={{
        backgroundImage: M.gradH,
        WebkitBackgroundClip: 'text',
        backgroundClip: 'text',
        color: 'transparent',
        // Sora'nin alt cizgi uzantilari (g, y, ç, ş) kirpilmasin
        paddingBottom: '0.12em',
        ...style,
      }}
    >
      {children}
    </span>
  );
}

/** Buyuk baslik satiri: snap girisi (asagidan, hafif buyuk) */
export function BigLine({
  frame,
  at,
  size,
  children,
  style,
  from = 'below',
}: {
  frame: number;
  at: number;
  size: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
  from?: 'below' | 'pop';
}) {
  const p = snap(frame, at);
  const o = clamp01(p * 1.6);
  const transform = from === 'pop' ? `scale(${1.18 - 0.18 * p})` : `translateY(${(1 - p) * size * 0.45}px)`;
  return (
    <div
      style={{
        fontFamily: fontDisplay,
        fontWeight: 800,
        fontSize: size,
        lineHeight: 1.06,
        letterSpacing: '-0.035em',
        whiteSpace: 'nowrap',
        opacity: o,
        transform,
        transformOrigin: 'left center',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/* ───────────── kucuk bilesenler ───────────── */

export function Chip({
  children,
  color = M.inkSoft,
  bg,
  size = 22,
  style,
}: {
  children: React.ReactNode;
  color?: string;
  bg?: string;
  size?: number;
  style?: React.CSSProperties;
}) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: size * 0.4,
        padding: `${size * 0.32}px ${size * 0.7}px`,
        borderRadius: 999,
        background: bg ?? alpha(color, 0.1),
        color,
        fontFamily: fontUI,
        fontSize: size,
        fontWeight: 700,
        whiteSpace: 'nowrap',
        lineHeight: 1.1,
        ...style,
      }}
    >
      {children}
    </span>
  );
}

/** "Örnek ekran" etiketi — README kurali: olculmemis paneller etiket tasir */
export function SampleTag({ size = 18, label = 'Örnek ekran', style }: { size?: number; label?: string; style?: React.CSSProperties }) {
  return (
    <Chip color={M.muted} size={size} bg={alpha(M.ink, 0.06)} style={{ letterSpacing: '0.02em', ...style }}>
      {label}
    </Chip>
  );
}

/** Imlec (kullanici). Konum: anahtar kareler; tiklama aninda kucuk basma. */
export function Cursor({
  frame,
  path,
  clicks,
  size = 34,
  visibleFrom = 0,
  visibleTo = Infinity,
}: {
  frame: number;
  path: Array<[number, number, number]>;
  clicks: number[];
  size?: number;
  visibleFrom?: number;
  visibleTo?: number;
}) {
  const x = keyed(frame, path.map(([f, px]) => [f, px] as [number, number]));
  const y = keyed(frame, path.map(([f, , py]) => [f, py] as [number, number]));
  const press = clicks.reduce((acc, c) => {
    const d = frame - c;
    if (d < -2 || d > 8) return acc;
    return Math.min(acc, d < 0 ? 1 - 0.08 * (d + 2) : 0.84 + 0.16 * (d / 8));
  }, 1);
  const ring = clicks.reduce((acc, c) => {
    const d = frame - c;
    return d >= 0 && d < 14 ? d / 14 : acc;
  }, -1);
  const vis = Math.min(ramp(frame, visibleFrom, visibleFrom + 6), 1 - ramp(frame, visibleTo - 6, visibleTo));
  if (vis <= 0) return null;
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: 0, height: 0, opacity: vis, zIndex: 50, pointerEvents: 'none' }}>
      {ring >= 0 ? (
        <div
          style={{
            position: 'absolute',
            left: -26 - ring * 14,
            top: -26 - ring * 14,
            width: 52 + ring * 28,
            height: 52 + ring * 28,
            borderRadius: 999,
            border: `3px solid ${alpha(brand[500], 0.55 * (1 - ring))}`,
          }}
        />
      ) : null}
      <svg
        width={size}
        height={size * 1.25}
        viewBox="0 0 24 30"
        style={{ position: 'absolute', left: -3, top: -2, transform: `scale(${press})`, transformOrigin: '3px 2px', filter: 'drop-shadow(0 3px 6px rgba(28,15,9,0.28))' }}
      >
        <path d="M3 2 L3 23 L8.6 17.8 L12.4 26.6 L16.2 25 L12.5 16.4 L20 16.2 Z" fill={M.ink} stroke="white" strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

/** Beyaz-uzerine-degrade marka karosu (turuncu zeminlerde) */
export function LogoTileReversed({ size = 120 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" style={{ filter: `drop-shadow(0 ${size * 0.1}px ${size * 0.22}px rgba(60,20,5,0.25))` }}>
      <defs>
        <linearGradient id="ru-rev-arrow" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor={logo.gradTo} />
          <stop offset="1" stopColor={logo.gradFrom} />
        </linearGradient>
      </defs>
      <rect width="100" height="100" rx="29" fill="#ffffff" />
      <g transform="translate(20,20) scale(0.6)" fill="none" stroke="url(#ru-rev-arrow)" strokeWidth="11" strokeLinecap="round">
        <path d="M28 72 L72 28" />
        <path d="M40 26 L74 26 L74 60" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

/** Tek renk (beyaz) logotip — turuncu taşkın zemininde */
export function WordmarkMono({ size = 96, color = '#ffffff' }: { size?: number; color?: string }) {
  const arrow = size * 0.6;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', fontFamily: fontDisplay, fontWeight: 700, fontSize: size, letterSpacing: '-0.03em', lineHeight: 1, color, whiteSpace: 'nowrap' }}>
      Ranks
      <svg width={arrow} height={arrow} viewBox="0 0 40 40" fill="none" style={{ margin: `0 ${size * -0.015}px 0 ${size * 0.03}px` }}>
        <path d="M10 30 L30 10" stroke={color} strokeWidth="5.5" strokeLinecap="round" />
        <path d="M17 8.5 L31.5 8.5 L31.5 23" stroke={color} strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
      Up
    </span>
  );
}

/** CTA dugmesi (logo degradesi) */
export function CtaButton({ children, size = 44, scale = 1, style }: { children: React.ReactNode; size?: number; scale?: number; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: size * 0.4,
        padding: `${size * 0.5}px ${size * 1.05}px`,
        borderRadius: size * 0.6,
        background: M.grad,
        color: 'white',
        fontFamily: fontDisplay,
        fontWeight: 700,
        fontSize: size,
        letterSpacing: '-0.02em',
        whiteSpace: 'nowrap',
        boxShadow: `0 ${size * 0.45}px ${size * 1.1}px ${alpha(logo.gradTo, 0.32)}`,
        transform: `scale(${scale})`,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** AI motorlari — yalniz metin etiketi (logo yok). Siralama SSS'deki 6 asistanla ayni. */
export const ENGINES = ['ChatGPT', 'Claude', 'Gemini', 'Perplexity', 'Grok', 'DeepSeek'] as const;

export type Mention = 'url' | 'brand' | 'none';
/** Ornek olcum sonucu (gercek olcum degil — ekranda "Örnek" etiketiyle gosterilir) */
export const SAMPLE_RESULT: Mention[] = ['url', 'none', 'brand', 'url', 'none', 'none'];

export const mentionMeta: Record<Mention, { label: string; score: number; color: string }> = {
  url: { label: 'URL alıntılandı', score: 100, color: M.success },
  brand: { label: 'Marka anıldı', score: 50, color: brand[600] },
  none: { label: 'Anılmadı', score: 0, color: M.muted },
};
