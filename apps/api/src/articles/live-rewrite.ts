import { articleContentHash, liveEntries } from './republish-policy.js';

/**
 * YAYINDAKI YAZININ YENIDEN YAZIMI — uretim hattinin (pipeline.service) canli
 * kaydi ezmeden once uyguladigi kurallar. Saf yardimcilar; testleri
 * live-rewrite.spec.ts ve pipeline-live-rewrite.spec.ts.
 *
 * NEDEN: hat, opts.articleId verilen kaydi uretimin sonunda tumden eziyordu:
 * LLM frontmatter'indan YENI slug (yayindaki adres degisir; dosya hedefleri
 * slug_changed diye reddeder, WordPress'te govdedeki JSON-LD olmayan bir adresi
 * gosterir), datePublished = bugun (ilk yayin tarihi kaybolur) ve yayindaki
 * metin hicbir yerde saklanmiyordu. Otomatik yeniden yazimda (icerik pivotu)
 * editorden gecmeyen taslak bile yayindaki yazinin metnini ve durumunu eziyordu.
 */

/** Yeniden yazimdan once okunan mevcut kayit */
export interface ExistingArticleRow {
  status?: unknown;
  slug: string;
  title?: string | null;
  metaTitle?: string | null;
  metaDescription?: string | null;
  bodyMd?: string | null;
  faqs?: unknown;
  schemaMarkup?: unknown;
  publishedAt?: Date | null;
  publishedTo?: unknown;
  agentOutputs?: unknown;
}

/** Mevcut kaydi okurken secilen alanlar (Prisma select) */
export const EXISTING_ARTICLE_SELECT = {
  status: true,
  slug: true,
  title: true,
  metaTitle: true,
  metaDescription: true,
  bodyMd: true,
  faqs: true,
  schemaMarkup: true,
  publishedAt: true,
  publishedTo: true,
  agentOutputs: true,
} as const;

/**
 * Kayit yayinda mi? Bilinen canli kopyasi var (publishedTo) ya da durumu
 * PUBLISHED (canli kopyasi kayitli olmayan eski yayin — yine adresi var).
 * Musteri tum kayitlari "unuttuysa" (forget) yazi artik yayinda sayilmaz.
 */
export function isLiveArticle(row: ExistingArticleRow): boolean {
  return liveEntries(row.publishedTo).length > 0 || row.status === 'PUBLISHED';
}

/**
 * Kayittaki metin canlida mi (en az bir canli kopyaya yazildi)?
 *  - Bir canli kaydin icerik izi kayit metninin iziyle ayniysa: evet.
 *  - Iz tasimayan eski kayitlarda: durum PUBLISHED ve hicbir kopya "elle
 *    guncelleme bekliyor" degilse evet (yayinci metni yazdiktan sonra PUBLISHED
 *    yapar; yeniden yazim READY_TO_PUBLISH / REVIZE_NEEDED'e ceker).
 * Hicbir hedefe yazilamayan yayin da yaziyi PUBLISHED'a dondurur (eski metinle
 * yayinda); o durumda kayit metni canlida DEGILDIR — isaretli kopya bunu soyler.
 */
export function rowTextIsLive(row: ExistingArticleRow): boolean {
  const entries = liveEntries(row.publishedTo);
  const hash = articleContentHash(row);
  if (entries.some((e) => e.contentHash === hash)) return true;
  if (row.status !== 'PUBLISHED') return false;
  if (entries.some((e) => typeof e.contentHash === 'string' && e.contentHash !== '')) return false;
  return !entries.some((e) => e.manualUpdatePending === true);
}

/** Yayindaki metnin goruntusu (agentOutputs.liveSnapshot) */
export interface LiveSnapshot {
  title: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  bodyMd: string | null;
  faqs: unknown;
  schemaMarkup: unknown;
  slug: string;
  /** Ilk yayin tarihi (ISO) */
  publishedAt: string | null;
  /** Goruntunun alindigi an (ISO) — yeniden yazimin kaydi ezdigi an */
  takenAt: string;
}

export function liveSnapshotOf(row: ExistingArticleRow, takenAt: string): LiveSnapshot {
  return {
    title: row.title ?? null,
    metaTitle: row.metaTitle ?? null,
    metaDescription: row.metaDescription ?? null,
    bodyMd: row.bodyMd ?? null,
    faqs: row.faqs ?? null,
    schemaMarkup: row.schemaMarkup ?? null,
    slug: row.slug,
    publishedAt: row.publishedAt instanceof Date ? row.publishedAt.toISOString() : null,
    takenAt,
  };
}

