import React from 'react';
import { AbsoluteFill, Easing, useCurrentFrame } from 'remotion';
import { ArrowRight, Check, CircleAlert, Globe, Sparkles } from 'lucide-react';
import { alpha, brand, light } from '../tokens';
import { LogoMark, Wordmark } from '../ui';
import {
  BigLine,
  Chip,
  CtaButton,
  ENGINES,
  GradText,
  LogoTileReversed,
  M,
  SAMPLE_RESULT,
  SampleTag,
  Soundtrack,
  Stage,
  WordmarkMono,
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
import { ChatContent, type MarketingProps } from './ProductIntro';
import { timeline, typedCount } from './timeline';

/**
 * SocialAd — 1080×1920 dikey (Reels / TikTok / Shorts), 15 sn, her kesme vurusta.
 *
 * Guvenli alan: ust 250 px, alt 420 px (aciklama + dugmeler), sag 130 px (begeni/yorum sutunu).
 * Tum metin ve arayuz x 90–950, y 250–1500 icinde kalir.
 */

const TL = timeline('SocialAd');
export const SOCIAL_AD_DURATION = TL.durationInFrames;

export const SAFE = { left: 90, right: 950, top: 250, bottom: 1500 } as const;
const W = SAFE.right - SAFE.left; // 860

export const SocialAd: React.FC<MarketingProps> = ({ muted = false }) => {
  useBrandFonts();
  const frame = useCurrentFrame();
  return (
    <Stage>
      <Soundtrack tl={TL} muted={muted} />
      <Words frame={frame} />
      <Chat frame={frame} />
      <Feature frame={frame} scene="f1" l1="Siteni bağla," l2="analiz etsin.">
        <F1 frame={frame} />
      </Feature>
      <Feature frame={frame} scene="f2" l1="Makaleyi yazsın," l2="yayınlasın.">
        <F2 frame={frame} />
      </Feature>
      <Feature frame={frame} scene="f3" l1="Seni hangi AI" l2="anıyor, ölçsün.">
        <F3 frame={frame} />
      </Feature>
      <Flood frame={frame} />
      <End frame={frame} />
    </Stage>
  );
};

/* ───────────── 0-2 sn: kinetik kelimeler ───────────── */

function Words({ frame }: { frame: number }) {
  const [, e] = TL.scene('words');
  if (frame >= e + 4) return null;
  const out = ramp(frame, e - 4, e + 4, Easing.in(Easing.cubic));
  const ids = ['words.w1', 'words.w2', 'words.w3', 'words.w4'];
  const words: React.ReactNode[] = ['Müşterin', 'artık', <GradText key="g">yapay zekâya</GradText>, 'soruyor.'];
  return (
    <div style={{ position: 'absolute', left: SAFE.left, top: 560, opacity: 1 - out, transform: `translateY(${-out * 120}px)` }}>
      {words.map((w, i) => (
        <BigLine key={i} frame={frame} at={TL.at(ids[i]) - (i === 0 ? 6 : 0)} size={136} from="pop">
          {w}
        </BigLine>
      ))}
    </div>
  );
}

/* ───────────── 2-4 sn: sohbet + kanca sorusu ───────────── */

function Chat({ frame }: { frame: number }) {
  const [s, e] = TL.scene('chat');
  if (frame < s - 4 || frame >= e + 2) return null;
  const card = snap(frame, s);
  return (
    <>
      <div style={{ position: 'absolute', left: SAFE.left, top: 290 }}>
        <BigLine frame={frame} at={TL.at('chat.line')} size={112}>
          Cevapta
        </BigLine>
        <BigLine frame={frame} at={TL.at('chat.line') + 3} size={112}>
          <GradText>sen var mısın?</GradText>
        </BigLine>
      </div>
      <div
        style={{
          position: 'absolute',
          left: SAFE.left,
          top: 640,
          width: W,
          height: 860,
          borderRadius: 44,
          background: M.paper,
          border: `1.5px solid ${M.hair}`,
          boxShadow: `0 40px 90px ${alpha(M.ink, 0.12)}`,
          overflow: 'hidden',
          opacity: clamp01(card * 1.5),
          transform: `translateY(${(1 - card) * 160}px)`,
        }}
      >
        <div style={{ position: 'absolute', inset: 0, zoom: 1.4 } as React.CSSProperties}>
          <ChatContent
            frame={frame}
            fadeOut={0}
            times={{ ask: TL.at('chat.ask'), a1: TL.at('chat.a1'), a2: TL.at('chat.a2'), a3: TL.at('chat.a3'), slot: TL.at('chat.slot') }}
          />
        </div>
      </div>
    </>
  );
}

/* ───────────── 4-5 sn: turuncu taskin + marka ───────────── */

function Flood({ frame }: { frame: number }) {
  const [s, e] = TL.scene('brand');
  if (frame < s - 8 || frame >= e + 8) return null;
  // bos "Senin kliniğin?" satirindan buyuyen daire; vurus karesinde ekranin ~%80'i kapali
  const grow = ramp(frame, s - 6, s + 4, Easing.bezier(0.45, 0, 0.15, 1));
  const lift = ramp(frame, e - 4, e + 6, Easing.in(Easing.cubic));
  // 'Senin kliniğin?' satirinin merkezi (sohbet karti zoom 1.4 ile)
  const cx = 520;
  const cy = 1404;
  const r = grow * 2400;
  const logoP = snap(frame, s + 2);
  const word = snap(frame, s + 6);
  const tag = soft(frame, s + 12);
  return (
    <AbsoluteFill style={{ transform: `translateY(${-lift * 1920}px)` }}>
      <AbsoluteFill style={{ background: M.grad, clipPath: `circle(${r}px at ${cx}px ${cy}px)` }} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: 640, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 56 }}>
        <div style={{ transform: `scale(${logoP})` }}>
          <LogoTileReversed size={210} />
        </div>
        <div style={{ opacity: clamp01(word * 1.5), transform: `translateY(${(1 - word) * 30}px)` }}>
          <WordmarkMono size={132} />
        </div>
        <div style={{ fontFamily: fontDisplay, fontWeight: 600, fontSize: 50, color: 'rgba(255,255,255,0.92)', letterSpacing: '-0.02em', opacity: tag }}>AI çağının pazarlama platformu</div>
      </div>
    </AbsoluteFill>
  );
}

