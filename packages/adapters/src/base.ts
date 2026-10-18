export interface PublishPayload {
  slug: string;
  title: string;
  bodyHtml: string;
  bodyMd: string;
  metaTitle?: string;
  metaDescription?: string;
  category?: string;
  heroImageUrl?: string;
  /** Hero alt metni — WordPress'te medya alt_text'e yazilir (one cikan gorsel bunu basar) */
  heroImageAlt?: string;
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
  /**
   * Hedefin KENDI son degisiklik damgasi, RanksUp'in bu yaziminin hemen
   * ardindan (ISO, UTC). Yalniz destekleyen adaptor doldurur (WordPress:
   * modified_gmt). Yayinci publishedTo kaydina remoteModifiedAt diye yazar;
   * sonraki yerinde guncelleme "yazi o zamandan beri hedefte degisti mi"
   * sorusunu ayni saatle (hedefin saati) yanitlar.
   */
  remoteModifiedAt?: string;
}

/**
 * Yayindaki kaydin hedefteki adresi: yazinin publishedTo girdisinde saklanan
 * yayin sonucu (externalId / externalUrl). Yerinde guncelleme kaydi bununla bulur.
 */
export interface LiveEntryRef {
  externalId?: string;
  externalUrl?: string;
  /** Kayittaki remoteModifiedAt: RanksUp'in son basarili yaziminin yanitindaki hedef damgasi (ISO) */
  remoteModifiedAt?: string;
  /**
   * RanksUp'in bu kayda son yazim ani (ISO, RanksUp'in saati): publishedTo
   * updatedAt ?? publishedAt ?? makalenin publishedAt'i. remoteModifiedAt
   * olmayan (eski) kayitlarda cakisma denetimi buna saat payiyla bakar.
   */
  lastWriteAt?: string;
}

/** Yerinde guncelleme secenekleri */
export interface UpdateOptions {
  /**
   * Kullanici ACIKCA onayladi: kayit RanksUp'in son yaziminden sonra hedefte
   * degismis olsa da ustune yaz. Yalniz panelden gelen acik istek verir
   * (overwriteRemoteEdits); otomasyon (takili sayfa otopilotu, pivot, Tam
   * otomatik yayin) hicbir zaman vermez. Kimlik denetimi ve cop kutusu kurali
   * force ile de gecerlidir: baska bir yazinin uzerine hicbir durumda yazilmaz.
   */
  force?: boolean;
}

/**
 * Yerinde guncelleme sonucu. ok:false iken bayraklar cagiranin kararini verir:
 *  - notFound: kayit hedefte artik YOK (kalici silinmis) — yeni yayin kopya acmaz
 *  - trashed: kayit cop kutusunda — musteri bilerek kaldirmis, dokunulmadi
 *  - edited: kayit RanksUp'in son yaziminden sonra hedefte degismis — musterinin
 *    duzenlemesi ezilmedi (yalniz force ile yazilir)
 *  - mismatch: kayitli kimlik artik BU yaziya ait degil (slug / tur tutmuyor) —
 *    hicbir sey yazilmadi, kopya da acilmamali (force ile de yazilmaz)
 * Hicbiri yoksa (yetki, ag, beklenmeyen yanit) yeni kayit ACILMAMALI: kayit
 * hala yayinda olabilir ve yeni yayin ikinci bir kopya olur.
 */