function objectOrEmpty(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/**
 * Yeniden yazim kaydi ezerken saklanacak canli metin. Kayit metni canlidaysa
 * onun goruntusu alinir; degilse (onaydaki, hic yayinlanmamis bir yeniden yazim
 * ezilecek) ONCEKI goruntu korunur — yoksa yazilmaz: canlida olmayan metne
 * "yayindaki metin" demek yanlis olurdu.
 */
export function snapshotToKeep(row: ExistingArticleRow, takenAt: string): LiveSnapshot | null {
  if (rowTextIsLive(row)) return liveSnapshotOf(row, takenAt);
  const previous = objectOrEmpty(row.agentOutputs).liveSnapshot;
  return previous && typeof previous === 'object' && !Array.isArray(previous) ? (previous as LiveSnapshot) : null;
}

/** Yeni ajan ciktilari + korunan canli metin goruntusu */
export function agentOutputsWithLiveSnapshot(agentOutputs: Record<string, unknown>, row: ExistingArticleRow, takenAt: string): Record<string, unknown> {
  const snapshot = snapshotToKeep(row, takenAt);
  return snapshot ? { ...agentOutputs, liveSnapshot: snapshot } : agentOutputs;
}

/** Otomatik yeniden yazimda editorden gecmeyen taslagin ozeti (agentOutputs.rejectedRewrite) */
export interface RejectedRewrite {
  /** Deneme ani (ISO) — icerik pivotu bu tarihten sonraki 30 gun yazinin yeniden yazimini denemez */
  at: string;
  topic: string;
  verdict: string;
  score: number | null;
  maxScore: number;
  title: string | null;
  wordCount: number;
  blockingIssues: string[];
  geoGateIssues: string[];
  totalCostUsd: number;
}

/** Yayindaki kaydin ajan ciktilarina reddedilen taslagin ozeti eklenir; geri kalan aynen kalir */
export function agentOutputsWithRejectedRewrite(existing: unknown, rejected: RejectedRewrite): Record<string, unknown> {
  return { ...objectOrEmpty(existing), rejectedRewrite: rejected };
}

/** Reddedilen otomatik yeniden yazimin tarihi (yoksa null) — icerik pivotunun bekleme suresi */
export function rejectedRewriteAt(agentOutputs: unknown): Date | null {
  const at = objectOrEmpty(objectOrEmpty(agentOutputs).rejectedRewrite).at;
  const t = typeof at === 'string' ? Date.parse(at) : Number.NaN;
  return Number.isFinite(t) ? new Date(t) : null;
}

/**
 * Frontmatter'da adres ve ilk yayin tarihi yayindaki yaziyla ayni kalir.
 * LLM yeniden yazimda yeni `slug` ve bugunku `date_published`'i yazar; kayit
 * slug'i korunsa da frontmatter (JSON alani ve govdedeki blok) baska bir adres
 * ve tarih soyluyordu — panelin "Markdown indir"i bu alani dosyaya basiyor,
 * musteri o dosyayi elle guncellemede kullanabilir. Yalniz bastaki
 * `---` blogundaki mevcut satirlar degistirilir; yeni satir eklenmez.
 */
export function keepLiveFrontmatter(
  bodyMd: string,
  frontmatter: Record<string, unknown>,
  live: { slug: string; publishedAt?: Date | null },
): { bodyMd: string; frontmatter: Record<string, unknown> } {
  const date = live.publishedAt instanceof Date ? live.publishedAt.toISOString().slice(0, 10) : null;
  const fm: Record<string, unknown> = { ...frontmatter, slug: live.slug };
  if (date && frontmatter.date_published !== undefined) fm.date_published = date;

  const lines = bodyMd.split('\n');
  if (!/^---\s*$/.test(lines[0] ?? '')) return { bodyMd, frontmatter: fm };
  const end = lines.findIndex((l, i) => i > 0 && /^---\s*$/.test(l));
  if (end < 0) return { bodyMd, frontmatter: fm };
  const setValue = (line: string, key: string, value: string): string => {
    const m = line.match(new RegExp(`^(${key}\\s*:\\s*)(["']?)`));
    if (!m) return line;
    const quote = m[2];
    return `${m[1]}${quote}${value}${quote}`;
  };
  for (let i = 1; i < end; i++) {
    if (/^slug\s*:/.test(lines[i])) lines[i] = setValue(lines[i], 'slug', live.slug);
    else if (date && /^date_published\s*:/.test(lines[i])) lines[i] = setValue(lines[i], 'date_published', date);
  }
  return { bodyMd: lines.join('\n'), frontmatter: fm };
}

/** Canli adresin bolum yolu (BreadcrumbList ara kirintisi icin): son parca haric yol; yoksa null */
export function sectionPathOf(url: string): string | null {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return null;
  }
  const segments = path.split('/').filter(Boolean);
  return segments.length > 1 ? `/${segments.slice(0, -1).join('/')}` : null;
}
