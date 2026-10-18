import { describe, it, expect } from 'vitest';
import { geoRaporHtml, tetikEtiketi, yontemNotu } from './geo-rapor-html.js';
import { compareCitationRuns, headlineOfProviders, type QueryRollup, type RunComparison, type RunProvider } from './citation-run-compare.js';

/**
 * GEO karsilastirma raporu (musteriye giden A4 belge) — yalniz bicimlendirme.
 *
 * NEDEN VAR: '06 — soru bazlı' tablosu bir kosumda OLCULMEYEN soruyu (o turda
 * yoktu ya da tum cevaplar HATA) "0" diye basiyordu; "0" musteriye "hic
 * anilmadi" diye okunur. Aksiyon onerileri de RanksUp'in kullanmadigi Google
 * Indexing API'yi ve garanti edilemeyen sonuclari vaat ediyordu.
 */

function karsilastirma(queries: QueryRollup[], over: Partial<RunComparison> = {}): RunComparison {
  return {
    // Kosumlarin gercek tetik degerleri: 'user' (panelden test) | 'system' (zamanlanmis)
    a: { id: 'a', runAt: '2026-10-01T09:00:00.000Z', headlineScore: 20, trigger: 'system' },
    b: { id: 'b', runAt: '2026-10-15T09:00:00.000Z', headlineScore: 30, trigger: 'user' },
    headlineDelta: 10,
    providers: [{ provider: 'openai', label: 'ChatGPT', before: 20, after: 30, delta: 10 }],
    changed: [],
    gained: 1,
    lost: 0,
    unchanged: 0,
    added: 1,
    removed: 1,
    methodChanged: false,
    queries,
    mentions: {
      before: { mentioned: 1, cited: 0, measured: 2 },
      after: { mentioned: 2, cited: 1, measured: 2 },
    },
    daysBetween: 14,
    ...over,
  };
}

const soru = (query: string, o: Partial<QueryRollup>): QueryRollup => ({
  query, before: 0, after: 0, delta: 0, beforeMeasured: true, afterMeasured: true, providers: [], ...o,
});

/** '06' tablosunun satirlari: [soru, A, B, Δ] metinleri */
function soruSatirlari(html: string): string[][] {
  const govde = html.split('<tbody>')[1]?.split('</tbody>')[0] ?? '';
  return govde
    .split('<tr style="break-inside:avoid;">')
    .slice(1)
    .map((tr) => [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1].replace(/<[^>]+>/g, '').trim()).slice(0, 4));
}

describe('geoRaporHtml — 06 soru bazli tablo', () => {
  it('iki kosumda da olculen soru: sayilar ve fark rozeti', () => {
    const html = geoRaporHtml({ karsilastirma: karsilastirma([soru('kredi karti', { before: 25, after: 75, delta: 50, providers: ['ChatGPT'] })]), brand: 'Ornek', host: 'ornek.com' });
    expect(soruSatirlari(html)).toEqual([['kredi karti', '25', '75', '+50']]);
  });

  it('yalniz B\'de olculen soru: A "—", fark "—" (0 degil)', () => {
    const html = geoRaporHtml({
      karsilastirma: karsilastirma([soru('yeni soru', { before: 0, after: 50, delta: 0, beforeMeasured: false, providers: ['ChatGPT'] })]),
      brand: 'Ornek', host: 'ornek.com',
    });
    expect(soruSatirlari(html)).toEqual([['yeni soru', '—', '50', '—']]);
  });

  it('yalniz A\'da olculen soru ya da B\'de tum cevaplar HATA: B "—", fark "—"', () => {
    const html = geoRaporHtml({
      karsilastirma: karsilastirma([
        soru('cikarilan soru', { before: 50, after: 0, delta: 0, afterMeasured: false }),
        soru('hic olculmeyen', { beforeMeasured: false, afterMeasured: false }),
      ]),
      brand: 'Ornek', host: 'ornek.com',
    });
    expect(soruSatirlari(html)).toEqual([
      ['cikarilan soru', '50', '—', '—'],
      ['hic olculmeyen', '—', '—', '—'],
    ]);
  });

  it('olculen ama anilmayan soru "0" kalir (gercek sifir)', () => {
    const html = geoRaporHtml({ karsilastirma: karsilastirma([soru('anilmadi', { before: 0, after: 0, delta: 0 })]), brand: 'Ornek', host: 'ornek.com' });
    expect(soruSatirlari(html)).toEqual([['anilmadi', '0', '0', '0']]);
  });

  it('alani olmayan eski veri olculmus sayilir', () => {
    const eski = { query: 'eski', before: 10, after: 20, delta: 10, providers: [] } as unknown as QueryRollup;
    const html = geoRaporHtml({ karsilastirma: karsilastirma([eski]), brand: 'Ornek', host: 'ornek.com' });
    expect(soruSatirlari(html)).toEqual([['eski', '10', '20', '+10']]);
  });
});

