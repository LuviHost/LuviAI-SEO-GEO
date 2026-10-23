import React, { useMemo } from 'react';
import { AbsoluteFill } from 'remotion';
import { clamp01, fontMono, ramp } from '../marketing/kit';
import { fitText, type Fit } from '../article-short/fit';
import type { BrandPalette } from '../article-short/palette';
import { LogoTile } from '../article-short/ArticleShort';
import { WatermarkLine } from '../promo/shared';
import type { KitProps } from './StyledVideo';
import type { Story, Win } from './story';
import { fontInter } from './fonts';
import { Lines, ProductImage, bezier, fitK, linesH, stagger, type FitBase } from './kit';

/**
 * ISVICRE — lemo-opuscar "swiss-motion" stili (MIT; films/ranksup-swiss, kaynaklar src/styles/CREDITS.md):
 *   - acik kagit sayfa + TEK sinyal rengi (musterinin marka rengi); 6 sutunlu izgara, sutun kilavuzlari
 *   - yalniz iki egri: kesin egri E = cubic-bezier(.7, 0, .2, 1) (oturma) ve dogrusal (cizgiler, tarama)
 *   - bayrak sola, buyuk Inter 800 (>= 90 px'te -%2 aralik); kelimeler taban cizgisinin altindan kirpma
 *     maskesiyle yukselir
 *   - basliklar ince murekkep cetvel + sira numarasi; moduller asagidan yukari silinerek gelir; etkin modulde
 *     tarama cizgisi + cetvel cetikleri, kirpma isaretleri; sahne gecisinde bicak cizgisi + sert sayfa kaydirma
 *   - sinyal rengi kare modul izgaranin hucrelerine oturur; kapanista tum ekrani kaplayip logo karosuna
 *     yeniden akar
 * Sayilar / yazilar icerikten: sira numaralari (01 / 03) disinda yeni metin eklenmez.
 */

const E = bezier(0.7, 0, 0.2, 1);
const C = { page: '#F2F0EA', paper: '#FFFFFF', ink: '#141414', mute: '#8A8780', grey: '#D9D6CF', grid: '#E6E3DC' };
const F_HEAD: FitBase = { family: fontInter, weight: 800, letterSpacing: -0.02 };
const F_BODY: FitBase = { family: fontInter, weight: 500, letterSpacing: -0.005 };

type Geo = { W: number; H: number; M: number; GUT: number; COL: number; top: number; bottom: number; capY: number; wmTop: number; wmSize: number; textW: number };
const mk = (W: number, H: number, M: number, top: number, bottom: number, capY: number, wmTop: number, wmSize: number, textW: number): Geo => ({ W, H, M, GUT: 24, COL: (W - 2 * M - 5 * 24) / 6, top, bottom, capY, wmTop, wmSize, textW });
const TALL = mk(1080, 1920, 72, 420, 1430, 330, 1452, 24, 870);
const WIDE = mk(1920, 1080, 96, 200, 960, 120, 1012, 22, 1000);
const colX = (G: Geo, i: number) => G.M + i * (G.COL + G.GUT);

type Row = { title: Fit; detail: Fit | null; h: number };
type Fits = { head: Fit; name: Fit | null; sub: Fit | null; cap: Fit | null; points: Array<{ title: Fit; detail: Fit | null }>; rows: Row[]; rowGap: number; header: Fit; endName: Fit; label: Fit; domain: Fit; price: Fit | null; img: number };

