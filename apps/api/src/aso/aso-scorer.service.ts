import { Injectable } from '@nestjs/common';

/**
 * ASO health scoring — 4 boyutta weighted skor (0-100).
 *
 * TypeScript port of claude-code-aso-skill/aso_scorer.py (MIT, alirezarezvani).
 * https://github.com/alirezarezvani/claude-code-aso-skill
 *
 * Boyutlar (her biri %25):
 *   1) Metadata quality — title/description/keyword usage
 *   2) Ratings & reviews — average, volume, velocity
 *   3) Keyword performance — top 10/50/100 rankings, trend
 *   4) Conversion metrics — impression-to-install, download velocity, trend
 *
 * Bizim ASO modülümüz görsel/asset üretiyor; bu service **metadata + market
 * analitiği** kısmını yönetir — tamamlayıcı, çakışmıyor.
 */

export interface MetadataInput {
  title_keyword_count?: number;      // title'da kaç hedef anahtar kelime var
  title_length?: number;             // toplam karakter
  description_length?: number;
  description_quality?: number;      // 0..1 (AI ile değerlendirilmiş)
  keyword_density?: number;          // % (örn: 3.5 → 3.5%)
}

export interface RatingsInput {
  average_rating?: number;           // 0..5
  total_ratings?: number;
  recent_ratings_30d?: number;
}

export interface KeywordPerformanceInput {
  top_10?: number;
  top_50?: number;
  top_100?: number;
  improving_keywords?: number;
}

export interface ConversionInput {
  impression_to_install?: number;    // 0..1 oran
  downloads_last_30_days?: number;
  downloads_trend?: 'up' | 'stable' | 'down';
}

export interface ScoreBreakdownEntry {
  score: number;
  weight: number;
  weighted_contribution: number;
}

export interface ASORecommendation {
  category: 'metadata_quality' | 'ratings_reviews' | 'keyword_performance' | 'conversion_metrics';
  priority: 'high' | 'medium' | 'low';
  action: string;
  details: string;
  expected_impact: string;
}

export interface ASOScoreResult {
  overall_score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  breakdown: Record<string, ScoreBreakdownEntry>;
  recommendations: ASORecommendation[];
  strengths: string[];
  weaknesses: string[];
}

@Injectable()
export class ASOScorerService {
  private static readonly WEIGHTS = {
    metadata_quality:    25,
    ratings_reviews:     25,
    keyword_performance: 25,
    conversion_metrics:  25,
  };

  private static readonly BENCHMARKS = {
    title_keyword_usage: { min: 1, target: 2 },
    description_length:  { min: 500, target: 2000 },
    keyword_density:     { min: 2, optimal: 5, max: 8 },
    average_rating:      { min: 3.5, target: 4.5 },
    ratings_count:       { min: 100, target: 5000 },
    keywords_top_10:     { min: 2, target: 10 },
    keywords_top_50:     { min: 5, target: 20 },
    conversion_rate:     { min: 0.02, target: 0.10 },
  };

  calculateOverallScore(
    metadata: MetadataInput,
    ratings: RatingsInput,
    keywordPerformance: KeywordPerformanceInput,
    conversion: ConversionInput,
  ): ASOScoreResult {
    const W = ASOScorerService.WEIGHTS;
    const metadataScore   = this.scoreMetadataQuality(metadata);
    const ratingsScore    = this.scoreRatingsReviews(ratings);
    const keywordScore    = this.scoreKeywordPerformance(keywordPerformance);
    const conversionScore = this.scoreConversionMetrics(conversion);

    const overallScore = (
      metadataScore   * (W.metadata_quality    / 100) +
      ratingsScore    * (W.ratings_reviews     / 100) +
      keywordScore    * (W.keyword_performance / 100) +
      conversionScore * (W.conversion_metrics  / 100)
    );

    const breakdown: Record<string, ScoreBreakdownEntry> = {
      metadata_quality:    { score: metadataScore,   weight: W.metadata_quality,    weighted_contribution: round1(metadataScore   * W.metadata_quality    / 100) },
      ratings_reviews:     { score: ratingsScore,    weight: W.ratings_reviews,     weighted_contribution: round1(ratingsScore    * W.ratings_reviews     / 100) },
      keyword_performance: { score: keywordScore,    weight: W.keyword_performance, weighted_contribution: round1(keywordScore    * W.keyword_performance / 100) },
      conversion_metrics:  { score: conversionScore, weight: W.conversion_metrics,  weighted_contribution: round1(conversionScore * W.conversion_metrics  / 100) },
    };

    return {
      overall_score: round1(overallScore),
      grade: this.grade(overallScore),
      breakdown,
      recommendations: this.generateRecommendations(metadataScore, ratingsScore, keywordScore, conversionScore),
      strengths:  this.identifyStrengths(breakdown),
      weaknesses: this.identifyWeaknesses(breakdown),
    };
  }

