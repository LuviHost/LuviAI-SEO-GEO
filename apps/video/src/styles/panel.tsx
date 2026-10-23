import React, { useMemo } from 'react';
import { AbsoluteFill, interpolate } from 'remotion';
import { ArrowUpRight, Check } from 'lucide-react';
import { clamp01, fontMono, ramp } from '../marketing/kit';
import { fitText, type Fit } from '../article-short/fit';
import { mix, rgba, type BrandPalette } from '../article-short/palette';
import { LogoTile, upperTr } from '../article-short/ArticleShort';
import { WatermarkLine } from '../promo/shared';
import type { KitProps } from './StyledVideo';
import type { Story, Win } from './story';
import { fontJakarta, fontSora } from './fonts';
import { EASE, KineticText, Lines, ProductImage, SpeedBlur, brandGrad, fitK, linesH, pulse, softShadow, splitLast, velocity, type FitBase } from './kit';

/**
 * PANEL — acik Apple-yumusak arayuz dili (deneme 17-remotion 8,5/10 + video-shotcraft Film.tsx +
 * remotion-skills kurallari; kaynaklar src/styles/CREDITS.md).
 *   - zemin: acik alan, marka renginde iki yumusak isik lekesi; yarim olcude bir nabiz
 *   - yazi buyuk: baslik >= 84 px, destek >= 44 px (1080 genislikte); kelimeler bulaniklikten yukari yayla
 *     cikar; son kelime (Turkcede cogunlukla yuklem) vurusta marka renginde alti cizilir
 *   - beyaz arayuz kartlari (yuzey + iki katli yumusak golge); liste satirlari panele gomulur, panel
 *     satir eklendikce dolar (progressive fill); etkin satir marka cerceveli + onay rozeti
 *   - sahne kesmeleri vurusa kilitli dikey itme; yonlu hareket bulanikligi YALNIZ kesme karelerinde
 *   - kapanis: son kart marka karosuna donusur (ui-to-brand morph), logo, ad, CTA hapi (isilti)
 */

const F_HEAD: FitBase = { family: fontSora, weight: 700, letterSpacing: -0.035 };
const F_NAME: FitBase = { family: fontSora, weight: 800, letterSpacing: -0.035 };
const F_BODY: FitBase = { family: fontJakarta, weight: 600, letterSpacing: -0.01 };

type Geo = {
  W: number;
  H: number;
  x: number;
  w: number;
  bandTop: number;
  bandBottom: number;
  headerTop: number;
  wmTop: number;
  wmSize: number;
};
const TALL: Geo = { W: 1080, H: 1920, x: 90, w: 900, bandTop: 430, bandBottom: 1420, headerTop: 258, wmTop: 1452, wmSize: 24 };
const WIDE: Geo = { W: 1920, H: 1080, x: 140, w: 1640, bandTop: 190, bandBottom: 960, headerTop: 64, wmTop: 1010, wmSize: 22 };

type Row = { title: Fit; detail: Fit | null; h: number };
type Fits = {
  kicker: string;
  head: Fit;
  name: Fit | null;
  sub: Fit | null;
  headerName: Fit;
  /** makale: tek tek madde basliklari + aciklamalari */
  points: Array<{ title: Fit; detail: Fit | null }>;
  rows: Row[];
  rowGap: number;
  endName: Fit;
  domain: Fit;
  price: number;
  /** urun gorsel karti (kanca) */
  img: number;
  tile: number;
};

function rowFits(story: Story, textW: number, avail: number, wide: boolean) {
  let rows: Row[] = [];
  let gap = 18;
  for (let k = 1; k >= 0.55; k -= 0.05) {
    rows = story.points.map((p) => {
      const title = fitK(p.title, F_HEAD, k, { maxWidth: textW, maxLines: wide ? 4 : 3, maxSize: wide ? 54 : 62, minSize: 34 });
      const detail = p.detail ? fitK(p.detail, F_BODY, k, { maxWidth: textW, maxLines: wide ? 5 : 3, maxSize: wide ? 34 : 40, minSize: 26 }) : null;
      return { title, detail, h: Math.round(56 + Math.max(64, linesH(title, 1.1) + (detail ? 12 + linesH(detail, 1.3) : 0))) };
    });
    gap = Math.round(18 * k);
    const total = wide ? Math.max(...rows.map((r) => r.h)) : rows.reduce((a, r) => a + r.h, 0) + gap * (rows.length - 1);
    if (total <= avail) break;
  }
  return { rows, gap };
}

