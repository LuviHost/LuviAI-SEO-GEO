import { Injectable } from '@nestjs/common';
import { probeUrl } from './axo-fetch.js';
import { schemaTypesOf, isOrganizationType, isLocalBusinessType } from './schema-org-types.js';
import { validateLocalBusiness } from './local-business-validate.js';

export interface SchemaValidationResult {
  url: string;
  valid: boolean;
  schemaCount: number;
  types: string[];
  warnings: string[];
  errors: string[];
  recommendations: string[];
  /** Sayfaya erisim engellendi ya da ulasilamadi — sonuc OLCULEMEDI (sayfa "sorunlu" degil) */
  blocked?: { reason: string; hint: string; status: number } | null;
}

/** Ust duzey dugumler: dizi ve @graph acilir; ic ice nesneler (publisher vb.) ayrica denetlenmez */
function topLevelNodes(parsed: unknown): any[] {
  if (Array.isArray(parsed)) return parsed.flatMap(topLevelNodes);
  if (parsed && typeof parsed === 'object') {
    const graph = (parsed as any)['@graph'];
    if (Array.isArray(graph)) return graph.flatMap(topLevelNodes);
    return [parsed];
  }
  return [];
}

/**
 * Schema Validator — sayfanin JSON-LD'lerini cikarir, schema.org / Google
 * kurallarina gore sezgisel olarak denetler.
 *
 * Istek safeFetchText ile (SSRF korumali — URL kullanicidan gelir; durust
 * RanksUpBot kimligi). Engel / ulasilamazlik "sayfa sorunlu" diye
 * raporlanmaz: blocked alani ve site sahibine izin ipucu doner.
 *
 * LocalBusiness alan dogrulamasi (adres, telefon, saatler, geo, priceRange,
 * url, image) SEO bulgusudur; AXO puanina girmez (local-business-validate.ts).
 * Organization alt turleri schema-org-types.ts'ten taninir.
 */
