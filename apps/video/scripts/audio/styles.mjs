/**
 * RanksUp Video muzik USLUPLERI — her tempo kendi temposu icin bestelenmis ayri bir parca:
 *
 *   fast    (Hizli, 120 BPM)  enerjik elektronik pop — duz vurus (four-on-the-floor) kick, 2/4'te
 *                             el cirpma, 16'lik hi-hat, pluck arpej, punchy bas, parlak stab'lar,
 *                             kick'e bagli "pompa" (sidechain), kisa / siki yanki.   Sol majör.
 *   normal  (Normal, 90 BPM)  sicak chill-hop / lo-fi — %60 swing'li 16'lik hi-hat, yumusak kick +
 *                             rim, FM elektrik piyano (7/9'lu akorlar), yuvarlak sub bas, cok
 *                             dusuk plak hisirtisi, orta yanki, hafif bant titremesi.   Mi bemol majör.
 *   slow    (Yavas, 72 BPM)   sakin sinematik / ambient — yavas filtre hareketli pad'ler, yumusak
 *                             piyano arpeji ve FM can, davul YOK (olcu basinda yalniz yumusak alcak
 *                             tom), uzun yanki kuyrugu, hava kabarmalari.   Re majör.
 *
 * Ayni duzenlemenin BPM degistirilmis hali DEGIL (21.10.2026 sahip geri bildirimi: "ayni muzigi
 * yavaslatmak kalitesiz duruyor"): akor yurusu, ton, groove, enstrumanlar ve efekt sesleri usluplere
 * gore farklidir. Bolum seviyeleri timeline.json ile ayni adlari tasir (pulse · L1 · L2 · L3 · L4 ·
 * outro · silence); her uslup bunlari kendi diliyle yorumlar.
 *
 * DONGU KURALI: govde / giris kokleri 16 vurusluk pencereden kesilir (synth.mjs). Bu yuzden her
 * modulasyon (LFO, swing, insanlastirma, gurultu tohumu) mutlak vurusun 16 vurus modunda
 * periyodiktir; Math.random YOK — ayni girdi her calistirmada ayni ornekleri uretir.
 *
 * Hicbir ornek (sample) ya da hazir ses yok: polyBLEP testere, sinus tablosu, FM, TPT durum-degisken
 * filtre, Freeverb benzeri yanki ve ping-pong gecikme.
 */

export const SR = 48000;
/** dongu boyu (vurus) — timeline.json tempo.loopBeats ile ayni olmali (synth.mjs dogrular) */
export const LOOP_BEATS = 16;

/* ───────────── temel DSP ───────────── */

const TN = 4096;
const SINT = new Float64Array(TN + 1);
for (let i = 0; i <= TN; i++) SINT[i] = Math.sin((2 * Math.PI * i) / TN);
/** sin(2π·ph) — ph devir cinsinden (tablo + dogrusal ara deger; hata < 1e-6) */
export function sin1(ph) {
  let x = (ph - Math.floor(ph)) * TN;
  let i = x | 0;
  // ph cok kucuk negatifken kesir 1,0'a yuvarlanabilir: tablonun disina tasmasin
  if (i >= TN) {
    i = 0;
    x = 0;
  }
  return SINT[i] + (SINT[i + 1] - SINT[i]) * (x - i);
}
const cos1 = (ph) => sin1(ph + 0.25);
export const mtof = (m) => 440 * 2 ** ((m - 69) / 12);

function hash32(a, b) {
  let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b);
  h ^= Math.imul((b | 0) + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}
/** tohumlu beyaz gurultu ornegi [-1, 1) */
const nz = (k, salt) => hash32(k, salt) / 2147483648 - 1;
/** tohumlu [0, 1) */
const h01 = (a, b) => hash32(a, b) / 4294967296;

