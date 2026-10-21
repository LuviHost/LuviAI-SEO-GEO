import React, { useMemo } from 'react';
import { AbsoluteFill, Easing, useCurrentFrame } from 'remotion';
import { clamp01, fontDisplay, fontUI, ramp, useBrandFonts } from '../marketing/kit';
import { timeline } from '../marketing/timeline';
import { TempoProvider, TempoSoundtrack, tempoTimeline, useTL, type TempoTimeline } from '../tempo/TempoTimeline';
import { fitText, type Fit } from '../article-short/fit';
import { brandPalette, rgba, type BrandPalette } from '../article-short/palette';
import { LogoTile } from '../article-short/ArticleShort';
import { CtaPill, DISPLAY, FitLines, BrandField, UI, WatermarkLine, fitK, linesH, type PromoBaseProps } from './shared';

/**
 * SiteIntro — musterinin kendi sitesinden "site tanitim videosu".
 *   SiteIntro     1080×1920 (Reels / Shorts / TikTok)        'fast' 15 sn
 *   SiteIntroWide 1920×1080 (web sitesi, video platformlari) 'fast' 24 sn
 * normal / slow tempoda sure metinden (src/tempo/plan.mjs, en fazla 60 sn).
 *
 * Gorsel dil MARKA ONDE: tum zemin marka rengi (palette.ts kontrasta gore yazi rengini secer —
 * sari, acik mavi ya da lacivert ayni okunurlukta), acilista buyuk logo karosu + ad + isletmenin
 * ne yaptigi; uc hizmet karti ust uste (yatayda yan yana) birikir; kapanista acik zemin, alan adi.
 * Logo yoksa bas harf monogrami (LogoTile). Metinler fit.ts ile olculup sigdirilir.
 * Zamanlama baglamdaki tempo cizelgesinden (useTL; fast'ta timeline.json 'SiteIntro' / 'SiteIntroWide').
 */

export type SiteIntroProps = PromoBaseProps;

/** 'fast' tempodaki sabit sureler (Root.tsx varsayilani; asil sure calculateMetadata'dan) */
export const SITE_INTRO_DURATION = timeline('SiteIntro').durationInFrames;
export const SITE_INTRO_WIDE_DURATION = timeline('SiteIntroWide').durationInFrames;

export const siteIntroDefaults: SiteIntroProps = {
  hook: 'Örnek işletme ne yapar?',
  hookSub: 'Bu metin yalnız Studio önizlemesi içindir.',
  kicker: '',
  points: [{ title: 'Örnek hizmet bir' }, { title: 'Örnek hizmet iki', detail: 'Gerçek videoda sitenin kendi başlıkları yer alır.' }, { title: 'Örnek hizmet üç' }],
  cta: { label: 'Sitemizi ziyaret edin', domain: 'ornekklinik.com' },
  brand: { name: 'Örnek Klinik', domain: 'ornekklinik.com' },
  muted: false,
  watermark: true,
  tempo: 'normal',
};

/* ═════════════ dikey ═════════════ */

const V = { left: 90, width: 860, hookTop: 280, hookBottom: 1440, bandTop: 420, bandBottom: 1420 } as const;

type CardFit = { title: Fit; detail: Fit | null; h: number };
type VFits = { tile: number; name: Fit; hook: Fit; sub: Fit | null; headName: Fit; cards: CardFit[]; gap: number; endName: Fit; domain: Fit };

function vHookHeight(tile: number, name: Fit, hook: Fit, sub: Fit | null) {
  return tile + 40 + linesH(name, 1.05) + 44 + 8 + 44 + linesH(hook, 1.06) + (sub ? 36 + linesH(sub, 1.28) : 0);
}

