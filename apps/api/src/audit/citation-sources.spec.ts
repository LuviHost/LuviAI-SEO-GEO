import { describe, it, expect } from 'vitest';
import {
  normalizeSourceUrl, normalizeSources, isGroundingRedirect, asHostname, sourceColumns, providersWithoutSources, titleAsHostname,
  anthropicSources, anthropicSearchFailure, geminiSources, openaiSources, perplexitySources,
  MAX_SOURCES_PER_PROBE, MAX_SOURCE_URL_LEN, MAX_SOURCE_TITLE_LEN,
} from './citation-sources.js';

/**
 * Alintilanan kaynaklarin normalize/tekil/sinirli kaydi (GEO Faz 2).
 * Fixture'lar saglayicilarin gercek cevap bicimlerinden kisaltildi.
 */

const REDIRECT = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQHx7kq3Zr0Vn5c2bQeJ-abcDEF123_xyz';

describe('normalizeSourceUrl', () => {
  it('https, kucuk harf host, www. atilir, fragment atilir', () => {
    expect(normalizeSourceUrl('http://WWW.Ornek.COM/Blog/Yazi#baslik')).toEqual({ url: 'https://ornek.com/Blog/Yazi', host: 'ornek.com' });
  });

  it('izleme parametreleri (utm_*, gclid, fbclid, srsltid) atilir, digerleri kalir', () => {
    const r = normalizeSourceUrl('https://ornek.com/urun?id=7&utm_source=openai&UTM_Medium=x&gclid=abc&fbclid=def&srsltid=q&sayfa=2');
    expect(r?.url).toBe('https://ornek.com/urun?id=7&sayfa=2');
  });

  it('yalniz izleme parametresi varsa sonda ? kalmaz', () => {
    expect(normalizeSourceUrl('https://ornek.com/a?utm_source=openai')?.url).toBe('https://ornek.com/a');
  });

  it('semasiz adres https kabul edilir; kullanici:sifre atilir', () => {
    expect(normalizeSourceUrl('ornek.com.tr/x')?.url).toBe('https://ornek.com.tr/x');
    expect(normalizeSourceUrl('https://kim:gizli@ornek.com/x')?.url).toBe('https://ornek.com/x');
  });

  it('http(s) disi sema, bos, noktasiz host ve bozuk adres reddedilir', () => {
    expect(normalizeSourceUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeSourceUrl('ftp://ornek.com/a')).toBeNull();
    expect(normalizeSourceUrl('mailto:a@ornek.com')).toBeNull();
    expect(normalizeSourceUrl('')).toBeNull();
    expect(normalizeSourceUrl('http://localhost/x')).toBeNull();
    expect(normalizeSourceUrl('http://[bozuk')).toBeNull();
  });

  it('uzun adres: once sorgu, sonra yol atilir — kirpilmis (kirik) URL yazilmaz', () => {
    const longQuery = `https://ornek.com/kisa-yol?q=${'a'.repeat(400)}`;
    expect(normalizeSourceUrl(longQuery)?.url).toBe('https://ornek.com/kisa-yol');
    expect(normalizeSourceUrl(longQuery)?.originOnly).toBeUndefined();
    const longPath = `https://ornek.com/${'b'.repeat(400)}`;
    expect(normalizeSourceUrl(longPath)).toEqual({ url: 'https://ornek.com/', host: 'ornek.com', originOnly: true });
    expect(normalizeSourceUrl(longPath)!.url.length).toBeLessThanOrEqual(MAX_SOURCE_URL_LEN);
  });

  it('yolu sigmayan URL koke duser ve kaynakta originOnly isaretlenir; ayni sitenin tam adresi gelirse tam olan kazanir', () => {
    const longPath = `https://ornek.com/${'b'.repeat(400)}`;
    expect(normalizeSources([{ url: longPath, title: 'Uzun' }])).toEqual([
      { url: 'https://ornek.com/', domain: 'ornek.com', title: 'Uzun', originOnly: true },
    ]);
    expect(normalizeSources([{ url: longPath }, { url: 'https://ornek.com/' }])).toEqual([
      { url: 'https://ornek.com/', domain: 'ornek.com' },
    ]);
  });
});

