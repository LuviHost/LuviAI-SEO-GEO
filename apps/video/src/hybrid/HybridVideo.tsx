/**
 * RanksUp hibrit tanitim videosu — dikey 1080×1920 + yatay 1920×1080, seslendirme YOK (yalniz ekran metni + muzik).
 *
 * Kurgu: gercek goruntu kancasi (Mixkit stok klipleri, public/stock/ — git'e girmez, lisans CREDITS.md) →
 * sutun videolarinin panel sahneleri (AI Görünürlük, Site Skoru, Otomatik Akış; metinler src/pillars/script.json'dan
 * resolve.mjs ile) → gercek goruntu ozet satiri → kapanis (logo, ranksup.ai, "2 makale ücretsiz dene", "Kart gerekmez").
 * Zamanlama schedule.mjs planVideo (okunurluk kurali), muzik public/audio/pillars/hibrit.wav (synth-pillars.mjs, normal uslup).
 *
 * Goruntu uzerindeki metin: Apple-yumusak beyaz kart (Sora 800, murekkep metin, tek turuncu vurgu) — koyu sinematik /
 * buyuk harf yok; goruntu yalniz hafifce karartilir. Dikeyde tum metin y 250–1500 guvenli alaninda.
 */
import React from 'react';
import { AbsoluteFill, Html5Audio, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from 'remotion';
import { Bot } from 'lucide-react';
import { Stage, M, fontUI, useBrandFonts } from '../marketing/kit';
import { alpha } from '../tokens';
import pillarScript from '../pillars/script.json';
import hybridScript from './script.json';
import { resolveHybrid } from './resolve.mjs';
import { EXIT_FRAMES, FPS, planVideo, type PillarPlan, type PlannedScene } from '../pillars/schedule.mjs';
import { PageContent } from '../pillars/pages';
import { Headline, PanelWindow, Tag, fade, getter, ramp, type A, type Format, type Get, type Rect } from '../pillars/parts';
import { EndScene } from '../pillars/scenes';
import { windowState } from '../pillars/PillarVideo';

export const HYBRID_SCRIPT = resolveHybrid(pillarScript, hybridScript);
export const HYBRID_PLAN: PillarPlan = planVideo(HYBRID_SCRIPT, 'hibrit');

type Clip = { file: string; from: number; pos: string };
type FootageScene = PlannedScene & { layout?: 'ask' | 'line'; clip?: Record<Format, Clip> };

/* ───────────── gercek goruntu ───────────── */

function Footage({ scene, format, frame, fadeIn, fadeOut }: { scene: FootageScene; format: Format; frame: number; fadeIn: boolean; fadeOut: boolean }) {
  const clip = scene.clip?.[format];
  if (!clip) throw new Error(`hybrid: ${scene.id} sahnesinde ${format} klibi yok`);
  const len = scene.end - scene.start;
  const t = (frame - scene.start) / len;
  // cok yavas yakinlasma (Ken Burns): yuz kadrajda kalir
  const zoom = 1.02 + 0.04 * t;
  const o = (fadeIn ? ramp(frame, scene.start, scene.start + 12) : 1) * (fadeOut ? 1 - ramp(frame, scene.end - EXIT_FRAMES, scene.end) : 1);
  return (
    <AbsoluteFill style={{ opacity: o, background: M.ink }}>
      <Sequence from={scene.start} durationInFrames={len} layout="none">
        <OffthreadVideo
          src={staticFile(clip.file)}
          trimBefore={Math.round(clip.from * FPS)}
          muted
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: clip.pos, transform: `scale(${zoom})`, transformOrigin: clip.pos }}
        />
      </Sequence>
      {/* hafif karartma: metin kartlari zaten opak; goruntu sicak ve dogal kalir */}
      <AbsoluteFill style={{ background: `linear-gradient(180deg, ${alpha(M.ink, 0.12)} 0%, ${alpha(M.ink, 0.18)} 45%, ${alpha(M.ink, 0.38)} 100%)` }} />
    </AbsoluteFill>
  );
}

/** beyaz, yumusak kenarli altyazi karti */
function CaptionCard({ a, size, width, accent = false, align = 'left', style }: { a: A; size: number; width: number; accent?: boolean; align?: 'left' | 'center'; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        position: 'absolute',
        width,
        boxSizing: 'border-box',
        padding: `${size * 0.42}px ${size * 0.6}px ${size * 0.5}px`,
        borderRadius: size * 0.55,
        background: alpha('#FFFFFF', 0.95),
        boxShadow: `0 30px 80px ${alpha(M.ink, 0.28)}, 0 6px 18px ${alpha(M.ink, 0.12)}`,
        ...fade(a),
        ...style,
      }}
    >
      <Headline a={{ ...a, o: 1, y: 0 }} size={size} width={width - size * 1.2} accent={accent} align={align} />
    </div>
  );
}

/** "AI asistanina sorulan soru" karti (geo kancasindaki sohbet balonu, kucuk) */
function QuestionCard({ q, tag, size, width, style }: { q: A; tag: A; size: number; width: number; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        position: 'absolute',
        width,
        boxSizing: 'border-box',
        borderRadius: 34,
        background: alpha('#FFFFFF', 0.96),
        boxShadow: `0 30px 80px ${alpha(M.ink, 0.28)}, 0 6px 18px ${alpha(M.ink, 0.12)}`,
        overflow: 'hidden',
        ...fade(q),
        ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, height: 74, padding: '0 26px', borderBottom: `1px solid ${M.hair}`, background: M.cream }}>
        <span style={{ width: 42, height: 42, borderRadius: 12, background: alpha(M.ink, 0.07), display: 'grid', placeItems: 'center' }}>
          <Bot size={25} color={M.inkSoft} />
        </span>
        <span style={{ fontFamily: fontUI, fontWeight: 800, fontSize: 27, color: M.ink }}>AI asistanı</span>
        <Tag a={tag} size={21} style={{ marginLeft: 'auto' }} />
      </div>
      <div style={{ padding: '26px 26px 30px', display: 'flex', justifyContent: 'flex-end' }}>
        <div style={{ padding: '22px 28px', borderRadius: '28px 28px 8px 28px', background: M.ink, color: 'white', fontFamily: fontUI, fontWeight: 700, fontSize: size, lineHeight: 1.28, textAlign: 'left' }}>“{q.text}”</div>
      </div>
    </div>
  );
}

