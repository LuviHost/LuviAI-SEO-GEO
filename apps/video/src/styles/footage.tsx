import React, { useMemo } from 'react';
import { AbsoluteFill, Loop, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from 'remotion';
import { ArrowUpRight, Check } from 'lucide-react';
import { clamp01, fontMono, ramp } from '../marketing/kit';
import { fitText, type Fit } from '../article-short/fit';
import { mix, rgba, type BrandPalette } from '../article-short/palette';
import { LogoTile, upperTr } from '../article-short/ArticleShort';
import { WatermarkLine } from '../promo/shared';
import type { KitProps } from './StyledVideo';
import type { Story, Win } from './story';
import { fontJakarta, fontSora } from './fonts';
import { EASE, V_BOTTOM, V_WM, Lines, ProductImage, brandGrad, fitK, linesH, type FitBase } from './kit';
import { STOCK_DIR } from './registry.mjs';
import { footageScenes } from './footage-plan.mjs';

/**
 * GERCEK GORUNTU — MoviePy (19-moviepy/make_video.py) ve ffmpeg (18-ffmpeg/build.sh) denemelerinin teknigi
 * Remotion'da (sunucuda MoviePy / Python yok):
 *   - zemin gercek stok goruntu (Mixkit, notr eller / omuz ustu — src/styles/registry.mjs STOCK_CLIPS);
 *     her sahnede yavas yakinlasma (Ken Burns), sicak / yumusak renk (doygunluk 0,9, siyahlar hafif
 *     kaldirilmis), sahne kesmelerinde yarim vurusluk capraz gecis
 *   - buzlu cam metin panelleri ve kartlar (alttaki goruntu bulaniklasir: backdrop-filter), yumusak
 *     yukari kayarak gelir
 *   - kapanis sicak kirik beyaz zemin + marka renginde yumusak isik, logo "pop", alan adi hapi
 * Ekrandaki metin goruntudeki kisinin sozu / yorumu gibi DURMAZ: konusma balonu yok, metin markanin kendi
 * cam panelinde. Klipler yoksa render baslamadan durur (render/article-short.mjs assertStyleAssets).
 */

const INK = '#1c1917';
const F_HEAD: FitBase = { family: fontSora, weight: 700, letterSpacing: -0.03 };
const F_BODY: FitBase = { family: fontJakarta, weight: 600, letterSpacing: -0.01 };
const GRADE = 'saturate(0.9) contrast(1.03) brightness(1.04) sepia(0.1)';

type Geo = { W: number; H: number; x: number; w: number; wmTop: number; wmSize: number };
const TALL: Geo = { W: 1080, H: 1920, x: 64, w: 952, wmTop: V_WM, wmSize: 24 };
const WIDE: Geo = { W: 1920, H: 1080, x: 120, w: 1680, wmTop: 1016, wmSize: 22 };

type Row = { title: Fit; detail: Fit | null; h: number };
type Fits = {
  kicker: string;
  head: Fit;
  name: Fit | null;
  sub: Fit | null;
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

function computeFits(story: Story): Fits {
  const wide = story.wide;
  const panelW = story.kind === 'product' ? (wide ? 900 : 952) : wide ? 1100 : 952;
  const textW = panelW - 96;
  let head!: Fit;
  let sub: Fit | null = null;
  let name: Fit | null = null;
  let img = 0;
  for (let k = 1; k >= 0.5; k -= 0.05) {
    head = fitK(story.hook, F_HEAD, k, { maxWidth: textW, maxLines: story.kind === 'product' ? 4 : wide ? 3 : 5, maxSize: wide ? 88 : 92, minSize: 56 });
    sub = story.hookSub ? fitK(story.hookSub, F_BODY, Math.max(0.85, k), { maxWidth: textW, maxLines: 3, maxSize: wide ? 38 : 44, minSize: wide ? 28 : 38 }) : null;
    if (story.kind === 'site') name = fitK(story.brand.name, { ...F_HEAD, weight: 800 }, Math.max(0.8, k), { maxWidth: textW - 140, maxLines: 2, maxSize: wide ? 48 : 52, minSize: 32 });
    const h = 88 + (story.kicker ? 64 : 0) + (name ? Math.max(110, linesH(name, 1.1)) + 30 : 0) + linesH(head, 1.08) + (sub ? 28 + linesH(sub, 1.3) : 0);
    if (story.kind === 'product') {
      if (wide) {
        img = 640;
        if (h <= 760) break;
      } else {
        img = Math.round(Math.min(640, V_BOTTOM - 280 - 50 - h));
        if (img >= 380) break;
        img = Math.max(360, img);
      }
    } else if (h <= (wide ? 760 : 900)) break;
  }
  const points = story.kind === 'article'
    ? story.points.map((p) => {
      let title!: Fit;
      let detail: Fit | null = null;
      for (let k = 1; k >= 0.5; k -= 0.05) {
        title = fitK(p.title, F_HEAD, k, { maxWidth: 952 - 96, maxLines: 4, maxSize: 84, minSize: 54 });
        detail = p.detail ? fitK(p.detail, F_BODY, Math.max(0.85, k), { maxWidth: 952 - 96, maxLines: 4, maxSize: 44, minSize: 36 }) : null;
        if (190 + linesH(title, 1.08) + (detail ? 30 + linesH(detail, 1.32) : 0) <= 900) break;
      }
      return { title, detail };
    })
    : [];
  let rows: Row[] = [];
  if (story.list) {
    const wideSite = wide && story.kind === 'site';
    // satir ic genisligi: cam kart dolgusu, rozet 52 + bosluk 22
    const textW2 = wideSite ? 520 - 68 - 74 - 4 : (story.kind === 'product' ? (wide ? 900 : 952) : 952) - 48 - 48 - 74 - 4;
    const avail = wideSite ? 560 : story.kind === 'product' ? (wide ? 700 : V_BOTTOM - 800 - 60) : 1100;
    for (let k = 1; k >= 0.5; k -= 0.05) {
      rows = story.points.map((p) => {
        const title = fitK(p.title, F_HEAD, k, { maxWidth: textW2, maxLines: 3, maxSize: wideSite ? 48 : 52, minSize: 30 });
        const detail = p.detail ? fitK(p.detail, F_BODY, k, { maxWidth: textW2, maxLines: wideSite ? 4 : 3, maxSize: 34, minSize: 24 }) : null;
        return { title, detail, h: Math.round(52 + linesH(title, 1.1) + (detail ? 10 + linesH(detail, 1.3) : 0)) };
      });
      const total = wideSite ? Math.max(...rows.map((r) => r.h)) : rows.reduce((a, r) => a + r.h, 0) + 20 * (rows.length - 1) + 64;
      if (total <= avail) break;
    }
  }
  const endW = wide ? (story.kind === 'product' ? 820 : 1400) : 900;
  return {
    kicker: story.kicker ? upperTr(story.kicker) : '',
    head,
    name,
    sub,
    source: story.source ? fitText(story.source, { family: fontJakarta, weight: 700, letterSpacing: 0, maxWidth: 700, maxLines: 1, maxSize: 30, minSize: 20 }) : null,
    header: fitText(story.header || story.brand.name, { family: fontJakarta, weight: 800, letterSpacing: -0.01, maxWidth: story.kind === 'product' ? 740 : 700, maxLines: 1, maxSize: 36, minSize: 20 }),
    points,
    rows,
    endName: fitText(story.endName, { family: fontSora, weight: 800, letterSpacing: -0.03, maxWidth: endW, maxLines: 2, maxSize: wide ? 100 : 108, minSize: 56 }),
    label: fitText(story.cta.label, { ...F_BODY, weight: 700, maxWidth: endW, maxLines: 1, maxSize: wide ? 42 : 48, minSize: 26 }),
    domain: fitText(story.cta.domain, { family: fontSora, weight: 700, letterSpacing: -0.02, maxWidth: wide && story.kind === 'product' ? 540 : 640, maxLines: 1, maxSize: 56, minSize: 24 }),
    price: story.price ? fitText(story.price, { family: fontSora, weight: 800, letterSpacing: -0.02, maxWidth: 380, maxLines: 1, maxSize: 56, minSize: 30 }) : null,
    img,
  };
}

export function FootageStyle({ story, pal, win, frame }: KitProps) {
  const G = story.wide ? WIDE : TALL;
  const fits = useMemo(() => computeFits(story), [story]);
  return (
    <AbsoluteFill style={{ background: '#2a2522', color: INK, fontFamily: fontJakarta }}>
      <Footage story={story} win={win} G={G} />
      {/* sicak ton + okunurluk icin hafif koyulasma (alt ve ust kenar) */}
      <AbsoluteFill style={{ background: `linear-gradient(180deg, ${rgba('#1c1410', 0.28)} 0%, ${rgba('#1c1410', 0.06)} 32%, ${rgba('#1c1410', 0.08)} 64%, ${rgba('#1c1410', 0.34)} 100%)` }} />
      <AbsoluteFill style={{ background: rgba(pal.primary, 0.06), mixBlendMode: 'soft-light' }} />
      {story.kind === 'product' ? <ProductCard story={story} pal={pal} win={win} frame={frame} fits={fits} G={G} /> : null}
      <Hook story={story} pal={pal} win={win} frame={frame} fits={fits} G={G} />
      {story.list ? <List story={story} pal={pal} win={win} frame={frame} fits={fits} G={G} /> : <Points story={story} pal={pal} win={win} frame={frame} fits={fits} G={G} />}
      <Header story={story} pal={pal} win={win} frame={frame} fits={fits} G={G} />
      {story.watermark && frame < win.endS + 2 ? <WatermarkLine top={G.wmTop} color="#ffffff" opacity={0.8 * win.wm(frame)} size={G.wmSize} /> : null}
      <End story={story} pal={pal} win={win} frame={frame} fits={fits} G={G} />
    </AbsoluteFill>
  );
}

type P = { story: Story; pal: BrandPalette; win: Win; frame: number; fits: Fits; G: Geo };

/* ───────────── stok goruntu: sahne basina klip, yavas yakinlasma, capraz gecis ───────────── */

/** Sahne basina klip ve oynatma: footage-plan.mjs (yuzsuz araliklar, izinli bicimler; api testi denetler) */
function Footage({ story, win, G }: { story: Story; win: Win; G: Geo }) {
  const scenes = useMemo(
    () => footageScenes({ cuts: [0, win.scene(0)[0], win.scene(1)[0], win.scene(2)[0], win.endS], fpb: win.fpb, wide: story.wide }),
    [win, story.wide],
  );
  return (
    <>
      {scenes.map((sc, i) => {
        const video = (
          <OffthreadVideo
            src={staticFile(`${STOCK_DIR}/${sc.clip.file}`)}
            muted
            trimBefore={sc.trimBefore}
            playbackRate={sc.rate}
            style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: `${(story.wide ? 0.5 : sc.clip.focus) * 100}% 50%`, filter: GRADE }}
          />
        );
        return (
          <Sequence key={i} from={sc.from} durationInFrames={sc.dur} layout="none">
            <SceneLayer dur={sc.dur} fade={sc.fade} G={G}>
              {sc.loopFrames ? <Loop durationInFrames={sc.loopFrames} layout="none">{video}</Loop> : video}
            </SceneLayer>
          </Sequence>
        );
      })}
    </>
  );
}