function computeFits(story: Story, G: Geo): Fits {
  const wide = story.wide;
  const textW = wide ? 940 : 860;
  let head!: Fit;
  let name: Fit | null = null;
  let sub: Fit | null = null;
  let img = 0;
  let tile = 0;
  const kicker = story.kicker ? upperTr(story.kicker) : '';
  // Kanca blogu: bant yuksekligine sigana kadar hepsi birlikte kuculur (baslik once 84 px'te kalmaya calisir)
  for (let k = 1; k >= 0.55; k -= 0.05) {
    if (story.kind === 'product') {
      const colW = wide ? 790 : 860;
      head = fitK(story.hook, F_HEAD, k, { maxWidth: colW, maxLines: wide ? 4 : 4, maxSize: wide ? 96 : 104, minSize: wide ? 64 : 84 });
      sub = story.hookSub ? fitK(story.hookSub, F_BODY, k, { maxWidth: colW, maxLines: 3, maxSize: wide ? 40 : 46, minSize: wide ? 30 : 44 }) : null;
      const textH = (kicker ? 70 : 0) + linesH(head, 1.08) + (sub ? 28 + linesH(sub, 1.3) : 0);
      if (wide) {
        img = 760;
        if (textH <= 760) break;
      } else {
        img = Math.round(Math.min(620, 1440 - 270 - 50 - 30 - textH));
        if (img >= 400) break;
        img = Math.max(380, img);
      }
    } else if (story.kind === 'site') {
      tile = Math.round((wide ? 120 : 200) * Math.max(0.7, k));
      name = fitK(story.brand.name, F_NAME, k, { maxWidth: wide ? 800 : 860, maxLines: wide ? 1 : 2, maxSize: wide ? 56 : 84, minSize: wide ? 36 : 56 });
      head = fitK(story.hook, F_HEAD, k, { maxWidth: wide ? 960 : 860, maxLines: wide ? 3 : 5, maxSize: wide ? 100 : 108, minSize: 84 });
      sub = story.hookSub ? fitK(story.hookSub, F_BODY, k, { maxWidth: (wide ? 960 : 860) - 88, maxLines: 3, maxSize: wide ? 40 : 48, minSize: wide ? 30 : 44 }) : null;
      const h = wide
        ? Math.max(tile, linesH(name, 1.1)) + 44 + linesH(head, 1.08) + (sub ? 40 + 80 + linesH(sub, 1.3) : 0)
        : tile + 36 + linesH(name, 1.06) + 40 + linesH(head, 1.08) + (sub ? 40 + 80 + linesH(sub, 1.3) : 0);
      if (h <= (wide ? 780 : 1040)) break;
    } else {
      head = fitK(story.hook, F_HEAD, k, { maxWidth: textW, maxLines: 6, maxSize: 120, minSize: 84 });
      sub = story.hookSub ? fitK(story.hookSub, F_BODY, k, { maxWidth: textW - 88, maxLines: 4, maxSize: 50, minSize: 44 }) : null;
      const h = (kicker ? 74 : 0) + linesH(head, 1.08) + 44 + 80 + (sub ? linesH(sub, 1.3) + 26 : 0) + 40;
      if (h <= G.bandBottom - G.bandTop) break;
    }
  }
  const points = story.kind === 'article'
    ? story.points.map((p) => {
      let title!: Fit;
      let detail: Fit | null = null;
      for (let k = 1; k >= 0.55; k -= 0.05) {
        title = fitK(p.title, F_HEAD, k, { maxWidth: textW, maxLines: 5, maxSize: 108, minSize: 84 });
        detail = p.detail ? fitK(p.detail, F_BODY, k, { maxWidth: textW - 88, maxLines: 4, maxSize: 48, minSize: 44 }) : null;
        if (linesH(title, 1.08) + 48 + (detail ? 88 + 76 + linesH(detail, 1.32) : 76) <= G.bandBottom - G.bandTop) break;
      }
      return { title, detail };
    })
    : [];
  const listAvail = story.kind === 'product' ? (wide ? 700 : 1440 - 720 - 56) : wide ? 680 : G.bandBottom - G.bandTop - 56;
  // satir ic genisligi: panel (2x28) + satir (2x28) dolgulari, rozet 64, bosluk 24
  const rowTextW = wide ? (story.kind === 'site' ? (1640 - 80) / 3 - 2 * 40 : 790 - 56 - 56 - 64 - 24) : 920 - 56 - 56 - 64 - 24;
  const { rows, gap } = story.list ? rowFits(story, rowTextW, listAvail, wide && story.kind === 'site') : { rows: [], gap: 0 };
  return {
    kicker,
    head,
    name,
    sub,
    headerName: fitText(story.header || story.brand.name, { ...F_NAME, weight: 800, family: fontJakarta, letterSpacing: -0.01, maxWidth: story.kind === 'product' ? 780 : wide ? 900 : 760, maxLines: 1, maxSize: wide ? 40 : 42, minSize: 22 }),
    points,
    rows,
    rowGap: gap,
    endName: fitText(story.endName, { ...F_NAME, maxWidth: wide ? (story.kind === 'product' ? 790 : 1400) : 860, maxLines: 2, maxSize: wide ? 96 : 108, minSize: 56 }),
    domain: fitText(story.cta.domain, { family: fontSora, weight: 700, letterSpacing: -0.02, maxWidth: wide && story.kind === 'product' ? 540 : wide ? 900 : 640, maxLines: 1, maxSize: wide ? 54 : 58, minSize: 24 }),
    price: story.price ? fitText(story.price, { ...F_NAME, maxWidth: 400, maxLines: 1, maxSize: 60, minSize: 34 }).size : 0,
    img,
    tile,
  };
}

