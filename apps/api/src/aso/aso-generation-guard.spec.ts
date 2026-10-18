import { describe, it, expect, vi } from 'vitest';
import { AsoAiAgentService, filterKeywordSuggestions, guardOptimizedMetadata, screenKeywordSuggestions } from './ai-agent.service.js';
import { AsoScreenshotService, guardCaptions } from './screenshot.service.js';
import { AsoReviewContentService, WHATS_NEW_NOTE } from './aso-review-content.service.js';

/**
 * Uretilen ASO metni modelden dondugu gibi kullaniciya gitmez: once
 * metadata-guard.ts'ten gecer. Bu dosya bekcinin ASO uretim yuzeylerine
 * (metin onerisi, anahtar kelime, ekran goruntusu metni, What's New)
 * baglandigini dogrular.
 */

const DESC = 'Bütçem ile harcamalarını kategorilere ayır. Aylık rapor al. 10.000\'den fazla kullanıcı Bütçem kullanıyor.';

describe('guardOptimizedMetadata', () => {
  it('Android: ad ve kısa açıklamadaki iddia/eylem çağrısı çıkar; 30 sınırı aşılırsa işaretlenir', () => {
    const r = guardOptimizedMetadata(
      {
        title: 'Bütçem: Ücretsiz Gider ve Harcama Takibi Uygulaması',
        subtitle: 'Harcamalarını takip et, hemen indir!',
        description: `${DESC} 4.9 yıldızlı uygulama.`,
        suggestions: ['Ekran görüntülerini yenile', 42],
      },
      { store: 'ANDROID', currentTitle: 'Bütçem', currentDescription: DESC, rating: 4.4, appName: 'Bütçem' },
    );
    expect(r.title).toBe('Bütçem: Gider ve Harcama Takibi Uygulaması');
    expect(r.subtitle).toBe('Harcamalarını takip et');
    // Kaynakta geçen kullanıcı sayısı kalır; gerçek puanla (4.4) çelişen 4.9 iddiası çıkar
    expect(r.description).toBe(DESC);
    expect(r.suggestions).toEqual(['Ekran görüntülerini yenile']);
    expect(r.issues.map((i) => `${i.field}:${i.code}:${i.action}`)).toEqual(expect.arrayContaining([
      'title:FREE:removed',
      'title:OVER_LIMIT:flagged',
      'subtitle:CALL_TO_ACTION:removed',
      'description:RATING_CLAIM:removed',
    ]));
  });

  it('iOS: anahtar kelime alanından fiyat/ücretsiz terimleri atılır; alt başlıkta puan iddiası kalmaz', () => {
    const r = guardOptimizedMetadata(
      { title: 'Bütçem: Harcama Takibi', subtitle: '4,8 puanlı bütçe asistanı', description: DESC, keywordField: 'bütçe,ücretsiz,gider,indirimli plan' },
      { store: 'IOS', currentTitle: 'Bütçem', currentSubtitle: 'Bütçe', currentDescription: DESC, rating: 4.8 },
    );
    expect(r.keywordField).toBe('bütçe,gider');
    expect(r.subtitle).toBe('bütçe asistanı');
    expect(r.issues.find((i) => i.field === 'subtitle')).toMatchObject({ code: 'RATING_CLAIM', action: 'removed' });
  });
});