  scoreMetadataQuality(m: MetadataInput): number {
    const B = ASOScorerService.BENCHMARKS;
    const titleKw = m.title_keyword_count ?? 0;
    const titleLen = m.title_length ?? 0;

    // Title score (0-35)
    let titleScore = titleKw >= B.title_keyword_usage.target ? 35
                    : titleKw >= B.title_keyword_usage.min ? 25
                    : 10;
    if (titleLen <= 25) titleScore -= 5;
    titleScore = Math.min(titleScore, 35);

    // Description score (0-35)
    const descLen = m.description_length ?? 0;
    const descQuality = m.description_quality ?? 0;
    let descScore = descLen >= B.description_length.target ? 25
                   : descLen >= B.description_length.min ? 15
                   : 5;
    descScore += descQuality * 10;
    descScore = Math.min(descScore, 35);

    // Keyword density score (0-30)
    const density = m.keyword_density ?? 0;
    let densityScore: number;
    if (density >= B.keyword_density.min && density <= B.keyword_density.optimal) {
      densityScore = 30;
    } else if (density < B.keyword_density.min) {
      densityScore = (density / B.keyword_density.min) * 20;
    } else {
      const excess = density - B.keyword_density.optimal;
      densityScore = Math.max(30 - (excess * 5), 0);
    }

    return round1(titleScore + descScore + densityScore);
  }

  scoreRatingsReviews(r: RatingsInput): number {
    const B = ASOScorerService.BENCHMARKS;
    const avg = r.average_rating ?? 0;
    const total = r.total_ratings ?? 0;
    const recent = r.recent_ratings_30d ?? 0;

    // Quality (0-50)
    let qualityScore: number;
    if (avg >= B.average_rating.target) qualityScore = 50;
    else if (avg >= B.average_rating.min) {
      const p = (avg - B.average_rating.min) / (B.average_rating.target - B.average_rating.min);
      qualityScore = 30 + p * 20;
    } else if (avg >= 3.0) qualityScore = 20;
    else qualityScore = 10;

    // Volume (0-30)
    let volumeScore: number;
    if (total >= B.ratings_count.target) volumeScore = 30;
    else if (total >= B.ratings_count.min) {
      const p = (total - B.ratings_count.min) / (B.ratings_count.target - B.ratings_count.min);
      volumeScore = 15 + p * 15;
    } else volumeScore = (total / B.ratings_count.min) * 15;

    // Velocity (0-20)
    const velocityScore = recent > 100 ? 20 : recent > 50 ? 15 : recent > 10 ? 10 : 5;

    return round1(Math.min(qualityScore + volumeScore + velocityScore, 100));
  }

  scoreKeywordPerformance(k: KeywordPerformanceInput): number {
    const B = ASOScorerService.BENCHMARKS;
    const top10 = k.top_10 ?? 0;
    const top50 = k.top_50 ?? 0;
    const top100 = k.top_100 ?? 0;
    const improving = k.improving_keywords ?? 0;

    // Top 10 (0-50)
    let top10Score: number;
    if (top10 >= B.keywords_top_10.target) top10Score = 50;
    else if (top10 >= B.keywords_top_10.min) {
      const p = (top10 - B.keywords_top_10.min) / (B.keywords_top_10.target - B.keywords_top_10.min);
      top10Score = 25 + p * 25;
    } else top10Score = (top10 / B.keywords_top_10.min) * 25;

    // Top 50 (0-30)
    let top50Score: number;
    if (top50 >= B.keywords_top_50.target) top50Score = 30;
    else if (top50 >= B.keywords_top_50.min) {
      const p = (top50 - B.keywords_top_50.min) / (B.keywords_top_50.target - B.keywords_top_50.min);
      top50Score = 15 + p * 15;
    } else top50Score = (top50 / B.keywords_top_50.min) * 15;

    // Coverage (0-10) based on top 100
    const coverageScore = Math.min((top100 / 30) * 10, 10);

    // Trend (0-10)
    const trendScore = improving > 5 ? 10 : improving > 0 ? 5 : 0;

    return round1(Math.min(top10Score + top50Score + coverageScore + trendScore, 100));
  }