function computeFits(story: Story, G: Geo): Fits {
  const wide = story.wide;
  const colW = story.kind === 'product' ? (wide ? 780 : 870) : G.textW;
  let head!: Fit;
  let sub: Fit | null = null;
  let name: Fit | null = null;
  let img = 0;
  const capText = story.kind === 'site' ? story.brand.name : story.kicker;
  const cap = capText ? fitText(capText, { ...F_BODY, maxWidth: story.kind === 'site' ? colW - 170 : colW - 120, maxLines: 1, maxSize: story.kind === 'site' ? 44 : 32, minSize: 22 }) : null;
  for (let k = 1; k >= 0.5; k -= 0.05) {
    head = fitK(story.hook, F_HEAD, k, { maxWidth: colW, maxLines: story.kind === 'product' ? 4 : wide ? 3 : 6, maxSize: story.kind === 'product' ? (wide ? 96 : 108) : wide ? 120 : 136, minSize: 72 });
    sub = story.hookSub ? fitK(story.hookSub, F_BODY, Math.max(0.85, k), { maxWidth: colW - 64, maxLines: 3, maxSize: wide ? 40 : 46, minSize: wide ? 30 : 40 }) : null;
    const h = linesH(head, 1.04) + (sub || story.source ? 50 + 64 + linesH(sub, 1.3) + (story.source ? 50 : 0) : 0);
    if (story.kind === 'product') {
      if (wide) {
        img = 760;
        if (h <= 700) break;
      } else {
        img = Math.round(Math.min(616, 1440 - 280 - 110 - 30 - h));
        if (img >= 400) break;
        img = Math.max(380, img);
      }
    } else if (h <= G.bottom - G.top - 60) break;
  }
  if (story.kind === 'site') name = cap;
  const points = story.kind === 'article'
    ? story.points.map((p) => {
      let title!: Fit;
      let detail: Fit | null = null;
      for (let k = 1; k >= 0.5; k -= 0.05) {
        title = fitK(p.title, F_HEAD, k, { maxWidth: G.textW, maxLines: 5, maxSize: 124, minSize: 72 });
        detail = p.detail ? fitK(p.detail, F_BODY, Math.max(0.85, k), { maxWidth: G.textW - 80, maxLines: 4, maxSize: 48, minSize: 40 }) : null;
        if (linesH(title, 1.04) + (detail ? 60 + 80 + linesH(detail, 1.3) : 0) <= G.bottom - G.top - 60) break;
      }
      return { title, detail };
    })
    : [];
  let rows: Row[] = [];
  let rowGap = 0;
  if (story.list) {
    const wideSite = wide && story.kind === 'site';
    const textW = wideSite ? 2 * G.COL + G.GUT - 64 : (story.kind === 'product' ? (wide ? 780 : 936) : 936) - 64 - 80;
    const avail = wideSite ? 600 : story.kind === 'product' ? (wide ? 720 : 1440 - 740) : G.bottom - G.top - 60;
    for (let k = 1; k >= 0.5; k -= 0.05) {
      rows = story.points.map((p) => {
        const title = fitK(p.title, F_HEAD, k, { maxWidth: textW, maxLines: wideSite ? 4 : 3, maxSize: wideSite ? 56 : 62, minSize: 32 });
        const detail = p.detail ? fitK(p.detail, F_BODY, k, { maxWidth: textW, maxLines: wideSite ? 5 : 3, maxSize: 36, minSize: 24 }) : null;
        return { title, detail, h: Math.round(64 + linesH(title, 1.06) + (detail ? 16 + linesH(detail, 1.3) : 0)) };
      });
      rowGap = G.GUT;
      const total = wideSite ? Math.max(...rows.map((r) => r.h)) : rows.reduce((a, r) => a + r.h, 0) + rowGap * (rows.length - 1);
      if (total <= avail) break;
    }
  }
  const endW = wide ? (story.kind === 'product' ? 780 : 1500) : G.textW;
  return {
    head,
    name,
    sub,
    cap,
    points,
    rows,
    rowGap,
    header: fitText(story.header || story.brand.name, { ...F_BODY, weight: 700, maxWidth: story.kind === 'product' ? 760 : 700, maxLines: 1, maxSize: 34, minSize: 20 }),
    endName: fitText(story.endName, { ...F_HEAD, maxWidth: endW, maxLines: 2, maxSize: wide ? 120 : 132, minSize: 56 }),
    label: fitText(story.cta.label, { ...F_BODY, maxWidth: endW, maxLines: 1, maxSize: wide ? 40 : 46, minSize: 26 }),
    domain: fitText(story.cta.domain, { ...F_HEAD, weight: 700, maxWidth: wide && story.kind === 'product' ? 660 : 800, maxLines: 1, maxSize: wide ? 56 : 60, minSize: 26 }),
    price: story.price ? fitText(story.price, { ...F_HEAD, maxWidth: 420, maxLines: 1, maxSize: 64, minSize: 34 }) : null,
    img,
  };
}

