import { describe, expect, it, vi } from 'vitest';
import { buildVideoCopy, VideoCopyError } from './article-video-copy.js';
import { loadCopyKit, loadExtractKit, type ShortArticle } from './article-short-kit.js';
import { articleBodyHtml, kickerFromCategory, publishedArticleUrl, shortArticleFromRow, sourcePathOf } from './article-video-source.js';
import { VIDEO_COPY_MODEL } from './article-video.config.js';
import { FIXTURE_ARTICLE_ROW, FIXTURE_SITE } from './article-video.fixture.js';
import type { ChatRequest, ChatResponse } from '../llm/llm.types.js';

/**
 * RanksUp Video metni: Haiku 5.5 + ZORUNLU koruyucu, her hata cikarimsal yola duser; olgu
 * uydurulmaz. Koruyucu ve sema apps/video copy.mjs'ten (CLI ile ortak) gelir.
 */

async function fixtureArticle(): Promise<ShortArticle> {
  const url = publishedArticleUrl(FIXTURE_ARTICLE_ROW.publishedTo, FIXTURE_SITE.url)!;
  return shortArticleFromRow(await loadExtractKit(), FIXTURE_ARTICLE_ROW, url)!;
}

const res = (output: string, extra: Partial<ChatResponse> = {}): ChatResponse => ({
  output,
  model: VIDEO_COPY_MODEL,
  provider: 'anthropic',
  usage: { inputTokens: 900, outputTokens: 300, cacheReadTokens: 0, cacheWriteTokens: 0 },
  costUsd: 0.00024,
  stopReason: 'end_turn',
  ...extra,
});

const ctx = { userId: 'cmuser00000000000000001', siteId: FIXTURE_SITE.id, videoId: 'cmvideo0000000000000001' };

const goodLlm = {
  hook: 'Fatura finansmanı nedir?',
  hookSub: 'Vadeli alacağı beklemeden nakde çevirmenin yoludur.',
  points: [
    { title: 'Fatura finansmanı nasıl çalışır?', detail: 'Kuruluş tutarın bir kısmını hemen öder.' },
    { title: 'Hangi işletmeler için uygundur?', detail: 'Vadesi 90 gün olan alacakları bulunan işletmeler için.' },
    { title: 'Maliyeti nasıl hesaplanır?', detail: 'Maliyet vade ve risk düzeyine göre belirlenir.' },
  ],
  cta: { label: 'Tamamını oku', domain: 'kotu-niyetli.example', url: 'https://kotu-niyetli.example/x' },
  evidence: [{ field: 'hook', source: 'Fatura finansmanı nedir?' }],
};

describe('makale kaynagi (DB, yeniden indirme yok)', () => {
  it('bodyMd: on bilgi ve govdedeki H1 atilir; H2 bolumleri ayni seviyede kalir', async () => {
    const html = articleBodyHtml(FIXTURE_ARTICLE_ROW)!;
    expect(html).not.toContain('title: "Fatura');
    const a = await fixtureArticle();
    expect(a.title).toBe('Fatura finansmanı nedir?');
    expect(a.sections.map((s) => s.heading)).toEqual([
      null,
      'Fatura finansmanı nasıl çalışır?',
      'Hangi işletmeler için uygundur?',
      'Maliyeti nasıl hesaplanır?',
      'Sıkça Sorulan Sorular',
    ]);
    expect(a.sourceText).toContain('%30');
  });

  it('canli adres: sitenin kendi alan adindaki http(s) kayit, FTP kaydi degil', () => {
    expect(publishedArticleUrl(FIXTURE_ARTICLE_ROW.publishedTo, FIXTURE_SITE.url)).toBe('https://www.ornekklinik.com/blog/fatura-finansmani-nedir/');
    // Cop kutusundaki kopya canli sayilmaz
    expect(publishedArticleUrl([{ targetId: 't1', ok: true, externalUrl: 'https://ornekklinik.com/a/', trashedAt: '2026-10-01T00:00:00Z' }], FIXTURE_SITE.url)).toBeNull();
    expect(sourcePathOf('https://www.ornekklinik.com/blog/fatura-finansmani-nedir/', 'ornekklinik.com')).toBe('ornekklinik.com/blog');
  });

  it('kategori yalniz okunur ad ise ust etiket olur (slug videoda gorunmez)', () => {
    expect(kickerFromCategory('Finans Rehberi')).toBe('Finans Rehberi');
    expect(kickerFromCategory('pratik-kobi-rehberi')).toBeNull();
    expect(kickerFromCategory('x'.repeat(41))).toBeNull();
    expect(kickerFromCategory(null)).toBeNull();
  });
});

