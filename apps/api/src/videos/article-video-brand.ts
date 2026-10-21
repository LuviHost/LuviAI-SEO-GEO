import sharp from 'sharp';
import { safeFetchBinary, safeFetchText, SafeFetchError, type SafeFetchOptions, type SafeFetchResult, type SafeTextOptions, type SafeTextResult } from '../common/safe-fetch.js';
import type { BrandCompute, BrandFetcher, BrandKit, ExtractedBrand } from './article-short-kit.js';
import { sandboxedBrandCompute } from './brand-sandbox.js';

/**
 * RanksUp Video — musteri sitesinin markasi (ad, logo, tema rengi).
 *
 * Cikarim kurali TEK KAYNAK: apps/video scripts/article-short/brand.mjs (CLI ile ayni). Burada
 * yalniz iki sunucu kancasi verilir:
 *  - fetcher: SSRF korumali indirme (common/safe-fetch.ts) — ozel/yerel/ayrilmis IP'ye ve
 *    metadata uclarina baglanilmaz, DNS baglanti aninda denetlenir (rebinding yok), her
 *    yonlendirme bastan denetlenir, yalniz 80/443, boyut ve sure tavani.
 *  - prepareLogo: indirilen logo GUVENILMEYEN veridir; sharp ile cozulur, piksel tavani
 *    (decompression bomb), en fazla 256x256 PNG'ye cevrilir. SVG rasterlenir (betik/harici
 *    kaynak PNG'ye tasinmaz). Cozulemeyen (ICO dahil) aday atlanir.
 * Marka bulunamazsa video yine uretilir: ad = site adi, renk = RanksUp turuncusu, logo yerine
 * bas harf monogrami (ArticleShort sablonu).
 */

/** palette.ts FALLBACK_PRIMARY ile ayni — panel renk seciciye varsayilan olarak gosterir */
export const FALLBACK_BRAND_PRIMARY = '#f97316';

const LOGO_MAX_PX = 256;
const LOGO_MAX_INPUT_PIXELS = 4096 * 4096;
const LOGO_MAX_OUTPUT_BYTES = 200_000;
const HOMEPAGE_MAX_BYTES = 2 * 1024 * 1024;

export interface SiteBrand {
  name: string;
  domain: string;
  primary: string | null;
  colorSource: string;
  /** data:image/png;base64,... (en fazla 256 px) */
  logoDataUri: string | null;
  logoSource: string | null;
  notes: string[];
}

export interface BrandDeps {
  kit: BrandKit;
  fetchText?: (url: string, opts?: SafeTextOptions) => Promise<SafeTextResult>;
  fetchBinary?: (url: string, opts?: SafeFetchOptions) => Promise<SafeFetchResult>;
  /** Saf ayristirma nerede calisir; varsayilan worker_thread + sert sure siniri (brand-sandbox.ts) */
  compute?: BrandCompute;
  /** Render isinin toplam suresi dolunca marka cikarimi da birakilir */
  signal?: AbortSignal | null;
  /** Tum cikarimin (anasayfa haric) son tarihi; varsayilan brand.mjs BRAND_DEADLINE_MS */
  deadlineMs?: number;
}

/** Kullanicinin girdigi / sayfadan gelen renk: yalniz #rrggbb (kucuk harf); degilse null */
export function normalizeHexColor(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  return `#${h.toLowerCase()}`;
}

/** Logo: guvenilmeyen ikili -> en fazla 256 px PNG; olmazsa null (aday atlanir) */
export async function prepareLogo(body: Buffer, type: string): Promise<{ body: Buffer; type: string } | null> {
  // libvips ICO okuyamaz; favicon.ico adayi atlanir (siradaki aday denenir)
  if (/icon$/.test(type)) return null;
  try {
    const img = sharp(body, { limitInputPixels: LOGO_MAX_INPUT_PIXELS, failOn: 'error', animated: false, ...(type === 'image/svg+xml' ? { density: 300 } : {}) });
    const meta = await img.metadata();
    if (!meta.width || !meta.height || meta.width < 16 || meta.height < 16) return null;
    const out = await img
      .resize(LOGO_MAX_PX, LOGO_MAX_PX, { fit: 'inside', withoutEnlargement: type !== 'image/svg+xml' })
      .png({ compressionLevel: 9 })
      .toBuffer();
    if (out.length > LOGO_MAX_OUTPUT_BYTES) return null;
    return { body: out, type: 'image/png' };
  } catch {
    return null;
  }
}

