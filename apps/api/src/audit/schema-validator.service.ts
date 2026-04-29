import { Injectable, Logger } from '@nestjs/common';

export interface SchemaValidationResult {
  url: string;
  valid: boolean;
  schemaCount: number;
  types: string[];
  warnings: string[];
  errors: string[];
  recommendations: string[];
}

/**
 * Schema Validator — published makalenin URL'inden HTML cek, JSON-LD'leri
 * extract et, schema.org'a uygun mu validate et.
 *
 * Validator API olarak validator.schema.org kullaniyor (Google'in eski Structured
 * Data Testing Tool yerine). Bagimsiz validation icin kendi heuristic'imiz var.
 */
@Injectable()
export class SchemaValidatorService {
  private readonly log = new Logger(SchemaValidatorService.name);

  async validate(url: string): Promise<SchemaValidationResult> {
    const result: SchemaValidationResult = {
      url,
      valid: false,
      schemaCount: 0,
      types: [],
      warnings: [],
      errors: [],
      recommendations: [],
    };

    let html = '';
    try {
      const res = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(15_000),
        headers: { 'User-Agent': 'LuviAI-SchemaValidator/1.0' },
      });
      if (!res.ok) {
        result.errors.push(`HTTP ${res.status} — sayfaya ulasilamadi`);
        return result;
      }
      html = await res.text();
    } catch (err: any) {
      result.errors.push(`Fetch fail: ${err.message}`);
      return result;
    }

    // JSON-LD'leri extract et
    const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    const schemas: any[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      try {
        const json = JSON.parse(m[1].trim());
        if (Array.isArray(json)) schemas.push(...json);
        else schemas.push(json);
      } catch (err: any) {
        result.errors.push(`JSON-LD parse error: ${err.message.slice(0, 80)}`);
      }
    }

    result.schemaCount = schemas.length;
    if (schemas.length === 0) {
      result.errors.push('Sayfada hiç JSON-LD schema bulunamadi');
      return result;
    }

    // Tipleri topla + her schema icin validate
    const types = new Set<string>();
    for (const s of schemas) {
      const type = s['@type'];
      if (Array.isArray(type)) type.forEach((t) => types.add(String(t)));
      else if (type) types.add(String(type));

      // Heuristic kontroller
      this.validateSingle(s, result);
    }
    result.types = [...types];

    // Recommendations
    if (!types.has('Article') && !types.has('BlogPosting') && !types.has('NewsArticle')) {
      result.recommendations.push('Article veya BlogPosting schema ekleyin (AI search basamak ICIN OneCelikli)');
    }
    if (!types.has('BreadcrumbList')) {
      result.recommendations.push('BreadcrumbList ekleyin (Google rich result icin gerekli)');
    }
    if (!types.has('FAQPage') && !types.has('QAPage')) {
      result.recommendations.push('FAQPage ekleyin (AI Citation skoru artar)');
    }
    if (!types.has('Speakable')) {
      result.recommendations.push('Speakable schema ekleyin (Siri/Alexa/Google Assistant icin)');
    }
    if (!types.has('Organization')) {
      result.recommendations.push('Organization schema + sameAs ekleyin (Knowledge Graph icin)');
    }

    result.valid = result.errors.length === 0;
    return result;
  }

  private validateSingle(schema: any, result: SchemaValidationResult): void {
    const type = schema['@type'];
    const ctx = schema['@context'];

    if (!ctx || !String(ctx).includes('schema.org')) {
      result.warnings.push(`@context "schema.org" degil (type=${type})`);
    }

    if (type === 'Article' || type === 'BlogPosting' || type === 'NewsArticle') {
      if (!schema.headline) result.errors.push(`${type}: headline eksik`);
      if (!schema.datePublished) result.errors.push(`${type}: datePublished eksik`);
      if (!schema.author) result.errors.push(`${type}: author eksik`);
      if (!schema.publisher) result.warnings.push(`${type}: publisher eksik`);
      if (schema.headline && schema.headline.length > 110) {
        result.warnings.push(`${type}: headline 110 karakteri aşıyor (Google kesebilir)`);
      }
    }

    if (type === 'FAQPage') {
      if (!Array.isArray(schema.mainEntity)) {
        result.errors.push('FAQPage: mainEntity dizisi eksik');
      } else {
        for (const q of schema.mainEntity) {
          if (q['@type'] !== 'Question') result.warnings.push('FAQPage: Question @type eksik');
          if (!q.name) result.errors.push('FAQPage: Question.name eksik');
          if (!q.acceptedAnswer?.text) result.errors.push('FAQPage: acceptedAnswer.text eksik');
        }
      }
    }

    if (type === 'BreadcrumbList') {
      if (!Array.isArray(schema.itemListElement) || schema.itemListElement.length < 2) {
        result.warnings.push('BreadcrumbList: en az 2 itemListElement onerilir');
      }
    }

    if (type === 'Organization') {
      if (!schema.name) result.errors.push('Organization: name eksik');
      if (!schema.url) result.errors.push('Organization: url eksik');
      if (!Array.isArray(schema.sameAs) || schema.sameAs.length === 0) {
        result.recommendations.push('Organization: sameAs ekleyin (Twitter/LinkedIn/Wikidata bağlantıları)');
      }
    }

    if (type === 'HowTo') {
      if (!Array.isArray(schema.step) || schema.step.length === 0) {
        result.errors.push('HowTo: step listesi eksik');
      }
    }
  }
}
