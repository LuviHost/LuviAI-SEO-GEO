import type { PublishTargetType } from '@prisma/client';

/**
 * RanksUp disi takili sayfa — duzenlenmis sayfa HTML'i sitenin sunucusuna
 * ne zaman OTOMATIK yazilabilir? (saf fonksiyonlar; ag istegi yok)
 *
 * NEDEN: eski akis sayfanin TAMAMINI (baslik, menu, alt bilgi, betikler)
 * `bodyHtml` olarak adaptor.publish'e veriyordu. WordPress / KobiPratik /
 * ozel PHP hedeflerinde bu, yazinin ICERIGININ yerine koca bir HTML belgesi
 * koymak demekti (Gutenberg blok yapisi da gider). Tam sayfayi yazmak yalniz
 * sunucuya gercek .html dosyasi yazan hedeflerde (FTP / SFTP / cPanel) dogru;
 * orada da ancak yazilacak dosya, sayfayi sunan dosyanin TA KENDISIYSE.
 * Eski kod dosya yolunu URL'nin son parcasindan tahmin ediyordu (yazi.html.html,
 * /yazi/ icin yazi.html) ve sayfa bir CMS'ten geliyorsa sunucuya yazilan dosya
 * canli sayfayi golgeleyip donduracakti.
 *
 * Kural: sayfa otomatik YALNIZ su durumda yazilir —
 *  1. Sitede FTP / SFTP / cPanel yayin hedefi var ve icerigi bir CMS'ten gelen
 *     hedef / platform / sayfa izi yok;
 *  2. Sayfa adresi, hedef klasoru altindaki tek bir .html dosyasina esleniyor
 *     (RanksUp makale adresleriyle ayni esleme: articles/article-url.util.ts);
 *  3. O dosyanin adresi okunuyor ve okunan sayfayla BIREBIR ayni, statik dosya
 *     isaretleri tasiyor (staticFileProblem — servis yazmadan hemen once sorar).
 * Diger her durumda oneri kaydedilir, kullanici elle uygular.
 */

/** Sunucuya gercek .html dosyasi yazan hedefler (adaptorler `${remotePath}/${slug}.html` yazar) */
export const STATIC_FILE_TARGET_TYPES: readonly PublishTargetType[] = ['FTP', 'SFTP', 'CPANEL_API'];

/** Icerigi bir CMS'ten, uygulamadan ya da kaynak depodan gelen hedefler — sayfa sunucuda bir dosya degildir */
export const CONTENT_MANAGED_TARGET_LABELS: Partial<Record<PublishTargetType, string>> = {
  WORDPRESS_REST: 'WordPress',
  WORDPRESS_XMLRPC: 'WordPress',
  KOBIPRATIK: 'KobiPratik',
  CUSTOM_PHP: 'Özel PHP uç noktası',
  WEBFLOW: 'Webflow',
  GHOST: 'Ghost',
  STRAPI: 'Strapi',
  SANITY: 'Sanity',
  CONTENTFUL: 'Contentful',
  WHMCS_KB: 'WHMCS',
  GITHUB: 'GitHub deposu',
};

/** sites/platform-detector.service.ts tahminleri: bunlar sayfayi dinamik uretir */
const CMS_PLATFORM_LABELS: Record<string, string> = {
  wordpress: 'WordPress',
  webflow: 'Webflow',
  wix: 'Wix',
  ghost: 'Ghost',
  shopify: 'Shopify',
  squarespace: 'Squarespace',
};

