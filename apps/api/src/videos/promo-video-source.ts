import { isIP } from 'node:net';
import sharp from 'sharp';
import { safeFetchBinary, safeFetchText, SafeFetchError, type SafeFetchOptions, type SafeFetchResult, type SafeTextOptions, type SafeTextResult } from '../common/safe-fetch.js';
import { registrableDomain } from '../audit/host-match.js';
import { runInWorker } from './brand-sandbox.js';
import {
  PRODUCT_IMAGE_MAX_BYTES, PRODUCT_IMAGE_MAX_CANDIDATES, PRODUCT_IMAGE_MAX_INPUT_PIXELS, PRODUCT_IMAGE_MAX_OUTPUT_BYTES,
  PRODUCT_IMAGE_MAX_PX, PRODUCT_IMAGE_MIN_PX, PROMO_PAGE_MAX_BYTES, PROMO_PAGE_URL_MAX,
} from './article-video.config.js';
import type { PageSource, PromoProfile, PromoSource, PromoType } from './article-short-kit.js';

/**
 * RanksUp Video — site ve urun tanitim videolarinin KAYNAGI (sayfa, gorsel, marka profili).
 *
 * KURALLAR
 *  - Urun sayfasi YALNIZ sitenin kendi alan adinda olabilir (ayni kayitli alan adi: www, alt
 *    alan adlari dahil; IP adresi, baska alan adi, kimlik bilgili adres reddedilir). Yonlendirme
 *    de alan adinin disina cikamaz: her yonlendirme hedefi istek ATILMADAN denetlenir
 *    (safe-fetch allowRedirect), son adres de ayrica denetlenir.
 *  - Indirme SSRF korumali (common/safe-fetch.ts): ozel/yerel IP yok, DNS baglanti aninda, boyut
 *    ve sure tavani.
 *  - Ayristirma (guvenilmeyen HTML) API/worker olay dongusunde DEGIL: brand-sandbox worker_thread,
 *    sert sure siniri (page.mjs dogrusal desenler + girdi tavani; bu ikinci savunma).
 *  - Urun gorseli guvenilmeyen ikilidir: SVG hic kabul edilmez (betik/harici kaynak riski yok),
 *    raster sharp ile piksel tavaniyla cozulur ve en fazla 1280 px JPEG/PNG'ye cevrilir.
 */

/** Kullaniciya gosterilecek (Turkce) kaynak hatasi */
export class PromoSourceError extends Error {
  constructor(public readonly userMessage: string, detail?: string) {
    super(detail ?? userMessage);
  }
}

export const OTHER_HOST_MESSAGE = 'Ürün sayfası sitenin kendi alan adında olmalı (ör. alt alan adları dahil aynı site). Başka bir sitenin adresinden video üretilemez.';

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return null;
  }
}

/** Iki adres ayni siteye mi ait: ayni kayitli alan adi (blog.ornek.com.tr = ornek.com.tr), IP hic degil */
export function sameSiteHost(candidateHost: string, siteUrl: string): boolean {
  const site = hostOf(siteUrl);
  const host = candidateHost.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!site || !host || isIP(host) || isIP(site)) return false;
  const reg = registrableDomain(site);
  // Kayitli alan adinin kendisi ya da onun alt alan adi ("kotu-ornek.com" "ornek.com" ile bitse de sayilmaz)
  return registrableDomain(host) === reg && (host === reg || host.endsWith(`.${reg}`));
}

/**
 * Kullanicinin girdigi urun sayfasi adresini denetle ve normallestir (istekte, ag yok).
 * Hata: PromoSourceError (Turkce mesaj, 400).
 */
export function assertOwnSitePageUrl(raw: unknown, siteUrl: string): string {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) throw new PromoSourceError('Ürün ya da hizmet sayfasının adresini gir.');
  if (text.length > PROMO_PAGE_URL_MAX) throw new PromoSourceError('Sayfa adresi çok uzun.');
  // Baska sema (ftp:, javascript:, data:) acikca reddedilir; "siten.com:443/x" gibi port sema sayilmaz
  if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(text) && !/^https?:\/\//i.test(text)) throw new PromoSourceError('Yalnız http ya da https adresleri kabul edilir.');
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    throw new PromoSourceError('Sayfa adresi geçerli değil. Tam adresi yapıştır (ör. https://siten.com/urun).');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new PromoSourceError('Yalnız http ya da https adresleri kabul edilir.');
  if (u.username || u.password) throw new PromoSourceError('Sayfa adresi kullanıcı adı ya da şifre içeremez.');
  if (u.port && u.port !== '80' && u.port !== '443') throw new PromoSourceError('Sayfa adresi standart bir port kullanmalı.');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) throw new PromoSourceError('IP adresiyle değil, sitenin alan adıyla gir.');
  if (!sameSiteHost(host, siteUrl)) throw new PromoSourceError(OTHER_HOST_MESSAGE, `alan adi disi: ${host}`);
  u.hash = '';
  return u.toString();
}