function FootageScene({ plan, scene, frame, format }: { plan: PillarPlan; scene: FootageScene; frame: number; format: Format }) {
  const g = getter(frame, scene);
  const v = format === 'v';
  const prev = plan.scenes[scene.index - 1];
  const next = plan.scenes[scene.index + 1];
  const footage = <Footage scene={scene} format={format} frame={frame} fadeIn={Boolean(prev) && prev.type !== 'footage'} fadeOut={!next || next.type !== 'footage'} />;
  if (scene.layout === 'ask') {
    // dikey: yuz ustte serbest; kartlar gogus/telefon hizasinda (y ~1000–1480)
    return (
      <>
        {footage}
        {v ? (
          <>
            <CaptionCard a={g('h')} size={64} width={900} style={{ left: 90, top: 930 }} />
            <QuestionCard q={g('q')} tag={g('tag')} size={44} width={900} style={{ left: 90, top: 1125 }} />
          </>
        ) : (
          <>
            <CaptionCard a={g('h')} size={60} width={700} style={{ left: 1120, top: 250 }} />
            <QuestionCard q={g('q')} tag={g('tag')} size={38} width={700} style={{ left: 1120, top: 455 }} />
          </>
        )}
      </>
    );
  }
  const h = g('h');
  const accent = Boolean(h.it.accent);
  return (
    <>
      {footage}
      {v ? (
        <CaptionCard a={h} size={accent ? 84 : 62} width={900} accent={accent} style={{ left: 90, bottom: 1920 - 1480 }} />
      ) : (
        <CaptionCard a={h} size={accent ? 80 : 58} width={accent ? 900 : 1100} accent={accent} style={accent ? { left: 110, bottom: 110 } : { left: (1920 - 1100) / 2, bottom: 90 }} />
      )}
    </>
  );
}

/* ───────────── panel ───────────── */

/** dikeyde pencere guvenli alanda biter (y ≤ 1480); yatay sutun videolariyla ayni */
const WINDOW: Record<Format, Rect> = {
  v: { x: 60, y: 540, w: 960, h: 940 },
  w: { x: 760, y: 80, w: 1080, h: 920 },
};

function PageSceneH({ plan, scene, frame, format }: { plan: PillarPlan; scene: PlannedScene; frame: number; format: Format }) {
  const g: Get = getter(frame, scene);
  const win = windowState(plan, scene, frame);
  const v = format === 'v';
  return (
    <>
      {v ? (
        <Headline a={g('h')} size={70} width={900} style={{ position: 'absolute', left: 90, top: 270 }} />
      ) : (
        <div style={{ position: 'absolute', left: 110, top: 0, bottom: 0, width: 580, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <Headline a={g('h')} size={68} width={580} />
        </div>
      )}
      <PanelWindow frame={frame} rect={WINDOW[format]} format={format} nav={scene.nav!} prevNav={win.prevNav} navAt={scene.start} crumb={scene.crumb} opacity={win.opacity} rise={win.rise}>
        <PageContent g={g} scene={scene} frame={frame} />
      </PanelWindow>
    </>
  );
}

function SceneView({ plan, scene, frame, format }: { plan: PillarPlan; scene: PlannedScene; frame: number; format: Format }) {
  if (scene.type === 'footage') return <FootageScene plan={plan} scene={scene as FootageScene} frame={frame} format={format} />;
  if (scene.type === 'page') return <PageSceneH plan={plan} scene={scene} frame={frame} format={format} />;
  if (scene.type === 'end') return <EndScene g={getter(frame, scene)} scene={scene} format={format} />;
  throw new Error(`hybrid: bilinmeyen sahne turu ${scene.type}`);
}

export type HybridProps = { muted?: boolean };

function HybridVideo({ format, muted = false }: { format: Format; muted?: boolean }) {
  useBrandFonts();
  const frame = useCurrentFrame();
  const plan = HYBRID_PLAN;
  const scene = plan.scenes.find((s) => frame >= s.start && frame < s.end) ?? plan.scenes[plan.scenes.length - 1];
  return (
    <Stage grid={false}>
      {muted ? null : <Html5Audio src={staticFile('audio/pillars/hibrit.wav')} />}
      <AbsoluteFill lang="tr">
        <SceneView key={scene.id} plan={plan} scene={scene} frame={frame} format={format} />
      </AbsoluteFill>
    </Stage>
  );
}

/** Root.tsx icin: dikey + yatay */
export const HYBRID_COMPOSITIONS = (['v', 'w'] as const).map((format) => ({
  id: `Hybrid-${format === 'v' ? 'dikey' : 'yatay'}`,
  format,
  width: format === 'v' ? 1080 : 1920,
  height: format === 'v' ? 1920 : 1080,
  durationInFrames: HYBRID_PLAN.durationInFrames,
  posterFrame: HYBRID_PLAN.posterFrame,
  component: ((props: HybridProps) => <HybridVideo format={format} muted={props.muted} />) as React.FC<HybridProps>,
}));