export const SiteIntro: React.FC<SiteIntroProps> = (props) => {
  const ready = useBrandFonts();
  const frame = useCurrentFrame();
  const TL = useMemo(() => tempoTimeline('SiteIntro', props), [props]);
  const pal = useMemo(() => brandPalette(props.brand.primary), [props.brand.primary]);
  const points = useMemo(() => props.points.slice(0, 3), [props.points]);

  const fits = useMemo<VFits | null>(() => {
    if (!ready) return null;
    let tile = 240;
    let name!: Fit;
    let hook!: Fit;
    let sub: Fit | null = null;
    for (let k = 1; k >= 0.6; k -= 0.05) {
      tile = Math.round(240 * Math.max(0.7, k));
      name = fitK(props.brand.name, DISPLAY, k, { maxWidth: V.width, maxLines: 2, maxSize: 88, minSize: 56 });
      hook = fitK(props.hook, DISPLAY, k, { maxWidth: V.width, maxLines: 4, maxSize: 100, minSize: 60 });
      sub = props.hookSub ? fitK(props.hookSub, UI, k, { maxWidth: V.width, maxLines: 3, maxSize: 46, minSize: 32, weight: 600 }) : null;
      if (vHookHeight(tile, name, hook, sub) <= V.hookBottom - V.hookTop) break;
    }
    const textW = V.width - 80 - 84 - 30;
    let cards: CardFit[] = [];
    let gap = 28;
    for (let k = 1; k >= 0.6; k -= 0.05) {
      cards = points.map((p) => {
        const title = fitK(p.title, DISPLAY, k, { maxWidth: textW, maxLines: 3, maxSize: 72, minSize: 40 });
        const detail = p.detail ? fitK(p.detail, UI, k, { maxWidth: textW, maxLines: 3, maxSize: 38, minSize: 28, weight: 600 }) : null;
        // Kisa hizmet adinda kart cok ince kalmasin: en az 220 px (uc kart bandin cogunu doldurur)
        return { title, detail, h: 72 + Math.max(Math.round(148 * k), linesH(title, 1.08) + (detail ? 14 + linesH(detail, 1.3) : 0)) };
      });
      gap = Math.round(28 * k);
      if (cards.reduce((a, c) => a + c.h, 0) + gap * 2 <= V.bandBottom - V.bandTop) break;
    }
    return {
      tile,
      name,
      hook,
      sub,
      cards,
      gap,
      headName: fitText(props.brand.name, { ...UI, weight: 800, maxWidth: V.width - 120, maxLines: 1, maxSize: 44, minSize: 26 }),
      endName: fitText(props.brand.name, { ...DISPLAY, maxWidth: V.width, maxLines: 2, maxSize: 104, minSize: 60 }),
      domain: fitText(props.cta.domain, { family: fontDisplay, weight: 700, letterSpacing: -0.02, maxWidth: V.width - 230, maxLines: 1, maxSize: 62, minSize: 30 }),
    };
  }, [ready, props.brand.name, props.hook, props.hookSub, props.cta.domain, points]);

  return (
    <TempoProvider value={TL}>
      <AbsoluteFill style={{ fontFamily: fontUI, color: pal.onPrimary, overflow: 'hidden' }}>
        <TempoSoundtrack tl={TL} muted={props.muted ?? false} />
        <BrandField pal={pal} />
        {fits ? (
          <>
            <VHook frame={frame} pal={pal} fits={fits} brand={props.brand} />
            <VHeader frame={frame} pal={pal} fits={fits} brand={props.brand} />
            <VCards frame={frame} pal={pal} fits={fits} />
            {props.watermark !== false ? <BrandWatermark frame={frame} pal={pal} tl={TL} top={1452} /> : null}
            <EndCard frame={frame} pal={pal} tl={TL} brand={props.brand} label={props.cta.label} name={fits.endName} domain={fits.domain} watermark={props.watermark !== false} wide={false} />
          </>
        ) : null}
      </AbsoluteFill>
    </TempoProvider>
  );
};

