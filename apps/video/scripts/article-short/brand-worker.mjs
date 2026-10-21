/**
 * worker_thread girisi — marka ayristirmasinin SAF kismi (analyzeBrandPage, colorFromCss).
 *
 * NEDEN ayri is parcacigi: API sureci (GET /sites/:id/videos/brand) guvenilmeyen HTML/CSS'i
 * ayristiriyor. Desenler dogrusal ve girdi kirpili olsa da, gozden kacan tek bir desen API'nin
 * olay dongusunu (tum kullanicilarin isteklerini) dakikalarca kilitleyebilirdi. Burada calisan
 * is, cagiran tarafta (api videos/brand-sandbox.ts) sert sure siniriyla terminate() edilir.
 * Ag erisimi yok: indirmeler ana surecte SSRF korumali yapilir, buraya yalniz metin gelir.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { analyzeBrandPage, colorFromCss } from './brand.mjs';

const OPS = { analyze: analyzeBrandPage, cssColor: colorFromCss };

try {
  const fn = OPS[workerData?.op];
  if (!fn) throw new Error(`bilinmeyen islem: ${String(workerData?.op).slice(0, 40)}`);
  parentPort.postMessage({ ok: true, value: fn(...(workerData.args ?? [])) });
} catch (e) {
  parentPort.postMessage({ ok: false, error: String(e?.message ?? e).slice(0, 300) });
}
