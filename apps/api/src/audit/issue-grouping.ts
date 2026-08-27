/**
 * Audit sorunlarini SABLONA gore gruplama — saf.
 *
 * NEDEN: "yuzlerce sayfa hatasi cogu zaman tek bir bilesen duzeltmesidir"
 * (sablon/tema kaynakli). Sorun listesi sayfa sayfa gosterilince kullanici
 * 200 satir goruyor, aslinda 3 sablon var. URL'den deterministik sablon
 * cikarilir: slug/rakam/tarih segmentleri `*` olur, ilk 3 segment tutulur.
 *   /blog/nasil-yapilir            → /blog/*
 *   /urunler/x-100/detay           → /urunler/*\/detay
 *   /2026/08/27/baslik             → /*\/*\/*
 *   /                              → /
 */

export type IssueSeverity = 'critical' | 'warning' | 'info';

export interface GroupableIssue {
  type: string;
  severity: IssueSeverity;
  checkId?: string;
  page?: string;
  fixable: boolean;
  description?: string;
}

export interface CheckLike {
  id: string;
  name: string;
  details?: any;
}

export interface TemplateGroup {
  template: string;
  pageCount: number;
  samplePages: string[];
  criticalCount: number;
  warningCount: number;
  infoCount: number;
  fixableCheckIds: string[];
  issues: Array<{ type: string; checkId: string; severity: IssueSeverity; count: number; fixable: boolean }>;
}

export interface IssueGroups {
  byTemplate: TemplateGroup[];
  byCheck: Array<{ checkId: string; name: string; count: number; worstSeverity: IssueSeverity; fixable: boolean }>;
  /** Sayfa bilgisi olmayan site-geneli sorunlar (sitemap/robots/https/llms...) */
  siteWide: Array<{ type: string; checkId: string; severity: IssueSeverity; fixable: boolean }>;
}

const SEV_RANK: Record<IssueSeverity, number> = { info: 0, warning: 1, critical: 2 };
const MAX_SEGMENTS = 3;
const MAX_SAMPLES = 5;

function isVariableSegment(seg: string): boolean {
  if (/^\d+$/.test(seg)) return true;                       // 123
  if (/^\d{4}-\d{2}-\d{2}/.test(seg)) return true;          // tarih
  if (seg.includes('-') || seg.includes('_')) return true;   // slug
  if (seg.length > 20) return true;                          // uzun tekil
  if (/^[a-z0-9]{8,}$/i.test(seg) && /\d/.test(seg)) return true; // id benzeri
  return false;
}

export function urlTemplate(url: string, baseUrl?: string): string {
  let path: string;
  try {
    const u = url.startsWith('http') ? new URL(url) : new URL(url, baseUrl ?? 'https://x.invalid');
    path = u.pathname.toLowerCase();
  } catch {
    return '/';
  }
  path = path.replace(/\/+$/, '') || '/';
  if (path === '/') return '/';
  const segs = path.split('/').filter(Boolean).slice(0, MAX_SEGMENTS);
  return '/' + segs.map((s) => (isVariableSegment(s) ? '*' : s)).join('/');
}

/** Kontrol detaylarindan sayfa listesi cikar — details icinde bilinen liste alanlari */
function pagesFromDetails(details: any): string[] {
  if (!details || typeof details !== 'object') return [];
  const keys = ['missingPages', 'orphans', 'pagesWithoutOg', 'pagesWithoutDesc', 'pages', 'duplicatePages', 'missingAltPages'];
  const out: string[] = [];
  for (const k of keys) if (Array.isArray(details[k])) out.push(...details[k].filter((p: unknown) => typeof p === 'string'));
  return out;
}

export function groupIssues(issues: GroupableIssue[], checks: Record<string, CheckLike>, baseUrl?: string): IssueGroups {
  const byTemplate = new Map<string, TemplateGroup & { _pages: Set<string> }>();
  const siteWide: IssueGroups['siteWide'] = [];
  const byCheckMap = new Map<string, { checkId: string; name: string; count: number; worst: IssueSeverity; fixable: boolean }>();

  const bump = (issue: GroupableIssue) => {
    const checkId = issue.checkId ?? issue.type;
    const cur = byCheckMap.get(checkId) ?? { checkId, name: checks[checkId]?.name ?? checkId, count: 0, worst: issue.severity, fixable: false };
    cur.count += 1;
    if (SEV_RANK[issue.severity] > SEV_RANK[cur.worst]) cur.worst = issue.severity;
    cur.fixable = cur.fixable || issue.fixable;
    byCheckMap.set(checkId, cur);
  };

  for (const issue of issues) {
    bump(issue);
    const checkId = issue.checkId ?? issue.type;
    // Sayfa kaynagi: issue.page + kontrolun details listesi
    const pages = new Set<string>();
    if (issue.page) pages.add(issue.page);
    for (const p of pagesFromDetails(checks[checkId]?.details)) pages.add(p);

    if (pages.size === 0) {
      siteWide.push({ type: issue.type, checkId, severity: issue.severity, fixable: issue.fixable });
      continue;
    }
    // Sayfalari sablona dagit
    const perTemplate = new Map<string, string[]>();
    for (const p of pages) {
      const t = urlTemplate(p, baseUrl);
      const arr = perTemplate.get(t) ?? [];
      arr.push(p);
      perTemplate.set(t, arr);
    }
    for (const [template, tPages] of perTemplate) {
      const g = byTemplate.get(template) ?? {
        template, pageCount: 0, samplePages: [], criticalCount: 0, warningCount: 0, infoCount: 0, fixableCheckIds: [], issues: [], _pages: new Set<string>(),
      };
      for (const p of tPages) g._pages.add(p);
      const existing = g.issues.find((i) => i.type === issue.type && i.checkId === checkId);
      if (existing) existing.count += tPages.length;
      else g.issues.push({ type: issue.type, checkId, severity: issue.severity, count: tPages.length, fixable: issue.fixable });
      if (issue.severity === 'critical') g.criticalCount += 1;
      else if (issue.severity === 'warning') g.warningCount += 1;
      else g.infoCount += 1;
      if (issue.fixable && !g.fixableCheckIds.includes(checkId)) g.fixableCheckIds.push(checkId);
      byTemplate.set(template, g);
    }
  }

  const templates: TemplateGroup[] = [...byTemplate.values()]
    .map(({ _pages, ...g }) => ({ ...g, pageCount: _pages.size, samplePages: [..._pages].slice(0, MAX_SAMPLES) }))
    .sort((a, b) => b.pageCount - a.pageCount || b.criticalCount - a.criticalCount);

  const byCheck = [...byCheckMap.values()]
    .map((c) => ({ checkId: c.checkId, name: c.name, count: c.count, worstSeverity: c.worst, fixable: c.fixable }))
    .sort((a, b) => SEV_RANK[b.worstSeverity] - SEV_RANK[a.worstSeverity] || b.count - a.count);

  return { byTemplate: templates, byCheck, siteWide };
}
