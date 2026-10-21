/** schedule.mjs tipleri (Remotion TS tarafi icin; mantik schedule.mjs'te) */
import type { SpringConfig } from '../tempo/plan.mjs';

export type ItemKind = 'text' | 'note' | 'ui';

export interface ScriptItem {
  id: string;
  text: string;
  at: number;
  kind?: ItemKind;
  list?: string;
  sfx?: string;
  out?: number;
  enter?: 'instant';
  // sahneye ozgu veri alanlari (pages.tsx okur)
  label?: string;
  value?: string;
  sub?: string;
  from?: string;
  tone?: 'ok' | 'warn' | 'bad' | 'brand' | 'none';
  score?: number;
  limit?: number;
  trend?: 'up' | 'down' | 'flat';
  mono?: boolean;
  auto?: boolean;
  button?: boolean;
  accent?: boolean;
  icon?: string;
  query?: string;
}

export interface PlannedItem extends ScriptItem {
  appear: number;
  visibleFrom: number;
  visibleTo: number;
  need: number;
}

export interface PlannedScene {
  id: string;
  type: string;
  content?: string;
  nav?: string;
  crumb?: string;
  tabs?: string[];
  activeTab?: number;
  variant?: string;
  music?: string;
  index: number;
  last: boolean;
  startBeat: number;
  endBeat: number;
  start: number;
  end: number;
  items: Record<string, PlannedItem>;
}

export interface PillarPlan {
  id: string;
  slug: string;
  title: string;
  bpm: number;
  fpb: number;
  style: 'fast' | 'normal' | 'slow';
  energy: number;
  durationInFrames: number;
  scenes: PlannedScene[];
  music: Array<[number, number, string]>;
  events: Array<{ id: string; at: number; sfx: string; dur?: number }>;
  posterFrame: number;
}

export declare const FPS: number;
export declare const LEAD: number;
export declare const ENTER: { config: SpringConfig; settle: number };
export declare const EXIT_FRAMES: number;
export declare const NOTE_MIN_SEC: number;
export declare const BREATH_SEC: number;
export declare const RULES: { minSec: number; perWordSec: number; baseSec: number; listHoldSec: number; noteMinSec: number };
export declare function needSeconds(item: ScriptItem): number;
export declare function planVideo(script: unknown, id: string): PillarPlan;
export declare function sceneAt(plan: PillarPlan, frame: number): PlannedScene;
