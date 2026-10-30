import { describe, it, expect, vi } from 'vitest';
import { AuditService } from './audit.service.js';
import { AuditChecksService } from './audit-checks.service.js';
import type { CrawlResult } from '../sites/site-crawler.service.js';
import { readSiteNap, siteNapKey } from './site-nap.js';

/**
 * Denetim, taradigi sayfalardan sitenin kendi NAP'ini (LocalBusiness JSON-LD
 * + tel: baglantilari) kv_store'a yazar — tarama verisi baska yerde kalici
 * degil ve yerel olcum bunu okur. Yazilamazsa denetim DUSMEZ.
 * Vitest dekorator metadata'si uretmedigi icin servis elle kurulur.
 */

const SALON_LD = {
  '@type': 'HairSalon',
  name: 'Lavanta Kuaför',
  telephone: '+90 216 555 00 00',
  address: { '@type': 'PostalAddress', streetAddress: 'Moda Cd. 1', addressLocality: 'Kadıköy', addressRegion: 'İstanbul' },
};

function sayfa(url: string, over: Record<string, unknown> = {}) {
  return {
    url, title: 'Yeterince uzun bir sayfa basligi burada', metaDescription: 'x'.repeat(120), h1: `H1 ${url}`, h2s: [], textSample: '',
    ogTags: { 'og:title': 't' }, twitterTags: { 'twitter:card': 's' }, canonical: url, hreflangs: [], jsonLdBlocks: [], schemaTypes: ['WebPage'],
    lang: 'tr', imageAltStats: { total: 0, withAlt: 0, emptyAlt: 0, absent: 0, ariaDecorative: 0, suspicious: 0, excluded: 0 },
    images: [], imagesCapped: false, outboundLinks: [], telLinks: [], ...over,
  } as any;
}

function servis(crawl: Partial<CrawlResult>, opts: { kvBroken?: boolean } = {}) {
  const rows = new Map<string, { value: string; expiresAt: Date | null }>();
  const kvStore = {
    upsert: vi.fn(async ({ where, create, update }: any) => {
      if (opts.kvBroken && where.key.startsWith('site-nap:')) throw new Error('kv yazilamadi');
      rows.set(where.key, rows.has(where.key) ? { ...rows.get(where.key)!, ...update } : create);
    }),
    deleteMany: vi.fn(async ({ where }: any) => { rows.delete(where.key); }),
    findUnique: vi.fn(async ({ where }: any) => rows.get(where.key) ?? null),
  };
  const auditCreate = vi.fn(async ({ data }: any) => ({ id: 'a1', ...data }));
  const prisma = {
    kvStore,
    site: { findUniqueOrThrow: async () => ({ id: 's1', userId: 'u1', url: 'https://lavantakuafor.com' }), update: vi.fn(async () => ({})), updateMany: vi.fn(async () => ({ count: 1 })) },
    audit: { create: auditCreate },
  };
  const crawler = { crawl: vi.fn(async () => ({ baseUrl: 'https://lavantakuafor.com', pages: [], sitemapUrl: null, robotsTxt: null, llmsTxt: null, totalPages: 0, ...crawl })) };
  const svc = new AuditService(
    prisma as never, crawler as never, new AuditChecksService(),
    { runAudit: vi.fn(async () => null) } as never,
    { runAudit: vi.fn(async () => ({ score: 50, methods: [] })) } as never,
    { runForSite: vi.fn(async () => []) } as never,
    null as never,
  );
  return { svc, prisma, rows, auditCreate };
}

describe('runAudit — site NAP kaydi', () => {
  it('taranan sayfalarin JSON-LD + tel: bulgulari kv_store\'a yazilir', async () => {
    const t = servis({
      pages: [
        sayfa('https://lavantakuafor.com/', { jsonLdBlocks: [SALON_LD], schemaTypes: ['HairSalon'], telLinks: ['tel:+902165550000'] }),
        sayfa('https://lavantakuafor.com/iletisim', { telLinks: ['tel:0532 111 22 33'] }),
      ],
    });
    await t.svc.runAudit('s1');
    expect(t.rows.has(siteNapKey('s1'))).toBe(true);
    const nap = await readSiteNap(t.prisma as never, 's1');
    expect(nap).toMatchObject({
      status: 'ok', origin: 'audit', telScanned: true,
      phones: ['+902165550000', '+905321112233'],
      sources: ['json-ld', 'tel-link'],
      businessTypes: ['HairSalon'],
    });
    expect(nap!.addresses[0]).toMatchObject({ district: 'Kadıköy', city: 'İstanbul' });
  });

  it('kv yazilamazsa denetim yine tamamlanir', async () => {
    const t = servis({ pages: [sayfa('https://lavantakuafor.com/')] }, { kvBroken: true });
    await expect(t.svc.runAudit('s1')).resolves.toMatchObject({ id: 'a1' });
    expect(t.auditCreate).toHaveBeenCalledTimes(1);
    expect(t.rows.has(siteNapKey('s1'))).toBe(false);
  });
});