/* ───────────── 5-11 sn: uc ozellik ───────────── */

function Feature({ frame, scene, l1, l2, children }: { frame: number; scene: string; l1: string; l2: string; children: React.ReactNode }) {
  const [s, e] = TL.scene(scene);
  if (frame < s - 6 || frame >= e + 2) return null;
  const inP = snap(frame, s, 30, 5);
  const out = ramp(frame, e - 6, e, Easing.in(Easing.cubic));
  return (
    <div style={{ position: 'absolute', inset: 0, opacity: 1 - out, transform: `translateX(${(1 - inP) * 140 - out * 140}px)` }}>
      <div style={{ position: 'absolute', left: SAFE.left, top: 290 }}>
        <BigLine frame={frame} at={s} size={96}>
          {l1}
        </BigLine>
        <BigLine frame={frame} at={s + 3} size={96}>
          <GradText>{l2}</GradText>
        </BigLine>
      </div>
      <div style={{ position: 'absolute', left: SAFE.left, top: 620, width: W, height: 860 }}>{children}</div>
    </div>
  );
}

const DOMAIN = 'ornekklinik.com';

function F1({ frame }: { frame: number }) {
  const typed = typedCount(frame, TL, 'f1.type', DOMAIN.length);
  const rows: Array<[string, string, boolean]> = [
    ['f1.c1', 'robots.txt', true],
    ['f1.c2', 'sitemap.xml', true],
    ['f1.c3', 'llms.txt', false],
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 22, height: 130, padding: '0 34px', borderRadius: 34, background: M.paper, border: `3px solid ${alpha(brand[500], 0.5)}`, boxShadow: `0 0 0 8px ${alpha(brand[500], 0.08)}` }}>
        <Globe size={50} color={brand[600]} />
        <span style={{ fontFamily: fontMono, fontWeight: 600, fontSize: 52 }}>
          {DOMAIN.slice(0, typed)}
          <span style={{ display: 'inline-block', width: 4, height: 52, marginLeft: 4, background: brand[500], verticalAlign: 'middle', opacity: Math.floor(frame / 8) % 2 ? 0.2 : 1 }} />
        </span>
      </div>
      {rows.map(([id, name, ok]) => {
        const p = snap(frame, TL.at(id));
        const col = ok ? M.success : M.warn;
        return (
          <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 24, height: 118, padding: '0 34px', borderRadius: 30, background: ok ? M.paper : alpha(M.warn, 0.06), border: `2px solid ${ok ? M.hair : alpha(M.warn, 0.35)}`, opacity: clamp01(p * 1.5), transform: `translateY(${(1 - p) * 40}px)` }}>
            <span style={{ width: 64, height: 64, borderRadius: 99, display: 'grid', placeItems: 'center', background: alpha(col, 0.12), color: col }}>{ok ? <Check size={38} strokeWidth={3} /> : <CircleAlert size={38} />}</span>
            <span style={{ fontFamily: fontMono, fontWeight: 700, fontSize: 44 }}>{name}</span>
            <span style={{ marginLeft: 'auto', fontFamily: fontUI, fontWeight: 800, fontSize: 34, color: col }}>{ok ? 'Tamam' : 'Düzelt'}</span>
          </div>
        );
      })}
      <SampleTag size={24} style={{ alignSelf: 'flex-start', marginTop: 6 }} />
    </div>
  );
}

