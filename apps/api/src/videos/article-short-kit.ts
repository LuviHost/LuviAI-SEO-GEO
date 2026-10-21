import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * RanksUp Video — apps/video paketindeki ArticleShort modullerinin (CLI prototipiyle ORTAK)
 * tipli yukleyicisi.
 *
 * NEDEN dinamik import: metin koruyucusu (copy.mjs), makale ayristirici (extract.mjs), marka
 * cikarici (brand.mjs), tanitim videolarinin sayfa ayristiricisi (page.mjs) ve metni (promo-copy.mjs),
 * render hatti (render/article-short.mjs) TEK KAYNAK olarak apps/video
 * altinda duruyor; CLI de ayni dosyalari kullaniyor. Kopyasini buraya TypeScript olarak almak
 * bu projede defalarca yasanan "iki tablo kaydi" hatasini davet ederdi (sema, sinirlar, sayi
 * korumasi ayrisir). Yol derleme zamaninda cozulmez (nest build / tsc dokunmaz); calisma
 * aninda src/ (vitest) ve dist/ (uretim) ikisinden de apps/video'ya ayni goreli yolla ulasilir.
 *
 * VIDEO_APP_DIR ortam degiskeni yalniz farkli bir yerlesim icin (varsayilan: apps/video).
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const VIDEO_APP_DIR = process.env.VIDEO_APP_DIR || path.resolve(HERE, '../../../video');

export interface ShortBlock { type: 'heading' | 'p' | 'li'; level?: number; text: string; raw: string; label?: boolean; mark?: boolean; pseudo?: boolean }
export interface ShortSection { heading: string | null; items: ShortBlock[] }
export interface ShortArticle {
  url: string;
  domain: string;
  title: string;
  h1: string | null;
  description: string;
  image: string | null;
  section: string | null;
  dateModified: string | null;
  lang: string | null;
  bodyVia: string;
  blocks: ShortBlock[];
  sections: ShortSection[];
  /** sayi/olgu koruyucusu icin YALNIZ makalenin kendi metni */
  sourceText: string;
}

export interface ShortPoint { title: string; detail?: string }
export interface ShortScript {
  version: number;
  strategy: 'extractive' | 'llm';
  lang: string;
  hook: string;
  hookSub?: string;
  kicker?: string;
  points: ShortPoint[];
  cta: { label: string; domain: string; url?: string };
  evidence: Array<{ field: string; source: string; via: string }>;
}
export interface ScriptCheck { ok: boolean; errors: string[]; warnings: string[]; novelRatio: number }

export interface CopyKit {
  SCRIPT_VERSION: number;
  LLM_MODEL: string;
  MAX_NOVEL_RATIO: number;
  SYSTEM_PROMPT: string;
  SCRIPT_JSON_SCHEMA: Record<string, unknown>;
  apiSchema(schema?: Record<string, unknown>): Record<string, unknown>;
  extractiveScript(article: ShortArticle): ShortScript;
  normalizeLlmScript(raw: unknown, article: ShortArticle): ShortScript;
  validateScript(script: unknown, article: ShortArticle, opts?: { strict?: boolean }): ScriptCheck;
  llmUserContent(article: ShortArticle): string;
}

export interface ExtractKit {
  extractArticle(html: string, pageUrl: string): ShortArticle;
}

export interface BrandFetchResult { url: string; contentType: string; body: Buffer }
export type BrandFetcher = (url: string, opts: { maxBytes: number; accept: string; signal?: AbortSignal | null }) => Promise<BrandFetchResult>;
/** Saf ayristirma hesaplayicisi: 'analyze' (HTML) | 'cssColor' (CSS). Sunucuda worker_thread (brand-sandbox.ts) */
export type BrandCompute = (op: string, args: unknown[]) => Promise<unknown>;
export interface ExtractedBrand {
  name: string;
  domain: string;
  primary: string | null;
  colorSource: string;
  logo: { url: string; rel: string; type: string; sourceType: string; bytes: number } | null;
  logoDataUri: string | null;
  notes: string[];
}
export interface BrandKit {
  extractBrand(html: string, pageUrl: string, opts: {
    fetcher: BrandFetcher;
    prepareLogo?: (body: Buffer, type: string) => Promise<{ body: Buffer; type: string } | null>;
    /** cagiranin iptali (render isinin toplam suresi) */
    signal?: AbortSignal | null;
    /** tum cikarimin son tarihi; varsayilan BRAND_DEADLINE_MS (30 sn) */
    deadlineMs?: number;
    compute?: BrandCompute;
  }): Promise<ExtractedBrand>;
  MAX_LOGO_CANDIDATES: number;
  BRAND_DEADLINE_MS: number;
}

/* ── site / urun tanitim videolari (scripts/article-short/page.mjs + promo-copy.mjs) ── */

