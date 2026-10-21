#!/usr/bin/env node
/**
 * RanksUp Video muzik denetimi — kulak olmadan olculebilenler (synth.mjs --tempo ciktisi uzerinde).
 *
 *   node scripts/audio/check-music.mjs                        # kokler + uslup analizi
 *   node scripts/audio/check-music.mjs --videos <klasor>      # + render edilmis mp4'lerin loudness'i
 *   node scripts/audio/check-music.mjs --md5 <dosya>          # + pazarlama wav'lari degismedi mi
 *
 * Denetimler (biri bozulursa cikis kodu 1):
 *   1) Her dosya: kirpilma yok (|ornek| < 32767), DC kaymasi < -60 dBFS, stereo korelasyon > 0
 *      (mono uyumlu) ve yan/orta orani makul, sure plana uygun (hizli = eski izgara 15 / 24 sn,
 *      dongu = 16 vurus).
 *   2) Dongu dikisi (normal / yavas giris + govde): son -> ilk ornek sicramasi dosyanin kendi
 *      ornekten-ornege farklarinin %99,9'unu asmaz; dikisteki yuksek frekans enerjisi (2. fark)
 *      dongunun diger olcu baslarindan belirgin buyuk degil; dikis cevresindeki RMS degisimi
 *      diger olcu sinirlarindakiyle uyumlu.
 *   3) Uslup analizi (her tempo, govde dongusu): BPM (dongu boyundan ve onset otokorelasyonundan),
 *      ton (kromagram + Krumhansl profili), swing (yuksek bant onset'lerinin sekizlik icindeki
 *      konumu), onset'lerin izgaraya oturmasi (hizli / yavas duz 16'lik, normal %60 swing'li 16'lik),
 *      spektral denge (alcak < 250 Hz · orta · yuksek > 4 kHz) ve agirlik merkezi, onset yogunlugu.
 *      Uc uslup BPM, ton ve akor yurusu bakimindan birbirinden FARKLI olmali.
 *   4) --videos: her mp4 icin entegre loudness -14 ± 0,5 LUFS ve gercek tepe <= -1,0 dBTP (ebur128).
 *   5) --md5: public/audio/<kompozisyon>.wav (pazarlama / tanitim / KobiPratik izleri) baz md5 ile ayni.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runFfSync } from '../ffmpeg.mjs';
import { createPlanner } from '../../src/tempo/plan.mjs';
import { LOOP_BEATS, STYLES, renderStyle } from './styles.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TIMELINE = JSON.parse(readFileSync(join(ROOT, 'src', 'marketing', 'timeline.json'), 'utf8'));
const T = TIMELINE.tempo;
const DIR = join(ROOT, 'public', 'audio', 'tempo');
const SR = 48000;
const args = process.argv.slice(2);
const argOf = (k) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : null;
};
const failures = [];
const fail = (m) => failures.push(m);
const db = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
const f1 = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : String(x));

/* ───────────── okuma ───────────── */

function readWav(file) {
  const b = readFileSync(file);
  let p = 12;
  let fmt = null;
  while (p + 8 <= b.length) {
    const id = b.toString('ascii', p, p + 4);
    const size = b.readUInt32LE(p + 4);
    if (id === 'fmt ') fmt = { ch: b.readUInt16LE(p + 10), sr: b.readUInt32LE(p + 12), bits: b.readUInt16LE(p + 22) };
    if (id === 'data') {
      if (!fmt || fmt.ch !== 2 || fmt.bits !== 16 || fmt.sr !== SR) throw new Error(`${file}: 48 kHz stereo 16 bit bekleniyordu`);
      const n = size / 4;
      const L = new Float32Array(n);
      const R = new Float32Array(n);
      let clipped = 0;
      for (let i = 0; i < n; i++) {
        const l = b.readInt16LE(p + 8 + i * 4);
        const r = b.readInt16LE(p + 10 + i * 4);
        if (l >= 32767 || l <= -32768) clipped++;
        if (r >= 32767 || r <= -32768) clipped++;
        L[i] = l / 32768;
        R[i] = r / 32768;
      }
      return { L, R, n, clipped };
    }
    p += 8 + size + (size % 2);
  }
  throw new Error(`${file}: data bolumu yok`);
}

