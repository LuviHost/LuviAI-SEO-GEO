import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

/**
 * Headless Chrome ile SPA (client-side render) sitelerin GERÇEK render edilmiş
 * DOM'unu döndürür.
 *
 * Neden gerekli:
 *   Vite/React/Next-SPA siteleri sunucudan ~boş bir kabuk döner
 *   (`<div id="root"></div>` + JS bundle). İçeriğin tamamı tarayıcıda JS ile
 *   basılır. Basit `fetch()` bu içeriği göremez → niş/marka tespiti yanlış
 *   yapılır (örn. planln.com → "PlanIn" → "planlama yazılımı" yanlış tahmini).
 *
 * Yaklaşım:
 *   Yeni bir npm bağımlılığı (playwright/puppeteer) eklemek yerine sistemde
 *   kurulu Chromium/Chrome binary'sini `--headless=new --dump-dom` ile çalıştırıp
 *   render edilmiş DOM'u stdout'tan okuruz. Binary bulunamazsa `null` döner ve
 *   çağıran taraf statik içerikle (veya dürüst "okunamadı" sonucuyla) devam eder.
 *
 * Sunucu kurulumu:
 *   Ubuntu: `sudo apt-get install -y chromium-browser` veya Google Chrome .deb,
 *   ya da `CHROMIUM_PATH=/usr/bin/google-chrome` ile özel yol.
 */

const CHROMIUM_CANDIDATES = [
  process.env.CHROMIUM_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].filter((p): p is string => typeof p === 'string' && p.length > 0);

@Injectable()
export class PageRendererService {
  private readonly log = new Logger(PageRendererService.name);
  // undefined = henüz aranmadı, null = bulunamadı, string = binary yolu
  private cachedBinary: string | null | undefined;

  /** İlk çağrıda chromium binary'sini bul, sonraki çağrılarda cache'le. */
  private resolveBinary(): string | null {
    if (this.cachedBinary !== undefined) return this.cachedBinary;
    const found = CHROMIUM_CANDIDATES.find((p) => {
      try { return existsSync(p); } catch { return false; }
    });
    this.cachedBinary = found ?? null;
    if (this.cachedBinary) {
      this.log.log(`SPA renderer aktif — binary: ${this.cachedBinary}`);
    } else {
      this.log.warn('Chromium/Chrome binary bulunamadı — SPA render devre dışı. CHROMIUM_PATH ayarla.');
    }
    return this.cachedBinary;
  }

  /** Renderer kullanılabilir mi (binary var mı)? */
  isAvailable(): boolean {
    return this.resolveBinary() !== null;
  }

  /**
   * URL'yi headless Chrome'da render edip tam DOM HTML'ini döner.
   * Binary yok / hata / timeout / boş çıktı durumunda `null`.
   */
  async renderHtml(
    url: string,
    opts?: { timeoutMs?: number; virtualTimeMs?: number },
  ): Promise<string | null> {
    const bin = this.resolveBinary();
    if (!bin) return null;

    const timeoutMs = opts?.timeoutMs ?? 15_000;
    const virtualTimeMs = opts?.virtualTimeMs ?? 8_000;
    const MAX_OUTPUT = 3_000_000; // 3MB güvenlik tavanı

    return new Promise<string | null>((resolve) => {
      const args = [
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--hide-scrollbars',
        '--mute-audio',
        '--no-first-run',
        '--no-default-browser-check',
        '--blink-settings=imagesEnabled=false', // görselleri yükleme → hız
        `--virtual-time-budget=${virtualTimeMs}`,
        '--user-agent=RanksUp-NicheDetector/1.0 (+https://ranksup.ai)',
        '--dump-dom',
        url,
      ];

      let out = '';
      let err = '';
      let done = false;

      const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });

      const finish = (result: string | null) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { proc.kill('SIGKILL'); } catch { /* zaten ölmüş olabilir */ }
        resolve(result);
      };

      const timer = setTimeout(() => {
        this.log.warn(`Render timeout (${url}) — ${timeoutMs}ms`);
        finish(out.length > 500 ? out : null);
      }, timeoutMs);

      proc.stdout.on('data', (d: Buffer) => {
        out += d.toString();
        if (out.length > MAX_OUTPUT) finish(out);
      });
      proc.stderr.on('data', (d: Buffer) => {
        if (err.length < 2000) err += d.toString();
      });
      proc.on('error', (e: Error) => {
        this.log.warn(`Render spawn error (${url}): ${e.message}`);
        finish(null);
      });
      proc.on('close', (code: number | null) => {
        if (done) return;
        if (out.length > 200) finish(out);
        else {
          this.log.warn(`Render boş çıktı (${url}) code=${code} ${err.slice(0, 200)}`);
          finish(null);
        }
      });
    });
  }
}
