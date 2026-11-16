import { describe, it, expect } from 'vitest';
import { attemptEmailHtml, markala, reportOfResult, trTarih, type AttemptReport } from './public-check-report-email.js';
import { attemptNotification } from './public-check-attempt.js';
import { MARKA, ustGorsel } from '../email/email-layout.js';

/** E-postanin tek gorseli: hareketli ust gorsel (ucretsiz test = hedef isareti) */
const UST_GORSEL = ustGorsel('hedef', process.env.WEB_BASE_URL ?? 'https://ranksup.ai');

/**
 * Ucretsiz test bildirim e-postasi (sahip istegi 15.11.2026): site diliyle (koyu, duz) gider ve
 * ziyaretcinin gordugu RAPORU tasir. Bu dosya uc seyi sabitler:
 *  1. Sayilar sonuc ekraniyla ayni kuraldan (skor, anan asistan sayisi).
 *  2. Disaridan gelen her metin kacislanir (soru, cevap alintisi, rakip adi, alan adi).
 *  3. E-posta kurallari: SVG / dis gorsel / betik yok; eski acik renkli duzen kullanilmaz.
 */

const p = (provider: string, o: Partial<{ cited: boolean; brandMentioned: boolean; measured: boolean; excerpt: string }> = {}) => ({
  provider, label: `Etiket ${provider}`, measured: o.measured ?? true, cited: o.cited ?? false, brandMentioned: o.brandMentioned ?? false, excerpt: o.excerpt,
});
const DORT = (anan: string[] = [], alinti: Record<string, string> = {}) =>
  ['anthropic', 'gemini', 'openai', 'perplexity'].map((id) => p(id, { brandMentioned: anan.includes(id), excerpt: alinti[id] ?? 'Genel bir cevap.' }));

const SONUC = {
  domain: 'ornekklinik.com', brand: 'Örnek Klinik', niche: 'saglik', customNiche: 'estetik cerrahisi',
  queries: [
    { query: 'Örnek Klinik ne yapıyor?', category: 'BRAND', brandInQuery: true, providers: DORT(['anthropic', 'gemini', 'openai', 'perplexity']), citedCount: 4, totalProviders: 4 },
    { query: 'İngiltere\'den görüşme nasıl ayarlanır?', category: 'DISCOVERY', brandInQuery: false, providers: DORT(['anthropic'], { anthropic: 'Klinikler arasında Örnek Klinik öne çıkıyor.' }), citedCount: 1, totalProviders: 4 },
    { query: 'Saç ekimi ne kadar tutar?', category: 'DISCOVERY', brandInQuery: false, providers: DORT(), citedCount: 0, totalProviders: 4 },
    { query: 'Fark nedir?', category: 'COMPARISON', brandInQuery: false, providers: DORT(), citedCount: 0, totalProviders: 4 },
    { query: 'Kilitli soru bir', category: 'PROBLEM', locked: true, brandInQuery: false, providers: [], citedCount: 0, totalProviders: 4 },
    { query: 'Kilitli soru iki', category: 'BUYING_INTENT', locked: true, brandInQuery: false, providers: [], citedCount: 0, totalProviders: 4 },
  ],
  access: { tier: 'anon', unlockedQueries: 4, totalQueries: 6, lockedQueries: 2 },
  competitorRanking: [
    { name: 'rakip-a.com', mentions: 2, pct: 14 },
    { name: 'Örnek Klinik', mentions: 1, pct: 7, isBrand: true },
  ],
  totalLlmCalls: 16, fromCache: false,
};