describe('koruyucu (validateScript) — uydurma reddi', () => {
  it('makalede gecmeyen sayi RET (strict ve normal)', async () => {
    const kit = await loadCopyKit();
    const a = await fixtureArticle();
    const s = kit.normalizeLlmScript({ ...goodLlm, points: [{ title: 'Maliyet %45 düşer' }, ...goodLlm.points.slice(1)] }, a);
    for (const strict of [true, false]) {
      const c = kit.validateScript(s, a, { strict });
      expect(c.ok).toBe(false);
      expect(c.errors.join(' ')).toMatch(/"%45" sayisi makalede yok/);
    }
    // Makalede gecen sayilar kabul
    expect(kit.validateScript(kit.normalizeLlmScript(goodLlm, a), a, { strict: true }).ok).toBe(true);
  });

  it('uzunluk siniri ve 3 madde zorunlu; yenilik orani strict modda RET, normalde uyari', async () => {
    const kit = await loadCopyKit();
    const a = await fixtureArticle();
    expect(kit.validateScript(kit.normalizeLlmScript({ ...goodLlm, hook: 'a'.repeat(111) }, a), a).errors.join(' ')).toMatch(/hook cok uzun/);
    expect(kit.validateScript(kit.normalizeLlmScript({ ...goodLlm, points: goodLlm.points.slice(0, 2) }, a), a).errors.join(' ')).toMatch(/3 madde gerekli/);
    const uydurma = kit.normalizeLlmScript({
      ...goodLlm,
      points: [
        { title: 'Muhteşem kazançlar garantili şekilde gelir' },
        { title: 'Bankalar bunu sizden saklıyor olabilir' },
        { title: 'Hemen başvurun şimdi kaçırmayın' },
      ],
    }, a);
    const strict = kit.validateScript(uydurma, a, { strict: true });
    expect(strict.ok).toBe(false);
    expect(strict.errors.join(' ')).toMatch(/kelime orani yuksek/);
    const normal = kit.validateScript(uydurma, a);
    expect(normal.errors.join(' ')).not.toMatch(/kelime orani/);
    expect(normal.warnings.join(' ')).toMatch(/kelime orani yuksek/);
  });

  it('API semasi: desteklenmeyen kisitlar silinir, alanlar ayni (evidence dahil)', async () => {
    const kit = await loadCopyKit();
    const api = JSON.stringify(kit.apiSchema(kit.SCRIPT_JSON_SCHEMA));
    expect(api).not.toMatch(/maxLength|minItems|maxItems|minLength/);
    for (const f of ['hook', 'hookSub', 'kicker', 'points', 'cta', 'evidence']) expect(api).toContain(`"${f}"`);
    expect(JSON.stringify(kit.SCRIPT_JSON_SCHEMA)).toMatch(/maxLength/);
  });
});