export interface UpdateResult extends PublishResult {
  notFound?: boolean;
  trashed?: boolean;
  edited?: boolean;
  mismatch?: boolean;
  /** mismatch'te hedefteki kaydin slug'i (Turkce nedende gosterilir) */
  remoteSlug?: string;
  /** Hedefteki durum (WordPress: publish, draft, pending, private, future, trash) */
  status?: string;
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
 * Gorsel alt metni yazimi — onaylanmis alt'i musteri sitesine uygular.
 * Adapter desteklemiyorsa varsayilan "unsupported" doner; cagiran kopyala-
 * yapistir snippet'ine duser.
 */
export interface ImageAltPayload {
  /** Gorselin bulundugu sayfa (gonderi icerigi bu URL'den cozulur) */
  pageUrl: string;
  srcRaw: string;
  src: string;
  wpAttachmentId?: number | null;
  /** null = icerikteki alt attribute'unu KALDIR (geri alma; medyada '' yazilir) */
  alt: string | null;
  /** Medya kutuphanesi alt'i guncellensin mi (WordPress) */
  updateMedia: boolean;
  /** Gonderi/sayfa icerigindeki <img> etiketi guncellensin mi */
  updateContent: boolean;
  /**
   * Geri alma guvenligi: verilirse YALNIZCA mevcut alt bu degerse yazilir
   * (kullanici o arada elle degistirdiyse dokunulmaz).
   */
  expectCurrentAlt?: string;
}

export interface ImageAltResult {
  ok: boolean;
  /** 'media_library' | 'post_content' */
  applied: string[];
  skipped: { field: string; reason: string }[];
  /** Geri alma icin onceki degerler */
  previous?: {
    mediaId?: number;
    mediaAlt?: string | null;
    postId?: number;
    postType?: string;
    contentAlt?: string | null;
  };
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
   * Yayindaki kaydi YERINDE gunceller: yalniz baslik, govde ve ozet (verildiyse
   * yeni one cikan gorsel) degisir; adres (slug), durum, yazar, tarih ve
   * kategoriler oldugu gibi kalir.
   *
   * Desteklemeyen adaptor bu metodu TANIMLAMAZ; cagiran (PublisherService)
   * `typeof adapter.update === 'function'` ile bakar. NEDEN varsayilan govde
   * yok: CMS adaptorlerinin publish()'i her cagride YENI kayit acar (WordPress
   * /yazi-2/, Ghost / Strapi / Webflow POST...). "Guncelle" diye publish'e
   * dusen bir varsayilan, onlenmek istenen kopyayi sessizce yeniden acardi.
   *
   * Yazmadan once kayit dogrulanir: kimlik hala bu yaziya ait mi (mismatch) ve
   * kayit RanksUp'in son yaziminden sonra hedefte degisti mi (edited; yalniz
   * opts.force ile ustune yazilir).
   */
  update?(ref: LiveEntryRef, payload: PublishPayload, opts?: UpdateOptions): Promise<UpdateResult>;

  /**
   * Adapter destekliyorsa override eder; varsayılan implementasyon
   * "desteklenmiyor" döner. Çağıran taraf snippet copy-paste fallback yapar.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- varsayilan govde parametreyi kullanmaz; alt siniflar ayni imzayla override eder
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- varsayilan govde parametreyi kullanmaz
  async pushLlms(_payload: LlmsPushPayload): Promise<LlmsPushResult> {
    return { ok: false, skipped: 'unsupported' };
  }

  /**
   * Gorsel alt metni yaz. Varsayilan: desteklenmiyor (HTTP yapmaz). WordPress
   * override eder; dosya tabanli hedefler API tarafinda statik HTML yamasiyla
   * yazilir (static-html-fixer).
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- varsayilan govde parametreyi kullanmaz
  async applyImageAlt(_payload: ImageAltPayload): Promise<ImageAltResult> {
    return { ok: false, applied: [], skipped: [{ field: 'all', reason: 'unsupported' }] };
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
   * Bu adapter TAM bir HTML sayfası mı bekliyor (<!DOCTYPE html> + <head> + <style>),
   * yoksa CMS gövdesine girecek bir HTML PARÇASI mı?
   *
   * FTP / SFTP / cPanel / ZIP gibi dosya-tabanlı hedefler diske gerçek bir .html
   * dosyası yazar → tam sayfa gerekir (true).
   *
   * WordPress / Ghost / Shopify / Webflow / Strapi gibi CMS'ler içeriği kendi
   * temasının içine gömer → tam sayfa gönderilirse post gövdesine <style>,
   * ikinci bir <header> navigasyonu ve ikinci bir <footer> sızar; <style>
   * içindeki `body{...}` kuralı temanın tipografisini de ezer. Bu yüzden
   * varsayılan false ve publisher onlara sadece <article> gövdesini verir.
   */
  get needsFullPage(): boolean {
    return false;
  }

  /**
   * Sunucu köküne ham dosya yazar (robots.txt / llms.txt / sitemap.xml gibi).
   * publish()'ten farkı: `slug.html` DEĞİL — verilen dosya adı birebir, web root'a.
   * Yalnızca supportsRootFiles=true adapter'lar override eder; diğerleri net
   * yönlendirici hata döner.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- varsayilan govde parametreleri kullanmaz
  async putRootFile(_filename: string, _content: string, _contentType?: string): Promise<PublishResult> {
    return {
      ok: false,
      error: 'Bu hedef kök dosya (robots.txt / llms.txt / sitemap.xml) yazımını desteklemiyor. WordPress REST API kök dosya yazamaz — bu dosyalar için SFTP / FTP / cPanel publish target ekleyin.',
    };
  }
}
