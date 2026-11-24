import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  GOOGLE_LOCATION, SURFACE_ABSENT_TEXT, isFatalDataForSeoCode, parseSurfaceResponse, surfaceRequestBody,
} from './google-ai-surfaces.js';
import { citationCounts, isAbsentProbe, isErrorProbe, measuredOnly } from './citation-score.js';
import { kurulumdaVar } from './ai-citation.service.js';
import { ALL_PROVIDERS, GOOGLE_SURFACE_PROVIDERS, POOL_ENV_KEY, isGoogleSurface } from './citation-providers.js';

/**
 * Google AI Modu ve Google AI Bakisi (16.11.2026, sahip: "Google AI Modu ve AI Bakışı'nı
 * ekleyelim"; "AI Bakışı'nın görünmediği soruları ayrı yazalım, 'anılmadın' diye göstermeyiz").
 *
 * Yanit bicimleri 16.11.2026 denemesindeki gercek DataForSEO yanitlarindan (Turkiye, Turkce).
 */

const yanit = (items: unknown[], taskCode = 20000) => ({
  status_code: 20000, status_message: 'Ok.',
  tasks: [{ status_code: taskCode, status_message: taskCode === 20000 ? 'Ok.' : 'Hata', cost: 0.004, result: [{ items }] }],
});
const AI = {
  type: 'ai_overview',
  markdown: 'Türkiye\'de lojistik firmaları arasında **Netlog** ve **Örnek Lojistik** öne çıkar (ornekklinik.com).',
  references: [
    { url: 'https://www.netloglogistics.com/tr', title: 'Netlog', domain: 'www.netloglogistics.com' },
    { url: 'https://ornekklinik.com/hizmetler', title: 'Örnek', domain: 'ornekklinik.com' },
    { url: 'https://ornekklinik.com/hizmetler', title: 'Örnek (yinelenen)', domain: 'ornekklinik.com' },
  ],
};

describe('surfaceRequestBody', () => {
  it('Turkiye konumu ve Turkce; AI Bakisi icin async AI Bakisi yuklemesi istenir', () => {
    expect(GOOGLE_LOCATION).toEqual({ location_code: 2792, language_code: 'tr' });
    expect(surfaceRequestBody('google_ai_mode', 'lojistik firmaları')).toEqual([{ keyword: 'lojistik firmaları', location_code: 2792, language_code: 'tr' }]);
    expect(surfaceRequestBody('google_ai_overview', 'lojistik firmaları')).toEqual([{ keyword: 'lojistik firmaları', location_code: 2792, language_code: 'tr', load_async_ai_overview: true }]);
    // Anahtar kelime siniri (700 karakter)
    expect(String(surfaceRequestBody('google_ai_mode', 'x'.repeat(900))[0].keyword)).toHaveLength(700);
  });
});

describe('parseSurfaceResponse', () => {
  it('AI ogesi varsa metin + kaynaklar (yinelenen adres bir kez)', () => {
    const r = parseSurfaceResponse(yanit([{ type: 'organic' }, AI]));
    expect(r.kind).toBe('answer');
    if (r.kind !== 'answer') return;
    expect(r.text).toContain('Örnek Lojistik');
    expect(r.sources.map((s) => s.url)).toEqual(['https://www.netloglogistics.com/tr', 'https://ornekklinik.com/hizmetler']);
  });

  it('AI ogesi yoksa ya da bossa "yok" — hata DEGIL, "anilmadi" DEGIL', () => {
    expect(parseSurfaceResponse(yanit([{ type: 'organic' }, { type: 'people_also_ask' }]))).toEqual({ kind: 'absent' });
    expect(parseSurfaceResponse(yanit([{ type: 'ai_overview', markdown: '   ' }]))).toEqual({ kind: 'absent' });
    expect(parseSurfaceResponse(yanit([]))).toEqual({ kind: 'absent' });
  });

  it('markdown yoksa alt ogelerin metni okunur', () => {
    const r = parseSurfaceResponse(yanit([{ type: 'ai_overview', items: [{ text: 'Birinci paragraf' }, { title: 'Başlık' }] }]));
    expect(r).toMatchObject({ kind: 'answer', text: 'Birinci paragraf\nBaşlık' });
  });

  it('gecici hata (arama motoru ic hatasi, zaman asimi, gorevsiz yanit) yeniden denenir; kimlik / dogrulama / bakiye kalicidir', () => {
    expect(parseSurfaceResponse(yanit([], 40101))).toMatchObject({ kind: 'error', code: 40101, fatal: false });
    expect(parseSurfaceResponse({ status_code: 20000, tasks: [] })).toMatchObject({ kind: 'error', fatal: false });
    expect(parseSurfaceResponse({ status_code: 50401, status_message: 'Timeout' })).toMatchObject({ kind: 'error', fatal: false });
    // 16.11.2026: dogrulanmamis yeni hesap
    expect(parseSurfaceResponse({ status_code: 40104, status_message: 'Please verify your account before using the API.' }))
      .toMatchObject({ kind: 'error', code: 40104, fatal: true });
    // JSON olmayan HTTP 401/402/403 (servis status_code'a HTTP durumunu yazar) da kalici
    for (const kod of [40100, 40104, 40200, 40201, 40210, 40300, 401, 402, 403]) expect(isFatalDataForSeoCode(kod), String(kod)).toBe(true);
    for (const kod of [40101, 40102, 50000, 50401, 500, 429, null, undefined]) expect(isFatalDataForSeoCode(kod as never), String(kod)).toBe(false);
  });
});