/* ───────────── temel olcumler ───────────── */

function basics(a) {
  let peak = 0;
  let sl = 0;
  let sr = 0;
  let ll = 0;
  let rr = 0;
  let lr = 0;
  let mm = 0;
  let ss = 0;
  for (let i = 0; i < a.n; i++) {
    const l = a.L[i];
    const r = a.R[i];
    peak = Math.max(peak, Math.abs(l), Math.abs(r));
    sl += l;
    sr += r;
    ll += l * l;
    rr += r * r;
    lr += l * r;
    mm += ((l + r) / 2) ** 2;
    ss += ((l - r) / 2) ** 2;
  }
  return {
    peakDb: db(peak),
    rmsDb: db(Math.sqrt((ll + rr) / (2 * a.n))),
    dcDb: db(Math.max(Math.abs(sl), Math.abs(sr)) / a.n),
    corr: lr / Math.sqrt(ll * rr || 1),
    sideMidDb: 10 * Math.log10((ss || 1e-20) / (mm || 1e-20)),
  };
}

/* ───────────── FFT ───────────── */

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}
const hann = (N) => Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));

/** ortalama guc spektrumu (dairesel: dongu kendine eklenir) */
function spectrum(mono, N = 4096) {
  const w = hann(N);
  const P = new Float64Array(N / 2);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  let frames = 0;
  for (let s = 0; s + N <= mono.length; s += N / 2) {
    for (let i = 0; i < N; i++) {
      re[i] = mono[s + i] * w[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k < N / 2; k++) P[k] += re[k] * re[k] + im[k] * im[k];
    frames++;
  }
  for (let k = 0; k < N / 2; k++) P[k] /= frames || 1;
  return { P, hz: SR / N };
}

function bands(mono) {
  const { P, hz } = spectrum(mono);
  let lo = 0;
  let mid = 0;
  let hi = 0;
  let fw = 0;
  for (let k = 1; k < P.length; k++) {
    const f = k * hz;
    if (f < 20) continue;
    if (f < 250) lo += P[k];
    else if (f < 4000) mid += P[k];
    else hi += P[k];
    fw += f * P[k];
  }
  const tot = lo + mid + hi;
  return { lo: (100 * lo) / tot, mid: (100 * mid) / tot, hi: (100 * hi) / tot, centroid: fw / tot };
}

/* ───────────── ton (kromagram + Krumhansl-Kessler) ───────────── */

const KK_MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MIN = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const PC = ['C', 'C#', 'D', 'E♭', 'E', 'F', 'F#', 'G', 'A♭', 'A', 'B♭', 'B'];
function corr(a, b) {
  const ma = a.reduce((x, y) => x + y) / a.length;
  const mb = b.reduce((x, y) => x + y) / b.length;
  let s = 0;
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < a.length; i++) {
    s += (a[i] - ma) * (b[i] - mb);
    sa += (a[i] - ma) ** 2;
    sb += (b[i] - mb) ** 2;
  }
  return s / Math.sqrt(sa * sb);
}
const MAJOR_SET = [0, 2, 4, 5, 7, 9, 11];
function keyOf(mono) {
  const { P, hz } = spectrum(mono, 16384);
  const chroma = new Array(12).fill(0);
  for (let k = 1; k < P.length; k++) {
    const f = k * hz;
    if (f < 100 || f > 2500) continue;
    const m = 69 + 12 * Math.log2(f / 440);
    const pc = ((Math.round(m) % 12) + 12) % 12;
    if (Math.abs(m - Math.round(m)) < 0.35) chroma[pc] += Math.sqrt(P[k]);
  }
  const tot = chroma.reduce((x, y) => x + y);
  // diyatonik kume uyumu: hangi majör dizinin 7 sesi enerjinin en cogunu tasiyor (relatif minör ayni kume)
  const sets = [];
  for (let t = 0; t < 12; t++) sets.push({ tonic: t, fit: MAJOR_SET.reduce((a, d) => a + chroma[(t + d) % 12], 0) / tot });
  sets.sort((a, b) => b.fit - a.fit);
  // Krumhansl-Kessler: kume icinde majör mü relatif minör mü (bilgi amacli)
  const all = [];
  for (let t = 0; t < 12; t++) {
    const rot = chroma.map((_, i) => chroma[(i + t) % 12]);
    all.push({ name: `${PC[t]} major`, tonic: t, mode: 'major', r: corr(rot, KK_MAJ) });
    all.push({ name: `${PC[t]} minor`, tonic: t, mode: 'minor', r: corr(rot, KK_MIN) });
  }
  all.sort((a, b) => b.r - a.r);
  return { set: sets[0], setName: `${PC[sets[0].tonic]} majör dizisi (≡ ${PC[(sets[0].tonic + 9) % 12]} minör)`, kk: all[0], chroma };
}

