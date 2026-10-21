#!/usr/bin/env node
/**
 * Pazarlama videolarinin muzigi + arayuz efektleri — tamamen KODLA sentezlenir.
 *
 *   node scripts/audio/synth.mjs                 # hepsi
 *   node scripts/audio/synth.mjs SocialAd        # yalniz biri
 *
 * Girdi: src/marketing/timeline.json (vurus cizelgesi; sahneler de ayni dosyadan kesilir).
 * Cikti: public/audio/<ad>.wav (48 kHz, stereo, 16 bit), ffmpeg loudnorm ile ~-14 LUFS.
 *
 * Hicbir ornek (sample), hazir muzik ya da ucuncu taraf ses dosyasi kullanilmaz: her ses
 * sinus/gurultu osilatorlerinden, zarflardan ve basit filtrelerden uretilir. Rastgelelik
 * tohumlu (mulberry32) — ayni girdi her calistirmada ayni dosyayi uretir.
 *
 * Duzen: Fa majorde 4 akorluk dongu (Fmaj7 · Am7 · Dm7 · Bbmaj7), her akor 1 olcu (4 vurus).
 * Bolum seviyeleri (timeline "music"): silence · pulse · L1 · L2 · L3 · L4 · outro.
 * Istege bagli "transpose" (yarim ton) duzeni baska tona tasir; yoksa Fa major (eski izler birebir ayni).
 * Istege bagli "bpm" kompozisyona kendi temposunu verir (KobiPratik: 90); yoksa ust duzey bpm (120).
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runFfSync } from '../ffmpeg.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TIMELINE = JSON.parse(readFileSync(join(ROOT, 'src', 'marketing', 'timeline.json'), 'utf8'));
const OUT_DIR = join(ROOT, 'public', 'audio');
const SR = 48000;
/** saniye / vurus — arrange() her kompozisyon icin kendi bpm'ine gore ayarlar (yoksa ust duzey bpm) */
let SPB = 60 / TIMELINE.bpm;
const TAU = Math.PI * 2;

/* ───────────── yardimcilar ───────────── */

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

class Bus {
  constructor(seconds) {
    this.n = Math.ceil(seconds * SR);
    this.L = new Float32Array(this.n);
    this.R = new Float32Array(this.n);
  }
  /** mono sinyali panla ekler; fn(t) ornek degerini dondurur (t: nota basindan saniye) */
  add(t0, dur, pan, gain, fn) {
    const i0 = Math.max(0, Math.round(t0 * SR));
    const i1 = Math.min(this.n, Math.round((t0 + dur) * SR));
    const gl = gain * Math.cos(((pan + 1) * Math.PI) / 4);
    const gr = gain * Math.sin(((pan + 1) * Math.PI) / 4);
    for (let i = i0; i < i1; i++) {
      const v = fn(i / SR - t0);
      this.L[i] += v * gl;
      this.R[i] += v * gr;
    }
  }
}

/** Freeverb benzeri basit stereo yanki (8 tarak + 4 tum-geciren) */
function reverb(bus, room = 0.82, damp = 0.25) {
  const scale = SR / 44100;
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
  const aps = [556, 441, 341, 225];
  const run = (input, spread) => {
    const out = new Float32Array(input.length);
    for (const c of combs) {
      const len = Math.round((c + spread) * scale);
      const buf = new Float32Array(len);
      let idx = 0;
      let store = 0;
      for (let i = 0; i < input.length; i++) {
        const y = buf[idx];
        store = y * (1 - damp) + store * damp;
        buf[idx] = input[i] * 0.015 + store * room;
        out[i] += y;
        idx = idx + 1 === len ? 0 : idx + 1;
      }
    }
    for (const a of aps) {
      const len = Math.round((a + spread) * scale);
      const buf = new Float32Array(len);
      let idx = 0;
      for (let i = 0; i < out.length; i++) {
        const b = buf[idx];
        const x = out[i];
        buf[idx] = x + b * 0.5;
        out[i] = b - x;
        idx = idx + 1 === len ? 0 : idx + 1;
      }
    }
    return out;
  };
  return { L: run(bus.L, 0), R: run(bus.R, 23) };
}

/* ───────────── enstrumanlar ───────────── */