describe('"AI Bakışı yok" satiri olcum DEGILDIR', () => {
  const yok = { query: 'q1', cited: false, brandMentioned: false, excerpt: SURFACE_ABSENT_TEXT.google_ai_overview, surfaceAbsent: true as const };
  const anildi = { query: 'q2', cited: false, brandMentioned: true, excerpt: 'Örnek Lojistik önerilir' };
  const anilmadi = { query: 'q3', cited: false, brandMentioned: false, excerpt: 'Başka firmalar' };

  it('YOK: oneki ayri tanimlanir; isErrorProbe onu da olcum disi sayar', () => {
    expect(SURFACE_ABSENT_TEXT.google_ai_overview).toBe('YOK: Google bu aramada AI Bakışı göstermedi.');
    expect(SURFACE_ABSENT_TEXT.google_ai_mode).toBe('YOK: Google bu aramada AI Modu cevabı vermedi.');
    expect(isAbsentProbe(yok)).toBe(true);
    expect(isErrorProbe(yok)).toBe(true);
    expect(isAbsentProbe({ excerpt: 'HATA: 429' })).toBe(false);
    expect(isAbsentProbe(anilmadi)).toBe(false);
    expect(measuredOnly([yok, anildi, anilmadi])).toEqual([anildi, anilmadi]);
  });

  it('skor paydasina girmez: 1 anildi + 1 anilmadi + 1 yok → 2 soruluk skor (25), 3 soruluk degil', () => {
    const c = citationCounts([yok, anildi, anilmadi] as never);
    expect(c.score).toBe(25);
    expect(citationCounts([anildi, anilmadi] as never).score).toBe(25);
    // Hepsi "yok" ise skor yok (null) — "0" degil
    expect(citationCounts([yok, { ...yok, query: 'q9' }] as never).score).toBeNull();
  });
});

describe('saglayici tablosu ve kurulum kurali', () => {
  it('iki yuzey butun listelerde; tek DataForSEO anahtarini paylasir', () => {
    expect([...GOOGLE_SURFACE_PROVIDERS]).toEqual(['google_ai_mode', 'google_ai_overview']);
    for (const p of GOOGLE_SURFACE_PROVIDERS) {
      expect(ALL_PROVIDERS).toContain(p);
      expect(isGoogleSurface(p)).toBe(true);
      expect(POOL_ENV_KEY[p]).toBe('DATAFORSEO_AUTH');
    }
    expect(isGoogleSurface('openai')).toBe(false);
  });

  it('anahtar yoksa Google yuzeyi listeye HIC girmez ("ölçülmüyor" satiri gostermez); diger saglayicilar etkilenmez', () => {
    expect(kurulumdaVar('google_ai_mode', {})).toBe(false);
    expect(kurulumdaVar('google_ai_overview', { DATAFORSEO_AUTH: '' })).toBe(false);
    expect(kurulumdaVar('google_ai_overview', { DATAFORSEO_AUTH: 'abc' })).toBe(true);
    expect(kurulumdaVar('openai', {})).toBe(true);
  });
});

