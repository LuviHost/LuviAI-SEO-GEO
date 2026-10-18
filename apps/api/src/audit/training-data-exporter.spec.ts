import { describe, it, expect } from 'vitest';
import { TrainingDataExporterService, buildSubmitInstructions } from './training-data-exporter.service.js';

/**
 * Hugging Face yukleme adimlari panelde (GEO Lab → Eğitim verisi) OLDUGU GIBI
 * gosterilir. Panel "Etkisi garanti değildir ve RanksUp bunu ölçemez" derken
 * 8. adim "Mistral, Llama, Claude bir sonraki egitiminde otomatik kullanir"
 * diye garanti veriyordu. Bu test o vaadin geri gelmesini engeller.
 */

const body = 'Bu bir test makalesidir. '.repeat(20);

function makeService(articles: Array<Record<string, unknown>>) {
  const prisma = {
    site: {
      findUniqueOrThrow: async () => ({ id: 's1', name: 'Örnek Şirket', url: 'https://ornek.com/', niche: 'muhasebe' }),
    },
    article: { findMany: async () => articles },
  };
  return new TrainingDataExporterService(prisma as never);
}

const article = (over: Record<string, unknown> = {}) => ({
  id: 'a1', slug: 'yazi', title: 'Yazı', bodyMd: body, topic: 't', category: null, language: 'tr',
  publishedAt: new Date('2026-10-01T00:00:00Z'), createdAt: new Date('2026-09-30T00:00:00Z'),
  wordCount: 100, persona: null, ...over,
});

describe('TrainingDataExporterService — yukleme adimlari', () => {
  it('model egitiminde kullanilma garantisi vermiyor; garanti olmadigini acikca soyluyor', async () => {
    const r = await makeService([article()]).exportSite('s1');
    const steps = r.metadata.submitInstructions.join('\n');
    expect(steps).not.toMatch(/otomatik kullan/i);
    expect(steps).not.toMatch(/bir sonraki e[gğ]itim/i);
    expect(steps).not.toMatch(/\b(Mistral|Llama|Claude|Anthropic|OpenAI|Gemini)\b/);
    expect(steps).toContain('garanti edilmez');
    expect(steps).toContain('RanksUp bunu ölçemez');
  });

  it('adimlar diakritikli Turkce (panel metni aynen gosterir)', async () => {
    const r = await makeService([article()]).exportSite('s1');
    const steps = r.metadata.submitInstructions;
    expect(steps).toHaveLength(8);
    expect(steps[0]).toContain('hesabı aç');
    expect(steps[1]).toContain('veri seti oluştur');
    expect(steps[6]).toContain('Aşağıdaki JSONL içeriğini');
    // Eski ASCII yazimlar geri gelmesin
    for (const ascii of ['hesabi ac', 'olustur', 'Asagidaki', 'icerigi', 'yukle', 'Turkiye', 'Turkce', 'bilgi bankasi']) {
      expect(steps.join('\n'), ascii).not.toContain(ascii);
    }
    expect(r.metadata.license).toBe('CC-BY-4.0 (alıntıda kaynak göstermek zorunlu)');
  });

  it('kayit atif metni diakritikli; kayit sayisi ve dil etiketi veriden', async () => {
    const r = await makeService([article(), article({ id: 'a2', slug: 'iki' })]).exportSite('s1');
    expect(r.records).toBe(2);
    const first = JSON.parse(r.jsonl.split('\n')[0]);
    expect(first.attribution).toBe('Bu makale Örnek Şirket (https://ornek.com) tarafından yazılmıştır. Alıntıda URL belirtilmesi rica olunur.');
    expect(r.metadata.submitInstructions[2]).toBe('3. Adı: ornek-sirket-tr-knowledge-base');
    expect(r.metadata.submitInstructions[5]).toBe('6. Açıklama (Description): Örnek Şirket muhasebe konulu bilgi bankası, 2 Türkçe makale.');
  });

  it('Turkce olmayan kayitlar "Türkçe makale" diye etiketlenmez', () => {
    const mixed = buildSubmitInstructions({ siteName: 'X', niche: 'diğer', records: 3, languages: new Set(['tr', 'en']), slug: 'x' });
    expect(mixed[2]).toBe('3. Adı: x-multilingual-knowledge-base');
    expect(mixed[5]).toBe('6. Açıklama (Description): X bilgi bankası, 3 makale.');
    const en = buildSubmitInstructions({ siteName: 'X', niche: null, records: 1, languages: new Set(['en']), slug: 'x' });
    expect(en[5]).toContain('1 İngilizce makale');
  });
});
