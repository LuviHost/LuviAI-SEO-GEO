import React, { useMemo } from 'react';
import { AbsoluteFill, interpolate } from 'remotion';
import { ArrowUp, ArrowUpRight, Link2 } from 'lucide-react';
import { clamp01, ramp } from '../marketing/kit';
import { fitText, type Fit } from '../article-short/fit';
import { mix, rgba, type BrandPalette } from '../article-short/palette';
import { LogoTile } from '../article-short/ArticleShort';
import { WatermarkLine } from '../promo/shared';
import type { KitProps } from './StyledVideo';
import type { Story, Win } from './story';
import { fontJakarta, fontSora } from './fonts';
import { V_BOTTOM, V_WM, Lines, ProductImage, SpeedBlur, brandGrad, linesH, velocity, type FitBase } from './kit';
import { STYLE_EXITS } from './registry.mjs';

/**
 * SOHBET — motion-engine (MIT) sahnesindeki (proj10 scene.js) teknik: tum video TEK sohbet.
 *   - kancada kucuk bir giris kutusu; kanca metni yazilir, gonderilince kutu pencereye buyur, metin
 *     kullanici balonu olur (asip oturan "pop"), asistan "yaziyor" noktalari, ardindan cevap balonu
 *   - asistan balonunun avatari musterinin logosu; ust cubukta marka adi
 *   - "odalar" arasi yatay savrulma (whip pan): hiz bulanikligi + marka renginde hiz cizgileri
 *   - liste (site / urun): cevap balonlari ayni odada art arda birikir
 *   - kapanis: pencere kesik cizgili yankilarla logo karosuna katlanir; ad, CTA metni, alan adi hapi
 * Yeni metin yok: balonlarin hepsi videonun kendi metinleri (kanca, alt satir, maddeler).
 */

const BG = '#f5f5f7';
const INK = '#1d1d1f';
const F_USER: FitBase = { family: fontSora, weight: 700, letterSpacing: -0.025 };
const F_BOT: FitBase = { family: fontJakarta, weight: 600, letterSpacing: -0.01 };
const F_TITLE: FitBase = { family: fontSora, weight: 700, letterSpacing: -0.025 };

const pop = (p: number) => {
  // backOut(1.6) — 054 bubble pop
  const t = clamp01(p) - 1;
  return 1 + 2.6 * t * t * t + 1.6 * t * t;
};
const power4InOut = (p: number) => (p < 0.5 ? 8 * p ** 4 : 1 - Math.pow(-2 * p + 2, 4) / 2);
const power3Out = (p: number) => 1 - Math.pow(1 - clamp01(p), 3);

type Geo = { W: number; H: number; win: { x: number; y: number; w: number; h: number }; compact: { y: number; h: number }; pad: number; wmTop: number; wmSize: number };
// Dikey pencere guvenli alanin tamami: ust 230 .. alt V_BOTTOM (23.10 inceleme: alt yari bos kalmasin)
const TALL: Geo = { W: 1080, H: 1920, win: { x: 50, y: 230, w: 980, h: V_BOTTOM - 230 }, compact: { y: 1100, h: 300 }, pad: 36, wmTop: V_WM, wmSize: 24 };
const WIDE: Geo = { W: 1920, H: 1080, win: { x: 300, y: 56, w: 1320, h: 944 }, compact: { y: 600, h: 290 }, pad: 40, wmTop: 1016, wmSize: 22 };
/** Yatay urun: solda kalici urun karti (gorsel + fiyat, tum video), pencere sagda */
const WIDE_PRODUCT: Geo = { ...WIDE, win: { x: 780, y: 56, w: 1040, h: 944 } };
const SIDE = { x: 130, y: 250, w: 580, h: 580 };
const geoOf = (story: Story) => (story.wide ? (story.kind === 'product' ? WIDE_PRODUCT : WIDE) : TALL);
const BAR = 104;
const COMPOSER = 112;
/** dikey urun: liste odasinin ust cubugunda kucuk gorsel + fiyat (fiyat kapanisa dek gorunur kalmali) */
const THUMB = 64;
const priceChipX = (G: Geo) => G.win.x + G.pad + 60 + 20 + THUMB + 20;

type Bubble = { fit: Fit; w: number; h: number };
type Item = { title: Fit; detail: Fit | null; w: number; h: number };
type Fits = {
  user: Bubble;
  bot: Bubble | null;
  kicker: Fit | null;
  source: Fit | null;
  name: Fit | null;
  points: Item[];
  endName: Fit;
  domain: Fit;
  label: Fit;
  price: Fit | null;
  scale: number;
};

