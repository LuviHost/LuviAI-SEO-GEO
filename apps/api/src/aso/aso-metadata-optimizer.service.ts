import { Injectable } from '@nestjs/common';

/**
 * Metadata optimizer — title/subtitle/description/keyword field için
 * platform-aware optimizasyon kuralları.
 *
 * TypeScript port of claude-code-aso-skill/metadata_optimizer.py (MIT).
 */

export type Platform = 'apple' | 'google';

export interface MetadataLimits {
  title: number;
  subtitle?: number;
  short_description?: number;
  description: number;
  keyword_field?: number;
}

const LIMITS: Record<Platform, MetadataLimits> = {
  apple:  { title: 30, subtitle: 30, description: 4000, keyword_field: 100 },
  google: { title: 30, short_description: 80, description: 4000 },
};

export interface OptimizeTitleInput {
  brand: string;
  keywords: string[];     // hedef anahtar kelimeler, öncelik sırası
  platform: Platform;
}

export interface OptimizeTitleResult {
  optimized_title: string;
  length: number;
  remaining: number;
  keywords_included: string[];
  keywords_truncated: string[];
  warnings: string[];
}

export interface OptimizeDescriptionInput {
  intro: string;          // 1-2 cümle hook
  features: string[];     // 5-10 madde
  socialProof?: string;   // "1M+ kullanıcı, 4.8 yıldız..."
  cta?: string;           // "Hemen indir, ücretsiz"
  keywords: string[];     // önemli olanlar dağıtılarak yerleştirilir
  platform: Platform;
}

export interface ValidationReport {
  field: string;
  ok: boolean;
  length: number;
  limit: number;
  message: string;
}

@Injectable()
export class AsoMetadataOptimizerService {
  /** Title'ı brand + keyword'lerle 30-karakter limitine sığacak şekilde inşa et */
  optimizeTitle(input: OptimizeTitleInput): OptimizeTitleResult {
    const limit = LIMITS[input.platform].title;
    const included: string[] = [];
    const truncated: string[] = [];
    const warnings: string[] = [];

    // Brand prefix
    let title = input.brand.trim();
    if (title.length > limit) {
      warnings.push(`Marka adı tek başına ${title.length} karakter — title limitini aşıyor (${limit}).`);
      return {
        optimized_title: title.slice(0, limit),
        length: limit, remaining: 0,
        keywords_included: [], keywords_truncated: input.keywords,
        warnings,
      };
    }

    // Sırayla keyword ekle (": " separator)
    for (const kw of input.keywords) {
      const candidate = title.length === input.brand.length ? `${title}: ${kw}` : `${title} ${kw}`;
      if (candidate.length <= limit) {
        title = candidate;
        included.push(kw);
      } else {
        truncated.push(kw);
      }
    }

    if (included.length === 0) {
      warnings.push('Hiçbir keyword title\'a sığmadı — kısaltılmış varyasyon dene.');
    }

    return {
      optimized_title: title,
      length: title.length,
      remaining: limit - title.length,
      keywords_included: included,
      keywords_truncated: truncated,
      warnings,
    };
  }

  /** Description'ı 4000 karakter limitiyle bloklu oluştur */
  optimizeDescription(input: OptimizeDescriptionInput): {
    description: string;
    length: number;
    keyword_density: Record<string, number>;
  } {
    const parts: string[] = [];
    parts.push(input.intro.trim());
    parts.push('');
    parts.push('✨ ÖZELLİKLER:');
    for (const f of input.features) parts.push(`• ${f.trim()}`);
    if (input.socialProof) {
      parts.push('');
      parts.push(input.socialProof.trim());
    }
    if (input.cta) {
      parts.push('');
      parts.push(input.cta.trim());
    }

    let description = parts.join('\n').trim();
    const limit = LIMITS[input.platform].description;
    if (description.length > limit) {
      description = description.slice(0, limit - 3) + '...';
    }

    return {
      description,
      length: description.length,
      keyword_density: this.calculateKeywordDensity(description, input.keywords),
    };
  }

  /** Apple keyword field (100 char) — virgülle ayrılmış, brand/title kelimelerini tekrar etme */
  optimizeKeywordField(
    keywords: string[],
    titleWords: string[] = [],
  ): { keyword_field: string; length: number; remaining: number; used: string[]; skipped: string[] } {
    const limit = 100;
    const titleLower = new Set(titleWords.map(w => w.toLowerCase()));
    const used: string[] = [];
    const skipped: string[] = [];
    let field = '';

    for (const kw of keywords) {
      const clean = kw.trim().toLowerCase();
      if (!clean) continue;
      // Title'da geçen tekil kelimeleri atla
      const words = clean.split(/\s+/);
      const noveltyParts = words.filter(w => !titleLower.has(w));
      const final = noveltyParts.join(' ').trim();
      if (!final) {
        skipped.push(kw);
        continue;
      }
      const candidate = field ? `${field},${final}` : final;
      if (candidate.length <= limit) {
        field = candidate;
        used.push(kw);
      } else {
        skipped.push(kw);
      }
    }

    return {
      keyword_field: field,
      length: field.length,
      remaining: limit - field.length,
      used,
      skipped,
    };
  }

  /** Tüm metadata alanlarını validate et — limit aşımı + boşluk uyarıları */
  validateCharacterLimits(metadata: {
    platform: Platform;
    title?: string;
    subtitle?: string;
    short_description?: string;
    description?: string;
    keyword_field?: string;
  }): ValidationReport[] {
    const limits = LIMITS[metadata.platform];
    const reports: ValidationReport[] = [];
    const check = (field: string, value: string | undefined, limit: number | undefined) => {
      if (limit === undefined || value === undefined) return;
      const len = value.length;
      const ok = len > 0 && len <= limit;
      reports.push({
        field,
        ok,
        length: len,
        limit,
        message: len === 0
          ? `${field} boş`
          : len > limit
          ? `${field} ${len - limit} karakter fazla`
          : len < limit * 0.5
          ? `${field} kısa — ${limit - len} karakterlik alan boş`
          : 'OK',
      });
    };
    check('title', metadata.title, limits.title);
    if (limits.subtitle !== undefined) check('subtitle', metadata.subtitle, limits.subtitle);
    if (limits.short_description !== undefined) check('short_description', metadata.short_description, limits.short_description);
    check('description', metadata.description, limits.description);
    if (limits.keyword_field !== undefined) check('keyword_field', metadata.keyword_field, limits.keyword_field);
    return reports;
  }

  /** Description içindeki keyword yoğunluğu (%) */
  calculateKeywordDensity(text: string, keywords: string[]): Record<string, number> {
    const total = (text.match(/\b\w+\b/g) ?? []).length;
    if (total === 0) return {};
    const lower = text.toLowerCase();
    const out: Record<string, number> = {};
    for (const kw of keywords) {
      const re = new RegExp('\\b' + escapeRegex(kw.toLowerCase()) + '\\b', 'g');
      const hits = (lower.match(re) ?? []).length;
      out[kw] = Math.round((hits / total) * 1000) / 10;
    }
    return out;
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
