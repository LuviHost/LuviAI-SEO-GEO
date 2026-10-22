#!/usr/bin/env node
/**
 * Sutun tanitim videolarinin (5 sutun + Canli Tarayici) muzigi — her video TEK parca, kendi BPM'inde ve sectigi uslupte
 * (styles.mjs: fast = enerjik elektronik pop, normal = chill-hop / lo-fi, slow = sinematik ambient).
 *
 *   node scripts/audio/synth-pillars.mjs            # hepsi → public/audio/pillars/<id>.wav
 *   node scripts/audio/synth-pillars.mjs geo        # yalniz biri
 *
 * Girdi: src/pillars/script.json → schedule.mjs planVideo(): sahne sinirlari (vurus), sahne basina muzik
 * seviyesi (pulse · L1 · L2 · L3 · L4; son sahne outro), efekt anlari (liste ogesi 'tick', panel girisi
 * 'whoosh', kanca 'pop' / 'thock', kapanis riser + hit). Goruntu ve ses ayni planin karelerine oturur.
 * Parca baştan sona tek seferde sentezlenir (kesintisiz; bolum gecisleri vurusta), video uzunlugunda
 * kesilir, son 0,6 sn solar; ffmpeg iki gecisli loudnorm -14 LUFS / -1.5 dBTP (render hatti mp4'te
 * yeniden olcer). Mevcut kompozisyonlarin izlerine (public/audio/*.wav, tempo/) DOKUNMAZ.
 */
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runFfSync } from '../ffmpeg.mjs';
import { SR, renderStyle } from './styles.mjs';
import { planVideo } from '../../src/pillars/schedule.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = JSON.parse(readFileSync(join(ROOT, 'src', 'pillars', 'script.json'), 'utf8'));
const OUT = join(ROOT, 'public', 'audio', 'pillars');

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

function loudnorm(src, dst) {
  const target = 'I=-14:TP=-1.5:LRA=11';
  const m = runFfSync('ffmpeg', ['-hide_banner', '-nostats', '-i', src, '-af', `loudnorm=${target}:print_format=json`, '-f', 'null', '-']);
  const j = JSON.parse(m.stderr.slice(m.stderr.lastIndexOf('{'), m.stderr.lastIndexOf('}') + 1));
  const af = `loudnorm=${target}:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true`;
  runFfSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-af', af, '-ar', String(SR), '-c:a', 'pcm_s16le', dst], { inherit: true });
  return j.input_i;
}

const only = process.argv[2];
mkdirSync(OUT, { recursive: true });
for (const v of SCRIPT.videos) {
  if (only && v.id !== only) continue;
  const t = Date.now();
  const plan = planVideo(SCRIPT, v.id);
  const beats = plan.durationInFrames / plan.fpb;
  const out = renderStyle(plan.style, { bpm: plan.bpm, beats, energy: plan.energy, music: plan.music, events: plan.events });
  const n = Math.round((plan.durationInFrames / 30) * SR);
  const fade = Math.round(0.6 * SR);
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out.L[i]), Math.abs(out.R[i]));
  const g = 0.85 / (peak || 1);
  const pcm = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    const f = i > n - fade ? (n - i) / fade : 1;
    pcm.writeInt16LE(Math.round(Math.tanh(out.L[i] * g) * f * 32767), i * 4);
    pcm.writeInt16LE(Math.round(Math.tanh(out.R[i] * g) * f * 32767), i * 4 + 2);
  }
  const raw = join(OUT, `.raw-${v.id}.wav`);
  const dst = join(OUT, `${v.id}.wav`);
  writeFileSync(raw, wav(pcm));
  const before = loudnorm(raw, `${dst}.tmp.wav`);
  renameSync(`${dst}.tmp.wav`, dst);
  unlinkSync(raw);
  console.log(`${v.id}: ${plan.style} ${plan.bpm} BPM · ${(n / SR).toFixed(2)} sn · ham ${before} LUFS → -14 LUFS · ${((Date.now() - t) / 1000).toFixed(1)} sn`);
}
