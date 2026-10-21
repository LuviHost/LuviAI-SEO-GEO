/**
 * ffmpeg / ffprobe cozumu — ses sentezi (audio/synth.mjs), CLI prototipi ve sunucu render'i
 * (render/article-short.mjs) ayni kurali kullanir.
 *
 * Sira: FFMPEG_PATH / FFPROBE_PATH ortam degiskeni > PATH'teki sistem ffmpeg'i > Remotion'in
 * kendi ffmpeg'i (@remotion/compositor-<platform>-<arch> paketi, renderMedia zaten onu kullanir).
 *
 * NEDEN son yedek Remotion'inki: uretim sunucusunda sistem ffmpeg'i olup olmadigi repodan
 * dogrulanamiyor (eski Video Factory 0db5a1c'de kaldirildi). Remotion'in derlemesinde loudnorm
 * suzgeci, aac ve mjpeg kodlayicilari var (4.0.530'da `ffmpeg -filters` / `-encoders` ile
 * denendi), yani loudnorm ve poster icin ek kurulum gerekmez.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';

const cache = new Map();

/** Remotion paketleri @remotion/cli uzerinden cozulur (pnpm: apps/video'nun dogrudan bagimliligi degiller) */
export function remotionRequire() {
  return createRequire(createRequire(import.meta.url).resolve('@remotion/cli/package.json'));
}

/** @returns {{ cmd: string, cwd?: string, env?: NodeJS.ProcessEnv, source: string }} */
export function resolveFf(bin = 'ffmpeg') {
  if (cache.has(bin)) return cache.get(bin);
  let r;
  const fromEnv = process.env[bin === 'ffmpeg' ? 'FFMPEG_PATH' : 'FFPROBE_PATH'];
  if (fromEnv) r = { cmd: fromEnv, source: 'env' };
  else if (spawnSync(bin, ['-version'], { stdio: 'ignore' }).status === 0) r = { cmd: bin, source: 'system' };
  else {
    const { RenderInternals } = remotionRequire()('@remotion/renderer');
    const cmd = RenderInternals.getExecutablePath({ type: bin, indent: false, logLevel: 'error', binariesDirectory: null });
    RenderInternals.makeFileExecutableIfItIsNot(cmd);
    const cwd = dirname(cmd);
    // macOS'ta dinamik kutuphaneler ikilinin yaninda (Remotion getExplicitEnv ile ayni)
    r = { cmd, cwd, env: process.platform === 'darwin' ? { ...process.env, DYLD_LIBRARY_PATH: cwd } : process.env, source: 'remotion' };
  }
  cache.set(bin, r);
  return r;
}

/** Senkron calistir (CLI ve ses sentezi); hata -> stderr kuyruguyla Error */
export function runFfSync(bin, args, { inherit = false } = {}) {
  const f = resolveFf(bin);
  const r = spawnSync(f.cmd, args, { cwd: f.cwd, env: f.env, encoding: 'utf8', stdio: inherit ? 'inherit' : 'pipe', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`${bin} basarisiz (${r.status}): ${String(r.stderr ?? '').slice(-800)}`);
  return r;
}

/**
 * Asenkron calistir — sunucuda olay dongusunu (BullMQ kilit yenilemesi) bloklamamak icin.
 * stdout/stderr bellekte toplanir; ust sinir asilirsa surec oldurulur.
 * signal: render isinin toplam suresi dolunca (api video-render.service) ffmpeg SIGKILL ile
 * oldurulur — aksi halde zaman asimina ugrayan isin ffmpeg'i sonraki videoyla yarisirdi.
 */
export function runFfAsync(bin, args, { timeoutMs = 120_000, maxOutput = 8 * 1024 * 1024, signal = null } = {}) {
  const f = resolveFf(bin);
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error(`${bin} iptal edildi`));
      return;
    }
    const child = spawn(f.cmd, args, { cwd: f.cwd, env: f.env, stdio: ['ignore', 'pipe', 'pipe'] });
    const onAbort = () => child.kill('SIGKILL');
    signal?.addEventListener('abort', onAbort, { once: true });
    let stdout = '';
    let stderr = '';
    const cap = (s, chunk) => (s.length + chunk.length > maxOutput ? s : s + chunk);
    child.stdout.on('data', (c) => (stdout = cap(stdout, String(c))));
    child.stderr.on('data', (c) => (stderr = cap(stderr, String(c))));
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(e);
    });
    child.on('close', (code, sig) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (signal?.aborted) reject(signal.reason ?? new Error(`${bin} iptal edildi`));
      else if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${bin} basarisiz (${sig ?? code}): ${stderr.slice(-800)}`));
    });
  });
}