/* ───────────── onset'ler ───────────── */

/**
 * Spektral aki onset'leri: FFT 1024 / hop 128 (2,7 ms), dB genlik (en yuksek degerin 60 dB altina
 * kirpilir: sessize yakin kutularin titresimi onset sayilmaz), yalniz artislar, [fLo, fHi] bandi.
 * Tepe secimi: +-8 ms yerel en buyuk, +-100 ms yerel ortalamanin 1,5 kati ve kuvvetli tepelerin
 * (%99) rel katinin uzerinde, aralarinda en az minGapSec. Onset zamani = cerceve merkezi.
 */
const ON_N = 1024;
const ON_H = 128;
/** RBJ yuksek geciren biquad (Q 0,707) dort kez: 48 dB/oktav. Alt bas sinuslerinin (kick govdesi,
 * yumusak tom, sub) pencere sizintisi fazla birlikte dalgalanir ve sahte aki uretir; once suzulur. */
function highpass(x, fc) {
  const w0 = (2 * Math.PI * fc) / SR;
  const al = Math.sin(w0) / (2 * Math.SQRT1_2);
  const cw = Math.cos(w0);
  const a0 = 1 + al;
  const b0 = (1 + cw) / 2 / a0;
  const b1 = -(1 + cw) / a0;
  const a1 = (-2 * cw) / a0;
  const a2 = (1 - al) / a0;
  let y = Float32Array.from(x);
  for (let pass = 0; pass < 4; pass++) {
    const o = new Float32Array(y.length);
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < y.length; i++) {
      const v = b0 * y[i] + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = y[i];
      y2 = y1;
      y1 = v;
      o[i] = v;
    }
    y = o;
  }
  return y;
}
function onsets(input, { fLo = 200, fHi = 16000, minGapSec = 0.05, rel = 0.12 } = {}) {
  const mono = highpass(input, fLo);
  const w = hann(ON_N);
  const k0 = Math.max(1, Math.floor((fLo * ON_N) / SR));
  const k1 = Math.min(ON_N / 2, Math.ceil((fHi * ON_N) / SR));
  const K = k1 - k0;
  const frames = Math.floor((mono.length - ON_N) / ON_H) + 1;
  const mags = new Float32Array(frames * K);
  const re = new Float64Array(ON_N);
  const im = new Float64Array(ON_N);
  let top = -Infinity;
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < ON_N; i++) {
      re[i] = mono[f * ON_H + i] * w[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let k = k0; k < k1; k++) {
      const v = Math.sqrt(Math.hypot(re[k], im[k]));
      mags[f * K + k - k0] = v;
      if (v > top) top = v;
    }
  }
  const floor = top * 0.01;
  const osf = new Float64Array(frames);
  for (let f = 1; f < frames; f++) {
    let sum = 0;
    for (let k = 0; k < K; k++) {
      const d = Math.max(mags[f * K + k], floor) - Math.max(mags[(f - 1) * K + k], floor);
      if (d > 0) sum += d;
    }
    osf[f] = sum / K;
  }
  const sorted = Float64Array.from(osf).sort();
  const strong = sorted[Math.floor(sorted.length * 0.99)];
  const W = Math.round((0.1 * SR) / ON_H);
  const gap = Math.round((minGapSec * SR) / ON_H);
  const picks = [];
  for (let i = 3; i < frames - 3; i++) {
    let isMax = true;
    for (let j = i - 3; j <= i + 3; j++) if (osf[j] > osf[i]) isMax = false;
    if (!isMax) continue;
    let local = 0;
    let cnt = 0;
    for (let j = Math.max(0, i - W); j < Math.min(frames, i + W); j++) {
      local += osf[j];
      cnt++;
    }
    if (osf[i] < Math.max((1.5 * local) / cnt, rel * strong)) continue;
    if (picks.length && i - picks.at(-1).i < gap) {
      if (osf[i] > picks.at(-1).v) picks[picks.length - 1] = { i, v: osf[i] };
      continue;
    }
    picks.push({ i, v: osf[i] });
  }
  return { times: picks.map((p) => (p.i * ON_H + ON_N / 2) / SR), strength: picks.map((p) => p.v), osf };
}

