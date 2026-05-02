/**
 * Weighted scoring — claude-ads/scoring-system.md formülü.
 *
 *   S_total = Σ(C_pass × W_sev × W_cat) / Σ(C_total × W_sev × W_cat) × 100
 *
 *   C_pass  : 1.0 (pass) | 0.5 (warning) | 0.0 (fail) | excluded (na)
 *   W_sev   : Critical=5.0 | High=3.0 | Medium=1.5 | Low=0.5
 *   W_cat   : platform-specific (örn. Google Conversion 25%, Waste 20%, ...)
 */
import {
  AuditRule, AuditFinding, AuditScore, Severity, Verdict,
  SEVERITY_WEIGHT, VERDICT_VALUE, GOOGLE_CATEGORY_WEIGHTS, META_CATEGORY_WEIGHTS,
  Platform, gradeFromScore,
} from '../rules/types.js';

interface RawResult {
  rule: AuditRule;
  verdict: Verdict;
  finding: string;
  recommendation: string;
}

export function scoreAudit(platform: Platform, results: RawResult[]): AuditScore {
  const catWeights = platform === 'google' ? GOOGLE_CATEGORY_WEIGHTS : META_CATEGORY_WEIGHTS;

  // Per-category: pay (achieved) / payda (max)
  const catAccum: Record<string, { num: number; den: number; w: number }> = {};
  let totalNum = 0;
  let totalDen = 0;
  const findings: AuditFinding[] = [];
  const summary = { pass: 0, warning: 0, fail: 0, na: 0, total: 0 };

  for (const r of results) {
    summary.total++;
    summary[r.verdict]++;

    if (r.verdict === 'na') continue;

    const wSev = SEVERITY_WEIGHT[r.rule.severity];
    const wCat = (catWeights as any)[r.rule.category] ?? 0.1;
    const cVal = VERDICT_VALUE[r.verdict];
    if (cVal == null) continue;

    const numContribution = cVal * wSev * wCat;
    const denContribution = 1.0 * wSev * wCat;

    totalNum += numContribution;
    totalDen += denContribution;

    catAccum[r.rule.category] = catAccum[r.rule.category] ?? { num: 0, den: 0, w: wCat };
    catAccum[r.rule.category].num += numContribution;
    catAccum[r.rule.category].den += denContribution;

    findings.push({
      ruleId: r.rule.id,
      name: r.rule.name,
      category: r.rule.category,
      severity: r.rule.severity,
      verdict: r.verdict,
      finding: r.finding,
      recommendation: r.recommendation,
      fixTimeMinutes: r.rule.fixTimeMinutes,
      isQuickWin: !!(
        r.rule.fixTimeMinutes && r.rule.fixTimeMinutes <= 15 &&
        (r.rule.severity === 'critical' || r.rule.severity === 'high') &&
        (r.verdict === 'fail' || r.verdict === 'warning')
      ),
    });
  }

  const totalScore = totalDen > 0 ? Math.round((totalNum / totalDen) * 100) : 0;

  const byCategory: Record<string, { score: number; weight: number }> = {};
  for (const [cat, acc] of Object.entries(catAccum)) {
    byCategory[cat] = {
      score: acc.den > 0 ? Math.round((acc.num / acc.den) * 100) : 0,
      weight: acc.w,
    };
  }

  // Quick Wins — severity sırasına + critical önce
  const quickWins = findings
    .filter(f => f.isQuickWin)
    .sort((a, b) => {
      const sevOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return sevOrder[a.severity] - sevOrder[b.severity];
    });

  // Findings sıralama: severity DESC + verdict (fail önce)
  findings.sort((a, b) => {
    const sevOrder: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    if (a.severity !== b.severity) return sevOrder[a.severity] - sevOrder[b.severity];
    const vOrder: Record<Verdict, number> = { fail: 0, warning: 1, pass: 2, na: 3 };
    return vOrder[a.verdict] - vOrder[b.verdict];
  });

  return {
    platform,
    total: totalScore,
    grade: gradeFromScore(totalScore),
    byCategory,
    findings,
    quickWins,
    summary,
  };
}
