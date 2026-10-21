import React from 'react';
import { AbsoluteFill, Easing, useCurrentFrame } from 'remotion';
import { ArrowRight, Check, FileText, Globe, Package, ShieldCheck } from 'lucide-react';
import { alpha, brand, light } from '../tokens';
import { LogoMark, Wordmark } from '../ui';
import { BigLine, Chip, CtaButton, GradText, M, SampleTag, Soundtrack, Stage, clamp01, fontDisplay, fontUI, ramp, snap, soft, useBrandFonts } from '../marketing/kit';
import { timeline } from '../marketing/timeline';
import type { MarketingProps } from '../marketing/ProductIntro';
import { Phone, SourceTile, VerticalExample, appear, phoneWidth, type SourceKind } from './parts';

/**
 * VideoLaunchVertical — RanksUp Video duyurusu, 1080×1920 @30, 15 sn (Reels / TikTok / LinkedIn).
 * Her kesme vurusta (timeline.json 'VideoLaunchVertical'). Guvenli alan SocialAd ile ayni:
 * metin ve arayuz x 90–950, y 250–1500 (sagdaki dugme sutunu ve alttaki aciklama alani bos).
 */

const TL = timeline('VideoLaunchVertical');
export const VIDEO_LAUNCH_VERTICAL_DURATION = TL.durationInFrames;

const SAFE = { left: 90, right: 950, top: 250, bottom: 1500 } as const;
const W = SAFE.right - SAFE.left; // 860

export const VideoLaunchVertical: React.FC<MarketingProps> = ({ muted = false }) => {
  useBrandFonts();
  const frame = useCurrentFrame();
  return (
    <Stage>
      <Soundtrack tl={TL} muted={muted} />
      <Hook frame={frame} />
      <BrandLock frame={frame} />
      <Example frame={frame} kind="article" />
      <Example frame={frame} kind="site" />
      <Example frame={frame} kind="product" />
      <Flow frame={frame} />
      <End frame={frame} />
    </Stage>
  );
};

/* ───────────── 0-2.5 sn: kanca ───────────── */

const WORDS: Array<{ kind: SourceKind; word: string; ev: string }> = [
  { kind: 'article', word: 'Makalen.', ev: 'hook.w1' },
  { kind: 'site', word: 'Siten.', ev: 'hook.w2' },
  { kind: 'product', word: 'Ürünün.', ev: 'hook.w3' },
];

function Hook({ frame }: { frame: number }) {
  const [, e] = TL.scene('hook');
  if (frame >= e) return null;
  const out = ramp(frame, e - 8, e - 1, Easing.in(Easing.cubic));
  const line = TL.at('hook.line');
  const ph = 400;
  const pw = phoneWidth(ph);
  const fan = [
    { x: 540 - 230, rot: -9, z: 1, offset: 34 },
    { x: 540, rot: 0, z: 3, offset: 40 },
    { x: 540 + 230, rot: 9, z: 2, offset: 52 },
  ];
  return (
    <AbsoluteFill style={{ opacity: 1 - out, transform: `translateY(${-out * 80}px)` }}>
      <div style={{ position: 'absolute', left: SAFE.left, top: 270 }}>
        {WORDS.map((w, i) => {
          const at = TL.at(w.ev) - (i === 0 ? 4 : 0);
          const p = snap(frame, at);
          return (
            <div key={w.kind} style={{ display: 'flex', alignItems: 'center', gap: 30, height: 150, opacity: clamp01(p * 1.6), transform: `translateY(${(1 - p) * 50}px)` }}>
              <SourceTile kind={w.kind} size={112} flipAt={line} frame={frame} />
              <span style={{ fontFamily: fontDisplay, fontWeight: 800, fontSize: 124, letterSpacing: '-0.035em', lineHeight: 1 }}>{w.word}</span>
            </div>
          );
        })}
        <div style={{ marginTop: 40 }}>
          <BigLine frame={frame} at={line} size={100}>
            Artık <GradText>videosu</GradText>
          </BigLine>
          <BigLine frame={frame} at={line + 2} size={100}>
            <GradText>da hazır.</GradText>
          </BigLine>
        </div>
      </div>
      {fan.map((f, i) => {
        const at = TL.at(WORDS[i].ev);
        if (frame < at - 6) return null;
        const p = snap(frame, at, 30, 6);
        return (
          <div
            key={i}
            style={{ position: 'absolute', left: f.x - pw / 2, top: 1090, zIndex: f.z, opacity: clamp01(p * 1.6), transform: `translateY(${(1 - p) * 140}px) rotate(${f.rot * p}deg)`, transformOrigin: '50% 100%' }}
          >
            <Phone height={ph} style={{ position: 'relative' }}>
              <VerticalExample kind={WORDS[i].kind} frame={frame} start={at} offset={f.offset} rate={1.2} />
            </Phone>
          </div>
        );
      })}
    </AbsoluteFill>
  );
}