describe('filterKeywordSuggestions', () => {
  it('fiyat/üstünlük/sıralama ve rakip markası atılır, tekrar birleşir, puansız öneri atlanır', () => {
    const out = filterKeywordSuggestions(
      [
        { keyword: 'bütçe planlama', source: 'ai', relevance: 9 },
        { keyword: 'Bütçe Planlama', source: 'ai', relevance: 8 },
        { keyword: 'ücretsiz bütçe', source: 'ai', relevance: 9 },
        { keyword: 'en iyi bütçe uygulaması', source: 'ai', relevance: 9 },
        { keyword: '#1 finans', source: 'ai', relevance: 9 },
        { keyword: 'spendee alternatifi', source: 'competitor', relevance: 7 },
        { keyword: 'gider takibi', source: 'competitor', relevance: 14 },
        { keyword: 'harcama', source: 'ai' },
        { foo: 'bar' },
      ],
      ['Spendee: Bütçe ve Gider Takibi'],
      'Bütçem',
    );
    expect(out).toEqual([
      { keyword: 'bütçe planlama', source: 'ai', relevance: 9 },
      { keyword: 'gider takibi', source: 'competitor', relevance: 10 },
    ]);
  });

  it('uygulamanın kendi adı marka sayılır; "X free" bileşiği kalır; atılan öneri nedeniyle döner', () => {
    const r = screenKeywordSuggestions(
      [
        { keyword: 'free fire max', source: 'ai', relevance: 9 },
        { keyword: 'ad free music', source: 'ai', relevance: 8 },
        { keyword: 'free music app', source: 'ai', relevance: 7 },
        { keyword: 'spotify alternatifi', source: 'competitor', relevance: 6 },
      ],
      ['Spotify: Müzik ve Podcast'],
      'Free Fire: Battlegrounds',
    );
    expect(r.kept.map((k) => k.keyword)).toEqual(['free fire max', 'ad free music']);
    expect(r.dropped).toEqual([
      { keyword: 'free music app', reason: 'policy', detail: 'FREE' },
      { keyword: 'spotify alternatifi', reason: 'competitor_brand', detail: 'Spotify: Müzik ve Podcast' },
    ]);
    // Geriye uyumlu dizi
    expect(filterKeywordSuggestions([{ keyword: 'free fire max', source: 'ai', relevance: 9 }], [], 'Free Fire: Battlegrounds'))
      .toEqual([{ keyword: 'free fire max', source: 'ai', relevance: 9 }]);
  });
});

describe('AsoAiAgentService — prompt ve çıktı', () => {
  it('optimizeMetadata: Android adı 30 karakter, açıklamanın tamamı ve kurallar modele gider; çıktı bekçiden geçer', async () => {
    const chat = vi.fn().mockResolvedValue({ output: JSON.stringify({ title: '#1 Bütçem', subtitle: 'Gider takibi', description: DESC, suggestions: [] }) });
    const svc = new AsoAiAgentService({} as any, {} as any, { chat } as any);
    const longDesc = `${DESC} ${'Ek özellik. '.repeat(40)}SON-CUMLE`;
    const r = await svc.optimizeMetadata({ currentTitle: 'Bütçem', currentDescription: longDesc, targetKeywords: ['bütçe'], locale: 'tr', store: 'ANDROID' });
    const prompt: string = chat.mock.calls[0][0].messages[0].content;
    expect(prompt).toMatch(/Yeni AD öner: en fazla 30 karakter/);
    expect(prompt).not.toMatch(/\b50\b/);
    expect(prompt).toContain('SON-CUMLE'); // eskiden yalnız ilk 250 karakter gidiyordu
    expect(prompt).toMatch(/"ücretsiz"/);
    expect(prompt).toMatch(/eylem çağrısı/);
    expect(r.title).toBe('Bütçem');
    expect(r.issues[0]).toMatchObject({ code: 'RANKING', action: 'removed' });
  });

  it('optimizeMetadata iOS: açıklamanın aramada kullanılmadığı söylenir, anahtar kelime doldurma istenmez', async () => {
    const chat = vi.fn().mockResolvedValue({ output: '{"title":"Bütçem","description":"x","suggestions":[]}' });
    const svc = new AsoAiAgentService({} as any, {} as any, { chat } as any);
    await svc.optimizeMetadata({ currentTitle: 'Bütçem', currentDescription: DESC, targetKeywords: ['bütçe'], locale: 'tr', store: 'IOS' });
    const prompt: string = chat.mock.calls[0][0].messages[0].content;
    expect(prompt).toMatch(/App Store açıklamayı arama sıralamasında kullanmaz/);
    expect(prompt).toMatch(/ANAHTAR KELİME alanı: en fazla 100 karakter/);
    expect(prompt).not.toMatch(/CTA \+ keyword zengin/);
  });

  it('autonomousKeywordResearch: rakip adları toplanır ve markası öneriden düşer', async () => {
    const chat = vi.fn().mockResolvedValue({
      output: '[{"keyword":"spendee","source":"competitor","relevance":8},{"keyword":"aile bütçesi","source":"ai","relevance":7},{"keyword":"bedava bütçe","source":"ai","relevance":9}]',
    });
    const keywords = { extractCompetitorTerms: vi.fn().mockResolvedValue({ title: 'Spendee - Bütçe Takibi', keywords: ['spendee', 'bütçe'] }) };
    const svc = new AsoAiAgentService({} as any, keywords as any, { chat } as any);
    const r = await svc.autonomousKeywordResearch({ appName: 'Bütçem', competitorAppIds: [{ appId: '1', store: 'IOS' }] });
    expect(r).toEqual([{ keyword: 'aile bütçesi', source: 'ai', relevance: 7 }]);
    expect(chat.mock.calls[0][0].messages[0].content).toMatch(/Rakip uygulama, marka ya da şirket adlarını/);
  });
});

