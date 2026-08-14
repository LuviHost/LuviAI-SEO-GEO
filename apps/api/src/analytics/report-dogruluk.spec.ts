import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  donemHesapla,
  detaylariTopla,
  citationDegerlendir,
  csvHucre,
} from './reports.service.js';

/**
 * Rapordaki sayilarin DOGRULUGU.
 *
 * NEDEN VAR: rapor kalici hale getirilmeden once hesabin duzeltilmesi
 * gerekiyordu — yanlis bir sayiyi donduran bir gecmis, hic gecmis
 * tutmamaktan daha kotudur. Kesif sirasinda uretimde SU ANDA yanlis olan
 * dort sey bulundu ve her birinin karsiligi burada bir testtir:
 *
 *  1. topQueries/topPages "donemin en cok tiklananlari" basligiyla
 *     gosteriliyordu ama YALNIZCA SON SNAPSHOT'tan aliniyordu (kodun kendi
 *     yorumu bunu itiraf ediyordu). Aylik raporda son gunun listesi.
 *  2. "Bu donemde N sorun cozuldu" = max(0, ilkIssueSayisi - sonIssueSayisi).
 *     Bir duzeltme kaydi degil, iki uzunlugun farki: 5 cozulup 5 yeni
 *     ciktiginda 0 gosteriyordu, max(0,..) da negatifi yutuyordu.
 *  3. Olculemeyen AI gorunurlugu 0 olarak yaziliyordu — grafikte sahte cokus.
 *  4. CSV kacislamasi yoktu; virgul iceren tek bir sorgu tum tabloyu
 *     kaydiriyordu.
 */

describe('donemHesapla — keyfi tarih araligi', () => {
  it('from/to verilince o aralik aynen kullaniliyor', () => {
    const r = donemHesapla({ from: new Date('2026-07-01'), to: new Date('2026-07-31') });
    expect(r.range).toBe('custom');
    expect(r.rangeStart.toISOString().slice(0, 10)).toBe('2026-07-01');
    expect(r.rangeEnd.toISOString().slice(0, 10)).toBe('2026-07-31');
    expect(r.days).toBe(30);
  });

  it('onceki donem AYNI UZUNLUKTA ve hemen oncesinde', () => {
    // Esit olmayan donemler karsilastirilirsa yuzde degisim anlamsizlasir.
    const r = donemHesapla({ from: new Date('2026-07-01'), to: new Date('2026-07-31') });
    const oncekiGun = Math.round((+r.prevEnd - +r.prevStart) / 86400000);
    expect(oncekiGun).toBe(r.days);
    expect(+r.prevEnd).toBe(+r.rangeStart);
  });

  it('ters aralik hata firlatiyor — sessizce bos rapor uretmiyor', () => {
    expect(() => donemHesapla({ from: new Date('2026-08-01'), to: new Date('2026-07-01') })).toThrow(/ters/i);
  });

  it('ayni gun secilirse gun sayisi en az 1 — bolme hatasi olmuyor', () => {
    const r = donemHesapla({ from: new Date('2026-07-15'), to: new Date('2026-07-15') });
    expect(r.days).toBe(1);
  });

  it('from/to yoksa eski davranis korunuyor (week/month/year)', () => {
    expect(donemHesapla({ range: 'week' }).days).toBe(7);
    expect(donemHesapla({ range: 'month' }).days).toBe(30);
    expect(donemHesapla({ range: 'year' }).days).toBe(365);
    expect(donemHesapla({}).range).toBe('month');
  });
});