/* ───────────── 2.5-3.5 sn: RanksUp Video ───────────── */

function BrandLock({ frame }: { frame: number }) {
  const [s, e] = TL.scene('brand');
  if (frame < s || frame >= e) return null;
  const tile = snap(frame, s);
  const word = snap(frame, s + 3);
  const vid = snap(frame, s + 6);
  const out = ramp(frame, e - 7, e - 1, Easing.in(Easing.cubic));
  return (
    <div style={{ position: 'absolute', left: SAFE.left, width: W, top: 520, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 50, opacity: 1 - out, transform: `scale(${1 - out * 0.06})` }}>
      <div style={{ transform: `scale(${tile})` }}>
        <LogoMark size={210} />
      </div>
      <div style={{ opacity: clamp01(word * 1.5), transform: `translateY(${(1 - word) * 30}px)` }}>
        <Wordmark size={132} theme={light} />
      </div>
      <div style={{ marginTop: -20, fontFamily: fontDisplay, fontWeight: 800, fontSize: 168, letterSpacing: '-0.04em', lineHeight: 1, opacity: clamp01(vid * 1.5), transform: `scale(${1.15 - 0.15 * vid})` }}>
        <GradText>Video</GradText>
      </div>
    </div>
  );
}

/* ───────────── 3.5-9.5 sn: uc ornek ───────────── */

const META: Record<SourceKind, { n: string; title: string; sub: string; offset: number; Icon: typeof FileText }> = {
  article: { n: '1', title: 'Makalenden', sub: '15 sn dikey video', offset: 22, Icon: FileText },
  site: { n: '2', title: 'Sitenden', sub: '15 sn dikey · 24 sn yatay', offset: 12, Icon: Globe },
  product: { n: '3', title: 'Ürününden', sub: 'Ürün ya da hizmet sayfandan', offset: 12, Icon: Package },
};

function Example({ frame, kind }: { frame: number; kind: SourceKind }) {
  const [s, e] = TL.scene(kind);
  if (frame < s - 1 || frame >= e) return null;
  const m = META[kind];
  const inP = snap(frame, s, 30, 5);
  const out = ramp(frame, e - 7, e - 1, Easing.in(Easing.cubic));
  const phoneAt = TL.at(`${kind}.phone`);
  const phone = snap(frame, phoneAt);
  const ph = 900;
  const pw = phoneWidth(ph);
  return (
    <div style={{ position: 'absolute', inset: 0, opacity: 1 - out, transform: `translateX(${(1 - inP) * 140 - out * 140}px)` }}>
      <div style={{ position: 'absolute', left: SAFE.left, width: W, top: 262, display: 'flex', alignItems: 'center', justifyContent: 'space-between', opacity: clamp01(inP * 1.5) }}>
        <Chip color={brand[700]} size={28}>
          <m.Icon size={28} /> {m.n}/3
        </Chip>
        <SampleTag size={24} label="Örnek çıktı · kobipratik.com" />
      </div>
      <div style={{ position: 'absolute', left: SAFE.left, top: 330 }}>
        <BigLine frame={frame} at={s} size={104}>
          <GradText>{m.title}</GradText>
        </BigLine>
        <div style={{ marginTop: 8, fontFamily: fontUI, fontWeight: 700, fontSize: 40, color: M.body, opacity: soft(frame, s + 4) }}>{m.sub}</div>
      </div>
      {frame >= phoneAt - 6 ? (
        <div style={{ position: 'absolute', left: 540 - pw / 2, top: 580, opacity: clamp01(phone * 1.6), transform: `translateY(${(1 - phone) * 120}px) scale(${0.92 + 0.08 * phone})` }}>
          <Phone height={ph} style={{ position: 'relative' }}>
            <VerticalExample kind={kind} frame={frame} start={phoneAt} offset={m.offset} rate={1.6} />
          </Phone>
        </div>
      ) : null}
    </div>
  );
}

/* ───────────── 9.5-11.5 sn: uc adim ───────────── */

const STEPS: Array<{ ev: string; title: string; sub: string }> = [
  { ev: 'flow.s1', title: 'Kaynağı seç', sub: 'Makale, site ya da ürün sayfası' },
  { ev: 'flow.s2', title: 'Markanı kontrol et', sub: 'Ad, logo ve renk sitenden okunur' },
  { ev: 'flow.s3', title: 'Video hazır', sub: 'İzle, MP4 olarak indir' },
];