/** dairesel otokorelasyonla BPM (60-180) */
function acfBpm(osf, hop) {
  const n = osf.length;
  let best = { bpm: 0, r: -Infinity };
  for (let bpm = 60; bpm <= 180; bpm += 0.25) {
    const lag = (60 / bpm) * (SR / hop);
    const l0 = Math.floor(lag);
    const fr = lag - l0;
    let s = 0;
    for (let i = 0; i < n; i++) s += osf[i] * (osf[(i + l0) % n] * (1 - fr) + osf[(i + l0 + 1) % n] * fr);
    if (s > best.r) best = { bpm, r: s };
  }
  return best.bpm;
}

/** izgara konumlari (vurus): 16'lik, normal'de swing'li */
function gridOf(swing) {
  const g = [];
  for (let e = 0; e < LOOP_BEATS + 0.5; e += 0.5) g.push(e, e + 0.5 * swing);
  return g;
}

/* ───────────── dongu dikisi ───────────── */

function seam(a, bpm) {
  const n = a.n;
  const spb = 60 / bpm;
  const out = {};
  for (const ch of ['L', 'R']) {
    const x = a[ch];
    const diffs = new Float64Array(n - 1);
    for (let i = 0; i < n - 1; i++) diffs[i] = Math.abs(x[i + 1] - x[i]);
    const sorted = Float64Array.from(diffs).sort();
    const p999 = sorted[Math.floor(sorted.length * 0.999)];
    const jump = Math.abs(x[0] - x[n - 1]);
    // ikinci fark enerjisi (tik/klik gostergesi) +-1 ms
    const hf = (c) => {
      let e = 0;
      for (let k = -48; k <= 48; k++) {
        const i = (c + k + n) % n;
        const v = x[(i + 1) % n] - 2 * x[i] + x[(i - 1 + n) % n];
        e += v * v;
      }
      return e;
    };
    const rms = (s, len) => {
      let e = 0;
      for (let k = 0; k < len; k++) e += x[(s + k + n) % n] ** 2;
      return Math.sqrt(e / len);
    };
    const W = Math.round(0.05 * SR);
    const bars = [1, 2, 3].map((b) => Math.round(b * 4 * spb * SR));
    const seamHf = hf(0);
    const barHf = bars.map(hf);
    const rmsStep = (c) => db(rms(c, W) / (rms(c - W, W) || 1e-9));
    const seamStep = rmsStep(0);
    const barSteps = bars.map(rmsStep);
    out[ch] = {
      jumpLsb: Math.round(jump * 32768),
      jumpRatio: jump / (p999 || 1e-9),
      hfRatio: seamHf / (Math.max(...barHf) || 1e-12),
      rmsStepDb: seamStep,
      barStepDb: barSteps,
    };
  }
  return out;
}

/* ───────────── analiz ───────────── */

const mono = (a) => {
  const m = new Float32Array(a.n);
  for (let i = 0; i < a.n; i++) m[i] = (a.L[i] + a.R[i]) / 2;
  return m;
};
const tile = (m, k = 2) => {
  const o = new Float32Array(m.length * k);
  for (let j = 0; j < k; j++) o.set(m, j * m.length);
  return o;
};

/**
 * a: dongu (tam karisim). rhythm: ayni dongunun ritim katmani (surekli dokular — pad, plak hisirtisi,
 * shimmer, kabarma, sub — cikarilmis; info.texture). Izgara / BPM / swing ritim katmaninda olculur:
 * ambient pad'lerin filtre hareketi ve detune vuruslari spektral akida "onset" uretir, bunlar
 * vurus degildir. Tam karisimin izgara orani bilgi olarak raporlanir.
 */