export function SwissStyle({ story, pal, win, frame }: KitProps) {
  const G = story.wide ? WIDE : TALL;
  const fits = useMemo(() => computeFits(story, G), [story, G]);
  const sig = pal.primary;
  return (
    <AbsoluteFill style={{ background: C.page, color: C.ink, fontFamily: fontInter }}>
      <Guides G={G} p={ramp(frame, 0, 14, (t) => t)} />
      {story.kind === 'product' ? <ProductModule story={story} pal={pal} win={win} frame={frame} fits={fits} G={G} /> : null}
      {story.kind === 'product' ? (
        <AbsoluteFill style={{ opacity: 1 - win.hookOut(frame), transform: `translateY(${-80 * E(clamp01(win.hookOut(frame)))}px)` }}>
          <Hook story={story} pal={pal} win={win} frame={frame} fits={fits} G={G} />
        </AbsoluteFill>
      ) : (
        <Pan frame={frame} G={G} out={(f) => win.hookOut(f)}>
          <Hook story={story} pal={pal} win={win} frame={frame} fits={fits} G={G} />
        </Pan>
      )}
      {story.list ? <List story={story} pal={pal} win={win} frame={frame} fits={fits} G={G} /> : <Points story={story} pal={pal} win={win} frame={frame} fits={fits} G={G} />}
      <Knives win={win} frame={frame} G={G} />
      <Header story={story} pal={pal} win={win} frame={frame} fits={fits} G={G} />
      <SignalModule story={story} pal={pal} win={win} frame={frame} G={G} sig={sig} />
      {story.watermark && frame < win.endS + 2 ? <WatermarkLine top={G.wmTop} color={C.mute} opacity={0.85 * win.wm(frame)} size={G.wmSize} /> : null}
      <End story={story} pal={pal} win={win} frame={frame} fits={fits} G={G} />
    </AbsoluteFill>
  );
}

type P = { story: Story; pal: BrandPalette; win: Win; frame: number; fits: Fits; G: Geo };

/* ───────────── izgara ───────────── */

function Guides({ G, p }: { G: Geo; p: number }) {
  const xs: number[] = [];
  for (let i = 0; i < 6; i++) {
    xs.push(colX(G, i));
    xs.push(colX(G, i) + G.COL);
  }
  return (
    <>
      {xs.map((x, i) => (
        <div key={i} style={{ position: 'absolute', left: x, top: 0, width: 1, height: G.H * p, background: C.grid }} />
      ))}
    </>
  );
}

/** Sert sayfa kaydirma (kesin egri): giden sayfa yukari */
function Pan({ frame, G, out, inP, children }: { frame: number; G: Geo; out?: (f: number) => number; inP?: (f: number) => number; children: React.ReactNode }) {
  let y = 0;
  if (out) y -= G.H * E(clamp01(out(frame)));
  if (inP) y += G.H * 0.5 * (1 - E(clamp01(inP(frame) / 0.95)));
  if (Math.abs(y) >= G.H) return null;
  return <AbsoluteFill style={{ transform: `translateY(${y.toFixed(1)}px)` }}>{children}</AbsoluteFill>;
}

