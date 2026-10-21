import React from 'react';
import { AbsoluteFill, Easing, useCurrentFrame } from 'remotion';
import { ArrowRight, Check, CircleAlert, Globe, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { alpha, brand, light, logo } from '../tokens';
import { Wordmark } from '../ui';
import {
  BigLine,
  Chip,
  CtaButton,
  Cursor,
  ENGINES,
  GradText,
  M,
  SAMPLE_RESULT,
  SampleTag,
  Soundtrack,
  Stage,
  clamp01,
  fontDisplay,
  fontMono,
  fontUI,
  mentionMeta,
  ramp,
  snap,
  soft,
  useBrandFonts,
} from './kit';
import { timeline, typedCount } from './timeline';

/**
 * ProductIntro — 1920×1080, 38 sn, muzik + efekt (sessiz varyant: muted).
 *
 *   Kanca (0-5 sn): "Müşterilerin artık yapay zekâya soruyor. Cevapta sen var mısın?"
 *   Donus (5-8 sn): cevaptaki bos yer marka karosuna coker → RanksUp
 *   Akis (8-32 sn): 01 Siteni bagla → 02 SEO + GEO analizi → 03 Makale yazilir, yayinlanir → 04 AI gorunurlugu olculur
 *   Kapanis (32-38 sn): logo + "2 makale ücretsiz dene" + ranksup.ai
 *
 * Tek bir kutu (MorphBox) butun film boyunca bicim degistirir: sohbet karti → logo karosu →
 * urun karti → logo karosu. Kesmeler timeline.json'dan gelir. Paneller "Örnek ekran" etiketlidir;
 * olculmus metrik iddiasi yoktur.
 */

export type MarketingProps = { muted?: boolean };

const TL = timeline('ProductIntro');
export const PRODUCT_INTRO_DURATION = TL.durationInFrames;

type Rect = { x: number; y: number; w: number; h: number; r: number };
const CHAT: Rect = { x: 1230, y: 190, w: 570, h: 700, r: 32 };
const TILE_BRAND: Rect = { x: 560, y: 380, w: 160, h: 160, r: 46 };
const CARD: Rect = { x: 340, y: 270, w: 1240, h: 640, r: 32 };
const TILE_END: Rect = { x: 880, y: 170, w: 160, h: 160, r: 46 };
/** kart icerik alani (padding 48) */
const C = { x: CARD.x + 48, y: CARD.y + 48, w: CARD.w - 96, h: CARD.h - 96 };

const MORPH = Easing.bezier(0.45, 0, 0.15, 1);

export const ProductIntro: React.FC<MarketingProps> = ({ muted = false }) => {
  useBrandFonts();
  const frame = useCurrentFrame();
  const [, hookE] = TL.scene('hook');
  const [, brandE] = TL.scene('brand');
  const [endS] = TL.scene('end');

  // ── bicim degistiren kutu ──
  const collapse1: [number, number] = [hookE - 17, hookE];
  const expand: [number, number] = [brandE - 12, brandE + 6];
  const collapse2: [number, number] = [endS - 12, endS + 6];
  const lerpRect = (a: Rect, b: Rect, f0: number, f1: number) => {
    const t = ramp(frame, f0, f1, MORPH);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, w: a.w + (b.w - a.w) * t, h: a.h + (b.h - a.h) * t, r: a.r + (b.r - a.r) * t };
  };
  let rect: Rect;
  if (frame < collapse1[1]) rect = lerpRect(CHAT, TILE_BRAND, ...collapse1);
  else if (frame < expand[1]) rect = lerpRect(TILE_BRAND, CARD, ...expand);
  else rect = lerpRect(CARD, TILE_END, ...collapse2);
  // logo karosunda vurusla kucuk asma
  const hitPop = frame >= hookE && frame < hookE + 12 ? 1 + 0.06 * Math.sin(((frame - hookE) / 12) * Math.PI) : 1;
  const endPop = frame >= endS + 6 && frame < endS + 18 ? 1 + 0.05 * Math.sin(((frame - endS - 6) / 12) * Math.PI) : 1;
  const gradOn = Math.max(
    Math.min(ramp(frame, hookE - 8, hookE), 1 - ramp(frame, brandE - 10, brandE - 4)),
    ramp(frame, endS - 6, endS + 2),
  );
  const boxIn = soft(frame, -10);

  return (
    <Stage>
      <Soundtrack tl={TL} muted={muted} />
      <Hook frame={frame} />
      <BrandLockup frame={frame} />
      <StepHeader frame={frame} />

      <div
        style={{
          position: 'absolute',
          left: rect.x,
          top: rect.y,
          width: rect.w,
          height: rect.h,
          borderRadius: rect.r,
          overflow: 'hidden',
          background: M.paper,
          border: `1.5px solid ${alpha(M.ink, 0.08 * (1 - gradOn))}`,
          boxShadow: `0 30px 80px ${alpha(M.ink, 0.1)}, 0 6px 18px ${alpha(M.ink, 0.05)}`,
          transform: `scale(${hitPop * endPop}) translateY(${(1 - boxIn) * 30}px)`,
          opacity: clamp01(boxIn * 1.4),
        }}
      >
        <div style={{ position: 'absolute', inset: 0, background: M.grad, opacity: gradOn }} />
        {gradOn > 0 ? (
          <svg width={rect.w} height={rect.h} viewBox={`0 0 ${rect.w} ${rect.h}`} style={{ position: 'absolute', inset: 0, opacity: gradOn }}>
            <g transform={`translate(${rect.w / 2 - 30},${rect.h / 2 - 30}) scale(0.6)`} fill="none" stroke="#fff" strokeWidth="11" strokeLinecap="round">
              <path d="M28 72 L72 28" />
              <path d="M40 26 L74 26 L74 60" strokeLinejoin="round" />
            </g>
          </svg>
        ) : null}
        {frame < hookE ? <ChatContent
            frame={frame}
            fadeOut={ramp(frame, collapse1[0] - 6, collapse1[0] + 4)}
            times={{ ask: TL.at('hook.ask'), a1: TL.at('hook.a1'), a2: TL.at('hook.a2'), a3: TL.at('hook.a3'), slot: TL.at('hook.slot') }}
          /> : null}
      </div>

      {/* Kart icerigi kutunun disinda, ekran koordinatinda (imlec hedefleri ayni sistemde) */}
      {frame >= brandE - 2 && frame < endS + 2 ? (
        <AbsoluteFill style={{ opacity: Math.min(ramp(frame, brandE, brandE + 8), 1 - ramp(frame, endS - 10, endS - 4)) }}>
          <StepConnect frame={frame} />
          <StepAnalyze frame={frame} />
          <StepPublish frame={frame} />
          <StepMeasure frame={frame} />
        </AbsoluteFill>
      ) : null}

      <EndCard frame={frame} />
      <IntroCursor frame={frame} />
    </Stage>
  );
};