function analyzeLoop(a, rhythm, bpm, info) {
  const loopSec = a.n / SR;
  const spb = 60 / bpm;
  const grid = gridOf(info.swing);
  const K = Math.round(LOOP_BEATS / info.pulse);
  const near = (q) => {
    let best = Infinity;
    for (const g of grid) best = Math.min(best, Math.abs(q - g) * spb);
    return best;
  };
  const gridStats = (buf) => {
    const t3 = tile(mono(buf), 3);
    const all = onsets(t3);
    const ons = [];
    all.times.forEach((t, i) => {
      if (t >= loopSec && t < 2 * loopSec) ons.push({ off: near((t - loopSec) / spb), v: all.strength[i] });
    });
    const offs = ons.map((o) => o.off).sort((x, y) => x - y);
    const top = ons.slice().sort((x, y) => y.v - x.v).slice(0, K);
    // izgara kontrasti: aki fonksiyonunun izgara noktalarinda (+-12 ms) ortalamasi / diger anlar
    const f0 = Math.round((loopSec * SR) / ON_H);
    let on = 0;
    let nOn = 0;
    let off = 0;
    let nOff = 0;
    for (let f = f0; f < 2 * f0; f++) {
      if (near(((f * ON_H + ON_N / 2) / SR - loopSec) / spb) <= 0.012) {
        on += all.osf[f];
        nOn++;
      } else {
        off += all.osf[f];
        nOff++;
      }
    }
    return {
      t3,
      n: ons.length,
      density: ons.length / loopSec,
      pct: ons.length ? (100 * offs.filter((o) => o <= 0.015).length) / ons.length : 0,
      topPct: top.length ? (100 * top.filter((o) => o.off <= 0.015).length) / top.length : 0,
      contrast: on / nOn / (off / nOff || 1e-12),
      medMs: ons.length ? 1000 * offs[Math.floor(offs.length / 2)] : 0,
      bpmAcf: acfBpm(all.osf.slice(f0, 2 * f0), ON_H),
    };
  };
  const full = gridStats(a);
  const rh = gridStats(rhythm);
  // swing: yuksek bant (hi-hat) onset'lerinin sekizlik icindeki konumu (hi-hat'siz uslupte yok)
  const hiOns = onsets(rh.t3, { fLo: 5000, minGapSec: 0.03 }).times.filter((t) => t >= loopSec && t < 2 * loopSec).map((t) => (t - loopSec) / spb);
  const rs = hiOns.map((q) => (q / 0.5) % 1).filter((r) => r > 0.3 && r < 0.85).sort((x, y) => x - y);
  const swing = info.hats && rs.length >= 8 ? rs[Math.floor(rs.length / 2)] : null;
  const m = mono(a);
  return {
    bpmLoop: (LOOP_BEATS * 60) / loopSec,
    bpmAcf: rh.bpmAcf,
    key: keyOf(m),
    full,
    rh,
    swing,
    bands: bands(tile(m, 2)),
    basics: basics(a),
  };
}

/** bellekte 16 vurusluk dongu (synth.mjs ile ayni pencere): level bir seviye adi ya da nesnesi */
function memoryLoop(style, bpm, level, energy) {
  let name = level;
  if (typeof level === 'object') {
    STYLES[style].levels.__denetim = level;
    name = '__denetim';
  }
  const out = renderStyle(style, { bpm, beats: 3 * LOOP_BEATS, energy, music: [[0, 3 * LOOP_BEATS, name]], events: [] });
  delete STYLES[style].levels.__denetim;
  const spb = 60 / bpm;
  const i0 = Math.round(LOOP_BEATS * spb * SR);
  const n = Math.round(LOOP_BEATS * spb * SR);
  let peak = 0;
  for (let i = i0; i < i0 + n; i++) peak = Math.max(peak, Math.abs(out.L[i]), Math.abs(out.R[i]));
  const g = 0.8 / peak;
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    L[i] = Math.tanh(out.L[i0 + i] * g);
    R[i] = Math.tanh(out.R[i0 + i] * g);
  }
  return { L, R, n, clipped: 0 };
}
const rhythmLevel = (style, level) => {
  const lv = { ...STYLES[style].levels[level] };
  for (const k of STYLES[style].info.texture) delete lv[k];
  return lv;
};