/** Sequence icinde (yerel kare): yavas yakinlasma + giriste capraz gecis */
function SceneLayer({ dur, fade, G, children }: { dur: number; fade: number; G: Geo; children: React.ReactNode }) {
  const f = useCurrentFrame();
  const z = 1 + 0.06 * clamp01(f / Math.max(1, dur));
  const op = fade ? ramp(f, 0, fade, (t) => t) : 1;
  return (
    <AbsoluteFill style={{ opacity: op, overflow: 'hidden' }}>
      <AbsoluteFill style={{ transform: `scale(${z})`, transformOrigin: G.W > G.H ? '50% 50%' : '50% 45%' }}>{children}</AbsoluteFill>
    </AbsoluteFill>
  );
}

/* ───────────── cam panel ───────────── */

function Glass({ style, children, strong = false }: { style?: React.CSSProperties; children?: React.ReactNode; strong?: boolean }) {
  return (
    <div
      style={{
        position: 'relative',
        borderRadius: 40,
        background: rgba('#ffffff', strong ? 0.9 : 0.82),
        backdropFilter: 'blur(22px) saturate(1.25)',
        WebkitBackdropFilter: 'blur(22px) saturate(1.25)',
        border: `1.5px solid ${rgba('#ffffff', 0.7)}`,
        boxShadow: `0 24px 60px ${rgba('#000000', 0.22)}, inset 0 2px 0 ${rgba('#ffffff', 0.85)}`,
        boxSizing: 'border-box',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

const slideUp = (p: number, d = 60): React.CSSProperties => ({ opacity: clamp01(p * 1.6), transform: `translateY(${(1 - EASE.out(clamp01(p))) * d}px)` });

/* ───────────── kanca ───────────── */

function Hook({ story, pal, win, frame, fits, G }: P) {
  if (frame >= win.hookE + 2) return null;
  const out = win.hookOut(frame);
  const tP = win.titleIn(frame);
  const sub = win.subIn(frame);
  const kick = win.kickerIn(frame);
  const src = win.sourceIn(frame);
  const panelP = Math.max(tP, story.kind === 'site' ? win.nameIn(frame) : 0, kick);
  const product = story.kind === 'product';
  const panelW = product ? (story.wide ? 900 : 952) : story.wide ? 1100 : 952;
  const box: React.CSSProperties = product
    ? story.wide ? { left: 880, top: 160, width: panelW, height: 760 } : { left: G.x, top: 280 + fits.img + 50, width: panelW, height: V_BOTTOM - (280 + fits.img + 50) }
    : story.wide ? { left: G.x, top: 140, width: panelW, height: 800 } : { left: G.x, top: 480, width: panelW, height: V_BOTTOM - 480 };
  return (
    <div style={{ position: 'absolute', ...box, display: 'flex', flexDirection: 'column', justifyContent: product || story.wide ? 'center' : 'flex-end', opacity: 1 - out, transform: `translateY(${out * 40}px)` }}>
      <Glass style={{ padding: '44px 48px', ...slideUp(panelP) }}>
        {fits.kicker ? (
          <div style={{ display: 'inline-block', padding: '10px 22px', borderRadius: 99, background: rgba(pal.primary, 0.14), color: pal.accentText, fontWeight: 800, fontSize: 26, letterSpacing: '0.06em', marginBottom: 24, opacity: clamp01(kick * 1.6), whiteSpace: 'nowrap', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}>{fits.kicker}</div>
        ) : null}
        {story.kind === 'site' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 24, marginBottom: 30, opacity: clamp01(win.nameIn(frame) * 1.5) }}>
            <div style={{ transform: `scale(${0.6 + 0.4 * clamp01(win.logoIn(frame))})` }}>
              <LogoTile brand={story.brand} size={110} pal={pal} />
            </div>
            <Lines fit={fits.name!} lineHeight={1.1} style={{ fontFamily: fontSora, fontWeight: 800, letterSpacing: '-0.03em' }} />
          </div>
        ) : null}
        <Lines fit={fits.head} lineHeight={1.08} style={{ fontFamily: fontSora, fontWeight: 700, letterSpacing: '-0.03em', color: INK, ...slideUp(tP, 30) }} />
        {fits.sub ? <Lines fit={fits.sub} lineHeight={1.3} style={{ marginTop: 28, fontWeight: 600, color: '#44403c', opacity: sub }} /> : null}
      </Glass>
      {fits.source ? (
        <Glass style={{ marginTop: 22, alignSelf: 'flex-start', padding: '16px 26px', borderRadius: 24, display: 'flex', alignItems: 'center', gap: 12, ...slideUp(src, 20) }}>
          <ArrowUpRight size={28} color={pal.accentText} strokeWidth={2.6} />
          <Lines fit={fits.source} lineHeight={1.2} style={{ fontFamily: fontMono, fontWeight: 600, color: '#57534e' }} />
        </Glass>
      ) : null}
    </div>
  );
}

/* ───────────── makale maddeleri ───────────── */

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
        return (
          <div key={i} style={{ position: 'absolute', left: G.x, top: 480, width: 952, height: V_BOTTOM - 480, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', opacity: 1 - out, transform: `translateY(${out * 40}px)` }}>
            <Glass style={{ padding: '44px 48px', ...slideUp(inP) }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 26 }}>
                <div style={{ width: 64, height: 64, borderRadius: 99, display: 'grid', placeItems: 'center', background: brandGrad(pal), color: pal.onPrimary, fontFamily: fontSora, fontWeight: 800, fontSize: 28 }}>{i + 1}</div>
                <div style={{ fontFamily: fontSora, fontWeight: 700, fontSize: 28, color: '#78716c' }}>/ {fits.points.length}</div>
              </div>
              <Lines fit={fp.title} lineHeight={1.08} style={{ fontFamily: fontSora, fontWeight: 700, letterSpacing: '-0.03em', ...slideUp(tP, 24) }} />
              {fp.detail ? <Lines fit={fp.detail} lineHeight={1.32} style={{ marginTop: 26, fontWeight: 600, color: '#44403c', opacity: clamp01(dP * 1.6) }} /> : null}
            </Glass>
          </div>
        );
      })}
    </>
  );
}

