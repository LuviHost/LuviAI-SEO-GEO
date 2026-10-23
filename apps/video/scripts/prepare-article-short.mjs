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
 *  3) 'footage' video stilinin stok klipleri (scripts/stock.mjs): Mixkit'ten indirir, boyut + sha256
 *     dogrular (~110 MB, ilk seferde; sonra yerinde). Ag yoksa / dosya tutmazsa diger adimlar yine
 *     tamamlanir, sonda acik hata ve cikis kodu 1 — o sunucuda 'footage' stiliyle istenen video render
 *     baslamadan StyleAssetError ile duser (api: FAILED + hak iadesi).
 *  4) Remotion paketini (webpack) kurar ve kaynak ozetiyle onbellege yazar; worker ilk videoda
 *     paketlemez, dogrudan bu paketi kullanir. Stok kliplerden SONRA (Remotion public/'i paketler).
 *  5) ffmpeg'in nereden cozuldugunu yazar (env / sistem / Remotion'in kendi ikilisi).
 */
import { ensureArticleShortAudio, getArticleShortServeUrl, renderConcurrency } from '../render/article-short.mjs';
import { remotionRequire, resolveFf } from './ffmpeg.mjs';
import { ensureStock } from './stock.mjs';

const t0 = performance.now();
const { ensureBrowser } = remotionRequire()('@remotion/renderer');
const browser = await ensureBrowser({ logLevel: 'error' });
console.log(`✓ tarayici   ${browser?.type ?? 'hazir'}`);
console.log(`✓ ses        ${ensureArticleShortAudio().cached ? 'onbellekte' : 'sentezlendi'}`);
let stockError = null;
try {
  const st = await ensureStock({ log: (m) => console.log(m) });
  console.log(`✓ stok       ${st.filter((x) => x.status === 'downloaded').length} indirildi, ${st.filter((x) => x.status === 'ok').length} yerinde (footage stili)`);
} catch (err) {
  stockError = err;
  console.error(`✗ stok       ${err?.message ?? err}`);
}
const b = await getArticleShortServeUrl();
console.log(`✓ paket      ${b.cached ? 'onbellekte' : 'yeni'} · ${b.serveUrl}`);
const ff = resolveFf('ffmpeg');
console.log(`✓ ffmpeg     ${ff.source} · ${ff.cmd}`);
console.log(`✓ esz.       VIDEO_RENDER_CONCURRENCY=${process.env.VIDEO_RENDER_CONCURRENCY ?? '(yok)'} -> ${renderConcurrency()}`);
console.log(`Hazir (${((performance.now() - t0) / 1000).toFixed(1)} sn)`);
if (stockError) {
  console.error("'footage' stili bu sunucuda KULLANILAMAZ: stok klipleri eksik. Ag erisimini (assets.mixkit.co) kontrol edip bu komutu tekrar calistir.");
  process.exitCode = 1;
}
