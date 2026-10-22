/**
 * RanksUp tanitim videolari — 5 sutun (GEO, SEO, ASO, Icerik otopilotu, RanksUp Video) + Canli Tarayici, her biri
 * dikey 1080×1920 (Reels) ve yatay 1920×1080 (web / YouTube / LinkedIn), ayni hikaye ve ayni ses.
 *
 * Kurgu: 3 sn'lik kanca (sutuna ozgu sorun) → gercek panelin yeniden cizilmis 3-4 ekrani (menu adlari
 * site-nav.ts) → tek mesaj → kapanis (logo, ranksup.ai, "2 makale ücretsiz dene").
 * Metinler src/pillars/script.json; sureler schedule.mjs (okunurluk kuralindan); muzik
 * public/audio/pillars/<id>.wav (scripts/audio/synth-pillars.mjs, styles.mjs uslubu, videonun BPM'i).
 */
import React from 'react';
import { AbsoluteFill, Html5Audio, spring, staticFile, useCurrentFrame } from 'remotion';
import { Stage, useBrandFonts } from '../marketing/kit';
import script from './script.json';
import { planVideo, type PillarPlan, type PlannedScene } from './schedule.mjs';
import { PageContent } from './pages';
import { Headline, PanelWindow, getter, ramp, type Format, type Rect } from './parts';
import { EndScene, FormatsScene, HookScene, MessageScene } from './scenes';
import { ENTER, EXIT_FRAMES, FPS, LEAD } from './schedule.mjs';

export const PILLAR_IDS = ['geo', 'seo', 'aso', 'icerik', 'video', 'tarayici'] as const;
export type PillarId = (typeof PILLAR_IDS)[number];

export const PILLAR_PLANS: Record<PillarId, PillarPlan> = Object.fromEntries(PILLAR_IDS.map((id) => [id, planVideo(script, id)])) as Record<PillarId, PillarPlan>;

export type PillarProps = { muted?: boolean };

const WINDOW: Record<Format, Rect> = {
  v: { x: 60, y: 500, w: 960, h: 1060 },
  w: { x: 760, y: 80, w: 1080, h: 920 },
};

/** ardisik panel sahneleri tek pencerede: pencere ilk panel sahnesinde girer, son panel sahnesinde cikar */
function windowState(plan: PillarPlan, scene: PlannedScene, frame: number) {
  const scenes = plan.scenes;
  const isPage = (s?: PlannedScene) => s?.type === 'page';
  let first = scene.index;
  while (first > 0 && isPage(scenes[first - 1])) first--;
  let last = scene.index;
  while (last < scenes.length - 1 && isPage(scenes[last + 1])) last++;
  const enterAt = scenes[first].items.title?.appear ?? scenes[first].start + Math.round(1.5 * plan.fpb);
  const p = spring({ frame: frame - (enterAt - LEAD), fps: FPS, config: ENTER.config });
  const out = ramp(frame, scenes[last].end - EXIT_FRAMES, scenes[last].end);
  const prev = scene.index > first ? scenes[scene.index - 1] : null;
  return { opacity: Math.min(1, p * 1.4) * (1 - out), rise: (1 - p) * 40, prevNav: prev?.nav ?? null };
}

function PageScene({ plan, scene, frame, format }: { plan: PillarPlan; scene: PlannedScene; frame: number; format: Format }) {
  const g = getter(frame, scene);
  const win = windowState(plan, scene, frame);
  const v = format === 'v';
  return (
    <>
      {v ? (
        <Headline a={g('h')} size={72} width={900} style={{ position: 'absolute', left: 90, top: 210 }} />
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
  const g = getter(frame, scene);
  if (scene.type === 'page') return <PageScene plan={plan} scene={scene} frame={frame} format={format} />;
  if (scene.type.startsWith('hook')) return <HookScene g={g} scene={scene} frame={frame} format={format} />;
  if (scene.type === 'message') return <MessageScene g={g} scene={scene} format={format} />;
  if (scene.type === 'formats') return <FormatsScene g={g} format={format} />;
  if (scene.type === 'end') return <EndScene g={g} scene={scene} format={format} />;
  throw new Error(`Bilinmeyen sahne turu: ${scene.type}`);
}

function PillarVideo({ id, format, muted = false }: { id: PillarId; format: Format; muted?: boolean }) {
  useBrandFonts();
  const frame = useCurrentFrame();
  const plan = PILLAR_PLANS[id];
  // sahne cikisi bir sonraki sahnenin girisiyle cakismaz (cikis sahne bitmeden tamamlanir)
  const scene = plan.scenes.find((s) => frame >= s.start && frame < s.end) ?? plan.scenes[plan.scenes.length - 1];
  return (
    <Stage grid={false}>
      {muted ? null : <Html5Audio src={staticFile(`audio/pillars/${id}.wav`)} />}
      <AbsoluteFill lang="tr">
        <SceneView key={scene.id} plan={plan} scene={scene} frame={frame} format={format} />
      </AbsoluteFill>
    </Stage>
  );
}

/** Root.tsx icin: 12 kompozisyon (6 video × dikey/yatay) */
export const PILLAR_COMPOSITIONS = PILLAR_IDS.flatMap((id) =>
  (['v', 'w'] as const).map((format) => ({
    id: `Pillar-${id}-${format === 'v' ? 'dikey' : 'yatay'}`,
    pillar: id,
    format,
    width: format === 'v' ? 1080 : 1920,
    height: format === 'v' ? 1920 : 1080,
    durationInFrames: PILLAR_PLANS[id].durationInFrames,
    posterFrame: PILLAR_PLANS[id].posterFrame,
    component: ((props: PillarProps) => <PillarVideo id={id} format={format} muted={props.muted} />) as React.FC<PillarProps>,
  })),
);