describe('normalizeSources', () => {
  it('domain kayit edilebilir alan: .com.tr / .co.uk / alt alan', () => {
    const out = normalizeSources([
      { url: 'https://blog.ornek.com.tr/a' },
      { url: 'https://news.bbc.co.uk/b' },
      { url: 'https://tr.wikipedia.org/wiki/X' },
    ]);
    expect(out.map((s) => s.domain)).toEqual(['ornek.com.tr', 'bbc.co.uk', 'wikipedia.org']);
  });

  it('gurultu filtresi YOK: reddit / youtube / wikipedia / linkedin kalir', () => {
    const out = normalizeSources([
      { url: 'https://www.reddit.com/r/turkey/comments/abc' },
      { url: 'https://www.youtube.com/watch?v=xyz' },
      { url: 'https://en.wikipedia.org/wiki/SEO' },
      { url: 'https://www.linkedin.com/pulse/x' },
    ]);
    expect(out.map((s) => s.domain)).toEqual(['reddit.com', 'youtube.com', 'wikipedia.org', 'linkedin.com']);
  });

  it('normalize sonrasi ayni adres tekillesir; ilk sira korunur, eksik baslik tamamlanir', () => {
    const out = normalizeSources([
      { url: 'https://ornek.com/a?utm_source=openai' },
      { url: 'https://b.com/' },
      { url: 'http://www.ornek.com/a#x', title: 'Ornek Yazi' },
    ]);
    expect(out).toEqual([
      { url: 'https://ornek.com/a', domain: 'ornek.com', title: 'Ornek Yazi' },
      { url: 'https://b.com/', domain: 'b.com' },
    ]);
  });

  it(`probe basina en fazla ${MAX_SOURCES_PER_PROBE} kaynak`, () => {
    const raw = Array.from({ length: 35 }, (_, i) => ({ url: `https://site${i}.com/p` }));
    const out = normalizeSources(raw);
    expect(out).toHaveLength(MAX_SOURCES_PER_PROBE);
    expect(out[0].domain).toBe('site0.com');
    expect(out[19].domain).toBe('site19.com');
  });

  it('baslik bosluk-sadelestirilir, sinirlanir; alan adinin aynisiysa yazilmaz', () => {
    const out = normalizeSources([
      { url: 'https://a.com/1', title: `  Uzun\n\nbaslik ${'x'.repeat(300)}` },
      { url: 'https://b.com/2', title: 'www.b.com' },
      { url: 'https://c.com/3', title: '   ' },
    ]);
    expect(out[0].title!.length).toBe(MAX_SOURCE_TITLE_LEN);
    expect(out[0].title!.startsWith('Uzun baslik x')).toBe(true);
    expect(out[1].title).toBeUndefined();
    expect(out[2].title).toBeUndefined();
  });

  it('gecersiz girdiler sessizce atilir', () => {
    expect(normalizeSources([{ url: null }, { url: 'not a url' }, {} as any, null as any, { url: 'https://ok.com' }]))
      .toEqual([{ url: 'https://ok.com/', domain: 'ok.com' }]);
  });

  it('IP adresli kaynakta domain host\'un kendisi', () => {
    expect(normalizeSources([{ url: 'http://93.184.216.34/x' }])).toEqual([{ url: 'https://93.184.216.34/x', domain: '93.184.216.34' }]);
  });
});

describe('Claude — text block citations', () => {
  // Messages API + web_search_20260209 cevabindan kisaltilmis
  const content = [
    { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'en iyi kredi karsilastirma' } },
    {
      type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1',
      content: [{ type: 'web_search_result', url: 'https://arama-sonucu-ama-alintilanmadi.com/', title: 'X', encrypted_content: 'enc' }],
    },
    { type: 'text', text: 'Turkiye\'de one cikan platformlar: ' },
    {
      type: 'text', text: 'Hangikredi ve Bankateklifi.',
      citations: [
        { type: 'web_search_result_location', url: 'https://www.hangikredi.com/kredi?utm_source=x', title: 'HangiKredi - Kredi Karsilastirma', cited_text: '...', encrypted_index: 'e1' },
        { type: 'web_search_result_location', url: 'https://bankateklifi.com/', title: 'bankateklifi.com', cited_text: '...', encrypted_index: 'e2' },
        { type: 'web_search_result_location', url: 'https://www.reddit.com/r/Turkey/comments/1/kredi/', title: 'r/Turkey', cited_text: '...', encrypted_index: 'e3' },
      ],
    },
    { type: 'text', text: ' Ayrica', citations: [{ type: 'web_search_result_location', url: 'https://hangikredi.com/kredi', title: 'HangiKredi', cited_text: '...', encrypted_index: 'e4' }] },
  ];

  it('yalniz alintilanan kaynaklar; arama sonucu alinti sayilmaz; tekillesir', () => {
    expect(normalizeSources(anthropicSources(content))).toEqual([
      { url: 'https://hangikredi.com/kredi', domain: 'hangikredi.com', title: 'HangiKredi - Kredi Karsilastirma' },
      { url: 'https://bankateklifi.com/', domain: 'bankateklifi.com' },
      { url: 'https://reddit.com/r/Turkey/comments/1/kredi/', domain: 'reddit.com', title: 'r/Turkey' },
    ]);
  });

  it('beklenmeyen govde bos liste', () => {
    expect(anthropicSources(undefined)).toEqual([]);
    expect(anthropicSources([{ type: 'text', text: 'x', citations: null }])).toEqual([]);
  });
});

