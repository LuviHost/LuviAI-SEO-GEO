import React, { useMemo, useState } from 'react';
import { AbsoluteFill, Easing, Img, useCurrentFrame } from 'remotion';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { clamp01, fontDisplay, fontMono, fontUI, ramp, useBrandFonts } from '../marketing/kit';
import { timeline } from '../marketing/timeline';
import { TempoProvider, TempoSoundtrack, tempoTimeline, useTL } from '../tempo/TempoTimeline';
import type { Tempo } from '../tempo/plan.mjs';
import { fitText, type Fit, type FitOptions } from './fit';
import { brandPalette, contrast, mix, rgba, type BrandPalette } from './palette';
import { StyledVideo, isStyled } from '../styles/StyledVideo';

/**
 * ArticleShort — bir blog makalesinden OTOMATIK uretilen dikey video (1080×1920 @30); sure tempoya
 * bagli: 'fast' eski sabit 15 sn, 'normal' / 'slow' metinden (src/tempo/plan.mjs, en fazla 60 sn).
 *
 * Props, metin adiminin (scripts/article-short/copy.mjs — bugun cikarimsal, uretimde LLM)
 * urettigi JSON'un aynisidir: hook, points[3], cta, brand. Sablon her metin uzunlugunda ve
 * her marka renginde okunur kalmak zorunda:
 *   - metin kutulari canvas olcumuyle sigdirilir (fit.ts), satir siniri asilmaz
 *   - renkler palette.ts'te kontrasta gore turetilir; renk yoksa RanksUp turuncusu
 * Zamanlama baglamdaki tempo cizelgesinden (useTL — src/tempo/TempoTimeline.tsx; ses ayni izgarada).
 * Guvenli alan SocialAd ile ayni: x 90–950, y 250–1500.
 */

export type ArticlePoint = { title: string; detail?: string };
export type ArticleShortProps = {
  hook: string;
  hookSub?: string;
  kicker?: string;
  points: ArticlePoint[];
  cta: { label: string; domain: string; url?: string };
  brand: { name: string; domain: string; primary?: string; logoUrl?: string };
  /** ekranda kaynak olarak gosterilen yol (alan adi + bolum), or. kobipratik.com/pratik-kobi-rehberi */
  sourcePath?: string;
  muted?: boolean;
  watermark?: boolean;
  /** 'fast' = eski sabit 15 sn; 'normal' / 'slow' = sure metinden (src/tempo/plan.mjs). Yoksa 'fast' */
  tempo?: Tempo;
  /** gorsel stil (src/styles/registry.mjs); yoksa / 'classic' = bu dosyadaki tasarim */
  style?: string;
};

/** 'fast' tempodaki sabit sure (Root.tsx varsayilani; asil sure calculateMetadata'dan, props'a gore) */
export const ARTICLE_SHORT_DURATION = timeline('ArticleShort').durationInFrames;

const SAFE = { left: 90, right: 950, top: 250, bottom: 1500 } as const;
const W = SAFE.right - SAFE.left; // 860
/** kanca ve madde bloklari bu bantta DIKEY ORTALANIR (ust: ilerleme cubugu, alt: filigran) */
const BAND = { top: 450, bottom: 1420 } as const;

const linesH = (f: Fit, lh: number) => f.lines.length * f.size * lh;
function hookHeight(hook: Fit, sub: Fit | null, kicker: boolean) {
  return (kicker ? 58 + 40 : 0) + 12 + 30 + linesH(hook, 1.06 * 1.04) + (sub ? 34 + linesH(sub, 1.25) : 0) + 40 + 34;
}
function pointHeight(title: Fit, detail: Fit | null) {
  return 150 + 34 + linesH(title, 1.08 * 1.04) + (detail ? 48 + 68 + linesH(detail, 1.3) : 0);
}

/**
 * Studio onizlemesi icin ornek. DIKKAT: Remotion inputProps'u bu nesneyle birlestirir; render'da
 * verilmeyen istege bagli alan (or. kicker) buradan gelir. Cagiranlar istege bagli alanlari bos
 * dizeyle acikca gonderir (api videos/video-render.service.ts, scripts/article-short.mjs).
 */