/* ───────────── liste: cam kart icinde birikir ───────────── */

function List({ story, pal, win, frame, fits, G }: P) {
  const [p1s] = win.scene(0);
  if (frame < p1s - 8 || frame >= win.endS + 2) return null;
  const out = win.pointOut(0, frame);
  const wideSite = story.wide && story.kind === 'site';
  const product = story.kind === 'product';
  const panelX = product ? (story.wide ? 880 : G.x) : G.x;
  const panelW = product ? (story.wide ? 900 : 952) : 952;
  const items = fits.rows.map((r, i) => ({ r, i, p: win.pointIn(i, frame), det: win.detailIn(i, frame), active: frame < win.scene(i)[1] }));
  if (wideSite) {
    const cardW = 520;
    const x0 = (G.W - (3 * cardW + 2 * 40)) / 2;
    const h = Math.max(...fits.rows.map((r) => r.h)) + 40;
    return (
      <div style={{ position: 'absolute', inset: 0, opacity: 1 - out }}>
        {items.map(({ r, i, p, det, active }) => (p > 0.001 ? (
          <Glass key={i} style={{ position: 'absolute', left: x0 + i * (cardW + 40), top: 1080 - 150 - h, width: cardW, height: h, padding: '30px 34px', ...slideUp(p) }}>
            <RowBody r={r} i={i} det={det} active={active} pal={pal} />
          </Glass>
        ) : null))}
      </div>
    );
  }
  const total = fits.rows.reduce((a, r) => a + r.h, 0) + 20 * (fits.rows.length - 1) + 64;
  const shown = items.reduce((a, x) => a + (x.r.h + 20) * clamp01(x.p), 0);
  const bottom = product ? (story.wide ? 920 : V_BOTTOM) : V_BOTTOM;
  const panelH = 64 - 20 + shown;
  let y = 32;
  return (
    <div style={{ position: 'absolute', left: panelX, top: bottom - Math.min(total, panelH), width: panelW, opacity: 1 - out }}>
      <Glass style={{ position: 'absolute', left: 0, top: 0, width: panelW, height: Math.max(0, panelH), opacity: clamp01(items[0].p * 2) }} />
      {items.map(({ r, i, p, det, active }) => {
        const top = y;
        y += (r.h + 20) * clamp01(p);
        if (p <= 0.001) return null;
        return (
          <div key={i} style={{ position: 'absolute', left: 24, top, width: panelW - 48, height: r.h, padding: '26px 24px', boxSizing: 'border-box', borderRadius: 28, background: active ? rgba('#ffffff', 0.95) : rgba('#ffffff', 0.55), border: active ? `3px solid ${pal.primaryUi}` : `1.5px solid ${rgba('#ffffff', 0.6)}`, ...slideUp(p, 30) }}>
            <RowBody r={r} i={i} det={det} active={active} pal={pal} />
          </div>
        );
      })}
    </div>
  );
}

