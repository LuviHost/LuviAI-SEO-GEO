import { describe, it, expect } from 'vitest';
import {
  AuditChecksService, INTERNAL_LINKING_METHOD_VERSION, LLMS_METHOD_VERSION, OVERALL_SCORE_RETIRED, OVERALL_SCORE_WEIGHTS,
  feedsOverallScoreAt,
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
    expect(LLMS_METHOD_VERSION).toBe(3);
    expect((await bul({ llmsTxt: '# Site' })).details).toMatchObject({ methodVersion: 3, informational: true });
    expect((await bul({})).details).toMatchObject({ methodVersion: 3, informational: true });
    const engelli = await bul({ resources: { llms: { state: 'blocked', url: 'https://site.com/llms.txt', status: 403, reason: 'WAF' } } });
    expect(engelli.details).toMatchObject({ unverified: true, methodVersion: 3, informational: true });
  });

  it('llms_txt v3: genel skora girmez, yoklugu yalniz bilgi (30 puan cezasi kalkti)', async () => {
    const svc = new AuditChecksService();
    const yok = await svc.runAllChecks(tarama());
    const var_ = await svc.runAllChecks(tarama({ llmsTxt: '# Site' }));
    // Kontrol listede kalir
    expect(yok.find((c) => c.id === 'llms_txt')).toBeDefined();
    expect(svc.computeOverallScore(yok)).toBe(svc.computeOverallScore(var_));
    const issue = yok.find((c) => c.id === 'llms_txt')!.issues[0];
    expect(issue).toMatchObject({ type: 'llms_missing', severity: 'info' });
    expect(issue.description).toContain('genel skora girmez');
    expect(Object.hasOwn(OVERALL_SCORE_WEIGHTS, 'llms_txt')).toBe(false);
    expect(OVERALL_SCORE_RETIRED).toEqual({ llms_txt: 3 });
    // Eski yontemle (v1/v2) olculmus llms_txt o taramanin genel skoruna girmisti
    expect(feedsOverallScoreAt('llms_txt', 2)).toBe(true);
    expect(feedsOverallScoreAt('llms_txt', 3)).toBe(false);
    expect(feedsOverallScoreAt('robots_txt', 3)).toBe(true);
    expect(feedsOverallScoreAt('aiCitations', 1)).toBe(false);
  });

  it('internal_linking surum tasir; orphan ayrintisi korunur', async () => {
    const r = (await new AuditChecksService().runAllChecks(tarama())).find((c) => c.id === 'internal_linking')!;
    expect(INTERNAL_LINKING_METHOD_VERSION).toBe(2);
    expect(r.details).toMatchObject({ methodVersion: 2, orphans: [] });
  });

  it('genel skor agirliklari tek listeden — listede olmayan kontrol skora girmez', async () => {
    const svc = new AuditChecksService();
    const sonuc = await svc.runAllChecks(tarama());
    let toplam = 0, agirlik = 0;
    for (const c of sonuc) {
      if (!Object.hasOwn(OVERALL_SCORE_WEIGHTS, c.id)) continue;
      const w = OVERALL_SCORE_WEIGHTS[c.id];
      toplam += c.score * w;
      agirlik += w;
    }
    expect(svc.computeOverallScore(sonuc)).toBe(Math.round(toplam / agirlik));
    // 14 kontrol listelenir, 13'u genel skora girer
    expect(sonuc).toHaveLength(14);
    expect(Object.keys(OVERALL_SCORE_WEIGHTS)).toHaveLength(13);
  });
});
