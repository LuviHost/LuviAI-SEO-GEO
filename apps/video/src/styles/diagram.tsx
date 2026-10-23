import React, { useMemo } from 'react';
import { AbsoluteFill } from 'remotion';
import { ArrowUpRight, Link2 } from 'lucide-react';
import { clamp01, ramp } from '../marketing/kit';
import { fitText, type Fit } from '../article-short/fit';
import { mix, rgba, type BrandPalette } from '../article-short/palette';
import { LogoTile } from '../article-short/ArticleShort';
import { WatermarkLine } from '../promo/shared';
import type { KitProps } from './StyledVideo';
import type { Story, Win } from './story';
import { fontInter, fontSora } from './fonts';
import { EASE, KineticText, Lines, ProductImage, brandGrad, fitK, linesH, splitLast, type FitBase } from './kit';

/**
 * DIYAGRAM — Manim denemesinin (15-manim/src/promo.py; Manim CE MIT, sahne bizim) teknigi Remotion'da
 * yeniden yazildi (sunucuya Python / Manim eklenmez):
 *   - noktali kagit zemin (aciklayici cizim tahtasi)
 *   - akis semasi: icerik kartlari dugum, aralarinda kendini cizen oklar (GrowArrow)
 *   - satir satir yukari kayarak gelen ortali basliklar (LaggedStart FadeIn shift)
 *   - tarama cizgisi (marka renginde, hafif parilti) dugumun ustunden gecer; etkin dugum cevreleme
 *     (Circumscribe) cizgisiyle vurgulanir; vurgu kelimesi (son kelime) o anda marka rengine doner
 *   - kapanis karti asagidan itilerek gelir; CTA hapi vuruslarda hafifce nabiz atar (Indicate)
 */

const PAPER = '#f7f5f2';
const INK = '#1d1d1f';
const SUB = '#6e6e73';
const HAIR = '#e3e3e8';
const F_HEAD: FitBase = { family: fontSora, weight: 700, letterSpacing: -0.03 };
const F_BODY: FitBase = { family: fontInter, weight: 500, letterSpacing: -0.01 };

type Geo = { W: number; H: number; x: number; w: number; top: number; bottom: number; wmTop: number; wmSize: number };
const TALL: Geo = { W: 1080, H: 1920, x: 90, w: 900, top: 360, bottom: 1430, wmTop: 1456, wmSize: 24 };
const WIDE: Geo = { W: 1920, H: 1080, x: 140, w: 1640, top: 120, bottom: 960, wmTop: 1012, wmSize: 22 };

type Row = { title: Fit; detail: Fit | null; h: number };
type Fits = {
  head: Fit;
  name: Fit | null;
  sub: Fit | null;
  kicker: Fit | null;
  source: Fit | null;
  header: Fit;
  points: Array<{ title: Fit; detail: Fit | null }>;
  rows: Row[];
  endName: Fit;
  label: Fit;
  domain: Fit;
  price: Fit | null;
  img: number;
};