export function PanelStyle({ story, pal, win, frame }: KitProps) {
  const G = story.wide ? WIDE : TALL;
  const fits = useMemo(() => computeFits(story, G), [story, G]);
  return (
    <AbsoluteFill style={{ fontFamily: fontJakarta, color: pal.ink }}>
      <Field pal={pal} win={win} frame={frame} G={G} />
      {story.kind === 'product' ? <ProductCard story={story} pal={pal} win={win} frame={frame} fits={fits} /> : null}
      <HookScene story={story} pal={pal} win={win} frame={frame} fits={fits} G={G} />
      {story.list ? <ListScene story={story} pal={pal} win={win} frame={frame} fits={fits} G={G} /> : <PointScenes story={story} pal={pal} win={win} frame={frame} fits={fits} G={G} />}
      <Header story={story} pal={pal} win={win} frame={frame} fits={fits} G={G} />
      {story.watermark && frame < win.endS + 2 ? <WatermarkLine top={G.wmTop} color={pal.muted} opacity={0.75 * win.wm(frame)} size={G.wmSize} /> : null}
      <EndScene story={story} pal={pal} win={win} frame={frame} fits={fits} G={G} />
    </AbsoluteFill>
  );
}

type P = { story: Story; pal: BrandPalette; win: Win; frame: number; fits: Fits; G: Geo };

/* ───────────── zemin ───────────── */

function Field({ pal, win, frame, G }: { pal: BrandPalette; win: Win; frame: number; G: Geo }) {
  const beat = pulse(win.sinceBeat(frame, 2), 9);
  const d = (s: number, amp: number) => Math.sin(frame * 0.011 + s) * amp + Math.sin(frame * 0.0047 + s * 2.3) * amp * 0.6;
  const a = { x: G.W * 0.2 + d(1, 70), y: G.H * 0.27 + d(2, 90) };
  const b = { x: G.W * 0.8 + d(3, 70), y: G.H * 0.72 + d(4, 90) };
  const r = Math.round(Math.max(G.W, G.H) * 0.34);
  return (
    <AbsoluteFill style={{ background: `linear-gradient(180deg, ${mix('#fbfbfd', pal.primary, 0.02)} 0%, ${mix('#f2f2f5', pal.primary, 0.04)} 100%)` }}>
      <AbsoluteFill
        style={{
          background: [
            `radial-gradient(${r}px ${r}px at ${a.x}px ${a.y}px, ${rgba(pal.primary, 0.15 + 0.05 * beat)} 0%, ${rgba(pal.primary, 0)} 70%)`,
            `radial-gradient(${r * 1.1}px ${r * 1.1}px at ${b.x}px ${b.y}px, ${rgba(pal.primaryDeep, 0.11 + 0.04 * beat)} 0%, ${rgba(pal.primaryDeep, 0)} 70%)`,
          ].join(','),
        }}
      />
    </AbsoluteFill>
  );
}

/** Beyaz arayuz yuzeyi (web panelinin kart dili) */
function Surface({ pal, style, children }: { pal: BrandPalette; style?: React.CSSProperties; children?: React.ReactNode }) {
  return (
    <div style={{ position: 'absolute', background: '#ffffff', borderRadius: 48, border: `1.5px solid ${rgba(pal.ink, 0.07)}`, boxShadow: softShadow(pal), boxSizing: 'border-box', ...style }}>
      {children}
    </div>
  );
}

/* ───────────── itme kesmesi ───────────── */

/**
 * Dikey itme: giden icerik yukari (cikis penceresinde, EASE ile), gelen asagidan (giris yayi %95'e
 * vardiginda yerinde). Hareket bulanikligi hiza bagli ve yalniz kayarken.
 */
function Push({ frame, G, inP, outP, children }: { frame: number; G: Geo; inP?: (f: number) => number; outP?: (f: number) => number; children: React.ReactNode }) {
  const pos = (f: number) => {
    let y = 0;
    if (inP) y += G.H * 0.62 * (1 - clamp01(inP(f) / 0.95));
    if (outP) y -= G.H * 0.62 * outP(f);
    return y;
  };
  const y = pos(frame);
  if (Math.abs(y) >= G.H) return null;
  return (
    <SpeedBlur vx={0} vy={velocity(pos, frame)} amount={0.1} max={26}>
      <AbsoluteFill style={{ transform: `translateY(${y.toFixed(2)}px)` }}>{children}</AbsoluteFill>
    </SpeedBlur>
  );
}

/* ───────────── baslik (kelimeler bulaniktan yukari, son kelime vurusta altcizgi) ───────────── */

