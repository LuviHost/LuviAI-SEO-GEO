import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SafeTextResult } from '../common/safe-fetch.js';

/**
 * Anonim ucretsiz kontrol — olcumle ayni marka karari ve guvenli alinti.
 *
 *  - Jenerik + alan adindan turetilmis marka ("Emlak" ← emlak.com): olcum
 *    (buildProbe) yalniz alan adini arar. Sablondaki {BRAND_HINT} de alan adi
 *    olmali, rozetin yedek hesabi da host ile — yoksa "emlak" kelimesi gecen
 *    her soru markali sayilip manset skordan duser. Gecmis ise her kaydi
 *    olculdugu kuralla sayar (damgasiz eski kayit yalin kelimeyle).
 *  - 24 saatlik onbellekte eski bicimli 'HATA: HTTP 429: {...}' satiri
 *    kalabilir; anonim cevaba yalniz 'HATA: <kod>' gider.
 */

const getirici = vi.hoisted(() => ({ html: '' }));
vi.mock('../common/safe-fetch.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../common/safe-fetch.js')>();
  return {
    ...orig,
    safeFetchText: vi.fn(async (url: string): Promise<SafeTextResult> => ({
      status: 200, ok: true, url, redirected: false, contentType: 'text/html',
      headers: { 'content-type': 'text/html' }, text: getirici.html, truncated: false, binary: false,
    })),
  };
});

import { PublicCitationService } from './public-citation.service.js';
import { containsBrand } from './brand-in-query.js';

const siteHtml = (siteName: string) => `<html><head><title>${siteName}</title><meta property="og:site_name" content="${siteName}"></head><body></body></html>`;

function prismaSahte(cached: any[] = [], history: any[] = []) {
  const findMany = vi.fn(async (args: any) => {
    if (args?.distinct) return []; // IP hakki: bos
    if (args?.select?.brand) return history; // getHistory
    return cached; // onbellek
  });
  return { publicCitationCheck: { findMany, create: vi.fn(async () => ({ id: 'kontrol-1' })) } };
}

function aiSahte(probesFor?: (queries: string[]) => any[]) {
  return {
    runPublicProbes: vi.fn(async ({ queries }: { queries: string[] }) => (probesFor ? probesFor(queries) : [])),
    publicAggregate: vi.fn(() => ({ shareOfVoice: [] })),
    classifyRealCompetitors: vi.fn(async () => new Set<string>()),
  };
}

function servis(opts: { niche: any; ai?: ReturnType<typeof aiSahte>; prisma?: ReturnType<typeof prismaSahte> }) {
  const prisma = opts.prisma ?? prismaSahte();
  const ai = opts.ai ?? aiSahte();
  const svc = new PublicCitationService(prisma as never, ai as never, { detectFromUrl: vi.fn(async () => opts.niche) } as never);
  svc.urlResolver = async () => undefined;
  return { svc, prisma, ai };
}

beforeEach(() => { getirici.html = ''; });

describe('{BRAND_HINT} sablonu', () => {
  it('jenerik turetilmis markada alan adi konur; soru olcumde de markali sayilir', async () => {
    getirici.html = siteHtml('Emlak');
    const t = servis({ niche: { niche: 'diğer', queries: [] } });
    const r = await t.svc.check('emlak.com', '1.2.3.4');

    expect(r.brand).toBe('Emlak');
    const sorulan: string[] = t.ai.runPublicProbes.mock.calls[0][0].queries;
    expect(sorulan[0]).toBe('emlak.com ne yapiyor? Kisaca aciklar misin?');
    // buildProbe'un matcher'i (host ile) bu soruyu markali damgalar
    expect(containsBrand(sorulan[0], 'Emlak', 'emlak.com')).toBe(true);
    expect(containsBrand('Emlak ne yapiyor? Kisaca aciklar misin?', 'Emlak', 'emlak.com')).toBe(false);
    expect(r.queries[0]).toMatchObject({ query: sorulan[0], brandInQuery: true });
  });

  it('jenerik olmayan markada marka adi kalir', async () => {
    getirici.html = siteHtml('Kobipratik');
    const t = servis({ niche: { niche: 'diğer', queries: [] } });
    await t.svc.check('kobipratik.com', '1.2.3.4');
    expect(t.ai.runPublicProbes.mock.calls[0][0].queries[0]).toBe('Kobipratik ne yapiyor? Kisaca aciklar misin?');
  });
});