function computeFits(story: Story, G: Geo): Fits {
  const wide = story.wide;
  const colW = story.kind === 'product' ? (wide ? 820 : 860) : wide ? 1300 : 860;
  let head!: Fit;
  let sub: Fit | null = null;
  let name: Fit | null = null;
  let img = 0;
  const kicker = story.kicker ? fitText(story.kicker, { ...F_BODY, weight: 600, maxWidth: colW - 140, maxLines: 1, maxSize: 32, minSize: 22 }) : null;
  const source = story.source ? fitText(story.source, { ...F_BODY, weight: 600, maxWidth: colW - 160, maxLines: 1, maxSize: 30, minSize: 20 }) : null;
  for (let k = 1; k >= 0.5; k -= 0.05) {
    head = fitK(story.hook, F_HEAD, k, { maxWidth: colW, maxLines: story.kind === 'product' ? 4 : wide ? 3 : 5, maxSize: story.kind === 'product' ? (wide ? 84 : 92) : wide ? 104 : 108, minSize: 60 });
    sub = story.hookSub ? fitK(story.hookSub, F_BODY, Math.max(0.85, k), { maxWidth: colW - 100, maxLines: 3, maxSize: wide ? 40 : 46, minSize: wide ? 30 : 40 }) : null;
    if (story.kind === 'site') name = fitK(story.brand.name, { ...F_HEAD, weight: 800 }, Math.max(0.8, k), { maxWidth: colW - 200, maxLines: 2, maxSize: wide ? 52 : 56, minSize: 34 });
    const nodeH = sub || kicker || source ? 60 + (kicker ? 60 : 0) + linesH(sub, 1.3) + (source ? 60 : 0) : 0;
    const top = story.kind === 'site' ? Math.max(130, linesH(name, 1.1) + 60) + 110 : 0;
    const h = top + linesH(head, 1.1) + (nodeH ? 130 + nodeH : 0);
    if (story.kind === 'product') {
      if (wide) {
        img = 640;
        if (h <= 780) break;
      } else {
        img = Math.round(Math.min(520, 1440 - 290 - 120 - h));
        if (img >= 360) break;
        img = Math.max(340, img);
      }
    } else if (h <= G.bottom - G.top) break;
  }
  const points = story.kind === 'article'
    ? story.points.map((p) => {
      let title!: Fit;
      let detail: Fit | null = null;
      for (let k = 1; k >= 0.5; k -= 0.05) {
        title = fitK(p.title, F_HEAD, k, { maxWidth: 820, maxLines: 4, maxSize: 96, minSize: 60 });
        detail = p.detail ? fitK(p.detail, F_BODY, Math.max(0.85, k), { maxWidth: 760, maxLines: 4, maxSize: 46, minSize: 38 }) : null;
        if (130 + linesH(title, 1.1) + (detail ? 140 + 80 + linesH(detail, 1.32) : 0) <= G.bottom - G.top) break;
      }
      return { title, detail };
    })
    : [];
  let rows: Row[] = [];
  if (story.list) {
    const wideSite = wide && story.kind === 'site';
    const textW = wideSite ? 420 : story.kind === 'product' ? (wide ? 760 : 800) - 110 : 860 - 110;
    const avail = wideSite ? 560 : story.kind === 'product' ? (wide ? 760 : 1440 - 290 - 380 - 40) : G.bottom - G.top - 40;
    for (let k = 1; k >= 0.5; k -= 0.05) {
      rows = story.points.map((p) => {
        const title = fitK(p.title, F_HEAD, k, { maxWidth: textW, maxLines: 3, maxSize: wideSite ? 50 : 56, minSize: 32 });
        const detail = p.detail ? fitK(p.detail, F_BODY, k, { maxWidth: textW, maxLines: wideSite ? 4 : 3, maxSize: 34, minSize: 24 }) : null;
        // yatay sitede numara rozeti basligin USTUNDE (58 + 18 bosluk)
        return { title, detail, h: Math.round((wideSite ? 68 + 76 : 60) + linesH(title, 1.1) + (detail ? 12 + linesH(detail, 1.3) : 0)) };
      });
      const total = wideSite ? Math.max(...rows.map((r) => r.h)) : rows.reduce((a, r) => a + r.h, 0) + 70 * (rows.length - 1);
      if (total <= avail) break;
    }
  }
  const endW = wide ? (story.kind === 'product' ? 820 : 1400) : 860;
  return {
    head,
    name,
    sub,
    kicker,
    source,
    header: fitText(story.header || story.brand.name, { family: fontSora, weight: 700, letterSpacing: -0.02, maxWidth: story.kind === 'product' ? 780 : 700, maxLines: 1, maxSize: 36, minSize: 20 }),
    points,
    rows,
    endName: fitText(story.endName, { ...F_HEAD, weight: 800, maxWidth: endW, maxLines: 2, maxSize: wide ? 100 : 110, minSize: 56 }),
    label: fitText(story.cta.label, { ...F_BODY, weight: 600, maxWidth: endW, maxLines: 1, maxSize: wide ? 42 : 48, minSize: 26 }),
    domain: fitText(story.cta.domain, { family: fontSora, weight: 700, letterSpacing: -0.02, maxWidth: wide && story.kind === 'product' ? 540 : 640, maxLines: 1, maxSize: 56, minSize: 24 }),
    price: story.price ? fitText(story.price, { family: fontSora, weight: 800, letterSpacing: -0.02, maxWidth: 380, maxLines: 1, maxSize: 52, minSize: 30 }) : null,
    img,
  };
}