function bubble(text: string, base: FitBase, maxW: number, lines: number, max: number, min: number, padX: number, padY: number, lh: number): Bubble {
  const fit = fitText(text, { ...base, maxWidth: maxW - 2 * padX, maxLines: lines, maxSize: max, minSize: min });
  const wText = Math.max(...fit.lines.map((l) => measure(l, base, fit.size)));
  return { fit, w: Math.min(maxW, Math.ceil(wText + 2 * padX + 4)), h: Math.ceil(linesH(fit, lh) + 2 * padY) };
}

let ctx: CanvasRenderingContext2D | null = null;
function measure(t: string, b: FitBase, size: number) {
  if (!ctx) ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return t.length * size * 0.55;
  ctx.font = `${b.weight} ${size}px ${b.family}`;
  return ctx.measureText(t).width + (b.letterSpacing ?? 0) * size * t.length;
}

function computeFits(story: Story, G: Geo): Fits {
  const inner = G.win.w - 2 * G.pad;
  const roomH = G.win.h - BAR - COMPOSER - 2 * G.pad;
  const imgH = story.kind === 'product' && !story.wide ? Math.round(Math.min(roomH * 0.4, 500)) : 0;
  let user!: Bubble;
  let bot: Bubble | null = null;
  let k = 1;
  for (; k >= 0.55; k -= 0.05) {
    user = bubble(story.hook, F_USER, Math.round(inner * 0.9), 5, Math.round(84 * k), Math.min(48, Math.round(84 * k)), 40, 28, 1.14);
    // destek metni 1080 genislikte >= 44 px (yalniz asiri uzun metinde daha kucuk)
    bot = story.hookSub ? bubble(story.hookSub, F_BOT, Math.round(inner * 0.9) - 76, 4, Math.round(54 * Math.max(0.82, k)), 40, 34, 26, 1.32) : null;
    const h = (story.kicker ? 70 : 0) + imgH + (imgH ? 30 : 0) + user.h + 30 + 60 + (bot ? 30 + bot.h : 0) + (story.source ? 70 : 0);
    if (h <= roomH) break;
  }
  const listMode = story.list;
  const ptW = listMode ? inner - 70 : Math.round(inner * 0.9) - 76;
  let points: Item[] = [];
  for (let q = 1; q >= 0.5; q -= 0.05) {
    points = story.points.map((p) => {
      const title = fitText(p.title, { ...F_TITLE, maxWidth: ptW - 68, maxLines: listMode ? 2 : 4, maxSize: Math.round((listMode ? 64 : 80) * q), minSize: Math.min(listMode ? 38 : 48, Math.round((listMode ? 64 : 80) * q)) });
      const detail = p.detail ? fitText(p.detail, { ...F_BOT, maxWidth: ptW - 68, maxLines: 4, maxSize: Math.round((listMode ? 48 : 52) * Math.max(0.72, q)), minSize: listMode ? 34 : 44 }) : null;
      const w = Math.min(ptW, Math.ceil(Math.max(...title.lines.map((l) => measure(l, F_TITLE, title.size)), ...(detail ? detail.lines.map((l) => measure(l, F_BOT, detail.size)) : [0])) + 68 + 4));
      return { title, detail, w, h: Math.ceil(56 + linesH(title, 1.12) + (detail ? 16 + linesH(detail, 1.32) : 0)) };
    });
    const total = listMode ? points.reduce((a, r) => a + r.h, 0) + 24 * (points.length - 1) : Math.max(...points.map((r) => r.h));
    if (total <= roomH - 20) break;
  }
  const endW = story.wide ? (story.kind === 'product' ? 760 : 1400) : 880;
  return {
    user,
    bot,
    kicker: story.kicker ? fitText(story.kicker, { family: fontJakarta, weight: 700, letterSpacing: 0.02, maxWidth: inner - 120, maxLines: 1, maxSize: 30, minSize: 20 }) : null,
    source: story.source ? fitText(story.source, { family: fontJakarta, weight: 700, letterSpacing: 0, maxWidth: inner * 0.7, maxLines: 1, maxSize: 30, minSize: 20 }) : null,
    name: story.header || story.kind === 'site' ? fitText(story.kind === 'product' ? story.header : story.brand.name, { family: fontJakarta, weight: 800, letterSpacing: -0.01, maxWidth: inner - 220, maxLines: 1, maxSize: 38, minSize: 22 }) : null,
    points,
    endName: fitText(story.endName, { family: fontSora, weight: 800, letterSpacing: -0.035, maxWidth: endW, maxLines: 2, maxSize: story.wide ? 96 : 108, minSize: 56 }),
    domain: fitText(story.cta.domain, { family: fontSora, weight: 700, letterSpacing: -0.02, maxWidth: story.wide && story.kind === 'product' ? 540 : 640, maxLines: 1, maxSize: 56, minSize: 24 }),
    label: fitText(story.cta.label, { family: fontJakarta, weight: 700, letterSpacing: -0.01, maxWidth: endW, maxLines: 1, maxSize: story.wide ? 42 : 50, minSize: 28 }),
    price: story.price ? fitText(story.price, { family: fontSora, weight: 800, letterSpacing: -0.02, maxWidth: 380, maxLines: 1, maxSize: 48, minSize: 28 }) : null,
    scale: imgH,
  };
}

