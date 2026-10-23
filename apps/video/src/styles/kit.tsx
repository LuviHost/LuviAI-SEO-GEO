import React, { useId, useState } from 'react';
import { Img, interpolate } from 'remotion';
import { clamp01 } from '../marketing/kit';
import { fitText, type Fit, type FitOptions } from '../article-short/fit';
import { rgba, type BrandPalette } from '../article-short/palette';

/**
 * Stillerin ortak gorsel yardimcilari. Hepsi kare / props'un saf fonksiyonu (Math.random, Date yok).
 *
 * bezier, EASE, velocity, SpeedBlur: video-shotcraft (Apache-2.0) demos/_fixtures/Polish.tsx'teki cekirdeklerin
 * TypeScript uyarlamasi — src/styles/CREDITS.md + NOTICE. Degisiklik: Turkce yorumlar, adlandirma,
 * SpeedBlur'da kimlik useId'den.
 */

/**
 * Dikey (1080x1920) calisma alani: icerik alt siniri ve filigran. 23.10 inceleme: alt yarim bos kalmasin —
 * Reels / Shorts / TikTok arayuzunun kapattigi en alt seridi (~ son 300 px) bos birakip alani kullan.
 */
export const V_BOTTOM = 1580;
export const V_WM = 1604;

/* ───────────── egriler (shotcraft Polish: cubic-bezier, CSS ile ayni) ───────────── */

export const bezier = (x1: number, y1: number, x2: number, y2: number) => {
  if (x1 === y1 && x2 === y2) return (t: number) => clamp01(t);
  const ax = 1 - 3 * x2 + 3 * x1;
  const bx = 3 * x2 - 6 * x1;
  const cx = 3 * x1;
  const ay = 1 - 3 * y2 + 3 * y1;
  const by = 3 * y2 - 6 * y1;
  const cy = 3 * y1;
  const sx = (u: number) => ((ax * u + bx) * u + cx) * u;
  const sy = (u: number) => ((ay * u + by) * u + cy) * u;
  const dx = (u: number) => (3 * ax * u + 2 * bx) * u + cx;
  const solve = (x: number) => {
    let u = x;
    for (let i = 0; i < 8; i++) {
      const err = sx(u) - x;
      if (Math.abs(err) < 1e-7) return u;
      const d = dx(u);
      if (Math.abs(d) < 1e-6) break;
      u -= err / d;
    }
    let lo = 0;
    let hi = 1;
    u = x;
    for (let i = 0; i < 40; i++) {
      const v = sx(u);
      if (Math.abs(v - x) < 1e-7) break;
      if (v < x) lo = u;
      else hi = u;
      u = (lo + hi) / 2;
    }
    return u;
  };
  return (t: number) => sy(solve(clamp01(t)));
};

export const EASE = {
  /** guclu cikis (expo-out benzeri): giris, itmenin oturmasi */
  snappy: bezier(0.16, 1, 0.3, 1),
  /** yumusak cikis: ikincil ogeler */
  out: bezier(0.22, 1, 0.36, 1),
  /** simetrik: yer degistirme, kamera kaydirma */
  smooth: bezier(0.65, 0, 0.35, 1),
  /** guclu giris: cikis, ekrandan atma */
  exit: bezier(0.7, 0, 0.84, 0),
  /** itme kesmesi (shotcraft PUSH_EASE) */
  push: bezier(0.72, 0, 0.22, 1),
  /** asip geri oturma */
  overshoot: bezier(0.34, 1.45, 0.64, 1),
};

/** Sayisal hiz (kare basina yer degistirme): merkezi fark */
export const velocity = (f: (frame: number) => number, frame: number) => f(frame + 0.5) - f(frame - 0.5);

/**
 * Hiza bagli yonlu hareket bulanikligi (shotcraft SpeedBlur): yalniz hareket varken (kesme kareleri)
 * SVG feGaussianBlur tek eksende; durgun karede filtre hic uygulanmaz (golgeler ve yazi keskin kalir).
 */