describe('geoRaporHtml — dogrulanabilir metin', () => {
  it('dusuk skorda Google Indexing API ve "atif vermeye baslar" vaadi yok', () => {
    const k = karsilastirma([], { b: { id: 'b', runAt: '2026-10-15T09:00:00.000Z', headlineScore: 10, trigger: 'user' } });
    const html = geoRaporHtml({ karsilastirma: k, brand: 'Ornek', host: 'ornek.com' });
    expect(html).toContain('İçerik üret ve arama motorlarına bildir');
    expect(html).toContain('bildirim dizine alınmayı garanti etmez');
    expect(html).not.toMatch(/Indexing API/);
    expect(html).not.toMatch(/atıf vermeye başlar/);
  });

  it('0 puanli motor onerisi sonuc vaat etmez', () => {
    const k = karsilastirma([], { providers: [{ provider: 'gemini', label: 'Gemini', before: 0, after: 0, delta: 0 }] });
    const html = geoRaporHtml({ karsilastirma: k, brand: 'Ornek', host: 'ornek.com' });
    expect(html).toContain('Gemini için sinyal üret');
    expect(html).toContain('Etkisi garanti değildir.');
    expect(html).not.toMatch(/görünürlüğü tetikler/);
  });

  it('trend bolumu: son 30 gun, "günlük otomatik koşumlar" iddiasi yok', () => {
    const html = geoRaporHtml({
      karsilastirma: karsilastirma([]), brand: 'Ornek', host: 'ornek.com',
      trend: [{ date: '2026-10-01', score: 20 }, { date: '2026-10-15', score: 30 }],
    });
    expect(html).toContain('SON 30 GÜN TRENDİ');
    expect(html).toContain('ölçüm yapılan günler');
    expect(html).not.toMatch(/günlük otomatik/);
    // tek nokta: bolum hic basilmaz
    const tek = geoRaporHtml({ karsilastirma: karsilastirma([]), brand: 'Ornek', host: 'ornek.com', trend: [{ date: '2026-10-15', score: 30 }] });
    expect(tek).not.toContain('SON 30 GÜN TRENDİ');
  });
});

/**
 * G8 — rapor olculmeyen asistani "0 puan" sayiyor, "N motor ort." paydasina
 * katiyor, kullanicinin kendi testini "otomatik" etiketliyor ve yontem notu
 * v2'yi anlatiyordu. Uretimde GROQ_LLAMA_MODEL tanimsiz: her kosuma meta icin
 * {available:false, score:null} satiri eklenir; sorun neredeyse her raporda cikar.
 * Karsilastirma GERCEK compareCitationRuns'tan uretilir.
 */
