/**
 * ArticleShort render hatti — TEK KAYNAK. Hem CLI prototipi (scripts/article-short.mjs) hem
 * sunucu (api videos/video-render.service.ts, worker'daki 'video-render' kuyrugu) bunu kullanir.
 *
 *   ensureArticleShortAudio()  timeline.json'dan sentez muzik: 'fast' icin sablon basina tek dosya,
 *                              normal / slow icin tempo kokleri (public/audio/tempo/; yoksa uretilir)
 *   getArticleShortServeUrl()  Remotion webpack paketi — kaynak ozeti degismediyse diskteki paket
 *                              (deploy'da `pnpm --filter @luviai/video prepare:article-short` bir kez kurar);
 *                              surec icinde de bellege alinir, her videoda yeniden paketlenmez
 *   renderArticleShortMp4()    renderMedia: VIDEO_COMPOSITIONS'tan biri (makale, site, urun), H.264 + AAC
 *   loudnormInPlace()          ffmpeg iki gecis (-14 LUFS, -1.5 dBTP; goruntu kopyalanir)
 *   extractPoster()            ffmpeg tek kare JPG (kanca tam gorunur: fast'ta sabit saniye, normal /
 *                              slow'da tempo planinin kanca karesi)
 *   renderArticleShort()       hepsi sirayla; ciktilar once gecici adla yazilip sonra yerine tasinir
 *                              (nginx /videos/ yarim dosya sunmasin)
 *
 * Props dogrulamasi bu dosyada YAPILMAZ: metin koruyucusu (scripts/article-short/copy.mjs
 * validateScript) cagiran tarafta zorunlu kapidir.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { remotionRequire, runFfAsync } from '../scripts/ffmpeg.mjs';
import { createPlanner, normalizeTempo } from '../src/tempo/plan.mjs';

export const VIDEO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const COMPOSITION_ID = 'ArticleShort';
export const POSTER_SECONDS = 2.6;
/**
 * RanksUp Video'nun render edebildigi kompozisyonlar (src/Root.tsx) ve poster karesi (kanca tam
 * gorunurken). Liste disindaki kimlik reddedilir: istekten gelen bir deger baska bir kompozisyonu
 * (pazarlama videolari) render ettiremez. audio: timeline.json kompozisyonu (yatay urun videosu
 * dikeyle ayni izgarayi ve ses dosyasini kullanir).
 */
export const VIDEO_COMPOSITIONS = {
  ArticleShort: { audio: 'ArticleShort', posterSeconds: POSTER_SECONDS },
  // Kanca sahnesi 120 BPM'de 6 vurus = 3 sn (yatay site 10 vurus = 5 sn); poster kanca tam
  // gorunurken, cikis animasyonu baslamadan (ozellikler degil, ad + ne yaptigi gorunsun)
  SiteIntro: { audio: 'SiteIntro', posterSeconds: 2.4 },
  SiteIntroWide: { audio: 'SiteIntroWide', posterSeconds: 4.2 },
  ProductShort: { audio: 'ProductShort', posterSeconds: 2.45 },
  ProductWide: { audio: 'ProductShort', posterSeconds: 2.45 },
};
const AUDIO_DIR = join(VIDEO_ROOT, 'public', 'audio');
const TIMELINE_FILE = join(VIDEO_ROOT, 'src', 'marketing', 'timeline.json');
const BUNDLE_CACHE = join(VIDEO_ROOT, 'node_modules', '.cache', 'article-short');

/**
 * Sunucu render eszamanliligi: VIDEO_RENDER_CONCURRENCY > cekirdek/2, en az 1, en cok 4.
 * NEDEN 4 tavan: prototip olcumunde (scratchpad conc-1/2/4/12) 4'un ustu sureyi kisaltmadi,
 * yalniz Chrome sekmesi ve bellek artirdi; API ayni makinede yanit vermeye devam etmeli.
 */
