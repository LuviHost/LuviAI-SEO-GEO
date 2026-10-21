#!/usr/bin/env node
/**
 * Makale URL'si -> 15 sn dikey video. TEK KOMUT, insansiz:
 *
 *   node scripts/article-short.mjs <makaleUrl> [--concurrency=N] [--out=dizin] [--muted] [--no-sheet]
 *
 * Adimlar (her biri zamanlanir):
 *   1 fetch    robots.txt denetimi + makale HTML'i (RanksUpBot UA, boyut/sure siniri)
 *   2 brand    site adi, logo/favicon, tema rengi (indirilenler downloads/ altina, yalniz okunur)
 *   3 extract  makale yapisi (JSON-LD, basliklar, maddeler)
 *   4 script   metin adimi (bugun cikarimsal; uretimde Claude Haiku 5.5) + sayi/olgu koruyucusu
 *   5 audio    timeline.json'dan sentez muzik (her video icin ayni dosya; yoksa uretilir)
 *   6 bundle   Remotion webpack paketi (kaynak ozeti degismediyse onbellekten — uretimde deploy'da bir kez)
 *   7 render   renderMedia: ArticleShort, H.264 + AAC
 *   8 loudnorm ffmpeg iki gecis (-14 LUFS, -1.5 dBTP; goruntu kopyalanir)
 *   9 poster   ffmpeg tek kare JPG
 *  10 sheet    temas sayfasi (saniyede 1 kare) — kalite kontrolu icin
 *
 * Cikti: out/article-shorts/<slug>/{video.mp4, poster.jpg, contact.png, props.json, script.json,
 *        article.json, timings.json, downloads/}
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractBrand } from './article-short/brand.mjs';
import { buildLlmRequest, buildScript } from './article-short/copy.mjs';
import { extractArticle } from './article-short/extract.mjs';
import { USER_AGENT, fetchLimited, robotsAllows } from './article-short/net.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => {
  const a = args.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : d;
};
const flag = (k) => args.includes(`--${k}`);
const articleUrl = args.find((a) => !a.startsWith('--'));
if (!articleUrl) {
  console.error('Kullanim: node scripts/article-short.mjs <makaleUrl> [--concurrency=N] [--out=dizin] [--muted]');
  process.exit(1);
}

const cores = os.availableParallelism?.() ?? os.cpus().length;
const concurrency = Number(opt('concurrency', Math.max(1, Math.floor(cores / 2))));
const slug = (new URL(articleUrl).pathname.split('/').filter(Boolean).pop() || 'index').replace(/[^a-z0-9-]/gi, '').slice(0, 60);
const OUT = opt('out', join(ROOT, 'out', 'article-shorts', slug));
const DL = join(OUT, 'downloads'); // guvenilmeyen indirmeler — yalniz okunur
mkdirSync(DL, { recursive: true });

const timings = [];
async function step(name, fn) {
  const t = performance.now();
  const r = await fn();
  const ms = performance.now() - t;
  timings.push({ adim: name, sn: Number((ms / 1000).toFixed(2)), ...(r?.__note ? { not: r.__note } : {}) });
  console.log(`✓ ${name.padEnd(9)} ${(ms / 1000).toFixed(2).padStart(7)} sn${r?.__note ? `  (${r.__note})` : ''}`);
  return r;
}
const run = (cmd, a, capture = true) => {
  const r = spawnSync(cmd, a, { cwd: ROOT, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit' });
  if (r.status !== 0) throw new Error(`${cmd} basarisiz: ${r.stderr?.slice(-800)}`);
  return r;
};

const T0 = performance.now();
console.log(`RanksUp ArticleShort · ${articleUrl}\nCikti: ${relative(process.cwd(), OUT) || OUT} · ${cores} cekirdek, render eszamanliligi ${concurrency}\n`);

/* 1 — fetch */
const page = await step('fetch', async () => {
  const u = new URL(articleUrl);
  let robotsNote = 'robots.txt yok';
  try {
    const r = await fetchLimited(`${u.origin}/robots.txt`, { maxBytes: 500_000, accept: 'text/plain' });
    const txt = r.body.toString('utf8');
    writeFileSync(join(DL, 'robots.txt'), txt);
    if (!robotsAllows(txt, u.pathname + u.search)) throw new Error(`robots.txt bu yolu ${USER_AGENT} icin yasakliyor`);
    robotsNote = 'robots.txt izin veriyor';
  } catch (e) {
    if (/yasakliyor/.test(e.message)) throw e;
  }
  const r = await fetchLimited(articleUrl, { accept: 'text/html' });
  if (!/html/i.test(r.contentType)) throw new Error(`HTML degil: ${r.contentType}`);
  const html = r.body.toString('utf8');
  writeFileSync(join(DL, 'article.html'), html);
  return { html, finalUrl: r.url, __note: `${(r.body.length / 1024).toFixed(0)} KB, ${robotsNote}` };
});

