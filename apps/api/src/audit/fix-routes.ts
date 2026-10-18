/**
 * Audit sorunlari NASIL duzeltilir — tek kaynak (saf).
 *
 * NEDEN: `AuditIssue.fixable` "duzeltilebilir mi" diyordu ama NEREDE
 * duzeltildigini soylemiyordu. UI tum fixable sorunlarin checkId'lerini
 * auto-fix'e gonderiyordu; auto-fix ise yalnizca kok dosyalari uretebiliyor,
 * gerisini (meta_title, schema_markup, geo_*) SESSIZCE atliyordu — kullanici
 * yine "duzeltme uygulandi" toast'i goruyordu.
 *
 *   auto_fix → AutoFixService kok dosyayi onizler (mevcut + onerilen + fark),
 *              onaydan sonra yayin hedefine yazar; var olan dosyayi korur
 *   snippet  → Snippet araci (/sites/:id/snippet): uretilir, CMS'e uygulanir
 *              ya da kopyala-yapistir
 *   images   → Gorseller sayfasi (/sites/:id/images): alt metni oner/onayla/yaz
 *   manual   → otomatik yol yok (icerik/strateji isi)
 */

export type FixRoute = 'auto_fix' | 'snippet' | 'images' | 'manual';

/**
 * AutoFixService'in GERCEKTEN (onizlemeli, guvenli) uretebildigi anahtarlar →
 * kanonik dosya anahtari.
 *
 * agent_json ve auth_md 2026-10'da CIKARILDI: ikisi de musterinin sitesine
 * dogrulanmamis bilgi yayinliyordu (A2A ucu olmayan siteye ajan karti; auth.md'de
 * uydurma giris yolu, 2FA ve hiz siniri). Kontrolleri duruyor; auth.md icin
 * yer tutuculu elle kullanim sablonu sunulur, A2A karti icin yalniz rehber.
 */
const AUTO_FIX_CANONICAL: Record<string, RootFixKey> = {
  sitemap: 'sitemap',
  sitemap_xml: 'sitemap',
  robots: 'robots',
  robots_txt: 'robots',
  llms: 'llms',
  llms_txt: 'llms',
};

export type RootFixKey = 'robots' | 'sitemap' | 'llms';

/** Kanonik anahtar → site kokundeki dosya adi */
export const ROOT_FIX_FILENAME: Record<RootFixKey, string> = {
  robots: 'robots.txt',
  sitemap: 'sitemap.xml',
  llms: 'llms.txt',
};

/** Takma ad ('robots_txt') → kanonik anahtar ('robots'); uretilemeyen anahtarda null */
export function canonicalFixKey(key: string | null | undefined): RootFixKey | null {
  return isAutoFixKey(key) ? AUTO_FIX_CANONICAL[key as string] : null;
}

/** Snippet aracinin kapsadigi kontroller (snippet-generator SnippetType'larina karsilik) */
const SNIPPET_CHECKS = new Set([
  'meta_title',
  'meta_description',
  'canonical',
  'open_graph',
  'twitter_card',
  'schema_markup',
  'geo_faq',             // jsonld_faq
  'geo_definition',      // jsonld_defined_term
  'geo_citation_format', // citation_format
]);

/**
 * Kontrolu otomatik yola (auto_fix) dusen ama KENDISI otomatik duzeltilemeyen
 * sorun tipleri — rota checkId'den degil tipten gelir.
 *
 * NEDEN: robots-check.ts bu sorunlara fixable:false yaziyor; withFixRoutes ise
 * rotayi checkId'den (robots_txt → auto_fix) yeniden hesaplayip onu eziyordu.
 * Panel "otomatik duzeltilir" deyip robots onizlemesini aciyordu, oysa guvenli
 * birlestirme (robots-merge.ts) mevcut hicbir Disallow'u kaldirmaz: onizleme
 * engeli kaldiramaz. Engel bilincli bir tercih de olabilir — karar site
 * sahibinin. Egitim botu engeli (robots_ai_training_blocked) ayni nedenle
 * burada: o da yalniz Disallow kaldirilarak "duzelir".
 */
const MANUAL_ISSUE_TYPES = new Set(['robots_ai_search_blocked', 'robots_ai_training_blocked']);

export function isAutoFixKey(key: string | null | undefined): boolean {
  return !!key && Object.prototype.hasOwnProperty.call(AUTO_FIX_CANONICAL, key);
}

export function fixRouteFor(checkId: string | null | undefined): FixRoute {
  if (!checkId) return 'manual';
  if (isAutoFixKey(checkId)) return 'auto_fix';
  if (SNIPPET_CHECKS.has(checkId)) return 'snippet';
  if (checkId === 'image_alt') return 'images';
  return 'manual';
}

