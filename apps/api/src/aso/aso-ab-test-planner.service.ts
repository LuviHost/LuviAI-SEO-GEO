import { Injectable } from '@nestjs/common';

/**
 * A/B test planner — sample size, significance, test report.
 *
 * TypeScript port of claude-code-aso-skill/ab_test_planner.py (MIT).
 * App Store Product Page Optimization (Apple) ve Google Play
 * Store Listing Experiments için yardımcı.
 */

export type TestType = 'icon' | 'screenshots' | 'title' | 'subtitle' | 'description' | 'category';

export interface TestPlan {
  test_id: string;
  test_type: TestType;
  hypothesis: string;
  primary_metric: 'conversion_rate' | 'install_rate' | 'click_through';
  secondary_metrics: string[];
  variant_count: number;
  required_sample_size: number;
  estimated_days: number;
  confidence_level: number;
  best_practices: string[];
}

export interface SignificanceResult {
  control_rate: number;
  variant_rate: number;
  lift_percent: number;
  z_score: number;
  p_value: number;
  significant: boolean;
  confidence: number;
  recommendation: string;
}

@Injectable()
export class AsoAbTestPlannerService {
  /** Test design — sample size + best practices */
  designTest(opts: {
    test_type: TestType;
    hypothesis: string;
    baseline_conversion_rate: number; // 0..1
    min_detectable_effect: number;    // % (örn: 5 = %5 göreceli iyileşme)
    variant_count?: number;
    daily_traffic?: number;
    confidence_level?: number;        // default 0.95
  }): TestPlan {
    const variants = opts.variant_count ?? 2;
    const confidence = opts.confidence_level ?? 0.95;
    const sample = this.calculateSampleSize({
      baseline_rate: opts.baseline_conversion_rate,
      min_detectable_effect: opts.min_detectable_effect,
      confidence_level: confidence,
      power: 0.80,
    });
    const totalNeeded = sample * variants;
    const days = opts.daily_traffic ? Math.ceil(totalNeeded / opts.daily_traffic) : 14;
    return {
      test_id: this.generateId(opts.test_type),
      test_type: opts.test_type,
      hypothesis: opts.hypothesis,
      primary_metric: 'conversion_rate',
      secondary_metrics: this.secondaryMetrics(opts.test_type),
      variant_count: variants,
      required_sample_size: totalNeeded,
      estimated_days: Math.max(7, days),  // App Store min 7 gün önerilir
      confidence_level: confidence,
      best_practices: this.bestPractices(opts.test_type),
    };
  }

  /**
   * Per-variant sample size — Z-test for proportions.
   * Formul: n = (Z_a/2 + Z_b)^2 * 2p(1-p) / d^2
   *   p = baseline, d = mutlak fark
   */
  calculateSampleSize(opts: {
    baseline_rate: number;        // 0..1
    min_detectable_effect: number; // % göreceli — örn: 5 → baseline * 1.05
    confidence_level?: number;     // default 0.95
    power?: number;                // default 0.80
  }): number {
    const p = opts.baseline_rate;
    const delta = p * (opts.min_detectable_effect / 100);
    const z_alpha = z_value(opts.confidence_level ?? 0.95);
    const z_beta = z_value(opts.power ?? 0.80);
    const n = Math.ceil(((z_alpha + z_beta) ** 2 * 2 * p * (1 - p)) / (delta ** 2));
    return Math.max(100, n);
  }

  /** Sonuçların istatistiksel anlamlılığını ölç */
  calculateSignificance(opts: {
    control_visitors: number;
    control_conversions: number;
    variant_visitors: number;
    variant_conversions: number;
    confidence_level?: number;
  }): SignificanceResult {
    const confidence = opts.confidence_level ?? 0.95;
    const p1 = opts.control_conversions / Math.max(opts.control_visitors, 1);
    const p2 = opts.variant_conversions / Math.max(opts.variant_visitors, 1);
    const pPool =
      (opts.control_conversions + opts.variant_conversions) /
      Math.max(opts.control_visitors + opts.variant_visitors, 1);
    const seDiff = Math.sqrt(pPool * (1 - pPool) * (1 / Math.max(opts.control_visitors, 1) + 1 / Math.max(opts.variant_visitors, 1)));
    const zScore = seDiff > 0 ? (p2 - p1) / seDiff : 0;
    const pValue = 2 * (1 - normalCdf(Math.abs(zScore)));
    const significant = pValue < 1 - confidence;
    const lift = p1 > 0 ? ((p2 - p1) / p1) * 100 : 0;

    let rec: string;
    if (significant && lift > 0) rec = `✅ Variant ${Math.round(lift)}% uplift — kazanan olarak deploy et`;
    else if (significant && lift < 0) rec = `❌ Variant ${Math.round(Math.abs(lift))}% kayıp — control'u koru`;
    else if (Math.abs(zScore) < 1) rec = `Sonuç gürültü içinde — daha fazla örneklem topla`;
    else rec = `Henüz anlamlı değil — testi devam ettir`;

    return {
      control_rate: round3(p1),
      variant_rate: round3(p2),
      lift_percent: Math.round(lift * 10) / 10,
      z_score: round2(zScore),
      p_value: round3(pValue),
      significant,
      confidence,
      recommendation: rec,
    };
  }

  // ─────────────────────────────────
  private generateId(type: TestType): string {
    const ts = Date.now().toString(36);
    return `aso-${type}-${ts}`;
  }

  private secondaryMetrics(type: TestType): string[] {
    const base = ['impression_count', 'product_page_view', 'install_rate'];
    if (type === 'icon') return [...base, 'tap_rate_on_search_results'];
    if (type === 'screenshots' || type === 'description') return [...base, 'scroll_depth', 'engagement_time'];
    if (type === 'title' || type === 'subtitle') return [...base, 'search_appearance', 'keyword_rank'];
    return base;
  }

  private bestPractices(type: TestType): string[] {
    const common = [
      'Aynı anda sadece tek bir öğeyi test et (icon, screenshot, title vb.)',
      'En az 7 gün, ideal olarak 14 gün test et',
      'Hafta sonu ve hafta içi davranış farkını gör',
      'Anlamlılığa ulaşmadan testi sonlandırma',
    ];
    const typeSpecific: Record<TestType, string[]> = {
      icon: ['3 varyantı aşma (Apple: sadece variants/dark/tinted)', 'Renk + form değiştir, marka tutarlılığını koru'],
      screenshots: ['İlk 3 screenshot en kritik (search results preview)', 'Hook + sosyal kanıt + özellik sıralaması test et'],
      title: ['30 karakter limit — Apple keyword field ile çakışmayacak'],
      subtitle: ['Apple-only; Play\'de short description test et'],
      description: ['İlk 250 karakter "above the fold" en kritik'],
      category: ['Sadece browse trafiği için anlamlı; search trafiği etkilenmez'],
    };
    return [...common, ...typeSpecific[type]];
  }
}

// ─────────────────────────────────
function z_value(confidence: number): number {
  // Yaygın değerler için sabit map — istatistik kütüphanesi yerine.
  if (confidence >= 0.99) return 2.576;
  if (confidence >= 0.95) return 1.96;
  if (confidence >= 0.90) return 1.645;
  if (confidence >= 0.80) return 0.841;
  return 1.96;
}

// Normal CDF approximation (Abramowitz & Stegun 26.2.17)
function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z >= 0 ? 1 - p : p;
}

function round2(n: number): number { return Math.round(n * 100) / 100; }
function round3(n: number): number { return Math.round(n * 1000) / 1000; }