function F2({ frame }: { frame: number }) {
  const [s] = TL.scene('f2');
  const gate = snap(frame, TL.at('f2.gate'));
  const done = snap(frame, TL.at('f2.done'));
  const lines = ramp(frame, s + 4, TL.at('f2.gate') - 2, Easing.linear);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
      <div style={{ borderRadius: 40, background: M.paper, border: `1.5px solid ${M.hair}`, boxShadow: `0 30px 70px ${alpha(M.ink, 0.1)}`, padding: 44, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Chip color={brand[700]} size={26}>
            <Sparkles size={24} /> Marka sesinle
          </Chip>
          <SampleTag size={22} style={{ marginLeft: 'auto' }} />
        </div>
        <div style={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: 54, lineHeight: 1.15, letterSpacing: '-0.025em' }}>Diş taşı temizliği ne sıklıkla yapılmalı?</div>
        {[0.95, 0.86, 0.92, 0.72, 0.88].map((w, i) => (
          <div key={i} style={{ height: 18, borderRadius: 99, background: alpha(M.ink, 0.08), width: `${w * 100 * clamp01(lines * 5 - i)}%` }} />
        ))}
        <Chip color={M.success} size={32} style={{ alignSelf: 'flex-start', marginTop: 8, opacity: clamp01(gate * 1.5), transform: `scale(${0.8 + 0.2 * gate})`, transformOrigin: 'left center' }}>
          <Check size={30} strokeWidth={3} /> Kalite kapısı
        </Chip>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '30px 36px', borderRadius: 30, background: M.ink, color: 'white', fontFamily: fontUI, fontWeight: 800, fontSize: 40, opacity: clamp01(done * 1.5), transform: `translateY(${(1 - done) * 40}px) scale(${0.9 + 0.1 * done})` }}>
        <Check size={42} color="#7ee2a8" strokeWidth={3} /> Yayınlandı · WordPress
      </div>
    </div>
  );
}

function F3({ frame }: { frame: number }) {
  const ids = ['f3.e1', 'f3.e2', 'f3.e3', 'f3.e4', 'f3.e5', 'f3.e6'];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {ENGINES.map((e, i) => {
        const res = SAMPLE_RESULT[i];
        const meta = mentionMeta[res];
        const p = snap(frame, TL.at(ids[i]));
        return (
          <div key={e} style={{ display: 'flex', alignItems: 'center', height: 104, padding: '0 34px', borderRadius: 28, background: res === 'none' ? M.paper : alpha(meta.color, 0.07), border: `2px solid ${res === 'none' ? M.hair : alpha(meta.color, 0.35)}`, opacity: clamp01(p * 1.5), transform: `translateX(${(1 - p) * 60}px)` }}>
            <span style={{ fontFamily: fontUI, fontWeight: 800, fontSize: 42 }}>{e}</span>
            <span style={{ marginLeft: 'auto', fontFamily: fontUI, fontWeight: 800, fontSize: 32, color: meta.color }}>{meta.label}</span>
          </div>
        );
      })}
      <SampleTag size={24} label="Örnek ölçüm" style={{ alignSelf: 'flex-start', marginTop: 6 }} />
    </div>
  );
}

/* ───────────── 11-15 sn: kapanis ───────────── */

function End({ frame }: { frame: number }) {
  const [s] = TL.scene('end');
  if (frame < s - 2) return null;
  const tile = snap(frame, s);
  const word = snap(frame, s + 5);
  const big = snap(frame, s + 9);
  const cta = snap(frame, TL.at('end.cta'));
  const note = soft(frame, TL.at('end.url'));
  return (
    <div style={{ position: 'absolute', left: SAFE.left, width: W, top: 330, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ transform: `scale(${tile})` }}>
        <LogoMark size={176} />
      </div>
      <div style={{ marginTop: 44, opacity: clamp01(word * 1.5), transform: `translateY(${(1 - word) * 24}px)` }}>
        <Wordmark size={112} theme={light} />
      </div>
      <div style={{ marginTop: 90, textAlign: 'center', opacity: clamp01(big * 1.5), transform: `scale(${1.12 - 0.12 * big})` }}>
        <div style={{ fontFamily: fontDisplay, fontWeight: 800, fontSize: 128, lineHeight: 1.04, letterSpacing: '-0.04em' }}>2 makale</div>
        <div style={{ fontFamily: fontDisplay, fontWeight: 800, fontSize: 128, lineHeight: 1.1, letterSpacing: '-0.04em' }}>
          <GradText>ücretsiz dene</GradText>
        </div>
      </div>
      <div style={{ marginTop: 70, opacity: clamp01(cta * 1.5), transform: `scale(${0.7 + 0.3 * cta})` }}>
        <CtaButton size={60}>
          ranksup.ai <ArrowRight size={58} strokeWidth={2.8} />
        </CtaButton>
      </div>
      <div style={{ marginTop: 44, fontFamily: fontUI, fontWeight: 700, fontSize: 40, color: M.body, opacity: note }}>Kart gerekmez</div>
    </div>
  );
}