/* ───────────────────────── Kanca ───────────────────────── */

function Hook({ frame }: { frame: number }) {
  const [, hookE] = TL.scene('hook');
  const out = ramp(frame, hookE - 22, hookE - 6, Easing.in(Easing.cubic));
  if (frame >= hookE) return null;
  return (
    <div style={{ position: 'absolute', left: 140, top: 290, opacity: 1 - out, transform: `translateY(${-out * 40}px)` }}>
      <BigLine frame={frame} at={-2} size={84}>
        Müşterilerin artık
      </BigLine>
      <BigLine frame={frame} at={4} size={84}>
        yapay zekâya soruyor.
      </BigLine>
      <BigLine frame={frame} at={TL.at('hook.line2')} size={84} style={{ marginTop: 26 }}>
        <GradText>Cevapta sen var mısın?</GradText>
      </BigLine>
    </div>
  );
}

const QUESTION = 'Kadıköy’de en iyi diş kliniği hangisi?';

export type ChatTimes = { ask: number; a1: number; a2: number; a3: number; slot: number };

/** Kanca sohbet karti — ProductIntro ve SocialAd ortak (SocialAd'de CSS zoom ile buyutulur) */
export function ChatContent({ frame, fadeOut, times }: { frame: number; fadeOut: number; times: ChatTimes }) {
  const ask = snap(frame, times.ask);
  const rows = [times.a1, times.a2, times.a3].map((at) => snap(frame, at));
  const slot = snap(frame, times.slot);
  const pulse = frame > times.slot ? 1 + 0.025 * Math.max(0, Math.cos(((frame - times.slot) / 15) * Math.PI * 2)) : 1;
  const thinking = frame >= times.ask + 4 && frame < times.a1;
  return (
    <div style={{ position: 'absolute', inset: 0, padding: 34, display: 'flex', flexDirection: 'column', gap: 22, opacity: 1 - fadeOut, filter: `blur(${fadeOut * 8}px)` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <span style={{ width: 46, height: 46, borderRadius: 14, display: 'grid', placeItems: 'center', background: alpha(brand[500], 0.12), color: brand[600] }}>
          <Sparkles size={26} />
        </span>
        <span style={{ fontFamily: fontUI, fontWeight: 700, fontSize: 25, color: M.inkSoft }}>AI asistanı</span>
        <span style={{ marginLeft: 'auto' }}>
          <SampleTag size={16} label="Örnek" />
        </span>
      </div>
      <div
        style={{
          alignSelf: 'flex-end',
          maxWidth: 420,
          padding: '18px 22px',
          borderRadius: '24px 24px 6px 24px',
          background: M.ink,
          color: 'white',
          fontFamily: fontUI,
          fontWeight: 600,
          fontSize: 27,
          lineHeight: 1.3,
          opacity: clamp01(ask * 1.5),
          transform: `translateY(${(1 - ask) * 20}px) scale(${0.92 + 0.08 * ask})`,
          transformOrigin: 'right bottom',
        }}
      >
        {QUESTION}
      </div>
      {thinking ? (
        <div style={{ display: 'flex', gap: 8, paddingLeft: 6 }}>
          {[0, 1, 2].map((i) => (
            <span key={i} style={{ width: 12, height: 12, borderRadius: 99, background: M.muted, opacity: 0.35 + 0.65 * Math.max(0, Math.sin((frame / 5 - i) * 1.3)) }} />
          ))}
        </div>
      ) : null}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 4 }}>
        {['Klinik A', 'Klinik B', 'Klinik C'].map((name, i) => (
          <div
            key={name}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              padding: '14px 18px',
              borderRadius: 18,
              background: M.fill,
              opacity: clamp01(rows[i] * 1.5),
              transform: `translateX(${(1 - rows[i]) * -24}px)`,
            }}
          >
            <span style={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: 24, color: M.muted, width: 26 }}>{i + 1}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: fontUI, fontWeight: 700, fontSize: 26, color: M.inkSoft }}>{name}</div>
              <div style={{ height: 10, borderRadius: 99, background: alpha(M.ink, 0.08), width: `${[78, 64, 70][i]}%`, marginTop: 9 }} />
            </div>
          </div>
        ))}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            padding: '14px 18px',
            borderRadius: 18,
            border: `3px dashed ${alpha(brand[500], 0.75)}`,
            background: alpha(brand[500], 0.05),
            opacity: clamp01(slot * 1.5),
            transform: `scale(${(0.9 + 0.1 * slot) * pulse})`,
          }}
        >
          <span style={{ fontFamily: fontDisplay, fontWeight: 800, fontSize: 24, color: brand[600], width: 26 }}>?</span>
          <span style={{ fontFamily: fontUI, fontWeight: 800, fontSize: 27, color: brand[700] }}>Senin kliniğin?</span>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── Marka ───────────────────────── */

