import { describe, it, expect, vi } from 'vitest';
import { inspectionTargets, isIndexedVerdict, summarizeInspection, urlUnderProperty, INSPECT_MAX } from './gsc-url-inspection.js';
import { GscUrlInspectionService } from './gsc-url-inspection.service.js';
import { GENERIC_LINK_TEXTS, isGenericLinkText, linkTextApplies } from './link-text.js';
import { canonicalProbeTargets, classifyCanonicalTarget, urlKey } from './canonical-target.js';

const p = (url: string, extra: Record<string, unknown> = {}) => ({ url, canonical: null as string | null, ...extra });

describe('URL denetimi — sorulacak adresler', () => {
  it('mulk eslesmesi: alan adi mulku alt alanlari kapsar; adres oneki mulku sema + host + yol ister', () => {
    expect(urlUnderProperty('https://www.site.com/a', 'sc-domain:site.com')).toBe(true);
    expect(urlUnderProperty('https://blog.site.com/a', 'sc-domain:site.com')).toBe(true);
    expect(urlUnderProperty('https://notsite.com/a', 'sc-domain:site.com')).toBe(false);
    expect(urlUnderProperty('https://www.site.com/a', 'https://www.site.com/')).toBe(true);
    expect(urlUnderProperty('https://site.com/a', 'https://www.site.com/')).toBe(false);
    expect(urlUnderProperty('http://www.site.com/a', 'https://www.site.com/')).toBe(false);
    expect(urlUnderProperty('https://www.site.com/tr/a', 'https://www.site.com/tr/')).toBe(true);
    expect(urlUnderProperty('https://www.site.com/en/a', 'https://www.site.com/tr/')).toBe(false);
  });

  it('kendini gosteren canonical yazilisi sorulur; baska adresi gosteren canonical ve noindex atlanir', () => {
    const pages = [
      p('https://site.com/', { canonical: 'https://site.com/' }),
      // normalize adres "/yol"; sitenin yazilisi "/yol/" — canonical'daki hal sorulur
      p('https://site.com/yol', { canonical: 'https://site.com/yol/' }),
      p('https://site.com/kopya', { canonical: 'https://site.com/asil' }),
      p('https://site.com/gizli', { robotsSignals: { metas: [{ name: 'robots', content: 'noindex' }], header: null } }),
      // canonical yok: sayfanin acildigi tam adres
      p('https://site.com/bolu', { fetchedUrl: 'https://site.com/bolu/' }),
    ];
    expect(inspectionTargets(pages, 'sc-domain:site.com')).toEqual([
      'https://site.com/', 'https://site.com/yol/', 'https://site.com/bolu/',
    ]);
  });

  it('en fazla INSPECT_MAX, tekil', () => {
    const pages = Array.from({ length: 40 }, (_, i) => p(`https://site.com/s${i % 30}`));
    const t = inspectionTargets(pages, 'sc-domain:site.com');
    expect(t).toHaveLength(INSPECT_MAX);
    expect(new Set(t).size).toBe(t.length);
  });

  it('hukum: PASS (ve eski PARTIAL) dizinde; FAIL / NEUTRAL degil', () => {
    expect(['PASS', 'PARTIAL', 'FAIL', 'NEUTRAL'].map(isIndexedVerdict)).toEqual([true, true, false, false]);
    const s = summarizeInspection('sc-domain:site.com', [
      { url: 'a', verdict: 'PASS', coverageState: null },
      { url: 'b', verdict: 'NEUTRAL', coverageState: 'URL is unknown to Google' },
    ], 1);
    expect(s).toMatchObject({ inspected: 2, indexedCount: 1, failed: 1 });
    expect(s.notIndexed.map((r) => r.url)).toEqual(['b']);
  });
});

