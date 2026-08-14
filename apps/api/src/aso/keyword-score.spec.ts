import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { AsoKeywordService } from './keyword.service.js';

/**
 * Anahtar kelime skorlarinin DURUSTLUGU.
 *
 * NEDEN VAR — kullanici panelde 50 kelimenin HEPSINDE "Pop. 10" gorup
 * "yanlislik mi var?" diye sordu. Uretimde olculdu ve iki ayri sorun cikti:
 *
 *  1. iOS'ta popularity KADEMELI BIR SKOR DEGIL, IKILI BIR SINYAL.
 *     aso-v2 iOS icin `zScore(8000, oneriVar ? 5000 : 0)` hesapliyor
 *     (analyzer.js:78-82), yani matematiksel olarak yalnizca iki sonuc
 *     uretilebilir: 6.63 (-> 66) ya da 1.0 (-> 10). Ara deger YOK.
 *     Canli olcum: "kredi" 66, "oyun" 66, "ticari leasing" 10.
 *     Android'de ayni alan gercekten kademeli: 89 ve 92.
 *     "10/100" diye gostermek kullaniciya "olculmus ama dusuk" dedirtiyordu;
 *     dogrusu "Apple bu terime hic oneri vermiyor".
 *
 *  2. normalizeScore olculemeyeni 0 donuyordu ve `?? 0` NaN'i yakalamiyordu
 *     (NaN ?? 0 -> NaN). Yani "magaza cevap vermedi" sessizce "olctuk, sifir
 *     cikti"ya donusuyordu. Rank tarafinda bu ayrim `measurable` bayragiyla
 *     kurulmustu; skor tarafinda eksikti.
 */

const KAYNAK = readFileSync(new URL('./keyword.service.ts', import.meta.url), 'utf8');

/** private normalizeScore'a testten erisim */
const norm = (v: number | null) =>
  (new AsoKeywordService(null as never) as any).normalizeScore(v) as number | null;

describe('normalizeScore — olculemedi != sifir', () => {
  it('null girdi null doner, 0 DEGIL', () => {
    expect(norm(null)).toBeNull();
  });

  it('NaN null doner — eskiden 0 oluyordu', () => {
    expect(norm(NaN)).toBeNull();
  });

  it('Infinity null doner', () => {
    expect(norm(Infinity)).toBeNull();
  });

  it('gercek deger 0-100 olcegine cekiliyor', () => {
    expect(norm(6.63)).toBe(66);
    expect(norm(1.0)).toBe(10);
    expect(norm(8.91)).toBe(89);
  });
});

describe('ham deger cikarimi', () => {
  it('`?? 0` kalibi kalmamis — NaN yakalanmali', () => {
    expect(KAYNAK, 'NaN yine 0 olarak gecebilir').not.toMatch(/scores\?\.difficulty\?\.score \?\? 0/);
    expect(KAYNAK).not.toMatch(/scores\?\.traffic\?\.score \?\? 0/);
    expect(KAYNAK).toContain('Number.isFinite');
  });

  it('normalizeScore imzasi null kabul ediyor ve null donebiliyor', () => {
    expect(KAYNAK).toMatch(/normalizeScore\(v: number \| null\): number \| null/);
    expect(KAYNAK, 'olculemeyen yine 0 donuyor').not.toMatch(/if \(v == null \|\| isNaN\(v\)\) return 0;/);
  });

  it('iOS popularity IKILI olarak isaretleniyor', () => {
    // Arayuz bunu bilmek zorunda; aksi halde ikili sinyali 0-100 skor gibi cizer.
    expect(KAYNAK).toContain('popularityIkili');
    expect(KAYNAK).toMatch(/popularityIkili: opts\.store === 'IOS'/);
  });

  it('hata yolunda da ikili bayrak donuyor — sekil tutarli', () => {
    const hata = KAYNAK.slice(KAYNAK.indexOf('} catch (err: any) {'), KAYNAK.indexOf('private normalizeScore'));
    expect(hata).toContain('popularityIkili');
    expect(hata).toMatch(/popularity: null, difficulty: null, traffic: null/);
  });
});

describe('arayuz — ikili sinyal sayi gibi cizilmiyor', () => {
  const UI = readFileSync(
    new URL('../../../web/src/app/(dashboard)/sites/[id]/aso/page.tsx', import.meta.url),
    'utf8',
  );

  it('iOS satirinda Pop. sayi yerine etiket gosteriliyor', () => {
    expect(UI).toContain('Öneriliyor');
    expect(UI).toContain('Önerilmiyor');
    expect(UI).toMatch(/kw\.store === 'IOS'/);
  });

  it('Pop. tooltip\'i artik "yuksek = cok araniyor" demiyor', () => {
    // Ikili bir sinyal icin bu cumle yanlis.
    expect(UI).not.toContain("Yüksek = çok aranıyor");
    expect(UI).toContain('İKİLİ bir sinyal');
  });

  it('Rank tooltip\'i magaza derinligini dogru soyluyor', () => {
    expect(UI, 'Android icin 100 vaat ediliyor').not.toMatch(/gerçek sırası \(1-100\)/);
    expect(UI).toContain('~25-30');
  });

  it('Diff/Traffic hucrelerinde `> 0` suzgeci kalmamis', () => {
    // Sunucu artik olculemeyeni null donuyor; `> 0` gercek bir 0'i da
    // gizlerdi (gerci aso-v2 tabani 1.0 oldugu icin gercek 0 uretilemez).
    expect(UI).not.toMatch(/kw\.difficulty != null && kw\.difficulty > 0/);
    expect(UI).not.toMatch(/kw\.traffic != null && kw\.traffic > 0/);
  });
});