/* 2 — brand */
const brand = await step('brand', async () => {
  const b = await extractBrand(page.html, page.finalUrl, { saveDir: DL });
  return { ...b, __note: `${b.name} · renk ${b.primary ?? 'yok'} (${b.colorSource}) · logo ${b.logo ? `${b.logo.rel} ${b.logo.type}` : 'yok'}` };
});

/* 3 — extract */
const article = await step('extract', async () => {
  const a = extractArticle(page.html, page.finalUrl);
  if (!a.title) throw new Error('Makale basligi bulunamadi');
  writeFileSync(join(OUT, 'article.json'), JSON.stringify({ ...a, sourceText: undefined }, null, 2));
  return { ...a, __note: `${a.sections.length} bolum, ${a.blocks.length} blok, govde: ${a.bodyVia}` };
});

/* 4 — script */
const { script, check } = await step('script', async () => {
  const r = await buildScript(article, { strategy: opt('strategy', 'extractive') });
  writeFileSync(join(OUT, 'script.json'), JSON.stringify({ ...r.script, check: r.check }, null, 2));
  if (!r.check.ok) throw new Error(`Metin koruyucusu reddetti: ${r.check.errors.join('; ')}`);
  return { ...r, __note: `koruyucu: tamam${r.check.warnings.length ? ` · ${r.check.warnings.length} uyari` : ''}` };
});
const llm = buildLlmRequest(article).estimate;

const props = {
  hook: script.hook,
  ...(script.hookSub ? { hookSub: script.hookSub } : {}),
  ...(script.kicker ? { kicker: script.kicker } : {}),
  points: script.points,
  cta: script.cta,
  brand: { name: brand.name, domain: brand.domain, ...(brand.primary ? { primary: brand.primary } : {}), ...(brand.logoDataUri ? { logoUrl: brand.logoDataUri } : {}) },
  sourcePath: `${article.domain}${new URL(article.url).pathname.split('/').slice(0, -1).join('/')}`,
  muted: flag('muted'),
  watermark: true,
};
const propsFile = join(OUT, 'props.json');
writeFileSync(propsFile, JSON.stringify(props, null, 2));

/* 5 — audio (izgara sabit: tek dosya, onbellek) */
await step('audio', async () => {
  const wav = join(ROOT, 'public', 'audio', 'article-short.wav');
  const tl = statSync(join(ROOT, 'src', 'marketing', 'timeline.json')).mtimeMs;
  if (existsSync(wav) && statSync(wav).mtimeMs > tl) return { __note: 'onbellekte' };
  run('node', ['scripts/audio/synth.mjs', 'ArticleShort']);
  return { __note: 'sentezlendi' };
});

/* Remotion paketleri @remotion/cli uzerinden cozulur (pnpm: dogrudan bagimlilik degiller) */
const req = createRequire(createRequire(import.meta.url).resolve('@remotion/cli/package.json'));
const { bundle } = req('@remotion/bundler');
const { renderMedia, selectComposition } = req('@remotion/renderer');

/* 6 — bundle */
const serveUrl = await step('bundle', async () => {
  const h = createHash('sha256');
  const walk = (d) => {
    for (const f of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(d, f.name);
      if (f.isDirectory()) walk(p);
      else h.update(p).update(String(statSync(p).size)).update(String(statSync(p).mtimeMs));
    }
  };
  walk(join(ROOT, 'src'));
  walk(join(ROOT, 'public'));
  const dir = join(ROOT, 'node_modules', '.cache', 'article-short', `bundle-${h.digest('hex').slice(0, 16)}`);
  if (existsSync(join(dir, 'index.html'))) return Object.assign(new String(dir), { __note: 'onbellekten (uretimde deploy basina bir kez)' });
  const out = await bundle({ entryPoint: join(ROOT, 'src', 'index.ts'), outDir: dir, publicDir: join(ROOT, 'public') });
  return Object.assign(new String(out), { __note: 'yeni paket' });
});