describe('buildVideoCopy — Haiku 5.5, olmazsa cikarimsal', () => {
  it('gecerli LLM ciktisi: strateji llm; CTA adresi modelden DEGIL makaleden', async () => {
    const kit = await loadCopyKit();
    const a = await fixtureArticle();
    const chat = vi.fn<(req: ChatRequest) => Promise<ChatResponse>>(async () => res(JSON.stringify(goodLlm)));
    const r = await buildVideoCopy(a, ctx, { kit, chat });
    expect(r.strategy).toBe('llm');
    expect(r.script.cta).toEqual({ label: 'Tamamını oku', domain: 'ornekklinik.com', url: 'https://www.ornekklinik.com/blog/fatura-finansmani-nedir/' });
    expect(r.costUsd).toBeCloseTo(0.00024);
    const req = chat.mock.calls[0][0];
    expect(req.model).toBe('claude-haiku-5-5');
    expect(req.outputSchema).toBeTruthy();
    expect(JSON.stringify(req.outputSchema)).not.toMatch(/maxLength/);
    expect(req.messages[0].content).toContain('Vadesi 90 gün olan alacakları');
    expect(req.userId).toBe(ctx.userId);
  });

  it('LLM uydurma sayi yazarsa cikarimsal yola duser, uydurma metin videoya girmez', async () => {
    const kit = await loadCopyKit();
    const a = await fixtureArticle();
    const chat = vi.fn(async () => res(JSON.stringify({ ...goodLlm, hook: 'İşletmelerin %87’si kullanıyor' })));
    const r = await buildVideoCopy(a, ctx, { kit, chat });
    expect(r.strategy).toBe('extractive');
    expect(r.llmRejected).toMatch(/uydurma sayi/);
    expect(JSON.stringify(r.script)).not.toContain('87');
    expect(r.check.ok).toBe(true);
    // Reddedilen cagri da faturalanir — maliyet kayda gecer
    expect(r.costUsd).toBeCloseTo(0.00024);
  });

  it.each([
    ['AI kapali / ag hatasi', async () => { throw new Error('AI_GLOBAL_DISABLED'); }],
    ['ret (refusal)', async () => res('', { stopReason: 'refusal' })],
    ['kesik cikti', async () => res('{"hook":"Fat', { stopReason: 'max_tokens' })],
    ['bozuk JSON', async () => res('Elbette! İşte metin: {hook:')],
  ])('%s -> cikarimsal yol, video yine uretilir', async (_ad, impl) => {
    const kit = await loadCopyKit();
    const a = await fixtureArticle();
    const r = await buildVideoCopy(a, ctx, { kit, chat: vi.fn(impl as any) });
    expect(r.strategy).toBe('extractive');
    expect(r.llmRejected).toBeTruthy();
    expect(r.script.points).toHaveLength(3);
    expect(r.script.hook).toBe('Fatura finansmanı nedir?');
    // cikarimsal metindeki her madde makalenin kendi basligi
    for (const p of r.script.points) expect(a.sourceText).toContain(p.title);
  });

  it('aylik AI butcesi doluysa model HIC cagrilmaz', async () => {
    const kit = await loadCopyKit();
    const a = await fixtureArticle();
    const chat = vi.fn(async () => res(JSON.stringify(goodLlm)));
    const r = await buildVideoCopy(a, ctx, { kit, chat, budgetBlocked: async () => true });
    expect(chat).not.toHaveBeenCalled();
    expect(r.strategy).toBe('extractive');
    expect(r.llmRejected).toMatch(/butce/);
  });

  it('kapanis dugmesi makalenin dilinde (Ingilizce makale: "Read the full article")', async () => {
    const kit = await loadCopyKit();
    const extract = await loadExtractKit();
    const en = shortArticleFromRow(extract, { ...FIXTURE_ARTICLE_ROW, language: 'en' }, 'https://www.ornekklinik.com/blog/x/')!;
    expect(kit.extractiveScript(en).cta.label).toBe('Read the full article');
    expect(kit.normalizeLlmScript(goodLlm, en).cta.label).toBe('Read the full article');
    expect(kit.extractiveScript(await fixtureArticle()).cta.label).toBe('Tamamını oku');
  });

  it('cikarimsal yol da koruyucudan gecemezse acik Turkce hata (video uretilmez)', async () => {
    const kit = await loadCopyKit();
    const extract = await loadExtractKit();
    const bos = shortArticleFromRow(extract, { title: 'Kısa not', bodyMd: 'Tek satır.' }, FIXTURE_SITE.url)!;
    await expect(buildVideoCopy(bos, ctx, { kit, chat: vi.fn(async () => { throw new Error('x'); }) }))
      .rejects.toBeInstanceOf(VideoCopyError);
    await expect(buildVideoCopy(bos, ctx, { kit, chat: vi.fn(async () => { throw new Error('x'); }) }))
      .rejects.toMatchObject({ userMessage: expect.stringMatching(/video metni çıkarılamadı/) });
  });
});

