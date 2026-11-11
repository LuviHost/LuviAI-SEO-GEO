import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Saglayici cevabindan probe.sources'a (GEO Faz 2) — servis uzerinden.
 * Claude ve Gemini SDK'lari, ChatGPT/Perplexity/Grok fetch'i taklit edilir
 * (ag yok). Alinti OLCUMU degismemeli: cited eskisi gibi ham kaynak
 * dizgelerinden hesaplanir; sources yalnizca rapor icin eklenir.
 */

const anthropicCreate = vi.fn();
const deepseekCreate = vi.fn();
const deepseekClientOpts: any[] = [];
const geminiGenerate = vi.fn();

// DeepSeek Anthropic SDK'sini kendi baseURL'iyle kullanir; cagrilar ayri izlenir
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages: { create: (...a: any[]) => any };
    constructor(opts: any = {}) {
      const ds = String(opts.baseURL ?? '').includes('deepseek');
      if (ds) deepseekClientOpts.push(opts);
      this.messages = { create: (...a: any[]) => (ds ? deepseekCreate : anthropicCreate)(...a) };
    }
  },
}));
vi.mock('@google/genai', () => ({
  GoogleGenAI: class { models = { generateContent: geminiGenerate }; },
}));

const { AiCitationService } = await import('./ai-citation.service.js');
const { isErrorProbe } = await import('./citation-score.js');

const PROVIDER_KEYS = [
  'ANTHROPIC_API_KEY', 'GOOGLE_AI_API_KEY', 'OPENAI_API_KEY', 'PERPLEXITY_API_KEY',
  'XAI_API_KEY', 'DEEPSEEK_API_KEY', 'META_MODEL_API_KEY',
];
let backup: Record<string, string | undefined> = {};