export interface PromoFetchDeps {
  fetchText?: (url: string, opts?: SafeTextOptions) => Promise<SafeTextResult>;
  fetchBinary?: (url: string, opts?: SafeFetchOptions) => Promise<SafeFetchResult>;
  /** Saf ayristirma nerede calisir; varsayilan worker_thread + sert sure (brand-sandbox.ts) */
  compute?: (op: string, args: unknown[]) => Promise<unknown>;
}

/**
 * Sitenin kendi sayfasini indir. Yonlendirme alan adinin disina cikamaz; HTML degilse ya da
 * okunamazsa PromoSourceError.
 */
export async function fetchOwnPage(url: string, siteUrl: string, deps: PromoFetchDeps = {}): Promise<SafeTextResult> {
  const fetchText = deps.fetchText ?? safeFetchText;
  let page: SafeTextResult;
  try {
    page = await fetchText(url, {
      maxBytes: PROMO_PAGE_MAX_BYTES,
      timeoutMs: 15_000,
      maxRedirects: 5,
      allowRedirect: (next) => sameSiteHost(next.hostname, siteUrl),
    });
  } catch (err: any) {
    if (err instanceof SafeFetchError && err.code === 'redirect' && /Izin verilmeyen/.test(err.message)) {
      throw new PromoSourceError('Sayfa başka bir alan adına yönlendiriyor; yalnız sitenin kendi sayfalarından video üretilir. Video hakkın iade edildi.', err.message);
    }
    throw new PromoSourceError('Sayfa okunamadı (bağlantı kurulamadı ya da zaman aşımı). Video hakkın iade edildi.', `${err instanceof SafeFetchError ? err.code : 'ag'}: ${String(err?.message ?? err).slice(0, 200)}`);
  }
  // Ikinci savunma: son adres de sitenin alan adinda olmali
  const finalHost = hostOf(page.url);
  if (!finalHost || !sameSiteHost(finalHost, siteUrl)) {
    throw new PromoSourceError('Sayfa başka bir alan adına yönlendiriyor; yalnız sitenin kendi sayfalarından video üretilir. Video hakkın iade edildi.', `son adres alan adi disi: ${finalHost}`);
  }
  if (!page.ok) throw new PromoSourceError(`Sayfa okunamadı (HTTP ${page.status}). Adresin herkese açık olduğundan emin ol. Video hakkın iade edildi.`);
  if (!/html/i.test(page.contentType)) throw new PromoSourceError('Adres bir web sayfası değil (HTML bekleniyordu). Video hakkın iade edildi.', `icerik turu: ${page.contentType}`);
  return page;
}

/** Sayfa ayristirma (page.mjs extractPage) — is parcaciginda, sert sure siniriyla */
export async function extractPromoPage(html: string, url: string, kind: PromoType, deps: PromoFetchDeps = {}): Promise<PageSource> {
  const compute = deps.compute ?? ((op: string, args: unknown[]) => runInWorker(op, args));
  try {
    return (await compute('page', [html, url, { kind }])) as PageSource;
  } catch (err: any) {
    throw new PromoSourceError('Sayfanın içeriği okunamadı; video üretilemedi. Video hakkın iade edildi.', `sayfa ayristirma: ${String(err?.message ?? err).slice(0, 200)}`);
  }
}

/**
 * Urun gorseli: guvenilmeyen ikili -> en fazla 1280 px JPEG (saydamlik varsa PNG); olmazsa null.
 * SVG reddedilir (icindeki betik / harici kaynak videoya hic tasinmaz), ICO/GIF animasyon tek kare.
 */
