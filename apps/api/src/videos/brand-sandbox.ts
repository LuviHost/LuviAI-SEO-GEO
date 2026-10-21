import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { VIDEO_APP_DIR } from './article-short-kit.js';

/**
 * Marka ayristirmasini (guvenilmeyen HTML/CSS) API'nin olay dongusunun DISINDA, sert sure
 * siniriyla calistirir.
 *
 * NEDEN: inceleme, brand.mjs'teki desenlerin dusmanca girdide karesel calistigini olctu
 * (2 MB satir ici CSS ~ 85 dk, kapanmayan <title><style> 2 MB ~ 85 sn) ve bu sure boyunca
 * API surecinin olay dongusu tamamen kilitliydi (tek GET .../videos/brand istegi herkesi
 * durdurur). Desenler dogrusallastirildi ve girdi kirpildi; bu katman ikinci savunma: gozden
 * kacan bir desen olsa bile is parcacigi BRAND_PARSE_TIMEOUT_MS'de terminate() edilir, API
 * yanit vermeye devam eder. Bellek de sinirli (resourceLimits): dev JSON-LD surecin yigini
 * sisiremez.
 *
 * Her cagri yeni is parcacigi (~30-60 ms acilis): marka onizlemesi ve render basina iki cagri;
 * kalici havuz, takilan bir is parcacigini temizleme mantigi getirirdi — gerek yok.
 */
export const BRAND_PARSE_TIMEOUT_MS = 5_000;
export const BRAND_WORKER_FILE = path.join(VIDEO_APP_DIR, 'scripts/article-short/brand-worker.mjs');

export class BrandSandboxError extends Error {}

export function runInWorker<T = unknown>(
  op: string,
  args: unknown[],
  { timeoutMs = BRAND_PARSE_TIMEOUT_MS, file = BRAND_WORKER_FILE }: { timeoutMs?: number; file?: string } = {},
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const worker = new Worker(file, {
      workerData: { op, args },
      resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 },
    });
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
      void worker.terminate().catch(() => undefined);
    };
    const timer = setTimeout(
      () => finish(() => reject(new BrandSandboxError(`marka ayristirma ${timeoutMs} ms'de bitmedi (is parcacigi durduruldu)`))),
      timeoutMs,
    );
    worker.once('message', (m: { ok: boolean; value?: T; error?: string }) =>
      finish(() => (m?.ok ? resolve(m.value as T) : reject(new BrandSandboxError(m?.error ?? 'marka ayristirma hatasi')))),
    );
    worker.once('error', (e) => finish(() => reject(new BrandSandboxError(String(e?.message ?? e).slice(0, 300)))));
    worker.once('exit', (code) => finish(() => reject(new BrandSandboxError(`marka is parcacigi beklenmedik cikti (${code})`))));
  });
}

/** brand.mjs extractBrand({ compute }) kancasi: saf ayristirma is parcaciginda */
export const sandboxedBrandCompute = (op: string, args: unknown[]) => runInWorker(op, args);