export function ChatStyle({ story, pal, win, frame }: KitProps) {
  const G = geoOf(story);
  const fits = useMemo(() => computeFits(story, G), [story, G]);
  // Oda kesmeleri: savrulma yalniz cikis penceresinde (registry STYLE_EXITS — okunurluk sozlesmesi)
  const X = STYLE_EXITS.chat[story.comp];
  const roomCuts = story.list ? [win.hookE] : [win.hookE, win.scene(0)[1], win.scene(1)[1]];
  const exitLen = (i: number) => (i === 0 ? X.hook : X.point);
  const camX = (f: number) => roomCuts.reduce((a, c, i) => a + G.W * power4InOut(ramp(f, c - exitLen(i), c, (t) => t)), 0);
  const cx = camX(frame);
  const v = velocity(camX, frame);
  const streak = roomCuts.reduce((a, c, i) => a + Math.sin(Math.PI * ramp(frame, c - exitLen(i), c, (t) => t)), 0);
  const rooms = story.list ? 2 : 1 + fits.points.length;
  return (
    <AbsoluteFill style={{ background: mix(BG, pal.primary, 0.03), color: INK, fontFamily: fontJakarta }}>
      <AbsoluteFill style={{ background: `radial-gradient(${G.W * 0.7}px ${G.H * 0.5}px at 50% 45%, ${rgba(pal.primary, 0.12)}, transparent 70%)` }} />
      {frame < win.endS ? (
        <SpeedBlur vx={-v} vy={0} amount={0.08} max={40}>
          {Array.from({ length: rooms }, (_, r) => {
            const x = r * G.W - cx;
            if (x <= -G.W || x >= G.W) return null;
            return (
              <AbsoluteFill key={r} style={{ transform: `translateX(${x.toFixed(1)}px)` }}>
                <Room r={r} story={story} pal={pal} win={win} frame={frame} fits={fits} G={G} />
              </AbsoluteFill>
            );
          })}
        </SpeedBlur>
      ) : null}
      <Streaks pal={pal} G={G} s={streak} frame={frame} />
      {story.kind === 'product' && story.wide && frame < win.endS + 14 ? <SideCard story={story} pal={pal} win={win} frame={frame} fits={fits} G={G} /> : null}
      {story.watermark && frame < win.endS + 2 ? <WatermarkLine top={G.wmTop} color="#86868b" opacity={0.8 * win.wm(frame)} size={G.wmSize} /> : null}
      <End story={story} pal={pal} win={win} frame={frame} fits={fits} G={G} />
    </AbsoluteFill>
  );
}

type P = { story: Story; pal: BrandPalette; win: Win; frame: number; fits: Fits; G: Geo };

function Streaks({ pal, G, s, frame }: { pal: BrandPalette; G: Geo; s: number; frame: number }) {
  if (s <= 0.02) return null;
  const spec = [[0.38, 10, pal.primary, 0.8], [0.45, 18, '#e8e8ed', 1.1], [0.51, 6, mix(pal.primary, '#ffffff', 0.4), 0.65], [0.6, 14, '#d2d2d7', 0.95], [0.68, 8, pal.primary, 0.75], [0.75, 20, '#ececef', 1.2]] as const;
  return (
    <>
      {spec.map(([y, h, c, w], i) => (
        <div key={i} style={{ position: 'absolute', top: G.H * y, height: h, width: G.W * w * 0.8, left: ((i * 173 + frame * 90) % (G.W * 1.6)) - G.W * 0.4, background: c, borderRadius: 99, opacity: Math.min(1, s) * 0.85 }} />
      ))}
    </>
  );
}