beforeEach(() => {
  backup = Object.fromEntries(PROVIDER_KEYS.map((k) => [k, process.env[k]]));
  for (const k of PROVIDER_KEYS) delete process.env[k];
  anthropicCreate.mockReset();
  deepseekCreate.mockReset();
  deepseekClientOpts.length = 0;
  geminiGenerate.mockReset();
});
afterEach(() => {
  for (const [k, v] of Object.entries(backup)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.restoreAllMocks();
});

function service() {
  const prisma = { $executeRawUnsafe: vi.fn(async () => 1) };
  return new AiCitationService(prisma as any, {} as any, {} as any, {} as any);
}

const HOST = 'kobipratik.com';
const LONG_ANSWER = `Kobi muhasebe icin one cikan kaynaklar asagida. ${'Detayli aciklama. '.repeat(40)}`;

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('probe.sources — saglayici basina', () => {
  it('Claude: text citations → sources; bizim alan adimiz citation\'da ise cited (olcum ayni)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    anthropicCreate.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [
        { type: 'web_search_tool_result', tool_use_id: 't1', content: [{ type: 'web_search_result', url: 'https://yalniz-arama.com/', title: 'x' }] },
        {
          type: 'text', text: LONG_ANSWER,
          citations: [
            { type: 'web_search_result_location', url: 'https://www.kobipratik.com/rehber?utm_source=x', title: 'Kobi Pratik Rehber', cited_text: '..' },
            { type: 'web_search_result_location', url: 'https://www.reddit.com/r/Turkey/comments/9/', title: 'r/Turkey', cited_text: '..' },
          ],
        },
      ],
    });
    const out = await service().runPublicProbes({ brand: 'Muhasebe Uzmani', host: HOST, queries: ['kobi muhasebe'] });
    const probe = out.find((r) => r.provider === 'anthropic')!.probes[0];
    expect(probe.cited).toBe(true);
    expect(probe.sourcesVersion).toBe(1);
    expect(probe.sources).toEqual([
      { url: 'https://kobipratik.com/rehber', domain: 'kobipratik.com', title: 'Kobi Pratik Rehber' },
      { url: 'https://reddit.com/r/Turkey/comments/9/', domain: 'reddit.com', title: 'r/Turkey' },
    ]);
    // Tam cevap metni probe'a yazilmaz (gizlilik karari degismedi)
    expect(probe.excerpt!.length).toBe(220);
    expect(JSON.stringify(probe)).not.toContain('Detayli aciklama. '.repeat(20));
  });

  it('Gemini: yonlendirme adresleri cozulmez; baslik alan adi → originOnly kaynak; cited baslikla (eskisi gibi)', async () => {
    process.env.GOOGLE_AI_API_KEY = 'g-test';
    geminiGenerate.mockResolvedValue({
      text: LONG_ANSWER,
      candidates: [{
        finishReason: 'STOP',
        groundingMetadata: {
          groundingChunks: [
            { web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/AAA', title: 'kobipratik.com' } },
            { web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/BBB', title: 'youtube.com' } },
            { web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/CCC', title: 'Muhasebe programlari karsilastirma' } },
          ],
        },
      }],
    });
    const out = await service().runPublicProbes({ brand: 'Muhasebe Uzmani', host: HOST, queries: ['kobi muhasebe'] });
    const probe = out.find((r) => r.provider === 'gemini')!.probes[0];
    expect(probe.cited).toBe(true);
    expect(probe.sources).toEqual([
      { url: 'https://kobipratik.com/', domain: 'kobipratik.com', originOnly: true },
      { url: 'https://youtube.com/', domain: 'youtube.com', originOnly: true },
    ]);
    expect(JSON.stringify(probe)).not.toContain('vertexaisearch');
  });

  it('ChatGPT + Perplexity (fetch) ve web aramali Grok', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.PERPLEXITY_API_KEY = 'pplx-test';
    process.env.XAI_API_KEY = 'xai-test';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('api.openai.com')) {
        return jsonResponse({
          status: 'completed',
          output: [
            { type: 'web_search_call', id: 'ws_1', status: 'completed' },
            {
              type: 'message',
              content: [{
                type: 'output_text', text: LONG_ANSWER,
                annotations: [
                  { type: 'url_citation', start_index: 0, end_index: 10, url: 'https://www.parasut.com/blog/x?utm_source=openai', title: 'Parasut Blog' },
                  { type: 'url_citation', start_index: 11, end_index: 20, url: 'https://en.wikipedia.org/wiki/Accounting?utm_source=openai', title: 'Accounting - Wikipedia' },
                ],
              }],
            },
          ],
        });
      }
      if (url.includes('api.perplexity.ai')) {
        return jsonResponse({
          choices: [{ message: { content: LONG_ANSWER }, finish_reason: 'stop' }],
          citations: ['https://www.logo.com.tr/kobi', 'https://www.youtube.com/watch?v=7'],
          search_results: [{ title: 'Logo Kobi', url: 'https://www.logo.com.tr/kobi' }],
        });
      }
      if (url === 'https://api.x.ai/v1/responses') {
        return jsonResponse({
          status: 'completed',
          // Ust duzey citations: aracin topladigi TUM adresler — alinti sayilmaz
          citations: ['https://www.kobipratik.com/yalniz-okundu'],
          output: [
            { type: 'web_search_call', id: 'ws_x', status: 'completed' },
            {
              type: 'message',
              content: [{
                type: 'output_text', text: LONG_ANSWER,
                annotations: [{ type: 'url_citation', start_index: 0, end_index: 5, url: 'https://x.com/i/status/1', title: '1' }],
              }],
            },
          ],
        });
      }
      throw new Error(`beklenmeyen istek: ${url}`);
    });

    const out = await service().runPublicProbes({ brand: 'Muhasebe Uzmani', host: HOST, queries: ['kobi muhasebe'] });
    const oa = out.find((r) => r.provider === 'openai')!.probes[0];
    expect(oa.cited).toBe(false);
    expect(oa.sources).toEqual([
      { url: 'https://parasut.com/blog/x', domain: 'parasut.com', title: 'Parasut Blog' },
      { url: 'https://en.wikipedia.org/wiki/Accounting', domain: 'wikipedia.org', title: 'Accounting - Wikipedia' },
    ]);
    const px = out.find((r) => r.provider === 'perplexity')!.probes[0];
    expect(px.sources).toEqual([
      { url: 'https://logo.com.tr/kobi', domain: 'logo.com.tr', title: 'Logo Kobi' },
      { url: 'https://youtube.com/watch?v=7', domain: 'youtube.com' },
    ]);
    // Grok artik web aramali (CITATION_MATCH_VERSION 5): Responses API + web_search,
    // kaynak = inline url_citation; ust duzey citations alinti sayilmaz
    const grok = out.find((r) => r.provider === 'xai')!.probes[0];
    expect(grok.cited).toBe(false);
    expect(grok.sources).toEqual([{ url: 'https://x.com/i/status/1', domain: 'x.com', title: '1' }]);
    const grokCall = (globalThis.fetch as any).mock.calls.find((c: any[]) => String(c[0]).includes('api.x.ai'));
    const body = JSON.parse(grokCall[1].body);
    expect(body.tools).toEqual([{ type: 'web_search' }]);
    expect(body.model).toBe('grok-4.7');
    expect(body.instructions).toMatch(/web aramasi yap/);
  });

  it('Grok: cevaptaki url_citation bizim alan adimizsa alinti sayilir', async () => {
    process.env.XAI_API_KEY = 'xai-test';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => jsonResponse({
      status: 'completed',
      output: [{
        type: 'message',
        content: [{ type: 'output_text', text: LONG_ANSWER, annotations: [{ type: 'url_citation', start_index: 0, end_index: 5, url: 'https://www.kobipratik.com/pratik-araclar/kdv-hesaplama', title: '1' }] }],
      }],
    }));
    const out = await service().runPublicProbes({ brand: 'Muhasebe Uzmani', host: HOST, queries: ['kdv nasil hesaplanir'] });
    const grok = out.find((r) => r.provider === 'xai')!.probes[0];
    expect(grok.cited).toBe(true);
  });

  it('DeepSeek: Anthropic uyumlu uc + web_search; alinti listesi yok, metin olculur', async () => {
    process.env.DEEPSEEK_API_KEY = 'ds-test';
    deepseekCreate.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [
        { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'kobi muhasebe' } },
        { type: 'web_search_tool_result', tool_use_id: 's1', content: [{ type: 'web_search_result', url: 'https://www.kobipratik.com/yalniz-arama', title: 'x' }] },
        { type: 'text', text: `${LONG_ANSWER} Kaynak: kobipratik.com` },
      ],
    });
    const out = await service().runPublicProbes({ brand: 'Muhasebe Uzmani', host: HOST, queries: ['kobi muhasebe'] });
    const ds = out.find((r) => r.provider === 'deepseek')!.probes[0];
    // Metinde alan adi geciyor → alinti (arama sonucunda gorunmesi tek basina sayilmazdi)
    expect(ds.cited).toBe(true);
    // Uc alinti listesi dondurmuyor: "arandi, kaynak yok" diye bos dizi YAZILMAZ
    expect(ds).not.toHaveProperty('sources');
    expect(deepseekClientOpts[0].baseURL).toBe('https://api.deepseek.com/anthropic');
    const req = deepseekCreate.mock.calls[0][0];
    expect(req.model).toBe('deepseek-v4-pro');
    expect(req.tools).toEqual([{ type: 'web_search_20250305', name: 'web_search', max_uses: 2 }]);
    expect(anthropicCreate).not.toHaveBeenCalled();
  });

  it('DeepSeek: yalniz arama sonucunda gorunmek alinti sayilmaz', async () => {
    process.env.DEEPSEEK_API_KEY = 'ds-test';
    deepseekCreate.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [
        { type: 'web_search_tool_result', tool_use_id: 's1', content: [{ type: 'web_search_result', url: 'https://www.kobipratik.com/rehber', title: 'x' }] },
        { type: 'text', text: LONG_ANSWER },
      ],
    });
    const out = await service().runPublicProbes({ brand: 'Muhasebe Uzmani', host: HOST, queries: ['kobi muhasebe'] });
    expect(out.find((r) => r.provider === 'deepseek')!.probes[0].cited).toBe(false);
  });

  it('DeepSeek: web aramasi hep hata verirse soru olculemedi (HATA), 0 puan degil', async () => {
    process.env.DEEPSEEK_API_KEY = 'ds-test';
    deepseekCreate.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [
        { type: 'web_search_tool_result', tool_use_id: 's1', content: { type: 'web_search_tool_result_error', error_code: 'unavailable' } },
        { type: 'text', text: LONG_ANSWER },
      ],
    });
    const svc: any = service();
    svc.ARAMA_BEKLEME_MS = 0;
    const out = await svc.runPublicProbes({ brand: 'Muhasebe Uzmani', host: HOST, queries: ['kobi muhasebe'] });
    const ds = out.find((r: any) => r.provider === 'deepseek')!.probes[0];
    expect(ds.excerpt).toBe('HATA: arama hatasi (error_code=unavailable)');
    expect(isErrorProbe(ds)).toBe(true);
  });

  it('aramali saglayicida alinti yoksa sources bos dizi; HATA satirinda damga yok', async () => {
    process.env.PERPLEXITY_API_KEY = 'pplx-test';
    let n = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => (n++ === 0
      ? jsonResponse({ choices: [{ message: { content: LONG_ANSWER }, finish_reason: 'stop' }] })
      : jsonResponse({ choices: [{ message: { content: '  ' }, finish_reason: 'length' }] })));
    const out = await service().runPublicProbes({ brand: 'Muhasebe Uzmani', host: HOST, queries: ['s1', 's2'] });
    const [ok, err] = out.find((r) => r.provider === 'perplexity')!.probes;
    expect(ok.sources).toEqual([]);
    expect(ok.sourcesVersion).toBe(1);
    expect(err.excerpt).toMatch(/^HATA:/);
    expect(err).not.toHaveProperty('sourcesVersion');
    expect(err).not.toHaveProperty('sources');
  });
});