export const articleShortDefaults: ArticleShortProps = {
  hook: 'Diş taşı temizliği ne sıklıkla yapılmalı?',
  kicker: 'Örnek içerik',
  points: [
    { title: 'Örnek madde bir', detail: 'Bu metin varsayılan önizleme içindir.' },
    { title: 'Örnek madde iki', detail: 'Gerçek videoda makalenin kendi cümleleri yer alır.' },
    { title: 'Örnek madde üç' },
  ],
  cta: { label: 'Tamamını oku', domain: 'ornekklinik.com' },
  brand: { name: 'Örnek Klinik', domain: 'ornekklinik.com' },
  sourcePath: 'ornekklinik.com/blog',
  muted: false,
  watermark: true,
  tempo: 'normal',
  style: 'classic',
};

const DISPLAY: Omit<FitOptions, 'maxWidth' | 'maxLines' | 'maxSize' | 'minSize'> = { family: fontDisplay, weight: 800, letterSpacing: -0.035 };
const UI: Omit<FitOptions, 'maxWidth' | 'maxLines' | 'maxSize' | 'minSize'> = { family: fontUI, weight: 650, letterSpacing: -0.01 };

/** Turkce buyuk harf (i -> İ) */
export const upperTr = (s: string) => s.toLocaleUpperCase('tr-TR');

type Fits = {
  hook: Fit;
  hookSub: Fit | null;
  name: Fit;
  points: Array<{ title: Fit; detail: Fit | null }>;
  endName: Fit;
  domain: Fit;
};

/** props.style classic degilse stilli video (src/styles); classic yol asagida, degismedi */
export const ArticleShort: React.FC<ArticleShortProps> = (props) =>
  isStyled(props.style) ? <StyledVideo compositionId="ArticleShort" props={props} /> : <ArticleShortClassic {...props} />;

const ArticleShortClassic: React.FC<ArticleShortProps> = (props) => {
  const ready = useBrandFonts();
  const frame = useCurrentFrame();
  const TL = useMemo(() => tempoTimeline('ArticleShort', props), [props]);
  const pal = useMemo(() => brandPalette(props.brand.primary), [props.brand.primary]);
  const points = useMemo(() => props.points.slice(0, 3), [props.points]);

  // Olcumler fontlar yuklendikten sonra; ready=false iken kare cekilmez (delayRender)
  const fits = useMemo<Fits | null>(() => {
    if (!ready) return null;
    // Yukseklige de sigdir: blok BAND'i asarsa tum boyutlar birlikte kuculur (en uzun metinde bile tasma yok)
    let hook!: Fit;
    let hookSub: Fit | null = null;
    for (let k = 1; k >= 0.6; k -= 0.05) {
      hook = fitText(props.hook, { ...DISPLAY, maxWidth: W, maxLines: 4, maxSize: Math.round(132 * k), minSize: Math.min(72, Math.round(132 * k)) });
      hookSub = props.hookSub ? fitText(props.hookSub, { ...UI, weight: 700, maxWidth: W, maxLines: 3, maxSize: Math.round(56 * k), minSize: Math.min(36, Math.round(56 * k)) }) : null;
      if (hookHeight(hook, hookSub, !!props.kicker) <= BAND.bottom - BAND.top) break;
    }
    const pointFits = points.map((p) => {
      let title!: Fit;
      let detail: Fit | null = null;
      for (let k = 1; k >= 0.6; k -= 0.05) {
        title = fitText(p.title, { ...DISPLAY, maxWidth: W, maxLines: 4, maxSize: Math.round(116 * k), minSize: Math.min(64, Math.round(116 * k)) });
        detail = p.detail ? fitText(p.detail, { ...UI, weight: 600, maxWidth: W - 134 /* kart: 34+40 ic bosluk + 10 serit + 30 aralik + 20 pay */, maxLines: 3, maxSize: Math.round(56 * k), minSize: Math.min(36, Math.round(56 * k)) }) : null;
        if (pointHeight(title, detail) <= BAND.bottom - BAND.top) break;
      }
      return { title, detail };
    });
    return {
      hook,
      hookSub,
      name: fitText(props.brand.name, { ...UI, weight: 800, maxWidth: W - 120, maxLines: 1, maxSize: 44, minSize: 28 }),
      points: pointFits,
      endName: fitText(props.brand.name, { ...DISPLAY, maxWidth: W, maxLines: 2, maxSize: 112, minSize: 64 }),
      domain: fitText(props.cta.domain, { family: fontDisplay, weight: 700, letterSpacing: -0.02, maxWidth: W - 230, maxLines: 1, maxSize: 62, minSize: 34 }),
    };
  }, [ready, props.hook, props.hookSub, props.brand.name, props.cta.domain, points]);

  return (
    <TempoProvider value={TL}>
      <AbsoluteFill style={{ background: pal.bg, fontFamily: fontUI, color: pal.ink, overflow: 'hidden' }}>
        <TempoSoundtrack tl={TL} muted={props.muted ?? false} />
        <Backdrop pal={pal} />
        {fits ? (
          <>
            <Header frame={frame} pal={pal} fit={fits.name} brand={props.brand} />
            <Progress frame={frame} pal={pal} />
            <Hook frame={frame} pal={pal} fits={fits} kicker={props.kicker} sourcePath={props.sourcePath ?? props.cta.domain} />
            {points.map((p, i) => (
              <Point key={i} frame={frame} pal={pal} index={i} fit={fits.points[i]} />
            ))}
            {props.watermark !== false ? <Watermark frame={frame} pal={pal} /> : null}
            <End frame={frame} pal={pal} fits={fits} brand={props.brand} label={props.cta.label} watermark={props.watermark !== false} />
          </>
        ) : null}
      </AbsoluteFill>
    </TempoProvider>
  );
};

