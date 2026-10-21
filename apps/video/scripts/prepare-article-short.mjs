#!/usr/bin/env node
/**
 * Deploy adimi — RanksUp Video (makaleden video) uretim sunucusunda bir kez:
 *
 *   pnpm --filter @luviai/video prepare:article-short
 *
 *  1) Chrome Headless Shell'i indirir (node_modules/.remotion/; ag gerekir). Linux'ta eksik
 *     paylasimli kutuphane varsa burada hata verir — README "Uretim sunucusu" bolumu.
 *  2) Ses: tempo basina ayri uslupte muzik (scripts/audio/styles.mjs) — hizli icin sablon basina tek
 *     dosya, normal / slow kokleri ve efektler (public/audio/tempo/, 38 dosya, ilk seferde ~30 sn; git'e
 *     girmez). timeline.json ve sentez kodu degismediyse onbellekte.
 *  3) Remotion paketini (webpack) kurar ve kaynak ozetiyle onbellege yazar; worker ilk videoda
 *     paketlemez, dogrudan bu paketi kullanir.
 *  4) ffmpeg'in nereden cozuldugunu yazar (env / sistem / Remotion'in kendi ikilisi).
 */
import { ensureArticleShortAudio, getArticleShortServeUrl, renderConcurrency } from '../render/article-short.mjs';
import { remotionRequire, resolveFf } from './ffmpeg.mjs';

const t0 = performance.now();
const { ensureBrowser } = remotionRequire()('@remotion/renderer');
const browser = await ensureBrowser({ logLevel: 'error' });
console.log(`✓ tarayici   ${browser?.type ?? 'hazir'}`);
console.log(`✓ ses        ${ensureArticleShortAudio().cached ? 'onbellekte' : 'sentezlendi'}`);
const b = await getArticleShortServeUrl();
console.log(`✓ paket      ${b.cached ? 'onbellekte' : 'yeni'} · ${b.serveUrl}`);
const ff = resolveFf('ffmpeg');
console.log(`✓ ffmpeg     ${ff.source} · ${ff.cmd}`);
console.log(`✓ esz.       VIDEO_RENDER_CONCURRENCY=${process.env.VIDEO_RENDER_CONCURRENCY ?? '(yok)'} -> ${renderConcurrency()}`);
console.log(`Hazir (${((performance.now() - t0) / 1000).toFixed(1)} sn)`);