export type PromoType = 'site' | 'product';
export interface PagePrice { verified: boolean; display?: string; value?: number; currency?: string | null; sources: string[]; reason?: string }
export interface PageSource {
  kind: PromoType;
  url: string;
  domain: string;
  lang: string | null;
  title: string;
  ogTitle: string | null;
  h1: string | null;
  description: string;
  siteName: string | null;
  organization: { name: string | null; description: string | null; slogan: string | null } | null;
  product: { name: string; description: string; brand: string | null; category: string | null; structured: boolean; type: string | null } | null;
  breadcrumb: string | null;
  images: string[];
  price: PagePrice;
  bodyVia: string;
  blocks: ShortBlock[];
  sections: ShortSection[];
  pairs: Array<{ label: string; value: string; raw: string; boring: boolean }>;
  sourceText: string;
  truncated: boolean;
}
/** Marka profili (DB: Brain + Site) — kelime baglami; sayi kaynagi DEGIL (promo-copy.mjs) */
export interface PromoProfile { niche: string | null; summary: string | null; pages: Array<{ title: string; url: string }> }
export interface PromoSource extends PageSource {
  type: PromoType;
  /** sitenin kok adresi (site tanitiminda CTA) */
  siteUrl: string;
  profile: PromoProfile | null;
}
export interface PromoScript extends Omit<ShortScript, 'strategy'> {
  type: PromoType;
  strategy: 'extractive' | 'llm';
}
export interface PageKit {
  extractPage(html: string, pageUrl: string, opts?: { kind?: PromoType }): PageSource;
  MAX_PAGE_HTML_CHARS: number;
}
export interface PromoCopyKit {
  PROMO_LIMITS: Record<string, number>;
  PROMO_SYSTEM_PROMPTS: Record<PromoType, string>;
  PROMO_JSON_SCHEMA: Record<string, unknown>;
  promoApiSchema(): Record<string, unknown>;
  extractivePromoScript(source: PromoSource, type?: PromoType): PromoScript;
  normalizePromoLlm(raw: unknown, source: PromoSource, type?: PromoType): PromoScript;
  validatePromoScript(script: unknown, source: PromoSource, opts?: { strict?: boolean }): ScriptCheck;
  promoUserContent(source: PromoSource): string;
  shortUrl(url: string, max?: number): string;
  verifyPriceText(display: unknown, source: PromoSource): boolean;
}

export interface PromoVideoProps {
  hook: string;
  hookSub?: string;
  kicker?: string;
  points: ShortPoint[];
  cta: { label: string; domain: string; url?: string };
  brand: { name: string; domain: string; primary?: string; logoUrl?: string };
  /** yalniz urun: data:image/jpeg|png (sharp ile cevrilmis) */
  image?: string;
  /** yalniz urun ve yalniz iki kaynakla dogrulanmis fiyat */
  price?: string;
  muted?: boolean;
  watermark?: boolean;
}

export interface ArticleShortProps {
  hook: string;
  hookSub?: string;
  kicker?: string;
  points: ShortPoint[];
  cta: { label: string; domain: string; url?: string };
  brand: { name: string; domain: string; primary?: string; logoUrl?: string };
  sourcePath?: string;
  muted?: boolean;
  watermark?: boolean;
}

export interface RenderResult {
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  bytes: number;
  posterBytes: number;
  concurrency: number;
  bundle: 'memory' | 'disk' | false;
  inputLufs: number | null;
  timings: Record<string, number>;
  compositionId?: string;
}
export interface RenderKit {
  renderConcurrency(env?: NodeJS.ProcessEnv, cores?: number): number;
  renderArticleShort(opts: {
    props: ArticleShortProps | PromoVideoProps;
    /** VIDEO_COMPOSITIONS kimligi; varsayilan 'ArticleShort' */
    compositionId?: string;
    outFile: string;
    posterFile: string;
    concurrency?: number;
    onProgress?: (progress: number) => void;
    /** isin toplam suresi: kesilince Remotion Chrome'u ve ffmpeg oldurulur, gecici dosyalar silinir */
    signal?: AbortSignal | null;
  }): Promise<RenderResult>;
}

const cache = new Map<string, Promise<unknown>>();
function load<T>(rel: string): Promise<T> {
  const file = path.join(VIDEO_APP_DIR, rel);
  if (!cache.has(file)) {
    const p = import(pathToFileURL(file).href);
    // Basarisiz yukleme (dosya yok, sozdizimi) onbellekte kalmasin: sonraki is yeniden dener
    p.catch(() => cache.delete(file));
    cache.set(file, p);
  }
  return cache.get(file) as Promise<T>;
}

export const loadCopyKit = () => load<CopyKit>('scripts/article-short/copy.mjs');
export const loadExtractKit = () => load<ExtractKit>('scripts/article-short/extract.mjs');
export const loadBrandKit = () => load<BrandKit>('scripts/article-short/brand.mjs');
export const loadRenderKit = () => load<RenderKit>('render/article-short.mjs');
export const loadPageKit = () => load<PageKit>('scripts/article-short/page.mjs');
export const loadPromoCopyKit = () => load<PromoCopyKit>('scripts/article-short/promo-copy.mjs');