function RowBody({ r, i, det, active, pal }: { r: Row; i: number; det: number; active: boolean; pal: BrandPalette }) {
  return (
    <div style={{ display: 'flex', gap: 22, alignItems: 'flex-start' }}>
      <div style={{ width: 52, height: 52, flexShrink: 0, borderRadius: 99, display: 'grid', placeItems: 'center', background: active ? brandGrad(pal) : rgba(INK, 0.1), color: active ? pal.onPrimary : '#57534e', fontFamily: fontSora, fontWeight: 800, fontSize: 24 }}>
        {active ? <Check size={28} strokeWidth={3.2} /> : i + 1}
      </div>
      <div style={{ minWidth: 0 }}>
        <Lines fit={r.title} lineHeight={1.1} style={{ fontFamily: fontSora, fontWeight: 700, letterSpacing: '-0.025em', color: INK }} />
        {r.detail ? <Lines fit={r.detail} lineHeight={1.3} style={{ marginTop: 10, fontWeight: 600, color: '#44403c', opacity: clamp01(det * 1.5) }} /> : null}
      </div>
    </div>
  );
}

/* ───────────── urun karti (tum video) ───────────── */

function ProductCard({ story, pal, win, frame, fits }: P) {
  const inP = win.logoIn(frame);
  const shrink = ramp(frame, win.hookE - 8, win.hookE + 4, EASE.smooth);
  const endP = ramp(frame, win.endS - 6, win.endS + 8, EASE.smooth);
  let x: number;
  let y: number;
  let size: number;
  if (story.wide) {
    size = 640;
    x = 140;
    y = 220;
  } else {
    size = fits.img + (500 - fits.img) * shrink;
    x = (1080 - size) / 2;
    y = 260 + 40 * endP;
  }
  const priceP = win.priceIn(frame);
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: size, height: size, zIndex: 2, ...slideUp(inP, 50) }}>
      <div style={{ position: 'absolute', inset: 0, borderRadius: size * 0.08, overflow: 'hidden', background: story.image ? '#ffffff' : pal.primary, boxShadow: `0 30px 70px ${rgba('#000000', 0.35)}` }}>
        <ProductImage src={story.image} frame={frame} total={win.total} fallback={<LogoTile brand={story.brand} size={size * 0.4} pal={pal} />} />
      </div>
      {story.image ? (
        <div style={{ position: 'absolute', left: -size * 0.05, bottom: -size * 0.05 }}>
          <LogoTile brand={story.brand} size={Math.round(size * 0.2)} pal={pal} />
        </div>
      ) : null}
      {story.price && fits.price ? (
        <div style={{ position: 'absolute', right: -size * 0.05, top: size * 0.06, padding: '12px 28px', borderRadius: 99, background: brandGrad(pal), color: pal.onPrimary, boxShadow: `0 16px 40px ${rgba('#000000', 0.3)}, 0 0 0 5px #ffffff`, opacity: clamp01(priceP * 1.6), transform: `scale(${0.6 + 0.4 * clamp01(priceP)})` }}>
          <Lines fit={fits.price} lineHeight={1.15} style={{ fontFamily: fontSora, fontWeight: 800 }} />
        </div>
      ) : null}
    </div>
  );
}

