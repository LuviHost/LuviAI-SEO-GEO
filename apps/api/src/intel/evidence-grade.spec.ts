import { describe, it, expect } from 'vitest';
import { computeVerdict, evidenceWeight, recencyFactor } from './evidence-grade.js';
import { fingerprintOf, normalizeUrl, cleanHtml } from './collector.service.js';

/**
 * Kanit tartimi testleri.
 *
 * Bu mantik yanlis calisirsa sistem SESSIZCE yanlis ogrenir ve o yanlisi
 * urunun skorlama mantigina tasir — bu yuzden hukum sinirlari burada
 * sabitlenmistir. Ozellikle "kademe baskinligi": gelistirme sirasinda
 * llms.txt senaryosu MYTH yerine CONTESTED donuyordu, cunku dort
 * spekulatif blog yazisi toplamda resmi dokumani dengeliyordu.
 */

const NOW = new Date('2026-08-13T00:00:00Z');
const d = (s: string) => new Date(s);

describe('recencyFactor', () => {
  it('taze kaniti tam agirlikta tutar', () => {
    expect(recencyFactor(d('2026-07-01'), NOW)).toBe(1);
  });

  it('eskidikce kademeli olarak dusurur', () => {
    expect(recencyFactor(d('2026-01-01'), NOW)).toBe(0.7);
    expect(recencyFactor(d('2024-01-01'), NOW)).toBe(0.25);
  });

  it('tarihi bilinmeyen kaniti temkinli sayar', () => {
    expect(recencyFactor(null, NOW)).toBe(0.6);
  });
});

describe('evidenceWeight', () => {
  it('orneklem vermeyen buyuk-N iddiasini kontrollu test seviyesine ceker', () => {
    const withN = evidenceWeight(
      { grade: 'large-n-study', stance: 'supports', sourceWeight: 100, publishedAt: d('2026-08-01'), sampleSize: 50_000 },
      NOW,
    );
    const withoutN = evidenceWeight(
      { grade: 'large-n-study', stance: 'supports', sourceWeight: 100, publishedAt: d('2026-08-01'), sampleSize: null },
      NOW,
    );
    expect(withN).toBe(85);
    expect(withoutN).toBe(70);
  });

  it('kaynak agirligini carpan olarak uygular', () => {
    expect(
      evidenceWeight({ grade: 'official-doc', stance: 'supports', sourceWeight: 50, publishedAt: d('2026-08-01') }, NOW),
    ).toBe(50);
  });
});

describe('computeVerdict — kademe baskinligi', () => {
  it('spekulasyon yigini resmi dokumani dengeleyemez (llms.txt senaryosu)', () => {
    const v = computeVerdict([
      { grade: 'speculation', stance: 'supports', sourceWeight: 25, publishedAt: d('2026-06-01') },
      { grade: 'speculation', stance: 'supports', sourceWeight: 25, publishedAt: d('2026-06-10') },
      { grade: 'expert-opinion', stance: 'supports', sourceWeight: 50, publishedAt: d('2026-05-20') },
      { grade: 'case-study', stance: 'supports', sourceWeight: 60, publishedAt: d('2026-07-01') },
      { grade: 'official-doc', stance: 'refutes', sourceWeight: 100, publishedAt: d('2026-06-15') },
      { grade: 'large-n-study', stance: 'refutes', sourceWeight: 90, publishedAt: d('2026-06-15'), sampleSize: 137_000 },
    ], NOW);

    expect(v.status).toBe('MYTH');
    expect(v.confidence).toBeLessThan(-0.6);
  });

  it('iki tarafta da ciddi kanit varsa kirpma yapmaz — gercek cekisme korunur', () => {
    const v = computeVerdict([
      { grade: 'large-n-study', stance: 'supports', sourceWeight: 90, publishedAt: d('2026-07-01'), sampleSize: 20_000 },
      { grade: 'controlled-test', stance: 'supports', sourceWeight: 75, publishedAt: d('2026-07-10') },
      { grade: 'official-doc', stance: 'refutes', sourceWeight: 100, publishedAt: d('2026-06-15') },
    ], NOW);

    expect(v.status).toBe('CONTESTED');
  });

  it('simetriktir — destek tarafi baskinsa dogrulanir', () => {
    const v = computeVerdict([
      { grade: 'official-doc', stance: 'supports', sourceWeight: 100, publishedAt: d('2026-07-01') },
      { grade: 'anecdote', stance: 'refutes', sourceWeight: 25, publishedAt: d('2026-07-05') },
      { grade: 'anecdote', stance: 'refutes', sourceWeight: 25, publishedAt: d('2026-07-06') },
      { grade: 'speculation', stance: 'refutes', sourceWeight: 25, publishedAt: d('2026-07-07') },
    ], NOW);

    expect(v.status).toBe('CONFIRMED');
  });
});

