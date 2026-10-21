import React, { useState } from 'react';
import { AbsoluteFill, Img, interpolate } from 'remotion';
import { ArrowRight } from 'lucide-react';
import { clamp01, fontDisplay, fontUI } from '../marketing/kit';
import { fitText, type Fit, type FitOptions } from '../article-short/fit';
import { contrast, mix, rgba, type BrandPalette } from '../article-short/palette';

/**
 * Site ve urun tanitim videolarinin (SiteIntro, ProductShort) ortak parcalari. Marka paleti,
 * metin sigdirma ve logo karosu ArticleShort'tan gelir (palette.ts, fit.ts, LogoTile); burada
 * yalniz tanitim sablonlarina ozgu bloklar var: marka zemini, CTA hapi, filigran, urun gorseli
 * (yavas yakinlasma), fiyat etiketi.
 *
 * Musteri gorselleri ve logo GUVENILMEYEN veridir: sunucuda sharp ile PNG/JPEG'e cevrilmis
 * data: URI olarak gelir ve yalniz <img> ile cizilir (SVG betigi calismaz, harici istek yok).
 */

export type PromoPoint = { title: string; detail?: string };
export type PromoBrand = { name: string; domain: string; primary?: string; logoUrl?: string };
export type PromoBaseProps = {
  hook: string;
  hookSub?: string;
  kicker?: string;
  points: PromoPoint[];
  cta: { label: string; domain: string; url?: string };
  brand: PromoBrand;
  muted?: boolean;
  watermark?: boolean;
};

export const WATERMARK_TEXT = 'ranksup.ai ile üretildi';

export const DISPLAY: Omit<FitOptions, 'maxWidth' | 'maxLines' | 'maxSize' | 'minSize'> = { family: fontDisplay, weight: 800, letterSpacing: -0.035 };
export const UI: Omit<FitOptions, 'maxWidth' | 'maxLines' | 'maxSize' | 'minSize'> = { family: fontUI, weight: 650, letterSpacing: -0.01 };

/** Boyutu k ile olceklenmis sigdirma (yukseklik dongusu icin): alt sinir maxSize'i asmaz */
export function fitK(text: string, base: typeof DISPLAY, k: number, o: { maxWidth: number; maxLines: number; maxSize: number; minSize: number; weight?: number }): Fit {
  const max = Math.round(o.maxSize * k);
  return fitText(text, { ...base, ...(o.weight ? { weight: o.weight } : {}), maxWidth: o.maxWidth, maxLines: o.maxLines, maxSize: max, minSize: Math.min(o.minSize, max) });
}

export const linesH = (f: Fit | null, lh: number) => (f ? f.lines.length * f.size * lh : 0);

/** Satir satir cizilen sigdirilmis metin */
export function FitLines({ fit, lineHeight, style, align = 'left' }: { fit: Fit; lineHeight: number; style?: React.CSSProperties; align?: 'left' | 'center' }) {
  return (
    <div style={{ fontSize: fit.size, lineHeight, textAlign: align, ...style }}>
      {fit.lines.map((l, i) => (
        <div key={i} style={{ whiteSpace: 'nowrap', paddingBottom: '0.03em' }}>
          {l}
        </div>
      ))}
    </div>
  );
}

/** Marka renkli tam zemin (site tanitimi): degrade + yumusak isik + ince nokta deseni */
export function BrandField({ pal }: { pal: BrandPalette }) {
  return (
    <>
      <AbsoluteFill style={{ background: `linear-gradient(160deg, ${pal.primary} 0%, ${pal.primaryDeep} 100%)` }} />
      <AbsoluteFill
        style={{
          background: `radial-gradient(1100px 900px at 85% 0%, ${rgba('#ffffff', 0.16)}, transparent 70%), radial-gradient(900px 800px at 0% 100%, ${rgba('#000000', 0.12)}, transparent 70%)`,
        }}
      />
      <AbsoluteFill
        style={{
          backgroundImage: `radial-gradient(${rgba(pal.onPrimary, 0.09)} 2px, transparent 2.5px)`,
          backgroundSize: '44px 44px',
          maskImage: 'radial-gradient(ellipse 75% 65% at 50% 40%, black 20%, transparent 100%)',
        }}
      />
    </>
  );
}

/** Acik zemin (urun tanitimi): markaya hafif boyanmis notr + kose isiklari */
export function LightField({ pal }: { pal: BrandPalette }) {
  return (
    <>
      <AbsoluteFill style={{ background: pal.bg }} />
      <AbsoluteFill
        style={{
          background: `radial-gradient(1000px 800px at 100% 0%, ${rgba(pal.primary, 0.14)}, transparent 70%), radial-gradient(900px 700px at 0% 100%, ${rgba(pal.primary, 0.08)}, transparent 70%)`,
        }}
      />
    </>
  );
}

/** Marka zeminindeki CTA hapi icin okunur renk cifti (ArticleShort End ile ayni kural) */
export function pillOnBrand(pal: BrandPalette): { bg: string; text: string } {
  const onWhite = pal.onPrimary === '#ffffff';
  const bg = onWhite ? '#ffffff' : pal.ink;
  let text = pal.primary;
  for (let i = 0; i < 14 && contrast(text, bg) < 4.5; i++) text = onWhite ? mix(text, '#000000', 0.1) : mix(text, '#ffffff', 0.15);
  return { bg, text };
}

