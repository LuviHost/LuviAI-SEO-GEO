/**
 * Yayınlanan makalenin PUBLIC URL'ini üreten TEK kaynak.
 *
 * NEDEN AYRI DOSYA: Bu mantık iki yerde birden gerekiyor —
 *   1) pipeline.service.ts  → JSON-LD (Article.url + BreadcrumbList)
 *   2) publisher.service.ts → <link rel="canonical"> + og:url
 * Daha önce ikisi ayrı ayrı hesaplıyordu; pipeline düzeltilip publisher
 * düzeltilmeyince aynı sayfa şemada "/pratik-kobi-rehberi/x", canonical'da
 * "/blog/x" diyordu. kobipratik.com'da /blog yolu YOK, yani canonical 404'e
 * işaret ediyordu ve self-referencing canonical bozuluyordu. İki tüketici de
 * artık bu fonksiyonu çağırıyor; mantık tek yerde değişir.
 *
 * Sabit `/blog/<slug>.html` varsayımı yanlıştı: `.html` yalnızca dosya-tabanlı
 * hedeflerde (FTP/SFTP/cPanel) geçerli, `/blog` ise pek çok sitede hiç yok.
 * Yol, publish hedefinin config'inden gelir; hiç yoksa uydurma bir bölüm
 * segmenti eklenmez (`${base}/${slug}`).
 */

/**
 * Dosya-tabanli OLMAYAN hedeflerin yol oneki icin eski kural (degismedi): bastaki sunucu
 * kok dizini atilir, bolum kucuk harfe cevrilir. Bu hedeflerde onek bir URL yoludur
 * (or. kobipratik defaultPathPrefix), sunucu dosya yolu degil.
 */
const SERVER_ROOT_RE = /^\/?(public_html|htdocs|www|var\/www\/html)\/?/i;

/** Sadece bu hedef tipleri gerçekten `.html` uzantılı dosya yazar. */
const FILE_BASED_TARGETS = new Set(['FTP', 'SFTP', 'CPANEL_API']);

/**
 * Dosya hedefinin klasor yolunda sitenin kok dizinini (document root) gosteren parcalar.
 * Klasor yolu bu parcaya kadar (dahil) URL'e girmez. Yaygin barindirma duzenleri:
 *  - cPanel: /home/<kullanici>/public_html; DirectAdmin: /home/<kullanici>/domains/<alan>/public_html
 *  - Plesk: /var/www/vhosts/<alan>/httpdocs
 *  - Debian/Ubuntu Apache: /var/www/html; nginx ornekleri: /var/www/<alan>/html
 *  - XAMPP/SUSE: htdocs; IIS/Azure: wwwroot; bazi paylasimli barindirmalar: www
 * Iki kaynak (2026-10-20'de okundu): support.plesk.com "What is the Plesk Virtual Host
 * Structure on Linux" + plesk.com/blog "Website Directory Structure" (httpdocs);
 * forum.directadmin.com "API doc_root of domain" + feedback.directadmin.com (domains/<alan>/public_html).
 */
const WEB_ROOT_SEGMENTS: ReadonlySet<string> = new Set(['public_html', 'htdocs', 'httpdocs', 'wwwroot', 'www', 'html']);

/**
 * Bu parcayla baslayan yol bir sunucu dosya sistemi yoludur (FTP oturum dizinine goreli
 * bir site klasoru degil): /home/<kullanici>/..., /var/..., /srv/... Kok parcasi yoksa
 * sayfanin adresi bilinmez.
 */
const FILESYSTEM_TOP = /^(?:home\d*|var|srv|usr|opt|mnt|root|data|users|~)$/i;

/** www'siz, kucuk harf alan adi (klasor adinin site alan adi olup olmadigi icin) */
const hostKey = (h: string) => h.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');