/** TPT durum-degisken filtre (Zavalishin): lp() dondurur, bp / hp alanlarda */
class SVF {
  constructor() {
    this.ic1 = 0;
    this.ic2 = 0;
    this.bp = 0;
    this.hp = 0;
  }
  set(fc, q = 0.707) {
    const g = Math.tan((Math.PI * Math.min(Math.max(fc, 10), SR * 0.45)) / SR);
    this.k = 1 / q;
    this.a1 = 1 / (1 + g * (g + this.k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
    return this;
  }
  lp(x) {
    const v3 = x - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    this.bp = v1;
    this.hp = x - this.k * v1 - v2;
    return v2;
  }
}

/** polyBLEP testere (bant sinirli) */
class Saw {
  constructor(phase = 0) {
    this.p = phase;
  }
  next(f) {
    const dt = f / SR;
    this.p += dt;
    if (this.p >= 1) this.p -= 1;
    let p = this.p;
    let v = 2 * p - 1;
    if (p < dt) {
      p /= dt;
      v -= p + p - p * p - 1;
    } else if (p > 1 - dt) {
      p = (p - 1) / dt;
      v -= p * p + p + p + 1;
    }
    return v;
  }
}

class Bus {
  constructor(n) {
    this.n = n;
    this.L = new Float32Array(n);
    this.R = new Float32Array(n);
  }
  /**
   * fn(x, k): x nota basindan saniye, k ornek sirasi. pan: sayi ya da fn(x). sends: [[bus, kazanc]]
   * — ayni ornek bir kez hesaplanir, gonderimlere de yazilir.
   */
  add(t0, dur, pan, gain, fn, sends = null) {
    const s0 = Math.round(t0 * SR);
    const i0 = Math.max(0, s0);
    const i1 = Math.min(this.n, Math.round((t0 + dur) * SR));
    const dyn = typeof pan === 'function';
    let gl = 0;
    let gr = 0;
    if (!dyn) {
      gl = cos1((pan + 1) / 8);
      gr = sin1((pan + 1) / 8);
    }
    for (let i = i0; i < i1; i++) {
      const x = i / SR - t0;
      const v = fn(x, i - s0) * gain;
      if (dyn) {
        const p = Math.max(-1, Math.min(1, pan(x)));
        gl = cos1((p + 1) / 8);
        gr = sin1((p + 1) / 8);
      }
      const l = v * gl;
      const r = v * gr;
      this.L[i] += l;
      this.R[i] += r;
      if (sends) for (const [b, g] of sends) {
        b.L[i] += l * g;
        b.R[i] += r * g;
      }
    }
  }
}

/** Freeverb benzeri stereo yanki (8 tarak + 4 tum-geciren); predelay saniye */
function reverb(bus, room, damp, predelay = 0) {
  const scale = SR / 44100;
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
  const aps = [556, 441, 341, 225];
  const pd = Math.round(predelay * SR);
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
        buf[idx] = (i >= pd ? input[i - pd] : 0) * 0.015 + store * room;
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

/** ping-pong gecikme (tempoya bagli); geri besleme yolunda tek kutuplu alcak geciren */
function pingPong(bus, delaySec, fb, lpHz) {
  const d = Math.max(1, Math.round(delaySec * SR));
  const bl = new Float32Array(d);
  const br = new Float32Array(d);
  const L = new Float32Array(bus.n);
  const R = new Float32Array(bus.n);
  const a = 1 - Math.exp((-2 * Math.PI * lpHz) / SR);
  let sl = 0;
  let sr = 0;
  let idx = 0;
  for (let i = 0; i < bus.n; i++) {
    const yl = bl[idx];
    const yr = br[idx];
    sl += a * (yr * fb - sl);
    sr += a * (yl * fb - sr);
    bl[idx] = (bus.L[i] + bus.R[i]) * 0.5 + sl;
    br[idx] = sr;
    L[i] = yl;
    R[i] = yr;
    idx = idx + 1 === d ? 0 : idx + 1;
  }
  return { L, R };
}

/* ───────────── yardimcilar ───────────── */

const frac = (q) => q - Math.floor(q);
/** [from, to) icinde step araliklarla vurus konumlari */
function* steps(from, to, step) {
  for (let q = Math.ceil(from / step - 1e-9) * step; q < to - 1e-9; q += step) yield Math.round(q * 1e6) / 1e6;
}
/** olcu olcu: [s, e) parca ve olcu indeksi */
function* bars(from, to) {
  for (let b = Math.floor(from / 4) * 4; b < to; b += 4) {
    const s = Math.max(b, from);
    const e = Math.min(b + 4, to);
    if (e > s) yield [s, e, b / 4];
  }
}
/** dongu icindeki konum (0..LOOP_BEATS) — insanlastirma / gurultu tohumu periyodik olsun */
const loopPos = (q) => ((q % LOOP_BEATS) + LOOP_BEATS) % LOOP_BEATS;
const seedOf = (q, id) => Math.round(loopPos(q) * 96) + id * 100003;
/** yumusak giris (0..1): 0,5 - 0,5 cos */
const smoothIn = (x, a) => (x >= a ? 1 : x <= 0 ? 0 : 0.5 - 0.5 * cos1(x / (2 * a)));
const release = (x, len, r) => (x > len ? Math.exp(-(x - len) / r) : 1);

/* ───────────── 1) HIZLI — enerjik elektronik pop (Sol majör, I–V–vi–IV) ───────────── */

const FAST_PROG = [
  { name: 'G', bass: 31, pad: [55, 59, 62, 69], arp: [67, 71, 74, 79, 81], stab: [67, 71, 74, 79] },
  { name: 'D/F#', bass: 30, pad: [54, 57, 62, 66], arp: [66, 69, 74, 78, 81], stab: [66, 69, 74, 78] },
  { name: 'Em7', bass: 28, pad: [52, 55, 59, 62], arp: [64, 67, 71, 74, 76], stab: [64, 67, 71, 74] },
  { name: 'Cadd9', bass: 36, pad: [52, 55, 60, 62], arp: [64, 67, 72, 74, 79], stab: [64, 67, 72, 74] },
];
const FAST_ARP = [0, 1, 2, 4, 2, 1, 3, 2, 0, 1, 2, 4, 3, 2, 1, 2];

const fastI = {
  kick(c, q, g) {
    const t = q * c.spb;
    const salt = seedOf(q, 1);
    c.dry.add(t, 0.5, 0, g, (x, k) => {
      const ph = 48 * x + 130 * 0.03 * (1 - Math.exp(-x / 0.03));
      let v = sin1(ph) * Math.exp(-x / 0.19) * Math.min(1, x / 0.001);
      if (k < 96) v += nz(k, salt) * 0.25 * (1 - k / 96);
      return Math.tanh(v * 1.8);
    });
    c.duckAt(t, 0.55, 0.11);
  },
  clap(c, q, g) {
    const salt = seedOf(q, 2);
    const f = new SVF().set(1250, 1.1);
    c.dry.add(q * c.spb, 0.45, -0.08, g, (x, k) => {
      f.lp(nz(k, salt));
      const bursts = x < 0.033 ? Math.exp(-(x % 0.011) / 0.0028) : 0;
      const tail = Math.exp(-x / 0.12) * Math.min(1, x / 0.01);
      return f.bp * (bursts + tail * 0.55) * 2.2;
    }, [[c.send, 0.5]]);
  },
  hat(c, q, g, open = false, pan = 0.3) {
    const salt = seedOf(q, 3);
    const f = new SVF().set(7600, 0.9);
    const d = open ? 0.17 : 0.03;
    c.dry.add(q * c.spb, open ? 0.6 : 0.12, pan, g, (x, k) => {
      f.lp(nz(k, salt));
      return f.hp * Math.exp(-x / d) * Math.min(1, x / 0.0006);
    }, [[c.send, 0.08]]);
  },
  pluck(c, q, m, vel, pan, cut) {
    const f = mtof(m);
    const s1 = new Saw(h01(m, 7));
    const s2 = new Saw(h01(m, 9));
    const flt = new SVF();
    let cnt = 0;
    c.pump.add(q * c.spb, 0.55, pan, 0.17 * vel, (x) => {
      if ((cnt++ & 15) === 0) flt.set(320 + cut * (300 + 4200 * Math.exp(-x / 0.06)), 1.3);
      return flt.lp(s1.next(f) + 0.6 * s2.next(f * 1.0046)) * Math.min(1, x / 0.002) * Math.exp(-x / 0.15);
    }, [[c.send, 0.18], [c.echo, 0.25]]);
  },
  bass(c, q, len, m, g) {
    const f = mtof(m);
    const saw = new Saw(0);
    const flt = new SVF();
    let cnt = 0;
    const L = len * c.spb;
    c.dry.add(q * c.spb, L + 0.08, 0, g, (x) => {
      if ((cnt++ & 15) === 0) flt.set(150 + 1500 * Math.exp(-x / 0.045), 1.5);
      const env = Math.min(1, x / 0.003) * (0.75 + 0.25 * Math.exp(-x / 0.08)) * release(x, L, 0.012);
      return (flt.lp(saw.next(f)) * 0.8 + sin1(f * x) * 0.75) * env;
    });
  },
  stab(c, q, notes, len, vel) {
    const L = len * c.spb;
    notes.forEach((m, j) => {
      const f = mtof(m);
      const vs = [new Saw(h01(m, 1)), new Saw(h01(m, 2)), new Saw(h01(m, 3))];
      const flt = new SVF();
      let cnt = 0;
      const pan = (j / (notes.length - 1) - 0.5) * 0.9;
      c.pump.add(q * c.spb, L + 0.4, pan, 0.075 * vel, (x) => {
        if ((cnt++ & 15) === 0) flt.set(1300 + 6500 * Math.exp(-x / 0.09), 0.85);
        const v = flt.lp(vs[0].next(f * 0.9934) + vs[1].next(f) + vs[2].next(f * 1.0066));
        return v * Math.min(1, x / 0.003) * Math.exp(-x / 0.4) * release(x, L, 0.06);
      }, [[c.send, 0.3], [c.echo, 0.12]]);
    });
  },
  pad(c, s, e, notes, g) {
    const t0 = s * c.spb;
    const len = (e - s) * c.spb;
    notes.forEach((m, j) => {
      const f = mtof(m);
      const a = new Saw(h01(m, 21));
      const b = new Saw(h01(m, 22));
      const flt = new SVF();
      let cnt = 0;
      c.pump.add(t0, len + 1.2, (j / (notes.length - 1) - 0.5) * 1.1, g, (x) => {
        if ((cnt++ & 31) === 0) flt.set(1300 + 700 * (0.5 - 0.5 * cos1((t0 + x) / c.loopSec)), 0.7);
        return flt.lp(a.next(f * 0.9962) + b.next(f * 1.0038)) * smoothIn(x, 0.05) * release(x, len, 0.25);
      }, [[c.send, 0.35]]);
    });
  },
};

const FAST = {
  info: {
    label: 'Hızlı', genre: 'enerjik elektronik pop', bpmRange: [120, 124], key: 'G major', tonic: 7, mode: 'major',
    progression: 'G – D/F# – Em7 – Cadd9 (I–V–vi–IV)', swing: 0.5, hats: true, pulse: 0.25, texture: ['pad'],
    instruments: 'four-on-the-floor kick (sidechain pompa), 2/4 clap, 16\'lik hi-hat + offbeat açık hat, pluck arpej (ping-pong eko), punchy testere bas, supersaw stab, supersaw pad',
    reverb: 'kısa (room 0,7)',
  },
  fx: { room: 0.7, damp: 0.4, wet: 0.7, predelay: 0, delayBeats: 0.75, fb: 0.32, delayLp: 5000, echoMix: 0.45, tail: 2.5 },
  levels: {
    pulse: { pad: 0.7, arp: 8, cut: 0.3, kick: 0.55 },
    L1: { pad: 1 },
    L2: { pad: 1, arp: 8, cut: 0.7, bass: 0.85, hats: 'off8' },
    L3: { pad: 0.85, arp: 16, cut: 1, bass: 1, kick: 1, clap: true, hats: '16' },
    L4: { pad: 0.85, arp: 16, cut: 1, bass: 1, kick: 1, clap: true, hats: '16', open: true, stabs: true, fill: true },
  },
  chordAt: (q) => FAST_PROG[Math.floor(q / 4 + 1e-9) % 4],
  section(c, from, to, L) {
    const e = c.energy;
    for (const [s, en, bar] of bars(from, to)) if (L.pad) fastI.pad(c, s, en, FAST_PROG[bar % 4].pad, 0.045 * L.pad);
    for (const q of steps(from, to, 0.25)) {
      const ib = frac(q);
      const beat = Math.floor(q) % 4;
      const s16 = Math.round(frac(q / 4) * 16) % 16;
      const ch = this.chordAt(q);
      const lp = loopPos(q);
      if (L.kick && ib === 0) fastI.kick(c, q, 0.5 * e * L.kick);
      if (L.clap && ib === 0 && beat % 2 === 1) fastI.clap(c, q, 0.3 * e);
      if (L.fill && lp >= 15 && ib !== 0) fastI.clap(c, q, 0.09 * e * (1 + (lp - 15) * 2));
      if (L.hats === 'off8' && ib === 0.5) fastI.hat(c, q, 0.26 * e);
      if (L.hats === '16') {
        if (L.open && ib === 0.5) fastI.hat(c, q, 0.14 * e, true, 0.2);
        else fastI.hat(c, q, [0.16, 0.11, 0.33, 0.11][Math.round(ib * 4)] * e, false, ib === 0.5 ? 0.3 : -0.25);
      }
      if (L.arp && (L.arp === 16 || ib === 0 || ib === 0.5)) {
        const acc = ib === 0 ? 1 : ib === 0.5 ? 0.8 : 0.6;
        const k = FAST_ARP[s16];
        fastI.pluck(c, q, ch.arp[k], acc, (k - 2) * 0.22, L.cut);
      }
      if (L.bass) {
        if (ib === 0) fastI.bass(c, q, 0.2, ch.bass, 0.36 * L.bass);
        if (ib === 0.5) fastI.bass(c, q, 0.4, ch.bass + (beat === 3 ? 12 : 0), 0.48 * L.bass);
      }
      if (L.stabs && ib === 0 && [0, 3].includes(beat)) fastI.stab(c, q, ch.stab, 0.3, beat === 0 ? 1 : 0.8);
      if (L.stabs && ib === 0.5 && beat === 1) fastI.stab(c, q, ch.stab, 0.3, 0.9);
    }
  },
  outro(c, from, to) {
    const end = to - 1.5;
    fastI.pad(c, from, Math.max(from + 1, end), [55, 59, 62, 66, 69], 0.045);
    fastI.stab(c, from, [67, 71, 74, 79, 83], 1.4, 1.1);
    fastI.bass(c, from, 2.5, 31, 0.45);
    [79, 74, 71, 74, 79, 83].forEach((m, k) => fastI.pluck(c, from + 1 + k * 0.5, m, 0.85 - k * 0.08, k % 2 ? 0.3 : -0.3, 0.85));
  },
  sfx: {
    pop(c, t, ev) {
      c.dry.add(t, 0.18, 0.1, 0.2 * (ev.gain ?? 1), (x) => {
        const ph = 820 * x + 900 * (x - 0.02 * (1 - Math.exp(-x / 0.02)));
        return (sin1(ph) + 0.3 * sin1(3 * ph)) * Math.min(1, x / 0.001) * Math.exp(-x / 0.045);
      }, [[c.send, 0.15]]);
    },
    thock(c, t) {
      c.dry.add(t, 0.25, 0, 0.36, (x, k) => {
        const ph = 95 * x + 95 * 0.025 * (1 - Math.exp(-x / 0.025));
        return Math.tanh(1.5 * (sin1(ph) * Math.exp(-x / 0.07) + (k < 80 ? nz(k, 91) * 0.4 * (1 - k / 80) : 0)));
      });
    },
    tick(c, t) {
      c.dry.add(t, 0.08, 0.15, 0.13, (x, k) => (sin1(3200 * x) + 0.3 * sin1(6400 * x)) * Math.exp(-x / 0.014) + (k < 48 ? nz(k, 92) * 0.5 * (1 - k / 48) : 0), [[c.send, 0.1]]);
    },
    tickLow(c, t) {
      c.dry.add(t, 0.1, -0.15, 0.13, (x, k) => (sin1(1600 * x) + 0.3 * sin1(3200 * x)) * Math.exp(-x / 0.018) + (k < 48 ? nz(k, 93) * 0.35 * (1 - k / 48) : 0), [[c.send, 0.1]]);
    },
    whoosh(c, t, ev) {
      const d = (ev.dur ?? 0.6) * c.spb;
      const start = t - d * 0.6;
      const f = new SVF();
      let cnt = 0;
      c.dry.add(start, d, (x) => -0.5 + x / d, 0.3, (x, k) => {
        const p = x / d;
        if ((cnt++ & 15) === 0) f.set(600 + 6500 * p * p, 1.4);
        f.lp(nz(k, 94));
        return f.bp * sin1(p / 2) ** 2;
      }, [[c.send, 0.25]]);
    },
    riser(c, t, ev) {
      const d = (ev.dur ?? 1) * c.spb;
      const f = new SVF();
      const saw = new Saw(0);
      let cnt = 0;
      c.dry.add(t - d, d, 0, 0.17, (x, k) => {
        const p = x / d;
        if ((cnt++ & 15) === 0) f.set(500 + 7500 * p * p, 1.6);
        f.lp(nz(k, 95) + 0.25 * saw.next(200 + 600 * p));
        return f.bp * p * p;
      }, [[c.send, 0.3]]);
    },
    hit(c, t) {
      const q = t / c.spb;
      fastI.kick(c, q, 0.7);
      fastI.clap(c, q, 0.22);
      const salt = seedOf(q, 96);
      const f = new SVF().set(6000, 0.7);
      c.dry.add(t, 1.2, 0, 0.09, (x, k) => {
        f.lp(nz(k, salt));
        return f.hp * Math.exp(-x / 0.35) * Math.min(1, x / 0.001);
      }, [[c.send, 0.4]]);
    },
  },
};

/* ───────────── 2) NORMAL — sicak chill-hop / lo-fi (Mi bemol majör, ii–V–I–vi) ───────────── */

const SWING = 0.6;
/** 16'lik swing: her sekizligin ikinci 16'ligi sekizligin %60'ina kayar */
const swung = (q) => {
  const e = Math.floor(q * 2 + 1e-9) / 2;
  return Math.abs(q - e - 0.25) < 1e-6 ? e + 0.5 * SWING : q;
};

const NORM_PROG = [
  { name: 'Fm9', bass: [41, 36, 33], ep: [56, 60, 63, 67] },
  { name: 'B♭13', bass: [34, 41, 38], ep: [56, 62, 67, 72] },
  { name: 'E♭maj9', bass: [39, 34, 35], ep: [55, 58, 62, 65] },
  { name: 'Cm9', bass: [36, 43, 40], ep: [51, 55, 58, 62] },
];
/** L4 karsi ezgisi (vibrafon): [vurus, nota, uzunluk] — 16 vurusluk dongu */
const NORM_MELODY = [
  [0.5, 72, 0.5], [1, 75, 0.75], [2, 72, 0.5], [2.75, 70, 1],
  [4.5, 74, 0.5], [5, 72, 0.5], [5.5, 70, 1.5],
  [8.5, 70, 0.5], [9, 74, 0.5], [9.5, 77, 1], [11, 75, 0.75],
  [12.5, 74, 0.5], [13, 72, 0.5], [13.75, 70, 0.5], [14.5, 67, 1.5],
];

const normI = {
  /** FM elektrik piyano: 1:1 modulator + kisa "tine" kismi; bant titremesi ve stereo tremolo */
  ep(c, t, m, len, vel, panBase, j = 0) {
    const f = mtof(m);
    const P = 2 * c.spb;
    const wow = (0.0016 * P) / (2 * Math.PI);
    const idx0 = 0.9 + 1.3 * vel;
    c.dry.add(t, len + 0.9, (x) => panBase + 0.3 * sin1((t + x) / P + j * 0.13), 0.16 * vel, (x) => {
      const ph = f * (x + wow * sin1((t + x) / P));
      const I = 0.3 + idx0 * Math.exp(-x / 0.5);
      let v = sin1(ph + (I * sin1(ph)) / (2 * Math.PI));
      v += 0.09 * vel * sin1(ph * 7.02) * Math.exp(-x / 0.02);
      return v * Math.min(1, x / 0.004) * (0.3 + 0.7 * Math.exp(-x / 1.2)) * release(x, len, 0.14);
    }, [[c.send, 0.32]]);
  },
  chord(c, q, notes, lenBeats, vel, up = true) {
    const t = q * c.spb;
    const order = up ? notes : [...notes].reverse();
    order.forEach((m, j) => {
      const hv = 0.85 + 0.3 * h01(seedOf(q, 41), m);
      normI.ep(c, t + j * 0.014, m, lenBeats * c.spb - j * 0.014, vel * hv, (notes.indexOf(m) / (notes.length - 1) - 0.5) * 0.7, j);
    });
  },
  bass(c, q, lenBeats, m, vel) {
    const f = mtof(m);
    const len = lenBeats * c.spb;
    c.dry.add(swung(q) * c.spb, len + 0.12, 0, 0.21 * vel, (x) => {
      const ph = f * x;
      const env = smoothIn(x, 0.012) * (0.78 + 0.22 * Math.exp(-x / 0.25)) * release(x, len, 0.05);
      return (sin1(ph) + 0.22 * sin1(2 * ph) + 0.05 * sin1(3 * ph)) * env;
    });
  },
  kick(c, q, g) {
    c.dry.add(swung(q) * c.spb, 0.55, 0, g, (x) => {
      const ph = 50 * x + 45 * 0.035 * (1 - Math.exp(-x / 0.035));
      return sin1(ph) * smoothIn(x, 0.0025) * Math.exp(-x / 0.26);
    });
  },
  rim(c, q, g) {
    const salt = seedOf(q, 42);
    const bp = new SVF().set(2200, 2);
    const lp = new SVF().set(4200, 0.7);
    c.dry.add(q * c.spb, 0.35, -0.12, g, (x, k) => {
      const n = nz(k, salt);
      bp.lp(n);
      const click = bp.bp * Math.exp(-x / 0.006) * 1.6 + 0.4 * sin1(1700 * x) * Math.exp(-x / 0.012) + 0.55 * sin1(420 * x) * Math.exp(-x / 0.03);
      const brush = lp.lp(n) * Math.exp(-x / 0.09) * 0.35;
      return click + brush;
    }, [[c.send, 0.45]]);
  },
  hat(c, q, g) {
    const salt = seedOf(q, 43);
    const hp = new SVF().set(6000, 0.8);
    const lp = new SVF().set(10500, 0.7);
    c.dry.add(swung(q) * c.spb, 0.09, 0.25, g, (x, k) => {
      hp.lp(nz(k, salt));
      return lp.lp(hp.hp) * Math.exp(-x / 0.032) * Math.min(1, x / 0.0008);
    }, [[c.send, 0.12]]);
  },
  /** plak hisirtisi + seyrek citirti: mutlak ornek sirasiyla tohumlanir (dongu periyodik) */
  vinyl(c, from, to, fadeOut = false) {
    const t0 = from * c.spb;
    const dur = (to - from) * c.spb;
    const per = Math.round(c.loopSec * SR);
    for (const [pan, salt] of [[-0.6, 51], [0.6, 52]]) {
      const lp = new SVF().set(3200, 0.6);
      const hp = new SVF().set(300, 0.6);
      let cr = 0;
      c.dry.add(t0, dur, pan, 1, (x) => {
        const i = Math.round((t0 + x) * SR) % per;
        hp.lp(lp.lp(nz(i, salt)));
        const r = h01(i, salt + 7);
        if (r < 3.2e-5) cr += (r < 1.6e-5 ? 1 : -1) * (0.4 + 0.6 * h01(i, salt + 9));
        cr *= 0.7;
        const fade = fadeOut ? Math.max(0, 1 - x / dur) : 1;
        return (hp.hp * 0.016 + cr * 0.06) * fade;
      });
    }
  },
  vibes(c, t, m, len, vel) {
    const f = mtof(m);
    c.dry.add(t, len + 1.6, 0.2, 0.095 * vel, (x) => {
      const trem = 1 + 0.22 * sin1((t + x) * (4 / c.spb));
      const v = sin1(f * x) + 0.22 * sin1(4 * f * x) * Math.exp(-x / 0.3) + 0.06 * sin1(10 * f * x) * Math.exp(-x / 0.05);
      return v * trem * Math.min(1, x / 0.003) * Math.exp(-x / 1.1) * release(x, len, 0.3);
    }, [[c.send, 0.45], [c.echo, 0.28]]);
  },
};

const NORMAL = {
  info: {
    label: 'Normal', genre: 'sıcak chill-hop / lo-fi', bpmRange: [90, 96], key: 'E♭ major', tonic: 3, mode: 'major',
    progression: 'Fm9 – B♭13 – E♭maj9 – Cm9 (ii–V–I–vi)', swing: SWING, hats: true, pulse: 0.25, texture: ['vinyl'],
    instruments: 'yumuşak kick + rim/fırça, %60 swing\'li 16\'lık hi-hat, FM elektrik piyano (7/9\'lu akor, bant titremesi, stereo tremolo), yuvarlak sub bas, L4\'te vibrafon karşı ezgisi, çok düşük plak hışırtısı',
    reverb: 'orta (room 0,82), ana çıkışta 8,5 kHz yumuşatma',
  },
  fx: { room: 0.82, damp: 0.5, wet: 0.75, predelay: 0.012, delayBeats: 0.75, fb: 0.3, delayLp: 3200, echoMix: 0.4, tail: 3.5, masterLp: 8500 },
  levels: {
    pulse: { ep: 'hold', kick: 'pulse', vinyl: true },
    L1: { ep: 'hold', vinyl: true },
    L2: { ep: 'half', bass: 0.85, hats: 0.6, vinyl: true },
    L3: { ep: 'comp', bass: 1, hats: 1, kick: 'groove', rim: true, vinyl: true },
    L4: { ep: 'comp', bass: 1, hats: 1, kick: 'groove', rim: true, vinyl: true, melody: true },
  },
  chordAt: (q) => NORM_PROG[Math.floor(q / 4 + 1e-9) % 4],
  section(c, from, to, L) {
    const e = c.energy;
    if (L.vinyl) normI.vinyl(c, from, to);
    for (const q of steps(from, to, 0.25)) {
      const ib = frac(q);
      const pos = frac(q / 4) * 4;
      const bar = Math.floor(q / 4 + 1e-9);
      const ch = this.chordAt(q);
      const next = NORM_PROG[(bar + 1) % 4];
      if (L.ep === 'hold' && pos === 0) normI.chord(c, q, ch.ep, Math.min(3.9, to - q + 0.5), 0.75);
      if (L.ep === 'half') {
        if (pos === 0) normI.chord(c, q, ch.ep, 2.3, 0.8);
        if (pos === 2.5) normI.chord(c, q, ch.ep, 1.3, 0.55, false);
      }
      if (L.ep === 'comp') {
        if (pos === 0) normI.chord(c, q, ch.ep, 1.35, 0.9);
        if (pos === 1.5) normI.chord(c, q, ch.ep, 0.85, 0.55, false);
        if (pos === 3.5) normI.chord(c, q, next.ep, 0.4, 0.7);
      }
      if (L.bass) {
        if (pos === 0) normI.bass(c, q, 1.3, ch.bass[0], L.bass);
        if (pos === 1.75) normI.bass(c, q, 0.35, ch.bass[0], 0.7 * L.bass);
        if (pos === 2.5) normI.bass(c, q, 0.9, ch.bass[1], 0.85 * L.bass);
        if (pos === 3.5) normI.bass(c, q, 0.4, ch.bass[2], 0.75 * L.bass);
      }
      if (L.kick === 'pulse' && (pos === 0 || pos === 2)) normI.kick(c, q, 0.32 * e);
      if (L.kick === 'groove') {
        const hits = bar % 2 === 0 ? [0, 2.5] : [0, 1.75, 2.5];
        if (hits.includes(pos)) normI.kick(c, q, (pos === 0 ? 0.5 : 0.4) * e);
      }
      if (L.rim && ib === 0 && (pos === 1 || pos === 3)) normI.rim(c, q, 0.22 * e);
      if (L.hats) {
        const v = [0.6, 0.22, 0.45, 0.25][Math.round(ib * 4)] * (0.85 + 0.3 * h01(seedOf(q, 44), 1));
        normI.hat(c, q, v * L.hats * e);
      }
    }
    if (L.melody) {
      for (const [b, m, len] of NORM_MELODY) {
        for (let base = Math.floor(from / LOOP_BEATS) * LOOP_BEATS; base < to; base += LOOP_BEATS) {
          const q = base + b;
          if (q >= from && q < to) normI.vibes(c, swung(q) * c.spb, m, len * c.spb, 0.9);
        }
      }
    }
  },
  outro(c, from, to) {
    normI.vinyl(c, from, to, true);
    const len = Math.max(1, to - from - 2);
    normI.chord(c, from, [51, 55, 58, 62, 65, 70], len, 0.95);
    normI.bass(c, from, 3, 39, 1.1);
    [70, 74, 77, 79, 82].forEach((m, k) => normI.vibes(c, (from + 1 + k * 0.5) * c.spb, m, 1.2 * c.spb, 0.75 - k * 0.07));
  },
  sfx: {
    pop(c, t, ev) {
      const lp = new SVF().set(2400, 0.7);
      c.dry.add(t, 0.25, 0.1, 0.2 * (ev.gain ?? 1), (x) => {
        const ph = 520 * x + 180 * 0.03 * (1 - Math.exp(-x / 0.03));
        return lp.lp(sin1(ph) + 0.15 * sin1(2 * ph)) * Math.min(1, x / 0.0015) * Math.exp(-x / 0.06);
      }, [[c.send, 0.25]]);
    },
    thock(c, t) {
      const lp = new SVF().set(1500, 0.7);
      c.dry.add(t, 0.2, 0, 0.24, (x, k) => sin1(330 * x) * Math.exp(-x / 0.035) + 0.3 * sin1(850 * x) * Math.exp(-x / 0.012) + lp.lp(nz(k, 61)) * 0.25 * Math.exp(-x / 0.004), [[c.send, 0.2]]);
    },
    tick(c, t) {
      const lp = new SVF().set(5000, 0.7);
      c.dry.add(t, 0.08, 0.15, 0.09, (x, k) => sin1(1500 * x) * Math.exp(-x / 0.01) + lp.lp(nz(k, 62)) * 0.3 * Math.exp(-x / 0.002), [[c.send, 0.2]]);
    },
    tickLow(c, t) {
      const lp = new SVF().set(4000, 0.7);
      c.dry.add(t, 0.1, -0.15, 0.09, (x, k) => sin1(900 * x) * Math.exp(-x / 0.014) + lp.lp(nz(k, 63)) * 0.25 * Math.exp(-x / 0.002), [[c.send, 0.2]]);
    },
    whoosh(c, t, ev) {
      const d = (ev.dur ?? 1) * c.spb;
      const start = t - d * 0.6;
      const f = new SVF();
      let cnt = 0;
      c.dry.add(start, d, (x) => -0.35 + (0.7 * x) / d, 0.32, (x, k) => {
        const p = x / d;
        if ((cnt++ & 15) === 0) f.set(400 + 1800 * Math.sin(Math.PI * p), 0.8);
        return f.lp(nz(k, 64)) * sin1(p / 2) ** 2;
      }, [[c.send, 0.35]]);
    },
    riser(c, t, ev) {
      const d = (ev.dur ?? 1) * c.spb;
      const f = new SVF();
      let cnt = 0;
      c.dry.add(t - d, d, 0, 0.16, (x, k) => {
        const p = x / d;
        if ((cnt++ & 15) === 0) f.set(300 + 2400 * p * p, 0.8);
        return f.lp(nz(k, 65)) * p * p;
      }, [[c.send, 0.4]]);
    },
    hit(c, t) {
      const q = t / c.spb;
      normI.kick(c, q, 0.6);
      c.dry.add(t, 1.6, 0, 0.12, (x) => sin1(mtof(39) * x) * smoothIn(x, 0.01) * Math.exp(-x / 0.6));
      normI.vibes(c, t, 87, 0.8, 0.6);
    },
  },
};

/* ───────────── 3) YAVAS — sakin sinematik / ambient (Re majör) ───────────── */

const SLOW_PROG = [
  { name: 'Dadd9', sub: 38, pad: [50, 57, 64, 66], arp: [62, 66, 69, 74, 76] },
  { name: 'Bm7', sub: 35, pad: [47, 54, 57, 62], arp: [59, 62, 66, 69, 74] },
  { name: 'Gmaj9', sub: 31, pad: [43, 50, 54, 57, 59], arp: [55, 59, 62, 66, 69] },
  { name: 'A7sus4', sub: 33, pad: [45, 50, 52, 55], arp: [57, 62, 64, 67, 69] },
];
/** L4 can ezgisi: [vurus, nota, uzunluk(vurus)] — 16 vurusluk dongu */
const SLOW_BELLS = [[0, 78, 2], [2, 76, 2], [4, 74, 3], [8, 74, 1.5], [9.5, 78, 2.5], [12, 76, 2], [14, 79, 2]];
const SLOW_ARP8 = [0, 2, 3, 4, 3, 2, 1, 2];

const slowI = {
  /** evrilen pad: iki detune testere + sinus govde; filtre kesimi 16 vurusluk yavas LFO ile */
  pad(c, t0, len, notes, g, cut, attack = 1.3) {
    notes.forEach((m, j) => {
      const f = mtof(m);
      const a = new Saw(h01(m, 31));
      const b = new Saw(h01(m, 32));
      const flt = new SVF();
      let cnt = 0;
      const pan = (j / (notes.length - 1) - 0.5) * 1.3;
      c.dry.add(t0, len + 5, pan, g, (x) => {
        if ((cnt++ & 31) === 0) {
          const u = (t0 + x) / c.loopSec;
          flt.set(cut * (350 + 1500 * (0.5 - 0.5 * cos1(u + j * 0.07))) + f * 0.6, 0.85);
        }
        const v = flt.lp(a.next(f * 0.9978) + b.next(f * 1.0022)) * 0.7 + 0.45 * sin1(f * x);
        const sh = 1 + 0.1 * sin1((t0 + x) / (c.loopSec / 4) + j * 0.21);
        return v * sh * smoothIn(x, attack) * release(x, len, 1.1);
      }, [[c.send, 0.65]]);
    });
  },
  /**
   * yumusak (kece) piyano: hafif inharmonik kismi tonlar, iki asamali sonum (kisa "ilk ses" +
   * uzun "art ses" — notalar arpejde birbirine karismasin, her vurus duyulsun) ve kece cekic tokmagi
   */
  piano(c, t, m, vel, pan = 0) {
    const f = mtof(m);
    const parts = [1, 2, 3, 4, 5, 6]
      .map((n) => [n * f * Math.sqrt(1 + 0.00035 * n * n), [1, 0.42, 0.2, 0.1, 0.05, 0.025][n - 1] * vel ** ((n - 1) * 0.5), 0.22 / (1 + 0.3 * (n - 1)), 1.7 / (1 + 0.6 * (n - 1))])
      .filter(([fr]) => fr < 9000);
    const salt = seedOf(t / c.spb, 34) + m;
    const ham = new SVF().set(900, 0.7);
    c.dry.add(t, 3.5, pan, 0.2 * vel, (x, k) => {
      let v = 0;
      for (const [fr, a, dp, da] of parts) v += a * sin1(fr * x) * (0.62 * Math.exp(-x / dp) + 0.38 * Math.exp(-x / da));
      const thump = k < 960 ? ham.lp(nz(k, salt)) * Math.exp(-x / 0.004) * 0.5 : 0;
      return (v + thump) * smoothIn(x, 0.003);
    }, [[c.send, 0.6], [c.echo, 0.3]]);
  },
  bell(c, t, m, vel, len = 2) {
    const f = mtof(m);
    c.dry.add(t, len + 4, -0.2, 0.08 * vel, (x) => {
      const I = 0.2 + 1.6 * Math.exp(-x / 0.5);
      return sin1(f * x + (I * sin1(3.5 * f * x)) / (2 * Math.PI)) * smoothIn(x, 0.005) * Math.exp(-x / 2.2);
    }, [[c.send, 0.8], [c.echo, 0.35]]);
  },
  tom(c, q, g) {
    c.dry.add(q * c.spb, 1.4, 0, g, (x) => {
      const ph = 52 * x + 25 * 0.06 * (1 - Math.exp(-x / 0.06));
      return sin1(ph) * smoothIn(x, 0.008) * Math.exp(-x / 0.5);
    }, [[c.send, 0.25]]);
  },
  sub(c, t0, len, m, g) {
    const f = mtof(m);
    c.dry.add(t0, len + 2, 0, g, (x) => sin1(f * x) * smoothIn(x, 0.3) * release(x, len, 0.4));
  },
  shimmer(c, t0, len, notes, g) {
    notes.forEach((m, j) => {
      const f = mtof(m);
      c.dry.add(t0, len + 3, j ? 0.5 : -0.5, g, (x) => sin1(f * x) * smoothIn(x, 1.5) * release(x, len, 0.8) * (0.6 + 0.4 * sin1((t0 + x) / (c.loopSec / 2) + j * 0.5)), [[c.send, 1]]);
    });
  },
  /** hava kabarmasi: bant geciren gurultu yavasca acilir, vurusta yumusak biter */
  swell(c, q, beats, g) {
    const d = beats * c.spb;
    const t = q * c.spb;
    const f = new SVF();
    const salt = seedOf(q, 33);
    let cnt = 0;
    c.dry.add(t, d + 0.6, (x) => -0.3 + (0.6 * x) / d, g, (x, k) => {
      const p = Math.min(1, x / d);
      if ((cnt++ & 15) === 0) f.set(500 + 1900 * p * p, 0.7);
      f.lp(nz(k, salt));
      const env = x < d ? p * p : Math.exp(-(x - d) / 0.15);
      return f.bp * env;
    }, [[c.send, 0.9]]);
  },
};

const SLOW = {
  info: {
    label: 'Yavaş', genre: 'sakin sinematik / ambient', bpmRange: [70, 76], key: 'D major', tonic: 2, mode: 'major',
    progression: 'Dadd9 – Bm7 – Gmaj9 – A7sus4 (I–vi–IV–V7sus4)', swing: 0.5, hats: false, pulse: 0.5, texture: ['pad', 'shimmer', 'swell', 'sub'],
    instruments: 'evrilen detune pad (16 vuruşluk filtre LFO), keçe piyano arpeji (ping-pong eko), FM çan ezgisi (L4), sinüs sub, ölçü başında yumuşak alçak tom (davul yok), hava kabarmaları, yüksek shimmer',
    reverb: 'uzun (room 0,91, 25 ms ön gecikme)',
  },
  fx: { room: 0.91, damp: 0.3, wet: 1.1, predelay: 0.025, delayBeats: 0.75, fb: 0.4, delayLp: 2800, echoMix: 0.5, tail: 6 },
  levels: {
    pulse: { pad: 0.75, cut: 0.55, beatNote: true, tom: true },
    L1: { pad: 1, cut: 0.8, shimmer: true },
    L2: { pad: 1, cut: 0.9, arp: 4, sub: true },
    L3: { pad: 0.9, cut: 1, arp: 8, sub: true, tom: true, shimmer: true, swell: true },
    L4: { pad: 0.9, cut: 1, arp: 8, sub: true, tom: true, shimmer: true, swell: true, bells: true },
  },
  chordAt: (q) => SLOW_PROG[Math.floor(q / 4 + 1e-9) % 4],
  section(c, from, to, L) {
    const e = c.energy;
    for (const [s, en, bar] of bars(from, to)) {
      const ch = SLOW_PROG[bar % 4];
      const t0 = s * c.spb;
      const len = (en - s) * c.spb;
      if (L.pad) slowI.pad(c, t0, len, ch.pad, 0.06 * L.pad, L.cut);
      if (L.sub) slowI.sub(c, t0, len, ch.sub, 0.085);
      if (L.shimmer) slowI.shimmer(c, t0, len, [ch.arp[1] + 12, ch.arp[3] + 12], 0.024);
    }
    for (const q of steps(from, to, 0.5)) {
      const pos = frac(q / 4) * 4;
      const ch = this.chordAt(q);
      const lp = loopPos(q);
      if (L.tom && pos === 0) slowI.tom(c, q, 0.18 * e);
      if (L.beatNote && frac(q) === 0) slowI.piano(c, q * c.spb, ch.arp[0], pos === 0 ? 0.55 : 0.35, 0.15);
      if (L.arp === 4 && frac(q) === 0) {
        const k = [0, 2, 3, 2][Math.floor(pos)];
        slowI.piano(c, q * c.spb, ch.arp[k], pos === 0 ? 0.7 : 0.5, (k - 2) * 0.25);
      }
      if (L.arp === 8) {
        const step = Math.round(pos * 2);
        const k = SLOW_ARP8[step];
        const swellBar = 0.75 + 0.25 * Math.sin((Math.PI * step) / 8);
        slowI.piano(c, q * c.spb, ch.arp[k], (frac(q) === 0 ? 0.7 : 0.45) * swellBar, (k - 2) * 0.28);
      }
      if (L.swell && (lp === 6 || lp === 14)) slowI.swell(c, q, 2, 0.2);
    }
    if (L.bells) {
      for (const [b, m, len] of SLOW_BELLS) {
        for (let base = Math.floor(from / LOOP_BEATS) * LOOP_BEATS; base < to; base += LOOP_BEATS) {
          const q = base + b;
          if (q >= from && q < to) slowI.bell(c, q * c.spb, m, 0.9, len * c.spb);
        }
      }
    }
  },
  outro(c, from, to) {
    const t0 = from * c.spb;
    const len = Math.max(1, (to - from) * c.spb - 3);
    slowI.pad(c, t0, len, [50, 57, 62, 64, 66], 0.06, 1, 0.5);
    slowI.sub(c, t0, len, 38, 0.09);
    [50, 57, 64, 66, 69].forEach((m, k) => slowI.piano(c, t0 + k * 0.13, m, 0.75 - k * 0.06, (k - 2) * 0.25));
    slowI.bell(c, t0 + c.spb, 81, 0.8, 3);
    slowI.bell(c, t0 + 2.5 * c.spb, 86, 0.6, 3);
    slowI.shimmer(c, t0, len, [78, 81], 0.024);
  },
  sfx: {
    pop(c, t, ev) {
      const f = mtof(88);
      c.dry.add(t, 1.5, 0.15, 0.06 * (ev.gain ?? 1), (x) => sin1(f * x + (1.2 * Math.exp(-x / 0.15) * sin1(2 * f * x)) / (2 * Math.PI)) * smoothIn(x, 0.006) * Math.exp(-x / 0.5), [[c.send, 0.7]]);
    },
    thock(c, t) {
      c.dry.add(t, 0.5, 0, 0.17, (x) => {
        const ph = 85 * x + 35 * 0.04 * (1 - Math.exp(-x / 0.04));
        return sin1(ph) * smoothIn(x, 0.005) * Math.exp(-x / 0.12);
      }, [[c.send, 0.35]]);
    },
    tick(c, t) {
      const f = mtof(93);
      c.dry.add(t, 0.8, 0.2, 0.04, (x) => sin1(f * x) * smoothIn(x, 0.004) * Math.exp(-x / 0.15), [[c.send, 0.6]]);
    },
    tickLow(c, t) {
      const f = mtof(86);
      c.dry.add(t, 0.9, -0.2, 0.045, (x) => sin1(f * x) * smoothIn(x, 0.004) * Math.exp(-x / 0.2), [[c.send, 0.6]]);
    },
    whoosh(c, t, ev) {
      const d = (ev.dur ?? 1.2) * c.spb;
      const start = t - d * 0.6;
      const f = new SVF();
      let cnt = 0;
      c.dry.add(start, d, (x) => -0.4 + (0.8 * x) / d, 0.22, (x, k) => {
        const p = x / d;
        if ((cnt++ & 15) === 0) f.set(500 + 1300 * Math.sin(Math.PI * p), 0.7);
        f.lp(nz(k, 71));
        return f.bp * sin1(p / 2) ** 2;
      }, [[c.send, 0.6]]);
    },
    riser(c, t, ev) {
      const d = (ev.dur ?? 1) * c.spb;
      const f = new SVF();
      let cnt = 0;
      c.dry.add(t - d, d, 0, 0.12, (x, k) => {
        const p = x / d;
        if ((cnt++ & 15) === 0) f.set(400 + 1600 * p * p, 0.7);
        f.lp(nz(k, 72));
        return (f.bp + 0.25 * sin1(mtof(74) * x)) * p * p;
      }, [[c.send, 0.8]]);
    },
    hit(c, t) {
      c.dry.add(t, 3, 0, 0.16, (x) => sin1(mtof(38) * x) * smoothIn(x, 0.03) * Math.exp(-x / 1.2));
      slowI.bell(c, t, 86, 0.5, 2);
      slowI.bell(c, t + 0.04, 93, 0.35, 2);
    },
  },
};

export const STYLES = { fast: FAST, normal: NORMAL, slow: SLOW };

/* ───────────── karisim ───────────── */

/**
 * Bir uslupte ham (normallestirilmemis) stereo karisim.
 * def: { bpm, beats, energy?, music: [[from, to, seviye]], events: [{ at, sfx, dur? }] }
 */
export function renderStyle(styleName, def) {
  const st = STYLES[styleName];
  if (!st) throw new Error(`Bilinmeyen uslup: ${styleName}`);
  const spb = 60 / def.bpm;
  const n = Math.ceil((def.beats * spb + st.fx.tail) * SR);
  const duck = new Float32Array(n).fill(1);
  const c = {
    spb,
    energy: def.energy ?? 1,
    loopSec: LOOP_BEATS * spb,
    dry: new Bus(n),
    pump: new Bus(n),
    send: new Bus(n),
    echo: new Bus(n),
    /** kick'e bagli pompa: pump bus'i bu zarfla carpilir */
    duckAt(t, depth, rel) {
      const i0 = Math.max(0, Math.round(t * SR));
      const i1 = Math.min(n, i0 + Math.round(rel * 6 * SR));
      for (let i = i0; i < i1; i++) {
        const x = (i - i0) / SR;
        const d = 1 - depth * (x < 0.004 ? x / 0.004 : Math.exp(-(x - 0.004) / rel));
        if (d < duck[i]) duck[i] = d;
      }
    },
  };
  for (const [from, to, level] of def.music) {
    if (level === 'silence') continue;
    if (level === 'outro') {
      st.outro(c, from, to);
      continue;
    }
    const L = st.levels[level];
    if (!L) throw new Error(`Bilinmeyen muzik seviyesi: ${level}`);
    st.section(c, from, to, L);
  }
  for (const ev of def.events ?? []) {
    if (!ev.sfx) continue;
    const fn = st.sfx[ev.sfx];
    if (!fn) throw new Error(`${styleName} usulunde efekt yok: ${ev.sfx}`);
    fn(c, ev.at * spb, ev);
  }

  const echo = pingPong(c.echo, st.fx.delayBeats * spb, st.fx.fb, st.fx.delayLp);
  for (let i = 0; i < n; i++) {
    c.send.L[i] += echo.L[i] * 0.35;
    c.send.R[i] += echo.R[i] * 0.35;
  }
  const wet = reverb(c.send, st.fx.room, st.fx.damp, st.fx.predelay);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  // ana cikis: tek kutuplu 18 Hz yuksek geciren (DC yok) + istege bagli yumusatma (lo-fi)
  const hpA = Math.exp((-2 * Math.PI * 18) / SR);
  const lpA = st.fx.masterLp ? 1 - Math.exp((-2 * Math.PI * st.fx.masterLp) / SR) : 1;
  let pl = 0;
  let pr = 0;
  let hl = 0;
  let hr = 0;
  let ll = 0;
  let lr = 0;
  for (let i = 0; i < n; i++) {
    const xl = c.dry.L[i] + c.pump.L[i] * duck[i] + echo.L[i] * st.fx.echoMix + wet.L[i] * st.fx.wet;
    const xr = c.dry.R[i] + c.pump.R[i] * duck[i] + echo.R[i] * st.fx.echoMix + wet.R[i] * st.fx.wet;
    hl = hpA * (hl + xl - pl);
    hr = hpA * (hr + xr - pr);
    pl = xl;
    pr = xr;
    ll += lpA * (hl - ll);
    lr += lpA * (hr - lr);
    L[i] = ll;
    R[i] = lr;
  }
  return { L, R, n, spb };
}