export async function prepareProductImage(body: Buffer, type: string): Promise<{ body: Buffer; type: string; width: number; height: number } | null> {
  const t = String(type ?? '').toLowerCase();
  if (/svg|icon/.test(t)) return null;
  const head = body.subarray(0, 512).toString('utf8');
  if (/<svg[\s>]|<\?xml/i.test(head)) return null;
  try {
    const img = sharp(body, { limitInputPixels: PRODUCT_IMAGE_MAX_INPUT_PIXELS, failOn: 'error', animated: false });
    const meta = await img.metadata();
    if (meta.format === 'svg') return null;
    if (!meta.width || !meta.height || meta.width < PRODUCT_IMAGE_MIN_PX || meta.height < PRODUCT_IMAGE_MIN_PX) return null;
    const resized = img.rotate().resize(PRODUCT_IMAGE_MAX_PX, PRODUCT_IMAGE_MAX_PX, { fit: 'inside', withoutEnlargement: true });
    const out = meta.hasAlpha
      ? await resized.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true })
      : await resized.jpeg({ quality: 84, mozjpeg: true }).toBuffer({ resolveWithObject: true });
    if (out.data.length > PRODUCT_IMAGE_MAX_OUTPUT_BYTES) return null;
    return { body: out.data, type: meta.hasAlpha ? 'image/png' : 'image/jpeg', width: out.info.width, height: out.info.height };
  } catch {
    return null;
  }
}

export interface ProductImage { dataUri: string; source: string; width: number; height: number }

/** Adaylari sirayla dene (Product image > og:image); hata disari sizmaz, notlara yazilir */
export async function fetchProductImage(candidates: string[], deps: PromoFetchDeps = {}, notes: string[] = []): Promise<ProductImage | null> {
  const fetchBinary = deps.fetchBinary ?? safeFetchBinary;
  for (const url of candidates.slice(0, PRODUCT_IMAGE_MAX_CANDIDATES)) {
    try {
      const r = await fetchBinary(url, { maxBytes: PRODUCT_IMAGE_MAX_BYTES, timeoutMs: 10_000, maxRedirects: 3, accept: /^image\// });
      const prepared = await prepareProductImage(r.body, r.contentType);
      if (!prepared) {
        notes.push(`gorsel kullanilamadi (svg, cok kucuk, bozuk ya da cok buyuk): ${url.slice(0, 160)}`);
        continue;
      }
      return { dataUri: `data:${prepared.type};base64,${prepared.body.toString('base64')}`, source: r.url, width: prepared.width, height: prepared.height };
    } catch (err: any) {
      notes.push(`gorsel indirilemedi (${err instanceof SafeFetchError ? err.code : 'ag'}): ${url.slice(0, 160)}`);
    }
  }
  return null;
}

/** Brain (onboarding'de uretilen marka profili) + Site -> metin baglami. Sayi kaynagi DEGIL. */
export function profileFromBrain(
  site: { url: string; niche?: string | null; customNiche?: string | null },
  brain: { brandVoice?: unknown; sitePages?: unknown } | null | undefined,
): PromoProfile | null {
  const bv = (brain?.brandVoice && typeof brain.brandVoice === 'object' ? brain.brandVoice : {}) as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
  const summary = str(bv.brandPromise, 300) || str(bv.summary, 300) || str(bv.tagline, 300) || null;
  const niche = str(site.customNiche, 60) || str(site.niche, 40) || null;
  const pages: Array<{ title: string; url: string }> = [];
  for (const p of Array.isArray(brain?.sitePages) ? (brain!.sitePages as unknown[]).slice(0, 200) : []) {
    if (pages.length >= 20) break;
    const row = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>;
    const title = str(row.title, 120) || str(row.h1, 120);
    const url = str(row.url, 500);
    const host = hostOf(url);
    // Taranan sayfa basliklari sitenin kendi metni; baska alan adindan gelen satir alinmaz
    if (title && host && sameSiteHost(host, site.url)) pages.push({ title, url });
  }
  if (!summary && !niche && pages.length === 0) return null;
  return { niche, summary, pages };
}

/** Sayfa + tur + profil -> metin adiminin kaynagi. lang: sitenin kayitli dili onceliklidir. */
export function buildPromoSource(page: PageSource, opts: { type: PromoType; siteUrl: string; siteLanguage?: string | null; profile: PromoProfile | null }): PromoSource {
  const lang = opts.siteLanguage === 'tr' || opts.siteLanguage === 'en' ? opts.siteLanguage : page.lang === 'en' ? 'en' : 'tr';
  let siteUrl = opts.siteUrl;
  try {
    siteUrl = new URL(opts.siteUrl).toString();
  } catch {
    /* bozuk site adresi: oldugu gibi */
  }
  return { ...page, lang, type: opts.type, siteUrl, profile: opts.type === 'site' ? opts.profile : null };
}