function Flow({ frame }: { frame: number }) {
  const [s, e] = TL.scene('flow');
  if (frame < s - 1 || frame >= e) return null;
  const out = ramp(frame, e - 7, e - 1, Easing.in(Easing.cubic));
  const trust = appear(frame, TL.at('flow.s3') + 8);
  return (
    <div style={{ position: 'absolute', inset: 0, opacity: 1 - out, transform: `translateY(${-out * 60}px)` }}>
      <div style={{ position: 'absolute', left: SAFE.left, top: 290 }}>
        <BigLine frame={frame} at={s} size={104}>
          Üç adımda
        </BigLine>
        <BigLine frame={frame} at={s + 3} size={104}>
          <GradText>hazır.</GradText>
        </BigLine>
      </div>
      {STEPS.map((st, i) => {
        const p = snap(frame, TL.at(st.ev));
        const done = i === 2;
        return (
          <div
            key={st.ev}
            style={{
              position: 'absolute',
              left: SAFE.left,
              top: 580 + i * 200,
              width: W,
              height: 170,
              boxSizing: 'border-box',
              display: 'flex',
              alignItems: 'center',
              gap: 30,
              padding: '0 36px',
              borderRadius: 34,
              background: M.paper,
              border: `2px solid ${done ? alpha(M.success, 0.35) : M.hair}`,
              boxShadow: `0 24px 60px ${alpha(M.ink, 0.08)}`,
              opacity: clamp01(p * 1.6),
              transform: `translateX(${(1 - p) * 80}px)`,
            }}
          >
            <span style={{ width: 84, height: 84, borderRadius: 26, flexShrink: 0, display: 'grid', placeItems: 'center', background: done ? M.success : M.grad, color: 'white', fontFamily: fontDisplay, fontWeight: 800, fontSize: 44 }}>
              {done ? <Check size={48} strokeWidth={3.2} /> : i + 1}
            </span>
            <div>
              <div style={{ fontFamily: fontDisplay, fontWeight: 800, fontSize: 52, letterSpacing: '-0.03em', lineHeight: 1.1, whiteSpace: 'nowrap' }}>{st.title}</div>
              <div style={{ marginTop: 6, fontFamily: fontUI, fontWeight: 700, fontSize: 32, color: M.body, whiteSpace: 'nowrap' }}>{st.sub}</div>
            </div>
          </div>
        );
      })}
      <div style={{ position: 'absolute', left: SAFE.left, width: W, top: 1210, display: 'flex', alignItems: 'center', gap: 20, opacity: trust.opacity, transform: `translateY(${(1 - trust.p) * 30}px)` }}>
        <ShieldCheck size={56} color={M.success} style={{ flexShrink: 0 }} />
        <span style={{ fontFamily: fontUI, fontWeight: 800, fontSize: 38, lineHeight: 1.25, color: M.inkSoft }}>
          Metni AI yazar;
          <br />
          her sayı kaynağında birebir geçer.
        </span>
      </div>
    </div>
  );
}

/* ───────────── 11.5-15 sn: kapanis ───────────── */

function End({ frame }: { frame: number }) {
  const [s] = TL.scene('end');
  if (frame < s) return null;
  const tile = snap(frame, s);
  const word = snap(frame, s + 5);
  const cta = snap(frame, TL.at('end.cta'));
  const url = appear(frame, TL.at('end.url'));
  const plan = appear(frame, TL.at('end.plan'));
  return (
    <div style={{ position: 'absolute', left: SAFE.left, width: W, top: 300, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ transform: `scale(${tile})` }}>
        <LogoMark size={180} />
      </div>
      <div style={{ marginTop: 50, display: 'flex', flexDirection: 'column', alignItems: 'center', opacity: clamp01(word * 1.5), transform: `translateY(${(1 - word) * 24}px)` }}>
        <Wordmark size={120} theme={light} />
        <div style={{ marginTop: 6, fontFamily: fontDisplay, fontWeight: 800, fontSize: 150, letterSpacing: '-0.04em', lineHeight: 1.05 }}>
          <GradText>Video</GradText>
        </div>
      </div>
      <div style={{ marginTop: 60, opacity: clamp01(cta * 1.5), transform: `scale(${0.7 + 0.3 * cta})` }}>
        <CtaButton size={60}>
          Hemen dene <ArrowRight size={58} strokeWidth={2.8} />
        </CtaButton>
      </div>
      <div style={{ marginTop: 40, fontFamily: fontDisplay, fontWeight: 800, fontSize: 76, letterSpacing: '-0.035em', opacity: url.opacity, transform: `translateY(${(1 - url.p) * 20}px)` }}>ranksup.ai</div>
      <div style={{ marginTop: 34, textAlign: 'center', fontFamily: fontUI, fontWeight: 700, fontSize: 36, lineHeight: 1.35, color: M.body, opacity: plan.opacity }}>
        Profesyonel ve üstü planlarda
        <br />
        {/* apps/api/src/billing/plans.ts VIDEOS_PER_MONTH.pro */}
        Profesyonel’de ayda 20 video
      </div>
    </div>
  );
}