export function SpeedBlur({ vx, vy = 0, amount = 0.12, max = 28, children, style }: { vx: number; vy?: number; amount?: number; max?: number; children: React.ReactNode; style?: React.CSSProperties }) {
  const id = `sb${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const sd = Math.min(max, Math.hypot(vx, vy) * amount);
  const fill: React.CSSProperties = { position: 'absolute', inset: 0 };
  if (sd < 0.35) return <div style={{ ...fill, ...style }}>{children}</div>;
  const deg = (Math.atan2(vy, vx) * 180) / Math.PI;
  return (
    <div style={{ ...fill, ...style }}>
      <svg width={0} height={0} style={{ position: 'absolute' }} aria-hidden>
        <filter id={id} x="-50%" y="-50%" width="200%" height="200%" colorInterpolationFilters="sRGB">
          <feGaussianBlur stdDeviation={`${sd.toFixed(2)} 0`} edgeMode="none" />
        </filter>
      </svg>
      <div style={{ ...fill, transform: `rotate(${deg}deg)`, filter: `url(#${id})` }}>
        <div style={{ ...fill, transform: `rotate(${-deg}deg)` }}>{children}</div>
      </div>
    </div>
  );
}

/* ───────────── zaman ───────────── */

/**
 * Kelime kelime giris: i. kelimenin ilerlemesi. Butun metnin ilerlemesi p %95'e vardiginda (okunurluk
 * denetiminin "tam gorunur" ani) HER kelime %95'tedir; oncesinde kelimeler sirayla baslar.
 */
export function stagger(p: number, i: number, n: number, spread = 0.45): number {
  if (n <= 1 || p >= 0.95) return p;
  const o = spread * 0.95 * (i / (n - 1));
  return clamp01((p - o) / (0.95 - o)) * 0.95;
}

/** Vurus nabzi: vurusta 1, sonra uzel sonum */
export const pulse = (since: number, decay = 6) => Math.exp(-Math.max(0, since) / decay);

/* ───────────── metin ───────────── */

export type FitBase = Omit<FitOptions, 'maxWidth' | 'maxLines' | 'maxSize' | 'minSize'>;

/** k ile olceklenmis sigdirma (yukseklik donguleri icin) */
export function fitK(text: string, base: FitBase, k: number, o: { maxWidth: number; maxLines: number; maxSize: number; minSize: number }): Fit {
  const max = Math.round(o.maxSize * k);
  return fitText(text, { ...base, maxWidth: o.maxWidth, maxLines: o.maxLines, maxSize: max, minSize: Math.min(o.minSize, max) });
}

export const linesH = (f: Fit | null | undefined, lh: number) => (f ? f.lines.length * f.size * lh : 0);

let mctx: CanvasRenderingContext2D | null = null;
/** Metnin gercek genisligi (canvas; fontlar yuklendikten sonra) — isaretci cizgisi / halka boyu icin */
export function measureWidth(text: string, o: { family: string; weight: number; size: number; letterSpacing?: number }): number {
  if (!mctx) mctx = document.createElement('canvas').getContext('2d');
  if (!mctx) return text.length * o.size * 0.55;
  mctx.font = `${o.weight} ${o.size}px ${o.family}`;
  return mctx.measureText(text).width + (o.letterSpacing ?? 0) * o.size * text.length;
}

/** Bos metin icin sigdirma yok */
export const fitOpt = (text: string, fn: () => Fit): Fit | null => (text ? fn() : null);

