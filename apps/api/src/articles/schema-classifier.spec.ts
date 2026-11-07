import { describe, expect, it } from 'vitest';
import { OTOMATIK_SEMA_TIPLERI, SchemaClassifierService, visibleFaqs } from './schema-classifier.service.js';

describe('sema: yalniz makaleyi dogru tanimlayan, sayfada gorunen isaretleme (08.11.2026)', () => {
  it('visibleFaqs: metinde gecmeyen soru semaya girmez', () => {
    const body = '## Sıkça sorulan sorular\n\n### Ön muhasebe programı **ne işe yarar**?\nFatura kesmeye yarar.';
    const faqs = [
      { q: 'Ön muhasebe programı ne işe yarar?', a: 'Fatura kesmeye yarar.' },
      { q: 'Kaç kullanıcı destekler?', a: 'Sınırsız.' },
    ];
    expect(visibleFaqs(faqs, body)).toEqual([faqs[0]]);
    expect(visibleFaqs(faqs, '')).toEqual([]);
    expect(visibleFaqs(undefined, body)).toEqual([]);
  });

  it('classify: HowTo, Product, Service, Course, VideoObject otomatik eklenmez', async () => {
    const eski = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const md = 'Kurulum rehberi: adım adım nasıl yapılır? Ürün fiyat paket satın al sipariş. Eğitim kursu modül ders. youtube.com/embed/x hizmet teklif';
      const r = await new SchemaClassifierService().classify(md);
      for (const t of ['HowTo', 'Product', 'Service', 'Course', 'VideoObject']) expect(r.primary).not.toContain(t);
      expect(r.primary.every((t) => OTOMATIK_SEMA_TIPLERI.has(t))).toBe(true);
    } finally {
      if (eski !== undefined) process.env.ANTHROPIC_API_KEY = eski;
    }
  });

  it('build: WebSite SearchAction ve DefinedTerm sozluk adresi uretilmez', () => {
    const svc = new SchemaClassifierService();
    const out = svc.buildJsonLd({
      types: ['WebSite', 'DefinedTerm', 'HowTo'] as any,
      article: { title: "Ön muhasebe nedir?", url: "https://ornek.com/on-muhasebe", slug: "on-muhasebe", metaDescription: "Tanım" },
      site: { name: 'Örnek', url: 'https://ornek.com' } as any,
    } as any);
    const metin = JSON.stringify(out);
    expect(metin).not.toContain('SearchAction');
    expect(metin).not.toContain('/sozluk');
    expect(metin).not.toContain('HowTo');
  });
});
