import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertResolvesPublic, RANKSUP_BOT_UA } from '../common/safe-fetch.js';
import { startRenderProxy, type RenderProxy } from './render-proxy.js';

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
 * Guvenlik (SSRF + tarayici):
 *   - YALNIZCA uye akisinda calisir; anonim ucretsiz kontrol tarayiciyi asla
 *     baslatmaz (niche-detector.service.ts).
 *   - Baslatmadan once adres denetlenir (assertResolvesPublic): http/https,
 *     80/443, ozel/ic adrese cozulmeyen alan adi.
 *   - Chrome'un TUM trafigi render-proxy.ts'deki denetimli vekilden gecer:
 *     yonlendirmeler, alt kaynaklar ve JS ile yapilan gecisler de ayni kuralla
 *     denetlenir. Vekil acilamazsa Chrome HIC baslatilmaz.
 *   - --disable-web-security YOK, uzaktan hata ayiklama portu (remote
 *     debugging) ACILMAZ, her render ayri gecici profil kullanir.
 *   - KALAN RISK: sayfa JS'i calisir; vekili kullanmayan kanallar (QUIC ve
 *     vekilsiz WebRTC UDP) bayraklarla kapatildi ama Chrome'un kendi
 *     guvenlik acigi (renderer exploit) bu katmanlarla kapanmaz.
 *     --no-sandbox ile calisirken boyle bir acik API surecinin kullanicisi
 *     yetkisiyle kod calistirmak demektir: Chrome guncel tutulmali, API root
 *     olmayan bir kullaniciyla calismali ve mumkunse CHROMIUM_SANDBOX=1
 *     ile sandbox acilmali.
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

/**
 * Chrome komut satiri. Saf — testte bayraklar denetlenir.
 * url her zaman new URL() ile normalize edilmis olmali: "--" ile baslayan bir
 * deger Chrome'a bayrak olarak gecerdi.
 */
export function chromeArgs(o: {
  url: string;
  proxyPort: number;
  virtualTimeMs: number;
  sandbox: boolean;
  userDataDir?: string | null;
}): string[] {
  return [
    '--headless=new',
    '--disable-gpu',
    // Root olarak calisan Chrome sandbox'siz baslamak zorunda; root degilse
    // ve isletim sistemi izin veriyorsa CHROMIUM_SANDBOX=1 ile sandbox acilir.
    ...(o.sandbox ? [] : ['--no-sandbox', '--disable-setuid-sandbox']),
    '--disable-dev-shm-usage',
    '--hide-scrollbars',
    '--mute-audio',
    '--no-first-run',
    '--no-default-browser-check',
    // Chrome'un kendi arka plan istekleri (guncelleme, senkron, eklenti) kapali
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-sync',
    ...(o.userDataDir ? [`--user-data-dir=${o.userDataDir}`] : []),
    // Tum trafik denetimli vekilden; localhost/link-local varsayilan istisnasi kaldirildi
    `--proxy-server=http://127.0.0.1:${o.proxyPort}`,
    '--proxy-bypass-list=<-loopback>',
    // Vekili atlayabilecek UDP kanallari
    '--disable-quic',
    '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
    '--blink-settings=imagesEnabled=false', // görselleri yükleme → hız
    `--virtual-time-budget=${o.virtualTimeMs}`,
    // Durust bot kimligi — site sahibi bizi bu adla tanir (safe-fetch.ts)
    `--user-agent=${RANKSUP_BOT_UA}`,
    '--dump-dom',
    o.url,
  ];
}

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
   * Binary yok / adres reddedildi / vekil acilamadi / hata / timeout / boş
   * çıktı durumunda `null`.
   */
  async renderHtml(
    url: string,
    opts?: { timeoutMs?: number; virtualTimeMs?: number },
  ): Promise<string | null> {
    const bin = this.resolveBinary();
    if (!bin) return null;

    let target: URL;
    try {
      target = await assertResolvesPublic(url);
    } catch (err: any) {
      this.log.warn(`Render reddedildi: ${err?.code ?? 'gecersiz'} — ${err?.message ?? ''}`);
      return null;
    }

    let proxy: RenderProxy;
    try {
      proxy = await startRenderProxy();
    } catch (err: any) {
      // Vekilsiz Chrome = denetimsiz ag erisimi. Render'dan vazgec.
      this.log.warn(`Render vekili acilamadi, render atlandi: ${err?.message ?? err}`);
      return null;
    }

    let userDataDir: string | null = null;
    try {
      userDataDir = await mkdtemp(join(tmpdir(), 'ranksup-render-'));
    } catch { /* gecici profil olmadan da calisir */ }

    try {
      return await this.runChrome(bin, chromeArgs({
        url: target.toString(),
        proxyPort: proxy.port,
        virtualTimeMs: opts?.virtualTimeMs ?? 8_000,
        sandbox: process.env.CHROMIUM_SANDBOX === '1',
        userDataDir,
      }), opts?.timeoutMs ?? 15_000, target.host);
    } finally {
      if (proxy.rejected > 0) this.log.warn(`Render (${target.host}): ${proxy.rejected} istek vekilde engellendi`);
      await proxy.close().catch(() => {});
      if (userDataDir) await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  private runChrome(bin: string, args: string[], timeoutMs: number, label: string): Promise<string | null> {
    const MAX_OUTPUT = 3_000_000; // 3MB güvenlik tavanı

    return new Promise<string | null>((resolve) => {
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
        this.log.warn(`Render timeout (${label}) — ${timeoutMs}ms`);
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
        this.log.warn(`Render spawn error (${label}): ${e.message}`);
        finish(null);
      });
      proc.on('close', (code: number | null) => {
        if (done) return;
        if (out.length > 200) finish(out);
        else {
          this.log.warn(`Render boş çıktı (${label}) code=${code} ${err.slice(0, 200)}`);
          finish(null);
        }
      });
    });
  }
}