@Injectable()
export class SchemaValidatorService {
  async validate(url: string): Promise<SchemaValidationResult> {
    const result: SchemaValidationResult = {
      url,
      valid: false,
      schemaCount: 0,
      types: [],
      warnings: [],
      errors: [],
      recommendations: [],
      blocked: null,
    };

    // 2 MB tavan — JSON-LD genelde <head>'de, bazen govde sonunda; 2 MB ikisini de kapsar.
    const page = await probeUrl(url, { accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8', maxBytes: 2 * 1024 * 1024, timeoutMs: 15_000 });
    if (page.state === 'blocked' || page.state === 'unreachable') {
      result.blocked = { reason: page.block?.reason ?? 'Sayfaya erişilemedi.', hint: page.block?.hint ?? '', status: page.status };
      result.errors.push(`Ölçülemedi: ${result.blocked.reason} ${result.blocked.hint}`.trim());
      return result;
    }
    if (page.state !== 'ok') {
      result.errors.push(`HTTP ${page.status} — sayfaya ulaşılamadı`);
      return result;
    }
    const html = page.text;

    // JSON-LD'leri cikar — ham metin geo hassasiyeti icin saklanir (JSON.parse sondaki sifiri dusurur)
    const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    const blocks: Array<{ raw: string; nodes: any[] }> = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      const raw = m[1].trim();
      try {
        blocks.push({ raw, nodes: topLevelNodes(JSON.parse(raw)) });
      } catch (err: any) {
        result.errors.push(`JSON-LD ayrıştırma hatası: ${String(err.message).slice(0, 80)}`);
      }
    }

    const schemas = blocks.flatMap((b) => b.nodes);
    result.schemaCount = schemas.length;
    if (schemas.length === 0) {
      result.errors.push('Sayfada hiç JSON-LD schema bulunamadı');
      return result;
    }

    // Tipleri topla + her schema icin denetle
    const types = new Set<string>();
    for (const b of blocks) {
      for (const s of b.nodes) {
        schemaTypesOf(s).forEach((t) => types.add(t));
        this.validateSingle(s, result);
        // LocalBusiness alan denetimi — SEO bulgusu
        for (const f of validateLocalBusiness(s, b.raw)) {
          (f.level === 'error' ? result.errors : f.level === 'warning' ? result.warnings : result.recommendations).push(f.message);
        }
      }
    }
    result.types = [...types];

    // Oneriler — yalniz dogrulanabilir faydasi olanlar:
    // Article: https://developers.google.com/search/docs/appearance/structured-data/article
    // Breadcrumb: https://developers.google.com/search/docs/appearance/structured-data/breadcrumb
    // Organization: https://developers.google.com/search/docs/appearance/structured-data/organization
    if (!types.has('Article') && !types.has('BlogPosting') && !types.has('NewsArticle')) {
      result.recommendations.push('Makale sayfasıysa Article ya da BlogPosting ekleyin — Google\'ın sayfayı daha iyi anlamasına ve başlık, görsel, tarih bilgisini daha doğru göstermesine yardımcı olabilir.');
    }
    if (!types.has('BreadcrumbList')) {
      result.recommendations.push('BreadcrumbList ekleyin — Google, breadcrumb işaretlemesini sayfayı arama sonuçlarında kategorize etmek için kullanır.');
    }
    if (![...types].some(isOrganizationType)) {
      result.recommendations.push('Organization (ya da işletmene uyan alt türü, ör. LocalBusiness / HairSalon / Dentist) + sameAs ekleyin — Google\'ın kurumunu daha iyi anlamasına ve arama sonuçlarında ayırt etmesine yardımcı olabilir.');
    }
    // Google SSS zengin sonuclarini 7 Mayis 2026'da kaldirdi; HowTo 2023'te kalkti.
    // https://developers.google.com/search/docs/appearance/structured-data/faqpage (degisiklik kaydi)
    // https://ppc.land/google-kills-faq-rich-results-what-seos-saw-coming-since-2019/
    if (types.has('FAQPage')) {
      result.recommendations.push('FAQPage: Google, SSS zengin sonuçlarını 7 Mayıs 2026\'da kaldırdı; işaretleme zararsız ama Google aramada artık açılır SSS görünümü üretmiyor.');
    }
    if (types.has('HowTo')) {
      result.recommendations.push('HowTo: Google, HowTo zengin sonuçlarını Eylül 2023\'te masaüstü ve mobilde göstermeyi bıraktı.');
    }

    result.valid = result.errors.length === 0;
    return result;
  }

  private validateSingle(schema: any, result: SchemaValidationResult): void {
    const types = schemaTypesOf(schema);
    const type = types[0] ?? String(schema?.['@type'] ?? '?');
    const ctx = schema?.['@context'];
    const is = (...names: string[]) => types.some((t) => names.includes(t));

    if (ctx !== undefined && !String(typeof ctx === 'object' ? JSON.stringify(ctx) : ctx).includes('schema.org')) {
      result.warnings.push(`@context "schema.org" değil (type=${type})`);
    }

    if (is('Article', 'BlogPosting', 'NewsArticle')) {
      if (!schema.headline) result.errors.push(`${type}: headline eksik`);
      if (!schema.datePublished) result.errors.push(`${type}: datePublished eksik`);
      if (!schema.author) result.errors.push(`${type}: author eksik`);
      if (!schema.publisher) result.warnings.push(`${type}: publisher eksik`);
      if (typeof schema.headline === 'string' && schema.headline.length > 110) {
        result.warnings.push(`${type}: headline 110 karakteri aşıyor (Google kesebilir)`);
      }
    }

    if (is('FAQPage')) {
      if (!Array.isArray(schema.mainEntity)) {
        result.errors.push('FAQPage: mainEntity dizisi eksik');
      } else {
        for (const q of schema.mainEntity) {
          if (!schemaTypesOf(q).includes('Question')) result.warnings.push('FAQPage: Question @type eksik');
          if (!q?.name) result.errors.push('FAQPage: Question.name eksik');
          if (!q?.acceptedAnswer?.text) result.errors.push('FAQPage: acceptedAnswer.text eksik');
        }
      }
    }

    if (is('BreadcrumbList')) {
      if (!Array.isArray(schema.itemListElement) || schema.itemListElement.length < 2) {
        result.warnings.push('BreadcrumbList: en az 2 itemListElement önerilir');
      }
    }

    // Organization ailesi (alt turler dahil). LocalBusiness alanlarini
    // local-business-validate.ts denetler; ayni bulguyu iki kez yazmayalim.
    if (types.some(isOrganizationType) && !types.some(isLocalBusinessType)) {
      if (!schema.name) result.errors.push(`${type}: name eksik`);
      if (!schema.url) result.errors.push(`${type}: url eksik`);
    }
    if (types.some(isOrganizationType) && (!Array.isArray(schema.sameAs) || schema.sameAs.length === 0) && typeof schema.sameAs !== 'string') {
      result.recommendations.push(`${type}: sameAs ekleyin (sosyal profil / Wikidata bağlantıları)`);
    }

    if (is('HowTo')) {
      if (!Array.isArray(schema.step) || schema.step.length === 0) {
        result.errors.push('HowTo: step listesi eksik');
      }
    }
  }
}