/**
 * Dosya hedefinin klasor yolundan sitedeki bolum yolu (bas/son egik cizgisiz; kok ise '').
 * Adres kurulamiyorsa null.
 *
 * NEDEN: eskiden yalniz BASTAKI kok dizini (public_html, htdocs, www, var/www/html) atiliyor
 * ve bolum kucuk harfe cevriliyordu. SFTP formunun ornek yolu /home/user/public_html/blog
 * oldugu icin adres https://site.com/home/user/public_html/blog/yazi.html oluyordu; ayni sey
 * /var/www/site.com/public_html/blog icin de gecerliydi; public_html/Rehber ise /rehber/...
 * (buyuk/kucuk harf duyarli sunucuda 404) veriyordu. Bu adres site haritasi, llms dosyalari,
 * persona sohbeti, JSON-LD ve yayincinin sayfaya yazdigi canonical icin TEK kaynak ve dosya
 * kopyasi canli gorulmeden emekliye ayrilmadigi icin yanlis adres suresiz ilan ediliyordu.
 * Simdi:
 *  - yolun SON kok parcasina kadar (dahil) her sey atilir ('/var/www' bir kok degil, sanal
 *    sunucularin ust dizinidir; sitenin alan adini tasiyan klasor de kok sayilir: cPanel
 *    eklenti alanlari /home/<kullanici>/<alan>, nginx /var/www/<alan>);
 *  - klasorun harfleri korunur (sunucu dosya adlarinda buyuk/kucuk harf ayirir);
 *  - kok parcasi olmayan dosya sistemi yolunda (/home/..., /var/...) adres TAHMIN EDILMEZ:
 *    null (hicbir sey ilan edilmez). '/blog', 'blog' gibi FTP oturum dizinine goreli
 *    klasorler eskisi gibi /blog'dur.
 */
function fileTargetSection(prefix: string, base: string): string | null {
  const parts = prefix.split('/').filter((p) => p !== '' && p !== '.');
  let siteHost = '';
  try { siteHost = hostKey(new URL(base).hostname); } catch { siteHost = ''; }
  let rootAt = -1;
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    const lower = p.toLowerCase();
    const webRoot = WEB_ROOT_SEGMENTS.has(lower) && !(lower === 'www' && parts[i - 1]?.toLowerCase() === 'var');
    if (webRoot || (siteHost !== '' && hostKey(p) === siteHost)) {
      rootAt = i;
      break;
    }
  }
  if (rootAt < 0 && parts.length > 0 && FILESYSTEM_TOP.test(parts[0])) return null;
  return parts.slice(rootAt + 1).join('/');
}

export interface ArticleUrlTarget {
  type?: string | null;
  config?: unknown;
}

export interface ResolvedArticleUrl {
  /**
   * Tam public URL — canonical, og:url ve JSON-LD için aynı değer. null: dosya hedefinin
   * klasor yolundan sitedeki adres cikarilamadi (fileTargetSection); adres ilan edilmez.
   */
  url: string | null;
  /** Bölüm yolu (ör. "/pratik-kobi-rehberi") — kırıntı için; yoksa null. */
  sectionPath: string | null;
}

/**
 * @param baseUrl Sitenin public kökü (site.url). Sondaki `/` temizlenir.
 * @param slug    Makale slug'ı.
 * @param target  Varsayılan/aktif publish hedefi (yoksa null geçilebilir).
 */
export function resolveArticleUrl(
  baseUrl: string,
  slug: string,
  target: ArticleUrlTarget | null | undefined,
): ResolvedArticleUrl {
  const base = String(baseUrl ?? '').replace(/\/+$/, '');

  let prefix = '';
  let ext = '';
  let fileTarget = false;
  if (target) {
    const cfg = (target.config ?? {}) as Record<string, any>;
    // Adapter'ların gerçekten okuduğu anahtarlar (kobipratik.ts:230,
    // ftp/sftp/cpanel-api: remotePath).
    prefix = String(cfg.defaultPathPrefix ?? cfg.pathPrefix ?? cfg.remotePath ?? '');
    fileTarget = FILE_BASED_TARGETS.has(String(target.type));
    if (fileTarget) ext = '.html';
  }

  let section: string;
  if (fileTarget) {
    const found = fileTargetSection(prefix, base);
    if (found === null) return { url: null, sectionPath: null };
    section = found;
  } else {
    section = prefix.replace(SERVER_ROOT_RE, '').replace(/^\/+|\/+$/g, '').toLowerCase();
  }
  const articlePath = section ? `/${section}/${slug}${ext}` : `/${slug}${ext}`;

  return {
    url: `${base}${articlePath}`,
    sectionPath: section ? `/${section}` : null,
  };
}