describe('ekran görüntüsü metni', () => {
  it('guardCaptions: tamamen iddia olan başlık slotu dönmez; alt başlıktaki indirim çıkar; slot sınırı', () => {
    const r = guardCaptions(
      [
        { slot: 1, hook: 'Harcamanı Kontrol Et', subtitle: 'Kategorilere ayır, %50 indirim kaçırma' },
        { slot: 2, hook: '1M+ kullanıcının tercihi', subtitle: 'Herkes kullanıyor' },
        { slot: 3, hook: 'Editörün Seçimi', subtitle: '' },
        { slot: 4, hook: 'Aylık Rapor', subtitle: 'Hemen indir, raporunu gör' },
        { slot: 11, hook: 'Fazla slot', subtitle: '' },
      ],
      { sourceText: DESC, brand: 'Bütçem', slotCount: 10 },
    );
    expect(r.captions).toEqual([
      { slot: 1, hook: 'Harcamanı Kontrol Et', subtitle: 'Kategorilere ayır' },
      { slot: 4, hook: 'Aylık Rapor', subtitle: 'raporunu gör' },
    ]);
    expect(r.issues.map((i) => i.code)).toEqual(expect.arrayContaining(['DISCOUNT', 'USER_COUNT', 'AWARD_PRESS', 'CALL_TO_ACTION']));
  });

  it('generateCaptions: prompt sosyal kanıt/indirim istemez, açıklama kırpılmadan gider', async () => {
    const chat = vi.fn().mockResolvedValue({ output: '[{"slot":1,"hook":"Harcamanı Kontrol Et","subtitle":"4.9 yıldız"}]' });
    const longDesc = `${DESC} ${'Özellik. '.repeat(80)}SON-CUMLE`;
    const prisma = { trackedApp: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'a1', name: 'Bütçem', category: 'Finance', metadata: { ios: { description: longDesc } } }) } };
    const svc = new AsoScreenshotService(prisma as any, { chat } as any);
    const r = await svc.generateCaptions({ trackedAppId: 'a1' });
    const prompt: string = chat.mock.calls[0][0].messages[0].content;
    expect(prompt).not.toMatch(/indirim\/free trial|Sosyal kanıt|rating, basın/);
    expect(prompt).toMatch(/Puan\/yıldız, kullanıcı ya da indirme sayısı, ödül, basın/);
    expect(prompt).toContain('SON-CUMLE');
    expect(r.captions).toEqual([{ slot: 1, hook: 'Harcamanı Kontrol Et', subtitle: '' }]);
    expect(r.issues[0]).toMatchObject({ code: 'RATING_CLAIM', field: 'captions[1].subtitle' });
  });
});

describe('Review → İçerik paketi: What\'s New taslağı', () => {
  it('fiyat/indirim çıkar, taslak notu döner, prompt "düzelttik" dili istemez', async () => {
    const chat = vi.fn().mockResolvedValue({
      output: JSON.stringify({ whatsNew: 'Senkronizasyon sorunlarını ele aldık.\nPremium artık %30 indirimli!', faqs: [], blogTopics: [] }),
    });
    const prisma = {
      trackedApp: { findFirst: vi.fn().mockResolvedValue({ id: 'a1', name: 'Bütçem', category: 'Finance', appStoreId: '1', playStoreId: null, metadata: { ios: { description: DESC } } }) },
      appReview: { findMany: vi.fn().mockResolvedValue(Array.from({ length: 3 }, (_, i) => ({ rating: 2, title: null, text: `senkron sorunu ${i}`, topics: ['bug'] }))) },
      contentOpportunity: { findFirst: vi.fn(), create: vi.fn() },
    };
    const svc = new AsoReviewContentService(prisma as any, { chat } as any);
    const r = await svc.buildPack('s1', 'a1');
    expect(r.whatsNew).toBe('Senkronizasyon sorunlarını ele aldık.');
    expect(r.whatsNewNote).toBe(WHATS_NEW_NOTE);
    expect(r.whatsNewIssues[0]).toMatchObject({ code: 'DISCOUNT', action: 'removed' });
    const system: string = chat.mock.calls[0][0].systemPrompt;
    expect(system).not.toMatch(/'duzelttik\/iyilestirdik' diliyle/);
    expect(system).toMatch(/Hangi duzeltmenin yapildigini BILMIYORSUN/);
  });
});
