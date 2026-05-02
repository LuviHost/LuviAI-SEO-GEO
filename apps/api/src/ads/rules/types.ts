/**
 * Ads Audit kural sistemi — claude-ads (MIT) repo'sundan port edildi.
 * Kaynak: github.com/AgriciDaniel/claude-ads (v1.5, 2026-04-13)
 *
 * Hibrit yaklaşım:
 *   - Deterministik (~%70): API verisi alır, TS fonksiyonu PASS/WARN/FAIL döner
 *   - Yargısal (~%30): LLM (agent-runner) çağırır, structured JSON döner
 */

export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type Verdict = 'pass' | 'warning' | 'fail' | 'na';
export type Platform = 'google' | 'meta';

export type GoogleCategory =
  | 'conversion' // Conversion Tracking 25%
  | 'waste'      // Wasted Spend / Negatives 20%
  | 'structure'  // Account Structure 15%
  | 'keywords'   // Keywords & Quality Score 15%
  | 'ads'        // Ads & Assets 15%
  | 'settings';  // Settings & Targeting 10%

export type MetaCategory =
  | 'pixel'      // Pixel/CAPI Health 30%
  | 'creative'   // Creative Diversity & Fatigue 30%
  | 'structure'  // Account Structure 20%
  | 'audience';  // Audience & Targeting 20%

export type Industry =
  | 'saas' | 'ecommerce' | 'b2b' | 'local' | 'healthcare' | 'legal'
  | 'finance' | 'real_estate' | 'education' | 'dental' | 'restaurant' | 'travel';

export interface AccountSnapshot {
  // Google Ads alan örnekleri
  enhancedConversionsActive?: boolean;
  consentModeV2?: 'advanced' | 'basic' | 'none';
  conversionActions?: { id: string; primary: boolean; status: string }[];
  searchTerms?: { term: string; cost: number; conversions: number }[];
  searchTermLastReviewedAt?: string; // ISO
  negativeKeywordLists?: { name: string; appliedScope: 'account' | 'campaign' | null }[];
  campaigns?: {
    id: string; name: string; objective?: string; budget: number; spendToday?: number;
    bidStrategy: string; matchTypeMix?: { exact: number; phrase: number; broad: number };
    learningStatus?: 'learning' | 'learning_limited' | 'eligible';
    qualityScore?: { weighted: number; criticalPct: number };
    network?: { search: boolean; searchPartners: boolean; display: boolean };
    geoTargeting?: 'people_in' | 'interest';
    sitelinks?: number; callouts?: number; structuredSnippets?: number;
    rsa?: { count: number; headlines: number; descriptions: number; adStrength: 'poor' | 'average' | 'good' | 'excellent' };
  }[];
  pmaxCampaigns?: { id: string; assetGroups: number; images: number; logos: number; videos: number; brandExclusions: boolean }[];
  ga4Linked?: boolean;
  monthlySpendUsd?: number;

  // Meta Ads alan örnekleri
  pixel?: { installed: boolean; coverage: number };
  capi?: { active: boolean; deduplicationRate: number };
  emq?: { purchase: number; addToCart: number; pageView: number };
  domainVerified?: boolean;
  aem?: { configured: boolean; topEvents: number };
  attributionWindow?: '1d_click' | '7d_click_1d_view' | 'unconfigured';
  metaCampaigns?: {
    id: string; budget: number; cbo: boolean;
    adSets: {
      learningStatus?: 'learning' | 'learning_limited' | 'active';
      frequency7d?: number;
      creatives: { format: 'image' | 'video' | 'carousel'; ageDays: number; ctr?: number; isUgc?: boolean }[];
      audienceOverlap?: number;
    }[];
  }[];

  // İçerik (LLM ile değerlendirilecek alanlar)
  campaignNamingSamples?: string[];
  adCopySamples?: { headline: string; description?: string }[];
  landingPageThemes?: { adGroupTheme: string; lpH1: string; lpUrl: string }[];
}

export interface AuditRule<C = string> {
  id: string;            // 'G42', 'M03'
  name: string;
  category: C;
  severity: Severity;
  fixTimeMinutes?: number; // Quick Wins (≤15 min + critical/high)
  /**
   * Deterministik kural: snapshot'tan çek, verdict döndür.
   * LLM kuralı: null döner (LLM phase ayrı çalıştırılır)
   */
  check: (snap: AccountSnapshot, industry: Industry) => { verdict: Verdict; finding?: string; recommendation?: string } | null;
  /** LLM ile değerlendirilecek mi? true → check() null döner, AI judge çalıştırılır */
  llm?: boolean;
  /** LLM kuralı için Claude'a verilecek değerlendirme prompt'u */
  llmPrompt?: (snap: AccountSnapshot) => string;
}

export interface AuditFinding {
  ruleId: string;
  name: string;
  category: string;
  severity: Severity;
  verdict: Verdict;
  finding: string;
  recommendation: string;
  fixTimeMinutes?: number;
  isQuickWin: boolean;
}

export interface AuditScore {
  platform: Platform;
  total: number;          // 0-100
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  byCategory: Record<string, { score: number; weight: number }>;
  findings: AuditFinding[];
  quickWins: AuditFinding[];
  summary: { pass: number; warning: number; fail: number; na: number; total: number };
}

// Severity → ağırlık (claude-ads/scoring-system.md)
export const SEVERITY_WEIGHT: Record<Severity, number> = {
  critical: 5.0,
  high: 3.0,
  medium: 1.5,
  low: 0.5,
};

// Verdict → C_pass değeri
export const VERDICT_VALUE: Record<Verdict, number | null> = {
  pass: 1.0,
  warning: 0.5,
  fail: 0.0,
  na: null, // skor hesabından çıkar
};

export const GOOGLE_CATEGORY_WEIGHTS: Record<GoogleCategory, number> = {
  conversion: 0.25,
  waste: 0.20,
  structure: 0.15,
  keywords: 0.15,
  ads: 0.15,
  settings: 0.10,
};

export const META_CATEGORY_WEIGHTS: Record<MetaCategory, number> = {
  pixel: 0.30,
  creative: 0.30,
  structure: 0.20,
  audience: 0.20,
};

export function gradeFromScore(s: number): 'A' | 'B' | 'C' | 'D' | 'F' {
  if (s >= 90) return 'A';
  if (s >= 75) return 'B';
  if (s >= 60) return 'C';
  if (s >= 40) return 'D';
  return 'F';
}