function VHook({ frame, pal, fits, brand }: { frame: number; pal: BrandPalette; fits: VFits; brand: PromoBaseProps['brand'] }) {
  const TL = useTL();
  const [, e] = TL.scene('hook');
  if (frame >= e + 2) return null;
  const out = ramp(frame, e - 10, e - 2, Easing.in(Easing.cubic));
  const logo = TL.snap(frame, TL.at('hook.logo') + 4);
  const name = TL.snap(frame, TL.at('hook.name'));
  const bar = ramp(frame, TL.at('hook.name') + 2, TL.at('hook.title'));
  const title = TL.snap(frame, TL.at('hook.title'));
  const sub = TL.soft(frame, TL.at('hook.sub'));
  return (
    <div
      style={{
        position: 'absolute',
        left: V.left,
        width: V.width,
        top: V.hookTop,
        height: V.hookBottom - V.hookTop,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        opacity: 1 - out,
        transform: `translateY(${-out * 120}px)`,
      }}
    >
      <div style={{ transform: `scale(${0.4 + 0.6 * logo}) rotate(${(1 - logo) * -8}deg)`, opacity: clamp01(logo * 1.6) }}>
        <LogoTile brand={brand} size={fits.tile} pal={pal} />
      </div>
      <FitLines
        fit={fits.name}
        lineHeight={1.05}
        align="center"
        style={{ marginTop: 40, fontFamily: fontDisplay, fontWeight: 800, letterSpacing: '-0.035em', opacity: clamp01(name * 1.5), transform: `translateY(${(1 - name) * 40}px)` }}
      />
      <div style={{ marginTop: 44, width: 140 * bar, height: 8, borderRadius: 99, background: rgba(pal.onPrimary, 0.55) }} />
      <FitLines
        fit={fits.hook}
        lineHeight={1.06}
        align="center"
        style={{ marginTop: 44, fontFamily: fontDisplay, fontWeight: 800, letterSpacing: '-0.035em', opacity: clamp01(title * 1.5), transform: `translateY(${(1 - title) * 50}px)` }}
      />
      {fits.sub ? (
        <FitLines
          fit={fits.sub}
          lineHeight={1.28}
          align="center"
          style={{ marginTop: 36, fontFamily: fontUI, fontWeight: 600, opacity: 0.88 * sub, transform: `translateY(${(1 - sub) * 24}px)` }}
        />
      ) : null}
    </div>
  );
}

function VHeader({ frame, pal, fits, brand }: { frame: number; pal: BrandPalette; fits: VFits; brand: PromoBaseProps['brand'] }) {
  const TL = useTL();
  const [s] = TL.scene('p1');
  const [endS] = TL.scene('end');
  if (frame < s - 8 || frame >= endS + 6) return null;
  const p = TL.snap(frame, s);
  const out = ramp(frame, endS - 6, endS, Easing.in(Easing.cubic));
  return (
    <div style={{ position: 'absolute', left: V.left, top: 262, display: 'flex', alignItems: 'center', gap: 24, opacity: clamp01(p * 1.5) * (1 - out), transform: `translateY(${(1 - p) * -30}px)` }}>
      <LogoTile brand={brand} size={84} pal={pal} />
      <span style={{ fontFamily: fontUI, fontWeight: 800, fontSize: fits.headName.size, whiteSpace: 'nowrap' }}>{fits.headName.lines[0]}</span>
    </div>
  );
}

function CardBody({ pal, index, fit, active, badge = 84, pad = 40, column = false }: { pal: BrandPalette; index: number; fit: CardFit; active: boolean; badge?: number; pad?: number; column?: boolean }) {
  return (
    <div
      style={{
        boxSizing: 'border-box',
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: column ? 'column' : 'row',
        alignItems: column ? 'flex-start' : 'center',
        gap: column ? 26 : 30,
        padding: `${pad * 0.9}px ${pad}px`,
        borderRadius: 36,
        background: pal.paper,
        color: pal.ink,
        boxShadow: active ? `0 34px 80px ${rgba('#000000', 0.28)}` : `0 16px 40px ${rgba('#000000', 0.16)}`,
      }}
    >
      <div
        style={{
          width: badge,
          height: badge,
          flexShrink: 0,
          borderRadius: 999,
          display: 'grid',
          placeItems: 'center',
          background: `linear-gradient(150deg, ${pal.primary} 0%, ${pal.primaryDeep} 100%)`,
          color: pal.onPrimary,
          fontFamily: fontDisplay,
          fontWeight: 800,
          fontSize: badge * 0.46,
        }}
      >
        {index + 1}
      </div>
      <div style={{ minWidth: 0 }}>
        <FitLines fit={fit.title} lineHeight={1.08} style={{ fontFamily: fontDisplay, fontWeight: 800, letterSpacing: '-0.03em' }} />
        {fit.detail ? <FitLines fit={fit.detail} lineHeight={1.3} style={{ marginTop: 14, fontFamily: fontUI, fontWeight: 600, color: pal.body }} /> : null}
      </div>
    </div>
  );
}