export function DiagramStyle({ story, pal, win, frame }: KitProps) {
  const G = story.wide ? WIDE : TALL;
  const fits = useMemo(() => computeFits(story, G), [story, G]);
  const endPush = EASE.smooth(ramp(frame, win.endS - 6, win.endS + 6, (t) => t));
  return (
    <AbsoluteFill style={{ background: PAPER, color: INK, fontFamily: fontInter }}>
      <AbsoluteFill style={{ backgroundImage: `radial-gradient(${'#d9d5cf'} 2.6px, transparent 3px)`, backgroundSize: '72px 72px', backgroundPosition: '36px 36px' }} />
      <AbsoluteFill style={{ transform: `translateY(${-G.H * endPush}px)` }}>
        <Hook story={story} pal={pal} win={win} frame={frame} fits={fits} G={G} />
        {story.list ? <Flow story={story} pal={pal} win={win} frame={frame} fits={fits} G={G} /> : <Points story={story} pal={pal} win={win} frame={frame} fits={fits} G={G} />}
        <Header story={story} pal={pal} win={win} frame={frame} fits={fits} G={G} />
        {story.watermark && frame < win.endS + 2 ? <WatermarkLine top={G.wmTop} color={SUB} opacity={0.8 * win.wm(frame)} size={G.wmSize} /> : null}
      </AbsoluteFill>
      <End story={story} pal={pal} win={win} frame={frame} fits={fits} G={G} push={endPush} />
      {/* urun gorseli + fiyat itmeye katilmaz: fiyat kapanisa dek kesintisiz gorunur (okunurluk) */}
      {story.kind === 'product' ? <ImageNode story={story} pal={pal} win={win} frame={frame} fits={fits} G={G} /> : null}
    </AbsoluteFill>
  );
}

type P = { story: Story; pal: BrandPalette; win: Win; frame: number; fits: Fits; G: Geo };

/* ───────────── yapi taslari ───────────── */

/** Dugum karti: beyaz, ince cerceve, katmanli yumusak golge (Cairo'daki soft_shadow'un CSS karsiligi) */
function Node({ style, children, active = 0, pal }: { style?: React.CSSProperties; children?: React.ReactNode; active?: number; pal: BrandPalette }) {
  return (
    <div style={{ position: 'relative', background: '#ffffff', borderRadius: 40, border: `${1.5 + 2.5 * active}px solid ${active > 0.5 ? pal.primaryUi : HAIR}`, boxShadow: `0 10px 20px ${rgba(INK, 0.04)}, 0 24px 60px ${rgba(INK, 0.07)}`, boxSizing: 'border-box', ...style }}>
      {children}
    </div>
  );
}