function Headline({ fit, p, pal, frame, underlineAt, align = 'left', style }: { fit: Fit; p: number; pal: BrandPalette; frame: number; underlineAt: number; align?: 'left' | 'center'; style?: React.CSSProperties }) {
  const u = ramp(frame, underlineAt, underlineAt + 10, EASE.snappy);
  return (
    <KineticText
      fit={fit}
      p={p}
      lineHeight={1.08}
      align={align}
      style={{ fontFamily: fontSora, fontWeight: 700, letterSpacing: '-0.035em', color: pal.ink, ...style }}
      wordStyle={(wp) => ({ opacity: interpolate(wp, [0, 0.6], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }), transform: `translateY(${(1 - wp) * fit.size * 0.5}px)`, filter: wp < 0.98 ? `blur(${((1 - Math.min(1, wp)) * 10).toFixed(2)}px)` : undefined })}
      last={(w) => {
        const [core, punct] = splitLast(w);
        return (
          <>
            <span style={{ position: 'relative', color: pal.accentText }}>
              {core}
              <span style={{ position: 'absolute', left: 0, right: fit.size * 0.04, bottom: -fit.size * 0.03, height: Math.max(6, fit.size * 0.075), borderRadius: 99, background: pal.primaryUi, transformOrigin: 'left center', transform: `scaleX(${u})` }} />
            </span>
            {punct}
          </>
        );
      }}
    />
  );
}

/* ───────────── kanca ───────────── */