function VCards({ frame, pal, fits }: { frame: number; pal: BrandPalette; fits: VFits }) {
  const TL = useTL();
  const [endS] = TL.scene('end');
  const [p1s] = TL.scene('p1');
  if (frame < p1s - 8 || frame >= endS + 4) return null;
  const total = fits.cards.reduce((a, c) => a + c.h, 0) + fits.gap * (fits.cards.length - 1);
  let y = V.bandTop + Math.max(0, (V.bandBottom - V.bandTop - total) / 2);
  const out = ramp(frame, endS - 6, endS, Easing.in(Easing.cubic));
  return (
    <>
      {fits.cards.map((c, i) => {
        const id = `p${i + 1}`;
        const [s, e] = TL.scene(id);
        const top = y;
        y += c.h + fits.gap;
        if (frame < s - 6) return null;
        const inP = TL.snap(frame, s, 30, 5);
        const active = frame < e;
        const dim = active ? 0 : ramp(frame, e, e + 8);
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: V.left,
              top,
              width: V.width,
              height: c.h,
              opacity: clamp01(inP * 1.5) * (1 - 0.22 * dim) * (1 - out),
              transform: `translateX(${(1 - inP) * 160}px) scale(${1 - 0.03 * dim})`,
              transformOrigin: 'left center',
            }}
          >
            <CardBody pal={pal} index={i} fit={c} active={active} />
          </div>
        );
      })}
    </>
  );
}

function BrandWatermark({ frame, pal, tl, top, size = 24 }: { frame: number; pal: BrandPalette; tl: TempoTimeline; top: number; size?: number }) {
  const [endS] = tl.scene('end');
  if (frame >= endS + 2) return null;
  const vis = tl.soft(frame, 8) * (1 - ramp(frame, endS - 6, endS));
  return <WatermarkLine top={top} color={pal.onPrimary} opacity={0.62 * vis} size={size} />;
}

/** Kapanis: acik zemin ortadan acilir; logo, ad, CTA metni ve alan adi hapi (marka renginde) */
function EndCard({
  frame, pal, tl, brand, label, name, domain, watermark, wide,
}: { frame: number; pal: BrandPalette; tl: TempoTimeline; brand: PromoBaseProps['brand']; label: string; name: Fit; domain: Fit; watermark: boolean; wide: boolean }) {
  const [s] = tl.scene('end');
  if (frame < s - 8) return null;
  const grow = ramp(frame, s - 7, s + 6, Easing.bezier(0.45, 0, 0.15, 1));
  const cx = wide ? 960 : 540;
  const cy = wide ? 540 : 960;
  const tile = tl.snap(frame, s + 1);
  const nm = tl.snap(frame, s + 5);
  const lab = tl.soft(frame, tl.at('end.cta') - 4);
  const cta = tl.snap(frame, tl.at('end.cta'));
  const mark = tl.soft(frame, tl.at('end.url') + 4);
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ background: pal.bg, clipPath: `circle(${grow * 2400}px at ${cx}px ${cy}px)` }} />
      <AbsoluteFill style={{ background: `radial-gradient(${wide ? '1200px 700px' : '900px 900px'} at 50% 0%, ${rgba(pal.primary, 0.16)}, transparent 70%)`, opacity: grow }} />
      <div
        style={{
          position: 'absolute',
          left: wide ? 140 : V.left,
          width: wide ? 1640 : V.width,
          top: wide ? 90 : 300,
          height: wide ? 880 : 1120,
          justifyContent: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          color: pal.ink,
        }}
      >
        <div style={{ transform: `scale(${tile})` }}>
          <LogoTile brand={brand} size={wide ? 180 : 220} pal={pal} />
        </div>
        <FitLines
          fit={name}
          lineHeight={1.05}
          align="center"
          style={{ marginTop: wide ? 40 : 56, fontFamily: fontDisplay, fontWeight: 800, letterSpacing: '-0.035em', opacity: clamp01(nm * 1.5), transform: `translateY(${(1 - nm) * 30}px)` }}
        />
        <div style={{ marginTop: wide ? 48 : 90, fontFamily: fontUI, fontWeight: 700, fontSize: wide ? 42 : 50, color: pal.body, opacity: lab, letterSpacing: '-0.01em' }}>{label}</div>
        <div style={{ marginTop: 30 }}>
          <CtaPill fit={domain} bg={`linear-gradient(150deg, ${pal.primary} 0%, ${pal.primaryDeep} 100%)`} color={pal.onPrimary} scale={cta} />
        </div>
      </div>
      {watermark ? <WatermarkLine top={wide ? 1000 : 1440} color={pal.muted} opacity={0.8 * mark} size={wide ? 22 : 26} /> : null}
    </AbsoluteFill>
  );
}

