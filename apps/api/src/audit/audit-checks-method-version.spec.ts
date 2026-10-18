import { describe, it, expect } from 'vitest';
import {
  AuditChecksService, INTERNAL_LINKING_METHOD_VERSION, LLMS_METHOD_VERSION, OVERALL_SCORE_WEIGHTS,
} from './audit-checks.service.js';

/**
 * F7 — yontemi degisen kontroller surum damgasi tasir.
 *
 * NEDEN VAR: tarayici artik www'li/www'suz adresi tek site sayiyor (ic linkleme)
 * ve /llms.txt'ten donen HTML'i "dosya var" saymiyor. Damga olmadan ilk
 * karsilastirma siteye dokunulmamisken "internal_linking +60 iyilesti" ya da
 * "llms_txt -70 kotulesti" gosterirdi (compareAuditRows methodVersion'a bakar).
 */

const sayfa = (url: string, links: string[] = []) => ({
  url, title: 'Yeterince uzun bir sayfa basligi burada', metaDescription: 'x'.repeat(120), h1: `H1 ${url}`, h2s: [], textSample: '',
  ogTags: {}, twitterTags: {}, canonical: url, hreflangs: [], jsonLdBlocks: [], schemaTypes: [],
  lang: 'tr', imageAltStats: { total: 0, withAlt: 0, emptyAlt: 0, absent: 0, ariaDecorative: 0, suspicious: 0, excluded: 0 },
  images: [], imagesCapped: false, outboundLinks: links,
}) as any;

const tarama = (over: Record<string, unknown> = {}) => ({
  baseUrl: 'https://site.com', pages: [sayfa('https://site.com', ['https://site.com/a']), sayfa('https://site.com/a')],
  sitemapUrl: null, robotsTxt: null, llmsTxt: null, totalPages: 2, ...over,
}) as any;

describe('kontrol yontem surumleri', () => {
  it('llms_txt her yolda (var / yok / dogrulanamadi) surum tasir', async () => {
    const svc = new AuditChecksService();
    const bul = async (over: Record<string, unknown>) => (await svc.runAllChecks(tarama(over))).find((c) => c.id === 'llms_txt')!;
    expect(LLMS_METHOD_VERSION).toBe(2);
    expect((await bul({ llmsTxt: '# Site' })).details?.methodVersion).toBe(2);
    expect((await bul({})).details?.methodVersion).toBe(2);
    const engelli = await bul({ resources: { llms: { state: 'blocked', url: 'https://site.com/llms.txt', status: 403, reason: 'WAF' } } });
    expect(engelli.details).toMatchObject({ unverified: true, methodVersion: 2 });
  });

  it('internal_linking surum tasir; orphan ayrintisi korunur', async () => {
    const r = (await new AuditChecksService().runAllChecks(tarama())).find((c) => c.id === 'internal_linking')!;
    expect(INTERNAL_LINKING_METHOD_VERSION).toBe(2);
    expect(r.details).toMatchObject({ methodVersion: 2, orphans: [] });
  });

  it('genel skor agirliklari tek listeden — formul degismedi', async () => {
    const svc = new AuditChecksService();
    const sonuc = await svc.runAllChecks(tarama());
    let toplam = 0, agirlik = 0;
    for (const c of sonuc) {
      const w = OVERALL_SCORE_WEIGHTS[c.id] ?? 1;
      toplam += c.score * w;
      agirlik += w;
    }
    expect(svc.computeOverallScore(sonuc)).toBe(Math.round(toplam / agirlik));
    expect(Object.keys(OVERALL_SCORE_WEIGHTS)).toHaveLength(14);
  });
});
