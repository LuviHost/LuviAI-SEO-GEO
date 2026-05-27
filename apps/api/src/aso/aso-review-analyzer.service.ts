import { Injectable } from '@nestjs/common';

/**
 * Review analyzer — sentiment + theme + feature request extraction.
 *
 * TypeScript port of claude-code-aso-skill/review_analyzer.py (MIT).
 * Rule-based (LLM-free) basic sentiment + keyword theme clustering.
 * Production'da Claude Haiku ile zenginleştirilebilir (this.aiSummarize stub).
 */

export interface ReviewInput {
  id?: string;
  rating: number;       // 1..5
  text: string;
  date?: string;        // ISO
  helpful?: number;
}

export interface SentimentBreakdown {
  positive: number;
  neutral: number;
  negative: number;
  total: number;
  sentiment_score: number; // -100..100
}

export interface Theme {
  theme: string;
  count: number;
  examples: string[];
}

export interface IssueReport {
  category: string;
  count: number;
  severity: 'critical' | 'high' | 'medium' | 'low';
  examples: string[];
}

@Injectable()
export class AsoReviewAnalyzerService {
  // Türkçe + İngilizce karma sözlük — minimal seed; production'da genişletilir.
  private readonly POSITIVE_WORDS = [
    'great', 'love', 'awesome', 'excellent', 'amazing', 'perfect', 'best', 'good',
    'harika', 'mükemmel', 'süper', 'iyi', 'beğendim', 'tavsiye', 'mükemmel', 'müthiş', 'çok iyi',
  ];

  private readonly NEGATIVE_WORDS = [
    'bad', 'terrible', 'worst', 'crash', 'bug', 'broken', 'slow', 'unusable', 'hate',
    'kötü', 'berbat', 'çöp', 'bozuk', 'yavaş', 'çalışmıyor', 'hata', 'sorun', 'donuyor',
  ];

  private readonly ISSUE_CATEGORIES: Record<string, string[]> = {
    crash:        ['crash', 'çökme', 'donuyor', 'kapanıyor'],
    performance:  ['slow', 'lag', 'yavaş', 'donma'],
    ui_ux:        ['confusing', 'ugly', 'karmaşık', 'çirkin', 'anlaşılmaz'],
    bugs:         ['bug', 'hata', 'broken', 'bozuk', 'çalışmıyor'],
    pricing:      ['expensive', 'pahalı', 'paywall', 'premium', 'ücretli'],
    ads:          ['ads', 'advertisement', 'reklam', 'pop-up'],
    login:        ['login', 'sign in', 'giriş', 'oturum'],
    sync:         ['sync', 'senkron'],
    feature_missing: ['missing', 'need', 'wish', 'eksik', 'olsa', 'lazım'],
  };

  /** Sentiment dağılımı ve genel skor */
  analyzeSentiment(reviews: ReviewInput[]): SentimentBreakdown {
    let pos = 0, neu = 0, neg = 0;
    for (const r of reviews) {
      const cat = this.categorizeSentiment(this.calculateSentimentScore(r.text, r.rating));
      if (cat === 'positive') pos++;
      else if (cat === 'negative') neg++;
      else neu++;
    }
    const total = reviews.length || 1;
    return {
      positive: pos,
      neutral: neu,
      negative: neg,
      total: reviews.length,
      sentiment_score: Math.round(((pos - neg) / total) * 100),
    };
  }

  /** Tekrarlanan temaları çıkar (basic keyword clustering) */
  extractCommonThemes(reviews: ReviewInput[], topN = 10): Theme[] {
    const themeMap = new Map<string, { count: number; examples: string[] }>();

    for (const [category, keywords] of Object.entries(this.ISSUE_CATEGORIES)) {
      const matched: string[] = [];
      for (const r of reviews) {
        const lower = r.text.toLowerCase();
        if (keywords.some(k => lower.includes(k))) {
          matched.push(r.text.slice(0, 150));
        }
      }
      if (matched.length > 0) {
        themeMap.set(category, { count: matched.length, examples: matched.slice(0, 3) });
      }
    }

    return Array.from(themeMap.entries())
      .map(([theme, v]) => ({ theme, count: v.count, examples: v.examples }))
      .sort((a, b) => b.count - a.count)
      .slice(0, topN);
  }