describe('brandInQuery yedek hesabi host ile (damga yoksa ve kilitli sorular)', () => {
  const AI_SORULARI = [
    'Türkiye\'de en iyi gayrimenkul ilan siteleri hangileri?',
    'Kiralık daire ararken hangi platformlar güvenilir?',
    'Satılık konut için en çok kullanılan siteler hangileri?',
    'Emlak alanında en güvenilir siteler hangileri?',
    'emlak.com güvenilir mi, yorumlar nasıl?',
  ].map((query) => ({ query, category: 'commercial' }));

  it('"emlak" kelimesi markali SAYILMAZ, alan adi sayilir', async () => {
    getirici.html = siteHtml('Emlak');
    const t = servis({ niche: { niche: 'gayrimenkul', queries: AI_SORULARI } });
    const r = await t.svc.check('emlak.com', '1.2.3.4');

    const byQuery = Object.fromEntries(r.queries.map((q) => [q.query, q]));
    expect(byQuery['Emlak alanında en güvenilir siteler hangileri?']).toMatchObject({ locked: true, brandInQuery: false });
    expect(byQuery['emlak.com güvenilir mi, yorumlar nasıl?']).toMatchObject({ locked: true, brandInQuery: true });
    // Olculen (kilitsiz) soruda probe damgasi yoksa da ayni kural
    expect(r.queries.filter((q) => !q.locked).every((q) => q.brandInQuery === false)).toBe(true);
  });
});

describe('saglayici alintilari — anonim cevapta yalniz guvenli bicim', () => {
  it('onbellekteki eski ham hata metni koda cevrilir; normal alinti ve guvenli satir aynen kalir', async () => {
    const cachedResult = {
      domain: 'ornek.com', brand: 'Ornek', niche: 'diğer',
      access: { tier: 'anon', unlockedQueries: 1, totalQueries: 1, lockedQueries: 0 },
      queries: [{
        query: 'soru', locked: false, citedCount: 0, totalProviders: 4, brandInQuery: false,
        providers: [
          { provider: 'openai', label: 'OpenAI ChatGPT', cited: false, brandMentioned: false, excerpt: 'HATA: HTTP 429: {"error":{"message":"Rate limit reached for org-SECRET42 on requests (req_abc123)"}}' },
          { provider: 'anthropic', label: 'Anthropic Claude', cited: false, brandMentioned: false, excerpt: 'HATA: 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key sk-ant-abcdef1234"}}' },
          { provider: 'gemini', label: 'Google Gemini', cited: false, brandMentioned: false, excerpt: 'HATA: bos cevap (finishReason=MAX_TOKENS)' },
          { provider: 'perplexity', label: 'Perplexity', cited: true, brandMentioned: true, excerpt: 'Ornek, sektörde öne çıkan bir platform.' },
        ],
      }],
      competitorRanking: [], totalLlmCalls: 4, fromCache: false,
    };
    const t = servis({
      niche: { niche: 'diğer', queries: [] },
      prisma: prismaSahte([{ id: 'eski', createdAt: new Date(), result: cachedResult }]),
    });
    const r = await t.svc.check('ornek.com', '1.2.3.4');

    expect(r.fromCache).toBe(true);
    expect(r.queries[0].providers.map((p) => p.excerpt)).toEqual([
      'HATA: rate_limited',
      'HATA: auth_failed',
      'HATA: bos cevap (finishReason=MAX_TOKENS)',
      'Ornek, sektörde öne çıkan bir platform.',
    ]);
    const json = JSON.stringify(r);
    for (const leak of ['org-SECRET42', 'req_abc123', 'sk-ant-', 'x-api-key']) expect(json).not.toContain(leak);
    expect(t.ai.runPublicProbes).not.toHaveBeenCalled();
  });

  it('taze sonucta da ayni suzgec (tek cikis kurali)', async () => {
    getirici.html = siteHtml('Ornek Platform');
    const ai = aiSahte((queries) => [{
      provider: 'openai', label: 'OpenAI ChatGPT', available: true, cost: 0,
      probes: queries.map((query) => ({ query, cited: false, brandMentioned: false, brandInQuery: false, excerpt: 'HATA: HTTP 500: upstream body org-XYZ' })),
    }]);
    const t = servis({ niche: { niche: 'diğer', queries: [] }, ai });
    const r = await t.svc.check('ornek.com', '1.2.3.4');
    expect(r.queries[0].providers[0].excerpt).toBe('HATA: upstream_unavailable');
    expect(JSON.stringify(r)).not.toContain('org-XYZ');
  });
});