/* ───────────── zemin ───────────── */

function Backdrop({ pal }: { pal: BrandPalette }) {
  return (
    <>
      <AbsoluteFill
        style={{
          background: `radial-gradient(900px 760px at 100% -4%, ${rgba(pal.primary, 0.16)}, transparent 70%), radial-gradient(800px 700px at -10% 104%, ${rgba(pal.primary, 0.09)}, transparent 70%)`,
        }}
      />
      <AbsoluteFill
        style={{
          backgroundImage: `linear-gradient(${rgba(pal.ink, 0.035)} 1px, transparent 1px), linear-gradient(90deg, ${rgba(pal.ink, 0.035)} 1px, transparent 1px)`,
          backgroundSize: '54px 54px',
          maskImage: 'radial-gradient(ellipse 80% 70% at 50% 45%, black 25%, transparent 100%)',
        }}
      />
    </>
  );
}

/* ───────────── marka karosu (musteri logosu) ───────────── */

export function LogoTile({ brand, size, pal }: { brand: ArticleShortProps['brand']; size: number; pal: BrandPalette }) {
  const [failed, setFailed] = useState(false);
  const showImg = brand.logoUrl && !failed;
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.27,
        background: '#ffffff',
        border: `1.5px solid ${pal.hair}`,
        boxShadow: `0 ${size * 0.12}px ${size * 0.3}px ${rgba(pal.ink, 0.14)}`,
        display: 'grid',
        placeItems: 'center',
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      {showImg ? (
        // Logo guvenilmeyen veridir: yalniz <img> olarak cizilir (SVG icindeki betikler calismaz)
        <Img src={brand.logoUrl!} maxRetries={0} onError={() => setFailed(true)} style={{ width: '72%', height: '72%', objectFit: 'contain' }} />
      ) : (
        <span style={{ fontFamily: fontDisplay, fontWeight: 800, fontSize: size * 0.5, color: pal.accentText, lineHeight: 1 }}>
          {upperTr(brand.name.trim().charAt(0) || '?')}
        </span>
      )}
    </div>
  );
}

