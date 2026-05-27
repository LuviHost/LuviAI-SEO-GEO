import { Injectable } from '@nestjs/common';

/**
 * Keyword analyzer — search volume, competition, difficulty, opportunity score.
 *
 * TypeScript port of claude-code-aso-skill/keyword_analyzer.py (MIT, alirezarezvani).
 * Rule-based (no external API): kullanıcı keyword için tahmini metrikleri girer,
 * service difficulty + potential + recommendation döndürür.
 */

export interface KeywordAnalysisInput {
  keyword: string;
  competing_apps?: number;     // bu keyword için rekabet eden app sayısı
  search_volume?: number;      // 0-100 endeks (App Store/Play API'lerinden tahmin)
  current_rank?: number | null; // bizim app'in mevcut sırası (1..N veya null)
  app_relevance?: number;      // 0..1 — app içeriğinin keyword'le ilgisi
}

export interface KeywordAnalysisResult {
  keyword: string;
  competition_level: 'low' | 'medium' | 'high' | 'very_high';
  search_volume_tier: 'minimal' | 'low' | 'medium' | 'high' | 'very_high';
  difficulty: number;        // 0..100
  potential_score: number;   // 0..100
  current_rank: number | null;
  recommendation: 'easy_win' | 'high_priority' | 'medium_priority' | 'low_priority' | 'avoid';
  reasoning: string;
}

@Injectable()
export class AsoKeywordAnalyzerService {
  analyzeKeyword(input: KeywordAnalysisInput): KeywordAnalysisResult {
    const competing = input.competing_apps ?? 0;
    const volume = input.search_volume ?? 0;
    const relevance = clamp(input.app_relevance ?? 0.5, 0, 1);

    const competition = this.competitionLevel(competing);
    const volumeTier = this.volumeTier(volume);
    const difficulty = this.calculateDifficulty(competing, volume);
    const potential = this.calculatePotential(volume, relevance, difficulty);
    const { recommendation, reasoning } = this.recommend(competition, volumeTier, difficulty, potential, input.current_rank ?? null);

    return {
      keyword: input.keyword,
      competition_level: competition,
      search_volume_tier: volumeTier,
      difficulty,
      potential_score: potential,
      current_rank: input.current_rank ?? null,
      recommendation,
      reasoning,
    };
  }

  /** Birden çok keyword'ı analiz et + top fırsatları sırala */
  compareKeywords(inputs: KeywordAnalysisInput[]): {
    analyses: KeywordAnalysisResult[];
    top_opportunities: KeywordAnalysisResult[];
    easy_wins: KeywordAnalysisResult[];
    summary: string;
  } {
    const analyses = inputs.map(i => this.analyzeKeyword(i));
    const sorted = [...analyses].sort((a, b) => b.potential_score - a.potential_score);
    const topOpps = sorted.filter(a => a.potential_score >= 60).slice(0, 10);
    const easyWins = sorted.filter(a => a.recommendation === 'easy_win');
    const avgDifficulty = analyses.reduce((s, a) => s + a.difficulty, 0) / Math.max(analyses.length, 1);
    return {
      analyses,
      top_opportunities: topOpps,
      easy_wins: easyWins,
      summary: `${analyses.length} keyword analiz edildi. Ortalama difficulty: ${Math.round(avgDifficulty)}/100. Top fırsat: ${topOpps[0]?.keyword ?? '—'}.`,
    };
  }

  /** Long-tail keyword fırsatlarını bul (low-comp + relevance > 0.7) */
  findLongTailOpportunities(inputs: KeywordAnalysisInput[]): KeywordAnalysisResult[] {
    return inputs
      .map(i => this.analyzeKeyword(i))
      .filter(a =>
        (a.competition_level === 'low' || a.competition_level === 'medium') &&
        a.potential_score >= 50,
      )
      .sort((a, b) => b.potential_score - a.potential_score);
  }

