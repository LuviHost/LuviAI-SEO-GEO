import { createContext, useContext } from 'react';
import { Html5Audio, Sequence, interpolate, spring, staticFile } from 'remotion';
import raw from '../marketing/timeline.json';
import { snap as kitSnap, soft as kitSoft } from '../marketing/kit';
import { timeline, type Timeline } from '../marketing/timeline';
import { MOTION, createPlanner, normalizeTempo, type Plan, type PlanComposition, type Tempo } from './plan.mjs';

/**
 * RanksUp Video sablonlarinin (ArticleShort, SiteIntro, ProductShort) zaman cizelgesi — tempoya gore.
 *
 *   fast          timeline.json compositions (bugunku sabit izgara) + kit snap(): goruntu eski video
 *                 ile BIREBIR; muzik hizli uslubun tek dosyasi (audio/tempo/<sablon>-fast.wav)
 *   normal / slow plan.mjs: sahne sureleri metinden, kendi BPM'i, sakin giris yayi, kok ses dosyalari
 *
 * Sablonlar modul duzeyinde sabit TL tutmaz; sure props'a bagli oldugu icin TL baglamdan gelir
 * (useTL). Root.tsx calculateMetadata ayni plani kullanarak durationInFrames'i props'tan kurar.
 */

export const planner = createPlanner(raw);

export type TempoTimeline = Timeline & {
  tempo: Tempo;
  plan: Plan;
  /** marketing/kit snap() — tempo 'fast' ise aynisi; degilse asmasiz sakin yay */
  snap: (frame: number, at: number, fps?: number, lead?: number) => number;
  soft: (frame: number, at: number) => number;
};

type WithTempo = { tempo?: string };

export function tempoTimeline(compositionId: PlanComposition, props: WithTempo): TempoTimeline {
  const tempo = normalizeTempo(props.tempo);
  const plan = planner.plan(compositionId, tempo, props);
  if (tempo === 'fast') {
    // Eski yol: timeline.ts okuyucusu ve kit yaylari (cikti degismesin)
    const legacy = timeline(plan.template);
    return { ...legacy, tempo, plan, snap: kitSnap, soft: kitSoft };
  }
  const event = (id: string) => {
    const at = plan.events[id];
    if (at === undefined) throw new Error(`tempo plani: ${plan.template} icinde '${id}' olayi yok`);
    return { id, at: at / plan.fpb };
  };
  return {
    id: plan.template,
    audio: '',
    durationInFrames: plan.durationInFrames,
    scene: (name) => {
      const s = plan.scenes[name];
      if (!s) throw new Error(`tempo plani: ${plan.template} icinde '${name}' sahnesi yok`);
      return s;
    },
    at: (id) => Math.round(event(id).at * plan.fpb),
    event,
    captions: [],
    tempo,
    plan,
    snap: (frame, at, fps = 30, lead = 4) => spring({ frame: frame - (at - lead), fps, config: MOTION.calm.config }),
    soft: kitSoft,
  };
}

/** Root.tsx Composition calculateMetadata: sure props'tan (tempo + metin) */
export const tempoMetadata = (compositionId: PlanComposition) => ({ props }: { props: WithTempo }) => ({
  durationInFrames: planner.plan(compositionId, normalizeTempo(props.tempo), props).durationInFrames,
});

const TempoContext = createContext<TempoTimeline | null>(null);
export const TempoProvider = TempoContext.Provider;

export function useTL(): TempoTimeline {
  const tl = useContext(TempoContext);
  if (!tl) throw new Error('useTL: TempoProvider disinda');
  return tl;
}

/**
 * Ses: plan.audio — fast'ta hizli uslubun tek dosyasi (0. kareden sona); normal/slow'da giris /
 * govde dongusu / kapanis kokleri ve efektler, her biri kendi karesinde (Sequence). Dongu sinirlari
 * kesintisiz (synth.mjs donguyu kararli durumdan keser); kesmelerde kisa solma tik sesini onler.
 */
export function TempoSoundtrack({ tl, muted }: { tl: TempoTimeline; muted: boolean }) {
  if (muted) return null;
  return (
    <>
      {tl.plan.audio.map((a, i) => (
        <Sequence key={i} from={a.from} durationInFrames={a.durationInFrames} layout="none">
          <Html5Audio
            src={staticFile(a.src)}
            trimBefore={a.trimBefore || undefined}
            volume={a.fadeOut > 0 ? (f) => interpolate(f, [a.durationInFrames - a.fadeOut, a.durationInFrames], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) : undefined}
          />
        </Sequence>
      ))}
    </>
  );
}
