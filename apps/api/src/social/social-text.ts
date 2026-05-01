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
  /** Brain.brandVoice — voice-aware metin üretimi için. Yoksa default ton kullanılır. */
  brandVoice?: {
    tone?: string;
    bannedWords?: string[];
    signaturePhrases?: string[];
    offLimits?: string[];
    absencePatterns?: string[];
    pointOfView?: string;
  } | null;
  /** Topic-ranker'dan gelen hook varyasyonları — varsa ilk hook'u openinge kullan. */
  hookVariations?: Array<{ type: string; line1: string; line2: string }> | null;
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
export 
/**
 * voice-aware filtreleme (post-writer pattern — Charlie Hills's social-media-skills'ten adapte).
 * brandVoice.bannedWords + absencePatterns'a göre output temizlenir.
 * Basit string ops kullanılır — regex hassasiyeti gerekmez (taslak metin).
 */

/**
 * Topic-ranker'dan gelen hook_variations dizisinden uygun olanı seç.
 * Tier önceliği: contrarian > number_led > transformation > admission > authority_steal > future_shock.
 */


/**
 * voice-aware filtreleme (post-writer pattern — Charlie Hills's social-media-skills'ten adapte).
 * brandVoice.bannedWords + absencePatterns'a göre output temizlenir.
 */
function applyVoiceFilters(text: string, vc?: ArticleSnippet['brandVoice']): string {
  if (!vc) return text;
  let out = text;
  for (const w of vc.bannedWords ?? []) {
    if (!w || w.length < 2) continue;
    const lower = w.toLowerCase();
    let i = 0;
    while (i < out.length) {
      const idx = out.toLowerCase().indexOf(lower, i);
      if (idx === -1) break;
      out = out.slice(0, idx) + out.slice(idx + w.length);
      i = idx;
    }
  }
  const hasEmDashAbsence = (vc.absencePatterns ?? []).some((x) => typeof x === 'string' && (x.toLowerCase().includes('em dash') || x.toLowerCase().includes('em-dash') || x.includes('—')));
  if (hasEmDashAbsence) {
    out = out.split('—').join(' - ');
  }
  const hasClicheAbsence = (vc.absencePatterns ?? []).some((x) => typeof x === 'string' && (x.toLowerCase().includes('klise') || x.toLowerCase().includes('cliche') || x.toLowerCase().includes('generic')));
  if (hasClicheAbsence) {
    const cliches = ['günümüz dünyasında', 'günümüzde', 'unutmayalım', 'umarım yardımcı olmuştur', 'şunu unutmayalım'];
    for (const c of cliches) {
      out = out.split(c).join('');
    }
  }
  while (out.indexOf('  ') !== -1) out = out.split('  ').join(' ');
  return out.trim();
}

/**
 * Topic-ranker'dan gelen hook_variations dizisinden uygun olanı seç.
 * Tier önceliği: contrarian > number_led > transformation > admission > authority_steal > future_shock.
 */
function pickHookOpening(art: ArticleSnippet): string | null {
  const hv = art.hookVariations;
  if (!Array.isArray(hv) || hv.length === 0) return null;
  const order = ['contrarian', 'number_led', 'transformation', 'admission', 'authority_steal', 'future_shock'];
  for (const t of order) {
    const found = hv.find((h) => h?.type === t && h?.line1 && h?.line2);
    if (found) return found.line1 + '\n' + found.line2;
  }
  return null;
}
/**
 * post-writer pattern');
    out = out.replace(new RegExp('\\b' + escaped + '\\b', 'gi'), '');
  }

  // em-dash absence (standart)
  if ((vc.absencePatterns ?? []).some((x) => typeof x === 'string' && /em[\s-]?dash|—/i.test(x))) {
    out = out.split('—').join(' - ');
  }

  // klişe ifadeler
  if ((vc.absencePatterns ?? []).some((x) => typeof x === 'string' && /klise|cliche|generic|jenerik/i.test(x))) {
    const cliches = ['günümüz dünyasında', 'günümüzde', 'unutmayalım', 'umarım yardımcı olmuştur', 'şunu unutmayalım'];
    for (const c of cliches) {
      out = out.split(c).join('').split(c.toLowerCase()).join('');
    }
  }

  // çoklu boşlukları temizle
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * Topic-ranker'dan gelen hook_variations dizisinden uygun olanı seç.
 * Tier önceliği: contrarian > number_led > transformation > admission > authority_steal > future_shock.
 */

/**
 * post-writer pattern') + '\\b', 'gi');
    out = out.replace(re, '');
  }
  // em-dash absence pattern: standart bir replace
  if ((vc.absencePatterns ?? []).some((p) => /em.?dash|—/.test(p))) {
    out = out.replace(/—/g, ' - ');
  }
  // generic clichés ('günümüz dünyasında' vs)
  if ((vc.absencePatterns ?? []).some((p) => /klişe|cliche|generic/i.test(p))) {
    const cliches = [/g[üu]n[üu]m[üu]z d[üu]nyas[ıi]nda/i, /unutmayal[ıi]m/i, /umar[ıi]m yard[ıi]mc[ıi] olmu[şs]tur/i];
    for (const re of cliches) out = out.replace(re, '');
  }
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * post-writer pattern (Charlie Hills social-media-skills'ten adapte):
 *   - Voice-aware: brandVoice.bannedWords + absencePatterns sansürlenir
 *   - Hook-aware: hookVariations[0] varsa açılış olarak kullanılır
 *   - signaturePhrases doğal yerleştirme
 */
function buildLinkedInText(art: ArticleSnippet): {
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
