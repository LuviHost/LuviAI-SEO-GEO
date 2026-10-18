import { describe, it, expect, vi } from 'vitest';
import { LlmsFullBuilderService } from './llms-full-builder.service.js';

/**
 * llms-full / kisa dizin makale adresini UYDURMAZ: eskiden her makale icin
 * <site>/blog/<slug>.html yaziliyordu (WordPress'te 404). Adres yayin
 * kaydindan gelir; cozulemezse makale linksiz listelenir.
 */
function prisma() {
  const site = { id: 's1', name: 'Ornek', url: 'https://ornek.com', niche: null, language: 'tr', brain: null };
  const articles = [
    { title: 'Yayinda', slug: 'yayinda', topic: 't', metaDescription: 'ozet', bodyMd: 'x', wordCount: 10, publishedAt: new Date('2026-10-01'), category: null, faqs: null,
      publishedTo: [{ ok: true, externalUrl: 'https://ornek.com/yayinda/' }] },
    { title: 'Kaydi yok', slug: 'kaydi-yok', topic: 't', metaDescription: null, bodyMd: 'x', wordCount: 10, publishedAt: new Date('2026-10-02'), category: null, faqs: null,
      publishedTo: [] },
  ];
  return {
    site: { findUniqueOrThrow: vi.fn(async () => site), update: vi.fn(async () => site) },
    article: { findMany: vi.fn(async () => articles) },
    publishTarget: { findMany: vi.fn(async () => []) },
  } as any;
}

describe('llms-full makale adresleri', () => {
  it('kisa dizin: gercek adres linkli, adresi cozulemeyen linksiz; uydurma /blog/*.html yok', async () => {
    const svc = new LlmsFullBuilderService(prisma());
    const txt = await svc.buildShortIndex('s1');
    expect(txt).toContain('[Yayinda](https://ornek.com/yayinda/)');
    expect(txt).toContain('- Kaydi yok');
    expect(txt).not.toMatch(/\/blog\/[a-z-]+\.html/);
  });
});