/* ───────────── ust satir (cam cip) ───────────── */

function Header({ story, pal, win, frame, fits, G }: P) {
  if (!story.header || frame >= win.endS + 2) return null;
  const p = win.headerIn(frame);
  if (p <= 0.001) return null;
  const out = win.headerOut(frame);
  const product = story.kind === 'product';
  return (
    <Glass style={{ position: 'absolute', left: product ? 880 : G.x, top: story.wide ? 50 : 250, display: 'flex', alignItems: 'center', gap: 16, padding: '12px 26px 12px 12px', borderRadius: 99, opacity: clamp01(p * 1.5) * (1 - out) }}>
      {!product ? <LogoTile brand={story.brand} size={story.wide ? 56 : 64} pal={pal} /> : <div style={{ width: 8 }} />}
      <span style={{ fontWeight: 800, fontSize: fits.header.size, whiteSpace: 'nowrap', color: INK }}>{fits.header.lines[0]}</span>
    </Glass>
  );
}

/* ───────────── kapanis: sicak kirik beyaz + marka isigi ───────────── */

function End({ story, pal, win, frame, fits, G }: P) {
  const s = win.endS;
  if (frame < s - 6) return null;
  const product = story.kind === 'product';
  const bg = ramp(frame, s - 6, s + 4, (t) => t);
  const t = win.endTileIn(frame);
  const back = (x: number) => {
    const c1 = 1.70158;
    const q = clamp01(x) - 1;
    return 1 + (c1 + 1) * q * q * q + c1 * q * q;
  };
  const nm = win.endNameIn(frame);
  const lab = win.labelIn(frame);
  const cta = win.ctaIn(frame);
  const mark = win.markIn(frame);
  const warm = mix('#faf8f5', pal.primary, 0.03);
  const box: React.CSSProperties = product
    ? story.wide ? { left: 880, width: 900, top: 300, alignItems: 'flex-start', textAlign: 'left' } : { left: G.x, width: G.w, top: 900, alignItems: 'center', textAlign: 'center' }
    : story.wide ? { left: 160, width: 1600, top: 460, alignItems: 'center', textAlign: 'center' } : { left: G.x, width: G.w, top: 900, alignItems: 'center', textAlign: 'center' };
  const align = box.textAlign as 'left' | 'center';
  return (
    <AbsoluteFill style={{ zIndex: 1 }}>
      <AbsoluteFill style={{ background: warm, opacity: bg }} />
      <AbsoluteFill style={{ background: `radial-gradient(${story.wide ? '900px 600px' : '700px 700px'} at 50% ${story.wide ? '30%' : '36%'}, ${rgba(pal.primary, 0.16)}, transparent 70%)`, opacity: bg }} />
      {!product ? (
        <div style={{ position: 'absolute', left: (G.W - 240) / 2, top: story.wide ? 160 : 600, transform: `scale(${Math.max(0.02, back(t))})`, filter: `drop-shadow(0 24px 40px ${rgba(pal.primaryDeep, 0.3)})` }}>
          <LogoTile brand={story.brand} size={240} pal={pal} />
        </div>
      ) : null}
      <div style={{ position: 'absolute', display: 'flex', flexDirection: 'column', ...box }}>
        <Lines fit={fits.endName} lineHeight={1.05} align={align} style={{ fontFamily: fontSora, fontWeight: 800, letterSpacing: '-0.03em', color: INK, ...slideUp(nm, 40) }} />
        <div style={{ marginTop: story.wide ? 34 : 54, opacity: lab }}>
          <Lines fit={fits.label} lineHeight={1.2} align={align} style={{ fontWeight: 700, color: '#78716c' }} />
        </div>
        <div style={{ marginTop: 24, display: 'inline-flex', alignItems: 'center', gap: 14, padding: `${fits.domain.size * 0.45}px ${fits.domain.size * 0.8}px`, borderRadius: 99, background: brandGrad(pal, 90), color: pal.onPrimary, fontFamily: fontSora, fontWeight: 700, fontSize: fits.domain.size, whiteSpace: 'nowrap', boxShadow: `0 20px 44px ${rgba(pal.primaryDeep, 0.3)}`, ...slideUp(cta, 40) }}>
          {fits.domain.lines[0]}
          <ArrowUpRight size={fits.domain.size * 0.9} strokeWidth={2.8} />
        </div>
      </div>
      {story.watermark ? <WatermarkLine top={G.wmTop - (story.wide ? 0 : 22)} color="#78716c" opacity={0.85 * mark} size={story.wide ? 22 : 26} /> : null}
    </AbsoluteFill>
  );
}