function BrandLockup({ frame }: { frame: number }) {
  const [brandS, brandE] = TL.scene('brand');
  if (frame < brandS - 2 || frame >= brandE + 2) return null;
  const w = snap(frame, brandS + 4);
  const tag = soft(frame, TL.at('brand.tag') - 6);
  const out = ramp(frame, brandE - 14, brandE - 4, Easing.in(Easing.cubic));
  return (
    <>
      <div
        style={{
          position: 'absolute',
          left: TILE_BRAND.x + TILE_BRAND.w + 40,
          top: TILE_BRAND.y + TILE_BRAND.h / 2 - 62,
          opacity: clamp01(w * 1.4) * (1 - out),
          transform: `translateX(${(1 - w) * -40 - out * 30}px)`,
        }}
      >
        <Wordmark size={124} theme={light} />
      </div>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 610,
          textAlign: 'center',
          fontFamily: fontDisplay,
          fontWeight: 600,
          fontSize: 46,
          letterSpacing: '-0.02em',
          color: M.body,
          opacity: tag * (1 - out),
          transform: `translateY(${(1 - tag) * 16}px)`,
        }}
      >
        Markanı yapay zekâ çağına hazırla.
      </div>
    </>
  );
}

/* ───────────────────────── Adim basligi ───────────────────────── */

const STEPS = [
  { scene: 'connect', n: '01', title: 'Siteni bağla', sub: 'Adresini yapıştır; RanksUp siteni tarar ve tanır.' },
  { scene: 'analyze', n: '02', title: 'SEO + GEO analizi', sub: 'Teknik SEO ve yapay zekâ okunabilirliği tek raporda.' },
  { scene: 'publish', n: '03', title: 'Makale yazılır, yayınlanır', sub: 'Marka sesinle yazılır, kalite kapısından geçer, sitene gider.' },
  { scene: 'measure', n: '04', title: 'AI görünürlüğü ölçülür', sub: 'ChatGPT, Gemini, Claude… seni anıyor mu? Artık biliyorsun.' },
];

function StepHeader({ frame }: { frame: number }) {
  const [, brandE] = TL.scene('brand');
  const [endS] = TL.scene('end');
  if (frame < brandE - 4 || frame >= endS) return null;
  const groupOut = ramp(frame, endS - 12, endS - 2);
  const activeIdx = STEPS.findIndex((s) => {
    const [a, b] = TL.scene(s.scene);
    return frame >= a && frame < b;
  });
  return (
    <div style={{ opacity: 1 - groupOut }}>
      {STEPS.map((s, i) => {
        const [a, b] = TL.scene(s.scene);
        if (frame < a - 2 || frame >= b + 2) return null;
        const inP = snap(frame, a + 2);
        const outP = ramp(frame, b - 6, b);
        return (
          <div key={s.n} style={{ position: 'absolute', left: CARD.x, top: 92, opacity: clamp01(inP * 1.4) * (1 - outP), transform: `translateY(${(1 - inP) * 26 - outP * 18}px)` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
              <span
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 20,
                  background: M.grad,
                  color: 'white',
                  display: 'grid',
                  placeItems: 'center',
                  fontFamily: fontDisplay,
                  fontWeight: 800,
                  fontSize: 28,
                  boxShadow: `0 10px 26px ${alpha(logo.gradTo, 0.3)}`,
                }}
              >
                {s.n}
              </span>
              <span style={{ fontFamily: fontDisplay, fontWeight: 800, fontSize: 62, letterSpacing: '-0.035em', whiteSpace: 'nowrap' }}>{s.title}</span>
            </div>
            <div style={{ fontFamily: fontUI, fontWeight: 500, fontSize: 31, color: M.body, marginTop: 14, marginLeft: 86, whiteSpace: 'nowrap' }}>{s.sub}</div>
          </div>
        );
      })}
      <div style={{ position: 'absolute', right: 1920 - (CARD.x + CARD.w), top: 120, display: 'flex', gap: 10 }}>
        {STEPS.map((s, i) => (
          <span key={s.n} style={{ width: i === activeIdx ? 46 : 14, height: 14, borderRadius: 99, background: i === activeIdx ? brand[500] : i < activeIdx ? alpha(brand[500], 0.4) : M.hairStrong }} />
        ))}
      </div>
      <div style={{ position: 'absolute', right: 1920 - (CARD.x + CARD.w), top: CARD.y - 46 }}>
        <SampleTag size={17} />
      </div>
    </div>
  );
}