export function renderConcurrency(env = process.env, cores = os.availableParallelism?.() ?? os.cpus().length) {
  const fromEnv = Number.parseInt(String(env.VIDEO_RENDER_CONCURRENCY ?? ''), 10);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return Math.min(fromEnv, 16);
  return Math.max(1, Math.min(4, Math.floor(cores / 2)));
}

/**
 * Her RanksUp Video sablonunun ses izi: yoksa ya da timeline.json'dan eskiyse sentezle
 * (deterministik; sablon basina tek dosya). Paketten ONCE cagrilir: Remotion public/ klasorunu
 * paketleme aninda kopyalar, sonradan uretilen ses pakete girmez.
 */
export function ensureArticleShortAudio() {
  const timeline = JSON.parse(readFileSync(TIMELINE_FILE, 'utf8'));
  const tl = statSync(TIMELINE_FILE).mtimeMs;
  const fresh = (file) => existsSync(file) && statSync(file).mtimeMs > tl;
  const synth = (arg) => {
    // ffmpeg cozumu synth.mjs icinde de ayni kuraldir (scripts/ffmpeg.mjs)
    const r = spawnSync(process.execPath, [join(VIDEO_ROOT, 'scripts', 'audio', 'synth.mjs'), arg], { cwd: VIDEO_ROOT, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`Ses sentezi basarisiz (${arg}): ${String(r.stderr ?? '').slice(-400)}`);
  };
  let cached = true;
  for (const id of new Set(Object.values(VIDEO_COMPOSITIONS).map((c) => c.audio))) {
    if (fresh(join(AUDIO_DIR, timeline.compositions[id].audio))) continue;
    cached = false;
    synth(id);
  }
  // normal / slow kokleri (tek seferde hepsi; ~1,5 dk — deploy'da prepare:article-short uretir)
  if (!createPlanner(timeline).stemJobs().every((j) => fresh(join(AUDIO_DIR, 'tempo', j.file)))) {
    cached = false;
    synth('--tempo');
  }
  return { cached };
}

/** Render edilecek props: tempo her zaman acik (Remotion defaultProps 'normal'; eksik tempo = eski 'fast') */
export function withTempo(props) {
  return { ...props, tempo: normalizeTempo(props?.tempo) };
}

let planner = null;
/** Poster saniyesi: fast'ta sablonun sabit degeri, normal / slow'da planin kanca karesi */
export function posterSecondsFor(compositionId, props) {
  const comp = assertComposition(compositionId);
  const tempo = normalizeTempo(props?.tempo);
  if (tempo === 'fast') return comp.posterSeconds;
  planner ??= createPlanner(JSON.parse(readFileSync(TIMELINE_FILE, 'utf8')));
  const p = planner.plan(compositionId, tempo, props);
  return Number((p.posterFrame / p.fps).toFixed(2));
}

/** Bilinen kompozisyon mu (VIDEO_COMPOSITIONS) — degilse hata */
export function assertComposition(id) {
  if (!Object.prototype.hasOwnProperty.call(VIDEO_COMPOSITIONS, id)) throw new Error(`Bilinmeyen video sablonu: ${String(id).slice(0, 40)}`);
  return VIDEO_COMPOSITIONS[id];
}

/** Paket kaynak ozeti: src/ + public/ (yol, boyut, mtime) — degismediyse eski paket gecerli */
export function sourceDigest() {
  const h = createHash('sha256');
  const walk = (d) => {
    for (const f of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(d, f.name);
      if (f.isDirectory()) walk(p);
      else {
        const st = statSync(p);
        h.update(p.slice(VIDEO_ROOT.length)).update(String(st.size)).update(String(Math.floor(st.mtimeMs)));
      }
    }
  };
  walk(join(VIDEO_ROOT, 'src'));
  walk(join(VIDEO_ROOT, 'public'));
  return h.digest('hex').slice(0, 16);
}

let serveUrlPromise = null;
let serveUrlDigest = null;

/**
 * Paketi bir kez kur, tekrar kullan. Ayni surecte ozet degismediyse bellekteki yol doner;
 * diskte ayni ozetli paket varsa (deploy'da kurulmus) webpack HIC calismaz.
 * @returns {Promise<{ serveUrl: string, cached: 'memory' | 'disk' | false }>}
 */
export async function getArticleShortServeUrl() {
  ensureArticleShortAudio();
  const digest = sourceDigest();
  if (serveUrlPromise && serveUrlDigest === digest) return { serveUrl: await serveUrlPromise, cached: 'memory' };
  const dir = join(BUNDLE_CACHE, `bundle-${digest}`);
  if (existsSync(join(dir, 'index.html'))) {
    serveUrlDigest = digest;
    serveUrlPromise = Promise.resolve(dir);
    return { serveUrl: dir, cached: 'disk' };
  }
  serveUrlDigest = digest;
  serveUrlPromise = (async () => {
    const { bundle } = remotionRequire()('@remotion/bundler');
    mkdirSync(BUNDLE_CACHE, { recursive: true });
    // Gecici dizine paketle, bitince yerine tasi: yarim paket "hazir" sanilmasin
    const tmp = `${dir}.tmp-${process.pid}`;
    rmSync(tmp, { recursive: true, force: true });
    await bundle({ entryPoint: join(VIDEO_ROOT, 'src', 'index.ts'), outDir: tmp, publicDir: join(VIDEO_ROOT, 'public') });
    if (existsSync(join(dir, 'index.html'))) rmSync(tmp, { recursive: true, force: true });
    else renameSync(tmp, dir);
    // Eski paketler yer kaplamasin (yalniz bu bilesene ait onbellek dizini)
    for (const old of readdirSync(BUNDLE_CACHE)) {
      if (old.startsWith('bundle-') && old !== `bundle-${digest}` && !old.includes('.tmp-')) rmSync(join(BUNDLE_CACHE, old), { recursive: true, force: true });
    }
    return dir;
  })();
  serveUrlPromise.catch(() => {
    serveUrlPromise = null;
    serveUrlDigest = null;
  });
  return { serveUrl: await serveUrlPromise, cached: false };
}

/**
 * renderMedia — cikti dogrudan outFile'a (cagiran gecici ad verir).
 * signal kesilince Remotion'in cancelSignal'i tetiklenir: Remotion kendi actigi Chrome'u ve
 * ffmpeg kodlayicisini kapatir (zaman asimina ugrayan render arkada CPU yemeye devam etmesin).
 */
export async function renderArticleShortMp4({ serveUrl, props: rawProps, outFile, concurrency = renderConcurrency(), onProgress, signal = null, compositionId = COMPOSITION_ID }) {
  const { renderMedia, selectComposition, makeCancelSignal } = remotionRequire()('@remotion/renderer');
  assertComposition(compositionId);
  const props = withTempo(rawProps);
  signal?.throwIfAborted();
  const composition = await selectComposition({ serveUrl, id: compositionId, inputProps: props, logLevel: 'error' });
  signal?.throwIfAborted();
  const { cancelSignal, cancel } = makeCancelSignal();
  const onAbort = () => cancel();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    await renderMedia({
      composition,
      serveUrl,
      codec: 'h264',
      outputLocation: outFile,
      inputProps: props,
      concurrency,
      crf: 20,
      pixelFormat: 'yuv420p',
      imageFormat: 'jpeg',
      jpegQuality: 92,
      audioCodec: 'aac',
      audioBitrate: '192k',
      logLevel: 'error',
      cancelSignal,
      ...(onProgress ? { onProgress: ({ progress }) => onProgress(progress) } : {}),
    });
  } catch (err) {
    // Iptalde Remotion kendi "renderMedia() got cancelled" hatasini atar; nedeni (zaman asimi) one cikar
    if (signal?.aborted) throw signal.reason ?? err;
    throw err;
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
  return { durationInFrames: composition.durationInFrames, fps: composition.fps, width: composition.width, height: composition.height };
}

/** Iki gecisli loudnorm; goruntu kopyalanir. Sonuc ayni dosyaya yazilir. */
export async function loudnormInPlace(mp4, { signal = null } = {}) {
  const target = 'I=-14:TP=-1.5:LRA=11';
  // -vn: olcum yalniz ses izinde. Remotion'in ffmpeg derlemesinde null cikti icin goruntu
  // kodlayicisi (wrapped_avframe) yok; goruntu akisi acik kalirsa olcum "Encoder not found" ile duser.
  const m = await runFfAsync('ffmpeg', ['-hide_banner', '-nostats', '-i', mp4, '-vn', '-af', `loudnorm=${target}:print_format=json`, '-f', 'null', '-'], { signal });
  const j = JSON.parse(m.stderr.slice(m.stderr.lastIndexOf('{'), m.stderr.lastIndexOf('}') + 1));
  const af = `loudnorm=${target}:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true`;
  const tmp = mp4.replace(/\.mp4$/, '') + '.ln.mp4';
  await runFfAsync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', mp4, '-c:v', 'copy', '-af', af, '-ar', '48000', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', tmp], { signal });
  renameSync(tmp, mp4);
  return { inputLufs: Number(j.input_i) };
}