describe('computeVerdict — yeterlilik ve tazelik', () => {
  it('tek zayif kanitla hukum vermez', () => {
    const v = computeVerdict([
      { grade: 'speculation', stance: 'supports', sourceWeight: 25, publishedAt: d('2026-08-01') },
    ], NOW);
    expect(v.status).toBe('EMERGING');
  });

  it('kanit yoksa yeni sinyal sayar', () => {
    expect(computeVerdict([], NOW).status).toBe('EMERGING');
  });

  it('guclu ama eski kanitlari bayat isaretler', () => {
    const v = computeVerdict([
      { grade: 'large-n-study', stance: 'supports', sourceWeight: 90, publishedAt: d('2025-01-01'), sampleSize: 5000 },
      { grade: 'official-doc', stance: 'supports', sourceWeight: 100, publishedAt: d('2025-02-01') },
    ], NOW);
    expect(v.status).toBe('STALE');
  });

  it('mixed kaniti iki kefeye de yarim agirlikla yazar', () => {
    const v = computeVerdict([
      { grade: 'official-doc', stance: 'mixed', sourceWeight: 100, publishedAt: d('2026-08-01') },
    ], NOW);
    expect(v.supportWeight).toBe(v.refuteWeight);
    expect(v.confidence).toBe(0);
  });
});

describe('tekillestirme', () => {
  it('takip parametrelerini, www onekini ve sondaki slash\'i normalize eder', () => {
    expect(normalizeUrl('https://www.Example.com/post/?utm_source=x&id=3')).toBe('https://example.com/post?id=3');
  });

  it('ayni icerik ayni parmak izini verir', () => {
    const a = fingerprintOf('https://example.com/post?utm_source=newsletter', 'AI Search Study');
    const b = fingerprintOf('https://www.example.com/post/', 'AI  Search  Study');
    expect(a).toBe(b);
  });

  it('farkli icerik farkli parmak izi verir', () => {
    const a = fingerprintOf('https://example.com/a', 'Birinci yazi');
    const b = fingerprintOf('https://example.com/b', 'Ikinci yazi');
    expect(a).not.toBe(b);
  });

  it('bozuk URL\'de cokmez', () => {
    expect(() => fingerprintOf('not-a-url', 'baslik')).not.toThrow();
  });
});

describe('cleanHtml', () => {
  it('etiketleri ve script govdesini atar', () => {
    expect(cleanHtml('<p>Merhaba <b>dunya</b></p><script>evil()</script>')).toBe('Merhaba dunya');
  });

  it('temel HTML varliklarini cozer', () => {
    expect(cleanHtml('<p>A &amp; B &quot;test&quot;</p>')).toBe('A & B "test"');
  });

  it('bos girdide null doner', () => {
    expect(cleanHtml('   ')).toBeNull();
    expect(cleanHtml(null)).toBeNull();
  });
});

describe('tek kaynak kurali — MIN_DISTINCT_SOURCES', () => {
  const guclu = (sourceKey?: string) => ({
    grade: 'official-doc' as const, stance: 'supports' as const,
    sourceWeight: 100, publishedAt: d('2026-08-01'), sampleSize: null, sourceKey,
  });

  it('AYNI kaynaktan iki guclu kanit kesin hukum veremez', () => {
    // Urun karari (2026-08-21): tek kanitla is yapilmaz. Ayni yayincinin
    // iki yazisi "iki kaynak" degildir.
    const v = computeVerdict([guclu('google-search-central'), guclu('google-search-central')], NOW);
    expect(v.status).toBe('EMERGING');
  });

  it('iki FARKLI kaynak esigi acar', () => {
    const v = computeVerdict([guclu('google-search-central'), guclu('cloudflare-blog')], NOW);
    expect(v.status).toBe('CONFIRMED');
  });

  it('tek kaynakli curutme de MYTH ilan edemez', () => {
    const tek = { grade: 'large-n-study' as const, stance: 'refutes' as const,
      sourceWeight: 90, publishedAt: d('2026-08-01'), sampleSize: 80_861,
      sourceKey: 'ahrefs' };
    const v = computeVerdict([tek], NOW);
    expect(v.status).toBe('EMERGING'); // curutme gucu ne olursa olsun ikinci kaynak sart
  });

  it('sourceKey verilmeyen kanitlar (eski cagiranlar) ayri kaynak sayilir', () => {
    const v = computeVerdict([guclu(undefined), guclu(undefined)], NOW);
    expect(v.status).toBe('CONFIRMED');
  });
});