/** brand.mjs'in fetcher sozlesmesi -> safe-fetch (gorsel ikili, CSS metin) */
export function safeBrandFetcher(deps: Pick<BrandDeps, 'fetchText' | 'fetchBinary'> = {}): BrandFetcher {
  const fetchText = deps.fetchText ?? safeFetchText;
  const fetchBinary = deps.fetchBinary ?? safeFetchBinary;
  return async (url, { maxBytes, accept }) => {
    if (accept.startsWith('image')) {
      const r = await fetchBinary(url, { maxBytes, timeoutMs: 8_000, maxRedirects: 3 });
      return { url: r.url, contentType: r.contentType, body: r.body };
    }
    const r = await fetchText(url, { maxBytes, accept, timeoutMs: 10_000, maxRedirects: 3 });
    if (!r.ok) throw new SafeFetchError('http', `HTTP ${r.status}`);
    if (r.truncated) throw new SafeFetchError('too_large', `${maxBytes} bayt sinirini asti`);
    return { url: r.url, contentType: r.contentType, body: Buffer.from(r.text, 'utf8') };
  };
}

/** safe-fetch sinyal almiyor: iptalde beklemeyi birak (indirme kendi 15 sn siniriyla biter) */
export function raceSignal<T>(p: Promise<T>, signal?: AbortSignal | null): Promise<T> {
  if (!signal) return p;
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error('iptal edildi'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new Error('iptal edildi'));
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => { signal.removeEventListener('abort', onAbort); resolve(v); },
      (e) => { signal.removeEventListener('abort', onAbort); reject(e); },
    );
  });
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Sitenin anasayfasindan marka. Hicbir hata disari sizmaz: okunamayan anasayfa ya da bozuk
 * logo yalniz `notes`'a yazilir, video sablon varsayilanlariyla uretilir.
 */
export async function extractSiteBrand(site: { url: string; name?: string | null }, deps: BrandDeps): Promise<SiteBrand> {
  const domain = hostOf(site.url);
  const fallbackName = (site.name ?? '').trim() || domain;
  const base: SiteBrand = { name: fallbackName, domain, primary: null, colorSource: 'yok', logoDataUri: null, logoSource: null, notes: [] };
  const fetchText = deps.fetchText ?? safeFetchText;
  let page: SafeTextResult;
  try {
    page = await raceSignal(fetchText(site.url, { maxBytes: HOMEPAGE_MAX_BYTES, timeoutMs: 15_000, maxRedirects: 5 }), deps.signal);
  } catch (err: any) {
    return { ...base, notes: [`anasayfa okunamadi: ${err instanceof SafeFetchError ? err.code : 'ag'} — ${String(err?.message ?? err).slice(0, 160)}`] };
  }
  if (!page.ok || !/html/i.test(page.contentType)) {
    return { ...base, notes: [`anasayfa okunamadi: HTTP ${page.status} ${page.contentType || ''}`.trim()] };
  }
  let b: ExtractedBrand;
  try {
    // compute: guvenilmeyen HTML/CSS ayristirmasi API'nin olay dongusunde DEGIL, is parcaciginda
    b = await deps.kit.extractBrand(page.text, page.url, {
      fetcher: safeBrandFetcher(deps),
      prepareLogo,
      compute: deps.compute ?? sandboxedBrandCompute,
      signal: deps.signal ?? null,
      ...(deps.deadlineMs ? { deadlineMs: deps.deadlineMs } : {}),
    });
  } catch (err: any) {
    return { ...base, notes: [`marka cikarilamadi: ${String(err?.message ?? err).slice(0, 160)}`] };
  }
  // Sayfadan gelen ad guvenilmeyen metindir: kirpilir, bossa site adi
  const name = String(b.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 60) || fallbackName;
  return {
    name,
    domain: b.domain || domain,
    primary: normalizeHexColor(b.primary),
    colorSource: b.colorSource,
    logoDataUri: b.logoDataUri && b.logoDataUri.startsWith('data:image/png;base64,') ? b.logoDataUri : null,
    logoSource: b.logo?.url ?? null,
    notes: b.notes.slice(0, 10),
  };
}

/** Kullanicinin duzeltmeleri (renk, logo kullan/kullanma, ad) markanin ustune */
export function applyBrandOverrides(
  brand: SiteBrand,
  o: { primaryColor?: string | null; useLogo?: boolean; brandName?: string | null } | null | undefined,
): SiteBrand {
  if (!o) return brand;
  const primary = o.primaryColor === null ? null : normalizeHexColor(o.primaryColor) ?? brand.primary;
  const name = typeof o.brandName === 'string' && o.brandName.trim() ? o.brandName.replace(/\s+/g, ' ').trim().slice(0, 60) : brand.name;
  return {
    ...brand,
    name,
    primary,
    colorSource: primary !== brand.primary ? 'kullanici' : brand.colorSource,
    logoDataUri: o.useLogo === false ? null : brand.logoDataUri,
  };
}
