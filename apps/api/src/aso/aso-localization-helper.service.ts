import { Injectable } from '@nestjs/common';

/**
 * Localization helper — pazar önceliklendirme + tahmini çeviri maliyeti + ROI.
 *
 * TypeScript port of claude-code-aso-skill/localization_helper.py (MIT).
 * Pazar metrikleri sabit referans değerlerden (App Store ekosistemi 2025).
 */

export type LocaleCode =
  | 'en-US' | 'es-ES' | 'es-MX' | 'fr-FR' | 'de-DE' | 'it-IT' | 'pt-BR' | 'pt-PT'
  | 'ja-JP' | 'ko-KR' | 'zh-CN' | 'zh-TW' | 'ru-RU' | 'tr-TR' | 'ar-SA'
  | 'hi-IN' | 'id-ID' | 'th-TH' | 'vi-VN' | 'nl-NL' | 'pl-PL' | 'sv-SE'
  | 'no-NO' | 'da-DK' | 'fi-FI';

export interface MarketProfile {
  locale: LocaleCode;
  language: string;
  country: string;
  market_size_tier: 'tier_1' | 'tier_2' | 'tier_3';   // app store revenue rank
  app_revenue_potential: 'very_high' | 'high' | 'medium' | 'low';
  english_proficiency: 'native' | 'high' | 'medium' | 'low';
  competition: 'low' | 'medium' | 'high';
}

const MARKETS: MarketProfile[] = [
  { locale: 'en-US', language: 'English (US)',        country: 'United States',  market_size_tier: 'tier_1', app_revenue_potential: 'very_high', english_proficiency: 'native', competition: 'high'   },
  { locale: 'zh-CN', language: 'Chinese (Simplified)',country: 'China',          market_size_tier: 'tier_1', app_revenue_potential: 'very_high', english_proficiency: 'low',    competition: 'high'   },
  { locale: 'ja-JP', language: 'Japanese',            country: 'Japan',          market_size_tier: 'tier_1', app_revenue_potential: 'very_high', english_proficiency: 'medium', competition: 'high'   },
  { locale: 'ko-KR', language: 'Korean',              country: 'South Korea',    market_size_tier: 'tier_1', app_revenue_potential: 'high',      english_proficiency: 'medium', competition: 'high'   },
  { locale: 'de-DE', language: 'German',              country: 'Germany',        market_size_tier: 'tier_1', app_revenue_potential: 'high',      english_proficiency: 'high',   competition: 'medium' },
  { locale: 'fr-FR', language: 'French',              country: 'France',         market_size_tier: 'tier_1', app_revenue_potential: 'high',      english_proficiency: 'high',   competition: 'medium' },
  { locale: 'es-ES', language: 'Spanish (Spain)',     country: 'Spain',          market_size_tier: 'tier_2', app_revenue_potential: 'medium',    english_proficiency: 'high',   competition: 'medium' },
  { locale: 'es-MX', language: 'Spanish (LatAm)',     country: 'Mexico/LatAm',   market_size_tier: 'tier_2', app_revenue_potential: 'medium',    english_proficiency: 'medium', competition: 'medium' },
  { locale: 'pt-BR', language: 'Portuguese (Brazil)', country: 'Brazil',         market_size_tier: 'tier_2', app_revenue_potential: 'medium',    english_proficiency: 'medium', competition: 'medium' },
  { locale: 'ru-RU', language: 'Russian',             country: 'Russia/CIS',     market_size_tier: 'tier_2', app_revenue_potential: 'medium',    english_proficiency: 'medium', competition: 'medium' },
  { locale: 'it-IT', language: 'Italian',             country: 'Italy',          market_size_tier: 'tier_2', app_revenue_potential: 'medium',    english_proficiency: 'high',   competition: 'medium' },
  { locale: 'tr-TR', language: 'Turkish',             country: 'Turkey',         market_size_tier: 'tier_2', app_revenue_potential: 'medium',    english_proficiency: 'medium', competition: 'low'    },
  { locale: 'ar-SA', language: 'Arabic',              country: 'GCC + MENA',     market_size_tier: 'tier_2', app_revenue_potential: 'medium',    english_proficiency: 'medium', competition: 'low'    },
  { locale: 'hi-IN', language: 'Hindi',               country: 'India',          market_size_tier: 'tier_2', app_revenue_potential: 'medium',    english_proficiency: 'high',   competition: 'low'    },
  { locale: 'id-ID', language: 'Indonesian',          country: 'Indonesia',      market_size_tier: 'tier_3', app_revenue_potential: 'low',       english_proficiency: 'medium', competition: 'low'    },
  { locale: 'th-TH', language: 'Thai',                country: 'Thailand',       market_size_tier: 'tier_3', app_revenue_potential: 'low',       english_proficiency: 'low',    competition: 'low'    },
  { locale: 'vi-VN', language: 'Vietnamese',          country: 'Vietnam',        market_size_tier: 'tier_3', app_revenue_potential: 'low',       english_proficiency: 'low',    competition: 'low'    },
  { locale: 'nl-NL', language: 'Dutch',               country: 'Netherlands',    market_size_tier: 'tier_3', app_revenue_potential: 'medium',    english_proficiency: 'native', competition: 'medium' },
];

