/**
 * Yayin hedefi katalogu — panel formunun TEK kaynagi (GET /publish-targets/catalog).
 *
 * NEDEN AYRI DOSYA: adres denetimi (publish-target-url.ts) hata metnine formdaki
 * alan adini koyar ('Strapi URL', 'WHMCS URL'...). Etiketler buradan okunur;
 * katalog serviste dururken url.ts onu servisi (ve servis url.ts'i) iceri
 * alarak dongusel import kurmadan okuyamazdi. Ikinci bir sabit etiket listesi
 * ise katalogdan ayrisirdi (eskiden baseUrl her tipte 'Base URL' diyordu).
 *
 * Alan adlari adaptorlerle eslesik olmali: Ghost/Strapi/WHMCS adaptorleri bu
 * adlari ONCE, eski adlari (siteUrl, strapiUrl/apiToken/contentType,
 * whmcsUrl/identifier/secret) sonra okur (packages/adapters/src/credential-keys.ts;
 * eslesme tablosu asagida LEGACY_CREDENTIAL_KEYS). Adres alani adi degisirse
 * publish-target-url.ts CREDENTIAL_URL_FIELDS'e de eklenmeli —
 * publish-target-catalog.spec.ts bunu denetler.
 */

export type PublishTargetFieldType = 'text' | 'password' | 'number' | 'select' | 'textarea';

export interface PublishTargetCatalogField {
  key: string;
  label: string;
  type: PublishTargetFieldType;
  required?: boolean;
  placeholder?: string;
  hint?: string;
  default?: string | number;
  options?: Array<{ value: string; label: string }>;
}

export interface PublishTargetCatalogEntry {
  type: string;
  label: string;
  icon: string;
  description: string;
  /** Yalniz ADMIN gorur/ekler (servis ADMIN_ONLY_TARGET_TYPES ile de zorlar) */
  adminOnly?: boolean;
  fields: PublishTargetCatalogField[];
  configFields: PublishTargetCatalogField[];
}

/**
 * Eski kimlik alani adi → katalogdaki adi (hedef tipine gore).
 *
 * Adaptorler ikisini de okur: Ghost/Strapi/WHMCS katalog adini once
 * (credential-keys.ts pickString), cPanel `host ?? cpanelUrl`, SFTP ise
 * `username ?? user` — SFTP'de eski ad ONDE. Kimlik guncellemesi
 * (publish-target-credentials.ts) katalog adi yazilinca eski adli kopyayi
 * siler; adres hata metni eski adli alani formdaki adiyla anar.
 */
export const LEGACY_CREDENTIAL_KEYS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  GHOST: { siteUrl: 'apiUrl' },
  STRAPI: { strapiUrl: 'baseUrl', apiToken: 'token' },
  WHMCS_KB: { whmcsUrl: 'baseUrl', identifier: 'apiIdentifier', secret: 'apiSecret' },
  CPANEL_API: { cpanelUrl: 'host' },
  SFTP: { username: 'user' },
};

