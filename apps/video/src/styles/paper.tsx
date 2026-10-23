import React, { useMemo } from 'react';
import { AbsoluteFill, interpolate } from 'remotion';
import { clamp01, ramp } from '../marketing/kit';
import { fitText, type Fit } from '../article-short/fit';
import { contrast, mix, rgba, type BrandPalette } from '../article-short/palette';
import { LogoTile, upperTr } from '../article-short/ArticleShort';
import { WatermarkLine } from '../promo/shared';
import type { KitProps } from './StyledVideo';
import type { Story, Win } from './story';
import { fontAnton, fontCaveat, fontJakarta, fontSora } from './fonts';
import { DrawPath, EASE, KineticText, Lines, ProductImage, fitK, linesH, measureWidth, splitLast, type FitBase } from './kit';

/**
 * KAGIT — HyperFrames denemesi 1'in (ranksup1/index.html, Apache-2.0 araci; kompozisyon bizim) teknigi:
 *   - kagit zemin, dar ve buyuk kinetik yazi (Anton, BUYUK HARF tr-TR); kelimeler "carparak" iner
 *     (yukaridan, enine genis / boyuna basik -> yerine, geri tepen egri)
 *   - elle cizilmis isaretci notlari: son kelimenin alti, aciklamanin etrafinda halka, onay isareti, ok
 *     (SVG stroke-dashoffset; marka renginde)
 *   - sert acik / koyu sahne donusleri (gecis yok, kesme), her sahnede yavas sahne yakinlasmasi
 *   - marka renginde top: kancada sekerek iner, kapanista buyuyup logonun zemini olur
 * Renkler musterinin: isaretci ve vurgu marka rengi (acik zeminde >= 4,5:1, koyu zeminde >= 3:1'e
 * ayarlanir). El yazisi (Caveat) yalniz kisa satirlarda (ust etiket, kaynak, CTA metni).
 */

const PAPER = '#f6f4ef';
const INK = '#1d1d1f';
const CHAR = '#1f1d1c';

const F_KIN: FitBase = { family: fontAnton, weight: 400, letterSpacing: 0.005 };
const F_BODY: FitBase = { family: fontJakarta, weight: 600, letterSpacing: -0.01 };
const F_HAND: FitBase = { family: fontCaveat, weight: 700, letterSpacing: 0 };
const LH = 1.17;
/** sahne yakinlasmasi (%3,5) + el yazisi satir payi: bant hesabinda birakilan bosluk */
const SAFETY = 80;

type Geo = { W: number; H: number; x: number; w: number; top: number; bottom: number; wmTop: number; wmSize: number };
const TALL: Geo = { W: 1080, H: 1920, x: 90, w: 880, top: 400, bottom: 1430, wmTop: 1452, wmSize: 24 };
const WIDE: Geo = { W: 1920, H: 1080, x: 140, w: 1640, top: 150, bottom: 960, wmTop: 1010, wmSize: 22 };

type Row = { title: Fit; detail: Fit | null; h: number };
type Fits = {
  kicker: Fit | null;
  head: Fit;
  name: Fit | null;
  sub: Fit | null;
  source: Fit | null;
  header: Fit;
  points: Array<{ title: Fit; detail: Fit | null }>;
  rows: Row[];
  rowGap: number;
  endName: Fit;
  label: Fit;
  domain: Fit;
  price: Fit | null;
  img: number;
};

/** Koyu zeminde (CHAR) okunur vurgu: marka rengi aciklastirilir (>= 3:1, buyuk yazi / cizgi) */
function accentOnDark(pal: BrandPalette) {
  let c = pal.primary;
  for (let i = 0; i < 14 && contrast(c, CHAR) < 3.2; i++) c = mix(c, '#ffffff', 0.12);
  return c;
}