// Yaklaşık çeviri maliyeti (USD) — tek tam set (title + subtitle + desc + keywords + 10 screenshot caption)
const TRANSLATION_COST: Partial<Record<LocaleCode, number>> = {
  'en-US': 0,        // zaten English (kaynak dil)
  'zh-CN': 220, 'ja-JP': 250, 'ko-KR': 220, 'de-DE': 180, 'fr-FR': 180,
  'es-ES': 150, 'es-MX': 140, 'pt-BR': 140, 'ru-RU': 160, 'it-IT': 170,
  'tr-TR': 130, 'ar-SA': 200, 'hi-IN': 140,
  'id-ID': 110, 'th-TH': 150, 'vi-VN': 120, 'nl-NL': 180,
};

@Injectable()
export class AsoLocalizationHelperService {
  /** Hedef pazarları öncelik sırasıyla döndür */
  identifyTargetMarkets(opts: { appCategory?: string; budgetUsd?: number; maxMarkets?: number } = {}): MarketProfile[] {
    const budget = opts.budgetUsd ?? Infinity;
    const max = opts.maxMarkets ?? 10;
    let cumulative = 0;
    const out: MarketProfile[] = [];

    const sorted = [...MARKETS].sort((a, b) => {
      const scoreA = this.marketScore(a);
      const scoreB = this.marketScore(b);
      return scoreB - scoreA;
    });

    for (const m of sorted) {
      const cost = TRANSLATION_COST[m.locale] ?? 200;
      if (cumulative + cost > budget) continue;
      out.push(m);
      cumulative += cost;
      if (out.length >= max) break;
    }
    return out;
  }

  /** Metnin çeviri maliyetini ve süre tahmini */
  estimateTranslationCost(text: string, targetLocale: LocaleCode): {
    locale: LocaleCode;
    word_count: number;
    estimated_usd: number;
    estimated_days: number;
  } {
    const words = (text.trim().match(/\b\w+\b/g) ?? []).length;
    const baseCost = TRANSLATION_COST[targetLocale] ?? 200;
    // 1000 word başına maliyet artar (lineer)
    const wordBonus = Math.max(0, (words - 500) / 1000) * 80;
    return {
      locale: targetLocale,
      word_count: words,
      estimated_usd: Math.round(baseCost + wordBonus),
      estimated_days: Math.max(1, Math.ceil(words / 1500)),
    };
  }

  /** Pazar bazlı keyword adaptasyon önerisi (sadece yapısal — gerçek çeviri AI tarafında) */
  adaptKeywords(keywords: string[], targetLocale: LocaleCode): {
    locale: LocaleCode;
    suggestions: Array<{ original: string; needs_translation: boolean; notes: string }>;
  } {
    const englishOnly = ['en-US'];
    const localized = !englishOnly.includes(targetLocale);
    return {
      locale: targetLocale,
      suggestions: keywords.map(k => ({
        original: k,
        needs_translation: localized,
        notes: localized
          ? `${targetLocale} için yerel transliteration + culture context çevirisi öneriyoruz`
          : 'Aynı kalır',
      })),
    };
  }

  /** Localization ROI: tahmini ek install × $LTV — çeviri maliyeti */
  calculateLocalizationROI(opts: {
    currentMonthlyInstalls: number;
    avgLtvUsd: number;
    targetMarket: LocaleCode;
    expectedUplift?: number;          // % (default 25%)
  }): {
    locale: LocaleCode;
    expected_extra_installs_month: number;
    extra_revenue_month_usd: number;
    translation_cost_usd: number;
    payback_months: number;
    rec: 'high_priority' | 'consider' | 'skip';
  } {
    const uplift = opts.expectedUplift ?? 25;
    const extraInstalls = Math.round(opts.currentMonthlyInstalls * (uplift / 100));
    const extraRevenue = Math.round(extraInstalls * opts.avgLtvUsd);
    const cost = TRANSLATION_COST[opts.targetMarket] ?? 200;
    const payback = extraRevenue > 0 ? Math.round((cost / extraRevenue) * 10) / 10 : 999;
    let rec: 'high_priority' | 'consider' | 'skip';
    if (payback <= 3) rec = 'high_priority';
    else if (payback <= 12) rec = 'consider';
    else rec = 'skip';
    return {
      locale: opts.targetMarket,
      expected_extra_installs_month: extraInstalls,
      extra_revenue_month_usd: extraRevenue,
      translation_cost_usd: cost,
      payback_months: payback,
      rec,
    };
  }

  /** Tüm pazar profillerini listele (UI için) */
  listMarkets(): MarketProfile[] {
    return [...MARKETS];
  }

  private marketScore(m: MarketProfile): number {
    const revenueWeight = { very_high: 100, high: 75, medium: 50, low: 25 }[m.app_revenue_potential];
    const tierBonus = { tier_1: 30, tier_2: 15, tier_3: 0 }[m.market_size_tier];
    const proficiencyPenalty = { native: 30, high: 20, medium: 10, low: 0 }[m.english_proficiency];
    // english_proficiency düşük → localization daha yüksek değer
    return revenueWeight + tierBonus + (30 - proficiencyPenalty);
  }
}
