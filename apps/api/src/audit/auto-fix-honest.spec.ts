import { describe, it, expect, vi, afterEach } from 'vitest';
import { AutoFixService } from './auto-fix.service.js';
import { StaticHtmlFixerService } from './static-html-fixer.service.js';

/**
 * Durust duzeltme yolu:
 *  - auto-fix uretemedigi anahtari sessizce atlamaz, ACIKCA doner
 *  - POST /auto-fix gercekten kuyruga girer (eskiden yalnizca DB satiri acip
 *    birakiyordu; payload'da worker'in bekledigi siteId de yoktu)
 *  - statik duzeltici 2 MB'ta KESILEN sayfanin uzerine yazmaz
 */
function buildAutoFix() {
  const prisma = { site: { findUniqueOrThrow: vi.fn(async () => ({ id: 's1', userId: 'u1', url: 'https://x.com', publishTargets: [] })) } };
  const jobQueue = { enqueue: vi.fn(async () => ({ dbJobId: 'db-1', bullJobId: 'b-1' })) };
  const svc = new AutoFixService(prisma as any, {} as any, {} as any, { topluKaydet: vi.fn() } as any, jobQueue as any);
  return { svc, prisma, jobQueue };
}

describe('AutoFixService — durust sonuc', () => {
  it('yalnizca uretilemeyen anahtarlar → hicbir sey yapmadan unsupported doner', async () => {
    const { svc, prisma } = buildAutoFix();
    const r: any = await svc.runAutoFix('s1', ['meta_title', 'geo_faq']);
    expect(r.reason).toBe('nothing-auto-fixable');
    expect(r.unsupported).toEqual(['meta_title', 'geo_faq']);
    expect(r.applied).toEqual([]);
    expect(prisma.site.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('yayin hedefi yoksa da unsupported raporlanir', async () => {
    const { svc } = buildAutoFix();
    const r: any = await svc.runAutoFix('s1', ['sitemap', 'meta_title']);
    expect(r.reason).toBe('no-publish-target');
    expect(r.unsupported).toEqual(['meta_title']);
  });

  it('applyFixes gercekten kuyruga girer; payload siteId tasir; uretilemeyen ayiklanir', async () => {
    const { svc, jobQueue } = buildAutoFix();
    const r = await svc.applyFixes('s1', ['sitemap', 'sitemap_xml', 'meta_title']);
    expect(jobQueue.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      type: 'AUTO_FIX', userId: 'u1', siteId: 's1', payload: { siteId: 's1', fixes: ['sitemap'] },
    }));
    expect(r).toEqual({ queued: true, jobId: 'db-1', unsupported: ['meta_title'] });
  });

  it('uretilebilen yoksa kuyruga hic is atilmaz', async () => {
    const { svc, jobQueue } = buildAutoFix();
    expect(await svc.applyFixes('s1', ['schema_markup'])).toEqual({ queued: false, jobId: null, unsupported: ['schema_markup'] });
    expect(jobQueue.enqueue).not.toHaveBeenCalled();
  });
});

describe('StaticHtmlFixerService — kesik sayfa korumasi', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('2 MB okuma sinirini asan sayfanin uzerine YAZMAZ', async () => {
    const big = `<html><head><title>x</title></head><body>${'a'.repeat(2 * 1024 * 1024 + 100)}</body></html>`;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(big, { status: 200 })));
    const prisma = {
      site: {
        findUniqueOrThrow: vi.fn(async () => ({
          id: 's1', publishTargets: [{ type: 'SFTP', credentials: {}, config: {} }],
        })),
      },
    };
    const appliedFix = { topluKaydet: vi.fn() };
    const svc = new StaticHtmlFixerService(prisma as any, appliedFix as any);
    const r: any = await svc.write('s1', 'https://x.com/a.html', [
      { type: 'meta_description', generatedSnippet: '<meta name="description" content="yeni">' } as any,
    ]);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/2 MB/);
    expect(appliedFix.topluKaydet).not.toHaveBeenCalled();
  });
});