/* ───────────── calistir ───────────── */

const P = createPlanner(TIMELINE);
const jobs = P.stemJobs();
const bpmOf = (tempo) => (tempo === 'fast' ? TIMELINE.bpm : T.presets[tempo].bpm);

console.log('\n1) Dosyalar (public/audio/tempo)');
const fileRows = [];
for (const j of jobs) {
  const file = join(DIR, j.file);
  if (!existsSync(file)) {
    fail(`${j.file}: yok (node scripts/audio/synth.mjs --tempo)`);
    continue;
  }
  const a = readWav(file);
  const b = basics(a);
  const spb = 60 / j.bpm;
  const expSec = j.kind === 'full' ? (TIMELINE.compositions[j.template].beats * 60) / j.bpm
    : j.kind === 'outro' ? (1 + T.outroBeats) * spb
      : j.kind === 'sfx' ? T.sfxBeats * spb
        : T.loopBeats * spb;
  const sec = a.n / SR;
  if (Math.abs(sec - expSec) > 1 / SR) fail(`${j.file}: sure ${sec} sn, beklenen ${expSec} sn`);
  if (a.clipped) fail(`${j.file}: ${a.clipped} kirpilmis ornek`);
  if (b.dcDb > -60) fail(`${j.file}: DC kaymasi ${f1(b.dcDb)} dBFS`);
  if (j.kind !== 'sfx' && (b.corr < 0.2 || b.sideMidDb > -1)) fail(`${j.file}: stereo genislik makul degil (korelasyon ${f1(b.corr, 2)}, yan/orta ${f1(b.sideMidDb)} dB)`);
  const row = { dosya: j.file, sn: f1(sec, 2), 'tepe dBFS': f1(b.peakDb), 'RMS dBFS': f1(b.rmsDb), 'DC dBFS': f1(b.dcDb, 0), kirpilma: a.clipped, 'L/R kor.': f1(b.corr, 2), 'yan/orta dB': f1(b.sideMidDb) };
  if (j.kind === 'intro' || j.kind === 'body') {
    const s = seam(a, j.bpm);
    const worst = (k) => Math.max(s.L[k], s.R[k]);
    const stepDev = Math.max(...['L', 'R'].map((ch) => Math.abs(s[ch].rmsStepDb - s[ch].barStepDb.reduce((x, y) => x + y) / 3)));
    const barSpread = Math.max(...['L', 'R'].map((ch) => Math.max(...s[ch].barStepDb.map(Math.abs))));
    row['dikis sicrama/p99.9'] = f1(worst('jumpRatio'), 2);
    row['dikis HF/olcu basi'] = f1(worst('hfRatio'), 2);
    row['dikis RMS adimi dB'] = f1(Math.max(Math.abs(s.L.rmsStepDb), Math.abs(s.R.rmsStepDb)), 1);
    if (worst('jumpRatio') > 1) fail(`${j.file}: dongu dikisinde ornek sicramasi (p99.9'un ${f1(worst('jumpRatio'), 2)} kati)`);
    if (worst('hfRatio') > 1.5) fail(`${j.file}: dongu dikisinde yuksek frekans patlamasi (olcu baslarinin ${f1(worst('hfRatio'), 2)} kati)`);
    if (stepDev > Math.max(3, barSpread)) fail(`${j.file}: dikiste RMS sicramasi ${f1(stepDev)} dB (olcu sinirlari en fazla ${f1(barSpread)} dB)`);
  }
  fileRows.push(row);
}
console.table(fileRows);