describe('runPublicProbes — Google yalniz acikca istenirse', () => {
  const ESKI = { ...process.env };
  afterEach(() => { process.env = { ...ESKI }; vi.restoreAllMocks(); });

  it('`only` verilmezse (karne, App Prompt Lab) Google yuzeyi listede yok; `only` ile (uye raporu) var', async () => {
    // Yalniz DataForSEO anahtari: diger saglayicilar NO_KEY (ag cagrisi yok)
    for (const k of Object.values(POOL_ENV_KEY)) delete process.env[k];
    process.env.DATAFORSEO_AUTH = 'x';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({ status_code: 20000, tasks: [{ status_code: 20000, result: [{ items: [] }] }] }), { status: 200 }));
    const { AiCitationService } = await import('./ai-citation.service.js');
    const svc = new AiCitationService({} as never, {} as never, {} as never, {} as never) as any;
    svc.addCost = vi.fn(async () => 0);

    const varsayilan = await svc.runPublicProbes({ brand: 'Örnek', host: 'ornekklinik.com', queries: ['q1'] });
    expect(varsayilan.map((r: any) => r.provider).filter(isGoogleSurface)).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();

    const uye = await svc.runPublicProbes({ brand: 'Örnek', host: 'ornekklinik.com', queries: ['q1'], only: ['openai', 'google_ai_overview'] });
    expect(uye.find((r: any) => r.provider === 'google_ai_overview')).toMatchObject({ available: true, probes: [{ surfaceAbsent: true }] });
  });
});

describe('AiCitationService.probeGoogleSurface — ag cagrisi', () => {
  let fetchSpy: any;
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

  beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  async function kos(cevaplar: unknown[], sorular = ['q1']) {
    let i = 0;
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json(cevaplar[Math.min(i++, cevaplar.length - 1)]));
    const { AiCitationService } = await import('./ai-citation.service.js');
    const svc = new AiCitationService({} as never, {} as never, {} as never, {} as never) as any;
    svc.ARAMA_BEKLEME_MS = 1;
    return svc.probeGoogleSurface('google_ai_overview', 'anahtar-base64', 'ornekklinik.com', 'Örnek Lojistik', sorular, []);
  }

  it('Basic kimlik + dogru uc; cevapta site kaynak olarak gecerse alinti, marka adi gecerse anilma', async () => {
    const probes = await kos([yanit([AI])]);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.dataforseo.com/v3/serp/google/organic/live/advanced');
    expect((init.headers as Record<string, string>).Authorization).toBe('Basic anahtar-base64');
    expect(JSON.parse(String(init.body))[0]).toMatchObject({ keyword: 'q1', location_code: 2792, load_async_ai_overview: true });
    expect(probes).toHaveLength(1);
    expect(probes[0]).toMatchObject({ query: 'q1', cited: true, brandMentioned: true });
    expect(probes[0].surfaceAbsent).toBeUndefined();
    expect(probes[0].sources.map((s: any) => s.domain)).toEqual(expect.arrayContaining(['ornekklinik.com']));
  });

  it('AI Bakisi cikmayan soru "yok" satiri yazilir (anilmadi degil)', async () => {
    const probes = await kos([yanit([{ type: 'organic' }])]);
    // Ayni yanittan organik sira da okunur (24.11.2026): sitenin URL'i yoksa rank null
    expect(probes[0]).toEqual({ query: 'q1', cited: false, brandMentioned: false, excerpt: 'YOK: Google bu aramada AI Bakışı göstermedi.', surfaceAbsent: true, googleOrganic: { rank: null, knowledgePanel: null } });
  });

  it('gecici hata 3 kez denenir; sonra HATA satiri (diger sorular devam eder)', async () => {
    const probes = await kos([yanit([], 40101), yanit([], 40101), yanit([], 40101), yanit([AI])], ['q1', 'q2']);
    expect(fetchSpy).toHaveBeenCalledTimes(4);
    // Ham saglayici metni degil, standart `HATA: <kod>` (probe-retry sozlesmesi)
    expect(probes[0].excerpt).toMatch(/^HATA: [a-z_]+$/);
    expect(probes[1]).toMatchObject({ query: 'q2', cited: true });
  });

  it('kalici hata (dogrulanmamis hesap / bakiye) saglayiciyi durdurur — her soru icin ayri ayri denenmez', async () => {
    await expect(kos([{ status_code: 40104, status_message: 'Please verify your account' }], ['q1', 'q2'])).rejects.toThrow(/Google AI Bakışı: Please verify/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