describe('detaylariTopla — donem geneli, son gun degil', () => {
  const snapshots = [
    {
      queryDetails: [
        { query: 'seo ajansi', clicks: 10, impressions: 100, position: 5 },
        { query: 'geo optimizasyon', clicks: 1, impressions: 10, position: 30 },
      ],
    },
    {
      queryDetails: [
        { query: 'seo ajansi', clicks: 5, impressions: 50, position: 3 },
        { query: 'aso danismanlik', clicks: 8, impressions: 40, position: 2 },
      ],
    },
  ];

  it('ayni sorgu TUM snapshot\'lar boyunca toplaniyor', () => {
    const r = detaylariTopla(snapshots, 'queryDetails', 'query');
    const seo = r.find((x) => x.query === 'seo ajansi');
    expect(seo.clicks, 'son snapshot\'tan aliniyor — donem toplanmiyor').toBe(15);
    expect(seo.impressions).toBe(150);
  });

  it('yalnizca ilk snapshot\'ta gecen sorgu KAYBOLMUYOR', () => {
    // Eski surumde son snapshot'ta olmayan sorgu raporda hic gorunmuyordu.
    const r = detaylariTopla(snapshots, 'queryDetails', 'query');
    expect(r.map((x) => x.query)).toContain('geo optimizasyon');
  });

  it('CTR toplamlardan YENIDEN hesaplaniyor, ortalanmiyor', () => {
    const r = detaylariTopla(snapshots, 'queryDetails', 'query');
    const seo = r.find((x) => x.query === 'seo ajansi');
    expect(seo.ctr).toBeCloseTo(15 / 150, 6);
  });

  it('pozisyon GOSTERIMLE AGIRLIKLI ortalaniyor', () => {
    // Duz ortalama 100 gosterimli gun ile 50 gosterimli gunu esit sayardi.
    const r = detaylariTopla(snapshots, 'queryDetails', 'query');
    const seo = r.find((x) => x.query === 'seo ajansi');
    expect(seo.position).toBeCloseTo((5 * 100 + 3 * 50) / 150, 6);
    expect(seo.position, 'duz ortalama kullanilmis').not.toBeCloseTo(4, 6);
  });

  it('tiklamaya gore siralaniyor ve 10 ile sinirli', () => {
    const cok = [{ queryDetails: Array.from({ length: 30 }, (_, i) => ({ query: `s${i}`, clicks: i, impressions: 10 })) }];
    const r = detaylariTopla(cok, 'queryDetails', 'query');
    expect(r.length).toBe(10);
    expect(r[0].query).toBe('s29');
  });

  it('bozuk/eksik kayitlar cokertmiyor', () => {
    const bozuk = [{ queryDetails: [{ clicks: 5 }, null, { query: '', clicks: 1 }, 'metin'] }, { queryDetails: null }, {}];
    expect(() => detaylariTopla(bozuk as any, 'queryDetails', 'query')).not.toThrow();
    expect(detaylariTopla(bozuk as any, 'queryDetails', 'query')).toEqual([]);
  });
});

describe('citationDegerlendir — 0 ile "olcum yok" ayrimi', () => {
  it('hicbir saglayici olcum donduremediyse null — 0 DEGIL', () => {
    const r = citationDegerlendir({
      score: 0,
      providers: [
        { provider: 'anthropic', available: false },
        { provider: 'openai', available: false },
      ],
    });
    expect(r.skor, '0 donduruluyor — grafikte sahte cokus uretir').toBeNull();
    expect(r.olcumYok).toBeTruthy();
  });

  it('gercekten olculup 0 cikan skor korunuyor', () => {
    const r = citationDegerlendir({
      score: 0,
      providers: [{ provider: 'anthropic', available: true, score: 0 }],
    });
    expect(r.skor, 'gercek olcum "olcum yok" sanildi').toBe(0);
    expect(r.olcumYok).toBeNull();
  });

  it('normal skor oldugu gibi geciyor', () => {
    const r = citationDegerlendir({ score: 42, providers: [{ provider: 'openai', available: true, score: 42 }] });
    expect(r.skor).toBe(42);
    expect(r.olcumYok).toBeNull();
  });

  it('hic olcum yapilmamis site icin aciklama veriyor', () => {
    const r = citationDegerlendir(null);
    expect(r.skor).toBeNull();
    expect(r.olcumYok).toMatch(/olcum/i);
  });
});

describe('csvHucre — RFC 4180 kacislamasi', () => {
  it('virgul iceren deger tirnaklaniyor', () => {
    expect(csvHucre('ankara, oto kiralama')).toBe('"ankara, oto kiralama"');
  });

  it('ic tirnaklar ikileniyor', () => {
    expect(csvHucre('en iyi "seo" ajansi')).toBe('"en iyi ""seo"" ajansi"');
  });

  it('satir sonu iceren deger tirnaklaniyor', () => {
    expect(csvHucre('birinci\nikinci')).toBe('"birinci\nikinci"');
  });

  it('sade deger tirnaklanmiyor — gereksiz gurultu olmasin', () => {
    expect(csvHucre('seo ajansi')).toBe('seo ajansi');
    expect(csvHucre(42)).toBe('42');
  });

  it('null/undefined bos hucre', () => {
    expect(csvHucre(null)).toBe('');
    expect(csvHucre(undefined)).toBe('');
  });
});

describe('kaynak kodu — geri donusu engelleyen kontroller', () => {
  const src = readFileSync(new URL('./reports.service.ts', import.meta.url), 'utf8');

  it('sahte fixedThisRange hesabi geri gelmemis', () => {
    expect(src, 'uzunluk farki hesabi geri donmus').not.toMatch(/Math\.max\(0,\s*firstIssuesCount\s*-\s*lastIssuesCount\)/);
    expect(src).toContain('compareAuditRows');
  });

  it('top listeler artik son snapshot\'tan alinmiyor', () => {
    expect(src).not.toMatch(/lastSnapshot\?\.queryDetails/);
    expect(src).toContain("detaylariTopla(snapshots, 'queryDetails', 'query')");
  });

  it('"yapilan is" sayimi yalnizca kullanici taramalarini sayiyor', () => {
    expect(src).toMatch(/trigger:\s*'user'/);
  });

  it('CSV duz join ile yazilmiyor', () => {
    expect(src).toContain('csvHucre');
    expect(src, 'kacislamasiz join geri donmus').not.toMatch(/\]\.join\(','\)\);/);
  });
});
