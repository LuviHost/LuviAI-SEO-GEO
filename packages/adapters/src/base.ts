export interface PublishPayload {
  slug: string;
  title: string;
  bodyHtml: string;
  bodyMd: string;
  metaTitle?: string;
  metaDescription?: string;
  category?: string;
  heroImageUrl?: string;
  schemaMarkup?: Record<string, any>[];
}

export interface PublishCredentials {
  [key: string]: any;
}

export interface PublishResult {
  ok: boolean;
  externalUrl?: string;
  externalId?: string;
  error?: string;
}

/**
 * On-page meta uygulaması — D2+ snippet auto-fix için.
 * Adapter desteklemiyorsa undefined döner, çağıran taraf snippet copy-paste'e fallback yapar.
 */
export interface OnPageMetaPayload {
  pageUrl: string;          // hedef sayfanın canlı URL'i (post ID/slug çözümü için)
  metaTitle?: string;
  metaDescription?: string;
  canonical?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
  twitterCard?: 'summary' | 'summary_large_image';
  jsonLd?: Record<string, any>[];
}

export interface OnPageMetaResult {
  ok: boolean;
  applied: string[];        // ["metaTitle", "ogImage", ...]
  skipped: { field: string; reason: string }[];
  externalUrl?: string;
  error?: string;
}

export abstract class PublishAdapter {
  constructor(
    protected credentials: PublishCredentials,
    protected config: Record<string, any> = {},
  ) {}

  abstract publish(payload: PublishPayload): Promise<PublishResult>;
  abstract test(): Promise<boolean>;

  /**
   * Adapter destekliyorsa override eder; varsayılan implementasyon
   * "desteklenmiyor" döner. Çağıran taraf snippet copy-paste fallback yapar.
   */
  async applyOnPageMeta(_payload: OnPageMetaPayload): Promise<OnPageMetaResult> {
    return {
      ok: false,
      applied: [],
      skipped: [{ field: 'all', reason: 'Bu adapter on-page meta yazımını desteklemiyor — snippet panelinden copy-paste yap.' }],
    };
  }
}