function computeFits(story: Story, G: Geo): Fits {
  const wide = story.wide;
  const colW = story.kind === 'product' ? (wide ? 820 : 880) : wide ? 1000 : 880;
  const up = (s: string) => upperTr(s);
  let head!: Fit;
  let name: Fit | null = null;
  let sub: Fit | null = null;
  let img = 0;
  const kicker = story.kicker ? fitText(story.kicker, { ...F_HAND, maxWidth: colW, maxLines: 1, maxSize: 64, minSize: 40 }) : null;
  const source = story.source ? fitText(story.source, { family: fontJakarta, weight: 700, letterSpacing: 0, maxWidth: colW, maxLines: 1, maxSize: 30, minSize: 22 }) : null;
  for (let k = 1; k >= 0.5; k -= 0.05) {
    if (story.kind === 'product') {
      head = fitK(up(story.hook), F_KIN, k, { maxWidth: colW, maxLines: wide ? 4 : 4, maxSize: wide ? 120 : 132, minSize: 64 });
      sub = story.hookSub ? fitK(story.hookSub, F_BODY, k, { maxWidth: colW, maxLines: 3, maxSize: wide ? 40 : 46, minSize: 30 }) : null;
      const textH = (kicker ? 80 : 0) + linesH(head, LH) + (sub ? 30 + linesH(sub, 1.3) : 0);
      if (wide) {
        img = 700;
        if (textH <= 760) break;
      } else {
        img = Math.round(Math.min(600, 1440 - 280 - 70 - textH));
        if (img >= 400) break;
        img = Math.max(380, img);
      }
    } else if (story.kind === 'site') {
      name = fitK(story.brand.name, { family: fontSora, weight: 800, letterSpacing: -0.035 }, Math.max(0.8, k), { maxWidth: wide ? 900 : 760, maxLines: 2, maxSize: wide ? 60 : 64, minSize: 40 });
      head = fitK(up(story.hook), F_KIN, k, { maxWidth: colW, maxLines: wide ? 3 : 6, maxSize: wide ? 150 : 190, minSize: 90 });
      sub = story.hookSub ? fitK(story.hookSub, F_BODY, Math.max(0.85, k), { maxWidth: colW, maxLines: 3, maxSize: wide ? 40 : 48, minSize: wide ? 32 : 40 }) : null;
      const h = Math.max(110, linesH(name, 1.1)) + 50 + linesH(head, LH) + (sub ? 40 + linesH(sub, 1.3) : 0);
      if (h <= G.bottom - G.top - SAFETY) break;
    } else {
      head = fitK(up(story.hook), F_KIN, k, { maxWidth: colW, maxLines: 7, maxSize: 196, minSize: 96 });
      sub = story.hookSub ? fitK(story.hookSub, F_BODY, Math.max(0.85, k), { maxWidth: colW, maxLines: 4, maxSize: 50, minSize: 42 }) : null;
      const h = (kicker ? 90 : 0) + linesH(head, LH) + (sub ? 44 + linesH(sub, 1.3) : 0) + (source ? 66 : 0);
      if (h <= G.bottom - G.top - SAFETY) break;
    }
  }
  const points = story.kind === 'article'
    ? story.points.map((p) => {
      let title!: Fit;
      let detail: Fit | null = null;
      for (let k = 1; k >= 0.5; k -= 0.05) {
        title = fitK(up(p.title), F_KIN, k, { maxWidth: 880, maxLines: 6, maxSize: 170, minSize: 90 });
        detail = p.detail ? fitK(p.detail, F_BODY, Math.max(0.85, k), { maxWidth: 800, maxLines: 4, maxSize: 50, minSize: 42 }) : null;
        if (150 + linesH(title, LH) + (detail ? 90 + linesH(detail, 1.32) : 0) <= G.bottom - G.top - SAFETY) break;
      }
      return { title, detail };
    })
    : [];
  let rows: Row[] = [];
  let rowGap = 0;
  if (story.list) {
    const wideSite = wide && story.kind === 'site';
    const textW = wideSite ? 440 : story.kind === 'product' ? (wide ? 820 - 90 : 880 - 90) : 880 - 90;
    const avail = wideSite ? 640 : story.kind === 'product' ? (wide ? 700 : 1440 - 740) : G.bottom - G.top - 40;
    for (let k = 1; k >= 0.5; k -= 0.05) {
      rows = story.points.map((p) => {
        const title = fitK(up(p.title), F_KIN, k, { maxWidth: textW, maxLines: wideSite ? 4 : 3, maxSize: wideSite ? 72 : 84, minSize: 44 });
        const detail = p.detail ? fitK(p.detail, F_BODY, k, { maxWidth: textW, maxLines: wideSite ? 5 : 3, maxSize: 38, minSize: 26 }) : null;
        return { title, detail, h: Math.round(linesH(title, LH) + (detail ? 14 + linesH(detail, 1.3) : 0) + 30) };
      });
      rowGap = Math.round(36 * k);
      const total = wideSite ? Math.max(...rows.map((r) => r.h)) : rows.reduce((a, r) => a + r.h, 0) + rowGap * (rows.length - 1);
      if (total <= avail) break;
    }
  }
  const endW = wide ? (story.kind === 'product' ? 820 : 1400) : 880;
  return {
    kicker,
    head,
    name,
    sub,
    source,
    header: fitText(story.header || story.brand.name, { family: fontJakarta, weight: 800, letterSpacing: -0.01, maxWidth: story.kind === 'product' ? 800 : 760, maxLines: 1, maxSize: 40, minSize: 22 }),
    points,
    rows,
    rowGap,
    endName: fitText(story.endName, { family: fontSora, weight: 800, letterSpacing: -0.03, maxWidth: endW, maxLines: 2, maxSize: wide ? 100 : 112, minSize: 56 }),
    label: fitText(story.cta.label, { ...F_HAND, maxWidth: endW, maxLines: 1, maxSize: wide ? 64 : 72, minSize: 40 }),
    domain: fitText(story.cta.domain, { family: fontSora, weight: 700, letterSpacing: -0.02, maxWidth: wide && story.kind === 'product' ? 560 : 680, maxLines: 1, maxSize: 58, minSize: 24 }),
    price: story.price ? fitText(story.price, { ...F_KIN, maxWidth: 420, maxLines: 1, maxSize: 96, minSize: 48 }) : null,
    img,
  };
}

