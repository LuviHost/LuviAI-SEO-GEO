/**
 * KobiPratik reklam videolari icin ortak parcalar (KobiPratikReels, KobiPratikIntro).
 *
 * Marka KobiPratik'in kendisi (Frontend-v2): birincil teal #069093, lacivert #15132C, zemin #F4F8F8,
 * font Rethink Sans (OFL 1.1, public/fonts/OFL-RethinkSans.txt), logo Frontend-v2 SVG'lerinden PNG'ye
 * cevrildi (public/kobipratik/). RanksUp markasi bu videolarda YOK.
 *
 * Icerik kurallari (finansal reklam): teklif kartlari "Örnek" etiketli, banka adi/logosu yok, oran ve
 * tutar yerine yer tutucu (%X,XX). Onay vaadi yok. Iddialar yalniz sitede birebir gecenler.
 */
import React, { useEffect, useState } from 'react';
import { AbsoluteFill, Easing, Img, cancelRender, continueRender, delayRender, interpolate, spring, staticFile } from 'remotion';
import { Check, CreditCard, Landmark, Percent, Store } from 'lucide-react';
import { alpha } from '../tokens';

/* ───────────── palet ───────────── */

export const K = {
  teal: '#069093',
  tealBright: '#00B0B4',
  tealDeep: '#008284',
  navy: '#15132C',
  ink: '#0F1927',
  bg: '#F4F8F8',
  paper: '#FFFFFF',
  mist: '#E8F0F3',
  steel: '#4B7C91',
  gray: '#646464',
  line: '#EBEBEB',
  lineStrong: '#DDE6E8',
  orange: '#F79009',
  grad: 'linear-gradient(135deg, #069093, #00B0B4)',
} as const;

export const fontK = "'Rethink Sans', ui-sans-serif, system-ui, sans-serif";

let fontsPromise: Promise<void> | null = null;
function loadFonts(): Promise<void> {
  if (!fontsPromise) {
    const face = new FontFace('Rethink Sans', `url('${staticFile('fonts/RethinkSans.ttf')}') format('truetype')`, { weight: '400 800' });
    fontsPromise = face.load().then((f) => {
      document.fonts.add(f);
    });
  }
  return fontsPromise;
}

/** Rethink Sans yuklenmeden kare cekilmesin */
export function useKobiFonts(): boolean {
  const [handle] = useState(() => delayRender('KobiPratik fontu (Rethink Sans)'));
  const [ready, setReady] = useState(false);
  useEffect(() => {
    loadFonts()
      .then(() => setReady(true))
      .catch((err) => cancelRender(err));
  }, []);
  useEffect(() => {
    if (ready) continueRender(handle);
  }, [ready, handle]);
  return ready;
}

/* ───────────── zaman ───────────── */