function Header({ frame, pal, fit, brand }: { frame: number; pal: BrandPalette; fit: Fit; brand: ArticleShortProps['brand'] }) {
  const TL = useTL();
  const [endS] = TL.scene('end');
  if (frame >= endS + 6) return null;
  const p = TL.snap(frame, TL.at('hook.brand') + 4);
  const out = ramp(frame, endS - 6, endS, Easing.in(Easing.cubic));
  return (
    <div
      style={{
        position: 'absolute',
        left: SAFE.left,
        top: 262,
        display: 'flex',
        alignItems: 'center',
        gap: 24,
        opacity: clamp01(p * 1.5) * (1 - out),
        transform: `translateY(${(1 - p) * -30}px)`,
      }}
    >
      <LogoTile brand={brand} size={92} pal={pal} />
      <span style={{ fontFamily: fontUI, fontWeight: 800, fontSize: fit.size, letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}>{fit.lines[0]}</span>
    </div>
  );
}

/** Hikaye tarzi 3 bolumlu ilerleme cubugu — her madde kendi bolumunu doldurur */
function Progress({ frame, pal }: { frame: number; pal: BrandPalette }) {
  const TL = useTL();
  const [endS] = TL.scene('end');
  if (frame >= endS + 6) return null;
  const vis = TL.soft(frame, TL.at('hook.title')) * (1 - ramp(frame, endS - 6, endS));
  return (
    <div style={{ position: 'absolute', left: SAFE.left, top: 392, width: W, display: 'flex', gap: 14, opacity: vis }}>
      {(['p1', 'p2', 'p3'] as const).map((id) => {
        const [s, e] = TL.scene(id);
        const fill = ramp(frame, s, e, Easing.linear);
        return (
          <div key={id} style={{ flex: 1, height: 8, borderRadius: 99, background: rgba(pal.ink, 0.1), overflow: 'hidden' }}>
            <div style={{ width: `${fill * 100}%`, height: '100%', background: pal.primaryUi, borderRadius: 99 }} />
          </div>
        );
      })}
    </div>
  );
}

/* ───────────── 0-3 sn: kanca (makale basligi) ───────────── */

function Lines({ fit, frame, at, stagger = 3, lineHeight = 1.06, style }: { fit: Fit; frame: number; at: number; stagger?: number; lineHeight?: number; style?: React.CSSProperties }) {
  const TL = useTL();
  return (
    <div style={{ fontFamily: fontDisplay, fontWeight: 800, fontSize: fit.size, lineHeight, letterSpacing: '-0.035em', ...style }}>
      {fit.lines.map((l, i) => {
        const p = TL.snap(frame, at + i * stagger);
        return (
          <div key={i} style={{ whiteSpace: 'nowrap', opacity: clamp01(p * 1.6), transform: `translateY(${(1 - p) * fit.size * 0.42}px)`, paddingBottom: '0.04em' }}>
            {l}
          </div>
        );
      })}
    </div>
  );
}

function Hook({ frame, pal, fits, kicker, sourcePath }: { frame: number; pal: BrandPalette; fits: Fits; kicker?: string; sourcePath: string }) {
  const TL = useTL();
  const [, e] = TL.scene('hook');
  if (frame >= e + 2) return null;
  const out = ramp(frame, e - 6, e, Easing.in(Easing.cubic));
  const k = TL.snap(frame, TL.at('hook.title') - 6);
  const bar = ramp(frame, TL.at('hook.title') - 4, TL.at('hook.title') + 8);
  const sub = TL.soft(frame, TL.at('hook.sub'));
  const src = TL.soft(frame, TL.at('hook.source'));
  return (
    <div
      style={{
        position: 'absolute',
        left: SAFE.left,
        top: BAND.top,
        height: BAND.bottom - BAND.top,
        width: W,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'flex-start',
        opacity: 1 - out,
        transform: `translateX(${-out * 140}px)`,
      }}
    >
      {kicker ? (
        <span
          style={{
            display: 'inline-block',
            padding: '12px 24px',
            borderRadius: 999,
            background: rgba(pal.primary, 0.12),
            color: pal.accentText,
            fontFamily: fontUI,
            fontWeight: 800,
            fontSize: 28,
            letterSpacing: '0.06em',
            whiteSpace: 'nowrap',
            maxWidth: W,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            opacity: clamp01(k * 1.5),
            transform: `scale(${0.85 + 0.15 * k})`,
            transformOrigin: 'left center',
          }}
        >
          {upperTr(kicker)}
        </span>
      ) : null}
      <div style={{ marginTop: 40, width: 120 * bar, height: 12, borderRadius: 99, background: pal.primaryUi }} />
      <Lines fit={fits.hook} frame={frame} at={TL.at('hook.title')} style={{ marginTop: 30 }} />
      {fits.hookSub ? (
        <div style={{ marginTop: 34, fontFamily: fontUI, fontWeight: 700, fontSize: fits.hookSub.size, lineHeight: 1.25, color: pal.body, opacity: sub, transform: `translateY(${(1 - sub) * 20}px)` }}>
          {fits.hookSub.lines.map((l, i) => (
            <div key={i} style={{ whiteSpace: 'nowrap' }}>
              {l}
            </div>
          ))}
        </div>
      ) : null}
      <div style={{ marginTop: 40, display: 'flex', alignItems: 'center', gap: 10, fontFamily: fontMono, fontSize: 28, fontWeight: 600, color: pal.muted, opacity: src, whiteSpace: 'nowrap', maxWidth: W, overflow: 'hidden' }}>
        <ArrowUpRight size={30} color={pal.accentText} strokeWidth={2.6} />
        {sourcePath}
      </div>
    </div>
  );
}

/* ───────────── 3-12 sn: uc madde ───────────── */

function Point({ frame, pal, index, fit }: { frame: number; pal: BrandPalette; index: number; fit: { title: Fit; detail: Fit | null } }) {
  const TL = useTL();
  const id = `p${index + 1}`;
  const [s, e] = TL.scene(id);
  if (frame < s - 6 || frame >= e + 2) return null;
  const inP = TL.snap(frame, s, 30, 5);
  const out = ramp(frame, e - 6, e, Easing.in(Easing.cubic));
  const num = TL.snap(frame, s + 2);
  const det = TL.snap(frame, TL.at(`${id}.detail`));
  return (
    <div
      style={{
        position: 'absolute',
        left: SAFE.left,
        top: BAND.top,
        height: BAND.bottom - BAND.top,
        width: W,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'flex-start',
        opacity: 1 - out,
        transform: `translateX(${(1 - inP) * 140 - out * 140}px)`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, opacity: clamp01(num * 1.5), transform: `scale(${1.15 - 0.15 * num})`, transformOrigin: 'left bottom' }}>
        <span style={{ fontFamily: fontDisplay, fontWeight: 800, fontSize: 150, lineHeight: 1, letterSpacing: '-0.05em', color: pal.accentText }}>{String(index + 1).padStart(2, '0')}</span>
        <span style={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: 44, color: pal.muted, letterSpacing: '-0.02em' }}>/03</span>
      </div>
      <Lines fit={fit.title} frame={frame} at={TL.at(`${id}.title`)} stagger={2} lineHeight={1.08} style={{ marginTop: 34 }} />
      {fit.detail ? (
        <div
          style={{
            marginTop: 48,
            width: W,
            boxSizing: 'border-box',
            display: 'flex',
            gap: 30,
            padding: '34px 40px 34px 34px',
            borderRadius: 36,
            background: pal.paper,
            border: `1.5px solid ${pal.hair}`,
            boxShadow: `0 26px 60px ${rgba(pal.ink, 0.08)}`,
            opacity: clamp01(det * 1.5),
            transform: `translateY(${(1 - det) * 40}px)`,
          }}
        >
          <div style={{ width: 10, borderRadius: 99, background: pal.primaryUi, flexShrink: 0 }} />
          <div style={{ fontFamily: fontUI, fontWeight: 600, fontSize: fit.detail.size, lineHeight: 1.3, color: pal.ink }}>
            {fit.detail.lines.map((l, i) => (
              <div key={i} style={{ whiteSpace: 'nowrap' }}>
                {l}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ───────────── kucuk filigran ───────────── */

function Watermark({ frame, pal }: { frame: number; pal: BrandPalette }) {
  const TL = useTL();
  const [endS] = TL.scene('end');
  if (frame >= endS + 2) return null;
  const vis = TL.soft(frame, 8) * (1 - ramp(frame, endS - 6, endS));
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, top: 1452, textAlign: 'center', fontFamily: fontUI, fontWeight: 600, fontSize: 24, color: pal.muted, opacity: 0.75 * vis, letterSpacing: '0.01em' }}>
      ranksup.ai ile üretildi
    </div>
  );
}

/* ───────────── 12-15 sn: kapanis (marka + CTA) ───────────── */

function End({ frame, pal, fits, brand, label, watermark }: { frame: number; pal: BrandPalette; fits: Fits; brand: ArticleShortProps['brand']; label: string; watermark: boolean }) {
  const TL = useTL();
  const [s] = TL.scene('end');
  if (frame < s - 8) return null;
  // alttan buyuyen marka renkli daire; vurus karesinde ekranin cogu kapali
  const grow = ramp(frame, s - 7, s + 5, Easing.bezier(0.45, 0, 0.15, 1));
  const r = grow * 2300;
  const tile = TL.snap(frame, s + 1);
  const name = TL.snap(frame, s + 5);
  const lab = TL.soft(frame, TL.at('end.cta') - 4);
  const cta = TL.snap(frame, TL.at('end.cta'));
  const mark = TL.soft(frame, TL.at('end.url') + 4);
  const onWhitePill = pal.onPrimary === '#ffffff';
  const pillBg = onWhitePill ? '#ffffff' : pal.ink;
  let pillText = pal.primary;
  for (let i = 0; i < 14 && contrast(pillText, pillBg) < 4.5; i++) pillText = onWhitePill ? mix(pillText, '#000000', 0.1) : mix(pillText, '#ffffff', 0.15);
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ background: `linear-gradient(160deg, ${pal.primary} 0%, ${pal.primaryDeep} 100%)`, clipPath: `circle(${r}px at 540px 1920px)` }} />
      <div style={{ position: 'absolute', left: SAFE.left, width: W, top: 380, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
        <div style={{ transform: `scale(${tile})` }}>
          <LogoTile brand={brand} size={220} pal={pal} />
        </div>
        <div style={{ marginTop: 56, color: pal.onPrimary, opacity: clamp01(name * 1.5), transform: `translateY(${(1 - name) * 30}px)` }}>
          <div style={{ fontFamily: fontDisplay, fontWeight: 800, fontSize: fits.endName.size, lineHeight: 1.05, letterSpacing: '-0.035em' }}>
            {fits.endName.lines.map((l, i) => (
              <div key={i} style={{ whiteSpace: 'nowrap' }}>
                {l}
              </div>
            ))}
          </div>
        </div>
        <div style={{ marginTop: 90, fontFamily: fontUI, fontWeight: 700, fontSize: 50, color: pal.onPrimary, opacity: 0.9 * lab, letterSpacing: '-0.01em' }}>{label}</div>
        <div
          style={{
            marginTop: 30,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 22,
            padding: '30px 50px',
            borderRadius: 999,
            background: pillBg,
            color: pillText,
            fontFamily: fontDisplay,
            fontWeight: 700,
            fontSize: fits.domain.size,
            letterSpacing: '-0.02em',
            whiteSpace: 'nowrap',
            boxShadow: `0 30px 70px ${rgba('#000000', 0.22)}`,
            opacity: clamp01(cta * 1.5),
            transform: `scale(${0.7 + 0.3 * cta})`,
          }}
        >
          {fits.domain.lines[0]}
          <ArrowRight size={fits.domain.size * 0.95} strokeWidth={2.8} />
        </div>
      </div>
      {watermark ? (
        <div style={{ position: 'absolute', left: 0, right: 0, top: 1440, textAlign: 'center', fontFamily: fontUI, fontWeight: 600, fontSize: 26, color: pal.onPrimary, opacity: 0.62 * mark }}>
          ranksup.ai ile üretildi
        </div>
      ) : null}
    </AbsoluteFill>
  );
}
