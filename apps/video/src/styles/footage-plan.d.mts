/** footage-plan.mjs tipleri */
import type { StockClip } from './registry.mjs';
export declare const FOOTAGE_PLAN: Record<'vertical' | 'horizontal', Array<{ clip: string; from: number }>>;
export declare const MIN_RATE: number;
export declare const MAX_RATE: number;
export interface FootageScene {
  clip: StockClip;
  from: number;
  dur: number;
  fade: number;
  trimBefore: number;
  rate: number;
  loopFrames: number | null;
  srcStart: number;
  srcEnd: number;
}
export declare function footageScenes(o: { cuts: number[]; fpb: number; wide: boolean; fps?: number; tail?: number }): FootageScene[];
