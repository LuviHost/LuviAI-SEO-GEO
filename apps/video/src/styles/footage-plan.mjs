/**
 * 'footage' (Gercek goruntu) stilinin klip plani — saf JavaScript (Remotion footage.tsx ve api testi ayni
 * fonksiyonu kullanir). Sahne basina bir klip; klip YALNIZ kendi yuzsuz araliginda (registry.mjs STOCK_CLIPS
 * use) ve izinli biciminde (formats) oynar. Yavas cekim hissi icin 0,6x; sahne uzunsa 0,35x'e kadar yavaslar,
 * yine yetmezse ayni araligi bastan tekrarlar (Loop) — kaynak zamani hicbir karede use[1]'i asmaz.
 */
import { STOCK_CLIPS } from './registry.mjs';

/** sahne sirasi: kanca, madde 1, madde 2, madde 3 */
export const FOOTAGE_PLAN = {
  vertical: [
    { clip: 'phone-hands', from: 0 },
    { clip: 'office-desk', from: 0 },
    { clip: 'laptop-hands', from: 0 },
    { clip: 'phone-hands', from: 7.5 },
  ],
  horizontal: [
    { clip: 'phone-hands', from: 0 },
    { clip: 'laptop-hands', from: 0 },
    { clip: 'phone-hands', from: 7.5 },
    { clip: 'laptop-hands', from: 1.2 },
  ],
};

export const MIN_RATE = 0.35;
export const MAX_RATE = 0.6;

/**
 * @param {{ cuts: number[], fpb: number, wide: boolean, fps?: number, tail?: number }} o
 *   cuts: [0, p1 basi, p2 basi, p3 basi, kapanis basi] (kare); tail: son sahnenin kapanisa tasan kare sayisi
 * @returns {Array<{ clip: object, from: number, dur: number, fade: number, trimBefore: number, rate: number,
 *   loopFrames: number | null, srcStart: number, srcEnd: number }>}
 */
export function footageScenes({ cuts, fpb, wide, fps = 30, tail = 8 }) {
  const fade = Math.round(fpb / 2);
  const plan = FOOTAGE_PLAN[wide ? 'horizontal' : 'vertical'];
  return plan.map((pl, i) => {
    const clip = STOCK_CLIPS.find((c) => c.id === pl.clip);
    if (!clip) throw new Error(`footage plani: bilinmeyen klip ${pl.clip}`);
    const start = Math.max(clip.use[0], Math.min(pl.from, clip.use[1] - 0.5));
    const avail = clip.use[1] - start;
    const from = Math.max(0, cuts[i] - fade);
    const dur = cuts[i + 1] - from + (i === plan.length - 1 ? tail : fade);
    const rate = Math.max(MIN_RATE, Math.min(MAX_RATE, avail / (dur / fps)));
    // Loop: kaynak zamani start + (kare % loopFrames) / fps * rate < use[1]
    const loopFrames = Math.floor((avail / rate) * fps);
    const loop = loopFrames < dur ? loopFrames : null;
    const played = (loop ?? dur) - 1;
    return { clip, from, dur, fade: i === 0 ? 0 : fade, trimBefore: Math.round(start * fps), rate, loopFrames: loop, srcStart: start, srcEnd: start + (played / fps) * rate };
  });
}