  /** Metin içinden potansiyel keyword'leri çıkar — basit token + stop-word filtresi */
  extractKeywordsFromText(text: string, minLength = 3, maxResults = 20): Array<{ keyword: string; count: number }> {
    const stopWords = new Set([
      'and', 'the', 'for', 'with', 'this', 'that', 'your', 'you', 'are', 'app',
      've', 'ile', 'için', 'bir', 'bu', 'şu', 'gibi', 'ama', 'ya', 'da', 'de',
    ]);
    const words = text.toLowerCase().match(/\b[a-zçğıöşü]{2,}\b/g) ?? [];
    const counts = new Map<string, number>();
    for (const w of words) {
      if (w.length < minLength || stopWords.has(w)) continue;
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([keyword, count]) => ({ keyword, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, maxResults);
  }

  /** Belirli keyword'lerin metindeki yoğunluğunu hesapla (yüzde) */
  calculateKeywordDensity(text: string, keywords: string[]): Record<string, number> {
    const totalWords = (text.match(/\b\w+\b/g) ?? []).length;
    if (totalWords === 0) return {};
    const lower = text.toLowerCase();
    const out: Record<string, number> = {};
    for (const kw of keywords) {
      const re = new RegExp('\\b' + escapeRegex(kw.toLowerCase()) + '\\b', 'g');
      const hits = (lower.match(re) ?? []).length;
      out[kw] = round1((hits / totalWords) * 100);
    }
    return out;
  }

  // ────────────────────────────────────────────────────────
  // private helpers
  // ────────────────────────────────────────────────────────

  private competitionLevel(competing: number): 'low' | 'medium' | 'high' | 'very_high' {
    if (competing < 100) return 'low';
    if (competing < 1000) return 'medium';
    if (competing < 10000) return 'high';
    return 'very_high';
  }

  private volumeTier(volume: number): 'minimal' | 'low' | 'medium' | 'high' | 'very_high' {
    if (volume < 10) return 'minimal';
    if (volume < 30) return 'low';
    if (volume < 50) return 'medium';
    if (volume < 75) return 'high';
    return 'very_high';
  }

  private calculateDifficulty(competing: number, volume: number): number {
    // Linear blend — competing daha ağır (0.6) çünkü direkt göstergedir.
    const compScore = Math.min(100, (competing / 100));      // 100 = max
    const volScore = volume;                                  // 0..100
    return Math.round(compScore * 0.6 + volScore * 0.4);
  }

  private calculatePotential(volume: number, relevance: number, difficulty: number): number {
    // Yüksek volume + yüksek relevance + düşük difficulty = yüksek potansiyel
    const easeBonus = 100 - difficulty;
    return Math.round(volume * 0.45 + relevance * 100 * 0.35 + easeBonus * 0.20);
  }

  private recommend(
    comp: ReturnType<AsoKeywordAnalyzerService['competitionLevel']>,
    vol: ReturnType<AsoKeywordAnalyzerService['volumeTier']>,
    difficulty: number,
    potential: number,
    currentRank: number | null,
  ): { recommendation: KeywordAnalysisResult['recommendation']; reasoning: string } {
    // Easy win: zaten ilk 50'desin + düşük rekabet → metadata refine ile top 10'a taşı
    if (currentRank !== null && currentRank <= 50 && (comp === 'low' || comp === 'medium')) {
      return {
        recommendation: 'easy_win',
        reasoning: `Mevcut sıralama ${currentRank} + ${comp} rekabet → metadata refine ile top 10'a taşıma şansı yüksek.`,
      };
    }
    if (potential >= 75 && difficulty <= 60) {
      return { recommendation: 'high_priority', reasoning: `Yüksek potansiyel (${potential}/100) + ulaşılabilir difficulty (${difficulty}/100).` };
    }
    if (potential >= 50) {
      return { recommendation: 'medium_priority', reasoning: `Orta potansiyel (${potential}/100). Yan keyword olarak değerlendir.` };
    }
    if (vol === 'minimal' || comp === 'very_high') {
      return { recommendation: 'avoid', reasoning: `${vol === 'minimal' ? 'Çok düşük arama hacmi' : 'Çok yüksek rekabet'} → odaklanmaya değmez.` };
    }
    return { recommendation: 'low_priority', reasoning: `Düşük potansiyel (${potential}/100). Long-tail varyasyonlarına bak.` };
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
