import { describe, it, expect, vi } from 'vitest';

/**
 * GET /sites/:siteId/audit/snippets — pageUrl verilmezse anasayfa snippet'i.
 *
 * NEDEN: anasayfa adresi eskiden son denetimdeki sitemap adresinin kokeninden
 * turetiliyordu; robots.txt'teki Sitemap satiri CDN / eski alan adi gibi baska
 * bir hosta isaret edebilir ve snippet (model cagrilariyla) o hostun
 * sayfasindan uretiliyordu. Artik sitenin kendi kayitli adresi kullanilir.
 *
 * Kurucu 38 bagimlilik aliyor ve vitest dekorator metadata'si uretmiyor:
 * yalniz handler'in kullandigi alanlar prototipten kurulan nesneye verilir.
 */
const { AuditController } = await import('./audit.controller.js');

function controller(siteUrl: string | null) {
  const ctl = Object.create(AuditController.prototype) as any;
  ctl.snippets = {
    generateForPage: vi.fn(async (_s: string, url: string) => [{ pageUrl: url, type: 'canonical' }]),
    generateOrganizationJsonLd: vi.fn(async () => ({ pageUrl: siteUrl, type: 'jsonld_organization' })),
  };
  ctl.prisma = { site: { findUnique: vi.fn(async () => (siteUrl === null ? null : { url: siteUrl })) } };
  // Sitemap kokeni CDN'de olsa bile kullanilmamali
  ctl.audit = { getLatest: vi.fn(async () => ({ checks: { sitemap_xml: { details: { url: 'https://cdn.baska-host.com/sitemap.xml' } } } })) };
  return ctl;
}

describe('AuditController.getSnippets — anasayfa sitenin kendi adresi', () => {
  it('pageUrl yoksa site.url kullanilir; sitemap kokeni (CDN) kullanilmaz', async () => {
    const ctl = controller('https://site.com');
    const r = await ctl.getSnippets('s1');
    expect(ctl.snippets.generateForPage).toHaveBeenCalledWith('s1', 'https://site.com');
    expect(ctl.audit.getLatest).not.toHaveBeenCalled();
    expect(r.pageUrl).toBe('https://site.com');
    expect(r.snippets.map((s: any) => s.type)).toEqual(['jsonld_organization', 'canonical']);
  });

  it('pageUrl verilirse oldugu gibi servise gider (kapsam denetimi serviste); cevaptaki adres kirpilir', async () => {
    const ctl = controller('https://site.com');
    const r = await ctl.getSnippets('s1', ' https://www.site.com/blog/yazi ');
    expect(ctl.snippets.generateForPage).toHaveBeenCalledWith('s1', ' https://www.site.com/blog/yazi ');
    expect(r.pageUrl).toBe('https://www.site.com/blog/yazi');
    expect(ctl.snippets.generateOrganizationJsonLd).not.toHaveBeenCalled();
  });

  it('site adresi yoksa model cagrisi yapilmaz', async () => {
    const ctl = controller(null);
    const r = await ctl.getSnippets('s1');
    expect(r).toEqual({ snippets: [], reason: 'Site adresi bulunamadı.' });
    expect(ctl.snippets.generateForPage).not.toHaveBeenCalled();
  });
});