describe('Gemini — groundingChunks (yonlendirme adresleri)', () => {
  const chunks = [
    { web: { uri: REDIRECT, title: 'bankateklifi.com' } },
    { web: { uri: `${REDIRECT}2`, title: 'www.hangikredi.com' } },
    // urun adlari alan adi DEGIL: buyuk harf ya da bilinmeyen TLD
    { web: { uri: `${REDIRECT}7`, title: 'Next.js' } },
    { web: { uri: `${REDIRECT}8`, title: 'ASP.NET' } },
    { web: { uri: `${REDIRECT}9`, title: 'vue.js' } },
    { web: { uri: `${REDIRECT}3`, title: 'tr.wikipedia.org' } },
    // basligi alan adi degil → alan adi bilinemez, atlanir
    { web: { uri: `${REDIRECT}4`, title: 'Kredi faiz oranlari 2026 - Guncel liste' } },
    // ayni siteden ikinci sayfa → kok adres tekillesir
    { web: { uri: `${REDIRECT}5`, title: 'bankateklifi.com' } },
    // Vertex: domain alani dolu
    { web: { uri: `${REDIRECT}6`, title: 'Some Page Title', domain: 'ornek.co.uk' } },
    // yonlendirme olmayan gercek adres oldugu gibi
    { web: { uri: 'https://www.youtube.com/watch?v=abc&utm_campaign=z', title: 'Video' } },
    { retrievedContext: { uri: 'gs://x' } },
  ];

  it('yonlendirme cozulmez; alan adi basliktan, url sitenin koku + originOnly', () => {
    expect(normalizeSources(geminiSources(chunks))).toEqual([
      { url: 'https://bankateklifi.com/', domain: 'bankateklifi.com', originOnly: true },
      { url: 'https://hangikredi.com/', domain: 'hangikredi.com', originOnly: true },
      { url: 'https://tr.wikipedia.org/', domain: 'wikipedia.org', originOnly: true },
      { url: 'https://ornek.co.uk/', domain: 'ornek.co.uk', title: 'Some Page Title', originOnly: true },
      { url: 'https://youtube.com/watch?v=abc', domain: 'youtube.com', title: 'Video' },
    ]);
  });

  it('yonlendirme adresi hicbir zaman kaydedilmez', () => {
    const json = JSON.stringify(normalizeSources(geminiSources(chunks)));
    expect(json).not.toContain('vertexaisearch');
  });

  it('isGroundingRedirect / asHostname', () => {
    expect(isGroundingRedirect(REDIRECT)).toBe(true);
    expect(isGroundingRedirect('https://ornek.com/grounding-api-redirect/x')).toBe(false);
    expect(asHostname('WWW.Ornek.com.tr.')).toBe('ornek.com.tr');
    expect(asHostname('Kredi faiz oranlari')).toBeNull();
    expect(asHostname('1.2.3.4')).toBeNull();
    expect(asHostname(undefined)).toBeNull();
  });

  it('titleAsHostname: urun adlari reddedilir, gercek alan adlari kabul', () => {
    for (const t of ['Next.js', 'Vue.js', 'vue.js', 'node.js', 'ASP.NET', 'Socket.IO', 'Three.js', 'D3.js', 'Chart.js', 'ornek.museumx']) {
      expect(titleAsHostname(t), t).toBeNull();
    }
    expect(titleAsHostname('bankateklifi.com')).toBe('bankateklifi.com');
    expect(titleAsHostname('www.ornek.com.tr')).toBe('ornek.com.tr');
    expect(titleAsHostname('bbc.co.uk')).toBe('bbc.co.uk');
    expect(titleAsHostname('perplexity.ai')).toBe('perplexity.ai');
    expect(titleAsHostname('asp.net')).toBe('asp.net'); // kucuk harf + gercek TLD = gercek alan adi
    // web.domain (Vertex) icin buyuk/kucuk harf serbest
    expect(asHostname('Ornek.CO.UK')).toBe('ornek.co.uk');
  });
});

describe('ChatGPT — url_citation annotations', () => {
  const parts = [
    {
      type: 'output_text',
      text: 'One cikanlar: [hangikredi.com](https://www.hangikredi.com/?utm_source=openai) ve Reddit.',
      annotations: [
        { type: 'url_citation', start_index: 14, end_index: 70, url: 'https://www.hangikredi.com/?utm_source=openai', title: 'HangiKredi' },
        { type: 'url_citation', start_index: 75, end_index: 81, url: 'https://www.reddit.com/r/PersonalFinanceTR/?utm_source=openai', title: 'Reddit' },
        { type: 'file_citation', file_id: 'f1' },
      ],
    },
    { type: 'output_text', text: 'devam', annotations: [{ type: 'url_citation', url: 'https://hangikredi.com/', title: 'HangiKredi tekrar' }] },
  ];

  it('utm_source=openai atilir, tekillesir, reddit kalir', () => {
    expect(normalizeSources(openaiSources(parts))).toEqual([
      { url: 'https://hangikredi.com/', domain: 'hangikredi.com', title: 'HangiKredi' },
      { url: 'https://reddit.com/r/PersonalFinanceTR/', domain: 'reddit.com', title: 'Reddit' },
    ]);
  });
});