/**
 * Tek bir sorunun rotasi: once tip istisnasi (MANUAL_ISSUE_TYPES), sonra
 * kontrol anahtari. withFixRoutes ve sablon gruplamasi (issue-grouping.ts)
 * AYNI kurali kullanir — "Bu sablonu duzelt" ile sorun satiri ayrismasin.
 */
export function fixRouteForIssue(issue: { checkId?: string | null; type?: string | null }): FixRoute {
  if (issue.type && MANUAL_ISSUE_TYPES.has(issue.type)) return 'manual';
  return fixRouteFor(issue.checkId ?? issue.type);
}

/**
 * Auto-fix'e gelen anahtarlari ayirir: uretilebilenler (ayni dosyaya giden
 * takma adlar tekillestirilir — sitemap + sitemap_xml iki kez yuklenmesin) ve
 * uretilemeyenler (cagirana ACIKCA donulur, sessizce yutulmaz).
 */
export function partitionFixes(fixes: unknown): { supported: string[]; unsupported: string[] } {
  const list = Array.isArray(fixes) ? fixes.filter((f): f is string => typeof f === 'string' && f.length > 0) : [];
  const seenCanonical = new Set<string>();
  const supported: string[] = [];
  const unsupported: string[] = [];
  for (const f of list) {
    if (!isAutoFixKey(f)) {
      if (!unsupported.includes(f)) unsupported.push(f);
      continue;
    }
    const c = AUTO_FIX_CANONICAL[f];
    if (seenCanonical.has(c)) continue;
    seenCanonical.add(c);
    supported.push(f);
  }
  return { supported, unsupported };
}

/** Sorunlara rota ekler; fixable = otomatik ya da yonlendirilmis bir yol var mi. */
export function withFixRoutes<T extends { checkId?: string | null; type?: string; fixable?: boolean }>(
  issues: T[],
): Array<T & { fixRoute: FixRoute; fixable: boolean }> {
  return issues.map((i) => {
    const fixRoute = fixRouteForIssue(i);
    return { ...i, fixRoute, fixable: fixRoute !== 'manual' };
  });
}

/**
 * Sablon butonunun auto-fix'e gonderecegi anahtarlar: sablonun sorunlarindan
 * en az biri GERCEKTEN auto_fix rotasindaysa o checkId. Sorun listesi olmayan
 * cok eski kayitta yalniz anahtara bakilir.
 */
function templateAutoFixIds(t: { fixableCheckIds?: unknown; issues?: unknown }): string[] {
  const ids = Array.isArray(t.fixableCheckIds)
    ? t.fixableCheckIds.filter((id): id is string => typeof id === 'string' && fixRouteFor(id) === 'auto_fix')
    : [];
  if (!Array.isArray(t.issues)) return ids;
  const issues = t.issues as Array<{ checkId?: string | null; type?: string | null }>;
  return ids.filter((id) => issues.some((i) => (i?.checkId ?? i?.type) === id && fixRouteForIssue(i) === 'auto_fix'));
}

/**
 * Kayitli (eski dahil) audit'i okuma aninda dogru rotalarla zenginlestirir.
 * Eski taramalarda issueGroups.fixableCheckIds snippet kontrollerini de
 * tasiyordu → "Bu sablonu duzelt" butonu bunlari auto-fix'e gonderiyordu.
 */
export function annotateAuditFixRoutes<A extends { issues?: unknown; issueGroups?: unknown; checks?: unknown }>(audit: A): A {
  const out: any = { ...audit };
  if (Array.isArray(out.issues)) out.issues = withFixRoutes(out.issues);
  // checks[<id>].issues kontrolun KENDI ham sorunlari (checkId tasimaz → anahtar kullanilir)
  if (out.checks && typeof out.checks === 'object' && !Array.isArray(out.checks)) {
    const checks: Record<string, any> = {};
    for (const [id, c] of Object.entries(out.checks as Record<string, any>)) {
      checks[id] = c && Array.isArray(c.issues)
        ? { ...c, issues: withFixRoutes(c.issues.map((i: any) => ({ ...i, checkId: i?.checkId ?? id }))) }
        : c;
    }
    out.checks = checks;
  }
  const g = out.issueGroups;
  if (g && typeof g === 'object') {
    out.issueGroups = {
      ...g,
      byTemplate: Array.isArray(g.byTemplate)
        ? g.byTemplate.map((t: any) => ({
            ...t,
            fixableCheckIds: templateAutoFixIds(t),
            issues: Array.isArray(t.issues) ? withFixRoutes(t.issues) : [],
          }))
        : g.byTemplate,
      siteWide: Array.isArray(g.siteWide) ? withFixRoutes(g.siteWide) : g.siteWide,
      byCheck: Array.isArray(g.byCheck) ? withFixRoutes(g.byCheck) : g.byCheck,
    };
  }
  return out;
}