/** Pencere: ust cubuk (logo + ad), konusma alani, giris kutusu */
function Window({ story, pal, G, rect, children, name, nameP, logoP, composer, extra }: { story: Story; pal: BrandPalette; G: Geo; rect: { y: number; h: number }; children: React.ReactNode; name: Fit | null; nameP: number; logoP: number; composer: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <div style={{ position: 'absolute', left: G.win.x, top: rect.y, width: G.win.w, height: rect.h, borderRadius: 44, background: '#ffffff', boxShadow: `0 0 0 1px ${rgba(INK, 0.06)}, 0 40px 90px -30px ${rgba(INK, 0.3)}`, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: BAR, display: 'flex', alignItems: 'center', gap: 20, padding: `0 ${G.pad}px`, borderBottom: `1.5px solid ${rgba(INK, 0.07)}` }}>
        <div style={{ transform: `scale(${0.5 + 0.5 * clamp01(logoP)})`, opacity: clamp01(logoP * 2) }}>
          <LogoTile brand={story.brand} size={60} pal={pal} />
        </div>
        {name ? <span style={{ fontWeight: 800, fontSize: name.size, whiteSpace: 'nowrap', opacity: clamp01(nameP * 1.5) }}>{name.lines[0]}</span> : null}
        {extra}
        <div style={{ marginLeft: 'auto', width: 14, height: 14, borderRadius: 99, background: '#34c759', opacity: clamp01(logoP) }} />
      </div>
      <div style={{ position: 'absolute', left: G.pad, right: G.pad, top: BAR + G.pad, bottom: COMPOSER + G.pad }}>{children}</div>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: COMPOSER, padding: `0 ${G.pad}px`, display: 'flex', alignItems: 'center' }}>{composer}</div>
    </div>
  );
}

function Composer({ pal, text, n, caret, ready, press }: { pal: BrandPalette; text: Fit | null; n: number; caret: boolean; ready: number; press: number }) {
  const shown = text ? text.lines.join(' ').slice(0, n) : '';
  return (
    <div style={{ flex: 1, height: 76, borderRadius: 99, background: mix('#ffffff', INK, 0.04), border: `1.5px solid ${rgba(INK, 0.08)}`, display: 'flex', alignItems: 'center', padding: '0 12px 0 30px', gap: 12 }}>
      <div style={{ flex: 1, overflow: 'hidden', whiteSpace: 'nowrap', fontFamily: fontSora, fontWeight: 600, fontSize: 32, color: INK, display: 'flex', justifyContent: 'flex-end' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'clip', direction: 'ltr' }}>{shown.length > 38 ? `…${shown.slice(-38)}` : shown}</span>
        <span style={{ display: 'inline-block', width: 3, height: 38, marginLeft: 4, background: pal.primaryUi, opacity: caret ? 1 : 0 }} />
      </div>
      <div style={{ width: 56, height: 56, borderRadius: 99, display: 'grid', placeItems: 'center', background: ready > 0.5 ? pal.primary : rgba(pal.primary, 0.16), transform: `scale(${press})` }}>
        <ArrowUp size={30} color={ready > 0.5 ? pal.onPrimary : pal.accentText} strokeWidth={2.8} />
      </div>
    </div>
  );
}

function Avatar({ story, pal, size = 56 }: { story: Story; pal: BrandPalette; size?: number }) {
  return <LogoTile brand={story.brand} size={size} pal={pal} />;
}

function Room({ r, story, pal, win, frame, fits, G }: P & { r: number }) {
  if (r === 0) return <HookRoom story={story} pal={pal} win={win} frame={frame} fits={fits} G={G} />;
  if (story.list) return <ListRoom story={story} pal={pal} win={win} frame={frame} fits={fits} G={G} />;
  return <PointRoom i={r - 1} story={story} pal={pal} win={win} frame={frame} fits={fits} G={G} />;
}

/* ───────────── kanca odasi ───────────── */

