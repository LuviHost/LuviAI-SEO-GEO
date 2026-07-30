export interface PublishPayload {
  slug: string;
  title: string;
  bodyHtml: string;
  bodyMd: string;
  metaTitle?: string;
  metaDescription?: string;
  category?: string;
  heroImageUrl?: string;
  // Hero görsel ham verisi — WordPress media'ya yükleyip featured image yapmak için.
  // PublisherService üretip base64 olarak geçer; adapter destekliyorsa kullanır.
  heroImageBase64?: string;
  heroImageFilename?: string;   // örn. "slug-hero.jpg"
  heroImageMime?: string;       // örn. "image/jpeg"
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

/**
 * llms.txt / llms-full.txt push — GEO/AI-SEO için site geneli AI özet dosyalarını
 * hedef siteye gönderir (kendi backend'i llms üretmiyorsa RanksUp besler).
 * Adapter desteklemiyorsa default impl `skipped: 'unsupported'` döner.
 */
export interface LlmsPushPayload {
  llmsTxt: string;          // kısa index (H1 + sayfa/makale linkleri)
  llmsFullTxt: string;      // tüm sitenin temizlenmiş içeriği (AI'lar bunu okur)
}

export interface LlmsPushResult {
  ok: boolean;
  skipped?: string;         // örn. 'unsupported', 'not_configured'
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

  /**
   * Adapter destekliyorsa override eder. Varsayılan: desteklenmiyor (no-op).
   * Çağıran taraf (publisher) tüm hedeflerde güvenle çağırabilir; desteklemeyen
   * adapter HTTP yapmadan `skipped: 'unsupported'` döner.
   */
  async pushLlms(_payload: LlmsPushPayload): Promise<LlmsPushResult> {
    return { ok: false, skipped: 'unsupported' };
  }

  /**
   * Bu adapter sunucu köküne GERÇEK dosya (robots.txt, llms.txt, sitemap.xml)
   * yazabiliyor mu? FTP / SFTP / cPanel gibi dosya-tabanlı adapter'lar → true.
   * WordPress REST gibi yalnızca-CMS adapter'lar → false (kök dosya yazamaz;
   * publish() çağrılırsa "robots.txt" başlıklı çöp bir post oluştururdu).
   */
  get supportsRootFiles(): boolean {
    return false;
  }

  /**
   * Sunucu köküne ham dosya yazar (robots.txt / llms.txt / sitemap.xml gibi).
   * publish()'ten farkı: `slug.html` DEĞİL — verilen dosya adı birebir, web root'a.
   * Yalnızca supportsRootFiles=true adapter'lar override eder; diğerleri net
   * yönlendirici hata döner.
   */
  async putRootFile(_filename: string, _content: string, _contentType?: string): Promise<PublishResult> {
    return {
      ok: false,
      error: 'Bu hedef kök dosya (robots.txt / llms.txt / sitemap.xml) yazımını desteklemiyor. WordPress REST API kök dosya yazamaz — bu dosyalar için SFTP / FTP / cPanel publish target ekleyin.',
    };
  }
}