/** Sayfa HTML'inde CMS izi (platform-detector ile ayni isaretler + yaygin acik kaynak CMS'ler) */
const HTML_CMS_SIGNS: Array<[RegExp, string]> = [
  [/\/wp-content\/|\/wp-includes\/|wp-emoji/i, 'WordPress'],
  [/cdn\.shopify\.com|Shopify\.theme/, 'Shopify'],
  [/static\.wixstatic\.com|wix-code/i, 'Wix'],
  [/data-wf-(?:site|page)=|w-mod-js/i, 'Webflow'],
  [/ghost-foundation|\/ghost\/api\//i, 'Ghost'],
  [/squarespace-cdn\.com/i, 'Squarespace'],
  [/\/media\/jui\/|\/media\/system\/js\//i, 'Joomla'],
  [/Drupal\.settings|drupal-settings-json|\/sites\/default\/files\//i, 'Drupal'],
  [/prestashop/i, 'PrestaShop'],
  [/catalog\/view\/(?:theme|javascript)\//i, 'OpenCart'],
  [/\/static\/version\d+\/frontend\/|Magento_/i, 'Magento'],
];

const GENERATOR_CMS = /(wordpress|joomla|drupal|ghost|wix|webflow|squarespace|shopify|prestashop|opencart|typo3|magento|blogger|hubspot)/i;

/**
 * Nedenin sonuna eklenen elle uygulama yonergesi — varsayilan takili sayfa
 * akisinin. Ayni kurallari kullanan diger yazicilar (static-html-fixer:
 * snippet ve gorsel alt metni) kendi ekranlarina uyan yonergeyi `manualHint`
 * ile verir; esleme ve dogrulama kurallari ayni kalir.
 */
const MANUAL = "Öneriler kaydedildi; Takılı Sayfalar ekranında Detay'dan görüp sayfana elle uygula.";

/** Sayfayi bir CMS mi uretiyor? (etiket ya da null). Yanlis pozitif guvenli yondedir: yalniz otomatik yazim atlanir. */
export function cmsFromHtml(html: string): string | null {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    if (!/name\s*=\s*["']?generator/i.test(m[0])) continue;
    const g = GENERATOR_CMS.exec(m[0]);
    if (g) return g[1][0].toUpperCase() + g[1].slice(1).toLowerCase();
  }
  for (const [re, label] of HTML_CMS_SIGNS) if (re.test(html)) return label;
  return null;
}

/** NUL, satir sonu gibi kontrol karakterleri (0x00-0x1F, 0x7F) dosya adina girmez */
const hasControlChar = (s: string) => [...s].some((ch) => { const c = ch.charCodeAt(0); return c < 0x20 || c === 0x7f; });

/** www'siz, kucuk harf, sondaki noktasiz alan adi */
const hostKey = (h: string) => h.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');

/**
 * Sunucu kok dizini (URL'de yer almaz) — articles/article-url.util.ts ile ayni
 * kural, ama klasor sinirinda: 'wwwroot/blog' kok sayilmaz.
 */
const SERVER_ROOT_RE = /^\/?(?:public_html|htdocs|www|var\/www\/html)(?:\/|$)/i;

export interface StaticFileLocation {
  /** Sayfayi sundugu dogrulanacak dosyanin adresi (ornek: https://site.com/blog/yazi.html) */
  fileUrl: string;
  /** Adaptore verilecek klasor (config.remotePath yerine) */
  remoteDir: string;
  /** Uzantisiz dosya adi — adaptor `${remoteDir}/${slug}.html` yazar */
  slug: string;
}

/**
 * Sayfa adresini, statik hedefin yazacagi dosyaya esler.
 *   /blog/yazi.html → <remotePath>/yazi.html
 *   /blog/yazi/     → <remotePath>/yazi/index.html
 *   /blog/yazi      → <remotePath>/yazi.html (uzantisiz adres; dogrulama .html dosyasini okur)
 * Anasayfa, .html disi uzantilar, hedef klasorunun disindaki adresler ve
 * guvensiz yol parcalari eslenmez.
 */
export function locateStaticFile(input: { pageUrl: string; siteUrl: string | null; remotePath: unknown; manualHint?: string }): StaticFileLocation | { reason: string } {
  const manual = input.manualHint ?? MANUAL;
  const unsafe = { reason: `Sayfa adresi güvenli bir dosya yoluna çevrilemedi. ${manual}` };
  let u: URL;
  try { u = new URL(input.pageUrl); } catch { return unsafe; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return unsafe;

  let siteHost: string | null = null;
  try { siteHost = input.siteUrl ? new URL(input.siteUrl).hostname : null; } catch { /* gecersiz site adresi — asagida reddedilir */ }
  // Alt alan adi baska bir klasorden (hatta baska sunucudan) sunulabilir: yalniz sitenin kendi alan adi
  if (!siteHost || hostKey(u.hostname) !== hostKey(siteHost)) {
    return { reason: `Sayfa sitenin kendi alan adında değil (${u.hostname}); hangi dosyanın yazılacağı güvenle belirlenemedi. ${manual}` };
  }

  const path = u.pathname;
  if (path === '' || path === '/' || path.toLowerCase() === '/index.html') {
    return { reason: `Anasayfa otomatik yazılmaz (yanlış dosyanın üzerine yazma riski yüksek). ${manual}` };
  }
  let filePath: string;
  if (path.endsWith('.html')) filePath = path;
  else if (path.endsWith('/')) filePath = `${path}index.html`;
  else {
    const last = path.slice(path.lastIndexOf('/') + 1);
    const ext = /\.([A-Za-z0-9]{1,5})$/.exec(last);
    // .htm, .php, .HTML...: adaptor her zaman "<ad>.html" yazar — baska dosyayi degistiremez
    if (ext) return { reason: `Sayfa adresi bir .html dosyasına karşılık gelmiyor (.${ext[1]}); yayın hedefi yalnız .html dosyası yazabilir. ${manual}` };
    filePath = `${path}.html`;
  }

  const segs: string[] = [];
  for (const raw of filePath.split('/').slice(1)) {
    let d: string;
    try { d = decodeURIComponent(raw); } catch { return unsafe; }
    // Ust dizine cikma, bos parca, bolu/ters bolu ve kontrol karakteri yok
    if (!d || d === '.' || d === '..' || /[\\/]/.test(d) || hasControlChar(d)) return unsafe;
    segs.push(d);
  }

  const remotePath = typeof input.remotePath === 'string' ? input.remotePath.trim().replace(/\/+$/, '') : '';
  if (!remotePath) {
    return { reason: `Yayın hedefinde klasör (Remote path) tanımlı değil ya da kök dizin; sayfanın dosya yolu güvenle eşlenemedi. ${manual}` };
  }
  const section = remotePath.replace(SERVER_ROOT_RE, '').replace(/^\/+|\/+$/g, '');
  const sectionSegs = section ? section.split('/') : [];
  if (sectionSegs.some((s, i) => segs[i] !== s) || segs.length <= sectionSegs.length) {
    return {
      reason: `Sayfa, yayın hedefinin klasörüne (${remotePath} → /${section ? `${section}/` : ''}) karşılık gelen adreslerin dışında; sunucudaki dosya yolu güvenle eşlenemedi. ${manual}`,
    };
  }
  const rel = segs.slice(sectionSegs.length);
  const slug = rel[rel.length - 1].slice(0, -'.html'.length);
  if (!slug) return unsafe;
  return {
    fileUrl: `${u.protocol}//${u.host}${filePath}`,
    remoteDir: [remotePath, ...rel.slice(0, -1)].join('/'),
    slug,
  };
}

export type StaticWritePlan<T> =
  | { kind: 'write'; target: T; location: StaticFileLocation }
  | { kind: 'manual'; reason: string };

/**
 * Hedef secimi + esleme (ag istegi yok). `write` cikarsa servis dosya adresini
 * okuyup staticFileProblem ile dogrular; ancak sonra yazar.
 * @param targets sitenin AKTIF hedefleri, tercih sirasinda (varsayilan once)
 */
export function planStaticWrite<T extends { type: string; config?: unknown }>(input: {
  targets: T[];
  siteUrl: string | null;
  platform: string | null;
  pageUrl: string;
  html: string;
  manualHint?: string;
}): StaticWritePlan<T> {
  const manual = input.manualHint ?? MANUAL;
  const fileTargets = input.targets.filter((t) => (STATIC_FILE_TARGET_TYPES as readonly string[]).includes(t.type));
  const managed = input.targets
    .map((t) => CONTENT_MANAGED_TARGET_LABELS[t.type as PublishTargetType])
    .filter((l): l is string => !!l);

  if (fileTargets.length === 0) {
    if (managed.length > 0) {
      return {
        kind: 'manual',
        reason: `${managed[0]} ile yönetilen sayfalarda değişiklik otomatik yazılmaz: sayfanın tamamı (menü, alt bilgi, betikler) içeriğin yerine geçer ve sayfa yapısını bozar. ${manual}`,
      };
    }
    return {
      kind: 'manual',
      reason: `Otomatik yazım yalnız FTP, SFTP ya da cPanel yayın hedefiyle bağlı statik HTML sitelerde yapılır; bu sitede böyle bir yayın hedefi yok. ${manual}`,
    };
  }

  // Dosya hedefi kok dosyalar (robots.txt, sitemap) icin eklenmis olabilir; site yine bir CMS olabilir
  const cms = managed[0] ?? (input.platform ? CMS_PLATFORM_LABELS[input.platform] : undefined) ?? cmsFromHtml(input.html);
  if (cms) {
    return {
      kind: 'manual',
      reason: `Sayfa ${cms} tarafından üretiliyor; sunucuya HTML dosyası yazmak canlı sayfanın yerine geçip içeriğini dondurabilir, bu yüzden otomatik yazılmadı. ${manual}`,
    };
  }
  // Cloudflare kenar sunucusu HTML'e kendi betiklerini ekler (e-posta gizleme, Rocket Loader):
  // okunan metin sunucudaki dosya degil; geri yazilirsa eklemeler dosyaya kalici gecer
  if (/\/cdn-cgi\//i.test(input.html)) {
    return {
      kind: 'manual',
      reason: `Sayfa Cloudflare tarafından değiştirilerek sunuluyor (/cdn-cgi/ eklemeleri); okunan HTML sunucudaki dosyayla aynı olmadığı için geri yazılmadı. ${manual}`,
    };
  }

  const target = fileTargets[0];
  const location = locateStaticFile({
    pageUrl: input.pageUrl,
    siteUrl: input.siteUrl,
    remotePath: (target.config as Record<string, unknown> | null | undefined)?.remotePath,
    manualHint: input.manualHint,
  });
  if ('reason' in location) return { kind: 'manual', reason: location.reason };
  return { kind: 'write', target, location };
}

/** Dosya adresinin okunmus yaniti (safeFetchText sonucu) ya da okuma hatasi */
export type StaticFileProbe =
  | {
      ok: boolean;
      status: number;
      url: string;
      redirected: boolean;
      contentType: string;
      headers: Record<string, string>;
      text: string;
      truncated: boolean;
      binary: boolean;
    }
  | { error: string };

/** CDN'lerin her yanita ekledigi cerezler — sayfanin dinamik oldugunu gostermez */
const CDN_COOKIES = new Set(['__cf_bm', '__cflb', '_cfuvid', 'cf_clearance']);

function setCookieNames(header: string | undefined): string[] {
  if (!header) return [];
  // Birlesik basliklar ", " ile ayrilir; Expires degerindeki virgul ad-deger cifti baslatmaz
  return [...header.matchAll(/(?:^|,\s*)([^=;,\s]+)=/g)].map((m) => m[1]);
}

/**
 * Dosya adresi sayfayi BIREBIR sunan statik bir dosya mi? Sorun yoksa null,
 * varsa kullaniciya gosterilecek neden. Ayni okuma, sayfanin onerinin
 * hazirlandigi sure icinde degismedigini de dogrular (degistiyse yeni hali
 * eski hal uzerine kurulmus HTML ile ezilmez).
 */
export function staticFileProblem(probe: StaticFileProbe, fileUrl: string, pageText: string, manualHint: string = MANUAL): string | null {
  const why = (detail: string) =>
    `Sayfanın sunucudaki statik bir dosyadan geldiği doğrulanamadı (${detail}); yanlış dosyanın üzerine yazmamak için otomatik yazılmadı. ${manualHint}`;
  let path = fileUrl;
  try { path = new URL(fileUrl).pathname; } catch { /* adres zaten dogrulandi — ham hali yazilir */ }
  if ('error' in probe) return why(probe.error);
  let sameUrl = false;
  try { sameUrl = new URL(probe.url).href === new URL(fileUrl).href; } catch { /* asagida yonlendirme sayilir */ }
  if (probe.redirected || !sameUrl) return why(`${path} başka bir adrese yönlendiriyor`);
  if (!probe.ok) return why(`${path} HTTP ${probe.status} döndü`);
  if (probe.binary || probe.contentType !== 'text/html') return why(`${path} bir HTML sayfası değil`);
  if (probe.truncated) return why('dosya 2 MB okuma sınırını aşıyor');
  if (probe.text !== pageText) return why(`${path} içeriği okunan sayfayla aynı değil; sayfa dinamik üretiliyor ya da okunduktan sonra değişti`);
  if (!probe.headers['last-modified']) return why('sunucu dosya tarihini (Last-Modified) göndermiyor; yanıt dinamik üretiliyor olabilir');
  const cookies = setCookieNames(probe.headers['set-cookie']).filter((n) => !CDN_COOKIES.has(n));
  if (cookies.length > 0) return why(`yanıt çerez ayarlıyor (${cookies.slice(0, 3).join(', ')}); sayfa dinamik üretiliyor`);
  const poweredBy = probe.headers['x-powered-by'] ?? '';
  if (/php|asp\.net|express|next\.js|servlet|jsp|django|rails|perl|python/i.test(poweredBy)) {
    return why(`yanıt bir uygulama sunucusundan geliyor (X-Powered-By: ${poweredBy.slice(0, 40)})`);
  }
  return null;
}