function HookRoom({ story, pal, win, frame, fits, G }: P) {
  // gonder: kanca balonunun yayi (hook.title - 4) baslamadan biraz once; pencere o anda buyumeye baslar
  const send = win.tl.at('hook.title') - 10;
  const userP = win.titleIn(frame);
  const typeEnd = send - 2;
  const total = fits.user.fit.lines.join(' ').length;
  const n = Math.floor(total * clamp01((frame - 3) / Math.max(1, typeEnd - 3)));
  const grow = power3Out(ramp(frame, send, send + 15, (t) => t));
  const rect = { y: interpolate(grow, [0, 1], [G.compact.y, G.win.y]), h: interpolate(grow, [0, 1], [G.compact.h, G.win.h]) };
  const subAt = win.tl.at('hook.sub');
  const typing = frame >= send + 14 && frame < subAt ? pop((frame - send - 14) / 9) : 0;
  const botP = win.subIn(frame);
  const src = win.sourceIn(frame);
  const kick = win.kickerIn(frame);
  const imgP = win.logoIn(frame);
  const priceP = win.priceIn(frame);
  const press = frame >= send && frame < send + 4 ? 0.86 : 1;
  const nameP = story.kind === 'site' ? win.nameIn(frame) : win.headerIn(frame);
  const logoP = story.kind === 'site' ? win.logoIn(frame) : story.kind === 'product' ? win.logoIn(frame) : win.headerIn(frame);
  const imgH = fits.scale;
  return (
    <Window
      story={story}
      pal={pal}
      G={G}
      rect={rect}
      name={fits.name}
      nameP={nameP}
      logoP={logoP}
      composer={<Composer pal={pal} text={frame < send ? fits.user.fit : null} n={n} caret={frame < send ? true : Math.floor(frame / 16) % 2 === 0} ready={frame < send ? clamp01((frame - typeEnd + 2) / 3) : 0} press={press} />}
    >
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 30 }}>
        {fits.kicker ? (
          <div style={{ alignSelf: 'center', padding: '10px 24px', borderRadius: 99, background: rgba(INK, 0.06), opacity: clamp01(kick * 1.5) }}>
            <Lines fit={fits.kicker} lineHeight={1.1} style={{ fontWeight: 700, color: '#6e6e73', letterSpacing: '0.02em' }} />
          </div>
        ) : null}
        {story.kind === 'product' && !story.wide ? (
          <div style={{ display: 'flex', gap: 18, alignItems: 'flex-end', opacity: clamp01(imgP * 2), transform: `translateY(${(1 - pop(imgP)) * 30}px) scale(${0.92 + 0.08 * pop(imgP)})`, transformOrigin: 'left bottom' }}>
            <Avatar story={story} pal={pal} />
            <div style={{ position: 'relative', width: imgH * 1.15, height: imgH, borderRadius: 36, overflow: 'hidden', background: story.image ? '#ffffff' : pal.primary, border: `1.5px solid ${rgba(INK, 0.08)}` }}>
              <ProductImage src={story.image} frame={frame} total={win.total} fallback={<LogoTile brand={story.brand} size={imgH * 0.4} pal={pal} />} />
              {fits.price ? (
                <div style={{ position: 'absolute', right: 16, bottom: 16, padding: '8px 20px', borderRadius: 99, background: pal.primary, color: pal.onPrimary, opacity: clamp01(priceP * 1.6), transform: `scale(${0.6 + 0.4 * pop(priceP)})` }}>
                  <Lines fit={fits.price} lineHeight={1.15} style={{ fontFamily: fontSora, fontWeight: 800 }} />
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
        <div style={{ alignSelf: 'flex-end', width: fits.user.w, padding: '28px 40px', boxSizing: 'border-box', borderRadius: '44px 44px 14px 44px', background: brandGrad(pal, 135), color: pal.onPrimary, opacity: clamp01(userP * 2), transform: `translateY(${(1 - pop(userP)) * 30}px) scale(${interpolate(pop(userP), [0, 1], [0.9, 1])})`, transformOrigin: 'right bottom' }}>
          <Lines fit={fits.user.fit} lineHeight={1.14} style={{ fontFamily: fontSora, fontWeight: 700, letterSpacing: '-0.025em' }} />
        </div>
        {typing > 0 && botP < 0.2 ? (
          <div style={{ display: 'flex', gap: 18, alignItems: 'flex-end', opacity: clamp01(typing * 2) }}>
            <Avatar story={story} pal={pal} />
            <div style={{ display: 'flex', gap: 10, padding: '26px 30px', borderRadius: '36px 36px 36px 12px', background: mix('#ffffff', INK, 0.05) }}>
              {[0, 1, 2].map((d) => {
                const k = 0.5 + 0.5 * Math.sin((frame / win.fpb) * 2 * Math.PI - d * 1.1);
                return <div key={d} style={{ width: 16, height: 16, borderRadius: 99, background: '#8e8e93', transform: `translateY(${-6 * k}px)`, opacity: 0.4 + 0.6 * k }} />;
              })}
            </div>
          </div>
        ) : null}
        {fits.bot && botP >= 0.02 ? (
          <div style={{ display: 'flex', gap: 18, alignItems: 'flex-end', opacity: clamp01(botP * 2), transform: `translateY(${(1 - pop(botP)) * 30}px) scale(${interpolate(pop(botP), [0, 1], [0.94, 1])})`, transformOrigin: 'left bottom' }}>
            <Avatar story={story} pal={pal} />
            <div style={{ width: fits.bot.w, padding: '26px 34px', boxSizing: 'border-box', borderRadius: '40px 40px 40px 12px', background: mix('#ffffff', INK, 0.05) }}>
              <Lines fit={fits.bot.fit} lineHeight={1.32} style={{ fontWeight: 600, color: INK }} />
            </div>
          </div>
        ) : null}
        {fits.source ? (
          <div style={{ marginLeft: 74, display: 'flex', alignItems: 'center', gap: 12, padding: '14px 22px', alignSelf: 'flex-start', borderRadius: 22, border: `1.5px solid ${rgba(INK, 0.1)}`, opacity: src }}>
            <Link2 size={28} color={pal.accentText} strokeWidth={2.4} />
            <Lines fit={fits.source} lineHeight={1.2} style={{ fontWeight: 700, color: '#6e6e73' }} />
          </div>
        ) : null}
      </div>
    </Window>
  );
}

/* ───────────── makale maddesi odasi ───────────── */

function PointRoom({ i, story, pal, win, frame, fits, G }: P & { i: number }) {
  const it = fits.points[i];
  if (!it) return null;
  const inP = win.pointIn(i, frame);
  const tP = win.pointTitleIn(i, frame);
  const dP = win.detailIn(i, frame);
  const last = i === fits.points.length - 1;
  const fade = last ? 1 - win.pointOut(i, frame) : 1;
  return (
    <div style={{ position: 'absolute', inset: 0, opacity: fade }}>
      <Window story={story} pal={pal} G={G} rect={{ y: G.win.y, h: G.win.h }} name={fits.name} nameP={1} logoP={1} composer={<Composer pal={pal} text={null} n={0} caret={Math.floor(frame / 16) % 2 === 0} ready={0} press={1} />}>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 24 }}>
          <div style={{ alignSelf: 'center', padding: '10px 24px', borderRadius: 99, background: rgba(pal.primary, 0.12), color: pal.accentText, fontWeight: 800, fontSize: 28, opacity: clamp01(inP * 1.5) }}>
            {i + 1} / {fits.points.length}
          </div>
          <div style={{ display: 'flex', gap: 18, alignItems: 'flex-end', opacity: clamp01(inP * 2), transform: `translateY(${(1 - pop(inP)) * 40}px) scale(${interpolate(pop(inP), [0, 1], [0.94, 1])})`, transformOrigin: 'left bottom' }}>
            <Avatar story={story} pal={pal} />
            <div style={{ width: it.w, padding: '28px 34px', boxSizing: 'border-box', borderRadius: '40px 40px 40px 12px', background: mix('#ffffff', INK, 0.05) }}>
              <Lines fit={it.title} lineHeight={1.12} style={{ fontFamily: fontSora, fontWeight: 700, letterSpacing: '-0.025em', opacity: clamp01(tP * 1.6) }} />
              {it.detail ? <Lines fit={it.detail} lineHeight={1.32} style={{ marginTop: 16, fontWeight: 600, color: '#3a3a3c', opacity: clamp01(dP * 1.6), transform: `translateY(${(1 - clamp01(dP)) * 16}px)` }} /> : null}
            </div>
          </div>
        </div>
      </Window>
    </div>
  );
}