describe('reportOfResult — sayilar sonuc ekraniyla ayni kuraldan', () => {
  it('skor acik ve MARKASIZ sorulardan: 12 cevabin 1\'i → 8; markali soru skora girmez', () => {
    const r = reportOfResult(SONUC)!;
    expect(r.score).toBe(8);
    expect(r.engines).toEqual([
      { label: 'Claude', cited: true }, { label: 'Gemini', cited: false }, { label: 'ChatGPT', cited: false }, { label: 'Perplexity', cited: false },
    ]);
    // Markali soru listede durur ama isaretlidir
    expect(r.questions.map((q) => [q.no, q.branded, q.cited, q.total])).toEqual([[1, true, 4, 4], [2, false, 1, 4], [3, false, 0, 4], [4, false, 0, 4]]);
    expect(r.questions[1].category).toBe('Keşif');
  });

  it('markasiz acik soru yoksa acik sorularin tamami sayilir (web summarize ile ayni)', () => {
    const r = reportOfResult({ ...SONUC, queries: [SONUC.queries[0], SONUC.queries[4]] })!;
    expect(r.score).toBe(100);
    expect(r.engines.every((e) => e.cited)).toBe(true);
  });

  it('kilitli sorular ayri listede, sira numarasi ekrandakiyle ayni; sonuc tasimazlar', () => {
    const r = reportOfResult(SONUC)!;
    expect(r.locked).toEqual([{ no: 5, query: 'Kilitli soru bir' }, { no: 6, query: 'Kilitli soru iki' }]);
    expect(r.questions.some((q) => q.query.startsWith('Kilitli'))).toBe(false);
  });

  it('hata veren saglayici sayilara girmez, "yanit yok" diye isaretlenir; HATA alintisi cevap sayilmaz', () => {
    const bozuk = { ...SONUC.queries[1], providers: [p('anthropic', { brandMentioned: true, excerpt: 'HATA: zaman asimi' }), p('gemini', { measured: false, excerpt: 'HATA: 500' }), p('openai'), p('perplexity')], citedCount: 1, totalProviders: 3 };
    const r = reportOfResult({ ...SONUC, queries: [bozuk] })!;
    expect(r.engines.map((e) => e.label)).toEqual(['Claude', 'ChatGPT', 'Perplexity']);
    expect(r.questions[0].providers.find((x) => x.label === 'Gemini')!.state).toBe('unmeasured');
    expect(r.questions[0].answers).toEqual([]);
    expect(r.score).toBe(33);
  });

  it('yalniz markayi anan / kaynak gosteren asistanin alintisi girer; uzun alinti "kisaltildi" isaretli', () => {
    const r = reportOfResult(SONUC)!;
    expect(r.questions[1].answers).toEqual([{ label: 'Claude', excerpt: 'Klinikler arasında Örnek Klinik öne çıkıyor.', truncated: false }]);
    expect(r.questions[2].answers).toEqual([]);
    const uzun = 'a'.repeat(215);
    const u = reportOfResult({ ...SONUC, queries: [{ ...SONUC.queries[1], providers: [p('openai', { cited: true, excerpt: uzun })] }] })!;
    expect(u.questions[0].answers[0].truncated).toBe(true);
  });

  it('olculen cevap yoksa skor null (0 "hic anilmadi" diye okunurdu)', () => {
    const r = reportOfResult({ ...SONUC, queries: [{ ...SONUC.queries[2], providers: [], citedCount: 0, totalProviders: 0 }] })!;
    expect(r.score).toBeNull();
    expect(r.engines).toEqual([]);
  });

  it('kayitli sonucta olcum ani tasinir; taze olcumde tasinmaz', () => {
    expect(reportOfResult(SONUC)!.measuredAt).toBeNull();
    const k = reportOfResult({ ...SONUC, fromCache: true, cachedAt: new Date('2026-11-12T08:00:00.000Z') })!;
    expect(k.measuredAt).toBe('2026-11-12T08:00:00.000Z');
    expect(reportOfResult({ ...SONUC, fromCache: true, cachedAt: 'bozuk' })!.measuredAt).toBeNull();
  });

  it('okunamayan / eski kayit: null (e-posta raporsuz gider, bildirim dusmez)', () => {
    for (const bozuk of [null, undefined, {}, { queries: 'x' }, { queries: [] }, { queries: [{ query: '  ' }, null] }]) {
      expect(reportOfResult(bozuk)).toBeNull();
    }
  });

  it('sinirlar: en fazla 10 acik soru, 12 kilitli soru, 8 rakip; uzun metin kirpilir', () => {
    const acik = Array.from({ length: 15 }, (_, i) => ({ ...SONUC.queries[2], query: `Soru ${i} ${'x'.repeat(400)}` }));
    const kilitli = Array.from({ length: 20 }, (_, i) => ({ ...SONUC.queries[4], query: `Kilitli ${i}` }));
    const rakip = Array.from({ length: 12 }, (_, i) => ({ name: `rakip-${i}.com`, mentions: 1, pct: 5 }));
    const r = reportOfResult({ ...SONUC, queries: [...acik, ...kilitli], competitorRanking: rakip })!;
    expect(r.questions).toHaveLength(10);
    expect(r.locked).toHaveLength(12);
    expect(r.competitors).toHaveLength(8);
    expect(r.questions[0].query.length).toBe(300);
  });
});