/** Satirin son kelimesini vurgu icin ayir (sondaki noktalama vurguya girmez) */
export function splitLast(word: string): [string, string] {
  const m = /^(.*?)([.,!?;:…"”’)]*)$/u.exec(word);
  return m ? [m[1], m[2]] : [word, ''];
}

type WordStyle = (wp: number, i: number, n: number) => React.CSSProperties;

/**
 * Sigdirilmis metni kelime kelime cizer. p: butun metnin giris ilerlemesi; wordStyle her kelimenin
 * stili (stagger ile). last: son kelimeye (Turkcede cogunlukla yuklem) eklenecek vurgu katmani.
 */
export function KineticText({
  fit, p, lineHeight, style, wordStyle, align = 'left', last, spread,
}: {
  fit: Fit;
  p: number;
  lineHeight: number;
  style?: React.CSSProperties;
  wordStyle?: WordStyle;
  align?: 'left' | 'center' | 'right';
  last?: (word: string, wp: number) => React.ReactNode;
  spread?: number;
}) {
  const words = fit.lines.map((l) => l.split(' '));
  const n = words.reduce((a, w) => a + w.length, 0);
  let k = 0;
  return (
    <div style={{ fontSize: fit.size, lineHeight, textAlign: align, ...style }}>
      {words.map((ws, li) => (
        <div key={li} style={{ whiteSpace: 'nowrap' }}>
          {ws.map((w, wi) => {
            const i = k++;
            const wp = stagger(p, i, n, spread);
            const isLast = i === n - 1;
            return (
              <React.Fragment key={wi}>
                {wi > 0 ? ' ' : null}
                <span style={{ display: 'inline-block', position: 'relative', ...(wordStyle ? wordStyle(wp, i, n) : {}) }}>
                  {isLast && last ? last(w, wp) : w}
                </span>
              </React.Fragment>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** Duz satirlar (giris animasyonsuz) */
export function Lines({ fit, lineHeight, style, align = 'left' }: { fit: Fit; lineHeight: number; style?: React.CSSProperties; align?: 'left' | 'center' | 'right' }) {
  return (
    <div style={{ fontSize: fit.size, lineHeight, textAlign: align, ...style }}>
      {fit.lines.map((l, i) => (
        <div key={i} style={{ whiteSpace: 'nowrap' }}>
          {l}
        </div>
      ))}
    </div>
  );
}

/* ───────────── cizim ───────────── */

/** Kendini cizen yol (stroke-dashoffset; pathLength=1) — isaretci notlari, oklar, cevreleme */
export function DrawPath({ d, p, color, width, style, viewBox, w, h, cap = 'round' }: { d: string; p: number; color: string; width: number; style?: React.CSSProperties; viewBox: string; w: number; h: number; cap?: 'round' | 'butt' }) {
  if (p <= 0) return null;
  return (
    <svg width={w} height={h} viewBox={viewBox} preserveAspectRatio="none" style={{ position: 'absolute', overflow: 'visible', ...style }} aria-hidden>
      <path d={d} fill="none" stroke={color} strokeWidth={width} strokeLinecap={cap} strokeLinejoin="round" vectorEffect="non-scaling-stroke" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - clamp01(p)} />
    </svg>
  );
}

/**
 * Urun gorseli: 'contain' (paket gorseli kirpilmaz), tum video boyunca yavas yakinlasma. Cizilemezse
 * fallback (marka karosu). Gorsel GUVENILMEYEN veridir: yalniz <img> (data: URI, sunucuda sharp ile cevrildi).
 */
export function ProductImage({ src, frame, total, fallback, pad = 0.88, style }: { src: string; frame: number; total: number; fallback: React.ReactNode; pad?: number; style?: React.CSSProperties }) {
  const [failed, setFailed] = useState(false);
  const t = clamp01(frame / Math.max(1, total));
  const zoom = interpolate(t, [0, 1], [1.02, 1.12]);
  if (!src || failed) return <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', transform: `scale(${zoom})`, ...style }}>{fallback}</div>;
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', ...style }}>
      <Img src={src} maxRetries={0} onError={() => setFailed(true)} style={{ width: `${pad * 100}%`, height: `${pad * 100}%`, objectFit: 'contain', transform: `scale(${zoom})` }} />
    </div>
  );
}

/** Marka degradesi */
export const brandGrad = (pal: BrandPalette, deg = 150) => `linear-gradient(${deg}deg, ${pal.primary} 0%, ${pal.primaryDeep} 100%)`;

/** Yumusak iki katli golge */
export const softShadow = (pal: BrandPalette, k = 1) => `0 ${2 * k}px ${6 * k}px ${rgba(pal.ink, 0.04)}, 0 ${30 * k}px ${80 * k}px ${rgba(pal.ink, 0.1)}`;
