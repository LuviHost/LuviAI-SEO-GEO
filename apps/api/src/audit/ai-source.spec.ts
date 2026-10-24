import { describe, it, expect, vi } from 'vitest';
import { AI_SOURCES, classifyAiVisit, classifyReferrer, classifyUtm, trackerFilterData } from './ai-source.js';
import { AiReferrerService } from './ai-referrer.service.js';

/**
 * AI kaynakli ziyaret siniflandirmasi.
 *
 * NEDEN VAR: eski desenler referer METNINDE alt dize ariyordu — /you\.com/ "playyou.com"u,
 * /perplexity\.ai/ "notperplexity.ai"yi, /claude\.ai|anthropic\.com/ Anthropic'in blogunu
 * AI ziyareti sayiyordu; utm_source=chatgpt.com ile gelen referer'siz ziyaretler ise hic
 * sayilmiyordu.
 */

const key = (m: { key: string } | null) => m?.key ?? null;

describe('classifyReferrer — host tam eslesme ya da alt alan adi', () => {
  it.each([
    ['https://chatgpt.com/', 'chatgpt'],
    ['https://chatgpt.com/c/abc-123', 'chatgpt'],
    ['https://chat.openai.com/', 'chatgpt'],
    ['https://www.perplexity.ai/search/xyz', 'perplexity'],
    ['https://perplexity.ai/', 'perplexity'],
    ['https://claude.ai/chat/1', 'claude'],
    ['https://gemini.google.com/app', 'gemini'],
    ['https://bard.google.com/', 'gemini'],
    ['https://copilot.microsoft.com/', 'bing-copilot'],
    ['https://www.bing.com/chat?q=x', 'bing-copilot'],
    ['https://www.bing.com/search?q=x&form=COPILOT', 'bing-copilot'],
    ['https://you.com/search?q=x', 'you'],
    ['https://www.phind.com/', 'phind'],
    ['https://poe.com/ChatGPT', 'poe'],
    ['https://CHATGPT.COM/', 'chatgpt'],
    ['chatgpt.com/', 'chatgpt'],
  ])('%s -> %s', (ref, beklenen) => {
    expect(key(classifyReferrer(ref))).toBe(beklenen);
  });

  it.each([
    // alt dize yanlis pozitifleri (eski regex bunlari AI sayiyordu)
    'https://playyou.com/',
    'https://www.playyou.com/watch',
    'https://notperplexity.ai/',
    'https://mychatgpt.com/',
    'https://chatgpt.com.evil.example/',
    'https://example.com/?ref=chatgpt.com',
    'https://example.com/you.com',
    'https://google.com/search?q=claude.ai',
    // anthropic.com kurumsal site — AI cevabi degil (karar: ai-source.ts)
    'https://www.anthropic.com/news/claude',
    'https://docs.anthropic.com/',
    // normal Bing aramasi AI degil
    'https://www.bing.com/search?q=ranksup',
    // openai.com sirket sitesi, sohbet degil
    'https://openai.com/blog',
    // gecersiz / bos / sema disi
    '',
    'not a url',
    'javascript:alert(1)',
  ])('%s -> AI degil', (ref) => {
    expect(classifyReferrer(ref)).toBeNull();
  });
});