describe('getHistory — her kayit olculdugu kuralla', () => {
  const sorular = (stamps?: [boolean, boolean]) => [
    { query: 'Emlak alanında en iyi siteler hangileri?', citedCount: 2, totalProviders: 7, ...(stamps ? { brandInQuery: stamps[0] } : {}) },
    { query: 'emlak.com yorumları nasıl?', citedCount: 5, totalProviders: 7, ...(stamps ? { brandInQuery: stamps[1] } : {}) },
  ];

  it('damgali (v4) kayitta damga aynen; damgasiz eski kayit yalin kelime kuraliyla — gecmis skor geriye donuk degismez', async () => {
    const history = [
      // Yeni olcum: buildProbe host'lu damgaladi — "emlak" kelimesi markasiz, alan adi markali
      { id: 'yeni', createdAt: new Date('2026-10-20T00:00:00Z'), source: 'manual', brand: 'Emlak', result: { queries: sorular([false, true]) } },
      // Damga oncesi kayit: soru da cevap da (citedCount) yalin kelimeyle olculdu
      { id: 'eski', createdAt: new Date('2026-08-01T00:00:00Z'), source: 'manual', brand: 'Emlak', result: { queries: sorular() } },
    ];
    const t = servis({ niche: { niche: 'diğer', queries: [] }, prisma: prismaSahte([], history) });
    const [yeni, eski] = await t.svc.getHistory('emlak.com');
    expect(yeni).toMatchObject({ id: 'yeni', queriesCount: 1, totalCitedScore: 2, totalProviders: 7 });
    expect(eski).toMatchObject({ id: 'eski', queriesCount: 0, totalCitedScore: 0 });
  });

  it('gecmis ucu saglayici alintisi tasimaz (yalniz toplamlar)', async () => {
    const history = [{
      id: 'h', createdAt: new Date('2026-08-01T00:00:00Z'), source: 'manual', brand: 'Ornek',
      result: { queries: [{ query: 'soru', citedCount: 0, totalProviders: 1, providers: [{ provider: 'openai', excerpt: 'HATA: HTTP 429: org-SECRET42' }] }] },
    }];
    const t = servis({ niche: { niche: 'diğer', queries: [] }, prisma: prismaSahte([], history) });
    const rows = await t.svc.getHistory('ornek.com');
    // matchVersion yalniz yontem surumu (sayi) — alinti/metin degil
    expect(Object.keys(rows[0]).sort()).toEqual(['createdAt', 'id', 'matchVersion', 'queriesCount', 'source', 'totalCitedScore', 'totalProviders']);
    expect(JSON.stringify(rows)).not.toContain('org-SECRET42');
  });
});