export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function ramp(frame: number, start: number, end: number, ease: (t: number) => number = Easing.out(Easing.cubic)) {
  return interpolate(frame, [start, end], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
}

/**
 * Okunurluk ayarlari (scripts/check-kobipratik-readability.mjs ayni degerleri kullanir — degisirse orayi da guncelle).
 * Giris yumusak ve asmasiz (~9 karede %95), vurustan SNAP_LEAD kare once baslar; cikis EXIT_FRAMES karede.
 */
export const SNAP_LEAD = 6;
export const SNAP_CONFIG = { damping: 18, stiffness: 140, mass: 0.8 } as const;
export const EXIT_FRAMES = 10;

/** vurusa oturan sakin giris (vurustan SNAP_LEAD kare once baslar, asma yok denecek kadar az) */
export function snap(frame: number, at: number, lead = SNAP_LEAD) {
  return spring({ frame: frame - (at - lead), fps: 30, config: SNAP_CONFIG });
}

export function soft(frame: number, at: number) {
  return spring({ frame: frame - at, fps: 30, config: { damping: 200 } });
}

export function appear(frame: number, at: number) {
  const p = snap(frame, at);
  return { opacity: clamp01(p * 1.5), p };
}

export function keyed(frame: number, keys: Array<[number, number]>, ease = Easing.inOut(Easing.cubic)) {
  if (frame <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [f1, v1] = keys[i];
    const [f0, v0] = keys[i - 1];
    if (frame <= f1) return interpolate(frame, [f0, f1], [v0, v1], { easing: ease });
  }
  return keys[keys.length - 1][1];
}

/** sahne cikisi: son EXIT_FRAMES karede kaybolma orani */
export function exitOf(frame: number, end: number) {
  return ramp(frame, end - EXIT_FRAMES, end - 1, Easing.inOut(Easing.cubic));
}

/* ───────────── zemin ───────────── */

export function KStage({ children }: { children?: React.ReactNode }) {
  return (
    <AbsoluteFill style={{ background: K.bg, fontFamily: fontK, color: K.navy, overflow: 'hidden' }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(1000px 760px at 95% -10%, ${alpha(K.teal, 0.16)}, transparent 70%), radial-gradient(900px 700px at -10% 110%, ${alpha(K.tealBright, 0.1)}, transparent 70%)`,
        }}
      />
      <AbsoluteFill
        style={{
          backgroundImage: `radial-gradient(${alpha(K.navy, 0.07)} 1.6px, transparent 1.6px)`,
          backgroundSize: '36px 36px',
          maskImage: 'radial-gradient(ellipse 70% 65% at 50% 45%, black 25%, transparent 100%)',
        }}
      />
      {children}
    </AbsoluteFill>
  );
}

/* ───────────── marka ───────────── */

const WORDMARK_RATIO = 1600 / 369;

/** Frontend-v2 stories/assets/header/Logo.svg (light = LogoDark.svg, koyu zeminde) */
export function Wordmark({ width, light = false, style }: { width: number; light?: boolean; style?: React.CSSProperties }) {
  return (
    <Img
      src={staticFile(light ? 'kobipratik/logo-wordmark-light.png' : 'kobipratik/logo-wordmark.png')}
      style={{ width, height: width / WORDMARK_RATIO, display: 'block', ...style }}
    />
  );
}

/** Frontend-v2 public/logo.svg — beyaz yuvarlak karo icinde */
export function SymbolTile({ size, style }: { size: number; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.3,
        background: K.paper,
        display: 'grid',
        placeItems: 'center',
        boxShadow: `0 ${size * 0.12}px ${size * 0.35}px ${alpha(K.teal, 0.22)}, 0 0 0 1px ${alpha(K.navy, 0.05)}`,
        ...style,
      }}
    >
      <Img src={staticFile('kobipratik/logo-symbol.png')} style={{ width: size * 0.62, height: size * 0.62 }} />
    </div>
  );
}

/* ───────────── tipografi ───────────── */

export function Teal({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <span style={{ color: K.teal, ...style }}>{children}</span>;
}

/** Buyuk baslik satiri (vurusa oturan giris) */
export function KLine({
  frame,
  at,
  size,
  children,
  style,
  align = 'left',
}: {
  frame: number;
  at: number;
  size: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
  align?: 'left' | 'center';
}) {
  const p = snap(frame, at);
  return (
    <div
      style={{
        fontFamily: fontK,
        fontWeight: 800,
        fontSize: size,
        lineHeight: 1.08,
        letterSpacing: '-0.03em',
        whiteSpace: 'nowrap',
        textAlign: align,
        opacity: clamp01(p * 1.6),
        transform: `translateY(${(1 - p) * size * 0.45}px)`,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function Pill({
  children,
  color = K.steel,
  bg,
  size = 24,
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
        padding: `${size * 0.34}px ${size * 0.72}px`,
        borderRadius: 999,
        background: bg ?? alpha(color, 0.11),
        color,
        fontFamily: fontK,
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

/** "Örnek" etiketi — temsili ekranlar ve yer tutucu degerler icin zorunlu */
export function SampleTag({ size = 22, label = 'Örnek ekran · temsili değerler', style }: { size?: number; label?: string; style?: React.CSSProperties }) {
  return (
    <Pill color={K.gray} bg={alpha(K.navy, 0.07)} size={size} style={{ letterSpacing: '0.01em', ...style }}>
      {label}
    </Pill>
  );
}

/** KobiPratik birincil dugmesi (sitedeki "Hemen Başvur" gibi) */
export function KButton({ children, size = 30, pressed = 0, style }: { children: React.ReactNode; size?: number; pressed?: number; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: size * 0.4,
        padding: `${size * 0.52}px ${size * 1.0}px`,
        borderRadius: size * 0.42,
        background: pressed > 0 ? K.tealDeep : K.teal,
        color: 'white',
        fontFamily: fontK,
        fontWeight: 700,
        fontSize: size,
        whiteSpace: 'nowrap',
        lineHeight: 1,
        transform: `scale(${1 - 0.05 * pressed})`,
        boxShadow: `0 ${size * 0.3}px ${size * 0.8}px ${alpha(K.teal, 0.3)}`,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/* ───────────── imlec ───────────── */

export function Cursor({ frame, path, clicks, size = 40 }: { frame: number; path: Array<[number, number, number]>; clicks: number[]; size?: number }) {
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
  const vis = ramp(frame, path[0][0], path[0][0] + 6);
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: 0, height: 0, opacity: vis, zIndex: 50, pointerEvents: 'none' }}>
      {ring >= 0 ? (
        <div
          style={{
            position: 'absolute',
            left: -30 - ring * 16,
            top: -30 - ring * 16,
            width: 60 + ring * 32,
            height: 60 + ring * 32,
            borderRadius: 999,
            border: `4px solid ${alpha(K.teal, 0.6 * (1 - ring))}`,
          }}
        />
      ) : null}
      <svg
        width={size}
        height={size * 1.25}
        viewBox="0 0 24 30"
        style={{ position: 'absolute', left: -3, top: -2, transform: `scale(${press})`, transformOrigin: '3px 2px', filter: 'drop-shadow(0 3px 6px rgba(15,25,39,0.3))' }}
      >
        <path d="M3 2 L3 23 L8.6 17.8 L12.4 26.6 L16.2 25 L12.5 16.4 L20 16.2 Z" fill={K.navy} stroke="white" strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

/* ───────────── urunler + ornek teklif kartlari ───────────── */

export type ProductKind = 'card' | 'pos' | 'credit';

export const PRODUCTS: Record<ProductKind, { title: string; short: string; Icon: typeof CreditCard; fields: Array<[string, string]> }> = {
  // Alan etiketleri sitedeki kartlarla ayni (Frontend-v2 stories/cards/*.vue); degerler YER TUTUCU.
  card: { title: 'Ticari Kredi Kartları', short: 'Ticari kredi kartı', Icon: CreditCard, fields: [['Yıllık Ücret', 'X.XXX TL'], ['Alışveriş Faizi', '%X,XX'], ['Kart Türü', 'Ticari']] },
  pos: { title: 'POS Çözümleri', short: 'POS', Icon: Store, fields: [['Komisyon Oranı', '%X,XX'], ['Aidat Ödemesi', 'XXX TL'], ['Pos Türü', 'Sanal Pos']] },
  credit: { title: 'Ticari Krediler', short: 'Ticari kredi', Icon: Percent, fields: [['Faiz Oranı', '%X,XX'], ['Aylık Taksit', 'XX.XXX TL'], ['Toplam Geri Ödeme', 'XXX.XXX TL']] },
};

/** POS turleri sitedeki kategorilerle ayni (Sanal / Fiziksel / Cep / Link) */
export const POS_TYPES = ['Sanal Pos', 'Fiziksel Pos', 'Cep Pos', 'Link Pos'] as const;

/**
 * Ornek teklif karti — sitedeki urun kartinin yeniden cizimi. Banka adi/logosu yok ("Örnek Banka A"),
 * degerler yer tutucu. s = olcek (1 = 860 px genislik icin tasarlandi).
 */
export function OfferCard({
  kind,
  partner,
  width,
  s = 1,
  selected = 0,
  dim = 0,
  pressed = 0,
  fieldOverride,
  layout = 'row',
  style,
}: {
  kind: ProductKind;
  partner: string;
  width: number;
  s?: number;
  selected?: number;
  dim?: number;
  pressed?: number;
  fieldOverride?: Partial<Record<number, string>>;
  layout?: 'row' | 'column';
  style?: React.CSSProperties;
}) {
  const P = PRODUCTS[kind];
  const fields = P.fields.map(([l, v], i) => [l, fieldOverride?.[i] ?? v] as [string, string]);
  const borderC = selected > 0 ? alpha(K.teal, 0.25 + 0.75 * selected) : K.line;
  return (
    <div
      style={{
        position: 'relative',
        width,
        boxSizing: 'border-box',
        padding: `${26 * s}px ${30 * s}px`,
        borderRadius: 22 * s,
        background: K.paper,
        border: `${3 * s}px solid ${borderC}`,
        boxShadow: `0 ${18 * s}px ${48 * s}px ${alpha(K.navy, 0.08 + 0.06 * selected)}`,
        opacity: 1 - 0.5 * dim,
        fontFamily: fontK,
        ...style,
      }}
    >
      {/* ust satir: kurum karosu + ad + Örnek rozeti | dugme */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 18 * s }}>
        <div style={{ width: 64 * s, height: 64 * s, borderRadius: 16 * s, background: K.mist, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
          <Landmark size={34 * s} color={K.steel} strokeWidth={2.2} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 32 * s, lineHeight: 1.1, color: K.navy, whiteSpace: 'nowrap' }}>{partner}</div>
          <div style={{ marginTop: 4 * s, fontWeight: 600, fontSize: 22 * s, color: K.gray, whiteSpace: 'nowrap' }}>{P.short}</div>
        </div>
        {layout === 'row' ? (
          <KButton size={26 * s} pressed={pressed}>
            Hemen Başvur
          </KButton>
        ) : null}
      </div>
      {/* alanlar */}
      <div
        style={{
          marginTop: 22 * s,
          display: 'flex',
          flexDirection: layout === 'row' ? 'row' : 'column',
          gap: layout === 'row' ? 0 : 10 * s,
          borderTop: `${2 * s}px solid ${K.line}`,
          paddingTop: 20 * s,
        }}
      >
        {fields.map(([label, value], i) => (
          <div
            key={label}
            style={{
              flex: layout === 'row' ? 1 : undefined,
              display: 'flex',
              flexDirection: layout === 'row' ? 'column' : 'row',
              justifyContent: layout === 'row' ? 'flex-start' : 'space-between',
              alignItems: layout === 'row' ? 'flex-start' : 'baseline',
              paddingLeft: layout === 'row' && i > 0 ? 22 * s : 0,
              borderLeft: layout === 'row' && i > 0 ? `${2 * s}px solid ${K.line}` : 'none',
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 21 * s, color: K.gray, whiteSpace: 'nowrap' }}>{label}</div>
            <div style={{ marginTop: layout === 'row' ? 6 * s : 0, fontWeight: 800, fontSize: 30 * s, color: value.includes('X') ? alpha(K.steel, 0.75) : K.navy, letterSpacing: '0.01em', whiteSpace: 'nowrap' }}>
              {value}
            </div>
          </div>
        ))}
      </div>
      <div style={{ position: 'absolute', top: -16 * s, left: 26 * s }}>
        <Pill size={19 * s} color="white" bg={K.orange}>
          Örnek
        </Pill>
      </div>
      {layout === 'row' ? null : (
        <div style={{ marginTop: 22 * s, display: 'flex', justifyContent: 'stretch' }}>
          <KButton size={24 * s} pressed={pressed} style={{ flex: 1 }}>
            Hemen Başvur
          </KButton>
        </div>
      )}
      {selected > 0.05 ? (
        <div
          style={{
            position: 'absolute',
            top: -20 * s,
            right: 22 * s,
            width: 52 * s,
            height: 52 * s,
            borderRadius: 999,
            background: K.teal,
            display: 'grid',
            placeItems: 'center',
            transform: `scale(${selected})`,
            boxShadow: `0 ${6 * s}px ${16 * s}px ${alpha(K.teal, 0.4)}`,
          }}
        >
          <Check size={32 * s} color="white" strokeWidth={3.4} />
        </div>
      ) : null}
    </div>
  );
}

/** Dürüstlük notu — sitedeki "KobiPratik Nedir?" sayfasiyla ayni anlam */
export const DISCLAIMER = 'KobiPratik kredi veren bir kurum değildir. Başvurular ilgili banka ya da ödeme kuruluşunun değerlendirmesine tabidir.';
