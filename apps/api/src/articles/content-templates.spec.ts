import { describe, it, expect } from 'vitest';
import {
  AGENT_TOPIC_RANKER,
  CONTENT_TYPES,
  classifyTopicTitle,
  contentTemplateBlock,
  contentTypeFromSchemaType,
  normalizeContentType,
  resolveContentType,
  withContentTemplate,
} from '@luviai/shared';

/**
 * Icerik tipi sablonlari (GEO Faz 4). Tip yoksa / belirlenemezse 'guide' ve
 * 'guide' icin prompt'a HICBIR sey eklenmez: tipi olmayan konu bugunku
 * prompt'larla birebir ayni yazilir.
 */
describe('classifyTopicTitle — Turkce + Ingilizce baslik siniflandirici', () => {
  const cases: Array<[string, string | null]> = [
    ['Shopify vs WooCommerce: Hangisi Daha İyi?', 'comparison'],
    ['Shopify mı WooCommerce mi?', 'comparison'],
    ['Hosting ile VPS arasındaki fark nedir?', 'comparison'],
    ['KDV ile ÖTV farkı', 'comparison'],
    ['Paraşüt ve Logo karşılaştırması', 'comparison'],
    ['Notion vs. Obsidian', 'comparison'],
    ['En İyi 7 Muhasebe Programı', 'best_for'],
    ['Küçük işletmeler için en uygun POS cihazı', 'best_for'],
    ['Best CRM for startups', 'best_for'],
    ['Shopify Alternatifleri 2026', 'alternatives'],
    ['Canva yerine ne kullanılır?', 'alternatives'],
    ['Notion alternatives', 'alternatives'],
    ['En iyi 10 Shopify alternatifi', 'alternatives'],
    ['Paraşüt Fiyatları 2026', 'pricing'],
    ['Shopify ücretleri ne kadar?', 'pricing'],
    ['Webflow pricing explained', 'pricing'],
    ['KDV Nasıl Hesaplanır?', 'howto'],
    ['Ücretsiz SSL nasıl alınır?', 'howto'],
    ['10 adımda WordPress kurulumu', 'howto'],
    ['How to set up GA4', 'howto'],
    ['7 Kritik SEO Hatası', 'listicle'],
    ['E-ticarette 5 neden', 'listicle'],
    ['10 ipucu ile hızlı site', 'listicle'],
    // rehber kalanlar (null → guide)
    ['E-Fatura Nedir ve Nasıl Çalışır?', null],
    ['2026 Vergi Takvimi', null],
    ['Kira artışı 2026', null],
    ['SSL zorunlu mu?', null],
    ['Fiyatlandırma stratejisi nedir?', null],
    ['Fark yaratan markalar', null],
    ['', null],
  ];
  it.each(cases)('%s → %s', (title, expected) => {
    expect(classifyTopicTitle(title)).toBe(expected);
  });

  it('dize olmayan girdi → null', () => {
    expect(classifyTopicTitle(undefined)).toBeNull();
    expect(classifyTopicTitle(42 as any)).toBeNull();
  });
});

describe('normalizeContentType / contentTypeFromSchemaType', () => {
  it('gecerli tipleri ve yazim varyantlarini kabul eder', () => {
    expect(normalizeContentType('best_for')).toBe('best_for');
    expect(normalizeContentType('Best For')).toBe('best_for');
    expect(normalizeContentType('best-for')).toBe('best_for');
    expect(normalizeContentType(' HOWTO ')).toBe('howto');
  });
  it('bilinmeyen deger → null', () => {
    expect(normalizeContentType('review')).toBeNull();
    expect(normalizeContentType(null)).toBeNull();
    expect(normalizeContentType({})).toBeNull();
  });
  it('siralayicinin eski schema_type alani eslenir', () => {
    expect(contentTypeFromSchemaType('Article')).toBe('guide');
    expect(contentTypeFromSchemaType('HowTo')).toBe('howto');
    expect(contentTypeFromSchemaType('Comparison')).toBe('comparison');
    expect(contentTypeFromSchemaType('Product')).toBeNull();
  });
});

describe('resolveContentType — oncelik: acik > siralayici > siniflandirici > guide', () => {
  it('acik secim her seyi ezer', () => {
    expect(resolveContentType({ explicit: 'pricing', rankerContentType: 'howto', title: 'X vs Y' }))
      .toEqual({ type: 'pricing', source: 'explicit' });
  });
  it('acik secim yoksa siralayicinin content_type alani', () => {
    expect(resolveContentType({ rankerContentType: 'best_for', title: 'X vs Y' }))
      .toEqual({ type: 'best_for', source: 'ranker' });
  });
  it('siralayici content_type acikca guide derse siniflandirici ezmez', () => {
    expect(resolveContentType({ rankerContentType: 'guide', title: 'X vs Y' }))
      .toEqual({ type: 'guide', source: 'ranker' });
  });
  it('schema_type HowTo / Comparison siralayici karari sayilir', () => {
    expect(resolveContentType({ rankerSchemaType: 'HowTo', title: 'X vs Y' })).toEqual({ type: 'howto', source: 'ranker' });
    expect(resolveContentType({ rankerSchemaType: 'Comparison', title: 'KDV rehberi' })).toEqual({ type: 'comparison', source: 'ranker' });
  });
  it('schema_type Article (varsayilan deger) X vs Y basligini rehbere kilitlemez', () => {
    expect(resolveContentType({ rankerSchemaType: 'Article', title: 'Shopify vs WooCommerce' }))
      .toEqual({ type: 'comparison', source: 'classifier' });
    expect(resolveContentType({ rankerSchemaType: 'Article', title: 'KDV rehberi' }))
      .toEqual({ type: 'guide', source: 'ranker' });
  });
  it('gecersiz acik / siralayici degeri yok sayilir', () => {
    expect(resolveContentType({ explicit: 'roman', rankerContentType: 'xyz', title: 'Paraşüt Fiyatları' }))
      .toEqual({ type: 'pricing', source: 'classifier' });
  });
  it('hicbir sinyal yoksa guide / default', () => {
    expect(resolveContentType({ title: 'E-Fatura Nedir?' })).toEqual({ type: 'guide', source: 'default' });
    expect(resolveContentType({})).toEqual({ type: 'guide', source: 'default' });
  });
});