describe('markala — marka vurgusu kacislanmis varligi bolmez', () => {
  const VURGU = /<span style="[^"]*">([^<]*)<\/span>/g;
  const vurgulananlar = (html: string) => [...html.matchAll(VURGU)].map((m) => m[1]);

  it('marka HAM metinde aranir: "Amp" markasi "&amp;" varliginin icini vurgulamaz', () => {
    const html = markala('Tom & Jerry, Amp ile çalışır', 'Amp');
    expect(html).toContain('Tom &amp; Jerry, ');
    expect(vurgulananlar(html)).toEqual(['Amp']);
    expect(html).not.toContain('&<span');
  });

  it('buyuk kucuk harf ayirmaz, her gecisi vurgular; kacislanmasi gereken marka da calisir', () => {
    expect(vurgulananlar(markala('vestel ve VESTEL', 'Vestel'))).toEqual(['vestel', 'VESTEL']);
    const html = markala('Koç & Koç <b>iyi</b>', 'Koç & Koç');
    expect(vurgulananlar(html)).toEqual(['Koç &amp; Koç']);
    expect(html).toContain('&lt;b&gt;iyi&lt;/b&gt;');
    expect(html).not.toContain('<b>');
  });

  it('kisa ya da bos markada vurgu yok, metin yine kacislanir', () => {
    expect(markala('<i>a</i> ab', 'ab')).toBe('&lt;i&gt;a&lt;/i&gt; ab');
    expect(markala('x & y', null)).toBe('x &amp; y');
  });
});

describe('trTarih', () => {
  it('Turkiye saatiyle gun (UTC+3): gece yarisina yakin olcum ertesi gune duser', () => {
    expect(trTarih('2026-11-12T08:00:00.000Z')).toBe('12 Kasım 2026');
    expect(trTarih('2026-11-12T21:30:00.000Z')).toBe('13 Kasım 2026');
    expect(trTarih(null)).toBeNull();
    expect(trTarih('bozuk')).toBeNull();
  });
});

const girdi = (over: Partial<Parameters<typeof attemptEmailHtml>[0]> = {}) => {
  const n = attemptNotification({ domain: 'ornekklinik.com', outcome: 'cached', summary: { brand: 'Örnek Klinik', niche: 'estetik cerrahisi', cited: 1, total: 12 } });
  return {
    title: n.title, domain: 'ornekklinik.com', outcome: 'cached' as const, note: n.note,
    summary: { brand: 'Örnek Klinik', niche: 'estetik cerrahisi', cited: 1, total: 12 },
    report: reportOfResult({ ...SONUC, fromCache: true, cachedAt: new Date('2026-11-12T08:00:00.000Z') }),
    panelUrl: 'https://ranksup.ai/admin/leads',
    ...over,
  };
};