// Fa majör: Fmaj7 · Am7 · Dm7 · Bbmaj7 (pad sesleri orta oktav, bas ayri)
const CHORDS = [
  { pad: [53, 57, 60, 64], bass: 41 },
  { pad: [52, 57, 60, 64], bass: 45 },
  { pad: [53, 57, 60, 62], bass: 38 },
  { pad: [53, 58, 62, 65], bass: 46 },
];
const chordAt = (beat) => CHORDS[Math.floor(beat / 4) % 4];
/** timeline "transpose" (yarim ton, varsayilan 0): ayni duzen baska tonda — kompozisyona kendi rengi */
let TRANSPOSE = 0;
const tr = (m) => m + TRANSPOSE;

function pad(bus, send, t0, dur, notes, gain) {
  const att = 0.35;
  const rel = 0.9;
  notes.forEach((m, k) => {
    const f = mtof(m);
    const pan = (k / (notes.length - 1)) * 1.0 - 0.5;
    bus.add(t0, dur + rel, pan, gain, (t) => {
      const env = Math.min(1, t / att) * (t > dur ? Math.exp(-(t - dur) / (rel / 3)) : 1);
      const vib = 1 + 0.0025 * Math.sin(TAU * 4.8 * t + k);
      let v = 0;
      for (let h = 1; h <= 9; h++) {
        const a = 1 / Math.pow(h, 1.25);
        v += a * (Math.sin(TAU * f * h * vib * t) + Math.sin(TAU * f * h * 1.004 * t + h));
      }
      return v * 0.5 * env;
    });
    send.add(t0, dur + rel, pan, gain * 0.6, (t) => {
      const env = Math.min(1, t / att) * (t > dur ? Math.exp(-(t - dur) / (rel / 3)) : 1);
      return Math.sin(TAU * f * t) * env;
    });
  });
}

/** marimba benzeri tokmak: 1 : 4 : 9.2 kismi tonlari */
function mallet(bus, send, t0, m, gain, pan = 0) {
  const f = mtof(m);
  const parts = [
    [1, 1, 0.55],
    [3.99, 0.3, 0.13],
    [9.2, 0.09, 0.05],
  ];
  const fn = (t) => {
    let v = 0;
    for (const [r, a, d] of parts) v += a * Math.sin(TAU * f * r * t) * Math.exp(-t / d);
    return v * Math.min(1, t / 0.003);
  };
  bus.add(t0, 1.6, pan, gain, fn);
  send.add(t0, 1.6, pan, gain * 0.5, fn);
}

function bassNote(bus, t0, dur, m, gain) {
  const f = mtof(m);
  bus.add(t0, dur + 0.08, 0, gain, (t) => {
    const env = Math.min(1, t / 0.006) * (0.55 + 0.45 * Math.exp(-t / 0.18)) * (t > dur ? Math.exp(-(t - dur) / 0.03) : 1);
    return (Math.sin(TAU * f * t) + 0.38 * Math.sin(TAU * 2 * f * t) + 0.16 * Math.sin(TAU * 3 * f * t)) * env;
  });
}

function kick(bus, t0, gain) {
  bus.add(t0, 0.45, 0, gain, (t) => {
    const ph = TAU * (46 * t + (110 * 0.032) * (1 - Math.exp(-t / 0.032)));
    return Math.sin(ph) * Math.exp(-t / 0.22) + (t < 0.002 ? 0.3 : 0);
  });
}

function noiseFn(rand, hp = 0, lpCoef = 0) {
  // basit tek kutuplu filtreler: lpCoef>0 alcak geciren, hp yuksek geciren
  let lp = 0;
  let lp2 = 0;
  return () => {
    let x = rand() * 2 - 1;
    if (lpCoef > 0) {
      lp += lpCoef * (x - lp);
      x = lp;
    }
    if (hp > 0) {
      lp2 += hp * (x - lp2);
      x = x - lp2;
    }
    return x;
  };
}

function hat(bus, rand, t0, gain, pan = 0.25) {
  const nz = noiseFn(rand, 0.55);
  bus.add(t0, 0.09, pan, gain, (t) => nz() * Math.exp(-t / 0.022));
}

function clap(bus, send, rand, t0, gain) {
  const nz = noiseFn(rand, 0.25, 0.45);
  const fn = (t) => {
    const bursts = (t < 0.03 ? Math.exp(-((t % 0.0105) / 0.004)) : 0) * 0.8 + Math.exp(-t / 0.11) * 0.6;
    return nz() * bursts;
  };
  bus.add(t0, 0.35, -0.05, gain, fn);
  send.add(t0, 0.35, 0, gain * 0.7, fn);
}

