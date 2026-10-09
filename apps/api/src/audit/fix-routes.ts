/**
 * Audit sorunlari NASIL duzeltilir — tek kaynak (saf).
 *
 * NEDEN: `AuditIssue.fixable` "duzeltilebilir mi" diyordu ama NEREDE
 * duzeltildigini soylemiyordu. UI tum fixable sorunlarin checkId'lerini
 * auto-fix'e gonderiyordu; auto-fix ise yalnizca kok dosyalari uretebiliyor,
 * gerisini (meta_title, schema_markup, geo_*) SESSIZCE atliyordu — kullanici
 * yine "duzeltme uygulandi" toast'i goruyordu.
 *
 *   auto_fix → AutoFixService kok dosyayi uretir + yayin hedefine yazar
 *   snippet  → Snippet araci (/sites/:id/snippet): uretilir, CMS'e uygulanir
 *              ya da kopyala-yapistir
 *   images   → Gorseller sayfasi (alt metni oner/onayla/yaz) — sayfa gelene
 *              kadar image_alt 'manual' kalir
 *   manual   → otomatik yol yok (icerik/strateji isi)
 */

export type FixRoute = 'auto_fix' | 'snippet' | 'images' | 'manual';

/** AutoFixService.generateContent'in GERCEKTEN uretebildigi anahtarlar → kanonik dosya anahtari */
const AUTO_FIX_CANONICAL: Record<string, string> = {
  sitemap: 'sitemap',
  sitemap_xml: 'sitemap',
  robots: 'robots',
  robots_txt: 'robots',
  llms: 'llms',
  llms_txt: 'llms',
  agent_json: 'agent_json',
  auth_md: 'auth_md',
};

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

export function isAutoFixKey(key: string | null | undefined): boolean {
  return !!key && Object.prototype.hasOwnProperty.call(AUTO_FIX_CANONICAL, key);
}

export function fixRouteFor(checkId: string | null | undefined): FixRoute {
  if (!checkId) return 'manual';
  if (isAutoFixKey(checkId)) return 'auto_fix';
  if (SNIPPET_CHECKS.has(checkId)) return 'snippet';
  return 'manual';
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
    const fixRoute = fixRouteFor(i.checkId ?? i.type);
    return { ...i, fixRoute, fixable: fixRoute !== 'manual' };
  });
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
            fixableCheckIds: Array.isArray(t.fixableCheckIds) ? t.fixableCheckIds.filter((id: string) => fixRouteFor(id) === 'auto_fix') : [],
            issues: Array.isArray(t.issues) ? withFixRoutes(t.issues) : [],
          }))
        : g.byTemplate,
      siteWide: Array.isArray(g.siteWide) ? withFixRoutes(g.siteWide) : g.siteWide,
      byCheck: Array.isArray(g.byCheck) ? withFixRoutes(g.byCheck) : g.byCheck,
    };
  }
  return out;
}
