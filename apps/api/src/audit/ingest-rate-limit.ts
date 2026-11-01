/**
 * Ingest (POST /api/tracker/events) istek tavanlari — saf, bellek ici.
 *
 * NEDEN DEGISTI (02.11.2026): ayni site icin RanksUp'in bot sayilari
 * Cloudflare'inkinin ~%28'iydi (her botta tutarli ~3,5 kat eksik). Worker her
 * bot isteginde TEK POST atiyor; uc @Throttle ile IP basina 300/dk'ydi ve
 * Worker'larin cikis IP'leri paylasimli. Patlama aninda 429'lar dusuyor, Worker
 * de hatayi yutuyordu. Simdi:
 *
 *  - IMZASI DOGRULANAN istek SITE kimligine gore sayilir, cok daha yuksek
 *    tavanla (varsayilan 6000/dk). Imza site sirriyla HMAC oldugu icin bu kova
 *    baskasi tarafindan doldurulamaz.
 *  - IMZASIZ / GECERSIZ istek (401/404/400) IP basina eski tavanla
 *    (INGEST_RATE_LIMIT, varsayilan 300/dk) sayilir. Tavani dolan IP'nin
 *    sonraki istekleri imza/DB'ye HIC ulasmadan 429 alir — "gecersiz imzayla
 *    ucuz HMAC + DB sorgusu" vektoru kapali kalir.
 *  - Site kovasindan dusen (429) istekler site bazinda sayilir ve panelde
 *    gorunur (live-crawler.service recordThrottled).
 *
 * Surec basina ve bellek icidir (onceki @nestjs/throttler deposu da oyleydi).
 */

/** Sabit pencereli sayac; anahtar tavani dolunca en eski anahtar atilir (yeni anahtar reddedilmez) */
export class FixedWindowLimiter {
  private window = Number.NaN;
  private readonly counts = new Map<string, number>();

  constructor(
    private readonly windowMs: number,
    private readonly maxKeys = 50_000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  private roll(): void {
    const w = Math.floor(this.now() / this.windowMs);
    if (w !== this.window) {
      this.window = w;
      this.counts.clear();
    }
  }

  /** Anahtar tavanin altinda mi — sayaci ARTIRMADAN */
  allows(key: string, limit: number): boolean {
    this.roll();
    return (this.counts.get(key) ?? 0) < limit;
  }

  /** Bir pay al; tavan doluysa false */
  take(key: string, limit: number): boolean {
    this.roll();
    const cur = this.counts.get(key) ?? 0;
    if (cur >= limit) return false;
    if (cur === 0) {
      while (this.counts.size >= this.maxKeys) {
        const oldest = this.counts.keys().next().value;
        if (oldest === undefined) break;
        this.counts.delete(oldest);
      }
    }
    this.counts.set(key, cur + 1);
    return true;
  }

  /** Pencerenin bitmesine kalan saniye (Retry-After) */
  retryAfterSeconds(): number {
    const left = this.windowMs - (this.now() % this.windowMs);
    return Math.max(1, Math.ceil(left / 1000));
  }
}

function envLimit(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}

/** Imzali istekler icin site basina dakikalik tavan (cagri aninda okunur — test ortami degistirebilir) */
export function ingestSiteRateLimit(): number {
  return envLimit('INGEST_SITE_RATE_LIMIT', 6000);
}

/** Imzasiz / gecersiz istekler icin IP basina dakikalik tavan */
export function ingestIpFailureLimit(): number {
  return envLimit('INGEST_RATE_LIMIT', 300);
}
