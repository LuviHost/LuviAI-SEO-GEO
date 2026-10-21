/**
 * RanksUp Video duyuru filmlerinin (VideoLaunch, VideoLaunchVertical) ortak parcalari.
 *
 * Ornek videolar EKRAN GORUNTUSU DEGIL: urunun kendi sablonlari (ArticleShort, SiteIntro,
 * ProductShort) burada telefon/ekran cercevesi icinde yeniden cizilir. Zaman eslemesi <Freeze>
 * ile yapilir — her kare ic kompozisyonun hangi karesinin gosterilecegini acikca hesaplar
 * (hizlandirma/kaydirma deterministik; CSS animasyonu yok).
 */
import React from 'react';
import { Freeze } from 'remotion';
import { FileText, Globe, Lock, Package, Play } from 'lucide-react';
import { alpha, brand } from '../tokens';
import { M, clamp01, fontMono, snap } from '../marketing/kit';
import { ArticleShort, ARTICLE_SHORT_DURATION } from '../article-short/ArticleShort';
import { SiteIntro, SiteIntroWide, SITE_INTRO_DURATION, SITE_INTRO_WIDE_DURATION } from '../promo/SiteIntro';
import { ProductShort, PRODUCT_SHORT_DURATION } from '../promo/ProductShort';
import { articleExample, productExample, siteExample } from './examples';

export type SourceKind = 'article' | 'site' | 'product';

/** Ic kompozisyonun karesi: start'ta offset'ten baslar, rate hizinda ilerler, son karede durur */
export function Clip({ frame, start, offset = 0, rate = 1, total, children }: { frame: number; start: number; offset?: number; rate?: number; total: number; children: React.ReactNode }) {
  const f = Math.min(total - 1, Math.max(0, Math.round(offset + (frame - start) * rate)));
  return <Freeze frame={f}>{children}</Freeze>;
}

/** Kaynak turune gore gercek dikey sablon (ses kapali) */
export function VerticalExample({ kind, frame, start, offset = 0, rate = 1 }: { kind: SourceKind; frame: number; start: number; offset?: number; rate?: number }) {
  if (kind === 'article')
    return (
      <Clip frame={frame} start={start} offset={offset} rate={rate} total={ARTICLE_SHORT_DURATION}>
        <ArticleShort {...articleExample} />
      </Clip>
    );
  if (kind === 'site')
    return (
      <Clip frame={frame} start={start} offset={offset} rate={rate} total={SITE_INTRO_DURATION}>
        <SiteIntro {...siteExample} />
      </Clip>
    );
  return (
    <Clip frame={frame} start={start} offset={offset} rate={rate} total={PRODUCT_SHORT_DURATION}>
      <ProductShort {...productExample} />
    </Clip>
  );
}

export function WideSiteExample({ frame, start, offset = 0, rate = 1 }: { frame: number; start: number; offset?: number; rate?: number }) {
  return (
    <Clip frame={frame} start={start} offset={offset} rate={rate} total={SITE_INTRO_WIDE_DURATION}>
      <SiteIntroWide {...siteExample} />
    </Clip>
  );
}

/** Telefon cercevesi: icerik 1080×1920 kompozisyon, ekrana olceklenir. Genislik = phoneWidth(height). */
export function phoneWidth(height: number) {
  const bezel = Math.round(height * 0.022);
  return Math.round(((height - 2 * bezel) * 1080) / 1920) + 2 * bezel;
}

export function Phone({ height, children, style }: { height: number; children: React.ReactNode; style?: React.CSSProperties }) {
  const bezel = Math.round(height * 0.022);
  const screenH = height - 2 * bezel;
  const scale = screenH / 1920;
  const screenW = Math.round(1080 * scale);
  return (
    <div
      style={{
        position: 'absolute',
        width: screenW + 2 * bezel,
        height,
        boxSizing: 'border-box',
        padding: bezel,
        borderRadius: height * 0.075,
        background: M.ink,
        boxShadow: `0 ${height * 0.05}px ${height * 0.11}px ${alpha(M.ink, 0.28)}, inset 0 0 0 ${Math.max(2, height * 0.003)}px ${alpha('#ffffff', 0.12)}`,
        ...style,
      }}
    >
      <div style={{ position: 'relative', width: screenW, height: screenH, borderRadius: height * 0.058, overflow: 'hidden', background: '#ffffff' }}>
        <div style={{ position: 'absolute', left: 0, top: 0, width: 1080, height: 1920, transform: `scale(${scale})`, transformOrigin: '0 0' }}>{children}</div>
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: screenH * 0.014,
            width: screenW * 0.3,
            height: screenH * 0.032,
            marginLeft: -screenW * 0.15,
            borderRadius: 999,
            background: M.ink,
          }}
        />
      </div>
    </div>
  );
}