function HookScene({ story, pal, win, frame, fits, G }: P) {
  if (frame >= win.hookE + 2) return null;
  const titleP = win.titleIn(frame);
  const uAt = win.tl.at('hook.title') + Math.round(win.fpb);
  const sub = win.subIn(frame);
  const src = win.sourceIn(frame);
  const kick = win.kickerIn(frame);
  const subCard = (w: number, center = false) =>
    fits.sub || story.source ? (
      <div style={{ position: 'relative', marginTop: 44, width: w, opacity: clamp01(Math.max(sub, src) * 1.4), transform: `translateY(${(1 - Math.max(sub, src)) * 30}px)` }}>
        <Surface pal={pal} style={{ position: 'relative', padding: '34px 44px', borderRadius: 40, width: w }}>
          {fits.sub ? <Lines fit={fits.sub} lineHeight={1.3} align={center ? 'center' : 'left'} style={{ fontWeight: 600, color: pal.body, opacity: sub }} /> : null}
          {story.source ? (
            <div style={{ marginTop: fits.sub ? 22 : 0, display: 'flex', alignItems: 'center', gap: 10, fontFamily: fontMono, fontSize: 28, fontWeight: 600, color: pal.muted, opacity: src, whiteSpace: 'nowrap', overflow: 'hidden' }}>
              <ArrowUpRight size={30} color={pal.accentText} strokeWidth={2.6} />
              {story.source}
            </div>
          ) : null}
        </Surface>
      </div>
    ) : null;
  const kicker = fits.kicker ? (
    <span style={{ alignSelf: 'flex-start', display: 'inline-block', padding: '12px 24px', borderRadius: 999, background: rgba(pal.primary, 0.12), color: pal.accentText, fontWeight: 800, fontSize: 28, letterSpacing: '0.06em', whiteSpace: 'nowrap', maxWidth: G.w, overflow: 'hidden', textOverflow: 'ellipsis', opacity: clamp01(kick * 1.5), transform: `scale(${0.85 + 0.15 * kick})`, transformOrigin: 'left center' }}>
      {fits.kicker}
    </span>
  ) : null;

  let body: React.ReactNode;
  if (story.kind === 'site') {
    const logo = win.logoIn(frame);
    const nm = win.nameIn(frame);
    body = story.wide ? (
      <>
        <div style={{ position: 'absolute', left: G.x, top: 140, width: 980, height: 800, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 28, opacity: clamp01(nm * 1.5), transform: `translateY(${(1 - nm) * 30}px)` }}>
            <LogoTile brand={story.brand} size={fits.tile} pal={pal} />
            <Lines fit={fits.name!} lineHeight={1.1} style={{ fontFamily: fontSora, fontWeight: 800, letterSpacing: '-0.03em' }} />
          </div>
          <Headline fit={fits.head} p={titleP} pal={pal} frame={frame} underlineAt={uAt} style={{ marginTop: 44 }} />
          {subCard(960)}
        </div>
        <UiCard story={story} pal={pal} frame={frame} p={logo} x={1210} y={230} w={570} h={620} />
      </>
    ) : (
      <div style={{ position: 'absolute', left: G.x, width: 860, top: 280, height: 1160, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
        <div style={{ transform: `scale(${0.4 + 0.6 * logo}) rotate(${(1 - logo) * -8}deg)`, opacity: clamp01(logo * 1.6) }}>
          <LogoTile brand={story.brand} size={fits.tile} pal={pal} />
        </div>
        <Lines fit={fits.name!} lineHeight={1.06} align="center" style={{ marginTop: 36, fontFamily: fontSora, fontWeight: 800, letterSpacing: '-0.035em', opacity: clamp01(nm * 1.5), transform: `translateY(${(1 - nm) * 36}px)` }} />
        <Headline fit={fits.head} p={titleP} pal={pal} frame={frame} underlineAt={uAt} align="center" style={{ marginTop: 40 }} />
        {subCard(860, true)}
      </div>
    );
  } else if (story.kind === 'product') {
    body = (
      <div style={story.wide
        ? { position: 'absolute', left: 1010, width: 790, top: 160, height: 760, display: 'flex', flexDirection: 'column', justifyContent: 'center' }
        : { position: 'absolute', left: G.x, width: 860, top: 270 + fits.img + 50, height: 1440 - (270 + fits.img + 50), display: 'flex', flexDirection: 'column', justifyContent: 'center' }}
      >
        {kicker}
        <Headline fit={fits.head} p={titleP} pal={pal} frame={frame} underlineAt={uAt} style={{ marginTop: kicker ? 26 : 0 }} />
        {fits.sub ? <Lines fit={fits.sub} lineHeight={1.3} style={{ marginTop: 28, fontWeight: 600, color: pal.body, opacity: sub, transform: `translateY(${(1 - sub) * 20}px)` }} /> : null}
      </div>
    );
  } else {
    body = (
      <div style={{ position: 'absolute', left: G.x, width: 860, top: G.bandTop, height: G.bandBottom - G.bandTop, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        {kicker}
        <Headline fit={fits.head} p={titleP} pal={pal} frame={frame} underlineAt={uAt} style={{ marginTop: kicker ? 34 : 0 }} />
        {subCard(860)}
      </div>
    );
  }
  return (
    <Push frame={frame} G={G} outP={win.hookOut}>
      {body}
    </Push>
  );
}

/** Yatay site kancasinda sagdaki arayuz karti: buyuk logo + iskelet satirlar (dekor, metin yok) */
function UiCard({ story, pal, frame, p, x, y, w, h }: { story: Story; pal: BrandPalette; frame: number; p: number; x: number; y: number; w: number; h: number }) {
  const float = Math.sin(frame / 38) * 10;
  return (
    <Surface pal={pal} style={{ left: x, top: y + float, width: w, height: h, padding: 48, opacity: clamp01(p * 1.4), transform: `translateY(${(1 - p) * 80}px) scale(${0.92 + 0.08 * p})`, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ transform: `scale(${0.5 + 0.5 * p})` }}>
        <LogoTile brand={story.brand} size={280} pal={pal} />
      </div>
      {[0.72, 0.5, 0.62].map((wd, i) => (
        <div key={i} style={{ marginTop: i ? 18 : 50, alignSelf: 'flex-start', width: `${wd * 100 * clamp01(p * 1.2 - i * 0.1)}%`, height: i ? 16 : 24, borderRadius: 99, background: i ? rgba(pal.ink, 0.08) : rgba(pal.primary, 0.35) }} />
      ))}
    </Surface>
  );
}

/* ───────────── makale maddeleri (tek tek; aralarinda itme) ───────────── */

function PointScenes({ pal, win, frame, fits, G }: P) {
  return (
    <>
      {fits.points.map((fp, i) => {
        const [s, e] = win.scene(i);
        if (frame < s - 8 || frame >= e + 2) return null;
        const last = i === fits.points.length - 1;
        const tP = win.pointTitleIn(i, frame);
        const dP = win.detailIn(i, frame);
        const inP = (f: number) => win.pointIn(i, f);
        const cardIn = win.pointIn(i, frame);
        const fill = ramp(frame, s, e - 6, (t) => t);
        const content = (
          <div style={{ position: 'absolute', left: G.x, width: 860, top: G.bandTop, height: G.bandBottom - G.bandTop, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <Headline fit={fp.title} p={tP} pal={pal} frame={frame} underlineAt={win.tl.at(`p${i + 1}.title`) + Math.round(win.fpb)} />
            <div style={{ position: 'relative', marginTop: 48, width: 860, opacity: clamp01(cardIn * 1.4) }}>
              <Surface pal={pal} style={{ position: 'relative', width: 860, padding: '38px 44px 40px', overflow: 'hidden' }}>
                {/* kart doluyor: sahne boyunca ilerleyen ince marka serit */}
                <div style={{ position: 'absolute', left: 0, top: 0, height: 6, width: `${fill * 100}%`, background: pal.primaryUi }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
                  <div style={{ width: 72, height: 72, borderRadius: 99, background: brandGrad(pal), color: pal.onPrimary, display: 'grid', placeItems: 'center', fontFamily: fontSora, fontWeight: 800, fontSize: 32, transform: `scale(${0.5 + 0.5 * clamp01(cardIn)})` }}>{String(i + 1).padStart(2, '0')}</div>
                  <div style={{ fontFamily: fontSora, fontWeight: 700, fontSize: 30, color: pal.muted }}>/ {String(fits.points.length).padStart(2, '0')}</div>
                </div>
                {fp.detail ? (
                  <div style={{ position: 'relative', marginTop: 28 }}>
                    {/* aciklama gelene dek iskelet satirlar (panel dolumu) */}
                    <div style={{ position: 'absolute', inset: 0, opacity: 1 - clamp01(dP * 1.6) }}>
                      {fp.detail.lines.map((_, li) => (
                        <div key={li} style={{ height: fp.detail!.size * 0.42, marginTop: li ? fp.detail!.size * 0.9 : fp.detail!.size * 0.45, width: `${[86, 72, 80, 64][li % 4] * clamp01(cardIn * 1.2)}%`, borderRadius: 99, background: rgba(pal.ink, 0.07) }} />
                      ))}
                    </div>
                    <Lines fit={fp.detail} lineHeight={1.32} style={{ position: 'relative', fontWeight: 600, color: pal.ink, opacity: clamp01(dP * 1.5), transform: `translateY(${(1 - dP) * 24}px)` }} />
                  </div>
                ) : null}
              </Surface>
            </div>
          </div>
        );
        // Son madde kapanista marka karosuna donusur (EndScene) — itmeyle cikmaz, solar
        return (
          <Push key={i} frame={frame} G={G} inP={inP} outP={last ? undefined : (f) => win.pointOut(i, f)}>
            <div style={{ position: 'absolute', inset: 0, opacity: last ? 1 - win.pointOut(i, frame) : 1 }}>{content}</div>
          </Push>
        );
      })}
    </>
  );
}

/* ───────────── liste (site / urun): satirlar panele gomulur ───────────── */

function ListScene({ story, pal, win, frame, fits, G }: P) {
  const [p1s] = win.scene(0);
  if (frame < p1s - 8 || frame >= win.endS + 4) return null;
  const out = win.pointOut(0, frame);
  const wideSite = story.wide && story.kind === 'site';
  const rowEls = fits.rows.map((r, i) => {
    const [s, e] = win.scene(i);
    const inP = win.pointIn(i, frame);
    const active = frame < e || i === fits.rows.length - 1;
    const det = win.detailIn(i, frame);
    const check = ramp(frame, s + 6, s + 14, EASE.overshoot);
    return { r, i, s, inP, active, det, check };
  });
  // panel yuksekligi satirlar geldikce buyur (progressive fill)
  const shown = rowEls.reduce((a, x) => a + (x.r.h + fits.rowGap) * clamp01(x.inP), 0);
  let panel: React.CSSProperties;
  let rowPos: (i: number, y: number) => React.CSSProperties;
  if (wideSite) {
    const cardW = (1640 - 80) / 3;
    const cardH = Math.max(420, ...fits.rows.map((r) => r.h + 90));
    const top = 210 + Math.max(0, (720 - cardH) / 2);
    panel = { left: 0, top: 0, width: 0, height: 0, opacity: 0 };
    rowPos = (i) => ({ left: G.x + i * (cardW + 40), top, width: cardW, height: cardH });
  } else {
    const x = story.wide ? 1010 : 80;
    const w = story.wide ? 790 : 920;
    const top = story.kind === 'product' ? (story.wide ? 210 : 720) : G.bandTop;
    const maxH = story.kind === 'product' ? (story.wide ? 720 : 1440 - 720) : G.bandBottom - G.bandTop;
    const full = fits.rows.reduce((a, r) => a + r.h, 0) + fits.rowGap * (fits.rows.length - 1) + 56;
    const y0 = top + Math.max(0, (maxH - full) / 2);
    panel = { left: x, top: y0, width: w, height: 28 + Math.max(0, shown - fits.rowGap) + 28 };
    rowPos = (_i, y) => ({ left: x + 28, top: y0 + 28 + y, width: w - 56 });
  }
  let y = 0;
  return (
    <Push frame={frame} G={G} inP={(f) => win.pointIn(0, f)}>
      <AbsoluteFill style={{ opacity: 1 - out }}>
        {!wideSite ? <Surface pal={pal} style={{ ...panel, opacity: clamp01(rowEls[0].inP * 3) }} /> : null}
        {rowEls.map(({ r, i, inP, active, det, check }) => {
          const pos = rowPos(i, y);
          y += (r.h + fits.rowGap) * clamp01(inP);
          if (inP <= 0.001) return null;
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                ...pos,
                ...(wideSite ? {} : { height: r.h }),
                boxSizing: 'border-box',
                display: 'flex',
                flexDirection: wideSite ? 'column' : 'row',
                alignItems: wideSite ? 'flex-start' : 'center',
                gap: wideSite ? 26 : 24,
                padding: wideSite ? '40px 40px' : '28px 28px',
                borderRadius: wideSite ? 44 : 30,
                background: wideSite ? '#ffffff' : active ? mix('#ffffff', pal.primary, 0.05) : mix('#ffffff', pal.ink, 0.025),
                border: active ? `3px solid ${pal.primaryUi}` : `1.5px solid ${rgba(pal.ink, 0.07)}`,
                boxShadow: wideSite ? softShadow(pal) : undefined,
                opacity: clamp01(inP * 1.5),
                transform: wideSite ? `translateY(${(1 - inP) * 90}px)` : `translateY(${(1 - inP) * 50}px) scale(${0.96 + 0.04 * clamp01(inP)})`,
              }}
            >
              <div style={{ position: 'relative', width: 64, height: 64, flexShrink: 0, borderRadius: 99, display: 'grid', placeItems: 'center', background: active ? brandGrad(pal) : rgba(pal.ink, 0.1), color: active ? pal.onPrimary : pal.body, fontFamily: fontSora, fontWeight: 800, fontSize: 28 }}>
                {active && check > 0.05 ? <Check size={34} strokeWidth={3.4} style={{ transform: `scale(${check})` }} /> : i + 1}
              </div>
              <div style={{ minWidth: 0 }}>
                <Lines fit={r.title} lineHeight={1.1} style={{ fontFamily: fontSora, fontWeight: 700, letterSpacing: '-0.03em' }} />
                {r.detail ? <Lines fit={r.detail} lineHeight={1.3} style={{ marginTop: 12, fontWeight: 600, color: pal.body, opacity: clamp01(det * 1.4) }} /> : null}
              </div>
            </div>
          );
        })}
      </AbsoluteFill>
    </Push>
  );
}

/* ───────────── urun gorseli (tum video boyunca) ───────────── */

function ProductCard({ story, pal, win, frame, fits }: Omit<P, 'G'>) {
  const hookE = win.hookE;
  const endS = win.endS;
  const inP = win.logoIn(frame);
  const shrink = ramp(frame, hookE - 8, hookE + 4, EASE.smooth);
  const endP = ramp(frame, endS - 6, endS + 8, EASE.smooth);
  let x: number;
  let y: number;
  let size: number;
  if (story.wide) {
    size = interpolate(endP, [0, 1], [760, 640]);
    x = 130 + (760 - size) / 2;
    y = 160 + (760 - size) / 2;
  } else {
    size = interpolate(shrink, [0, 1], [fits.img, 400]) + (420 - 400) * endP;
    x = (1080 - size) / 2;
    y = interpolate(shrink, [0, 1], [270, 280]) + 20 * endP;
  }
  const price = win.priceIn(frame);
  const logoP = win.titleIn(frame);
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: size, height: size, opacity: clamp01(inP * 1.4), transform: `translateY(${(1 - Math.min(1, inP)) * 60}px) scale(${0.9 + 0.1 * Math.min(1, inP)})` }}>
      <Surface pal={pal} style={{ inset: 0, borderRadius: size * 0.08, overflow: 'hidden', background: story.image ? '#ffffff' : brandGrad(pal) }}>
        <ProductImage src={story.image} frame={frame} total={win.total} fallback={<LogoTile brand={story.brand} size={size * 0.42} pal={pal} />} />
      </Surface>
      {story.image ? (
        <div style={{ position: 'absolute', left: -size * 0.05, bottom: -size * 0.05, opacity: clamp01(logoP * 1.5), transform: `scale(${0.6 + 0.4 * Math.min(1, logoP)})` }}>
          <LogoTile brand={story.brand} size={Math.round(size * 0.2)} pal={pal} />
        </div>
      ) : null}
      {story.price && fits.price ? (
        <div style={{ position: 'absolute', right: -size * 0.05, top: size * 0.05, padding: `${fits.price * 0.3 * (size / 620)}px ${fits.price * 0.62 * (size / 620)}px`, borderRadius: 999, background: brandGrad(pal), color: pal.onPrimary, fontFamily: fontSora, fontWeight: 800, fontSize: fits.price * (size / 620) * (story.wide ? 1.15 : 1), whiteSpace: 'nowrap', boxShadow: `0 18px 40px ${rgba(pal.primaryDeep, 0.3)}, 0 0 0 5px #ffffff`, opacity: clamp01(price * 1.5), transform: `scale(${0.6 + 0.4 * price})` }}>
          {story.price}
        </div>
      ) : null}
    </div>
  );
}

/* ───────────── ust satir ───────────── */

function Header({ story, pal, win, frame, fits, G }: P) {
  if (!story.header || frame >= win.endS + 6) return null;
  const p = win.headerIn(frame);
  const out = win.headerOut(frame);
  if (p <= 0.001) return null;
  const isProduct = story.kind === 'product';
  return (
    <div style={{ position: 'absolute', left: isProduct ? 1010 : G.x, top: isProduct ? 96 : G.headerTop, display: 'flex', alignItems: 'center', gap: 22, opacity: clamp01(p * 1.5) * (1 - out), transform: `translateY(${(1 - p) * -24}px)` }}>
      {!isProduct ? <LogoTile brand={story.brand} size={story.wide ? 72 : 84} pal={pal} /> : null}
      <span style={{ fontWeight: 800, fontSize: fits.headerName.size, whiteSpace: 'nowrap', letterSpacing: '-0.01em' }}>{fits.headerName.lines[0]}</span>
    </div>
  );
}

/* ───────────── kapanis: kart -> marka karosu, logo, ad, CTA ───────────── */

function EndScene({ story, pal, win, frame, fits, G }: P) {
  const s = win.endS;
  if (frame < s - 7) return null;
  const isProduct = story.kind === 'product';
  const m = ramp(frame, s - 6, s + 8, EASE.smooth);
  const tileSize = story.wide ? 200 : 240;
  // urun: gorsel karti kalir; marka karosu yerine urun adi + CTA saga / alta
  const tile = isProduct ? null : (() => {
    const from = story.wide ? { x: 640, y: 210, w: 640, h: 660, r: 48 } : { x: 80, y: 560, w: 920, h: 760, r: 48 };
    const to = story.wide ? { x: (1920 - tileSize) / 2, y: 130, w: tileSize, h: tileSize, r: tileSize * 0.27 } : { x: (1080 - tileSize) / 2, y: 520, w: tileSize, h: tileSize, r: tileSize * 0.27 };
    const L = (a: number, b: number) => a + (b - a) * m;
    return { x: L(from.x, to.x), y: L(from.y, to.y), w: L(from.w, to.w), h: L(from.h, to.h), r: L(from.r, to.r), to };
  })();
  const t = win.endTileIn(frame);
  const nm = win.endNameIn(frame);
  const lab = win.labelIn(frame);
  const cta = win.ctaIn(frame);
  const mark = win.markIn(frame);
  const sheen = interpolate(frame, [win.tl.at('end.cta') + 14, win.tl.at('end.cta') + 40], [-130, 330], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const textBox: React.CSSProperties = isProduct
    ? story.wide
      ? { left: 1010, width: 790, top: 160, height: 760, alignItems: 'flex-start', textAlign: 'left' }
      : { left: G.x, width: 860, top: 760, height: 640, alignItems: 'center', textAlign: 'center' }
    : story.wide
      ? { left: 140, width: 1640, top: 360, height: 620, alignItems: 'center', textAlign: 'center' }
      : { left: G.x, width: 860, top: 810, height: 640, alignItems: 'center', textAlign: 'center' };
  return (
    <AbsoluteFill>
      {tile ? (
        <div style={{ position: 'absolute', left: tile.x, top: tile.y, width: tile.w, height: tile.h, borderRadius: tile.r, background: m < 0.5 ? '#ffffff' : brandGrad(pal), boxShadow: softShadow(pal, 1 - 0.4 * m), opacity: m < 0.5 ? clamp01(m * 4) : 1, overflow: 'hidden' }}>
          <div style={{ position: 'absolute', inset: 0, background: brandGrad(pal), opacity: clamp01((m - 0.2) * 2) }} />
        </div>
      ) : null}
      {tile ? (
        <div style={{ position: 'absolute', left: tile.to.x + tileSize * 0.14, top: tile.to.y + tileSize * 0.14, transform: `scale(${clamp01(t)})`, opacity: clamp01(t * 2) }}>
          <LogoTile brand={story.brand} size={tileSize * 0.72} pal={pal} />
        </div>
      ) : null}
      <div style={{ position: 'absolute', display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', ...textBox }}>
        <Lines fit={fits.endName} lineHeight={1.05} align={(textBox.textAlign as 'left' | 'center') ?? 'center'} style={{ fontFamily: fontSora, fontWeight: 800, letterSpacing: '-0.035em', opacity: clamp01(nm * 1.5), transform: `translateY(${(1 - nm) * 30}px)` }} />
        <div style={{ marginTop: story.wide ? 40 : 64, fontWeight: 700, fontSize: story.wide ? 42 : 50, color: pal.body, opacity: lab }}>{story.cta.label}</div>
        <div style={{ position: 'relative', marginTop: 30, display: 'inline-flex', alignItems: 'center', gap: fits.domain.size * 0.36, padding: `${fits.domain.size * 0.5}px ${fits.domain.size * 0.85}px`, borderRadius: 999, overflow: 'hidden', background: brandGrad(pal, 135), color: pal.onPrimary, fontFamily: fontSora, fontWeight: 700, fontSize: fits.domain.size, letterSpacing: '-0.02em', whiteSpace: 'nowrap', boxShadow: `0 22px 48px ${rgba(pal.primaryDeep, 0.3)}`, opacity: clamp01(cta * 1.5), transform: `scale(${0.72 + 0.28 * cta})` }}>
          <div style={{ position: 'absolute', top: '-20%', bottom: '-20%', left: 0, width: '34%', transform: `translateX(${sheen}%)`, background: `linear-gradient(100deg, ${rgba('#ffffff', 0)} 0%, ${rgba('#ffffff', 0.4)} 50%, ${rgba('#ffffff', 0)} 100%)` }} />
          <span style={{ position: 'relative' }}>{fits.domain.lines[0]}</span>
          <ArrowUpRight size={fits.domain.size * 0.95} strokeWidth={2.8} style={{ position: 'relative' }} />
        </div>
      </div>
      {story.watermark ? <WatermarkLine top={G.wmTop - (story.wide ? 0 : 12)} color={pal.muted} opacity={0.8 * mark} size={story.wide ? 22 : 26} /> : null}
    </AbsoluteFill>
  );
}