/** Kelime kelime kirpma maskesinden yukselen yazi (kesin egri; son kelime %95'te yerinde — stagger) */
function RiseWords({ fit, p, color, lh = 1.04, style }: { fit: Fit; p: number; color: string; lh?: number; style?: React.CSSProperties }) {
  const words = fit.lines.map((l) => l.split(' '));
  const n = words.reduce((a, w) => a + w.length, 0);
  let k = 0;
  return (
    <div style={{ fontFamily: fontInter, fontWeight: 800, fontSize: fit.size, lineHeight: lh, letterSpacing: fit.size >= 90 ? '-0.02em' : '-0.01em', color, ...style }}>
      {words.map((ws, li) => (
        <div key={li} style={{ whiteSpace: 'nowrap' }}>
          {ws.map((w, wi) => {
            const wp = E(clamp01(stagger(p, k++, n, 0.5) / 0.95));
            return (
              <React.Fragment key={wi}>
                {wi > 0 ? ' ' : null}
                <span style={{ display: 'inline-block', overflow: 'hidden', verticalAlign: 'top', paddingBottom: '0.08em', marginBottom: '-0.08em' }}>
                  <span style={{ display: 'inline-block', transform: `translateY(${((1 - wp) * 1.1).toFixed(3)}em)` }}>{w}</span>
                </span>
              </React.Fragment>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** Ince murekkep cetvel (dogrusal cizilir) + sag ustte sira numarasi + istege bagli etiket */
function Caption({ G, y, p, label, labelP = 0, index, w }: { G: Geo; y: number; p: number; label?: Fit | null; labelP?: number; index?: string; w?: number }) {
  const width = w ?? G.W - 2 * G.M;
  const lp = ramp(p, 0.4, 1, E);
  // etiket (icerik metni) tempo yayiyla: %95'te tam gorunur (okunurluk sozlesmesi)
  const tp = E(clamp01(labelP / 0.95));
  return (
    <>
      <div style={{ position: 'absolute', left: G.M, top: y, width: width * clamp01(p), height: 2, background: C.ink }} />
      {label ? (
        <div style={{ position: 'absolute', left: G.M, top: y - label.size * 1.3, overflow: 'hidden', height: label.size * 1.25 }}>
          <div style={{ transform: `translateY(${(1 - tp) * 1.1}em)`, fontSize: label.size }}>
            <Lines fit={label} lineHeight={1.15} style={{ fontWeight: 500, color: C.mute }} />
          </div>
        </div>
      ) : null}
      {index ? <div style={{ position: 'absolute', left: G.M + width - 120, width: 120, textAlign: 'right', top: y - 40, fontFamily: fontInter, fontWeight: 500, fontSize: 28, color: C.mute, opacity: lp }}>{index}</div> : null}
    </>
  );
}

/** Beyaz modul: asagidan yukari silinerek gelir */
function Module({ x, y, w, h, p, children, border = false, crop = 0 }: { x: number; y: number; w: number; h: number; p: number; children?: React.ReactNode; border?: boolean; crop?: number }) {
  const q = E(clamp01(p));
  return (
    <>
      <div style={{ position: 'absolute', left: x, top: y, width: w, height: h, clipPath: `inset(${(1 - q) * 100}% 0 0 0)`, background: C.paper, boxShadow: border ? `inset 0 0 0 3px ${C.ink}` : `inset 0 0 0 1.5px ${C.grey}` }}>{children}</div>
      {crop > 0 ? <CropMarks x={x - 12} y={y - 12} w={w + 24} h={h + 24} p={crop} /> : null}
    </>
  );
}

function CropMarks({ x, y, w, h, p }: { x: number; y: number; w: number; h: number; p: number }) {
  const L = 28 * p;
  const s: React.CSSProperties = { position: 'absolute', background: C.ink };
  return (
    <>
      {[[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]].map(([cx, cy, sx, sy], i) => (
        <React.Fragment key={i}>
          <div style={{ ...s, left: sx > 0 ? cx : cx - L, top: cy - (sy > 0 ? 0 : 3), width: L, height: 3 }} />
          <div style={{ ...s, left: cx - (sx > 0 ? 0 : 3), top: sy > 0 ? cy : cy - L, width: 3, height: L }} />
        </React.Fragment>
      ))}
    </>
  );
}

/** Tarama: dogrusal cizgi + gectigi yerde cetvel centikleri (sag kenar) */
function Scan({ w, h, p }: { w: number; h: number; p: number }) {
  if (p <= 0) return null;
  const y = h * clamp01(p);
  const ticks: number[] = [];
  for (let t = 12, i = 0; t < y; t += 24, i++) ticks.push(i);
  return (
    <>
      {p < 1 ? <div style={{ position: 'absolute', left: 0, top: y, width: w, height: 2, background: C.ink }} /> : null}
      {ticks.map((i) => (
        <div key={i} style={{ position: 'absolute', right: 0, top: 12 + i * 24, width: i % 4 ? 14 : 30, height: 2, background: C.ink }} />
      ))}
    </>
  );
}

/* ───────────── kanca ───────────── */

function Hook({ story, pal, win, frame, fits, G }: P) {
  if (frame >= win.hookE + 2) return null;
  const tP = win.titleIn(frame);
  const capP = story.kind === 'site' ? win.nameIn(frame) : win.kickerIn(frame);
  const sub = win.subIn(frame);
  const src = win.sourceIn(frame);
  const product = story.kind === 'product';
  const x = product && story.wide ? 1010 : G.M;
  const top = product ? (story.wide ? 200 : 280 + fits.img + 110) : G.top;
  const bottom = product ? (story.wide ? 940 : 1440) : G.bottom;
  const colW = product ? (story.wide ? 780 : 870) : G.textW;
  const subH = fits.sub || story.source ? 64 + linesH(fits.sub, 1.3) + (story.source ? 50 : 0) : 0;
  return (
    <>
      {story.kind === 'site' ? (
        <div style={{ position: 'absolute', left: story.wide ? colX(G, 4) + 40 : G.M, top: story.wide ? 330 : G.capY - G.COL - 30, opacity: clamp01(win.logoIn(frame) * 2), transform: `translateY(${(1 - E(clamp01(win.logoIn(frame)))) * 40}px)` }}>
          <LogoTile brand={story.brand} size={story.wide ? 420 : Math.min(136, G.COL)} pal={pal} />
        </div>
      ) : null}
      {!product || !story.wide ? <Caption G={G} y={product ? 280 + fits.img + 80 : G.capY} p={ramp(frame, 2, 2 + win.fpb, (t) => t)} label={fits.cap} labelP={capP} index={story.kind === 'site' ? undefined : '00'} /> : <Caption G={{ ...G, M: 1010 }} y={G.capY} p={ramp(frame, 2, 2 + win.fpb, (t) => t)} label={fits.cap} labelP={capP} w={780} />}
      <div style={{ position: 'absolute', left: x, top, width: colW, height: bottom - top, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <RiseWords fit={fits.head} p={tP} color={C.ink} />
        {subH ? (
          <div style={{ position: 'relative', marginTop: 50, width: colW, height: subH }}>
            <Module x={0} y={0} w={colW} h={subH} p={Math.max(sub, src) / 0.95}>
              {fits.sub ? <Lines fit={fits.sub} lineHeight={1.3} style={{ position: 'absolute', left: 32, top: 32, fontWeight: 500, color: C.ink, opacity: sub }} /> : null}
              {story.source ? <div style={{ position: 'absolute', left: 32, bottom: 26, fontFamily: fontMono, fontSize: 26, fontWeight: 600, color: C.mute, opacity: src, whiteSpace: 'nowrap' }}>↗ {story.source}</div> : null}
            </Module>
          </div>
        ) : null}
      </div>
    </>
  );
}

/* ───────────── makale maddeleri ───────────── */

function Points({ win, frame, fits, G }: P) {
  return (
    <>
      {fits.points.map((fp, i) => {
        const [s, e] = win.scene(i);
        if (frame < s - 8 || frame >= e + 2) return null;
        const tP = win.pointTitleIn(i, frame);
        const dP = win.detailIn(i, frame);
        const capP = ramp(frame, s - 5, s - 5 + win.fpb, (t) => t);
        const detH = fp.detail ? 80 + linesH(fp.detail, 1.3) : 0;
        const scan = ramp(frame, win.tl.at(`p${i + 1}.detail`), win.tl.at(`p${i + 1}.detail`) + 2 * win.fpb, (t) => t);
        const last = i === fits.points.length - 1;
        return (
          <Pan key={i} frame={frame} G={G} inP={(f) => win.pointIn(i, f)} out={last ? undefined : (f) => win.pointOut(i, f)}>
            <AbsoluteFill style={{ opacity: last ? 1 - win.pointOut(i, frame) : 1 }}>
              <Caption G={G} y={G.capY} p={capP} index={`${String(i + 1).padStart(2, '0')} / ${String(fits.points.length).padStart(2, '0')}`} />
              <div style={{ position: 'absolute', left: G.M, top: G.top, width: G.textW, height: G.bottom - G.top, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <RiseWords fit={fp.title} p={tP} color={C.ink} />
                {fp.detail ? (
                  <div style={{ position: 'relative', marginTop: 60, width: 936, height: detH }}>
                    <Module x={0} y={0} w={936} h={detH} p={dP / 0.95} border crop={ramp(frame, s + 4, s + 12, E)}>
                      <Lines fit={fp.detail} lineHeight={1.3} style={{ position: 'absolute', left: 40, top: 40, fontWeight: 500, color: C.ink, opacity: clamp01(dP * 1.5) }} />
                      <Scan w={936} h={detH} p={scan} />
                    </Module>
                  </div>
                ) : null}
              </div>
            </AbsoluteFill>
          </Pan>
        );
      })}
    </>
  );
}

/* ───────────── liste ───────────── */

function List({ story, win, frame, fits, G }: P) {
  const [p1s] = win.scene(0);
  if (frame < p1s - 8 || frame >= win.endS + 4) return null;
  const out = win.pointOut(0, frame);
  const wideSite = story.wide && story.kind === 'site';
  const product = story.kind === 'product';
  const x0 = product && story.wide ? 1010 : G.M;
  const w = product && story.wide ? 780 : 936;
  const top = product ? (story.wide ? 200 : 740) : G.top;
  const avail = product ? (story.wide ? 740 : 1440 - 740) : G.bottom - G.top;
  const full = wideSite ? Math.max(...fits.rows.map((r) => r.h)) : fits.rows.reduce((a, r) => a + r.h, 0) + fits.rowGap * (fits.rows.length - 1);
  let y = top + Math.max(0, (avail - full) / 2);
  const capP = ramp(frame, p1s - 5, p1s - 5 + win.fpb, (t) => t);
  return (
    <Pan frame={frame} G={G} inP={(f) => win.pointIn(0, f)}>
      <AbsoluteFill style={{ opacity: 1 - out }}>
        {!product ? <Caption G={G} y={G.capY} p={capP} index={`0${fits.rows.length}`} /> : null}
        {fits.rows.map((r, i) => {
          const [s, e] = win.scene(i);
          const rowTop = y;
          y += r.h + fits.rowGap;
          if (frame < s - 6) return null;
          const inP = win.pointIn(i, frame);
          const det = win.detailIn(i, frame);
          const active = frame < e || i === fits.rows.length - 1;
          const pos = wideSite ? { x: colX(G, i * 2), y: 200 + Math.max(0, (720 - full) / 2), w: 2 * G.COL + G.GUT, h: full } : { x: x0, y: rowTop, w, h: r.h };
          const scan = ramp(frame, s, s + 2 * win.fpb, (t) => t);
          return (
            <Module key={i} x={pos.x} y={pos.y} w={pos.w} h={pos.h} p={inP / 0.95} border={active && frame < e} crop={active && frame < e ? ramp(frame, s + 2, s + 10, E) : 0}>
              <div style={{ position: 'absolute', left: 32, top: 30, right: wideSite ? 32 : 110 }}>
                <Lines fit={r.title} lineHeight={1.06} style={{ fontFamily: fontInter, fontWeight: 800, letterSpacing: '-0.01em', color: C.ink }} />
                {r.detail ? <Lines fit={r.detail} lineHeight={1.3} style={{ marginTop: 16, fontWeight: 500, color: '#3c3b38', opacity: clamp01(det * 1.5) }} /> : null}
              </div>
              <div style={{ position: 'absolute', right: 28, top: wideSite ? undefined : 30, bottom: wideSite ? 24 : undefined, fontWeight: 500, fontSize: 28, color: C.mute }}>{String(i + 1).padStart(2, '0')}</div>
              {frame < e ? <Scan w={pos.w} h={pos.h} p={scan} /> : null}
            </Module>
          );
        })}
      </AbsoluteFill>
    </Pan>
  );
}

/* ───────────── urun modulu ───────────── */

function ProductModule({ story, pal, win, frame, fits, G }: P) {
  const inP = win.logoIn(frame);
  const shrink = ramp(frame, win.hookE - 8, win.hookE + 4, E);
  const endP = ramp(frame, win.endS - 6, win.endS + 6, E);
  let x: number;
  let y: number;
  let size: number;
  if (story.wide) {
    size = 760 - 120 * endP;
    x = G.M + 40;
    y = 200 + (760 - size) / 2;
  } else {
    size = fits.img + (400 - fits.img) * shrink + 20 * endP;
    x = G.M;
    y = 280 + 20 * endP;
  }
  const priceP = win.priceIn(frame);
  const q = E(clamp01(inP / 0.95));
  return (
    <>
      <div style={{ position: 'absolute', left: x, top: y, width: size, height: size, clipPath: `inset(${(1 - q) * 100}% 0 0 0)`, background: story.image ? C.paper : pal.primary, boxShadow: `inset 0 0 0 1.5px ${C.grey}` }}>
        <ProductImage src={story.image} frame={frame} total={win.total} fallback={<LogoTile brand={story.brand} size={size * 0.4} pal={pal} />} />
        {story.image ? (
          <div style={{ position: 'absolute', left: 0, bottom: 0 }}>
            <LogoTile brand={story.brand} size={Math.round(size * 0.16)} pal={pal} />
          </div>
        ) : null}
      </div>
      <CropMarks x={x - 12} y={y - 12} w={size + 24} h={size + 24} p={ramp(frame, 6, 18, E)} />
      {story.price && fits.price ? (
        <div style={{ position: 'absolute', left: story.wide ? x + 24 : x + size - 20, top: story.wide ? y + 24 : y + 30, overflow: 'hidden' }}>
          <div style={{ padding: `${fits.price.size * 0.28}px ${fits.price.size * 0.5}px`, background: pal.primary, color: pal.onPrimary, clipPath: `inset(0 ${(1 - E(clamp01(priceP / 0.95))) * 100}% 0 0)` }}>
            <Lines fit={fits.price} lineHeight={1.1} style={{ fontFamily: fontInter, fontWeight: 800 }} />
          </div>
        </div>
      ) : null}
    </>
  );
}

/* ───────────── bicak cizgileri (sahne kesmesinden hemen once) ───────────── */

function Knives({ win, frame, G }: { win: Win; frame: number; G: Geo }) {
  const cuts = [win.hookE, win.scene(0)[1], win.scene(1)[1]];
  return (
    <>
      {cuts.map((c, i) => {
        const p = ramp(frame, c - 10, c - 4, (t) => t);
        if (p <= 0 || frame > c) return null;
        return <div key={i} style={{ position: 'absolute', left: 0, top: G.H * 0.5, width: G.W * p, height: 3, background: C.ink }} />;
      })}
    </>
  );
}

/* ───────────── ust satir ───────────── */

function Header({ story, pal, win, frame, fits, G }: P) {
  if (!story.header || frame >= win.endS + 4) return null;
  const p = win.headerIn(frame);
  if (p <= 0.001) return null;
  const out = win.headerOut(frame);
  const product = story.kind === 'product';
  const q = E(clamp01(p / 0.95));
  return (
    <div style={{ position: 'absolute', left: product ? 1010 : G.M, top: story.wide ? 40 : 220, display: 'flex', alignItems: 'center', gap: 18, opacity: 1 - out, clipPath: `inset(0 ${(1 - q) * 100}% 0 0)` }}>
      {!product ? <LogoTile brand={story.brand} size={story.wide ? 56 : 64} pal={pal} /> : null}
      <span style={{ fontWeight: 700, fontSize: fits.header.size, whiteSpace: 'nowrap' }}>{fits.header.lines[0]}</span>
    </div>
  );
}

/* ───────────── sinyal modulu ───────────── */

function SignalModule({ story, win, frame, G, sig }: { story: Story; pal: BrandPalette; win: Win; frame: number; G: Geo; sig: string }) {
  if (frame >= win.endS + 4) return null;
  const S = Math.round(G.COL * (story.wide ? 0.5 : 0.62));
  // izgara hucreleri: kanca -> madde 1 -> 2 -> 3, her kesmede kesin egriyle yeni hucreye oturur
  const cells = story.wide
    ? [[5, 0.08], [5, 0.86], [4, 0.86], [5, 0.86]]
    : [[5, 0.11], [5, 0.11], [4, 0.11], [5, 0.11]];
  const cutAt = [0, win.scene(0)[0], win.scene(1)[0], win.scene(2)[0]];
  let cx = colX(G, cells[0][0]) + G.COL - S;
  let cy = G.H * cells[0][1];
  for (let i = 1; i < cells.length; i++) {
    const p = E(ramp(frame, cutAt[i] - 6, cutAt[i] + 2, (t) => t));
    cx += (colX(G, cells[i][0]) + G.COL - S - cx) * p;
    cy += (G.H * cells[i][1] - cy) * p;
  }
  // giris: sagdan silinerek
  const inP = ramp(frame, 6, 6 + win.fpb, (t) => t);
  // kapanis: tum ekrani kaplar (urunde kaplamaz: gorsel karti ve fiyat kapanisa dek gorunur — okunurluk)
  const k = story.kind === 'product' ? 0 : E(ramp(frame, win.endS - 6, win.endS, (t) => t));
  const x = cx + (0 - cx) * k;
  const y = cy + (0 - cy) * k;
  const w = S + (G.W - S) * k;
  const h = S + (G.H - S) * k;
  return <div style={{ position: 'absolute', left: x, top: y, width: w, height: h, background: sig, clipPath: `inset(0 0 0 ${(1 - inP) * 100}%)` }} />;
}

/* ───────────── kapanis: tam ekran sinyal -> logo karosu ───────────── */

function End({ story, pal, win, frame, fits, G }: P) {
  const s = win.endS;
  if (frame < s) return null;
  const product = story.kind === 'product';
  const k = E(ramp(frame, s, s + win.fpb, (t) => t));
  const TS = story.wide ? 200 : 232;
  const T0 = story.wide ? { x: G.M, y: 230 } : { x: G.M, y: 520 };
  const x = 0 + (T0.x - 0) * k;
  const y = 0 + (T0.y - 0) * k;
  const w = G.W + (TS - G.W) * k;
  const h = G.H + (TS - G.H) * k;
  const nm = win.endNameIn(frame);
  const lab = win.labelIn(frame);
  const cta = win.ctaIn(frame);
  const mark = win.markIn(frame);
  const textX = product && story.wide ? 1010 : G.M;
  const textTop = product ? (story.wide ? 300 : 800) : story.wide ? 520 : 860;
  const ruleP = ramp(frame, s + 4, s + 4 + win.fpb, (t) => t);
  const play = ramp(frame, win.tl.at('end.url'), win.total, (t) => t);
  const bar = ramp(frame, win.tl.at('end.cta') - 6, win.tl.at('end.cta') + 2, (t) => t);
  return (
    <AbsoluteFill>
      {!product ? (
        <>
          <div style={{ position: 'absolute', left: x, top: y, width: w, height: h, background: k < 1 ? pal.primary : `linear-gradient(135deg, ${pal.primary}, ${pal.primaryDeep})` }} />
          {k >= 1 ? (
            <div style={{ position: 'absolute', left: T0.x + TS * 0.14, top: T0.y + TS * 0.14, transform: `scale(${E(clamp01(win.endTileIn(frame)))})`, transformOrigin: 'center' }}>
              <LogoTile brand={story.brand} size={TS * 0.72} pal={pal} />
            </div>
          ) : null}
        </>
      ) : null}
      <div style={{ position: 'absolute', left: textX, top: textTop - 60, width: (product && story.wide ? 780 : G.W - 2 * G.M) * ruleP, height: 2, background: C.ink }} />
      <div style={{ position: 'absolute', left: textX, top: textTop, width: product && story.wide ? 780 : G.textW }}>
        <RiseWords fit={fits.endName} p={nm} color={C.ink} lh={1.02} />
        <div style={{ marginTop: 40, overflow: 'hidden', height: fits.label.size * 1.3 }}>
          <div style={{ transform: `translateY(${(1 - E(clamp01(lab))) * 1.1}em)`, fontSize: fits.label.size }}>
            <Lines fit={fits.label} lineHeight={1.2} style={{ fontWeight: 500, color: C.mute }} />
          </div>
        </div>
        <div style={{ position: 'relative', marginTop: 24, display: 'inline-block' }}>
          <div style={{ position: 'absolute', inset: 0, background: pal.primary, clipPath: `inset(0 ${(1 - bar) * 100}% 0 0)` }} />
          <div style={{ position: 'relative', padding: `${fits.domain.size * 0.36}px ${fits.domain.size * 0.55}px`, overflow: 'hidden' }}>
            <div style={{ transform: `translateY(${(1 - E(clamp01(cta / 0.95))) * 1.2}em)`, fontSize: fits.domain.size }}>
              <Lines fit={fits.domain} lineHeight={1.15} style={{ fontWeight: 700, color: pal.onPrimary, letterSpacing: '-0.01em' }} />
            </div>
          </div>
        </div>
      </div>
      {!story.wide ? (
        <>
          <div style={{ position: 'absolute', left: G.M, top: 1600, width: G.W - 2 * G.M, height: 2, background: C.grid }} />
          <div style={{ position: 'absolute', left: G.M, top: 1600, width: (G.W - 2 * G.M) * play, height: 2, background: C.ink }} />
        </>
      ) : null}
      {story.watermark ? <WatermarkLine top={G.wmTop - (story.wide ? 0 : 12)} color={C.mute} opacity={0.85 * mark} size={story.wide ? 22 : 26} /> : null}
    </AbsoluteFill>
  );
}

