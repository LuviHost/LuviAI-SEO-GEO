import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * RanksUp Video — apps/video paketindeki ArticleShort modullerinin (CLI prototipiyle ORTAK)
 * tipli yukleyicisi.
 *
 * NEDEN dinamik import: metin koruyucusu (copy.mjs), makale ayristirici (extract.mjs), marka
 * cikarici (brand.mjs) ve render hatti (render/article-short.mjs) TEK KAYNAK olarak apps/video
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
}
export interface RenderKit {
  renderConcurrency(env?: NodeJS.ProcessEnv, cores?: number): number;
  renderArticleShort(opts: {
    props: ArticleShortProps;
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
