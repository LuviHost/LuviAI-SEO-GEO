import { Injectable } from '@nestjs/common';
import { foldForMatch, escapeRegex } from '../common/text-normalize.js';
import { countCharacters, countBytes } from './keyword-field-audit.js';

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
  promotional_text?: number;  // Apple: 170 karakter (ASC referansi)
  whats_new?: number;         // Apple: 4000 karakter (ASC referansi)
}

const LIMITS: Record<Platform, MetadataLimits> = {
  apple:  { title: 30, subtitle: 30, description: 4000, keyword_field: 100, promotional_text: 170, whats_new: 4000 },
  google: { title: 30, short_description: 80, description: 4000 },
};

/** Eslesme icin kelimeler — Turkce harf guvenli (\w ASCII'dir: "çiçek" → ["i","ek"]) */
const wordsOf = (s: string) => foldForMatch(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

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

  /**
   * Apple keyword field (100 KARAKTER — bkz. keyword-field-audit.ts: Apple'in
   * "100 bayt" ifadesi ASC'de uygulanmiyor) — virgulle, bosluksuz; title'daki
   * kelimeler ve tekrarlar atlanir.
   *
   * Eskiden toLowerCase() kullaniyordu: "İzmir" → "i̇zmir" (gorunmez U+0307 ile
   * 6 karakter) — hem alan israfi hem bozuk kelime. Artik yazim korunur,
   * karsilastirma foldForMatch ile yapilir.
   */
  optimizeKeywordField(
    keywords: string[],
    titleWords: string[] = [],
  ): { keyword_field: string; length: number; remaining: number; used: string[]; skipped: string[] } {
    const limit = LIMITS.apple.keyword_field!;
    const titleSet = new Set(titleWords.flatMap((w) => wordsOf(w)));
    const seen = new Set<string>();
    const used: string[] = [];
    const skipped: string[] = [];
    let field = '';

    for (const kw of keywords) {
      const clean = (kw ?? '').replace(/\s+/g, ' ').trim();
      if (!clean) continue;
      // Title'da geçen kelimeleri atla (karsilastirma katlanmis, yazim korunur)
      const final = clean.split(' ').filter((w) => !wordsOf(w).every((f) => titleSet.has(f))).join(' ');
      const key = wordsOf(final).join(' ');
      if (!final || !key || seen.has(key)) {
        skipped.push(kw);
        continue;
      }
      const candidate = field ? `${field},${final}` : final;
      if (countCharacters(candidate) <= limit) {
        field = candidate;
        seen.add(key);
        used.push(kw);
      } else {
        skipped.push(kw);
      }
    }

    const length = countCharacters(field);
    return {
      keyword_field: field,
      length,
      remaining: limit - length,
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
    promotional_text?: string;
    whats_new?: string;
  }): ValidationReport[] {
    const limits = LIMITS[metadata.platform];
    const reports: ValidationReport[] = [];
    const check = (field: string, value: string | undefined, limit: number | undefined) => {
      if (limit === undefined || value === undefined) return;
      const len = countCharacters(value);
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
          : field === 'keyword_field' && countBytes(value) > limit
          ? `OK (${countBytes(value)} bayt — Apple'ın bir belgesi 100 bayt diyor; ASC 100 karakteri kabul ediyor)`
          : 'OK',
      });
    };
    check('title', metadata.title, limits.title);
    if (limits.subtitle !== undefined) check('subtitle', metadata.subtitle, limits.subtitle);
    if (limits.short_description !== undefined) check('short_description', metadata.short_description, limits.short_description);
    check('description', metadata.description, limits.description);
    if (limits.keyword_field !== undefined) check('keyword_field', metadata.keyword_field, limits.keyword_field);
    if (limits.promotional_text !== undefined) check('promotional_text', metadata.promotional_text, limits.promotional_text);
    if (limits.whats_new !== undefined) check('whats_new', metadata.whats_new, limits.whats_new);
    return reports;
  }

  /**
   * Description içindeki keyword yoğunluğu (%).
   * Eskiden \b\w+\b ile sayiyordu — \w ASCII oldugu icin "çiçek açtı"
   * ["i","ek","a","t"] sayiliyordu; Turkce metinde hem toplam hem eslesme yanlisti.
   */
  calculateKeywordDensity(text: string, keywords: string[]): Record<string, number> {
    const words = wordsOf(text);
    const total = words.length;
    if (total === 0) return {};
    const hay = ` ${words.join(' ')} `;
    const out: Record<string, number> = {};
    for (const kw of keywords) {
      const needle = wordsOf(kw).join(' ');
      const hits = needle ? (hay.match(new RegExp(` ${escapeRegex(needle)}(?= )`, 'g')) ?? []).length : 0;
      out[kw] = Math.round((hits / total) * 1000) / 10;
    }
    return out;
  }
}
