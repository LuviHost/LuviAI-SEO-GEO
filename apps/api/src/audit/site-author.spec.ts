import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { AuthorProfileService, normalizeSiteAuthor, readSiteAuthor } from './author-profile.service.js';
import { SchemaClassifierService } from '../articles/schema-classifier.service.js';

/**
 * Sitenin GERCEK yazari: yalniz site sahibinin girdigi kayit. Yoksa makale
 * JSON-LD author'u Organization kalir; persona'dan / modelden yazar uydurulmaz.
 */
describe('normalizeSiteAuthor', () => {
  it('ad zorunlu; bos / dize disi → null', () => {
    expect(normalizeSiteAuthor({ name: '  ' })).toBeNull();
    expect(normalizeSiteAuthor({ url: 'https://x.com' })).toBeNull();
    expect(normalizeSiteAuthor(null)).toBeNull();
    expect(normalizeSiteAuthor(['Ayşe'])).toBeNull();
  });

  it('yalniz http/https adres; tekrarli ve gecersiz sameAs elenir; en fazla 10', () => {
    const many = Array.from({ length: 14 }, (_, i) => `https://p${i}.com/a`);
    const a = normalizeSiteAuthor({
      name: 'Ayşe Yılmaz',
      url: 'javascript:alert(1)',
      sameAs: ['https://linkedin.com/in/ayse', 'https://linkedin.com/in/ayse', 'ftp://x', 'nope', ...many],
      jobTitle: '  Mali   müşavir ',
    });
    expect(a?.url).toBeUndefined();
    expect(a?.sameAs?.[0]).toBe('https://linkedin.com/in/ayse');
    expect(a?.sameAs).toHaveLength(10);
    expect(a?.jobTitle).toBe('Mali müşavir');
  });

  it('ad prompt\'a ve gorunur satira girer: satir sonu ve markdown isaretleri atilir', () => {
    expect(normalizeSiteAuthor({ name: 'Ayşe\n\n## [Yılmaz](x) **' })?.name).toBe('Ayşe Yılmaz(x)');
  });
});

describe('readSiteAuthor', () => {
  it('kv_store site-author:<siteId> anahtarindan okur', async () => {
    const prisma = { kvStore: { findUnique: vi.fn(async () => ({ value: JSON.stringify({ name: 'Ayşe' }) })) } };
    expect(await readSiteAuthor(prisma, 's1')).toEqual({ name: 'Ayşe' });
    expect(prisma.kvStore.findUnique).toHaveBeenCalledWith({ where: { key: 'site-author:s1' } });
  });
  it('kayit yok / bozuk JSON / okuma hatasi → null (Organization)', async () => {
    expect(await readSiteAuthor({ kvStore: { findUnique: vi.fn(async () => null) } }, 's1')).toBeNull();
    expect(await readSiteAuthor({ kvStore: { findUnique: vi.fn(async () => ({ value: '{bozuk' })) } }, 's1')).toBeNull();
    expect(await readSiteAuthor({ kvStore: { findUnique: vi.fn(async () => { throw new Error('db'); }) } }, 's1')).toBeNull();
    expect(await readSiteAuthor({}, 's1')).toBeNull();
  });
});

describe('AuthorProfileService — site yazari kaydi', () => {
  const build = () => {
    const prisma = { kvStore: { upsert: vi.fn(async () => ({})), deleteMany: vi.fn(async () => ({ count: 1 })), findUnique: vi.fn() } };
    return { prisma, svc: new AuthorProfileService(prisma as any) };
  };

  it('setSiteAuthor dogrulanmis kaydi yazar; adsiz girdi 400', async () => {
    const { prisma, svc } = build();
    const saved = await svc.setSiteAuthor('s1', { name: 'Ayşe', url: 'https://ornek.com/yazar/ayse' });
    expect(saved).toEqual({ name: 'Ayşe', url: 'https://ornek.com/yazar/ayse' });
    expect(prisma.kvStore.upsert).toHaveBeenCalledWith({
      where: { key: 'site-author:s1' },
      create: { key: 'site-author:s1', value: JSON.stringify(saved) },
      update: { value: JSON.stringify(saved) },
    });
    await expect(svc.setSiteAuthor('s1', { name: '' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('clearSiteAuthor kaydi siler', async () => {
    const { prisma, svc } = build();
    expect(await svc.clearSiteAuthor('s1')).toEqual({ cleared: true });
    expect(prisma.kvStore.deleteMany).toHaveBeenCalledWith({ where: { key: 'site-author:s1' } });
  });
});

describe('SchemaClassifierService.buildJsonLd — author', () => {
  const svc = new SchemaClassifierService();
  const base = {
    types: ['Article'] as any,
    article: { title: 'T', url: 'https://ornek.com/t', slug: 't' },
    site: { name: 'Örnek', url: 'https://ornek.com' },
  };

  it('yazar yoksa Organization (bugunku davranis)', () => {
    const [article] = svc.buildJsonLd({ ...base, article: { ...base.article, author: null } });
    expect(article.author).toEqual({ '@type': 'Organization', name: 'Örnek', url: 'https://ornek.com' });
  });

  it('yazar varsa Person: name, url, sameAs, jobTitle', () => {
    const [article] = svc.buildJsonLd({
      ...base,
      article: { ...base.article, author: { name: 'Ayşe', url: 'https://ornek.com/yazar/ayse', sameAs: ['https://linkedin.com/in/ayse'], jobTitle: 'Mali müşavir' } },
    });
    expect(article.author).toEqual({
      '@type': 'Person',
      name: 'Ayşe',
      url: 'https://ornek.com/yazar/ayse',
      sameAs: ['https://linkedin.com/in/ayse'],
      jobTitle: 'Mali müşavir',
    });
  });
});
