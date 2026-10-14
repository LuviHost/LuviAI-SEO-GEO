#!/usr/bin/env node
/**
 * Videolari render edip apps/web/public/landing-media/ altina yazar.
 *
 *   pnpm --filter @luviai/video render              # hepsi
 *   pnpm --filter @luviai/video render HeroLoop     # yalniz HeroLoop (light + dark)
 *   pnpm --filter @luviai/video render Explainer
 *
 * Her video icin: H.264 MP4 (Safari/iOS), VP9 WebM (Chrome/Firefox, genelde daha kucuk)
 * ve bir poster JPG. Remotion ilk calismada Chrome Headless Shell indirir.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// /videos/ nginx'te apps/api/public/videos'a alias'li (video factory) — landing ayri yolda
const OUT = join(ROOT, '..', 'web', 'public', 'landing-media');
const ENTRY = 'src/index.ts';

/**
 * scale: 1920x1080 kompozisyon cikis boyutu carpani. Hero ~1150px genislikte
 * gosterildigi icin 1440x810 yeterli; Explainer diyalogda tam ekrana kadar
 * buyuyebilir ama altyazilar iri — 1440x810 orada da net.
 * crf: H.264 icin 18-28 araligi makul; UI agirlikli, duz renkli kareler yuksek
 * crf'te de temiz kalir. VP9 crf olcegi farkli (0-63).
 */
const JOBS = [
  { id: 'HeroLoopLight', group: 'HeroLoop', name: 'hero-loop-light', scale: 0.75, crf: 26, vp9Crf: 42, posterFrame: 520 },
  { id: 'HeroLoopDark', group: 'HeroLoop', name: 'hero-loop-dark', scale: 0.75, crf: 26, vp9Crf: 42, posterFrame: 520 },
  { id: 'Explainer', group: 'Explainer', name: 'explainer', scale: 0.75, crf: 28, vp9Crf: 40, posterFrame: 60 },
];

const only = process.argv[2];
const jobs = only ? JOBS.filter((j) => j.group === only || j.id === only) : JOBS;
if (jobs.length === 0) {
  console.error(`Bilinmeyen kompozisyon: ${only}. Secenekler: ${[...new Set(JOBS.map((j) => j.group))].join(', ')}`);
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });

function remotion(args) {
  console.log(`\n$ remotion ${args.join(' ')}`);
  const r = spawnSync('pnpm', ['exec', 'remotion', ...args], { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`remotion ${args[0]} basarisiz (cikis kodu ${r.status})`);
    process.exit(r.status ?? 1);
  }
}

const kb = (p) => `${(statSync(p).size / 1024).toFixed(0)} KB`;

for (const j of jobs) {
  const mp4 = join(OUT, `${j.name}.mp4`);
  const webm = join(OUT, `${j.name}.webm`);
  const poster = join(OUT, `${j.name}.jpg`);
  remotion(['render', ENTRY, j.id, mp4, '--codec=h264', `--crf=${j.crf}`, `--scale=${j.scale}`, '--muted', '--pixel-format=yuv420p', '--x264-preset=slow', '--image-format=jpeg', '--jpeg-quality=90']);
  remotion(['render', ENTRY, j.id, webm, '--codec=vp9', `--crf=${j.vp9Crf}`, `--scale=${j.scale}`, '--muted', '--image-format=jpeg', '--jpeg-quality=90']);
  remotion(['still', ENTRY, j.id, poster, `--frame=${j.posterFrame}`, `--scale=${j.scale}`, '--image-format=jpeg', '--jpeg-quality=82']);
  console.log(`\n${j.id}: mp4 ${kb(mp4)} · webm ${kb(webm)} · poster ${kb(poster)}`);
}