/** Her cagri yeni dizi doner — cagiran (filtre, yanit) paylasilan nesneyi bozmasin. */
export function publishTargetCatalog(): PublishTargetCatalogEntry[] {
  return [
    {
      type: 'WORDPRESS_REST',
      label: 'WordPress (REST API)',
      icon: '📝',
      description: 'WordPress sitenize App Password ile yayın yapın',
      fields: [
        { key: 'siteUrl', label: 'Site URL', type: 'text', placeholder: 'https://example.com', required: true },
        { key: 'username', label: 'Kullanıcı adı', type: 'text', required: true },
        { key: 'appPassword', label: 'App Password', type: 'password', required: true, hint: 'WP-Admin → Profil → Application Passwords' },
      ],
      configFields: [
        { key: 'postStatus', label: 'Yayın durumu', type: 'select', options: [{ value: 'publish', label: 'Yayında' }, { value: 'draft', label: 'Taslak' }], default: 'draft' },
        // WP REST `categories` tamsayi dizisi (class-wp-rest-posts-controller.php get_item_schema);
        // duzenleme ekraninin adresi term.php?...&tag_ID=<id> (wp-admin/term.php); bos → varsayilan
        // kategori (wp_insert_post: default_category). Gecerlilik: wordPressCategoryIds (adaptor).
        { key: 'categoryId', label: 'Kategori ID', type: 'text', placeholder: '12', hint: 'İsteğe bağlı. Kategorinin sayısal ID\'si: WP-Admin → Yazılar → Kategoriler\'de kategoriyi düzenlerken adres çubuğundaki tag_ID değeri. Birden fazlası için virgülle ayır (12,15). Boş bırakırsan WordPress varsayılan kategoriyi kullanır.' },
      ],
    },
    {
      type: 'WORDPRESS_XMLRPC',
      label: 'WordPress (XML-RPC)',
      icon: '📝',
      // REST hedefi uygulama sifresi ister: WordPress 5.6+ (application-passwords-integration-guide)
      description: 'Eski WordPress sürümleri (5.6 öncesi)',
      fields: [
        { key: 'siteUrl', label: 'Site URL', type: 'text', required: true },
        { key: 'username', label: 'Kullanıcı', type: 'text', required: true },
        { key: 'password', label: 'Şifre', type: 'password', required: true },
      ],
      configFields: [],
    },
    {
      type: 'FTP',
      label: 'FTP',
      icon: '🌐',
      description: 'Static HTML + FTP upload',
      fields: [
        { key: 'host', label: 'Host', type: 'text', required: true },
        { key: 'port', label: 'Port', type: 'number', default: 21 },
        { key: 'user', label: 'Kullanıcı', type: 'text', required: true },
        { key: 'password', label: 'Şifre', type: 'password', required: true },
      ],
      configFields: [
        { key: 'remotePath', label: 'Remote path', type: 'text', placeholder: '/public_html/blog', required: true },
      ],
    },
    {
      type: 'SFTP',
      label: 'SFTP / SSH',
      icon: '🔒',
      description: 'Static HTML + SSH key veya password',
      fields: [
        { key: 'host', label: 'Host', type: 'text', required: true },
        { key: 'port', label: 'Port', type: 'number', default: 22 },
        { key: 'user', label: 'Kullanıcı', type: 'text', required: true },
        { key: 'password', label: 'Şifre', type: 'password', hint: 'Veya privateKey kullan' },
        { key: 'privateKey', label: 'Private Key', type: 'textarea', hint: 'OpenSSH formatı (BEGIN OPENSSH PRIVATE KEY...)' },
      ],
      configFields: [
        { key: 'remotePath', label: 'Remote path', type: 'text', placeholder: '/home/user/public_html/blog', required: true },
      ],
    },
    {
      type: 'GITHUB',
      label: 'GitHub',
      icon: '🐙',
      description: 'Hugo, Jekyll, Astro, MDX siteler',
      fields: [
        { key: 'token', label: 'Personal Access Token', type: 'password', required: true, hint: 'repo scope yetkili PAT' },
        { key: 'owner', label: 'Owner / org', type: 'text', placeholder: 'kullaniciAdi', required: true },
        { key: 'repo', label: 'Repository', type: 'text', required: true },
        { key: 'branch', label: 'Branch', type: 'text', default: 'main' },
      ],
      configFields: [
        // Adaptor contentPath'i okur (eski kayitlarda path); bas/son "/" atilir (github.ts)
        { key: 'contentPath', label: 'İçerik klasörü', type: 'text', placeholder: 'content/posts', required: true, hint: 'Depo kökünden klasör yolu. Yazı bu klasöre <slug>.md olarak eklenir.' },
        { key: 'commitMessage', label: 'Commit mesaj şablonu', type: 'text', default: 'feat(blog): {title}', hint: '{title} yazının başlığıyla değiştirilir.' },
      ],
    },
    {
      type: 'CPANEL_API',
      label: 'cPanel API',
      icon: '🎛️',
      description: 'cPanel File Manager (token auth)',
      fields: [
        { key: 'host', label: 'cPanel host', type: 'text', placeholder: 'https://cpanel.example.com:2083', required: true },
        { key: 'username', label: 'Kullanıcı', type: 'text', required: true },
        { key: 'apiToken', label: 'API Token', type: 'password', required: true },
      ],
      configFields: [
        { key: 'remotePath', label: 'Hedef klasör', type: 'text', placeholder: '/public_html/blog', required: true },
        { key: 'publicBaseUrl', label: 'Public site URL', type: 'text', placeholder: 'https://luvihost.com', required: false, hint: 'Yayınlanan yazının canlı adresi bu adresten üretilir. Boş bırakırsan cPanel host alanından tahmin edilir. Adreste .html uzantısı yer almaz; bunun için sunucuda Apache MultiViews (.htaccess) açık olmalı.' },
      ],
    },
    {
      type: 'WEBFLOW',
      label: 'Webflow CMS',
      icon: '🎨',
      description: 'Webflow CMS Collection',
      fields: [
        { key: 'apiToken', label: 'API Token', type: 'password', required: true },
        { key: 'siteId', label: 'Site ID', type: 'text', required: true },
        { key: 'collectionId', label: 'Collection ID', type: 'text', required: true },
      ],
      configFields: [],
    },
    {
      type: 'SANITY',
      label: 'Sanity',
      icon: '✨',
      description: 'Headless CMS (Portable Text)',
      fields: [
        { key: 'projectId', label: 'Project ID', type: 'text', required: true },
        { key: 'dataset', label: 'Dataset', type: 'text', default: 'production' },
        { key: 'token', label: 'Editor Token', type: 'password', required: true },
      ],
      configFields: [],
    },
    {
      type: 'CONTENTFUL',
      label: 'Contentful',
      icon: '📚',
      description: 'Management API + auto publish',
      fields: [
        { key: 'spaceId', label: 'Space ID', type: 'text', required: true },
        { key: 'environmentId', label: 'Environment', type: 'text', default: 'master' },
        { key: 'managementToken', label: 'Management Token', type: 'password', required: true },
      ],
      configFields: [
        { key: 'contentTypeId', label: 'Content Type ID', type: 'text', placeholder: 'blogPost', required: true },
      ],
    },
    // Ghost/Strapi/WHMCS alan adlari: dosya basindaki not ve LEGACY_CREDENTIAL_KEYS.
    {
      type: 'GHOST',
      label: 'Ghost',
      icon: '👻',
      description: 'Ghost Admin API (JWT)',
      fields: [
        // https://docs.ghost.org/admin-api: istek tabani https://{admin_domain}/ghost/api/admin/
        { key: 'apiUrl', label: 'API URL', type: 'text', placeholder: 'https://demo.ghost.io', required: true, hint: 'Ghost Admin\'in açıldığı alan adı; /ghost/api/admin/ kısmını yazma.' },
        // Ayni kaynak: anahtar Integrations ekraninda Custom Integration ile uretilir, "id:secret"
        { key: 'adminApiKey', label: 'Admin API Key', type: 'password', required: true, hint: 'Ghost Admin → Integrations ekranında oluşturduğun Custom Integration\'ın Admin API Key\'i (id:secret).' },
      ],
      configFields: [],
    },
    {
      type: 'STRAPI',
      label: 'Strapi',
      icon: '🚀',
      description: 'Strapi 4+ REST API',
      fields: [
        { key: 'baseUrl', label: 'Strapi URL', type: 'text', placeholder: 'https://cms.example.com', required: true },
        { key: 'token', label: 'API Token', type: 'password', required: true },
      ],
      configFields: [
        // REST uclari /api/:pluralApiId (https://docs.strapi.io/cms/api/rest)
        { key: 'collection', label: 'Collection adı', type: 'text', placeholder: 'articles', required: true, hint: 'Koleksiyonun çoğul API kimliği (ör. articles → /api/articles).' },
      ],
    },
    {
      type: 'WHMCS_KB',
      label: 'WHMCS Bilgi Bankası',
      icon: '🛠️',
      description: 'WHMCS Knowledgebase makalesi',
      fields: [
        // Adaptor sonuna /includes/api.php ekler (whmcs-kb.ts)
        { key: 'baseUrl', label: 'WHMCS URL', type: 'text', placeholder: 'https://destek.example.com', required: true, hint: 'WHMCS\'in kurulu olduğu adres; /includes/api.php kısmını yazma.' },
        { key: 'apiIdentifier', label: 'API Identifier', type: 'text', required: true },
        { key: 'apiSecret', label: 'API Secret', type: 'password', required: true },
        // Adaptor accessKey'i zaten okuyordu ama formda alan yoktu. WHMCS API
        // varsayilan olarak IP ile kisitli; IP izni verilemiyorsa
        // configuration.php'deki $api_access_key 'accesskey' ile gonderilir
        // (https://developers.whmcs.com/api/access-control/).
        { key: 'accessKey', label: 'Erişim anahtarı (accesskey)', type: 'password', required: false, hint: 'İsteğe bağlı. WHMCS API varsayılan olarak IP ile kısıtlıdır; IP izni vermiyorsan configuration.php içindeki $api_access_key değerini gir.' },
      ],
      configFields: [
        { key: 'categoryId', label: 'KB Kategori ID', type: 'text', required: true },
      ],
    },
    {
      type: 'CUSTOM_PHP',
      label: 'Custom PHP',
      icon: '🔧',
      description: 'Kendi PHP API\'ınız + HMAC',
      fields: [
        { key: 'endpointUrl', label: 'Endpoint URL', type: 'text', required: true },
        { key: 'hmacSecret', label: 'HMAC Secret', type: 'password', required: true },
      ],
      configFields: [],
    },
    {
      type: 'MARKDOWN_ZIP',
      label: 'Markdown ZIP',
      icon: '📦',
      description: 'Manuel indir, kendin yükle (test için ideal)',
      fields: [],
      configFields: [],
    },
    {
      type: 'KOBIPRATIK',
      label: 'KobiPratik (Luvihost içi)',
      icon: '🏢',
      description: 'Luvihost grubu özel adapter — admin only. Path-bazlı PageMeta upsert (full SEO + GEO + body override).',
      adminOnly: true,
      fields: [
        { key: 'baseUrl', label: 'Base URL', type: 'text', placeholder: 'https://www.kobipratik.com', required: true, hint: 'Prod için www.kobipratik.com, dev için dev domain.' },
        { key: 'apiKey', label: 'RanksUp API Key', type: 'password', required: true, hint: 'kobipratik appsettings → RanksUp.ApiKey değeri (M2M Bearer token).' },
      ],
      configFields: [
        { key: 'defaultPathPrefix', label: 'Varsayılan yol öneki (isteğe bağlı)', type: 'text', placeholder: '/pratik-kobi-rehberi', hint: 'Slug bu önekin altına yazılır. Boş bırakırsan köke yazılır.' },
      ],
    },
  ];
}

/**
 * Formdaki alan etiketi (kimlik alanlari icin eski ad katalog adina cevrilir).
 * Katalogda yoksa undefined — cagiran genel etikete duser.
 */
export function catalogFieldLabel(
  type: string,
  key: string,
  section: 'fields' | 'configFields' = 'fields',
): string | undefined {
  const entry = publishTargetCatalog().find((c) => c.type === type);
  if (!entry) return undefined;
  const name = section === 'fields' ? (LEGACY_CREDENTIAL_KEYS[type]?.[key] ?? key) : key;
  return entry[section].find((f) => f.key === name)?.label;
}