/** Yatay ekran cercevesi (1920×1080 icerik) */
export function WideScreen({ width, children, style }: { width: number; children: React.ReactNode; style?: React.CSSProperties }) {
  const bezel = Math.round(width * 0.018);
  const screenW = width - 2 * bezel;
  const scale = screenW / 1920;
  const screenH = Math.round(1080 * scale);
  return (
    <div
      style={{
        position: 'absolute',
        width,
        height: screenH + 2 * bezel,
        boxSizing: 'border-box',
        padding: bezel,
        borderRadius: width * 0.035,
        background: M.ink,
        boxShadow: `0 ${width * 0.04}px ${width * 0.09}px ${alpha(M.ink, 0.3)}`,
        ...style,
      }}
    >
      <div style={{ position: 'relative', width: screenW, height: screenH, borderRadius: width * 0.02, overflow: 'hidden', background: '#ffffff' }}>
        <div style={{ position: 'absolute', left: 0, top: 0, width: 1920, height: 1080, transform: `scale(${scale})`, transformOrigin: '0 0' }}>{children}</div>
      </div>
    </div>
  );
}

/** Tarayici karti: kaynak sayfanin sematik gorunumu (metinler sayfanin kendi metni) */
export function BrowserCard({ url, width, height, children, style, urlHighlight = 0 }: { url: string; width: number; height: number; children: React.ReactNode; style?: React.CSSProperties; urlHighlight?: number }) {
  return (
    <div
      style={{
        position: 'absolute',
        width,
        height,
        borderRadius: 28,
        background: M.paper,
        border: `1.5px solid ${M.hair}`,
        boxShadow: `0 30px 80px ${alpha(M.ink, 0.1)}, 0 6px 18px ${alpha(M.ink, 0.05)}`,
        overflow: 'hidden',
        ...style,
      }}
    >
      <div style={{ height: 64, display: 'flex', alignItems: 'center', gap: 14, padding: '0 22px', background: M.fill, borderBottom: `1.5px solid ${M.hair}` }}>
        {[0, 1, 2].map((i) => (
          <span key={i} style={{ width: 13, height: 13, borderRadius: 99, background: alpha(M.ink, 0.16) }} />
        ))}
        <div
          style={{
            marginLeft: 10,
            flex: 1,
            minWidth: 0,
            height: 40,
            borderRadius: 12,
            background: M.paper,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '0 16px',
            fontFamily: fontMono,
            fontWeight: 600,
            fontSize: 21,
            color: M.inkSoft,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            boxShadow: urlHighlight > 0 ? `0 0 0 ${3 * urlHighlight}px ${alpha(brand[500], 0.6)}` : undefined,
          }}
        >
          <Lock size={18} color={M.muted} style={{ flexShrink: 0 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{url}</span>
        </div>
      </div>
      <div style={{ position: 'relative', padding: '30px 36px' }}>{children}</div>
    </div>
  );
}

/** Kaynak sayfada "secilen" ogeyi isaretleyen vurgu (sol serit + acik turuncu zemin) */
export function Mark({ on, children, style }: { on: number; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        position: 'relative',
        borderRadius: 12,
        padding: '6px 14px',
        margin: '0 -14px',
        background: alpha(brand[500], 0.11 * on),
        boxShadow: `inset ${5 * on}px 0 0 ${brand[500]}`,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export const Bar = ({ w, h = 14, mt = 12 }: { w: number | string; h?: number; mt?: number }) => (
  <div style={{ width: w, height: h, marginTop: mt, borderRadius: 99, background: alpha(M.ink, 0.08) }} />
);

const KIND_ICON = { article: FileText, site: Globe, product: Package } as const;

/** Kaynak ikonu karosu; flip (0..1) anindan sonra oynat ikonu degrade karoda */
export function SourceTile({ kind, size, flipAt, frame }: { kind: SourceKind; size: number; flipAt: number; frame: number }) {
  const t = frame - flipAt;
  const squash = t < -4 || t > 4 ? 1 : Math.abs(t) / 4;
  const flipped = t >= 0;
  const Icon = KIND_ICON[kind];
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.29,
        display: 'grid',
        placeItems: 'center',
        flexShrink: 0,
        background: flipped ? M.grad : M.paper,
        border: flipped ? 'none' : `2px solid ${M.hair}`,
        boxShadow: flipped ? `0 ${size * 0.15}px ${size * 0.35}px ${alpha(brand[700], 0.3)}` : `0 ${size * 0.08}px ${size * 0.2}px ${alpha(M.ink, 0.06)}`,
        transform: `scaleX(${squash})`,
      }}
    >
      {flipped ? <Play size={size * 0.46} color="#ffffff" fill="#ffffff" style={{ marginLeft: size * 0.06 }} /> : <Icon size={size * 0.5} color={brand[600]} strokeWidth={2.2} />}
    </div>
  );
}

/** snap girisi: ilerleme + saydamlik */
export function appear(frame: number, at: number) {
  const p = snap(frame, at);
  return { opacity: clamp01(p * 1.5), p };
}