describe('classifyUtm — inis URL\'inin utm_source degeri (tam esitlik)', () => {
  it.each([
    ['https://ornek.com/blog/a?utm_source=chatgpt.com', 'chatgpt'],
    ['https://ornek.com/?utm_source=ChatGPT.com&utm_medium=referral', 'chatgpt'],
    ['https://ornek.com/?utm_source=perplexity.ai', 'perplexity'],
    ['https://ornek.com/?utm_source=gemini.google.com', 'gemini'],
    ['https://ornek.com/?utm_source=copilot.com', 'bing-copilot'],
    ['https://ornek.com/?utm_source=claude.ai', 'claude'],
    ['https://ornek.com/?utm_source=www.chatgpt.com', 'chatgpt'],
  ])('%s -> %s', (url, beklenen) => {
    expect(key(classifyUtm(url))).toBe(beklenen);
  });

  it.each([
    'https://ornek.com/',
    'https://ornek.com/?utm_source=newsletter',
    'https://ornek.com/?utm_source=chatgpt-ads-campaign',
    'https://ornek.com/?utm_source=notperplexity',
    // genel degerler sitenin kendi kampanyalariyla cakisir — sayilmaz (ai-source.ts)
    'https://ornek.com/?utm_source=openai',
    'https://ornek.com/?utm_source=claude',
    'https://ornek.com/?utm_source=gemini',
    'https://ornek.com/?utm_source=copilot',
    'https://ornek.com/?utm_source=poe',
    'https://ornek.com/?utm_source=bard',
    'https://ornek.com/?utm_source=perplexity',
    'https://ornek.com/?utm_source=chatgpt',
    'https://ornek.com/?utm_campaign=chatgpt.com',
    'https://ornek.com/?q=utm_source%3Dchatgpt.com',
    '',
  ])('%s -> AI degil', (url) => {
    expect(classifyUtm(url)).toBeNull();
  });
});

describe('classifyAiVisit', () => {
  it('once referer, yoksa utm', () => {
    expect(classifyAiVisit('https://perplexity.ai/', 'https://ornek.com/?utm_source=chatgpt.com')).toEqual({ key: 'perplexity', label: 'Perplexity', via: 'referrer' });
    expect(classifyAiVisit('', 'https://ornek.com/?utm_source=chatgpt.com')).toEqual({ key: 'chatgpt', label: 'ChatGPT', via: 'utm' });
    expect(classifyAiVisit('https://www.google.com/', 'https://ornek.com/?utm_source=chatgpt.com')?.key).toBe('chatgpt');
    expect(classifyAiVisit('https://www.google.com/', 'https://ornek.com/')).toBeNull();
  });

  it('kayitli anahtarlar degismedi (ai_referrer_hits.referrer geriye uyumlu)', () => {
    expect(AI_SOURCES.map((s) => s.key)).toEqual(['chatgpt', 'perplexity', 'claude', 'gemini', 'bing-copilot', 'you', 'phind', 'poe']);
  });
});

describe('trackerFilterData — tracker.js on suzgeci ayni listeden', () => {
  it('her host ve utm degeri listede; yol deseni yalniz bing.com icin', () => {
    const f = trackerFilterData();
    expect(f.hosts.map(([h]) => h).sort()).toEqual(AI_SOURCES.flatMap((s) => s.hosts).sort());
    expect(f.hosts.filter(([, p]) => p !== null).map(([h]) => h)).toEqual(['bing.com']);
    expect(f.utm).toContain('chatgpt.com');
    // yalniz alan adi bicimi
    for (const v of f.utm) expect(v, v).toMatch(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/);
    expect(f.hosts.map(([h]) => h)).not.toContain('anthropic.com');
  });
});

describe('AiReferrerService.record — siniflandirma kayda ayni anahtarla yansir', () => {
  function servis() {
    const upsert = vi.fn(async () => ({}));
    const prisma = { aiReferrerHit: { findUnique: vi.fn(async () => null), upsert } };
    return { s: new AiReferrerService(prisma as never), upsert };
  }

  it('referer\'siz utm_source=chatgpt.com ziyareti "chatgpt" satirina yazilir', async () => {
    const { s, upsert } = servis();
    expect(await s.record('s1', '', 'https://ornek.com/a?utm_source=chatgpt.com')).toEqual({ matched: true });
    const arg = (upsert.mock.calls[0] as any[])[0];
    expect(arg.create.referrer).toBe('chatgpt');
    expect(arg.where.siteId_date_referrer.referrer).toBe('chatgpt');
  });

  it('anthropic.com ve playyou.com kaydedilmez', async () => {
    const { s, upsert } = servis();
    expect(await s.record('s1', 'https://www.anthropic.com/news', 'https://ornek.com/')).toEqual({ matched: false });
    expect(await s.record('s1', 'https://playyou.com/', 'https://ornek.com/')).toEqual({ matched: false });
    expect(upsert).not.toHaveBeenCalled();
  });
});