console.log('\n2) Uslup analizi (govde dongusu: makale = L3, urun = L4; normal / yavas dosyadan, hizli bellekte ayni sentezden)');
const styleRows = [];
const results = {};
for (const tempo of ['fast', 'normal', 'slow']) {
  const info = STYLES[tempo].info;
  const bpm = bpmOf(tempo);
  for (const template of ['ArticleShort', 'ProductShort']) {
    const cfg = T.templates[template];
    const a = tempo === 'fast' ? memoryLoop('fast', bpm, cfg.body, cfg.energy) : readWav(join(DIR, `${cfg.audio}-${tempo}-body.wav`));
    const r = analyzeLoop(a, memoryLoop(tempo, bpm, rhythmLevel(tempo, cfg.body), cfg.energy), bpm, info);
    results[`${tempo}/${template}`] = r;
    const okBpm = [0.5, 1, 2].some((m) => Math.abs(r.bpmAcf / (bpm * m) - 1) < 0.02);
    const okKey = r.key.set.tonic === info.tonic;
    if (bpm < info.bpmRange[0] || bpm > info.bpmRange[1]) fail(`${tempo}: ${bpm} BPM uslup araliginda degil (${info.bpmRange.join('-')})`);
    if (Math.abs(r.bpmLoop - bpm) > 0.01) fail(`${tempo}/${template}: dongu boyu ${f1(r.bpmLoop, 2)} BPM, beklenen ${bpm}`);
    if (!okBpm) fail(`${tempo}/${template}: onset otokorelasyonu ${r.bpmAcf} BPM (beklenen ${bpm} ya da oktavi)`);
    if (!okKey) fail(`${tempo}/${template}: ses kumesi ${r.key.setName}, beklenen ${info.key}`);
    if (r.rh.topPct < 70) fail(`${tempo}/${template}: ritim katmaninin en guclu ${Math.round(LOOP_BEATS / info.pulse)} onset'inin yalniz %${f1(r.rh.topPct)}'i izgarada (+-15 ms)`);
    if (r.rh.contrast < 1.5) fail(`${tempo}/${template}: ritim katmaninda izgara kontrasti ${f1(r.rh.contrast, 2)} (< 1,5)`);
    if (tempo === 'normal' && (r.swing === null || r.swing < 0.56 || r.swing > 0.64)) fail(`normal/${template}: swing ${r.swing} (beklenen 0,58-0,62)`);
    if (tempo === 'fast' && r.swing !== null && Math.abs(r.swing - 0.5) > 0.03) fail(`fast/${template}: duz olmali, swing ${r.swing}`);
    styleRows.push({
      uslup: `${info.label} (${tempo})`,
      sablon: template,
      BPM: bpm,
      'BPM dongu': f1(r.bpmLoop, 2),
      'BPM onset-ACF': r.bpmAcf,
      'ton (tasarim)': info.key,
      'ses kumesi (olculen)': `${r.key.setName} %${f1(r.key.set.fit * 100, 0)}`,
      'KK en iyi': `${r.key.kk.name} ${f1(r.key.kk.r, 2)}`,
      swing: r.swing === null ? '— (hi-hat yok)' : `%${f1(r.swing * 100, 0)}`,
      'ritim onset/sn': f1(r.rh.density, 1),
      'ritim izgarada % (tumu / en guclu K)': `${f1(r.rh.pct, 0)} / ${f1(r.rh.topPct, 0)}`,
      'ritim kontrast': f1(r.rh.contrast, 2),
      'medyan sapma ms': f1(r.rh.medMs, 1),
      'tam karisim izgarada % / kontrast': `${f1(r.full.pct, 0)} / ${f1(r.full.contrast, 2)}`,
      'alcak %': f1(r.bands.lo, 0),
      'orta %': f1(r.bands.mid, 0),
      'yuksek %': f1(r.bands.hi, 1),
      'merkez Hz': Math.round(r.bands.centroid),
      'L/R kor.': f1(r.basics.corr, 2),
    });
  }
}
console.table(styleRows);