describe('attemptEmailHtml — rapor e-postanin icinde', () => {
  const html = attemptEmailHtml(girdi());

  it('alan adi, marka, skor, ozet cumlesi ve durum notu', () => {
    expect(html).toContain('ornekklinik.com');
    expect(html).toContain('Örnek Klinik · estetik cerrahisi');
    expect(html).toContain('4 AI asistanının 1 tanesinde anıldı');
    expect(html).toMatch(/>8<\/div>\s*<div[^>]*>skor \/ 100/);
    expect(html).toContain('Ücretsiz test · kayıtlı sonucu gördü');
    expect(html).toContain('Bu alan adı daha önce ölçülmüştü; ziyaretçi kayıtlı sonucu gördü, yeni ölçüm yapılmadı. Ölçüm tarihi: 12 Kasım 2026.');
    // Baslik ne oldugunu soyler (alan adi basta)
    expect(html).toContain('ornekklinik.com için kayıtlı sonuç gösterildi</h1>');
  });

  // Sahibin gosterdigi ornek e-postalarin kompozisyonu (15.11.2026): ustte ekran karti, sonra
  // baslik, durum cumlesi ve TEK buyuk dugme; raporun ayrintisi dugmeden SONRA gelir.
  it('kompozisyon sirasi: ekran karti → baslik → durum → dugme → ayrinti', () => {
    const sira = [
      `bgcolor="${MARKA.ekran}"`,
      'için kayıtlı sonuç gösterildi</h1>',
      // Govdedeki cumle (tarihle biter); ayni cumle gizli onizleme metninde de gecer
      'yeni ölçüm yapılmadı. Ölçüm tarihi',
      'Panelde aç&nbsp;&rarr;</a>',
      'Marka bu AI cevaplarında geçti mi?',
      'Rakip karşılaştırması',
      'kilitli, ölçülmedi',
    ].map((parca) => html.indexOf(parca));
    expect(sira.every((i) => i > 0)).toBe(true);
    expect([...sira].sort((a, b) => a - b)).toEqual(sira);
    // Ozet kartinda asistanlar acik yuzey cipiyle, ayrintida koyu yuzey cipiyle
    expect(html).toContain(`color:${MARKA.iyi};font-weight:600;">Claude &#10003;`);
    expect(html).toContain(`color:${MARKA.yesil};">Claude &#10003;`);
  });

  it('soru soru asistan isaretleri, anan cevabin alintisi (marka belirgin), rakipler, kilitli sorular', () => {
    expect(html).toContain('İngiltere&#39;den görüşme nasıl ayarlanır?');
    expect(html).toContain('Claude &#10003;');
    expect(html).toContain('Gemini &#10005;');
    expect(html).toMatch(/Klinikler arasında <span[^>]*>Örnek Klinik<\/span> öne çıkıyor\./);
    expect(html).toContain('markalı soru, skora girmez');
    expect(html).toContain('rakip-a.com');
    expect(html).toContain('(test edilen marka)');
    expect(html).toContain('Ziyaretçinin görmediği 2 soru (kilitli, ölçülmedi)');
    expect(html).toContain('Kilitli soru iki');
  });

  it('dugmeler: "Panelde aç" verilen adrese, "Siteyi aç" alan adina', () => {
    expect(html).toContain('href="https://ranksup.ai/admin/leads"');
    expect(html).toContain('>Panelde aç&nbsp;&rarr;</a>');
    expect(html).toContain('href="https://ornekklinik.com"');
  });

  it('site dili: koyu zemin, turuncu yalniz logoda ve tek birincil dugmede; eski acik renkli duzenin renkleri yok', () => {
    expect(html).toContain(`bgcolor="${MARKA.zemin}"`);
    // Turuncu: logodaki "Up" + dugme (bgcolor, style, Outlook yedegi). Cip, baglanti, baslik degil.
    expect(html.split(MARKA.primary).length - 1).toBeLessThanOrEqual(4);
    expect(html.split(`bgcolor="${MARKA.primary}"`).length - 1).toBe(1);
    for (const eski of ['#FAF8F6', '#E04E24', '#F36D32', '#B63325', '#6c5ce7']) expect(html).not.toContain(eski);
    expect(html).toContain('content="dark"');
  });

  it('e-posta kurallari: SVG, betik ve harici stil yok; TEK gorsel hareketli ust gorsel (hedef isareti)', () => {
    expect(html).toContain(UST_GORSEL);
    expect(html.match(/<img/g)).toHaveLength(1);
    expect(html).not.toMatch(/<svg|<script|<link|<iframe|javascript:/i);
  });

  it('disaridan gelen HER metin kacislanir (alan adi, marka, soru, alinti, rakip adi)', () => {
    const XSS = '<img src=x onerror=alert(1)>';
    const kotu = reportOfResult({
      ...SONUC,
      brand: `Marka ${XSS}`,
      queries: [{ ...SONUC.queries[1], query: `Soru ${XSS}`, providers: [p('openai', { cited: true, excerpt: `Cevap ${XSS} "tirnak"` })] }, { ...SONUC.queries[4], query: `Kilitli ${XSS}` }],
      competitorRanking: [{ name: `rakip ${XSS}`, mentions: 1, pct: 5 }],
    });
    const out = attemptEmailHtml(girdi({ report: kotu, domain: `kotu.com/"><b>`, summary: { brand: `Marka ${XSS}`, niche: `nis ${XSS}` }, note: `Not ${XSS}` }));
    expect(out).not.toContain(XSS);
    // Ham etiket yok (metin olarak kacislanmis hali durur: "&lt;img … onerror=alert(1)&gt;");
    // tek <img> e-postanin kendi ust gorseli
    expect(out.replace(UST_GORSEL, '')).not.toMatch(/<img|<b>/);
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(out).toContain('&quot;tirnak&quot;');
  });

  it('olcum yapilmayan deneme ya da raporsuz kayit: yalniz durum notu, rapor bolumleri yok', () => {
    const n = attemptNotification({ domain: 'ornekklinik.com', outcome: 'rate_limited' });
    const out = attemptEmailHtml(girdi({ outcome: 'rate_limited', title: n.title, note: n.note, report: reportOfResult(SONUC), summary: undefined }));
    expect(out).toContain('haftalık sınıra takıldı ve ölçülmedi');
    expect(out).not.toContain('skor / 100');
    expect(out).not.toContain('Rakip karşılaştırması');
    const raporsuz = attemptEmailHtml(girdi({ report: null }));
    expect(raporsuz).toContain('ziyaretçi kayıtlı sonucu gördü');
    expect(raporsuz).not.toContain('skor / 100');
  });

  it('bos rapor bolumleri cizilmez (rakip yok, kilitli soru yok)', () => {
    const r: AttemptReport = { ...reportOfResult(SONUC)!, competitors: [], locked: [] };
    const out = attemptEmailHtml(girdi({ report: r }));
    expect(out).not.toContain('Rakip karşılaştırması');
    expect(out).not.toContain('kilitli, ölçülmedi');
  });
});

describe('Google AI Bakisi "bu soruda yok" cipi (16.11.2026)', () => {
  it('YOK satiri "yanıt yok" (hata) degil "bu soruda yok" cipi; anildi / anilmadi sayilmaz', () => {
    const q = {
      query: 'Saç ekimi ne kadar tutar?', category: 'DISCOVERY', brandInQuery: false, citedCount: 0, totalProviders: 1,
      providers: [
        p('openai'),
        { ...p('google_ai_overview', { measured: false, excerpt: 'YOK: Google bu aramada AI Bakışı göstermedi.' }), label: 'Google AI Bakışı' },
        p('gemini', { measured: false, excerpt: 'HATA: timeout' }),
      ],
    };
    const r = reportOfResult({ ...SONUC, queries: [q] })!;
    expect(r.questions[0].providers.map((x) => x.state)).toEqual(['absent', 'surface_absent', 'unmeasured']);
    const html = attemptEmailHtml(girdi({ report: r }));
    expect(html).toContain('Google AI Bakışı &ndash; bu soruda yok');
    expect(html).not.toContain('Google AI Bakışı &ndash; yanıt yok');
  });
});
