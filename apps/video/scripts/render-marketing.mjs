#!/usr/bin/env node
/**
 * Pazarlama videolarini render eder → apps/video/out/marketing/ (git'e girmez; out/ yok sayilir).
 * RanksUp Video duyurusu (VideoLaunch, VideoLaunchVertical) → apps/video/out/launch/.
 * KobiPratik reklamlari (KobiPratikReels, KobiPratikIntro, KobiPratikIntroVertical) → apps/video/out/kobipratik/.
 *
 *   pnpm --filter @luviai/video render:marketing                    # hepsi, sesli
 *   pnpm --filter @luviai/video render:marketing SocialAd           # yalniz biri
 *   pnpm --filter @luviai/video render:marketing -- --muted         # ek olarak sessiz varyant (*-muted.mp4)
 *   pnpm --filter @luviai/video render:marketing -- --skip-audio    # muzigi yeniden sentezleme
 *
 * Adimlar: 1) scripts/audio/synth.mjs (timeline.json → public/audio/*.wav, -14 LUFS)
 *          2) Remotion → H.264 MP4 (yuv420p, AAC 192k)  3) ffmpeg iki gecisli loudnorm (-14 LUFS,
 *          -1.5 dBTP; goruntu kopyalanir)  4) poster JPG  5) temas sayfasi (saniyede 1 kare)
 *          6) kontrol: sure, loudness, siyah kare taramasi.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_ROOT = join(ROOT, 'out');
const ENTRY = 'src/index.ts';

const JOBS = [
  { id: 'ProductIntro', name: 'product-intro', posterFrame: 100, sheet: { width: 480, cols: 6 } },
  { id: 'SocialAd', name: 'social-ad-vertical', posterFrame: 58, sheet: { width: 270, cols: 8 } },
  { id: 'FeatureExplainer', name: 'feature-explainer', posterFrame: 1500, sheet: { width: 400, cols: 8 } },
  // RanksUp Video duyurusu (src/launch/) — ornek videolar kobipratik.com sablon ciktisi
  { id: 'VideoLaunch', name: 'ranksup-video-duyuru-yatay', dir: 'launch', posterFrame: 76, sheet: { width: 400, cols: 8 } },
  { id: 'VideoLaunchVertical', name: 'ranksup-video-duyuru-dikey', dir: 'launch', posterFrame: 60, sheet: { width: 270, cols: 8 } },
  // KobiPratik'in kendi reklamlari (src/kobipratik/) — KobiPratik markasi; teklif kartlari "Örnek" + yer tutucu
  { id: 'KobiPratikReels', name: 'kobipratik-reels-dikey', dir: 'kobipratik', posterFrame: 175, sheet: { width: 270, cols: 9 } },
  { id: 'KobiPratikIntro', name: 'kobipratik-tanitim-yatay', dir: 'kobipratik', posterFrame: 165, sheet: { width: 400, cols: 8 } },
  { id: 'KobiPratikIntroVertical', name: 'kobipratik-tanitim-dikey', dir: 'kobipratik', posterFrame: 165, sheet: { width: 220, cols: 10 } },
];

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const only = args.find((a) => !a.startsWith('--'));
const jobs = only ? JOBS.filter((j) => j.id === only || j.name === only) : JOBS;
if (jobs.length === 0) {
  console.error(`Bilinmeyen kompozisyon: ${only}. Secenekler: ${JOBS.map((j) => j.id).join(', ')}`);
  process.exit(1);
}

function run(cmd, cmdArgs, opts = {}) {
  console.log(`\n$ ${cmd} ${cmdArgs.join(' ')}`);
  const r = spawnSync(cmd, cmdArgs, { cwd: ROOT, stdio: opts.capture ? 'pipe' : 'inherit', encoding: 'utf8' });
  if (r.status !== 0) {
    if (opts.capture) console.error(r.stderr);
    console.error(`${cmd} basarisiz (cikis kodu ${r.status})`);
    process.exit(r.status ?? 1);
  }
  return r;
}
const remotion = (a) => run('pnpm', ['exec', 'remotion', ...a]);
const ffmpeg = (a, capture = false) => run('ffmpeg', ['-hide_banner', ...a], { capture });
const mb = (p) => `${(statSync(p).size / 1024 / 1024).toFixed(1)} MB`;

function probeDuration(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { encoding: 'utf8' });
  return Number(r.stdout.trim());
}

function loudnorm(file) {
  const target = 'I=-14:TP=-1.5:LRA=11';
  const m = ffmpeg(['-nostats', '-i', file, '-af', `loudnorm=${target}:print_format=json`, '-f', 'null', '-'], true);
  const j = JSON.parse(m.stderr.slice(m.stderr.lastIndexOf('{'), m.stderr.lastIndexOf('}') + 1));
  const af = `loudnorm=${target}:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true`;
  const tmp = file.replace(/\.mp4$/, '.ln.mp4');
  ffmpeg(['-loglevel', 'error', '-y', '-i', file, '-c:v', 'copy', '-af', af, '-ar', '48000', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', tmp]);
  unlinkSync(file);
  renameSync(tmp, file);
}

function measure(file) {
  const r = ffmpeg(['-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'], true);
  const s = r.stderr.slice(r.stderr.lastIndexOf('Summary:'));
  const I = /I:\s+(-?[\d.]+) LUFS/.exec(s)?.[1];
  const tp = /Peak:\s+(-?[\d.]+) dBFS/.exec(s)?.[1];
  return { I, tp };
}

function blackFrames(file) {
  const r = ffmpeg(['-nostats', '-i', file, '-vf', 'blackdetect=d=0.05:pix_th=0.10', '-an', '-f', 'null', '-'], true);
  return r.stderr.split('\n').filter((l) => l.includes('black_start'));
}

if (!flags.has('--skip-audio')) run('node', ['scripts/audio/synth.mjs']);

const summary = [];
for (const j of jobs) {
  const OUT = join(OUT_ROOT, j.dir ?? 'marketing');
  mkdirSync(OUT, { recursive: true });
  const mp4 = join(OUT, `${j.name}.mp4`);
  const poster = join(OUT, `${j.name}.jpg`);
  const sheet = join(OUT, `${j.name}-contact.png`);
  remotion([
    'render', ENTRY, j.id, mp4,
    '--codec=h264', '--crf=18', '--pixel-format=yuv420p', '--x264-preset=slow',
    '--audio-codec=aac', '--audio-bitrate=192k',
    '--image-format=jpeg', '--jpeg-quality=95',
    `--props=${JSON.stringify({ muted: false })}`,
  ]);
  loudnorm(mp4);
  if (flags.has('--muted')) {
    const mutedMp4 = join(OUT, `${j.name}-muted.mp4`);
    ffmpeg(['-loglevel', 'error', '-y', '-i', mp4, '-c:v', 'copy', '-an', '-movflags', '+faststart', mutedMp4]);
  }
  remotion(['still', ENTRY, j.id, poster, `--frame=${j.posterFrame}`, '--image-format=jpeg', '--jpeg-quality=88', `--props=${JSON.stringify({ muted: true })}`]);
  const dur = probeDuration(mp4);
  const rows = Math.ceil(Math.floor(dur) / j.sheet.cols);
  ffmpeg(['-loglevel', 'error', '-y', '-i', mp4, '-vf', `fps=1,scale=${j.sheet.width}:-1,tile=${j.sheet.cols}x${rows}:padding=6:margin=6:color=white`, '-frames:v', '1', sheet]);
  const loud = measure(mp4);
  const black = blackFrames(mp4);
  summary.push({ id: j.id, file: mp4, size: mb(mp4), duration: dur.toFixed(2), lufs: loud.I, truePeak: loud.tp, blackSegments: black.length });
}

console.log('\n── Ozet ──');
console.table(summary);