export function PaperStyle({ story, pal, win, frame }: KitProps) {
  const G = story.wide ? WIDE : TALL;
  const fits = useMemo(() => computeFits(story, G), [story, G]);
  const dark = sceneDark(story, win, frame);
  const acc = dark ? accentOnDark(pal) : pal.accentText;
  return (
    <AbsoluteFill style={{ background: dark ? CHAR : PAPER, color: dark ? '#ffffff' : INK, fontFamily: fontJakarta }}>
      <Grain dark={dark} />
      <Stage frame={frame} win={win}>
        {story.kind === 'product' ? <Polaroid story={story} pal={pal} win={win} frame={frame} fits={fits} acc={acc} /> : null}
        <Hook story={story} pal={pal} win={win} frame={frame} fits={fits} G={G} acc={acc} />
        {story.list ? <List story={story} pal={pal} win={win} frame={frame} fits={fits} G={G} acc={acc} /> : <Points story={story} pal={pal} win={win} frame={frame} fits={fits} G={G} acc={acc} />}
        <Header story={story} pal={pal} win={win} frame={frame} fits={fits} G={G} acc={acc} dark={dark} />
      </Stage>
      <Ball pal={pal} win={win} frame={frame} G={G} story={story} />
      {story.watermark && frame < win.endS + 2 ? <WatermarkLine top={G.wmTop} color={dark ? rgba('#ffffff', 0.6) : '#6e6e73'} opacity={0.8 * win.wm(frame)} size={G.wmSize} /> : null}
      <End story={story} pal={pal} win={win} frame={frame} fits={fits} G={G} acc={pal.accentText} />
    </AbsoluteFill>
  );
}

type P = { story: Story; pal: BrandPalette; win: Win; frame: number; fits: Fits; G: Geo; acc: string };

/**
 * Sahne zemini: kanca acik, makale maddeleri koyu / acik / koyu, liste koyu, kapanis acik. Donus sert
 * kesme (sahne siniri vurusta). Urun tanitiminda gorsel karti tum video gorundugu icin liste acik kalir.
 */
function sceneDark(story: Story, win: Win, frame: number) {
  if (frame >= win.endS) return false;
  if (story.kind === 'product') return false;
  for (let i = story.points.length - 1; i >= 0; i--) {
    if (frame >= win.scene(i)[0]) return story.list ? true : i % 2 === 0;
  }
  return false;
}

/** Kagit dokusu: cok hafif deterministik nokta deseni */
function Grain({ dark }: { dark: boolean }) {
  return (
    <AbsoluteFill
      style={{
        backgroundImage: `radial-gradient(${rgba(dark ? '#ffffff' : '#000000', dark ? 0.035 : 0.03)} 1px, transparent 1.4px), radial-gradient(${rgba(dark ? '#ffffff' : '#000000', 0.02)} 1px, transparent 1.4px)`,
        backgroundSize: '9px 9px, 13px 13px',
        backgroundPosition: '0 0, 4px 6px',
      }}
    />
  );
}