  /** İssue'ları kategorize et — severity = düşük rating + sıklık */
  identifyIssues(reviews: ReviewInput[]): IssueReport[] {
    const out: IssueReport[] = [];
    for (const [category, keywords] of Object.entries(this.ISSUE_CATEGORIES)) {
      const matched: ReviewInput[] = [];
      for (const r of reviews) {
        const lower = r.text.toLowerCase();
        if (keywords.some(k => lower.includes(k))) matched.push(r);
      }
      if (matched.length === 0) continue;

      const avgRating = matched.reduce((s, r) => s + r.rating, 0) / matched.length;
      const ratio = matched.length / reviews.length;
      let severity: IssueReport['severity'];
      if (avgRating <= 2 && ratio > 0.1) severity = 'critical';
      else if (avgRating <= 3 && ratio > 0.05) severity = 'high';
      else if (ratio > 0.03) severity = 'medium';
      else severity = 'low';

      out.push({
        category,
        count: matched.length,
        severity,
        examples: matched.slice(0, 3).map(r => r.text.slice(0, 200)),
      });
    }
    return out.sort((a, b) => {
      const sevOrder = { critical: 4, high: 3, medium: 2, low: 1 };
      return sevOrder[b.severity] - sevOrder[a.severity];
    });
  }

  /** Feature request'leri yakala — 'wish', 'add', 'olsa', 'lazım' tipi cümleler */
  findFeatureRequests(reviews: ReviewInput[]): Array<{ text: string; rating: number }> {
    const patterns = [
      /(wish|hope|would (be|like)|add (a|an|the)|please|allow|olsa|lazım|eklenebilse|olabilseydi|eklenmesi|ihtiyaç)/i,
    ];
    return reviews
      .filter(r => patterns.some(p => p.test(r.text)))
      .map(r => ({ text: r.text.slice(0, 300), rating: r.rating }))
      .slice(0, 50);
  }

  /** Negatif review'lara stratejik cevap şablonu üret */
  generateResponseTemplates(issue: IssueReport, appName: string): string[] {
    const templates: Record<string, string[]> = {
      crash: [
        `Merhaba, ${appName} ekibi olarak çökme sorununu duyduğumuz için üzgünüz. Daha hızlı çözüm için cihaz modelinizi ve iOS/Android sürümünüzü support@... adresine iletebilir misiniz?`,
      ],
      performance: [
        `Geri bildiriminiz için teşekkürler. ${appName} v[yeni-sürüm] ile performans optimizasyonu çıkardık — güncellemeyi denerseniz fark eder.`,
      ],
      ads: [
        `Reklam deneyiminden memnun olmadığınızı duymak üzücü. Premium aboneliğiyle reklamları tamamen kaldırabilirsiniz, detay için ayarlar > abonelik.`,
      ],
      feature_missing: [
        `Öneriniz için teşekkürler! Talep ettiğiniz özelliği roadmap'imize ekledik, bir sonraki güncellemede önceliklendireceğiz.`,
      ],
    };
    return templates[issue.category] ?? [`Geri bildiriminiz için teşekkürler. ${appName} ekibi konuyu inceleyecek.`];
  }

  // ────────────────────────────────────────────────
  private calculateSentimentScore(text: string, rating: number): number {
    // Combined: rating ağırlıklı (60%) + lexicon (40%)
    const ratingScore = ((rating - 3) / 2) * 100; // 1→-100, 3→0, 5→100
    const lower = text.toLowerCase();
    const pos = this.POSITIVE_WORDS.filter(w => lower.includes(w)).length;
    const neg = this.NEGATIVE_WORDS.filter(w => lower.includes(w)).length;
    const lexicon = pos + neg === 0 ? 0 : ((pos - neg) / (pos + neg)) * 100;
    return ratingScore * 0.6 + lexicon * 0.4;
  }

  private categorizeSentiment(score: number): 'positive' | 'neutral' | 'negative' {
    if (score > 20) return 'positive';
    if (score < -20) return 'negative';
    return 'neutral';
  }
}
