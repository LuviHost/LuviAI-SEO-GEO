import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Saglayici cevabindan probe.sources'a (GEO Faz 2) — servis uzerinden.
 * Claude ve Gemini SDK'lari, ChatGPT/Perplexity/Grok fetch'i taklit edilir
 * (ag yok). Alinti OLCUMU degismemeli: cited eskisi gibi ham kaynak
 * dizgelerinden hesaplanir; sources yalnizca rapor icin eklenir.
 */

const anthropicCreate = vi.fn();
const geminiGenerate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => ({
  default: class { messages = { create: anthropicCreate }; },
}));
vi.mock('@google/genai', () => ({
  GoogleGenAI: class { models = { generateContent: geminiGenerate }; },
}));

const { AiCitationService } = await import('./ai-citation.service.js');

const PROVIDER_KEYS = [
  'ANTHROPIC_API_KEY', 'GOOGLE_AI_API_KEY', 'OPENAI_API_KEY', 'PERPLEXITY_API_KEY',
  'XAI_API_KEY', 'DEEPSEEK_API_KEY', 'GROQ_API_KEY',
];
let backup: Record<string, string | undefined> = {};

beforeEach(() => {
  backup = Object.fromEntries(PROVIDER_KEYS.map((k) => [k, process.env[k]]));
  for (const k of PROVIDER_KEYS) delete process.env[k];
  anthropicCreate.mockReset();
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

  it('ChatGPT + Perplexity (fetch) ve aramasiz Grok', async () => {
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
      return jsonResponse({ choices: [{ message: { content: LONG_ANSWER }, finish_reason: 'stop' }] });
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
    // Aramasiz saglayici: damga var, kaynak listesi yok
    const grok = out.find((r) => r.provider === 'xai')!.probes[0];
    expect(grok.sourcesVersion).toBe(1);
    expect(grok).not.toHaveProperty('sources');
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