/* ═════════════ yatay (16:9) ═════════════ */

const H = { left: 140, width: 1640, colW: 960 } as const;
type WFits = { name: Fit; hook: Fit; sub: Fit | null; headName: Fit; cards: CardFit[]; cardH: number; endName: Fit; domain: Fit };

export const SiteIntroWide: React.FC<SiteIntroProps> = (props) => {
  const ready = useBrandFonts();
  const frame = useCurrentFrame();
  const TL = useMemo(() => tempoTimeline('SiteIntroWide', props), [props]);
  const pal = useMemo(() => brandPalette(props.brand.primary), [props.brand.primary]);
  const points = useMemo(() => props.points.slice(0, 3), [props.points]);
  const cardW = (H.width - 2 * 40) / 3;

  const fits = useMemo<WFits | null>(() => {
    if (!ready) return null;
    let name!: Fit;
    let hook!: Fit;
    let sub: Fit | null = null;
    for (let k = 1; k >= 0.6; k -= 0.05) {
      name = fitK(props.brand.name, UI, k, { maxWidth: H.colW - 160, maxLines: 1, maxSize: 54, minSize: 34, weight: 800 });
      hook = fitK(props.hook, DISPLAY, k, { maxWidth: H.colW, maxLines: 3, maxSize: 100, minSize: 58 });
      sub = props.hookSub ? fitK(props.hookSub, UI, k, { maxWidth: H.colW - 40, maxLines: 3, maxSize: 40, minSize: 28, weight: 600 }) : null;
      const h = 120 + 56 + linesH(hook, 1.06) + (sub ? 32 + linesH(sub, 1.3) : 0);
      if (h <= 760) break;
    }
    const textW = cardW - 2 * 44;
    let cards: CardFit[] = [];
    for (let k = 1; k >= 0.6; k -= 0.05) {
      cards = points.map((p) => {
        const title = fitK(p.title, DISPLAY, k, { maxWidth: textW, maxLines: 4, maxSize: 60, minSize: 34 });
        const detail = p.detail ? fitK(p.detail, UI, k, { maxWidth: textW, maxLines: 4, maxSize: 32, minSize: 24, weight: 600 }) : null;
        return { title, detail, h: 80 + 76 + 26 + linesH(title, 1.08) + (detail ? 14 + linesH(detail, 1.3) : 0) };
      });
      if (Math.max(...cards.map((c) => c.h)) <= 640) break;
    }
    return {
      name,
      hook,
      sub,
      cards,
      cardH: Math.max(420, ...cards.map((c) => c.h)),
      headName: fitText(props.brand.name, { ...UI, weight: 800, maxWidth: 900, maxLines: 1, maxSize: 40, minSize: 26 }),
      endName: fitText(props.brand.name, { ...DISPLAY, maxWidth: 1400, maxLines: 2, maxSize: 96, minSize: 56 }),
      domain: fitText(props.cta.domain, { family: fontDisplay, weight: 700, letterSpacing: -0.02, maxWidth: 1000, maxLines: 1, maxSize: 56, minSize: 30 }),
    };
  }, [ready, props.brand.name, props.hook, props.hookSub, props.cta.domain, points, cardW]);

  return (
    <TempoProvider value={TL}>
      <AbsoluteFill style={{ fontFamily: fontUI, color: pal.onPrimary, overflow: 'hidden' }}>
        <TempoSoundtrack tl={TL} muted={props.muted ?? false} />
        <BrandField pal={pal} />
        {fits ? (
          <>
            <WHook frame={frame} pal={pal} fits={fits} brand={props.brand} />
            <WCards frame={frame} pal={pal} fits={fits} brand={props.brand} cardW={cardW} />
            {props.watermark !== false ? <BrandWatermark frame={frame} pal={pal} tl={TL} top={1010} size={22} /> : null}
            <EndCard frame={frame} pal={pal} tl={TL} brand={props.brand} label={props.cta.label} name={fits.endName} domain={fits.domain} watermark={props.watermark !== false} wide />
          </>
        ) : null}
      </AbsoluteFill>
    </TempoProvider>
  );
};