/* 7 — render */
const mp4 = join(OUT, 'video.mp4');
let peakRssMb = 0;
await step('render', async () => {
  const composition = await selectComposition({ serveUrl: String(serveUrl), id: 'ArticleShort', inputProps: props, logLevel: 'error' });
  let lastPct = -1;
  const timer = setInterval(() => (peakRssMb = Math.max(peakRssMb, process.memoryUsage().rss / 1048576)), 500);
  await renderMedia({
    composition,
    serveUrl: String(serveUrl),
    codec: 'h264',
    outputLocation: mp4,
    inputProps: props,
    concurrency,
    crf: 20,
    pixelFormat: 'yuv420p',
    imageFormat: 'jpeg',
    jpegQuality: 92,
    audioCodec: 'aac',
    audioBitrate: '192k',
    logLevel: 'error',
    onProgress: ({ progress }) => {
      const pct = Math.floor(progress * 10) * 10;
      if (pct !== lastPct) {
        lastPct = pct;
        process.stdout.write(`  render %${pct}\r`);
      }
    },
  });
  clearInterval(timer);
  return { __note: `${composition.durationInFrames} kare, ${composition.width}x${composition.height}@${composition.fps}, eszamanlilik ${concurrency}` };
});

/* 8 — loudnorm */
await step('loudnorm', async () => {
  if (props.muted) return { __note: 'sessiz varyant — atlandi' };
  const target = 'I=-14:TP=-1.5:LRA=11';
  const m = run('ffmpeg', ['-hide_banner', '-nostats', '-i', mp4, '-af', `loudnorm=${target}:print_format=json`, '-f', 'null', '-']);
  const j = JSON.parse(m.stderr.slice(m.stderr.lastIndexOf('{'), m.stderr.lastIndexOf('}') + 1));
  const af = `loudnorm=${target}:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true`;
  const tmp = mp4.replace(/\.mp4$/, '.ln.mp4');
  run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', mp4, '-c:v', 'copy', '-af', af, '-ar', '48000', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', tmp]);
  unlinkSync(mp4);
  renameSync(tmp, mp4);
  return { __note: `giris ${j.input_i} LUFS -> -14` };
});

/* 9 — poster (kanca tam gorunur: 2.6 sn) */
const poster = join(OUT, 'poster.jpg');
await step('poster', async () => {
  run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '2.6', '-i', mp4, '-frames:v', '1', '-q:v', '3', poster]);
});

/* 10 — temas sayfasi */
const sheet = join(OUT, 'contact.png');
if (!flag('no-sheet')) {
  await step('sheet', async () => {
    run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', mp4, '-vf', 'fps=1,scale=270:-1,tile=8x2:padding=6:margin=6:color=white', '-frames:v', '1', sheet]);
  });
}

const total = (performance.now() - T0) / 1000;
const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,bit_rate', '-of', 'json', mp4], { encoding: 'utf8' });
const fmt = JSON.parse(probe.stdout).format;
const summary = {
  url: articleUrl,
  out: OUT,
  toplamSn: Number(total.toFixed(2)),
  cekirdek: cores,
  cpu: os.cpus()[0]?.model,
  eszamanlilik: concurrency,
  renderTepeRssMbNode: Math.round(peakRssMb),
  videoSuresiSn: Number(Number(fmt.duration).toFixed(2)),
  boyutMB: Number((statSync(mp4).size / 1048576).toFixed(2)),
  bitrateKbps: Math.round(Number(fmt.bit_rate) / 1000),
  posterKB: Math.round(statSync(poster).size / 1024),
  llmTahmini: { model: 'claude-haiku-5-5', ...llm, outputTokens: '~250-400' },
  uyarilar: check.warnings,
  adimlar: timings,
};
writeFileSync(join(OUT, 'timings.json'), JSON.stringify(summary, null, 2));
console.log('\n── Ozet ──');
console.table(timings);
console.log(JSON.stringify({ ...summary, adimlar: undefined }, null, 2));