/** Her sahnede yavas yakinlasma (sahne basinda 1'e doner — sert kesmeyle ayni anda) */
function Stage({ frame, win, children }: { frame: number; win: Win; children: React.ReactNode }) {
  const cuts = [0, win.hookE, ...[0, 1, 2].map((i) => win.scene(i)[1]), win.total];
  let a = 0;
  let b = win.total;
  for (let i = 0; i < cuts.length - 1; i++) if (frame >= cuts[i] && frame < cuts[i + 1]) [a, b] = [cuts[i], cuts[i + 1]];
  const z = 1 + 0.035 * clamp01((frame - a) / Math.max(1, b - a));
  return <AbsoluteFill style={{ transform: `scale(${z})`, transformOrigin: '50% 42%' }}>{children}</AbsoluteFill>;
}

/** "Carpma" girisi: yukaridan, enine genis / boyuna basik -> yerine (geri tepen egri) */
const slam = (wp: number): React.CSSProperties => {
  const e = EASE.overshoot(clamp01(wp));
  return {
    opacity: clamp01(wp * 2.2),
    transform: `translateY(${(1 - e) * -60}px) scale(${1.12 - 0.12 * e}, ${0.78 + 0.22 * e})`,
    transformOrigin: '50% 100%',
  };
};

/** Elle cizilmis alt cizgi (son kelime) */
function Underline({ w, size, p, color }: { w: number; size: number; p: number; color: string }) {
  return <DrawPath d="M6 22 C 120 14, 240 30, 360 20 S 540 16, 594 24" p={p} color={color} width={9} viewBox="0 0 600 36" w={w + 12} h={size * 0.2} style={{ left: -6, bottom: -size * 0.1 }} />;
}

function KinText({ fit, p, color, acc, frame, ulAt, align = 'left', style }: { fit: Fit; p: number; color: string; acc: string; frame: number; ulAt: number; align?: 'left' | 'center'; style?: React.CSSProperties }) {
  const ul = ramp(frame, ulAt, ulAt + 11, EASE.smooth);
  return (
    <KineticText
      fit={fit}
      p={p}
      lineHeight={LH}
      align={align}
      spread={0.6}
      style={{ fontFamily: fontAnton, fontWeight: 400, letterSpacing: '0.005em', color, ...style }}
      wordStyle={(wp) => slam(wp)}
      last={(w) => {
        const [core, punct] = splitLast(w);
        return (
          <>
            <span style={{ position: 'relative', color: acc }}>
              {core}
              <Underline w={measureWidth(core, { family: fontAnton, weight: 400, size: fit.size, letterSpacing: 0.005 })} size={fit.size} p={ul} color={acc} />
            </span>
            {punct}
          </>
        );
      }}
    />
  );
}

/* ───────────── kanca ───────────── */