function WHook({ frame, pal, fits, brand }: { frame: number; pal: BrandPalette; fits: WFits; brand: PromoBaseProps['brand'] }) {
  const TL = useTL();
  const [, e] = TL.scene('hook');
  if (frame >= e + 2) return null;
  const out = ramp(frame, e - 10, e - 2, Easing.in(Easing.cubic));
  const logo = TL.snap(frame, TL.at('hook.logo') + 4);
  const name = TL.snap(frame, TL.at('hook.name'));
  const title = TL.snap(frame, TL.at('hook.title'));
  const sub = TL.soft(frame, TL.at('hook.sub'));
  // Sagdaki buyuk logo karosu yavasca suzulur (kare kare deterministik)
  const float = Math.sin(frame / 38) * 12;
  return (
    <AbsoluteFill style={{ opacity: 1 - out, transform: `translateX(${-out * 120}px)` }}>
      <div style={{ position: 'absolute', left: H.left, top: 140, width: H.colW, height: 800, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 28, opacity: clamp01(name * 1.5), transform: `translateY(${(1 - name) * 30}px)` }}>
          <LogoTile brand={brand} size={120} pal={pal} />
          <span style={{ fontFamily: fontUI, fontWeight: 800, fontSize: fits.name.size, whiteSpace: 'nowrap' }}>{fits.name.lines[0]}</span>
        </div>
        <FitLines fit={fits.hook} lineHeight={1.06} style={{ marginTop: 56, fontFamily: fontDisplay, fontWeight: 800, letterSpacing: '-0.035em', opacity: clamp01(title * 1.5), transform: `translateY(${(1 - title) * 50}px)` }} />
        {fits.sub ? <FitLines fit={fits.sub} lineHeight={1.3} style={{ marginTop: 32, fontWeight: 600, opacity: 0.88 * sub, transform: `translateY(${(1 - sub) * 24}px)` }} /> : null}
      </div>
      <div
        style={{
          position: 'absolute',
          left: 1250,
          top: 300 + float,
          opacity: clamp01(logo * 1.6),
          transform: `scale(${0.4 + 0.6 * logo}) rotate(${(1 - logo) * -10 + 4}deg)`,
        }}
      >
        <LogoTile brand={brand} size={460} pal={pal} />
      </div>
    </AbsoluteFill>
  );
}

function WCards({ frame, pal, fits, brand, cardW }: { frame: number; pal: BrandPalette; fits: WFits; brand: PromoBaseProps['brand']; cardW: number }) {
  const TL = useTL();
  const [endS] = TL.scene('end');
  const [p1s] = TL.scene('p1');
  if (frame < p1s - 8 || frame >= endS + 4) return null;
  const head = TL.snap(frame, p1s);
  const out = ramp(frame, endS - 6, endS, Easing.in(Easing.cubic));
  const top = 200 + Math.max(0, (760 - fits.cardH) / 2);
  return (
    <AbsoluteFill style={{ opacity: 1 - out }}>
      <div style={{ position: 'absolute', left: H.left, top: 70, display: 'flex', alignItems: 'center', gap: 22, opacity: clamp01(head * 1.5), transform: `translateY(${(1 - head) * -24}px)` }}>
        <LogoTile brand={brand} size={76} pal={pal} />
        <span style={{ fontFamily: fontUI, fontWeight: 800, fontSize: fits.headName.size, whiteSpace: 'nowrap' }}>{fits.headName.lines[0]}</span>
      </div>
      {fits.cards.map((c, i) => {
        const [s, e] = TL.scene(`p${i + 1}`);
        if (frame < s - 6) return null;
        const inP = TL.snap(frame, s, 30, 5);
        const active = frame < e;
        const dim = active ? 0 : ramp(frame, e, e + 8);
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: H.left + i * (cardW + 40),
              top,
              width: cardW,
              height: fits.cardH,
              opacity: clamp01(inP * 1.5) * (1 - 0.22 * dim),
              transform: `translateY(${(1 - inP) * 120}px) scale(${1 - 0.03 * dim})`,
            }}
          >
            <CardBody pal={pal} index={i} fit={c} active={active} badge={76} pad={44} column />
          </div>
        );
      })}
    </AbsoluteFill>
  );
}