describe('geoRaporHtml — olculmeyen motor ve kapak sayilari (G8)', () => {
  const SORULAR = ['muhasebe programi', 'kobi kredisi', 'e-fatura'];
  const motor = (provider: string, score: number | null, cevap: 'atif' | 'yok' | 'hata' | 'olcum-yok'): RunProvider => ({
    provider,
    available: cevap !== 'olcum-yok',
    score,
    probes: cevap === 'olcum-yok' ? [] : SORULAR.map((query) => ({
      query,
      cited: cevap === 'atif',
      brandMentioned: cevap === 'atif',
      brandInQuery: false,
      excerpt: cevap === 'hata' ? 'HATA: HTTP 429' : 'cevap',
    })),
  });
  const kosum = (id: string, runAt: string, trigger: string, providers: RunProvider[]) =>
    ({ id, runAt, trigger, headlineScore: headlineOfProviders(providers), providers, matchVersion: 4 });
  const ALTI = ['openai', 'gemini', 'perplexity', 'xai', 'deepseek'];
  const metin = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

  it('tanimsiz Llama (iki testte de olculmedi): 0 puan sayilmaz, motor sayisina girmez, tabloya basilmaz', () => {
    const providers = () => [motor('anthropic', 100, 'atif'), ...ALTI.map((p) => motor(p, 100, 'atif')), motor('meta', null, 'olcum-yok')];
    const k = compareCitationRuns(
      kosum('a', '2026-10-10T13:00:00.000Z', 'user', providers()),
      kosum('b', '2026-10-17T13:00:00.000Z', 'user', providers()),
    );
    const html = metin(geoRaporHtml({ karsilastirma: k, brand: 'Ornek', host: 'ornek.com' }));
    expect(html).toContain('6 motor · 18 ölçüm');
    expect(html).toContain('/ 100 · 6 motor ort.');
    expect(html).not.toMatch(/7 motor/);
    expect(html).not.toMatch(/sinyal üret/);
    expect(html).not.toMatch(/Meta AI \(Llama\)/); // iki tarafta da olculmeyen satir yok
    expect(html).not.toMatch(/meta/);
  });

  it('Claude B\'de 429 aldi: "hâlâ 0 puan" denmez, fark ve ortalama iki testte de olculen 5 motordan', () => {
    const A = kosum('a', '2026-10-10T13:00:00.000Z', 'user', [motor('anthropic', 100, 'atif'), ...ALTI.map((p) => motor(p, 0, 'yok'))]);
    const B = kosum('b', '2026-10-17T13:00:00.000Z', 'system', [motor('anthropic', null, 'hata'), ...ALTI.map((p) => motor(p, 0, 'yok'))]);
    const html = metin(geoRaporHtml({ karsilastirma: compareCitationRuns(A, B), brand: 'Ornek', host: 'ornek.com' }));
    // Kapak: buyuk skorlar ayni 5 motor uzerinden (0 → 0), kayitli mansetler (17, 0) ayrica
    expect(html).toContain('AI GÖRÜNÜRLÜK SKORU 0 → 0 0');
    expect(html).toContain('/ 100 · iki testte de ölçülen 5 motorun ortalaması');
    expect(html).toContain('Tüm ölçülen motorlarla: A 17 (6 motor) · B 0 (5 motor).');
    expect(html).toContain("Claude yalnız A'da ölçüldü");
    expect(html).not.toMatch(/−17/);
    // Aksiyon: A'da 100 alan ve B'de olculemeyen Claude "0 puan" diye onerilmez
    expect(html).toContain('ChatGPT & Gemini için sinyal üret');
    expect(html).toContain('5 motorda hâlâ 0 puan');
    expect(html).not.toMatch(/Claude[^.]*için sinyal üret/);
    // Tetik etiketi: kullanicinin testi "senin testin", zamanlanmis kosum "otomatik"
    expect(html).toMatch(/A · [^·]+ · senin testin/);
    expect(html).toMatch(/B · [^·]+ · otomatik/);
  });

  it('R23: yalniz B\'de olculen motor "skor > 0 motor" sayisina girmez; KPI kapaktaki motor sayisini asamaz', () => {
    // A'da Claude 429 aldi (olculemedi), B'de altisi da skor > 0. Eskiden kapak
    // "5 motor" derken yanindaki KPI "6 skor > 0 motor" diyordu.
    const A = kosum('a', '2026-10-01T10:00:00.000Z', 'user', [motor('anthropic', null, 'hata'), ...ALTI.map((p) => motor(p, 100, 'atif'))]);
    const B = kosum('b', '2026-10-15T10:00:00.000Z', 'user', [motor('anthropic', 100, 'atif'), ...ALTI.map((p) => motor(p, 100, 'atif'))]);
    const html = metin(geoRaporHtml({ karsilastirma: compareCitationRuns(A, B), brand: 'Ornek', host: 'ornek.com' }));
    const kapakMotor = Number(html.match(/gün ara · (\d+) motor ·/)![1]);
    const skorluMotor = Number(html.match(/(\d+) skor &gt; 0 motor/)![1]);
    expect(kapakMotor).toBe(5);
    expect(skorluMotor).toBe(5);
    expect(html).toContain("Claude yalnız B'de ölçüldü");
    expect(html).toContain('Tüm ölçülen motorlarla: A 100 (5 motor) · B 100 (6 motor).');

    // A'da hicbir motor olculemediyse ortak motor yok: "0 motor" yaninda "3 skor > 0 motor" yazilmaz
    const A0 = kosum('a', '2026-10-01T10:00:00.000Z', 'user', ['openai', 'gemini', 'anthropic'].map((p) => motor(p, null, 'hata')));
    const B0 = kosum('b', '2026-10-15T10:00:00.000Z', 'user', ['openai', 'gemini', 'anthropic'].map((p) => motor(p, 100, 'atif')));
    const bos = metin(geoRaporHtml({ karsilastirma: compareCitationRuns(A0, B0), brand: 'Ornek', host: 'ornek.com' }));
    expect(bos).toMatch(/gün ara · 0 motor ·/);
    expect(bos).toMatch(/ 0 skor &gt; 0 motor/);
  });

  it('B manseti olculmediyse "İçerik üret" onerisi 0 puan varsayimiyla cikmaz', () => {
    const k = karsilastirma([], { b: { id: 'b', runAt: '2026-10-15T09:00:00.000Z', headlineScore: null, trigger: 'user' } });
    expect(geoRaporHtml({ karsilastirma: k, brand: 'Ornek', host: 'ornek.com' })).not.toContain('İçerik üret ve arama motorlarına bildir');
  });

  it('yontem degisti: not surume gore (v4 anilma/HATA kurali), farklar ve kazanc/kayip "—"', () => {
    const A = { ...kosum('a', '2026-10-01T09:00:00.000Z', 'user', [motor('openai', 100, 'atif')]), matchVersion: 3 };
    const B = { ...kosum('b', '2026-10-15T09:00:00.000Z', 'user', [motor('openai', 0, 'yok')]), matchVersion: 4 };
    const html = metin(geoRaporHtml({ karsilastirma: compareCitationRuns(A, B), brand: 'Ornek', host: 'ornek.com' }));
    expect(html).toContain('Ölçüm yöntemi iki test arasında güncellendi: alan adından türetilen jenerik marka adı');
    expect(html).toContain('hata veren cevaplar ölçüme girmiyor');
    expect(html).not.toMatch(/benzer alan adları/);
    expect(html).toContain('AI GÖRÜNÜRLÜK SKORU 100 → 0 —');
    expect(html).toContain('— soru kazanıldı — kaybedildi');
    expect(html).not.toMatch(/düşüşünü araştır/);
    expect(soruSatirlari(geoRaporHtml({ karsilastirma: compareCitationRuns(A, B), brand: 'Ornek', host: 'ornek.com' })).map((r) => r[3])).toEqual(['—', '—', '—']);
  });

  it('tetikEtiketi / yontemNotu', () => {
    expect(tetikEtiketi('user')).toBe('senin testin');
    expect(tetikEtiketi('system')).toBe('otomatik');
    expect(tetikEtiketi('manual')).toBeNull();
    expect(tetikEtiketi(undefined)).toBeNull();
    expect(yontemNotu({ a: 1, b: 4 })).toMatch(/benzer alan adları[\s\S]*kaynak listesindeki[\s\S]*jenerik marka/);
    expect(yontemNotu({ a: 3, b: 4 })).not.toMatch(/benzer alan adları|kaynak listesindeki/);
    expect(yontemNotu(undefined)).toContain('Farklar yöntemden kaynaklanabileceği için hesaplanmadı');
  });

  it('atifi anilmaya cevir: gercek "atif var, ad yok" sayisi', () => {
    const k = karsilastirma([], { mentions: { before: { mentioned: 0, cited: 0, measured: 3 }, after: { mentioned: 1, cited: 2, citedNotMentioned: 2, measured: 3 } } });
    const html = geoRaporHtml({ karsilastirma: k, brand: 'Ornek', host: 'ornek.com' });
    expect(html).toContain('2 ölçümde kaynak oldun ama adın 2 tanesinde anılmadı');
  });
});