export function CtaPill({ fit, bg, color, scale, shadow = true }: { fit: Fit; bg: string; color: string; scale: number; shadow?: boolean }) {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: fit.size * 0.36,
        padding: `${fit.size * 0.48}px ${fit.size * 0.8}px`,
        borderRadius: 999,
        background: bg,
        color,
        fontFamily: fontDisplay,
        fontWeight: 700,
        fontSize: fit.size,
        letterSpacing: '-0.02em',
        whiteSpace: 'nowrap',
        boxShadow: shadow ? `0 30px 70px ${rgba('#000000', 0.22)}` : undefined,
        opacity: clamp01(scale * 1.5),
        transform: `scale(${0.7 + 0.3 * scale})`,
      }}
    >
      {fit.lines[0]}
      <ArrowRight size={fit.size * 0.95} strokeWidth={2.8} />
    </div>
  );
}

export function WatermarkLine({ top, color, opacity, size = 24 }: { top: number; color: string; opacity: number; size?: number }) {
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, top, textAlign: 'center', fontFamily: fontUI, fontWeight: 600, fontSize: size, color, opacity, letterSpacing: '0.01em' }}>
      {WATERMARK_TEXT}
    </div>
  );
}

/**
 * Urun gorseli — beyaz kart icinde 'contain' (urun fotograflari cogu zaman beyaz zeminli
 * paket gorseli; kirpilmasin), tum video boyunca yavas yakinlasma + kayma (Ken Burns).
 * Gorsel yoksa ya da cizilemezse marka degradesi + logo/monogram karosu.
 */
export function ProductImageCard({
  src,
  size,
  frame,
  total,
  pal,
  brandTile,
}: {
  src?: string;
  size: number;
  frame: number;
  total: number;
  pal: BrandPalette;
  brandTile: React.ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  const t = clamp01(frame / Math.max(1, total));
  const zoom = interpolate(t, [0, 1], [1.02, 1.14]);
  const dx = interpolate(t, [0, 1], [-1.5, 1.5]);
  const dy = interpolate(t, [0, 1], [1.2, -1.2]);
  const show = src && !failed;
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.07,
        overflow: 'hidden',
        background: show ? '#ffffff' : `linear-gradient(150deg, ${pal.primary} 0%, ${pal.primaryDeep} 100%)`,
        // Gorselsiz kart marka renginde: kapanisin marka zemininde kaybolmasin diye beyaz ince cerceve
        boxShadow: `0 ${size * 0.05}px ${size * 0.12}px ${rgba(pal.ink, 0.18)}, 0 0 0 ${show ? '1.5px' : `${Math.max(3, size * 0.008)}px`} ${show ? pal.hair : rgba('#ffffff', 0.55)}`,
        display: 'grid',
        placeItems: 'center',
        position: 'relative',
      }}
    >
      {show ? (
        <Img
          src={src!}
          maxRetries={0}
          onError={() => setFailed(true)}
          style={{ width: '88%', height: '88%', objectFit: 'contain', transform: `scale(${zoom}) translate(${dx}%, ${dy}%)` }}
        />
      ) : (
        <div style={{ transform: `scale(${zoom})` }}>{brandTile}</div>
      )}
    </div>
  );
}

/** Bulanik arka plan kopyasi — gorseli one cikaran renk alani (gorsel yoksa cizilmez) */
export function ImageGlow({ src, style, opacity }: { src?: string; style: React.CSSProperties; opacity: number }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return null;
  return (
    <div style={{ position: 'absolute', overflow: 'hidden', opacity, ...style }}>
      <Img src={src} maxRetries={0} onError={() => setFailed(true)} style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(70px) saturate(1.3)', transform: 'scale(1.3)' }} />
    </div>
  );
}

/** Fiyat etiketi — YALNIZ sunucu fiyati iki kaynakla dogruladiysa (page.mjs verifyPrice) props'a gelir */
export function PriceTag({ text, size, pal, p }: { text: string; size: number; pal: BrandPalette; p: number }) {
  return (
    <div
      style={{
        display: 'inline-block',
        padding: `${size * 0.32}px ${size * 0.6}px`,
        borderRadius: size * 0.42,
        background: `linear-gradient(150deg, ${pal.primary} 0%, ${pal.primaryDeep} 100%)`,
        color: pal.onPrimary,
        fontFamily: fontDisplay,
        fontWeight: 800,
        fontSize: size,
        letterSpacing: '-0.02em',
        whiteSpace: 'nowrap',
        boxShadow: `0 ${size * 0.3}px ${size * 0.7}px ${rgba('#000000', 0.25)}, 0 0 0 ${Math.max(3, size * 0.07)}px #ffffff`,
        opacity: clamp01(p * 1.5),
        transform: `rotate(-6deg) scale(${0.6 + 0.4 * p})`,
        transformOrigin: 'center',
      }}
    >
      {text}
    </div>
  );
}