function bell(bus, send, t0, m, gain, pan = 0, decay = 1.3) {
  const f = mtof(m);
  const parts = [
    [1, 1, decay],
    [2.0, 0.28, decay * 0.6],
    [2.76, 0.32, decay * 0.4],
    [5.4, 0.12, decay * 0.18],
  ];
  const fn = (t) => {
    let v = 0;
    for (const [r, a, d] of parts) v += a * Math.sin(TAU * f * r * t) * Math.exp(-t / d);
    return v * Math.min(1, t / 0.002);
  };
  bus.add(t0, decay * 3, pan, gain, fn);
  send.add(t0, decay * 3, pan, gain * 0.9, fn);
}

/* ───────────── efektler ───────────── */

const SFX = {
  click(b, s, r, t, ev) {
    const nz = noiseFn(r, 0.6);
    b.add(t, 0.05, 0.1, 0.32 * (ev.gain ?? 1), (x) => nz() * Math.exp(-x / 0.0025) + 0.6 * Math.sin(TAU * 2300 * x) * Math.exp(-x / 0.01));
    b.add(t, 0.06, 0.1, 0.16 * (ev.gain ?? 1), (x) => Math.sin(TAU * 520 * x) * Math.exp(-x / 0.018));
  },
  type(b, s, r, t, ev) {
    const n = ev.n ?? 10;
    const step = (ev.every ?? 0.13333) * SPB;
    for (let k = 0; k < n; k++) {
      const nz = noiseFn(r, 0.5);
      const g = 0.07 + r() * 0.05;
      const f = 2600 + r() * 900;
      const jitter = (r() - 0.5) * 0.006;
      b.add(t + k * step + jitter, 0.03, (r() - 0.5) * 0.3, g, (x) => nz() * Math.exp(-x / 0.002) + 0.5 * Math.sin(TAU * f * x) * Math.exp(-x / 0.005));
    }
  },
  pop(b, s, r, t, ev) {
    const fn = (x) => Math.sin(TAU * (520 * x + (700 * x * x) / 0.12)) * Math.exp(-x / 0.05);
    b.add(t, 0.2, 0, 0.24 * (ev.gain ?? 1), fn);
    s.add(t, 0.2, 0, 0.12, fn);
  },
  tick(b, s, r, t) {
    const fn = (x) => (Math.sin(TAU * 1900 * x) + 0.4 * Math.sin(TAU * 3800 * x)) * Math.exp(-x / 0.022);
    b.add(t, 0.12, 0.15, 0.13, fn);
    s.add(t, 0.12, 0.15, 0.06, fn);
  },
  tickLow(b, s, r, t) {
    const fn = (x) => (Math.sin(TAU * 880 * x) + 0.3 * Math.sin(TAU * 1760 * x)) * Math.exp(-x / 0.03);
    b.add(t, 0.15, -0.15, 0.13, fn);
  },
  thock(b, s, r, t) {
    const nz = noiseFn(r, 0.3);
    b.add(t, 0.25, 0, 0.42, (x) => Math.sin(TAU * (150 * x + 4 * (1 - Math.exp(-x / 0.02)))) * Math.exp(-x / 0.07) + nz() * 0.25 * Math.exp(-x / 0.004));
  },
  whoosh(b, s, r, t, ev) {
    const d = (ev.dur ?? 0.9) * SPB;
    const start = t - d * 0.55; // tepe noktasi kesmeye otursun
    let lp = 0;
    let bp = 0;
    b.add(start, d, 0, 0.2, (x) => {
      const p = x / d;
      const fc = 300 + 2600 * p * p;
      const k = Math.min(0.99, (TAU * fc) / SR);
      const n = r() * 2 - 1;
      lp += k * (n - lp);
      bp += k * (lp - bp);
      return (lp - bp) * 2.2 * Math.pow(Math.sin(Math.PI * p), 2);
    });
  },
  chime(b, s, r, t) {
    bell(b, s, t, 81, 0.09, -0.2, 1.1);
    bell(b, s, t + 0.07, 84, 0.08, 0.2, 1.2);
  },
  success(b, s, r, t) {
    bell(b, s, t, 76, 0.1, -0.15, 0.6);
    bell(b, s, t + 0.09, 81, 0.11, 0.15, 0.8);
  },
  hit(b, s, r, t) {
    b.add(t, 1.4, 0, 0.42, (x) => Math.sin(TAU * (40 * x + 30 * 0.08 * (1 - Math.exp(-x / 0.08)))) * Math.exp(-x / 0.45));
    for (const [m, p] of [[65, -0.3], [69, 0], [72, 0.3], [77, 0]]) bell(b, s, t, m, 0.055, p, 1.6);
    const nz = noiseFn(r, 0.4);
    b.add(t, 0.3, 0, 0.12, (x) => nz() * Math.exp(-x / 0.05));
  },
  riser(b, s, r, t, ev) {
    const d = (ev.dur ?? 1.5) * SPB;
    let lp = 0;
    let bp = 0;
    b.add(t - d, d, 0, 0.12, (x) => {
      const p = x / d;
      const fc = 400 + 4200 * p * p;
      const k = Math.min(0.99, (TAU * fc) / SR);
      const n = r() * 2 - 1;
      lp += k * (n - lp);
      bp += k * (lp - bp);
      return ((lp - bp) * 2 + 0.25 * Math.sin(TAU * (220 + 500 * p) * x)) * p * p;
    });
  },
  snap(b, s, r, t) {
    for (let k = 0; k < 6; k++) SFX.pop(b, s, r, t + k * 0.035, { gain: 0.55 });
  },
};