console.log('\n3) Uslupler birbirinden farkli mi');
const distinct = [];
const keys = ['fast', 'normal', 'slow'];
for (let i = 0; i < 3; i++) {
  for (let j = i + 1; j < 3; j++) {
    const A = STYLES[keys[i]].info;
    const B = STYLES[keys[j]].info;
    const ra = results[`${keys[i]}/ArticleShort`];
    const rb = results[`${keys[j]}/ArticleShort`];
    const same = [];
    if (bpmOf(keys[i]) === bpmOf(keys[j])) same.push('BPM');
    if (A.key === B.key) same.push('ton');
    if (A.progression === B.progression) same.push('akor yurusu');
    if (A.instruments === B.instruments) same.push('enstrumanlar');
    if (same.length) fail(`${keys[i]} ile ${keys[j]} ayni: ${same.join(', ')}`);
    distinct.push({ cift: `${A.label} ↔ ${B.label}`, BPM: `${bpmOf(keys[i])} ↔ ${bpmOf(keys[j])}`, ton: `${A.key} ↔ ${B.key}`, 'ritim onset/sn': `${f1(ra.rh.density)} ↔ ${f1(rb.rh.density)}`, 'merkez Hz': `${Math.round(ra.bands.centroid)} ↔ ${Math.round(rb.bands.centroid)}`, ayni: same.join(', ') || '—' });
  }
}
console.table(distinct);
for (const t of keys) {
  const i = STYLES[t].info;
  console.log(`  ${i.label}: ${i.genre} · ${bpmOf(t)} BPM · ${i.key} · ${i.progression} · swing %${Math.round(i.swing * 100)} · yanki ${i.reverb}\n    ${i.instruments}`);
}

console.log('\n4) Efekt / muzik dengesi (efekt tepe - govde RMS, dB)');
const fxRows = [];
for (const tempo of ['normal', 'slow']) {
  const body = readWav(join(DIR, `article-short-${tempo}-body.wav`));
  const bodyRms = basics(body).rmsDb;
  const row = { tempo, 'govde RMS dBFS': f1(bodyRms) };
  for (const j of jobs.filter((x) => x.kind === 'sfx' && x.tempo === tempo)) row[j.name] = f1(basics(readWav(join(DIR, j.file))).peakDb - bodyRms);
  fxRows.push(row);
}
console.table(fxRows);

const videoDir = argOf('--videos');
if (videoDir) {
  console.log(`\n5) Render edilmis videolar (${videoDir})`);
  const rows = [];
  for (const f of readdirSync(videoDir).filter((x) => x.endsWith('.mp4')).sort()) {
    const r = runFfSync('ffmpeg', ['-hide_banner', '-nostats', '-i', join(videoDir, f), '-af', 'ebur128=peak=true', '-f', 'null', '-']);
    const s = r.stderr.slice(r.stderr.lastIndexOf('Summary:'));
    const I = Number(/I:\s+(-?[\d.]+) LUFS/.exec(s)?.[1]);
    const lra = Number(/LRA:\s+(-?[\d.]+) LU/.exec(s)?.[1]);
    const tp = Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(s)?.[1]);
    if (!(Math.abs(I + 14) <= 0.5)) fail(`${f}: ${I} LUFS (beklenen -14 +-0,5)`);
    if (!(tp <= -1.0)) fail(`${f}: gercek tepe ${tp} dBTP (> -1,0)`);
    rows.push({ video: f, 'LUFS (I)': I, 'LRA LU': lra, 'gercek tepe dBTP': tp });
  }
  console.table(rows);
}

const md5File = argOf('--md5');
if (md5File) {
  console.log('\n6) Pazarlama / tanitim / KobiPratik izleri (public/audio/*.wav) degismedi mi');
  const base = Object.fromEntries(readFileSync(md5File, 'utf8').trim().split('\n').map((l) => {
    const [h, p] = l.trim().split(/\s+/);
    return [p.split('/').pop(), h];
  }));
  const rows = [];
  for (const def of Object.values(TIMELINE.compositions)) {
    const p = join(ROOT, 'public', 'audio', def.audio);
    const now = existsSync(p) ? createHash('md5').update(readFileSync(p)).digest('hex') : '(yok)';
    if (now !== base[def.audio]) fail(`${def.audio}: md5 degisti (${base[def.audio]} -> ${now})`);
    rows.push({ dosya: def.audio, once: base[def.audio], sonra: now, ayni: now === base[def.audio] ? 'evet' : 'HAYIR' });
  }
  console.table(rows);
}

if (failures.length) {
  console.log(`\nBASARISIZ (${failures.length}):\n - ${failures.join('\n - ')}`);
  process.exit(1);
}
console.log('\nTum muzik denetimleri gecti.');