/* ───────────── liste odasi: cevaplar birikir ───────────── */

function ListRoom({ story, pal, win, frame, fits, G }: P) {
  const out = win.pointOut(0, frame);
  let shown = 0;
  const items = fits.points.map((it, i) => {
    const p = win.pointIn(i, frame);
    shown += (it.h + 24) * clamp01(p);
    return { it, i, p, det: win.detailIn(i, frame) };
  });
  const roomH = G.win.h - BAR - COMPOSER - 2 * G.pad;
  const pinned = story.kind === 'product' && !story.wide;
  // yeni cevap altta; konusma yukari kayar ama hicbiri pencereden cikmaz (fit buna gore)
  let y = Math.max(0, roomH - shown);
  const extra = pinned ? (
    <>
      <div style={{ position: 'relative', width: THUMB, height: THUMB, borderRadius: 16, overflow: 'hidden', background: story.image ? '#ffffff' : pal.primary, border: `1.5px solid ${rgba(INK, 0.08)}`, flexShrink: 0 }}>
        <ProductImage src={story.image} frame={frame} total={win.total} fallback={<LogoTile brand={story.brand} size={40} pal={pal} />} />
      </div>
      {fits.price ? (
        <div style={{ padding: '8px 22px', borderRadius: 99, background: pal.primary, color: pal.onPrimary }}>
          <Lines fit={fits.price} lineHeight={1.15} style={{ fontFamily: fontSora, fontWeight: 800 }} />
        </div>
      ) : null}
    </>
  ) : null;
  return (
    <div style={{ position: 'absolute', inset: 0, opacity: 1 - out }}>
      <Window story={story} pal={pal} G={G} rect={{ y: G.win.y, h: G.win.h }} name={fits.name} nameP={1} logoP={1} extra={extra} composer={<Composer pal={pal} text={null} n={0} caret={Math.floor(frame / 16) % 2 === 0} ready={0} press={1} />}>
        {items.map(({ it, i, p, det }) => {
          const top = y;
          y += (it.h + 24) * clamp01(p);
          if (p <= 0.01) return null;
          return (
            <div key={i} style={{ position: 'absolute', left: 0, top, display: 'flex', gap: 18, alignItems: 'flex-end', opacity: clamp01(p * 2), transform: `translateY(${(1 - pop(p)) * 30}px) scale(${interpolate(pop(p), [0, 1], [0.94, 1])})`, transformOrigin: 'left bottom' }}>
              <Avatar story={story} pal={pal} size={52} />
              <div style={{ width: it.w, padding: '26px 34px', boxSizing: 'border-box', borderRadius: '36px 36px 36px 12px', background: mix('#ffffff', INK, 0.05) }}>
                <Lines fit={it.title} lineHeight={1.12} style={{ fontFamily: fontSora, fontWeight: 700, letterSpacing: '-0.02em' }} />
                {it.detail ? <Lines fit={it.detail} lineHeight={1.32} style={{ marginTop: 14, fontWeight: 600, color: '#3a3a3c', opacity: clamp01(det * 1.6) }} /> : null}
              </div>
            </div>
          );
        })}
      </Window>
    </div>
  );
}