/** Adim icerigi icin gorunurluk: sahne sinirlarinda 8 karelik bulanik gecis */
function useStepVis(frame: number, scene: string) {
  const [a, b] = TL.scene(scene);
  const inP = ramp(frame, a + 2, a + 10);
  const outP = ramp(frame, b - 8, b);
  const v = Math.min(inP, 1 - outP);
  return { v, a, b, style: { opacity: v, filter: v < 1 ? `blur(${(1 - v) * 8}px)` : undefined } as React.CSSProperties };
}

/* ───────────────────────── 01 Siteni bagla ───────────────────────── */

const DOMAIN = 'ornekklinik.com';
const PAGES = ['/', '/tedaviler', '/blog/dis-tasi-temizligi', '/hakkimizda', '/iletisim'];

function StepConnect({ frame }: { frame: number }) {
  const { v, style } = useStepVis(frame, 'connect');
  if (v <= 0) return null;
  const typed = typedCount(frame, TL, 'connect.type', DOMAIN.length);
  const focused = frame >= TL.at('connect.focus');
  const going = frame >= TL.at('connect.go');
  const press = frame >= TL.at('connect.go') && frame < TL.at('connect.go') + 6 ? 0.95 : 1;
  const rowsAt = ['connect.r1', 'connect.r2', 'connect.r3', 'connect.r4', 'connect.r5'].map((id) => TL.at(id));
  const crawl = ramp(frame, TL.at('connect.go') + 4, TL.at('connect.done'), Easing.inOut(Easing.quad));
  const done = frame >= TL.at('connect.done');
  const profile = snap(frame, TL.at('connect.done'));
  const list = soft(frame, TL.at('connect.go'));

  return (
    <div style={{ position: 'absolute', left: C.x, top: C.y, width: C.w, height: C.h, ...style }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 18,
          height: 96,
          padding: '0 12px 0 28px',
          borderRadius: 24,
          border: `2.5px solid ${focused ? alpha(brand[500], 0.55) : M.hairStrong}`,
          boxShadow: focused ? `0 0 0 6px ${alpha(brand[500], 0.1)}` : 'none',
          background: M.paper,
        }}
      >
        <Globe size={36} color={focused ? brand[600] : M.muted} />
        <span style={{ flex: 1, fontFamily: fontMono, fontSize: 38, fontWeight: 600, color: typed ? M.ink : M.muted }}>
          {typed ? DOMAIN.slice(0, typed) : 'siteadresin.com'}
          {focused && !going ? <span style={{ display: 'inline-block', width: 3, height: 38, marginLeft: 3, background: brand[500], verticalAlign: 'middle', opacity: Math.floor(frame / 8) % 2 ? 0.2 : 1 }} /> : null}
        </span>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 12,
            height: 72,
            padding: '0 36px',
            borderRadius: 18,
            background: M.grad,
            color: 'white',
            fontFamily: fontDisplay,
            fontWeight: 700,
            fontSize: 30,
            transform: `scale(${press})`,
          }}
        >
          {going && !done ? <Loader2 size={30} style={{ transform: `rotate(${frame * 14}deg)` }} /> : done ? <Check size={30} strokeWidth={3} /> : null}
          {done ? 'Bağlandı' : 'Bağla'}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 28, marginTop: 30, opacity: list, transform: `translateY(${(1 - list) * 24}px)` }}>
        <div style={{ flex: 1.25, height: 418, borderRadius: 24, border: `1.5px solid ${M.hair}`, padding: 28, boxSizing: 'border-box', background: M.cream }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontFamily: fontUI, fontWeight: 800, fontSize: 28 }}>{done ? 'Site tarandı' : 'Sayfalar taranıyor'}</span>
            <span style={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: 26, color: done ? M.success : brand[600], fontVariantNumeric: 'tabular-nums' }}>%{Math.round(crawl * 100)}</span>
          </div>
          <div style={{ height: 10, borderRadius: 99, background: alpha(M.ink, 0.07), margin: '16px 0 18px' }}>
            <div style={{ height: 10, borderRadius: 99, width: `${crawl * 100}%`, background: done ? M.success : brand[500] }} />
          </div>
          {PAGES.map((p, i) => {
            const on = snap(frame, rowsAt[i]);
            return (
              <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 14, height: 54, fontFamily: fontMono, fontSize: 26, color: M.inkSoft, opacity: clamp01(on * 1.5), transform: `translateX(${(1 - on) * -18}px)` }}>
                <Check size={26} color={M.success} strokeWidth={3} />
                {p}
              </div>
            );
          })}
        </div>
        <div
          style={{
            flex: 1,
            height: 418,
            borderRadius: 24,
            border: `2px solid ${alpha(brand[500], 0.35)}`,
            padding: 28,
            boxSizing: 'border-box',
            background: alpha(brand[500], 0.035),
            opacity: clamp01(profile * 1.4),
            transform: `scale(${0.94 + 0.06 * profile})`,
          }}
        >
          <div style={{ fontFamily: fontUI, fontWeight: 800, fontSize: 28, marginBottom: 20 }}>Marka profili</div>
          {[
            ['Sektör', 'Diş kliniği · İstanbul'],
            ['Marka sesi', 'Güven veren, sade'],
            ['Hedef sorular', 'diş taşı · implant · beyazlatma'],
          ].map(([k, val], i) => {
            const on = snap(frame, TL.at('connect.done') + 4 + i * 5);
            return (
              <div key={k} style={{ marginBottom: 20, opacity: clamp01(on * 1.5) }}>
                <div style={{ fontFamily: fontUI, fontSize: 21, fontWeight: 600, color: M.muted, marginBottom: 8 }}>{k}</div>
                <Chip color={brand[700]} size={23}>
                  {i === 0 ? <Sparkles size={20} /> : null}
                  {val}
                </Chip>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── 02 SEO + GEO analizi ───────────────────────── */

const CHECKS: Array<{ id: string; name: string; ok: boolean; note: string }> = [
  { id: 'analyze.c1', name: 'robots.txt', ok: true, note: 'AI botlarına açık' },
  { id: 'analyze.c2', name: 'sitemap.xml', ok: true, note: 'Bulundu' },
  { id: 'analyze.c3', name: 'llms.txt', ok: false, note: 'Eksik' },
  { id: 'analyze.c4', name: 'JSON-LD şema', ok: true, note: 'Var' },
  { id: 'analyze.c5', name: 'SSS işaretlemesi', ok: false, note: 'Eksik' },
  { id: 'analyze.c6', name: 'Başlık hiyerarşisi', ok: true, note: 'Düzenli' },
];

function StepAnalyze({ frame }: { frame: number }) {
  const { v, a, style } = useStepVis(frame, 'analyze');
  if (v <= 0) return null;
  const ringP = ramp(frame, a + 10, TL.at('analyze.c6') + 6, Easing.inOut(Easing.quad)) * 0.74;
  const grade = snap(frame, TL.at('analyze.c6') + 10);
  const fix = snap(frame, TL.at('analyze.fix'));
  const R = 118;
  const circ = 2 * Math.PI * R;
  return (
    <div style={{ position: 'absolute', left: C.x, top: C.y, width: C.w, height: C.h, display: 'flex', gap: 36, ...style }}>
      <div style={{ width: 360, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18, borderRadius: 24, background: M.cream, border: `1.5px solid ${M.hair}` }}>
        <div style={{ position: 'relative', width: 280, height: 280 }}>
          <svg width={280} height={280} style={{ position: 'absolute', inset: 0 }}>
            <circle cx={140} cy={140} r={R} fill="none" stroke={alpha(M.ink, 0.07)} strokeWidth={18} />
            <circle cx={140} cy={140} r={R} fill="none" stroke={brand[500]} strokeWidth={18} strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={circ * (1 - ringP)} transform="rotate(-90 140 140)" />
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
            <span style={{ fontFamily: fontDisplay, fontWeight: 800, fontSize: 132, letterSpacing: '-0.05em', color: M.ink, opacity: clamp01(grade * 1.5), transform: `scale(${0.7 + 0.3 * grade})` }}>B</span>
          </div>
        </div>
        <div style={{ fontFamily: fontUI, fontWeight: 800, fontSize: 28 }}>Site Skoru</div>
        <SampleTag size={16} label="Örnek rapor" />
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 9 }}>
        {CHECKS.map((c) => {
          const on = snap(frame, TL.at(c.id));
          const col = c.ok ? M.success : M.warn;
          return (
            <div
              key={c.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 18,
                height: 64,
                padding: '0 22px',
                borderRadius: 18,
                border: `1.5px solid ${c.ok ? M.hair : alpha(M.warn, 0.35)}`,
                background: c.ok ? M.paper : alpha(M.warn, 0.05),
                opacity: clamp01(on * 1.5),
                transform: `translateX(${(1 - on) * 30}px)`,
              }}
            >
              <span style={{ width: 40, height: 40, borderRadius: 99, display: 'grid', placeItems: 'center', background: alpha(col, 0.12), color: col }}>
                {c.ok ? <Check size={24} strokeWidth={3} /> : <CircleAlert size={24} strokeWidth={2.6} />}
              </span>
              <span style={{ fontFamily: c.name.includes('.') ? fontMono : fontUI, fontWeight: 700, fontSize: 27 }}>{c.name}</span>
              <span style={{ marginLeft: 'auto', fontFamily: fontUI, fontWeight: 700, fontSize: 23, color: col }}>{c.note}</span>
            </div>
          );
        })}
        <div
          style={{
            marginTop: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            height: 76,
            padding: '0 24px',
            borderRadius: 18,
            background: alpha(brand[500], 0.1),
            color: brand[800],
            fontFamily: fontUI,
            fontWeight: 800,
            fontSize: 26,
            opacity: clamp01(fix * 1.5),
            transform: `translateY(${(1 - fix) * 20}px)`,
          }}
        >
          <Sparkles size={28} color={brand[600]} />
          2 düzeltme önerisi hazır — önizle, onayla, uygula
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── 03 Makale ───────────────────────── */

const PIPE = ['Anahtar kelime', 'Taslak', 'Yazar', 'Editör', 'Görsel'];
const TARGETS = ['WordPress', 'FTP / SFTP', 'cPanel', 'Ghost', 'Webflow', 'GitHub'];
const DAYS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
const TOPICS: Array<[number, string]> = [
  [0, 'Diş taşı'],
  [2, 'İmplant'],
  [3, 'Beyazlatma'],
  [5, 'Diş eti'],
  [6, 'Kanal'],
];

function StepPublish({ frame }: { frame: number }) {
  const { v, style } = useStepVis(frame, 'publish');
  if (v <= 0) return null;
  const stepAt = ['publish.s1', 'publish.s2', 'publish.s3', 'publish.s4', 'publish.s5'].map((id) => TL.at(id));
  const gate = snap(frame, TL.at('publish.gate'));
  const sendT = ramp(frame, TL.at('publish.send') - 4, TL.at('publish.done') - 2, MORPH);
  const done = frame >= TL.at('publish.done');
  const toast = snap(frame, TL.at('publish.done'));
  const lines = ramp(frame, stepAt[1], stepAt[4] + 6, Easing.linear);
  const cal = TL.at('publish.calendar');
  // ucan mini kart: makale kartindan WordPress cipine
  const fx0 = C.x + 300;
  const fy0 = C.y + 230;
  const fx1 = C.x + 660 + 115;
  const fy1 = C.y + 84 + 52 + 28;
  const arc = Math.sin(sendT * Math.PI) * -90;
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width: 1920, height: 1080, ...style }}>
      <div style={{ position: 'absolute', left: C.x, top: C.y, width: C.w, display: 'flex', alignItems: 'center', gap: 10 }}>
        {PIPE.map((p, i) => {
          const on = frame >= stepAt[i];
          const pop = snap(frame, stepAt[i]);
          return (
            <React.Fragment key={p}>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  height: 52,
                  padding: '0 18px',
                  borderRadius: 999,
                  fontFamily: fontUI,
                  fontWeight: 700,
                  fontSize: 22,
                  whiteSpace: 'nowrap',
                  border: `1.5px solid ${on ? alpha(M.success, 0.4) : M.hair}`,
                  background: on ? alpha(M.success, 0.08) : M.paper,
                  color: on ? M.success : M.muted,
                  transform: `scale(${on ? 1 + 0.08 * Math.sin(clamp01(pop) * Math.PI) : 1})`,
                }}
              >
                {on ? <Check size={20} strokeWidth={3} /> : null}
                {p}
              </span>
              {i < PIPE.length - 1 ? <ArrowRight size={20} color={M.muted} /> : null}
            </React.Fragment>
          );
        })}
      </div>

      <div
        style={{
          position: 'absolute',
          left: C.x,
          top: C.y + 84,
          width: 620,
          height: 318,
          borderRadius: 22,
          border: `1.5px solid ${M.hair}`,
          background: M.cream,
          padding: 26,
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div style={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: 30, lineHeight: 1.2, letterSpacing: '-0.02em' }}>Diş taşı temizliği ne sıklıkla yapılmalı?</div>
        {[0.95, 0.86, 0.92, 0.7, 0.88].map((w, i) => {
          const g = clamp01(lines * 5 - i);
          return <div key={i} style={{ height: 12, borderRadius: 99, background: alpha(M.ink, 0.08), width: `${w * 100 * g}%` }} />;
        })}
        <div style={{ display: 'flex', gap: 10, marginTop: 'auto', alignItems: 'center' }}>
          {['SSS', 'Schema.org', 'Kapak görseli'].map((t, i) => (
            <Chip key={t} color={brand[700]} size={18} style={{ opacity: ramp(frame, stepAt[4] + i * 3, stepAt[4] + 6 + i * 3) }}>
              {t}
            </Chip>
          ))}
          <Chip color={M.success} size={19} style={{ marginLeft: 'auto', opacity: clamp01(gate * 1.5), transform: `scale(${0.8 + 0.2 * gate})` }}>
            <Check size={18} strokeWidth={3} /> Kalite kapısı
          </Chip>
        </div>
      </div>

      <div style={{ position: 'absolute', left: C.x + 660, top: C.y + 84, width: C.w - 660 }}>
        <div style={{ fontFamily: fontUI, fontWeight: 700, fontSize: 21, color: M.muted, marginBottom: 12 }}>Yayın hedefi</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {TARGETS.map((t, i) => {
            const sel = i === 0;
            const live = sel && done;
            return (
              <div
                key={t}
                style={{
                  height: 56,
                  borderRadius: 16,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '0 18px',
                  fontFamily: fontUI,
                  fontWeight: 700,
                  fontSize: 22,
                  border: `2px solid ${live ? alpha(M.success, 0.5) : sel ? alpha(brand[500], 0.5) : M.hair}`,
                  background: live ? alpha(M.success, 0.08) : sel ? alpha(brand[500], 0.06) : M.paper,
                  color: live ? M.success : sel ? M.ink : M.body,
                  transform: `scale(${live ? 1 + 0.06 * Math.sin(clamp01(toast) * Math.PI) : 1})`,
                }}
              >
                {live ? <Check size={20} strokeWidth={3} /> : null}
                {t}
              </div>
            );
          })}
        </div>
        <div
          style={{
            marginTop: 18,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '14px 18px',
            borderRadius: 16,
            background: M.ink,
            color: 'white',
            fontFamily: fontUI,
            fontWeight: 700,
            fontSize: 21,
            opacity: clamp01(toast * 1.5),
            transform: `translateY(${(1 - toast) * 16}px)`,
          }}
        >
          <Check size={22} color="#7ee2a8" strokeWidth={3} />
          Yayınlandı · {DOMAIN}/blog
        </div>
      </div>

      {sendT > 0 && sendT < 1 ? (
        <div
          style={{
            position: 'absolute',
            left: fx0 + (fx1 - fx0) * sendT - 60,
            top: fy0 + (fy1 - fy0) * sendT + arc - 40,
            width: 120,
            height: 80,
            borderRadius: 14,
            background: M.paper,
            border: `2px solid ${alpha(brand[500], 0.5)}`,
            boxShadow: `0 16px 30px ${alpha(M.ink, 0.15)}`,
            transform: `scale(${1 - 0.4 * sendT}) rotate(${-8 * Math.sin(sendT * Math.PI)}deg)`,
            padding: 12,
            boxSizing: 'border-box',
          }}
        >
          {[0.9, 0.7, 0.8].map((w, i) => (
            <div key={i} style={{ height: 8, borderRadius: 99, background: i === 0 ? brand[400] : alpha(M.ink, 0.12), width: `${w * 100}%`, marginBottom: 8 }} />
          ))}
        </div>
      ) : null}

      <div style={{ position: 'absolute', left: C.x, top: C.y + 428, width: C.w, height: 116, display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ width: 210, fontFamily: fontUI, fontWeight: 800, fontSize: 22, lineHeight: 1.25, color: M.inkSoft }}>
          Otomatik akış
          <div style={{ fontWeight: 600, fontSize: 19, color: M.muted }}>konu takvimi</div>
        </div>
        {DAYS.map((d, i) => {
          const topic = TOPICS.find(([di]) => di === i);
          const p = topic ? snap(frame, cal, 30, 6) : 0;
          return (
            <div key={d} style={{ flex: '1 1 0', minWidth: 0, height: 104, borderRadius: 16, border: `1.5px solid ${M.hair}`, background: M.cream, padding: 10, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontFamily: fontUI, fontWeight: 700, fontSize: 17, color: M.muted }}>{d}</span>
              {topic ? (
                <span
                  style={{
                    fontFamily: fontUI,
                    fontWeight: 700,
                    fontSize: 17,
                    padding: '8px 8px',
                    borderRadius: 10,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    background: i === 0 && done ? alpha(M.success, 0.12) : alpha(brand[500], 0.12),
                    color: i === 0 && done ? M.success : brand[800],
                    opacity: clamp01(p * 1.6),
                    transform: `translateY(${(1 - p) * -60}px) scale(${0.8 + 0.2 * p})`,
                  }}
                >
                  {topic[1]}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ───────────────────────── 04 AI gorunurlugu ───────────────────────── */

function StepMeasure({ frame }: { frame: number }) {
  const { v, style } = useStepVis(frame, 'measure');
  if (v <= 0) return null;
  const clicked = frame >= TL.at('measure.click');
  const press = clicked && frame < TL.at('measure.click') + 6 ? 0.95 : 1;
  const rowAt = ['measure.e1', 'measure.e2', 'measure.e3', 'measure.e4', 'measure.e5', 'measure.e6'].map((id) => TL.at(id));
  const foot = snap(frame, TL.at('measure.done'));
  return (
    <div style={{ position: 'absolute', left: C.x, top: C.y, width: C.w, height: C.h, ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, height: 72 }}>
        <div style={{ flex: 1, height: 72, borderRadius: 18, background: M.cream, border: `1.5px solid ${M.hair}`, display: 'flex', alignItems: 'center', gap: 14, padding: '0 22px', boxSizing: 'border-box' }}>
          <span style={{ fontFamily: fontUI, fontWeight: 700, fontSize: 20, color: M.muted }}>Soru</span>
          <span style={{ fontFamily: fontUI, fontWeight: 700, fontSize: 25, color: M.inkSoft, whiteSpace: 'nowrap' }}>“Kadıköy’de diş taşı temizliği nerede yaptırılır?”</span>
        </div>
        <div
          style={{
            width: 240,
            height: 72,
            borderRadius: 18,
            background: M.grad,
            color: 'white',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            fontFamily: fontDisplay,
            fontWeight: 700,
            fontSize: 26,
            transform: `scale(${press})`,
          }}
        >
          <RefreshCw size={26} style={{ transform: `rotate(${clicked && frame < rowAt[5] ? (frame - TL.at('measure.click')) * 14 : 0}deg)` }} />
          Yeniden Test
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 24 }}>
        {ENGINES.map((e, i) => {
          const res = SAMPLE_RESULT[i];
          const meta = mentionMeta[res];
          const shown = frame >= rowAt[i];
          const p = snap(frame, rowAt[i]);
          const asking = clicked && !shown;
          return (
            <div key={e} style={{ display: 'flex', alignItems: 'center', gap: 20, height: 58, padding: '0 20px', borderRadius: 16, background: shown && res !== 'none' ? alpha(meta.color, 0.06) : M.paper, border: `1.5px solid ${M.hair}` }}>
              <span style={{ width: 170, fontFamily: fontUI, fontWeight: 800, fontSize: 25 }}>{e}</span>
              <div style={{ flex: 1, height: 12, borderRadius: 99, background: alpha(M.ink, 0.07) }}>
                <div style={{ height: 12, borderRadius: 99, width: `${(shown ? Math.max(4, meta.score) : 0) * clamp01(p)}%`, background: res === 'none' ? alpha(M.ink, 0.2) : meta.color }} />
              </div>
              <span style={{ width: 230, fontFamily: fontUI, fontWeight: 700, fontSize: 22, color: shown ? meta.color : M.muted, display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
                {asking ? <Loader2 size={22} style={{ transform: `rotate(${frame * 12}deg)` }} /> : null}
                {shown ? meta.label : asking ? 'Soruluyor…' : '—'}
              </span>
              <span style={{ width: 64, textAlign: 'right', fontFamily: fontDisplay, fontWeight: 700, fontSize: 26, color: shown ? M.ink : M.muted, opacity: shown ? clamp01(p * 1.5) : 0.4 }}>{shown ? meta.score : ''}</span>
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 20, opacity: clamp01(foot * 1.5), transform: `translateY(${(1 - foot) * 14}px)` }}>
        <Chip color={brand[700]} size={21}>
          <RefreshCw size={18} /> Haftada bir ölç · her sonuç kaydedilir
        </Chip>
        <span style={{ marginLeft: 'auto', fontFamily: fontUI, fontWeight: 600, fontSize: 20, color: M.muted }}>URL alıntısı 100 · marka adı 50 · yok 0</span>
      </div>
    </div>
  );
}

/* ───────────────────────── Kapanis ───────────────────────── */

function EndCard({ frame }: { frame: number }) {
  const [endS] = TL.scene('end');
  if (frame < endS) return null;
  const w = snap(frame, endS + 8);
  const cta = snap(frame, TL.at('end.cta'));
  const url = snap(frame, TL.at('end.url'));
  const note = soft(frame, TL.at('end.url') + 6);
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, top: 380, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 44 }}>
      <div style={{ opacity: clamp01(w * 1.4), transform: `translateY(${(1 - w) * 24}px)` }}>
        <Wordmark size={112} theme={light} />
      </div>
      <div style={{ opacity: clamp01(cta * 1.5), transform: `scale(${0.7 + 0.3 * cta})` }}>
        <CtaButton size={48}>
          2 makale ücretsiz dene <ArrowRight size={46} strokeWidth={2.8} />
        </CtaButton>
      </div>
      <div style={{ fontFamily: fontDisplay, fontWeight: 800, fontSize: 64, letterSpacing: '-0.035em', opacity: clamp01(url * 1.5), transform: `translateY(${(1 - url) * 20}px)` }}>ranksup.ai</div>
      <div style={{ marginTop: -24, fontFamily: fontUI, fontWeight: 600, fontSize: 30, color: M.body, opacity: note }}>Kart gerekmez · İstediğin zaman iptal</div>
    </div>
  );
}

/* ───────────────────────── Imlec ───────────────────────── */

function IntroCursor({ frame }: { frame: number }) {
  const focus = TL.at('connect.focus');
  const go = TL.at('connect.go');
  const mclick = TL.at('measure.click');
  const field: [number, number] = [C.x + 420, C.y + 52];
  const button: [number, number] = [C.x + C.w - 112, C.y + 50];
  const test: [number, number] = [C.x + C.w - 120, C.y + 40];
  if (frame < focus - 20 || frame > mclick + 40) return null;
  if (frame > go + 30 && frame < mclick - 26) return null;
  const path: Array<[number, number, number]> =
    frame < mclick - 26
      ? [
          [focus - 20, 1480, 820],
          [focus - 2, field[0], field[1]],
          [focus + 10, field[0] + 60, field[1] + 70],
          [go - 12, field[0] + 300, field[1] + 70],
          [go - 1, button[0], button[1]],
          [go + 30, button[0] + 80, button[1] + 260],
        ]
      : [
          [mclick - 26, 1500, 900],
          [mclick - 2, test[0], test[1]],
          [mclick + 40, test[0] + 60, test[1] + 220],
        ];
  return <Cursor frame={frame} path={path} clicks={[focus, go, mclick]} visibleFrom={frame < mclick - 26 ? focus - 20 : mclick - 26} visibleTo={frame < mclick - 26 ? go + 30 : mclick + 40} />;
}