describe('kanit bagimsizligi — ayni calismanin aktarimlari tek kanit', () => {
  const haber = (sourceKey: string, basis: string | null, grade: 'large-n-study' | 'expert-opinion' | 'official-doc' = 'large-n-study') => ({
    grade, stance: 'supports' as const, sourceWeight: 70, publishedAt: d('2026-08-01'),
    sampleSize: grade === 'large-n-study' ? 50_000 : null, sourceKey, basis,
  });

  it('uc haber sitesi ayni calismayi aktariyorsa Dogrulandi olmaz', () => {
    // 20.11.2026: Pangram LinkedIn bulgusu uc sitede — eskiden CONFIRMED cikiyordu
    const v = computeVerdict([
      haber('sel', 'pangram-linkedin-2026'),
      haber('sej', 'pangram-linkedin-2026'),
      haber('ppc-land', 'pangram-linkedin-2026'),
    ], NOW);
    expect(v.status).toBe('EMERGING');
    expect(v.independentBases).toBe(1);
    expect(v.evidenceCount).toBe(3);
  });

  it('aktarimlar agirlikta da yigilmaz — en guclusu kalir', () => {
    const tek = computeVerdict([haber('sel', 'x-study')], NOW);
    const uc = computeVerdict([haber('sel', 'x-study'), haber('sej', 'x-study'), haber('ppc', 'x-study')], NOW);
    expect(uc.supportWeight).toBe(tek.supportWeight);
  });

  it('iki BAGIMSIZ calisma esigi acar', () => {
    const v = computeVerdict([haber('sel', 'pangram-linkedin-2026'), haber('sej', 'originality-linkedin-2026')], NOW);
    expect(v.status).toBe('CONFIRMED');
    expect(v.independentBases).toBe(2);
  });

  it('resmi duyuru + onu aktaran haber Dogrulandi verir (farkli yayinci sarti yine gecerli)', () => {
    const resmi = { ...haber('google-search-central-updates', 'google-faq-removal-2026', 'official-doc'), sourceWeight: 100 };
    const v = computeVerdict([resmi, haber('sel', 'google-faq-removal-2026', 'expert-opinion')], NOW);
    expect(v.status).toBe('CONFIRMED');
    // ...ama resmi not tek basina yine hukum vermez
    expect(computeVerdict([resmi], NOW).status).toBe('EMERGING');
  });

  it('resmi duyuruyu iki farkli yayinci aktardiysa agirlik esigi engel olmaz', () => {
    // Resmi notun kendisi defterde yok; SEJ (60) ve SEL aktarmis — teke inince 51 kalir
    const aktarim = (k: string) => ({ ...haber(k, 'google-spam-update-2026', 'official-doc'), sourceWeight: 60 });
    expect(computeVerdict([aktarim('sej'), aktarim('sel')], NOW).status).toBe('CONFIRMED');
    // ayni yayincinin iki yazisi yetmez
    expect(computeVerdict([aktarim('sej'), aktarim('sej')], NOW).status).toBe('EMERGING');
    // resmi olmayan calismanin aktarimlari icin istisna yok
    const calisma = (k: string) => ({ ...haber(k, 'vendor-study-2026', 'expert-opinion'), sourceWeight: 60 });
    expect(computeVerdict([calisma('sej'), calisma('sel')], NOW).status).toBe('EMERGING');
  });

  it('bayatlik aktarimlar indirilmeden olculur', () => {
    const eski = { ...haber('a', 'x-study'), publishedAt: d('2025-06-01'), sampleSize: 90_000 };
    const yeni = { ...haber('b', 'x-study', 'expert-opinion'), publishedAt: d('2026-08-01') };
    const baska = { ...haber('c', 'y-study'), publishedAt: d('2025-06-01') };
    expect(computeVerdict([eski, yeni, baska], NOW).status).not.toBe('STALE');
  });

  it('dayanak yoksa ayni yayincinin iki yazisi bagimsiz sayilmaz, farkli yayincilar sayilir', () => {
    expect(computeVerdict([haber('a', null), haber('b', null)], NOW).status).toBe('CONFIRMED');
  });

  it('ayni calismayi biri destek biri curutme diye okuduysa ikisi de tartilir', () => {
    const karsi = { ...haber('sej', 'x-study'), stance: 'refutes' as const };
    const v = computeVerdict([haber('sel', 'x-study'), karsi], NOW);
    expect(v.supportWeight).toBeGreaterThan(0);
    expect(v.refuteWeight).toBeGreaterThan(0);
  });

  it('kismen kanit kazanan tarafin ikinci bagimsiz dayanagi sayilmaz', () => {
    const kismen = { ...haber('b', 'y-study', 'expert-opinion'), stance: 'mixed' as const };
    const v = computeVerdict([haber('a', 'x-study'), haber('c', 'x-study'), kismen], NOW);
    expect(v.status).toBe('EMERGING');
  });
});

describe('normalizeBasis', () => {
  it('kebab-case, Turkce harf sadelestirilir, kisa/gecersiz null', async () => {
    const { normalizeBasis } = await import('./evidence-grade.js');
    expect(normalizeBasis('Pangram LinkedIn AI Posts 2026')).toBe('pangram-linkedin-ai-posts-2026');
    expect(normalizeBasis('Işık Üniversitesi çalışması')).toBe('isik-universitesi-calismasi');
    expect(normalizeBasis('  ')).toBeNull();
    expect(normalizeBasis(null)).toBeNull();
    expect(normalizeBasis('x'.repeat(200))?.length).toBe(120);
  });
});