/* ───────────── duzenleme ───────────── */

const LEVELS = {
  silence: {},
  pulse: { pad: 0.035, pulse: true, kick: 'four', kickGain: 0.2 },
  L1: { pad: 0.055 },
  L2: { pad: 0.05, mallet: 'quarter', bass: 0.08 },
  L3: { pad: 0.045, mallet: 'arp8', bass: 0.1, kick: 'half', hat: 'off8' },
  L4: { pad: 0.045, mallet: 'arp8', bass: 0.11, kick: 'four', hat: 'off8', hat16: true, clap: true },
  outro: { outro: true },
};

function arrange(id, def) {
  SPB = 60 / (def.bpm ?? TIMELINE.bpm);
  const seconds = def.beats * SPB + 2.5;
  const dry = new Bus(seconds);
  const send = new Bus(seconds);
  const rand = mulberry32(id.split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
  const energy = def.energy ?? 1;
  TRANSPOSE = def.transpose ?? 0;

  for (const [from, to, name] of def.music) {
    const L = LEVELS[name];
    if (!L) throw new Error(`Bilinmeyen muzik seviyesi: ${name}`);
    if (L.outro) {
      // son akor: tonik (Fmaj9), tek zil + uzun pad; son 2 vurusta sona dogru biter
      const t0 = from * SPB;
      const dur = (to - from) * SPB - 1.0;
      pad(dry, send, t0, dur, [53, 57, 60, 64, 67].map(tr), 0.05);
      bassNote(dry, t0, 1.5, tr(41), 0.09);
      [77, 81, 84, 88].forEach((m, k) => mallet(dry, send, t0 + k * SPB * 0.5, tr(m), 0.1, (k - 1.5) * 0.25));
      continue;
    }
    // olcu olcu pad
    for (let bar = Math.floor(from / 4) * 4; bar < to; bar += 4) {
      const s = Math.max(bar, from);
      const e = Math.min(bar + 4, to);
      if (e <= s) continue;
      const ch = chordAt(bar);
      if (L.pad) pad(dry, send, s * SPB, (e - s) * SPB, ch.pad.map(tr), L.pad);
    }
    // vurus vurus ritim
    for (let q = Math.ceil(from * 4) / 4; q < to - 1e-6; q += 0.25) {
      const t = q * SPB;
      const inBeat = q % 1;
      const beatInBar = Math.floor(q) % 4;
      const ch = chordAt(q);
      if (L.pulse && inBeat === 0) mallet(dry, send, t, tr(ch.pad[0] + 24), 0.07, 0.1);
      if (L.kick === 'four' && inBeat === 0) kick(dry, t, (L.kickGain ?? 0.24) * energy);
      if (L.kick === 'half' && inBeat === 0 && beatInBar % 2 === 0) kick(dry, t, 0.22 * energy);
      if (L.hat === 'off8' && inBeat === 0.5) hat(dry, rand, t, 0.17 * energy);
      if (L.hat16 && (inBeat === 0.25 || inBeat === 0.75)) hat(dry, rand, t, 0.075 * energy, -0.25);
      if (L.clap && inBeat === 0 && beatInBar % 2 === 1) clap(dry, send, rand, t, 0.13 * energy);
      if (L.mallet === 'quarter' && inBeat === 0) {
        const notes = ch.pad.map((m) => tr(m + 12));
        mallet(dry, send, t, notes[(beatInBar * 2) % notes.length], 0.085, (beatInBar - 1.5) * 0.2);
      }
      if (L.mallet === 'arp8' && (inBeat === 0 || inBeat === 0.5)) {
        const notes = ch.pad.map((m) => tr(m + 12));
        const pattern = [0, 2, 1, 3, 2, 0, 3, 1];
        const step = beatInBar * 2 + (inBeat === 0.5 ? 1 : 0);
        const accent = inBeat === 0 ? 1 : 0.7;
        mallet(dry, send, t, notes[pattern[step]] + (step === 3 || step === 6 ? 12 : 0), 0.075 * accent, (pattern[step] - 1.5) * 0.25);
      }
      if (L.bass) {
        const bp = { 0: 1.2, 1.5: 0.4, 2: 0.9, 3.5: 0.4 };
        const pos = (Math.floor(q) % 4) + inBeat;
        if (bp[pos] !== undefined) bassNote(dry, t, bp[pos] * SPB, tr(ch.bass), L.bass);
      }
    }
  }

  for (const ev of def.events) {
    if (!ev.sfx) continue;
    const fn = SFX[ev.sfx];
    if (!fn) throw new Error(`Bilinmeyen efekt: ${ev.sfx} (${ev.id})`);
    fn(dry, send, rand, ev.at * SPB, ev);
  }

  const wet = reverb(send);
  const out = new Bus(seconds);
  for (let i = 0; i < out.n; i++) {
    out.L[i] = dry.L[i] + wet.L[i] * 0.9;
    out.R[i] = dry.R[i] + wet.R[i] * 0.9;
  }
  // tam vurus sayisinda kes (video ile ayni uzunluk), son 80 ms'de yumusak kapanis
  const n = Math.round(def.beats * SPB * SR);
  const fade = Math.round(0.08 * SR);
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out.L[i]), Math.abs(out.R[i]));
  const g = 0.89 / (peak || 1);
  const pcm = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    const f = i > n - fade ? (n - i) / fade : 1;
    pcm.writeInt16LE(Math.round(Math.tanh(out.L[i] * g) * f * 32767), i * 4);
    pcm.writeInt16LE(Math.round(Math.tanh(out.R[i] * g) * f * 32767), i * 4 + 2);
  }
  return pcm;
}