describe('contentTemplateBlock / withContentTemplate', () => {
  it('guide: blok bos, girdi BIREBIR ayni (geriye uyumluluk)', () => {
    for (const stage of ['outline', 'writer', 'editor'] as const) {
      expect(contentTemplateBlock('guide', stage)).toBe('');
      const input = '# Taslak\n\nmetin\n\n[ZORUNLU: Bugünün tarihi 2026-10-24.]';
      expect(withContentTemplate(input, 'guide', stage)).toBe(input);
    }
  });

  it('rehber disi her tip her asamada bos olmayan blok uretir', () => {
    for (const t of CONTENT_TYPES.filter((x) => x !== 'guide')) {
      for (const stage of ['outline', 'writer', 'editor'] as const) {
        expect(contentTemplateBlock(t, stage).length).toBeGreaterThan(0);
      }
    }
  });

  it('withContentTemplate: blok basa eklenir, girdi aynen sonda kalir', () => {
    const out = withContentTemplate('OUTLINE', 'comparison', 'writer');
    expect(out.startsWith('## İÇERİK ŞABLONU (zorunlu')).toBe(true);
    expect(out.endsWith('\n\n---\n\nOUTLINE')).toBe(true);
  });

  it('comparison: hukum ilk cumlede, yan yana tablo satirlari, kime uygun, gecis rehberi, SSS', () => {
    const b = contentTemplateBlock('comparison', 'writer');
    expect(b).toContain('KARŞILAŞTIRMA');
    expect(b).toMatch(/Hüküm ilk cümlede/);
    expect(b).toMatch(/Özellikler, Fiyat, Entegrasyon, Destek/);
    expect(b).toContain('Hangisi kime uygun?');
    expect(b).toMatch(/Geçiş rehberi/);
    expect(b).toContain('Sıkça Sorulan Sorular');
  });

  it('best_for: sirali tablo sutunlari, arti/eksi, yontem notu', () => {
    const b = contentTemplateBlock('best_for', 'writer');
    expect(b).toMatch(/Ad \| Kime uygun \| Fiyat \| Temel sınırlama/);
    expect(b).toMatch(/artılar ve eksiler/);
    expect(b).toMatch(/Yöntem notu/);
  });

  it('alternatives / howto / pricing iskeletleri', () => {
    expect(contentTemplateBlock('alternatives', 'writer')).toMatch(/5-10 alternatif/);
    expect(contentTemplateBlock('alternatives', 'writer')).toMatch(/neden X'ten ayrılıyor/);
    expect(contentTemplateBlock('howto', 'writer')).toMatch(/NUMARALI liste/);
    expect(contentTemplateBlock('howto', 'writer')).toMatch(/Sık yapılan hatalar/);
    expect(contentTemplateBlock('pricing', 'writer')).toMatch(/Yıllık indirim, iade ve deneme/);
    expect(contentTemplateBlock('pricing', 'writer')).toMatch(/Plan \| Fiyat \| Limitler \| Kime uygun/);
  });

  it('urun bilgisi dogrulugu kurali yalniz comparison / best_for / alternatives / pricing tipinde', () => {
    for (const t of ['comparison', 'best_for', 'alternatives', 'pricing'] as const) {
      const b = contentTemplateBlock(t, 'writer');
      expect(b).toContain('Ürün bilgisi doğruluğu');
      expect(b).toContain('UNSOURCED_NUMERIC_CLAIM');
      // yer tutucu YASAK (QA kapisi yer tutucuyu bloklar)
      expect(b).toMatch(/yer tutucu YAZMA/);
    }
    for (const t of ['howto', 'listicle'] as const) {
      expect(contentTemplateBlock(t, 'writer')).not.toContain('Ürün bilgisi doğruluğu');
    }
  });

  it('editor asamasi kisa kontrol listesi verir (tam sablonu tekrar etmez)', () => {
    const e = contentTemplateBlock('comparison', 'editor');
    expect(e).toContain('İÇERİK ŞABLONU KONTROLÜ');
    expect(e.length).toBeLessThan(contentTemplateBlock('comparison', 'writer').length);
  });
});

describe('AGENT_TOPIC_RANKER — content_type onerisi', () => {
  it('cikti semasinda content_type alani ve 7 tip var', () => {
    expect(AGENT_TOPIC_RANKER.systemSuffix).toContain('"content_type": "guide | howto | comparison | best_for | alternatives | pricing | listicle"');
    expect(AGENT_TOPIC_RANKER.systemSuffix).toContain('## İçerik tipi (content_type');
    // eski alan korunur (eski kuyruk kayitlari ve geri donus)
    expect(AGENT_TOPIC_RANKER.systemSuffix).toContain('"schema_type": "Article | HowTo | Comparison"');
  });
});