describe('URL denetimi — servis', () => {
  const kur = (site: unknown, inspect: (args: any) => Promise<any>) => {
    const prisma = { site: { findUnique: vi.fn().mockResolvedValue(site) } };
    const gsc = { getAuthenticatedClient: vi.fn().mockResolvedValue({}) };
    const svc = new GscUrlInspectionService(prisma as any, gsc as any);
    const spy = vi.fn(inspect);
    (svc as any).searchconsole = () => ({ urlInspection: { index: { inspect: spy } } });
    return { svc, spy, gsc };
  };
  const bagli = { gscPropertyUrl: 'sc-domain:site.com', gscRefreshToken: 'enc' };
  const sayfalar = ['/', '/a', '/b', '/c', '/d', '/e'].map((y) => p(`https://site.com${y}`));

  it('Search Console bagli degilse soru sorulmaz, null', async () => {
    const { svc, spy, gsc } = kur({ gscPropertyUrl: null, gscRefreshToken: null }, async () => ({}));
    expect(await svc.inspectForAudit('s1', sayfalar)).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    expect(gsc.getAuthenticatedClient).not.toHaveBeenCalled();
  });

  it('mulk ve adres dogru gider; cevaplar ozetlenir', async () => {
    const { svc, spy } = kur(bagli, async ({ requestBody }) => ({
      data: { inspectionResult: { indexStatusResult: requestBody.inspectionUrl.endsWith('/b')
        ? { verdict: 'NEUTRAL', coverageState: 'Discovered - currently not indexed' }
        : { verdict: 'PASS', coverageState: 'Submitted and indexed' } } },
    }));
    const r = await svc.inspectForAudit('s1', sayfalar);
    expect(spy.mock.calls[0][0].requestBody).toEqual({ inspectionUrl: 'https://site.com/', siteUrl: 'sc-domain:site.com', languageCode: 'tr-TR' });
    expect(r).toMatchObject({ property: 'sc-domain:site.com', inspected: 6, indexedCount: 5, failed: 0 });
    expect(r!.notIndexed).toEqual([{ url: 'https://site.com/b', verdict: 'NEUTRAL', coverageState: 'Discovered - currently not indexed' }]);
  });

  it('403 / 429: kalan sorular atilmaz, cevapsiz sayilir; hic cevap yoksa null', async () => {
    const { svc, spy } = kur(bagli, async () => { throw Object.assign(new Error('quota'), { code: 429 }); });
    expect(await svc.inspectForAudit('s1', sayfalar)).toBeNull();
    // Ilk grup (4 paralel) soruldu, ikinci grup sorulmadi
    expect(spy).toHaveBeenCalledTimes(4);
  });

  it('hata atmaz: veritabani hatasi da null', async () => {
    const prisma = { site: { findUnique: vi.fn().mockRejectedValue(new Error('db')) } };
    const svc = new GscUrlInspectionService(prisma as any, {} as any);
    expect(await svc.inspectForAudit('s1', sayfalar)).toBeNull();
  });
});

describe('baglanti metni listesi', () => {
  it('Lighthouse Ingilizce listesi tam; Turkce karsiliklar; buyuk harf ve kenar isaretleri', () => {
    for (const t of ['click here', 'click this', 'go', 'here', 'information', 'learn more', 'more', 'more info', 'more information', 'right here', 'read more', 'see more', 'start', 'this']) {
      expect(GENERIC_LINK_TEXTS.has(t)).toBe(true);
    }
    expect(['Devamı »', 'DEVAMINI OKU', 'Buraya tıklayın', 'CLICK HERE', 'Read more →', '  daha   fazla ', 'İNCELE'].map(isGenericLinkText))
      .toEqual([true, true, true, true, true, true, false]);
    // Aciklayici metin, bos metin ve "Git" (yazilim adi) isaretlenmez
    expect(['Kredi notu nedir?', 'Devamını oku: Kredi notu', '', 'Git'].map(isGenericLinkText)).toEqual([false, false, false, false]);
  });

  it("Lighthouse'un atladiklari atlanir", () => {
    expect(linkTextApplies('/a', undefined)).toBe(true);
    expect(linkTextApplies('https://baska.com/a', 'noopener')).toBe(true);
    expect(linkTextApplies('/a', 'nofollow noopener')).toBe(false);
    expect(['#x', 'javascript:void(0)', 'mailto:a@b.com', 'tel:+90'].map((h) => linkTextApplies(h, undefined))).toEqual([false, false, false, false]);
  });
});

describe('canonical hedefi — saf', () => {
  it('anahtar: www / sema / sondaki bolu farki ayni; sorgu farkli', () => {
    expect(urlKey('https://www.site.com/a/')).toBe(urlKey('http://site.com/a'));
    expect(urlKey('https://site.com/a?x=1')).not.toBe(urlKey('https://site.com/a'));
    expect(urlKey('mailto:a@b.com')).toBeNull();
  });

  it('siniflandirma: 404/410 yok, 5xx sunucu hatasi, digerleri hukum yok', () => {
    expect([404, 410, 500, 503, 403, 401, 429, 301, null].map(classifyCanonicalTarget))
      .toEqual(['not_found', 'not_found', 'server_error', 'server_error', null, null, null, null, null]);
  });

  it('yoklama siniri: en fazla max farkli hedef', () => {
    const pages = Array.from({ length: 15 }, (_, i) => ({ url: `https://site.com/s${i}`, canonical: `/hedef-${i}` }));
    const plan = canonicalProbeTargets(pages, (u) => u.hostname === 'site.com', [], 10);
    expect(plan.toProbe).toHaveLength(10);
    expect(plan.checked).toBe(10);
  });
});