/** Kendini cizen dik ok (GrowArrow): uzunluk p ile buyur, uc en son belirir */
function VArrow({ x, y, len, p, color }: { x: number; y: number; len: number; p: number; color: string }) {
  if (p <= 0) return null;
  const L = len * clamp01(p);
  return (
    <svg width={40} height={len + 4} style={{ position: 'absolute', left: x - 20, top: y, overflow: 'visible' }} aria-hidden>
      <line x1={20} y1={0} x2={20} y2={L} stroke={color} strokeWidth={5} strokeLinecap="round" />
      {p > 0.6 ? <path d={`M8 ${L - 14} L20 ${L} L32 ${L - 14}`} fill="none" stroke={color} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" opacity={clamp01((p - 0.6) / 0.3)} /> : null}
    </svg>
  );
}

function HArrow({ x, y, len, p, color }: { x: number; y: number; len: number; p: number; color: string }) {
  if (p <= 0) return null;
  const L = len * clamp01(p);
  return (
    <svg width={len + 4} height={40} style={{ position: 'absolute', left: x, top: y - 20, overflow: 'visible' }} aria-hidden>
      <line x1={0} y1={20} x2={L} y2={20} stroke={color} strokeWidth={5} strokeLinecap="round" />
      {p > 0.6 ? <path d={`M${L - 14} 8 L${L} 20 L${L - 14} 32`} fill="none" stroke={color} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" opacity={clamp01((p - 0.6) / 0.3)} /> : null}
    </svg>
  );
}

/** Cevreleme (Circumscribe): dugumun etrafinda kendini cizip silen yuvarlak dikdortgen */
function Circumscribe({ w, h, p, color, r = 46 }: { w: number; h: number; p: number; color: string; r?: number }) {
  if (p <= 0 || p >= 1) return null;
  const draw = clamp01(p * 1.6);
  const erase = clamp01((p - 0.55) / 0.45);
  const d = `M ${r} 0 H ${w - r} A ${r} ${r} 0 0 1 ${w} ${r} V ${h - r} A ${r} ${r} 0 0 1 ${w - r} ${h} H ${r} A ${r} ${r} 0 0 1 0 ${h - r} V ${r} A ${r} ${r} 0 0 1 ${r} 0 Z`;
  return (
    <svg width={w + 24} height={h + 24} viewBox={`-12 -12 ${w + 24} ${h + 24}`} style={{ position: 'absolute', left: -12, top: -12, overflow: 'visible' }} aria-hidden>
      <path d={d} fill="none" stroke={color} strokeWidth={6} strokeLinecap="round" pathLength={1} strokeDasharray={`${draw - erase} 1`} strokeDashoffset={-erase} />
    </svg>
  );
}

/** Tarama cizgisi (parilti bandiyla) — w genislikte, y0'dan y1'e dogrusal */
function ScanLine({ x, w, y0, y1, p, color }: { x: number; w: number; y0: number; y1: number; p: number; color: string }) {
  if (p <= 0 || p >= 1) return null;
  const y = y0 + (y1 - y0) * p;
  return (
    <>
      <div style={{ position: 'absolute', left: x, top: y - 30, width: w, height: 60, background: rgba(color, 0.08) }} />
      <div style={{ position: 'absolute', left: x, top: y - 2.5, width: w, height: 5, background: color, borderRadius: 99 }} />
    </>
  );
}

/** Satir satir yukari kayarak gelen ortali baslik; vurgu kelimesi verilen anda marka rengine doner */
function Head({ fit, p, pal, frame, colorAt, align = 'center', style }: { fit: Fit; p: number; pal: BrandPalette; frame: number; colorAt: number; align?: 'left' | 'center'; style?: React.CSSProperties }) {
  const c = ramp(frame, colorAt, colorAt + 8, (t) => t);
  return (
    <KineticText
      fit={fit}
      p={p}
      lineHeight={1.1}
      align={align}
      spread={0.3}
      style={{ fontFamily: fontSora, fontWeight: 700, letterSpacing: '-0.03em', color: INK, ...style }}
      wordStyle={(wp) => ({ opacity: clamp01(wp * 1.4), transform: `translateY(${(1 - clamp01(wp)) * 42}px)` })}
      last={(w) => {
        const [core, punct] = splitLast(w);
        return (
          <>
            <span style={{ color: mix(INK, pal.accentText, c) }}>{core}</span>
            {punct}
          </>
        );
      }}
    />
  );
}

const sparkle = (color: string, size = 30) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden style={{ flexShrink: 0 }}>
    <path d="M12 0 C12.9 7 17 11.1 24 12 C17 12.9 12.9 17 12 24 C11.1 17 7 12.9 0 12 C7 11.1 11.1 7 12 0 Z" fill={color} />
  </svg>
);

/* ───────────── kanca: baslik -> ok -> dugum ───────────── */

function Hook({ story, pal, win, frame, fits, G }: P) {
  const out = win.hookOut(frame);
  if (frame >= win.hookE + 2) return null;
  const tP = win.titleIn(frame);
  const sub = win.subIn(frame);
  const src = win.sourceIn(frame);
  const kick = win.kickerIn(frame);
  const arrow = ramp(frame, win.tl.at('hook.title') + 6, win.tl.at('hook.title') + 18, EASE.out);
  const product = story.kind === 'product';
  const site = story.kind === 'site';
  const colX = product && story.wide ? 960 : site && story.wide ? 310 : G.x;
  const colW = product ? (story.wide ? 820 : 860) : site && story.wide ? 1300 : G.w;
  const top = product ? (story.wide ? 140 : 290 + fits.img + 100) : G.top;
  const bottom = product ? (story.wide ? 940 : 1440) : G.bottom;
  const align: 'left' | 'center' = product && story.wide ? 'left' : 'center';
  const nodeIn = Math.max(sub, kick, src);
  const hasNode = !!(fits.sub || fits.kicker || fits.source);
  return (
    <div style={{ position: 'absolute', left: colX, top, width: colW, height: bottom - top, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: align === 'center' ? 'center' : 'flex-start', opacity: 1 - out, transform: `translateY(${-out * 90}px)` }}>
      {site ? (
        <>
          <Node pal={pal} style={{ display: 'flex', alignItems: 'center', gap: 26, padding: '26px 38px', opacity: clamp01(win.logoIn(frame) * 2), transform: `scale(${0.8 + 0.2 * clamp01(win.logoIn(frame))})` }}>
            <LogoTile brand={story.brand} size={96} pal={pal} />
            <div style={{ opacity: clamp01(win.nameIn(frame) * 1.5) }}>
              <Lines fit={fits.name!} lineHeight={1.1} style={{ fontFamily: fontSora, fontWeight: 800, letterSpacing: '-0.03em' }} />
            </div>
          </Node>
          <div style={{ position: 'relative', width: 40, height: 110 }}>
            <VArrow x={20} y={10} len={90} p={ramp(frame, win.tl.at('hook.name') + 4, win.tl.at('hook.name') + 14, EASE.out)} color={SUB} />
          </div>
        </>
      ) : null}
      <Head fit={fits.head} p={tP} pal={pal} frame={frame} colorAt={win.tl.at('hook.sub')} align={align} />
      {hasNode ? (
        <>
          <div style={{ position: 'relative', width: 40, height: 130 }}>
            <VArrow x={20} y={16} len={100} p={arrow} color={SUB} />
          </div>
          <Node pal={pal} style={{ width: colW, padding: '32px 46px', opacity: clamp01(nodeIn * 1.6), transform: `translateY(${(1 - clamp01(nodeIn)) * 26}px)` }}>
            {fits.kicker ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: fits.sub ? 20 : 0, opacity: clamp01(kick * 1.5) }}>
                {sparkle(pal.primary)}
                <Lines fit={fits.kicker} lineHeight={1.2} style={{ fontWeight: 600, color: SUB }} />
              </div>
            ) : null}
            {fits.sub ? <Lines fit={fits.sub} lineHeight={1.3} style={{ fontWeight: 500, color: INK, opacity: sub }} /> : null}
            {fits.source ? (
              <div style={{ marginTop: 22, display: 'flex', alignItems: 'center', gap: 12, opacity: src }}>
                <Link2 size={28} color={pal.accentText} strokeWidth={2.4} />
                <Lines fit={fits.source} lineHeight={1.2} style={{ fontWeight: 600, color: SUB }} />
              </div>
            ) : null}
          </Node>
        </>
      ) : null}
    </div>
  );
}