function Hook({ story, pal, win, frame, fits, G, acc }: P) {
  // Sert kesme: kanca sahnesi bitiste yok olur (cikis penceresi kullanilmaz — metin daha UZUN gorunur)
  if (frame >= win.hookE) return null;
  const tP = win.titleIn(frame);
  const ulAt = win.tl.at('hook.title') + Math.round(win.fpb);
  const sub = win.subIn(frame);
  const kick = win.kickerIn(frame);
  const src = win.sourceIn(frame);
  const kicker = fits.kicker ? (
    <div style={{ position: 'relative', alignSelf: 'flex-start', marginBottom: 18, transform: `rotate(-3deg) translateY(${(1 - Math.min(1, kick)) * 20}px)`, opacity: clamp01(kick * 1.6) }}>
      <Lines fit={fits.kicker} lineHeight={1.1} style={{ fontFamily: fontCaveat, fontWeight: 700, color: acc }} />
    </div>
  ) : null;
  if (story.kind === 'site') {
    const logo = win.logoIn(frame);
    const nm = win.nameIn(frame);
    return (
      <div style={{ position: 'absolute', left: G.x, top: G.top, width: story.wide ? 1100 : 880, height: G.bottom - G.top, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 26 }}>
          <div style={{ transform: `scale(${0.4 + 0.6 * Math.min(1.1, logo)}) rotate(${(1 - Math.min(1, logo)) * -12 - 3}deg)`, opacity: clamp01(logo * 1.6) }}>
            <LogoTile brand={story.brand} size={110} pal={pal} />
          </div>
          <Lines fit={fits.name!} lineHeight={1.1} style={{ fontFamily: fontSora, fontWeight: 800, letterSpacing: '-0.035em', opacity: clamp01(nm * 1.5), transform: `translateY(${(1 - nm) * 24}px)` }} />
        </div>
        <KinText fit={fits.head} p={tP} color={INK} acc={acc} frame={frame} ulAt={ulAt} style={{ marginTop: 50 }} />
        {fits.sub ? <Lines fit={fits.sub} lineHeight={1.3} style={{ marginTop: 40, fontWeight: 600, color: '#4a4a4f', opacity: sub, transform: `translateY(${(1 - sub) * 20}px)` }} /> : null}
      </div>
    );
  }
  const box: React.CSSProperties = story.kind === 'product'
    ? story.wide
      ? { left: 960, width: 820, top: 150, height: 800 }
      : { left: G.x, width: 880, top: 280 + fits.img + 70, height: 1440 - (280 + fits.img + 70) }
    : { left: G.x, width: 880, top: G.top, height: G.bottom - G.top };
  return (
    <div style={{ position: 'absolute', ...box, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      {kicker}
      <KinText fit={fits.head} p={tP} color={INK} acc={acc} frame={frame} ulAt={ulAt} />
      {fits.sub ? <Lines fit={fits.sub} lineHeight={1.3} style={{ marginTop: 34, fontWeight: 600, color: '#4a4a4f', opacity: sub, transform: `translateY(${(1 - sub) * 20}px)` }} /> : null}
      {fits.source ? (
        <div style={{ marginTop: 30, display: 'flex', alignItems: 'center', gap: 14, opacity: src }}>
          <svg width={54} height={28} viewBox="0 0 54 28" aria-hidden>
            <path d="M2 16 C 14 8, 30 22, 46 12 M38 6 L48 12 L40 20" fill="none" stroke={acc} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <Lines fit={fits.source} lineHeight={1.2} style={{ fontWeight: 700, color: '#6e6e73' }} />
        </div>
      ) : null}
    </div>
  );
}

/* ───────────── makale maddeleri: koyu / acik donusumlu ───────────── */

function Points({ win, frame, fits, G, acc }: P) {
  return (
    <>
      {fits.points.map((fp, i) => {
        const [s, e] = win.scene(i);
        if (frame < s - 6 || frame >= e) return null;
        const dark = i % 2 === 0;
        const tP = win.pointTitleIn(i, frame);
        const dP = win.detailIn(i, frame);
        const num = win.pointIn(i, frame);
        const ring = ramp(frame, win.tl.at(`p${i + 1}.detail`) + 8, win.tl.at(`p${i + 1}.detail`) + 24, EASE.smooth);
        const color = dark ? '#ffffff' : INK;
        // Bir onceki sahne hala ekrandayken (s-6..s) yeni sahne cizilmez: sert kesme
        if (frame < s) return null;
        return (
          <div key={i} style={{ position: 'absolute', left: G.x, top: G.top, width: 880, height: G.bottom - G.top, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div style={{ fontFamily: fontCaveat, fontWeight: 700, fontSize: 96, lineHeight: 1, color: acc, transform: `rotate(-4deg) scale(${0.7 + 0.3 * Math.min(1, num)})`, transformOrigin: 'left bottom', opacity: clamp01(num * 1.5) }}>
              {String(i + 1).padStart(2, '0')}
            </div>
            <KinText fit={fp.title} p={tP} color={color} acc={acc} frame={frame} ulAt={win.tl.at(`p${i + 1}.title`) + Math.round(win.fpb)} style={{ marginTop: 26 }} />
            {fp.detail ? (
              <div style={{ position: 'relative', marginTop: 56, padding: '26px 36px', alignSelf: 'flex-start' }}>
                <Lines fit={fp.detail} lineHeight={1.32} style={{ fontWeight: 600, color: dark ? rgba('#ffffff', 0.88) : '#3a3a3f', opacity: clamp01(dP * 1.5), transform: `translateY(${(1 - Math.min(1, dP)) * 24}px)` }} />
                <DrawPath
                  d="M40 8 C 300 -6, 760 0, 792 40 C 820 92, 600 104, 420 102 C 200 100, 10 98, 6 54 C 2 20, 60 8, 140 6"
                  p={ring}
                  color={acc}
                  width={5}
                  viewBox="0 0 800 104"
                  w={Math.max(...fp.detail.lines.map((l) => measureWidth(l, { family: fontJakarta, weight: 600, size: fp.detail!.size, letterSpacing: -0.01 }))) + 72}
                  h={linesH(fp.detail, 1.32) + 52}
                  style={{ left: 0, top: 0 }}
                />
              </div>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

/* ───────────── liste: isaretci onayli satirlar ───────────── */

function List({ story, win, frame, fits, G, acc }: P) {
  const [p1s] = win.scene(0);
  if (frame < p1s || frame >= win.endS) return null;
  const dark = story.kind !== 'product';
  const color = dark ? '#ffffff' : INK;
  const wideSite = story.wide && story.kind === 'site';
  const x0 = story.kind === 'product' ? (story.wide ? 960 : G.x) : G.x;
  const top = story.kind === 'product' ? (story.wide ? 170 : 740) : G.top;
  const avail = story.kind === 'product' ? (story.wide ? 760 : 1440 - 740) : G.bottom - G.top;
  const full = wideSite ? Math.max(...fits.rows.map((r) => r.h)) : fits.rows.reduce((a, r) => a + r.h, 0) + fits.rowGap * (fits.rows.length - 1);
  let y = top + Math.max(0, (avail - full) / 2);
  return (
    <>
      {fits.rows.map((r, i) => {
        const [s] = win.scene(i);
        const rowTop = y;
        y += r.h + fits.rowGap;
        if (frame < s - 6) return null;
        const inP = win.pointIn(i, frame);
        const det = win.detailIn(i, frame);
        const chk = ramp(frame, s + 4, s + 16, EASE.smooth);
        const pos: React.CSSProperties = wideSite ? { left: G.x + i * 560, top: 300, width: 500 } : { left: x0, top: rowTop, width: story.wide ? 820 : 880 };
        return (
          <div key={i} style={{ position: 'absolute', ...pos, display: 'flex', flexDirection: wideSite ? 'column' : 'row', gap: wideSite ? 18 : 26 }}>
            <svg width={64} height={64} viewBox="0 0 130 130" style={{ flexShrink: 0, marginTop: 8, overflow: 'visible' }} aria-hidden>
              <path d="M8 70 L 48 112 L 122 12" fill="none" stroke={acc} strokeWidth={14} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - chk} />
            </svg>
            <div style={{ minWidth: 0 }}>
              <KineticText fit={r.title} p={inP} lineHeight={LH} spread={0.5} style={{ fontFamily: fontAnton, color }} wordStyle={(wp) => slam(wp)} />
              {r.detail ? <Lines fit={r.detail} lineHeight={1.3} style={{ marginTop: 14, fontWeight: 600, color: dark ? rgba('#ffffff', 0.84) : '#3a3a3f', opacity: clamp01(det * 1.5) }} /> : null}
            </div>
          </div>
        );
      })}
      {/* dekor: koyu sahnede marka renginde ince cerceve kosesi */}
      {dark ? <div style={{ position: 'absolute', left: G.x - 30, top: G.top - 30, width: 120, height: 120, borderLeft: `6px solid ${acc}`, borderTop: `6px solid ${acc}`, opacity: 0.6 * ramp(frame, p1s, p1s + 10), borderTopLeftRadius: 8 }} /> : null}
    </>
  );
}

/* ───────────── urun: bantli polaroid ───────────── */

function Polaroid({ story, pal, win, frame, fits, acc }: Omit<P, 'G'>) {
  const inP = win.logoIn(frame);
  const shrink = ramp(frame, win.hookE - 2, win.hookE + 6, EASE.smooth);
  const endP = ramp(frame, win.endS - 2, win.endS + 8, EASE.smooth);
  let size: number;
  let x: number;
  let y: number;
  if (story.wide) {
    size = 700 - 80 * endP;
    x = 140 + (700 - size) / 2;
    y = 170 + (700 - size) / 2;
  } else {
    size = interpolate(shrink, [0, 1], [fits.img, 400]) + 20 * endP;
    x = (1080 - size) / 2;
    y = 280 + 20 * endP;
  }
  const e = EASE.overshoot(clamp01(inP));
  const priceP = win.priceIn(frame);
  const circle = ramp(frame, win.tl.at('hook.price') + 6, win.tl.at('hook.price') + 20, EASE.smooth);
  const pad = size * 0.06;
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: size, height: size * 1.12, opacity: clamp01(inP * 2), transform: `translateY(${(1 - e) * -80}px) rotate(${-2.5 + (1 - e) * 6}deg)` }}>
      <div style={{ position: 'absolute', inset: 0, background: '#ffffff', boxShadow: `0 ${size * 0.03}px ${size * 0.08}px ${rgba('#000000', 0.18)}`, borderRadius: 6 }} />
      <div style={{ position: 'absolute', left: pad, top: pad, width: size - 2 * pad, height: size - 2 * pad, overflow: 'hidden', background: story.image ? '#ffffff' : pal.primary }}>
        <ProductImage src={story.image} frame={frame} total={win.total} pad={0.92} fallback={<LogoTile brand={story.brand} size={size * 0.4} pal={pal} />} />
      </div>
      {/* bant */}
      <div style={{ position: 'absolute', left: -size * 0.04, top: -size * 0.03, width: size * 0.26, height: size * 0.07, background: rgba('#e9dfc6', 0.85), transform: 'rotate(-28deg)' }} />
      <div style={{ position: 'absolute', right: -size * 0.04, top: -size * 0.03, width: size * 0.26, height: size * 0.07, background: rgba('#e9dfc6', 0.85), transform: 'rotate(26deg)' }} />
      {story.image ? (
        <div style={{ position: 'absolute', left: pad, bottom: size * 0.02, transform: 'rotate(2deg)' }}>
          <LogoTile brand={story.brand} size={Math.round(size * 0.14)} pal={pal} />
        </div>
      ) : null}
      {story.price && fits.price ? (
        <div style={{ position: 'absolute', right: -size * 0.12, bottom: size * 0.02, padding: '10px 26px', transform: `rotate(-5deg) scale(${0.6 + 0.4 * Math.min(1.1, priceP)})`, opacity: clamp01(priceP * 1.6) }}>
          <div style={{ position: 'absolute', inset: 0, background: PAPER, borderRadius: 12 }} />
          <Lines fit={fits.price} lineHeight={1.15} style={{ position: 'relative', fontFamily: fontAnton, color: INK }} />
          <DrawPath d="M150 10 C 260 6, 300 40, 290 70 C 280 104, 120 110, 40 96 C -10 86, 0 30, 60 14 C 90 6, 130 6, 170 10" p={circle} color={acc} width={5} viewBox="0 0 300 110" w={measureWidth(fits.price.lines[0], { family: fontAnton, weight: 400, size: fits.price.size }) + 64} h={fits.price.size * 1.4} style={{ left: -6, top: -4 }} />
        </div>
      ) : null}
    </div>
  );
}

/* ───────────── ust satir ───────────── */

function Header({ story, pal, win, frame, fits, G, dark }: P & { dark: boolean }) {
  if (!story.header || frame >= win.endS) return null;
  const p = win.headerIn(frame);
  if (p <= 0.001) return null;
  const isProduct = story.kind === 'product';
  return (
    <div style={{ position: 'absolute', left: isProduct ? 960 : G.x, top: story.wide ? 70 : 262, display: 'flex', alignItems: 'center', gap: 20, opacity: clamp01(p * 1.5), transform: `translateY(${(1 - Math.min(1, p)) * -20}px)` }}>
      {!isProduct ? <LogoTile brand={story.brand} size={story.wide ? 68 : 80} pal={pal} /> : null}
      <span style={{ fontWeight: 800, fontSize: fits.header.size, whiteSpace: 'nowrap', color: dark ? '#ffffff' : INK }}>{fits.header.lines[0]}</span>
    </div>
  );
}

/* ───────────── marka topu ───────────── */

function Ball({ pal, win, frame, G, story }: { pal: BrandPalette; win: Win; frame: number; G: Geo; story: Story }) {
  if (frame >= win.endS + 14) return null;
  const size = 72;
  const home = story.wide ? { x: 1830, y: 1000 } : { x: 900, y: 1560 };
  let x = home.x;
  let y = home.y;
  let scale = 1;
  // kanca: yukaridan sekerek iner
  const drop = clamp01(frame / 32);
  const bounce = (t: number) => {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  };
  y = home.y - (1 - bounce(drop)) * (home.y + 100);
  x = home.x - 40 * (1 - drop);
  // kancanin sonunda sicrayip kesmenin ustunden gecer
  const jump = ramp(frame, win.hookE - 10, win.hookE, EASE.out);
  y -= 520 * jump;
  x += 260 * jump;
  if (frame >= win.hookE) {
    // kesmeden sonra koseden yeniden yerine yuvarlanir
    const back = ramp(frame, win.hookE, win.hookE + 18, EASE.out);
    x = home.x + (G.W + 100 - home.x) * (1 - back);
    y = home.y;
  }
  // kapanis: ortaya kayar, buyur (logonun zemini). Urunde ortada gorsel karti var: top ekrandan cikar
  if (story.kind === 'product') {
    const off = ramp(frame, win.endS - 6, win.endS + 4, EASE.exit);
    return <div style={{ position: 'absolute', left: x - size / 2 + 300 * off, top: y - size / 2, width: size, height: size, borderRadius: 99, background: pal.primary, opacity: 1 - off }} />;
  }
  const toEnd = ramp(frame, win.endS - 6, win.endS + 2, EASE.out);
  const grow = ramp(frame, win.endS + 2, win.endS + 12, EASE.exit);
  const center = story.wide ? { x: 960, y: 250 } : { x: 540, y: 600 };
  x = x + (center.x - x) * toEnd;
  y = y + (center.y - y) * toEnd;
  scale = 1 + 3.2 * grow;
  const fade = 1 - ramp(frame, win.endS + 9, win.endS + 14);
  return <div style={{ position: 'absolute', left: x - size / 2, top: y - size / 2, width: size, height: size, borderRadius: 99, background: pal.primary, boxShadow: `0 10px 24px ${rgba(pal.primaryDeep, 0.3)}`, transform: `scale(${scale})`, opacity: fade }} />;
}

/* ───────────── kapanis ───────────── */

function End({ story, pal, win, frame, fits, G, acc }: P) {
  const s = win.endS;
  if (frame < s) return null;
  const isProduct = story.kind === 'product';
  const tile = win.endTileIn(frame);
  const nm = win.endNameIn(frame);
  const lab = win.labelIn(frame);
  const cta = win.ctaIn(frame);
  const mark = win.markIn(frame);
  const ul = ramp(frame, win.tl.at('end.cta') + 10, win.tl.at('end.cta') + 24, EASE.smooth);
  const box: React.CSSProperties = isProduct
    ? story.wide
      ? { left: 960, width: 820, top: 170, height: 760, alignItems: 'flex-start', textAlign: 'left' }
      : { left: G.x, width: 880, top: 780, height: 620, alignItems: 'center', textAlign: 'center' }
    : story.wide
      ? { left: 140, width: 1640, top: 420, height: 560, alignItems: 'center', textAlign: 'center' }
      : { left: G.x, width: 880, top: 820, height: 620, alignItems: 'center', textAlign: 'center' };
  const align = (box.textAlign as 'left' | 'center') ?? 'center';
  return (
    <AbsoluteFill>
      {!isProduct ? (
        <div style={{ position: 'absolute', left: (story.wide ? 960 : 540) - 110, top: (story.wide ? 250 : 600) - 110, transform: `scale(${0.86 + 0.14 * Math.min(1.1, tile)}) rotate(${(1 - Math.min(1, tile)) * -8}deg)`, opacity: clamp01(tile * 2) }}>
          <LogoTile brand={story.brand} size={220} pal={pal} />
        </div>
      ) : null}
      <div style={{ position: 'absolute', display: 'flex', flexDirection: 'column', ...box }}>
        <Lines fit={fits.endName} lineHeight={1.05} align={align} style={{ fontFamily: fontSora, fontWeight: 800, letterSpacing: '-0.03em', color: INK, opacity: clamp01(nm * 1.5), transform: `translateY(${(1 - Math.min(1, nm)) * 36}px)` }} />
        <div style={{ marginTop: 30, transform: 'rotate(-2deg)', opacity: lab }}>
          <Lines fit={fits.label} lineHeight={1.1} align={align} style={{ fontFamily: fontCaveat, fontWeight: 700, color: acc }} />
        </div>
        <div style={{ position: 'relative', marginTop: 26, display: 'inline-flex', alignItems: 'center', padding: `${fits.domain.size * 0.45}px ${fits.domain.size * 0.8}px`, borderRadius: 999, background: pal.primary, color: pal.onPrimary, fontFamily: fontSora, fontWeight: 700, fontSize: fits.domain.size, whiteSpace: 'nowrap', boxShadow: `0 18px 40px ${rgba(pal.primaryDeep, 0.3)}`, opacity: clamp01(cta * 1.6), transform: `scale(${0.8 + 0.2 * Math.min(1.1, cta)})` }}>
          {fits.domain.lines[0]}
        </div>
        <div style={{ position: 'relative', width: measureWidth(fits.domain.lines[0], { family: fontSora, weight: 700, size: fits.domain.size }) + fits.domain.size * 1.6, height: 30 }}>
          <DrawPath d="M4 18 C 80 10, 200 26, 300 14 S 450 10, 496 18" p={ul} color={acc} width={7} viewBox="0 0 500 30" w={measureWidth(fits.domain.lines[0], { family: fontSora, weight: 700, size: fits.domain.size }) + fits.domain.size * 1.6} h={30} style={{ left: 0, top: 6 }} />
        </div>
      </div>
      {story.watermark ? <WatermarkLine top={G.wmTop - (story.wide ? 0 : 12)} color="#6e6e73" opacity={0.8 * mark} size={story.wide ? 22 : 26} /> : null}
    </AbsoluteFill>
  );
}