  scoreConversionMetrics(c: ConversionInput): number {
    const B = ASOScorerService.BENCHMARKS;
    const cr = c.impression_to_install ?? 0;
    const dl30 = c.downloads_last_30_days ?? 0;
    const trend = c.downloads_trend ?? 'stable';

    // Conversion rate (0-70)
    let conversionScore: number;
    if (cr >= B.conversion_rate.target) conversionScore = 70;
    else if (cr >= B.conversion_rate.min) {
      const p = (cr - B.conversion_rate.min) / (B.conversion_rate.target - B.conversion_rate.min);
      conversionScore = 35 + p * 35;
    } else conversionScore = (cr / B.conversion_rate.min) * 35;

    // Download velocity (0-20)
    const velocityScore = dl30 > 10000 ? 20 : dl30 > 1000 ? 15 : dl30 > 100 ? 10 : 5;

    // Trend bonus (0-10)
    const trendScore = trend === 'up' ? 10 : trend === 'stable' ? 5 : 0;

    return round1(Math.min(conversionScore + velocityScore + trendScore, 100));
  }

  private generateRecommendations(
    metadataScore: number, ratingsScore: number,
    keywordScore: number, conversionScore: number,
  ): ASORecommendation[] {
    const recs: ASORecommendation[] = [];

    if (metadataScore < 60) {
      recs.push({
        category: 'metadata_quality', priority: 'high',
        action: 'App title ve description\'ı optimize et',
        details: 'Title\'a daha fazla anahtar kelime ekle, description\'ı 1500-2000 karaktere çıkar, keyword density %3-5 aralığına çek',
        expected_impact: 'Discoverability ve ranking potansiyeli artar',
      });
    } else if (metadataScore < 80) {
      recs.push({
        category: 'metadata_quality', priority: 'medium',
        action: 'Metadata\'yı keyword hedefliliği için ince ayarla',
        details: 'Title/subtitle varyasyonlarını test et, Apple keyword field\'ını optimize et',
        expected_impact: 'Kademeli ranking iyileşmesi',
      });
    }

    if (ratingsScore < 60) {
      recs.push({
        category: 'ratings_reviews', priority: 'high',
        action: 'Rating kalitesini ve hacmini iyileştir',
        details: 'En sık gelen şikayetleri çöz, in-app rating prompt ekle, negatif review\'lara cevap ver',
        expected_impact: 'Conversion oranı ve güven sinyalleri artar',
      });
    } else if (ratingsScore < 80) {
      recs.push({
        category: 'ratings_reviews', priority: 'medium',
        action: 'Rating volume\'unu büyütmeye odaklan',
        details: 'Mutlu kullanıcılara stratejik rating prompt göster, milestone\'larda iste',
        expected_impact: 'Daha fazla sosyal kanıt',
      });
    }

    if (keywordScore < 60) {
      recs.push({
        category: 'keyword_performance', priority: 'high',
        action: 'Keyword stratejini revize et',
        details: 'Düşük rekabetli long-tail keyword\'lere odaklan, top 50\'deki keyword\'leri top 10\'a taşımak için ek metadata optimizasyonu yap',
        expected_impact: '+5-10 top 10 ranking, organik trafik artışı',
      });
    } else if (keywordScore < 80) {
      recs.push({
        category: 'keyword_performance', priority: 'medium',
        action: 'Coverage\'ı genişlet, fırsat keyword\'lerini ekle',
        details: 'Trend keyword\'leri ekle, mevsimsel fırsatları yakala',
        expected_impact: 'Daha geniş keyword footprint',
      });
    }

    if (conversionScore < 60) {
      recs.push({
        category: 'conversion_metrics', priority: 'high',
        action: 'Conversion oranını iyileştir',
        details: 'Screenshot\'ları yenile (LuviAI ASO Studio + A/B test), açıklamayı yeniden yaz, ikon güncelle',
        expected_impact: 'Aynı trafik daha çok install',
      });
    }

    return recs;
  }

  private identifyStrengths(breakdown: Record<string, ScoreBreakdownEntry>): string[] {
    return Object.entries(breakdown)
      .filter(([_, v]) => v.score >= 80)
      .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v.score}/100`);
  }

  private identifyWeaknesses(breakdown: Record<string, ScoreBreakdownEntry>): string[] {
    return Object.entries(breakdown)
      .filter(([_, v]) => v.score < 60)
      .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v.score}/100`);
  }

  private grade(score: number): 'A' | 'B' | 'C' | 'D' | 'F' {
    if (score >= 90) return 'A';
    if (score >= 80) return 'B';
    if (score >= 70) return 'C';
    if (score >= 60) return 'D';
    return 'F';
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