function wav(pcm) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(2, 22);
  h.writeUInt32LE(SR, 24);
  h.writeUInt32LE(SR * 4, 28);
  h.writeUInt16LE(4, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/** iki gecisli loudnorm: -14 LUFS, -1.5 dBTP */
function loudnorm(src, dst) {
  const target = 'I=-14:TP=-1.5:LRA=11';
  // ffmpeg cozumu scripts/ffmpeg.mjs: sistemde yoksa Remotion'in kendi ffmpeg'i (uretim sunucusu)
  const m = runFfSync('ffmpeg', ['-hide_banner', '-nostats', '-i', src, '-af', `loudnorm=${target}:print_format=json`, '-f', 'null', '-']);
  const json = JSON.parse(m.stderr.slice(m.stderr.lastIndexOf('{'), m.stderr.lastIndexOf('}') + 1));
  const af = `loudnorm=${target}:measured_I=${json.input_i}:measured_TP=${json.input_tp}:measured_LRA=${json.input_lra}:measured_thresh=${json.input_thresh}:offset=${json.target_offset}:linear=true`;
  runFfSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-af', af, '-ar', String(SR), '-c:a', 'pcm_s16le', dst], { inherit: true });
  return json.input_i;
}

const only = process.argv[2];
mkdirSync(OUT_DIR, { recursive: true });
for (const [id, def] of Object.entries(TIMELINE.compositions)) {
  if (only && id !== only) continue;
  const t = Date.now();
  const raw = join(OUT_DIR, `.raw-${def.audio}`);
  const dst = join(OUT_DIR, def.audio);
  writeFileSync(raw, wav(arrange(id, def)));
  const before = loudnorm(raw, `${dst}.tmp.wav`);
  renameSync(`${dst}.tmp.wav`, dst);
  unlinkSync(raw);
  console.log(`${id}: ${def.audio} · ${(def.beats * SPB).toFixed(1)} sn · ham ${before} LUFS → -14 LUFS · ${((Date.now() - t) / 1000).toFixed(1)} sn`);
}
