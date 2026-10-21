/** plan.mjs tipleri (Remotion TS tarafi icin; mantik plan.mjs'te) */
export type Tempo = 'fast' | 'normal' | 'slow';
export type PlanTemplate = 'ArticleShort' | 'SiteIntro' | 'SiteIntroWide' | 'ProductShort';
export type PlanComposition = PlanTemplate | 'ProductWide';

export interface PlanAudio {
  src: string;
  from: number;
  durationInFrames: number;
  trimBefore: number;
  fadeIn: number;
  fadeOut: number;
}

export interface Plan {
  template: PlanTemplate;
  tempo: Tempo;
  bpm: number;
  fpb: number;
  fps: number;
  read: number | null;
  compressed: boolean;
  durationInFrames: number;
  scenes: Record<string, [number, number]>;
  events: Record<string, number>;
  audio: PlanAudio[];
  posterFrame: number | null;
}

export interface SpringConfig {
  damping: number;
  stiffness?: number;
  mass?: number;
}

export declare const TEMPOS: readonly Tempo[];
export declare const DEFAULT_REQUEST_TEMPO: Tempo;
export declare const LEGACY_TEMPO: Tempo;
export declare function normalizeTempo(v: unknown): Tempo;
export declare const READ_RULE: { minSec: number; perWordSec: number; baseSec: number; listHoldSec: number };
export declare function countWords(text: unknown): number;
export declare function readSeconds(text: unknown): number;
export declare const MOTION: Record<'fast' | 'calm' | 'soft', { config: SpringConfig; settle: number }>;
export declare function motionOf(tempo: Tempo): { config: SpringConfig; settle: number };
export declare const PLAN_TEMPLATE: Record<PlanComposition, PlanTemplate>;

export interface Planner {
  plan(compositionId: PlanComposition, tempo: unknown, props: unknown): Plan;
  stemJobs(): Array<Record<string, unknown>>;
  FPS: number;
}
export declare function createPlanner(timeline: unknown): Planner;