/* ───────────── makale maddeleri: baslik -> ok -> dugum, tarama + cevreleme ───────────── */

function Points({ pal, win, frame, fits, G }: P) {
  return (
    <>
      {fits.points.map((fp, i) => {
        const [s, e] = win.scene(i);
        if (frame < s - 8 || frame >= e + 2) return null;
        const inP = win.pointIn(i, frame);
        const tP = win.pointTitleIn(i, frame);
        const dP = win.detailIn(i, frame);
        const out = win.pointOut(i, frame);
        const det = win.tl.at(`p${i + 1}.detail`);
        const arrow = ramp(frame, det - 10, det, EASE.out);
        const scan = ramp(frame, det + 4, det + 4 + 1.5 * win.fpb, (t) => t);
        const circ = ramp(frame, det + 4 + 1.5 * win.fpb, det + 4 + 3 * win.fpb, (t) => t);
        const nodeH = fp.detail ? 76 + linesH(fp.detail, 1.32) : 0;
        return (
          <div key={i} style={{ position: 'absolute', left: G.x, top: G.top, width: G.w, height: G.bottom - G.top, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', opacity: (1 - out) * clamp01(inP * 1.6), transform: `translateY(${(1 - clamp01(inP)) * 60 - out * 90}px)` }}>
            <div style={{ width: 96, height: 96, borderRadius: 99, display: 'grid', placeItems: 'center', background: brandGrad(pal), color: pal.onPrimary, fontFamily: fontSora, fontWeight: 800, fontSize: 40, marginBottom: 34, transform: `scale(${0.6 + 0.4 * clamp01(inP)})` }}>{i + 1}</div>
            <Head fit={fp.title} p={tP} pal={pal} frame={frame} colorAt={det} />
            {fp.detail ? (
              <>
                <div style={{ position: 'relative', width: 40, height: 140 }}>
                  <VArrow x={20} y={20} len={100} p={arrow} color={pal.primaryUi} />
                </div>
                <div style={{ position: 'relative', width: 860, height: nodeH }}>
                  <Node pal={pal} active={circ > 0 && circ < 1 ? 1 : 0} style={{ position: 'absolute', inset: 0, padding: '38px 46px', overflow: 'hidden', opacity: clamp01(dP * 1.6) }}>
                    <Lines fit={fp.detail} lineHeight={1.32} style={{ fontWeight: 500, color: INK }} />
                  </Node>
                  <ScanLine x={0} w={860} y0={0} y1={nodeH} p={scan} color={pal.primary} />
                  <Circumscribe w={860} h={nodeH} p={circ} color={pal.primaryUi} />
                </div>
              </>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

/* ───────────── liste: dugumler oklarla bagli akis ───────────── */

function Flow({ story, pal, win, frame, fits, G }: P) {
  const [p1s] = win.scene(0);
  if (frame < p1s - 8 || frame >= win.endS + 2) return null;
  const out = win.pointOut(0, frame);
  const wideSite = story.wide && story.kind === 'site';
  const product = story.kind === 'product';
  const x0 = product ? (story.wide ? 960 : (1080 - 800) / 2) : G.x;
  const w = product ? (story.wide ? 760 : 800) : 860;
  const top = product ? (story.wide ? 140 : 290 + 380 + 40) : G.top;
  const avail = product ? (story.wide ? 800 : 1440 - top) : G.bottom - G.top;
  const gap = 70;
  const full = wideSite ? Math.max(...fits.rows.map((r) => r.h)) : fits.rows.reduce((a, r) => a + r.h, 0) + gap * (fits.rows.length - 1);
  let y = top + Math.max(0, (avail - full) / 2);
  const cardW = 480;
  const sx = (G.W - (3 * cardW + 2 * 100)) / 2;
  return (
    <div style={{ position: 'absolute', inset: 0, opacity: 1 - out }}>
      {fits.rows.map((r, i) => {
        const [s, e] = win.scene(i);
        const rowTop = y;
        y += r.h + gap;
        if (frame < s - 6) return null;
        const inP = win.pointIn(i, frame);
        const det = win.detailIn(i, frame);
        const active = frame < e;
        const circ = ramp(frame, s + 8, s + 8 + 2 * win.fpb, (t) => t);
        const scan = ramp(frame, s + 2, s + 2 + win.fpb, (t) => t);
        const arrowP = i > 0 ? ramp(frame, s - 6, s + 4, EASE.out) : 0;
        const pos = wideSite ? { left: sx + i * (cardW + 100), top: 260 + Math.max(0, (560 - full) / 2), width: cardW, height: full } : { left: x0, top: rowTop, width: w, height: r.h };
        return (
          <React.Fragment key={i}>
            {i > 0 ? (wideSite ? <HArrow x={pos.left - 90} y={pos.top + full / 2} len={80} p={arrowP} color={SUB} /> : <VArrow x={x0 + w / 2} y={rowTop - gap + 8} len={gap - 16} p={arrowP} color={SUB} />) : null}
            <div style={{ position: 'absolute', ...pos, opacity: clamp01(inP * 1.6), transform: `translateY(${(1 - clamp01(inP)) * 40}px)` }}>
              <Node pal={pal} active={active && circ > 0 && circ < 1 ? 1 : 0} style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: wideSite ? 'column' : 'row', gap: wideSite ? 18 : 28, alignItems: 'flex-start', padding: wideSite ? '34px 36px' : '30px 34px', overflow: 'hidden' }}>
                <div style={{ width: 58, height: 58, flexShrink: 0, borderRadius: 99, display: 'grid', placeItems: 'center', background: active ? brandGrad(pal) : rgba(INK, 0.08), color: active ? pal.onPrimary : SUB, fontFamily: fontSora, fontWeight: 800, fontSize: 26 }}>{i + 1}</div>
                <div style={{ minWidth: 0 }}>
                  <Lines fit={r.title} lineHeight={1.1} style={{ fontFamily: fontSora, fontWeight: 700, letterSpacing: '-0.025em' }} />
                  {r.detail ? <Lines fit={r.detail} lineHeight={1.3} style={{ marginTop: 12, fontWeight: 500, color: '#3a3a3c', opacity: clamp01(det * 1.5) }} /> : null}
                </div>
              </Node>
              {active ? <ScanLine x={0} w={pos.width} y0={0} y1={pos.height} p={scan} color={pal.primary} /> : null}
              {active ? <Circumscribe w={pos.width} h={pos.height} p={circ} color={pal.primaryUi} /> : null}
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

/* ───────────── urun gorseli dugumu ───────────── */

function ImageNode({ story, pal, win, frame, fits }: P) {
  const inP = win.logoIn(frame);
  const shrink = ramp(frame, win.hookE - 8, win.hookE + 4, EASE.smooth);
  const endP = EASE.smooth(ramp(frame, win.endS - 6, win.endS + 6, (t) => t));
  let x: number;
  let y: number;
  let size: number;
  if (story.wide) {
    size = 640;
    x = 170;
    y = 220;
  } else {
    size = fits.img + (380 - fits.img) * shrink + 40 * endP;
    x = (1080 - size) / 2;
    y = 290 + 10 * endP;
  }
  const priceP = win.priceIn(frame);
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: size, height: size, opacity: clamp01(inP * 2), transform: `scale(${0.85 + 0.15 * clamp01(inP)})` }}>
      <Node pal={pal} style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: story.image ? '#ffffff' : pal.primary }}>
        <ProductImage src={story.image} frame={frame} total={win.total} fallback={<LogoTile brand={story.brand} size={size * 0.4} pal={pal} />} />
      </Node>
      {story.image ? (
        <div style={{ position: 'absolute', left: -20, bottom: -20 }}>
          <LogoTile brand={story.brand} size={Math.round(size * 0.18)} pal={pal} />
        </div>
      ) : null}
      {story.price && fits.price ? (
        <div style={{ position: 'absolute', right: -24, top: 28, display: 'flex', alignItems: 'center', opacity: clamp01(priceP * 1.6), transform: `scale(${0.6 + 0.4 * clamp01(priceP)})` }}>
          <Node pal={pal} active={1} style={{ padding: '12px 26px', borderRadius: 24 }}>
            <Lines fit={fits.price} lineHeight={1.15} style={{ fontFamily: fontSora, fontWeight: 800, color: pal.accentText }} />
          </Node>
        </div>
      ) : null}
    </div>
  );
}

/* ───────────── ust satir ───────────── */

function Header({ story, pal, win, frame, fits, G }: P) {
  if (!story.header || frame >= win.endS + 2) return null;
  const p = win.headerIn(frame);
  if (p <= 0.001) return null;
  const out = win.headerOut(frame);
  const product = story.kind === 'product';
  return (
    <div style={{ position: 'absolute', left: product ? 960 : G.x, top: story.wide ? 44 : 250, display: 'flex', alignItems: 'center', gap: 18, opacity: clamp01(p * 1.5) * (1 - out) }}>
      {!product ? <LogoTile brand={story.brand} size={story.wide ? 60 : 72} pal={pal} /> : null}
      <span style={{ fontFamily: fontSora, fontWeight: 700, fontSize: fits.header.size, whiteSpace: 'nowrap', letterSpacing: '-0.02em' }}>{fits.header.lines[0]}</span>
    </div>
  );
}

/* ───────────── kapanis karti: asagidan itilir ───────────── */

function End({ story, pal, win, frame, fits, G, push }: P & { push: number }) {
  const s = win.endS;
  if (frame < s - 6) return null;
  const product = story.kind === 'product';
  const tile = win.endTileIn(frame);
  const nm = win.endNameIn(frame);
  const lab = win.labelIn(frame);
  const cta = win.ctaIn(frame);
  const mark = win.markIn(frame);
  // Indicate: CTA hapi vuruslarda (there_and_back) %5 buyur
  const since = win.sinceBeat(frame - win.tl.at('end.cta'), 2);
  const beat = frame > win.tl.at('end.cta') + 10 ? Math.sin(Math.PI * clamp01(since / 14)) : 0;
  const ind = Math.sin(Math.PI * ramp(frame, s + 6, s + 20, (t) => t));
  const box: React.CSSProperties = product
    ? story.wide ? { left: 960, width: 820, top: 260, alignItems: 'flex-start', textAlign: 'left' } : { left: G.x, width: G.w, top: 760, alignItems: 'center', textAlign: 'center' }
    : story.wide ? { left: 160, width: 1600, top: 440, alignItems: 'center', textAlign: 'center' } : { left: G.x, width: G.w, top: 820, alignItems: 'center', textAlign: 'center' };
  const align = box.textAlign as 'left' | 'center';
  return (
    <AbsoluteFill style={{ transform: `translateY(${G.H * (1 - push)}px)` }}>
      {!product ? (
        <div style={{ position: 'absolute', left: (G.W - 220) / 2, top: story.wide ? 160 : 520, transform: `scale(${(0.8 + 0.2 * clamp01(tile)) * (1 + 0.08 * ind)})` }}>
          <LogoTile brand={story.brand} size={220} pal={pal} />
        </div>
      ) : null}
      <div style={{ position: 'absolute', display: 'flex', flexDirection: 'column', ...box }}>
        <Lines fit={fits.endName} lineHeight={1.05} align={align} style={{ fontFamily: fontSora, fontWeight: 800, letterSpacing: '-0.03em', opacity: clamp01(nm * 1.5), transform: `translateY(${(1 - clamp01(nm)) * 30}px)` }} />
        <div style={{ marginTop: story.wide ? 34 : 54, opacity: lab }}>
          <Lines fit={fits.label} lineHeight={1.2} align={align} style={{ fontWeight: 600, color: SUB }} />
        </div>
        <div style={{ marginTop: 24, display: 'inline-flex', alignItems: 'center', gap: 14, padding: `${fits.domain.size * 0.45}px ${fits.domain.size * 0.8}px`, borderRadius: 99, background: brandGrad(pal, 90), color: pal.onPrimary, fontFamily: fontSora, fontWeight: 700, fontSize: fits.domain.size, whiteSpace: 'nowrap', boxShadow: `0 18px 40px ${rgba(pal.primaryDeep, 0.28)}`, opacity: clamp01(cta * 1.5), transform: `scale(${(0.8 + 0.2 * clamp01(cta)) * (1 + 0.05 * beat)})` }}>
          {fits.domain.lines[0]}
          <ArrowUpRight size={fits.domain.size * 0.9} strokeWidth={2.8} />
        </div>
      </div>
      {story.watermark ? <WatermarkLine top={G.wmTop - (story.wide ? 0 : 16)} color={SUB} opacity={0.8 * mark} size={story.wide ? 22 : 26} /> : null}
    </AbsoluteFill>
  );
}
