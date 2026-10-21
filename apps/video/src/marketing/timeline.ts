/**
 * timeline.json'un tipli okuyucusu. Sahne kesmeleri, efekt anlari ve altyazilar
 * vurus cinsinden tek dosyada; burada kareye cevrilir. Ses sentezi
 * (scripts/audio/synth.mjs) ayni JSON'u okudugu icin goruntu ve ses ayni izgaraya oturur.
 */
import raw from './timeline.json';

export type MarketingId =
  | 'ProductIntro'
  | 'SocialAd'
  | 'FeatureExplainer'
  | 'ArticleShort'
  | 'SiteIntro'
  | 'SiteIntroWide'
  | 'ProductShort'
  | 'VideoLaunch'
  | 'VideoLaunchVertical'
  | 'KobiPratikReels'
  | 'KobiPratikIntro';

type TimelineEvent = { id: string; at: number; sfx?: string; n?: number; every?: number; dur?: number };
type CompDef = {
  audio: string;
  /** istege bagli kendi temposu (yoksa ust duzey bpm); KobiPratik videolari 90 BPM */
  bpm?: number;
  beats: number;
  scenes: Record<string, [number, number]>;
  events: TimelineEvent[];
  captions?: Array<[number, number, string]>;
};

export const FPS: number = raw.fps;
export const BPM: number = raw.bpm;
/** kare / vurus (120 BPM, 30 fps -> 15) */
export const FPB = (FPS * 60) / BPM;
export const beatsToFrames = (b: number) => Math.round(b * FPB);

export type Timeline = {
  id: MarketingId;
  audio: string;
  /** bu kompozisyonun kare / vurus degeri (kendi bpm'i varsa ondan) */
  fpb: number;
  durationInFrames: number;
  /** sahnenin [baslangic, bitis) karesi */
  scene: (name: string) => [number, number];
  /** olayin karesi (timeline.json events[].at) */
  at: (eventId: string) => number;
  /** olayin ham tanimi (type olaylari icin n / every) */
  event: (eventId: string) => TimelineEvent;
  captions: Array<{ from: number; to: number; text: string }>;
};

export function timeline(id: MarketingId): Timeline {
  const def = (raw.compositions as unknown as Record<string, CompDef>)[id];
  const fpb = (FPS * 60) / (def.bpm ?? BPM);
  const toFrames = (b: number) => Math.round(b * fpb);
  const event = (eventId: string) => {
    const e = def.events.find((x) => x.id === eventId);
    if (!e) throw new Error(`timeline.json: ${id} icinde '${eventId}' olayi yok`);
    return e;
  };
  return {
    id,
    audio: def.audio,
    fpb,
    durationInFrames: toFrames(def.beats),
    scene: (name) => {
      const s = def.scenes[name];
      if (!s) throw new Error(`timeline.json: ${id} icinde '${name}' sahnesi yok`);
      return [toFrames(s[0]), toFrames(s[1])];
    },
    at: (eventId) => toFrames(event(eventId).at),
    event,
    captions: (def.captions ?? []).map(([a, b, text]) => ({ from: toFrames(a), to: toFrames(b), text })),
  };
}

/** type olayi icin: kac karakter gorunur (olayin n / every degerleriyle sesle ayni hizda) */
export function typedCount(frame: number, tl: Timeline, eventId: string, total: number): number {
  const e = tl.event(eventId);
  const start = Math.round(e.at * tl.fpb);
  const every = (e.every ?? 0.13333) * tl.fpb;
  const n = Math.floor((frame - start) / every) + 1;
  return Math.max(0, Math.min(total, frame < start ? 0 : n));
}
