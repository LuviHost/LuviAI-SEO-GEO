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

/** URL'e girmemesi gereken sunucu kök dizinleri (remotePath bunları içerebilir). */
const SERVER_ROOT_RE = /^\/?(public_html|htdocs|www|var\/www\/html)\/?/i;

/** Sadece bu hedef tipleri gerçekten `.html` uzantılı dosya yazar. */
const FILE_BASED_TARGETS = new Set(['FTP', 'SFTP', 'CPANEL_API']);

export interface ArticleUrlTarget {
  type?: string | null;
  config?: unknown;
}

export interface ResolvedArticleUrl {
  /** Tam public URL — canonical, og:url ve JSON-LD için aynı değer. */
  url: string;
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
  if (target) {
    const cfg = (target.config ?? {}) as Record<string, any>;
    // Adapter'ların gerçekten okuduğu anahtarlar (kobipratik.ts:230,
    // ftp/sftp/cpanel-api: remotePath).
    prefix = String(cfg.defaultPathPrefix ?? cfg.pathPrefix ?? cfg.remotePath ?? '');
    prefix = prefix.replace(SERVER_ROOT_RE, '');
    if (FILE_BASED_TARGETS.has(String(target.type))) ext = '.html';
  }

  const section = prefix.replace(/^\/+|\/+$/g, '').toLowerCase();
  const articlePath = section ? `/${section}/${slug}${ext}` : `/${slug}${ext}`;

  return {
    url: `${base}${articlePath}`,
    sectionPath: section ? `/${section}` : null,
  };
}