describe('saglayici hatalari — 28.10.2026 Lidio olcumu', () => {
  const aramaHatasi = { stop_reason: 'end_turn', content: [
    { type: 'web_search_tool_result', tool_use_id: 't1', content: { type: 'web_search_tool_result_error', error_code: 'unavailable' } },
    { type: 'text', text: 'Web aramasını denedim ama arama aracı hata verdi. Kendi bilgime göre...' },
  ] };
  const basarili = { stop_reason: 'end_turn', content: [
    { type: 'web_search_tool_result', tool_use_id: 't1', content: [{ type: 'web_search_result', url: 'https://x.com/', title: 'x' }] },
    { type: 'text', text: LONG_ANSWER },
  ] };

  it('Claude web aramasi hata verince soru yeniden sorulur; ikinci deneme basariliysa olcum gecerli', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    anthropicCreate.mockResolvedValueOnce(aramaHatasi).mockResolvedValueOnce(basarili);
    const svc = service();
    (svc as any).ARAMA_BEKLEME_MS = 0;
    const out = await svc.runPublicProbes({ brand: 'Muhasebe Uzmani', host: HOST, queries: ['kobi muhasebe'] });
    const r = out.find((x) => x.provider === 'anthropic')!;
    expect(anthropicCreate).toHaveBeenCalledTimes(2);
    expect(r.probes[0].excerpt).not.toMatch(/^HATA/);
  });

  it('Claude web aramasi her denemede hata verirse soru "olculemedi" olur (0 puan degil)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    anthropicCreate.mockResolvedValue(aramaHatasi);
    const svc = service();
    (svc as any).ARAMA_BEKLEME_MS = 0;
    const out = await svc.runPublicProbes({ brand: 'Muhasebe Uzmani', host: HOST, queries: ['kobi muhasebe'] });
    const r = out.find((x) => x.provider === 'anthropic')!;
    expect(anthropicCreate).toHaveBeenCalledTimes(3);
    // HATA satiri: skor/sayaclar bunu saymaz (citation-score.ts isErrorProbe); panel kosumunda tum satirlar
    // HATA ise saglayici "olculemedi" olur (providerOutcome)
    expect(r.probes[0].excerpt).toBe('HATA: arama hatasi (error_code=unavailable)');
    expect(isErrorProbe(r.probes[0])).toBe(true);
  });

  it('Gemini kredisi bitince tek denemede biter ve "billing" gorunur (rate_limited degil)', async () => {
    process.env.GOOGLE_AI_API_KEY = 'AIza-test-anahtar';
    geminiGenerate.mockRejectedValue(new Error('{"error":{"code":402,"message":"Your prepayment credits are depleted.","status":"RESOURCE_EXHAUSTED"}}'));
    const out = await service().runPublicProbes({ brand: 'Muhasebe Uzmani', host: HOST, queries: ['kobi muhasebe', 'kobi vergi'] });
    const r = out.find((x) => x.provider === 'gemini')!;
    expect(geminiGenerate).toHaveBeenCalledTimes(1);
    expect(r.available).toBe(false);
    expect(r.reason).toBe('HATA: billing');
  });
});