/**
 * Sayi korumasi TAM UYELIK (inceleme bulgusu, guard.mjs): eski `src.includes(n)` alt-dize
 * aramasiydi; makalede "2025" / "150" gecince uydurma "20", "%50", "1", "5" kabul ediliyordu.
 * Sartlar md.8, SSS, /help/video ve llms.txt "makalede birebir gecmeyen sayi reddedilir" diyor.
 */
describe('koruyucu — sayi korumasi tam uyelik (alt-dize degil)', () => {
  const sourceText = 'Fatura finansmanı nedir? 2025 yılında KOBİler için fatura finansmanı nakit akışını hızlandırır. Başvuru süreci kolaydır ve faturanız değerlendirilir. Fatura tutarının 150 bin liraya kadar kısmı finanse edilebilir. Onay süresi bankaya göre değişir. Komisyon %2,5 ile 1.000 TL arasıdır. Son güncelleme 21.10.2026.';
  const article = { sourceText, lang: 'tr', domain: 'ornek.com', url: 'https://ornek.com/a' } as unknown as ShortArticle;
  const script = (texts: string[]) => ({
    hook: 'Fatura finansmanı nedir?',
    points: [{ title: texts[0] ?? 'Fatura finansmanı' }, { title: texts[1] ?? 'Başvuru süreci kolaydır' }, { title: texts[2] ?? 'Onay süresi bankaya göre değişir' }],
  });

  it('guard.mjs bypass\'lari: "20", "%50", "1", "5" makalede yok -> RET', async () => {
    const kit = await loadCopyKit();
    const s = kit.normalizeLlmScript({
      hook: 'Fatura finansmanı nedir?',
      points: [
        { title: 'Fatura finansmanı nakit akışını hızlandırır', detail: 'Onay süresi 20 dakika' },
        { title: 'Başvuru süreci kolaydır', detail: 'Fatura tutarının %50 kısmı finanse edilebilir' },
        { title: 'Faturanız 1 günde değerlendirilir', detail: 'KOBİler için 5 kat hızlı nakit akışı' },
      ],
    }, article);
    const c = kit.validateScript(s, article, { strict: true });
    expect(c.ok).toBe(false);
    const all = c.errors.join(' | ');
    for (const n of ['"20"', '"%50"', '"1"', '"5"']) expect(all).toContain(`${n} sayisi makalede yok`);
  });

  it('parcadan sayi turetilmez: "02", "15", "25", "100", "2,5" (yuzdesiz kaynak %2,5 ise yuzdeli yazim sart degil ama tersi sart)', async () => {
    const kit = await loadCopyKit();
    for (const bad of ['Yıl 02 oldu', '15 bin lira', 'Komisyon %25', '100 TL', '%150 artış', 'Komisyon %1.000']) {
      const c = kit.validateScript(script([bad]), article);
      expect(c.ok, bad).toBe(false);
    }
    // Kaynakta duz "150" var ama yuzde degil: video "%150" diyemez; kaynakta "%2,5" var: duz "2,5" denebilir
    expect(kit.validateScript(script(['Komisyon 2,5 olabilir']), article).ok).toBe(true);
  });

  it('mesru sayilar gecer; Turkce / Ingilizce yazim ayni sayiya duser', async () => {
    const kit = await loadCopyKit();
    for (const good of [
      '2025 yılında KOBİler',
      '150 bin liraya kadar',
      'Komisyon %2,5',
      'Komisyon % 2,5',
      'Komisyon 2.5% olabilir',
      '1.000 TL üst sınır',
      '1000 TL üst sınır',
      '1,000 TL üst sınır',
      'Son güncelleme 21.10.2026',
      '2026 güncellemesi',
    ]) {
      const c = kit.validateScript(script([good]), article);
      expect(c.errors.filter((e: string) => /sayisi/.test(e)), good).toEqual([]);
    }
  });
});
