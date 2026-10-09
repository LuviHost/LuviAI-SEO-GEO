/**
 * Hero görsel yer tutucusu — tek tanım.
 *
 * Yazar ajanının ESKİ şablonu her makaleye frontmatter'da
 * `hero_image: "placeholder-hero.webp"` ve gövdede `![Hero](placeholder-hero.webp)`
 * yazdırıyordu. Gerçek hero yayın anında publisher'da üretiliyor; satır ise
 * yalnızca publisher'da (QA'dan SONRA) siliniyordu. Sonuç:
 *   - QA kapısı satırı "doldurulmamış görsel" sayıp makaleyi BLOCKED yapıyordu
 *     (yalnızca "yine de yayınla" ile geçiliyordu),
 *   - JSON-LD `image` alanına göreli "placeholder-hero.webp" yazılıyordu.
 *
 * Şablon düzeltildi; bu modül eski makaleleri ve modelin yine de yazabileceği
 * satırı tek kuralla tanır. Diğer placeholder görseller (ör. placeholder-chart.png)
 * BURAYA GİRMEZ — onlar gerçekten doldurulmamış görseldir ve QA'da engel kalır.
 */

export const HERO_PLACEHOLDER_FILE = 'placeholder-hero.webp';

/** Gövdedeki hero yer tutucusu (publisher'ın tarihsel regex'iyle aynı eşleşme). */
export const HERO_PLACEHOLDER_MD_RE = /!\[[^\]]*\]\(\s*placeholder-hero\.webp\s*\)/gi;

/** Yalnızca yer tutucudan oluşan satır — boş satır bırakmamak için satırı komple siler. */
const HERO_PLACEHOLDER_LINE_RE = /^[ \t]*!\[[^\]]*\]\(\s*placeholder-hero\.webp\s*\)[ \t]*(?:\r?\n|$)/gim;

/** Markdown'dan hero yer tutucusunu kaldırır; başka hiçbir şeye dokunmaz. */
export function stripHeroPlaceholder(md: string): string {
  if (!md || !md.includes(HERO_PLACEHOLDER_FILE)) return md;
  return md.replace(HERO_PLACEHOLDER_LINE_RE, '').replace(HERO_PLACEHOLDER_MD_RE, '');
}

/** Frontmatter `hero_image` değeri yer tutucu mu? (göreli/mutlak yol farketmez) */
export function isHeroPlaceholder(value: unknown): boolean {
  return typeof value === 'string' && value.trim().toLowerCase().endsWith(HERO_PLACEHOLDER_FILE);
}

const ARTICLE_LD_TYPES = new Set(['Article', 'BlogPosting', 'NewsArticle', 'TechArticle']);

/**
 * JSON-LD düğümlerinde hero görselini düzeltir (yerinde değiştirir).
 *  - `image` yer tutucuysa → gerçek mutlak hero URL'i; hero yoksa alan silinir
 *    (göreli "placeholder-hero.webp" geçersiz bir image beyanıydı).
 *  - Article/BlogPosting düğümünde image hiç yoksa ve hero varsa eklenir.
 * Döner: değişen düğüm sayısı.
 */
export function applyHeroImageToJsonLd(nodes: unknown[], heroImageUrl: string | null): number {
  let changed = 0;
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    const n = node as Record<string, unknown>;
    if (isHeroPlaceholder(n.image)) {
      if (heroImageUrl) n.image = heroImageUrl;
      else delete n.image;
      changed++;
      continue;
    }
    const types = Array.isArray(n['@type']) ? n['@type'] : [n['@type']];
    if (heroImageUrl && n.image === undefined && types.some((t) => typeof t === 'string' && ARTICLE_LD_TYPES.has(t))) {
      n.image = heroImageUrl;
      changed++;
    }
  }
  return changed;
}