export async function extractPoster(mp4, jpg, seconds = POSTER_SECONDS, { signal = null } = {}) {
  await runFfAsync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(seconds), '-i', mp4, '-frames:v', '1', '-q:v', '3', jpg], { signal });
}

/**
 * Tam hat: paket -> render -> loudnorm -> poster. Ciktilar yalniz basariyla bittiginde
 * outFile / posterFile adina tasinir; hata olursa gecici dosyalar silinir.
 * signal: cagiranin iptali (isin toplam suresi). Her adim arasinda denetlenir; render ve ffmpeg
 * alt surecleri olduruldukten sonra gecici dosyalar finally'de silinir, yarim cikti yerine tasinmaz.
 * @returns {Promise<{ durationSec: number, width: number, height: number, fps: number, bytes: number,
 *   posterBytes: number, concurrency: number, bundle: string | false, inputLufs: number | null, timings: Record<string, number> }>}
 */
export async function renderArticleShort({ props, outFile, posterFile, concurrency = renderConcurrency(), onProgress, signal = null, compositionId = COMPOSITION_ID }) {
  assertComposition(compositionId);
  props = withTempo(props);
  const t = {};
  const time = async (k, fn) => {
    const s = performance.now();
    const r = await fn();
    t[k] = Number(((performance.now() - s) / 1000).toFixed(2));
    return r;
  };
  mkdirSync(dirname(outFile), { recursive: true });
  const partMp4 = `${outFile}.part.mp4`;
  const partJpg = `${posterFile}.part.jpg`;
  try {
    signal?.throwIfAborted();
    const { serveUrl, cached } = await time('bundle', () => getArticleShortServeUrl());
    signal?.throwIfAborted();
    const comp = await time('render', () => renderArticleShortMp4({ serveUrl, props, outFile: partMp4, concurrency, onProgress, signal, compositionId }));
    const ln = props.muted ? null : await time('loudnorm', () => loudnormInPlace(partMp4, { signal }));
    await time('poster', () => extractPoster(partMp4, partJpg, posterSecondsFor(compositionId, props), { signal }));
    signal?.throwIfAborted();
    renameSync(partMp4, outFile);
    renameSync(partJpg, posterFile);
    return {
      durationSec: Number((comp.durationInFrames / comp.fps).toFixed(2)),
      width: comp.width,
      height: comp.height,
      fps: comp.fps,
      bytes: statSync(outFile).size,
      posterBytes: statSync(posterFile).size,
      concurrency,
      bundle: cached,
      inputLufs: ln?.inputLufs ?? null,
      compositionId,
      tempo: props.tempo,
      timings: t,
    };
  } finally {
    for (const f of [partMp4, partJpg, `${outFile}.part.ln.mp4`]) rmSync(f, { force: true });
  }
}
