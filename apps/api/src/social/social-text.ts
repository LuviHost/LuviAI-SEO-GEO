/**
 * Sosyal medya metni uretimi — Faz 1 basit template.
 * Faz 2'de AI tabanli metin uretimi gelecek (09-social-writer ajani).
 */

const X_LIMIT = 280;
const LI_LIMIT = 3000;

export interface ArticleSnippet {
  title: string;
  metaDescription?: string | null;
  slug: string;
  siteUrl: string;       // https://luvihost.com.tr  (sadece domain) veya tam URL
  siteName?: string;
  pillar?: string | null;
  /**
   * `siteUrl` zaten makalenin tam yayinlanmis URL'iyse true gonder
   * (publisher'dan donen externalUrl gibi). false/undefined ise siteUrl +
   * pillar/blog + slug seklinde toplanir.
   */
  fullUrl?: boolean;
}

/**
 * X (Twitter) icin 280 char altinda metin uret.
 *
 * Yapi:
 *   "{title}
 *
 *   {ozet}
 *
 *   {url}"
 *
 * Karakter sayimi: t.co URL kisaltici 23 char olarak sayar — buyrak guvenli
 * yaklasim icin URL'yi 23'e isaretliyoruz.
 */
export function buildTwitterText(art: ArticleSnippet): {
  text: string;
  metadata: { link: string; hashtags?: string[] };
} {
  const url = buildPublicUrl(art);
  const urlCost = 23 + 2; // URL + iki newline
  const title = art.title.trim();

  let summary = (art.metaDescription ?? '').trim();
  if (summary === title) summary = '';

  const titleLine = title;
  let body = titleLine;

  // Ozet ekle (sigdigi kadar)
  if (summary) {
    const remaining = X_LIMIT - body.length - urlCost - 2; // 2 newline summary->url
    if (remaining > 30) {
      const trimmed = summary.length > remaining ? summary.slice(0, remaining - 3).trimEnd() + '...' : summary;
      body = `${titleLine}\n\n${trimmed}`;
    }
  }

  const text = `${body}\n\n${url}`;

  return {
    text,
    metadata: { link: url },
  };
}

/**
 * LinkedIn icin daha bol nefesli metin (3000 char limit). Faz 1 basit:
 * baslik + ozet + url + 2-3 hashtag.
 */
export function buildLinkedInText(art: ArticleSnippet): {
  text: string;
  metadata: { link: string };
} {
  const url = buildPublicUrl(art);
  const summary = (art.metaDescription ?? '').trim();
  const lines: string[] = [art.title.trim()];
  if (summary && summary !== art.title.trim()) {
    lines.push('', summary);
  }
  lines.push('', url);
  let text = lines.join('\n');
  if (text.length > LI_LIMIT) text = text.slice(0, LI_LIMIT - 3) + '...';
  return { text, metadata: { link: url } };
}

/**
 * Site URL + slug'dan public makale URL'i kur.
 * NOT: PublishTarget WordPress'e gonderildiyse oradan donen externalUrl daha
 * dogru. Bu fonksiyon fallback — auto-draft aninda site'in ana domain'ine
 * `/blog/<slug>` ekler.
 */
function buildPublicUrl(art: ArticleSnippet): string {
  if (art.fullUrl) return art.siteUrl;
  const base = art.siteUrl.replace(/\/+$/, '');
  // Pillar varsa onu kullan, yoksa /blog/
  const path = art.pillar?.startsWith('/') ? art.pillar : '/blog';
  return `${base}${path}/${art.slug}`;
}

/**
 * Kanal tipine gore text builder dispatcher.
 */
export function buildSocialTextFor(
  channelType: string,
  art: ArticleSnippet,
): { text: string; metadata: any } {
  switch (channelType) {
    case 'X_TWITTER':
      return buildTwitterText(art);
    case 'LINKEDIN_PERSONAL':
    case 'LINKEDIN_COMPANY':
      return buildLinkedInText(art);
    default:
      // Diger kanallar icin LinkedIn versiyonu fallback
      return buildLinkedInText(art);
  }
}