/* ───────────── yatay urun: kalici urun karti ───────────── */

function SideCard({ story, pal, win, frame, fits }: P) {
  const inP = win.logoIn(frame);
  const priceP = win.priceIn(frame);
  return (
    <div style={{ position: 'absolute', left: SIDE.x, top: SIDE.y, width: SIDE.w, height: SIDE.h, borderRadius: 48, overflow: 'hidden', background: story.image ? '#ffffff' : pal.primary, boxShadow: `0 0 0 1px ${rgba(INK, 0.06)}, 0 40px 90px -30px ${rgba(INK, 0.3)}`, opacity: clamp01(inP * 2), transform: `translateY(${(1 - pop(inP)) * 40}px) scale(${interpolate(pop(inP), [0, 1], [0.92, 1])})` }}>
      <ProductImage src={story.image} frame={frame} total={win.total} fallback={<LogoTile brand={story.brand} size={SIDE.w * 0.4} pal={pal} />} />
      {story.image ? (
        <div style={{ position: 'absolute', left: 24, bottom: 24 }}>
          <LogoTile brand={story.brand} size={88} pal={pal} />
        </div>
      ) : null}
      {fits.price ? (
        <div style={{ position: 'absolute', left: 24, top: 24, padding: '10px 24px', borderRadius: 99, background: pal.primary, color: pal.onPrimary, opacity: clamp01(priceP * 1.6), transform: `scale(${0.6 + 0.4 * pop(priceP)})`, transformOrigin: 'left top' }}>
          <Lines fit={fits.price} lineHeight={1.15} style={{ fontFamily: fontSora, fontWeight: 800 }} />
        </div>
      ) : null}
    </div>
  );
}

/* ───────────── kapanis: pencere logo karosuna katlanir ───────────── */