describe('Perplexity — citations + search_results', () => {
  it('sira citations\'tan, baslik search_results\'tan; yalniz search_results da okunur', () => {
    const data = {
      citations: ['https://www.bankateklifi.com/kredi', 'https://www.youtube.com/watch?v=1'],
      search_results: [
        { title: 'YouTube video', url: 'https://www.youtube.com/watch?v=1', date: '2026-09-01' },
        { title: 'Banka Teklifi', url: 'https://www.bankateklifi.com/kredi' },
        { title: 'Ek sonuc', url: 'https://ek.com.tr/a' },
      ],
    };
    expect(normalizeSources(perplexitySources(data))).toEqual([
      { url: 'https://bankateklifi.com/kredi', domain: 'bankateklifi.com', title: 'Banka Teklifi' },
      { url: 'https://youtube.com/watch?v=1', domain: 'youtube.com', title: 'YouTube video' },
      { url: 'https://ek.com.tr/a', domain: 'ek.com.tr', title: 'Ek sonuc' },
    ]);
    expect(perplexitySources({ citations: ['https://a.com'] })).toEqual([{ url: 'https://a.com', title: null }]);
    expect(perplexitySources(null)).toEqual([]);
  });
});

describe('sourceColumns (GeoPromptRun)', () => {
  it('aramasiz saglayici: sources NULL, surum dolu; eski probe: ikisi de bos', () => {
    expect(sourceColumns({ sourcesVersion: 1 })).toEqual({ sources: undefined, sourcesVersion: 1 });
    expect(sourceColumns({ sources: [], sourcesVersion: 1 })).toEqual({ sources: [], sourcesVersion: 1 });
    expect(sourceColumns({})).toEqual({ sources: undefined, sourcesVersion: null });
  });
});

describe('providersWithoutSources (Audit.checks yazimi, MCP run_prompt)', () => {
  it('probe kaynaklari cikar; damga, diger alanlar ve girdi aynen kalir', () => {
    const providers = [
      { provider: 'openai', available: true, probes: [{ query: 'q', cited: true, sources: [{ url: 'https://a.com/', domain: 'a.com' }], sourcesVersion: 1 }, { query: 'h', excerpt: 'HATA: x' }] },
      { provider: 'xai', available: false, reason: 'NO_KEY' },
    ];
    const out = providersWithoutSources(providers);
    expect(out[0].probes![0]).toEqual({ query: 'q', cited: true, sourcesVersion: 1 });
    expect(out[0].probes![1]).toBe(providers[0].probes![1]);
    expect(out[1]).toEqual({ provider: 'xai', available: false, reason: 'NO_KEY' });
    expect(providers[0].probes![0].sources).toHaveLength(1);
    expect(providersWithoutSources(null)).toBeNull();
    expect(providersWithoutSources(undefined)).toBeUndefined();
  });
});

describe('anthropicSearchFailure — Claude web aramasi basarisiz mi', () => {
  const hata = (kod: string) => ({ type: 'web_search_tool_result', tool_use_id: 't', content: { type: 'web_search_tool_result_error', error_code: kod } });
  const basarili = { type: 'web_search_tool_result', tool_use_id: 't', content: [{ type: 'web_search_result', url: 'https://x.com/', title: 'x' }] };
  it('tum aramalar hata verdiyse kodu doner', () => {
    expect(anthropicSearchFailure([{ type: 'server_tool_use' }, hata('too_many_requests'), { type: 'text', text: 'arama hata verdi' }])).toBe('too_many_requests');
  });
  it('en az bir arama basariliysa olcum gecerli (sonraki aramanin max_uses hatasi bozmaz)', () => {
    expect(anthropicSearchFailure([basarili, hata('max_uses_exceeded'), { type: 'text', text: 'cevap' }])).toBeNull();
  });
  it('arama yoksa ya da icerik bozuksa null; garip kod metne sizmaz', () => {
    expect(anthropicSearchFailure([{ type: 'text', text: 'cevap' }])).toBeNull();
    expect(anthropicSearchFailure(undefined)).toBeNull();
    expect(anthropicSearchFailure([hata('kotu kod <script>')])).toBe('bilinmiyor');
  });
});