function End({ story, pal, win, frame, fits, G }: P) {
  const s = win.endS;
  if (frame < s - 6) return null;
  const product = story.kind === 'product';
  const TS = story.wide ? 200 : 240;
  const tile = product
    ? story.wide ? { ...SIDE, r: 48 } : { x: (1080 - 520) / 2, y: 320, w: 520, h: 520, r: 48 }
    : story.wide ? { x: (1920 - TS) / 2, y: 140, w: TS, h: TS, r: TS * 0.29 } : { x: (1080 - TS) / 2, y: 580, w: TS, h: TS, r: TS * 0.29 };
  const k = (lag: number) => power4InOut(ramp(frame, s - 6 + lag, s + 12 + lag, (t) => t));
  const rect = (p: number) => ({ x: G.win.x + (tile.x - G.win.x) * p, y: G.win.y + (tile.y - G.win.y) * p, w: G.win.w + (tile.w - G.win.w) * p, h: G.win.h + (tile.h - G.win.h) * p, r: 44 + (tile.r - 44) * p });
  const R = rect(k(0));
  const flood = power3Out(ramp(frame, s + 6, s + 14, (t) => t));
  const t = win.endTileIn(frame);
  const nm = win.endNameIn(frame);
  const lab = win.labelIn(frame);
  const cta = win.ctaIn(frame);
  const mark = win.markIn(frame);
  const textBox: React.CSSProperties = product
    ? story.wide ? { left: 820, width: 900, top: 250, alignItems: 'flex-start', textAlign: 'left' } : { left: 90, width: 900, top: 920, alignItems: 'center', textAlign: 'center' }
    : story.wide ? { left: 160, width: 1600, top: 400, alignItems: 'center', textAlign: 'center' } : { left: 90, width: 900, top: 880, alignItems: 'center', textAlign: 'center' };
  return (
    <AbsoluteFill>
      {[0.07, 0.14].map((lag, i) => {
        const r = rect(k(lag * 30));
        const a = Math.sin(Math.PI * ramp(frame, s - 6, s + 12 + lag * 30, (x) => x)) * 0.8;
        return <div key={i} style={{ position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h, borderRadius: r.r, border: `3px dashed ${rgba(pal.primary, 0.5)}`, opacity: a }} />;
      })}
      <div style={{ position: 'absolute', left: R.x, top: R.y, width: R.w, height: R.h, borderRadius: R.r, overflow: 'hidden', background: '#ffffff', boxShadow: `0 30px 70px -24px ${rgba(pal.primaryDeep, 0.15 + 0.3 * flood)}` }}>
        {product ? (
          <ProductImage src={story.image} frame={frame} total={win.total} fallback={<LogoTile brand={story.brand} size={R.w * 0.4} pal={pal} />} style={{ opacity: flood }} />
        ) : (
          <div style={{ position: 'absolute', inset: 0, background: brandGrad(pal, 135), clipPath: `circle(${flood * 75}% at 50% 50%)` }} />
        )}
      </div>
      {!product ? (
        <div style={{ position: 'absolute', left: tile.x + TS * 0.14, top: tile.y + TS * 0.14, transform: `scale(${clamp01(t)})`, opacity: clamp01(t * 2) * flood }}>
          <LogoTile brand={story.brand} size={TS * 0.72} pal={pal} />
        </div>
      ) : fits.price ? (
        // Fiyat kapanisa dek KESINTISIZ gorunur (okunurluk): dikeyde sabit satirdaki yerinden karonun kosesine kayar
        <div style={{ position: 'absolute', left: story.wide ? tile.x + 24 : interpolate(k(0), [0, 1], [priceChipX(G), tile.x + tile.w - 40]), top: story.wide ? tile.y + 24 : interpolate(k(0), [0, 1], [G.win.y + (BAR - fits.price.size * 1.15 - 16) / 2, tile.y + 24]), padding: '8px 22px', borderRadius: 99, background: pal.primary, color: pal.onPrimary, boxShadow: `0 0 0 ${5 * k(0)}px #ffffff` }}>
          <Lines fit={fits.price} lineHeight={1.15} style={{ fontFamily: fontSora, fontWeight: 800 }} />
        </div>
      ) : null}
      <div style={{ position: 'absolute', display: 'flex', flexDirection: 'column', ...textBox }}>
        <Lines fit={fits.endName} lineHeight={1.05} align={textBox.textAlign as 'left' | 'center'} style={{ fontFamily: fontSora, fontWeight: 800, letterSpacing: '-0.035em', opacity: clamp01(nm * 1.5), transform: `translateY(${(1 - Math.min(1, nm)) * 30}px)`, filter: nm < 0.99 ? `blur(${((1 - Math.min(1, nm)) * 8).toFixed(1)}px)` : undefined }} />
        <div style={{ marginTop: story.wide ? 36 : 56, opacity: lab }}>
          <Lines fit={fits.label} lineHeight={1.2} align={textBox.textAlign as 'left' | 'center'} style={{ fontWeight: 700, color: '#6e6e73' }} />
        </div>
        <div style={{ marginTop: 26, display: 'inline-flex', alignItems: 'center', gap: 14, padding: `${fits.domain.size * 0.45}px ${fits.domain.size * 0.8}px`, borderRadius: 99, background: pal.primary, color: pal.onPrimary, fontFamily: fontSora, fontWeight: 700, fontSize: fits.domain.size, whiteSpace: 'nowrap', boxShadow: `0 22px 48px ${rgba(pal.primaryDeep, 0.28)}`, opacity: clamp01(pop(cta) * 2), transform: `translateY(${(1 - pop(cta)) * 50}px) scale(${interpolate(pop(cta), [0, 1], [0.9, 1])})` }}>
          {fits.domain.lines[0]}
          <ArrowUpRight size={fits.domain.size * 0.9} strokeWidth={2.8} />
        </div>
      </div>
      {story.watermark ? <WatermarkLine top={G.wmTop - (story.wide ? 0 : 22)} color="#86868b" opacity={0.85 * mark} size={story.wide ? 22 : 26} /> : null}
    </AbsoluteFill>
  );
}
