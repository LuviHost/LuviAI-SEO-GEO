import { describe, it, expect } from 'vitest';
import { containsBrand, brandMatchIndex, MIN_BRAND_LEN } from './brand-in-query.js';

/**
 * Marka tespiti testleri.
 *
 * Bu kural iki yerde birden kullaniliyor (cevapta anilma + soruda gecme).
 * Yanlis calisirsa "markasiz gorunurluk" metrigi sessizce sisip iner, ve
 * hangi yone kaydigi grafikten anlasilmaz. Sinirlar burada sabitlenmistir.
 */

describe('containsBrand — Turkce katlama', () => {
  it('İ ile baslayan markayi bulur (canli hata: hic eslesmiyordu)', () => {
    expect(containsBrand('En iyi bahis sitesi İddaa mi?', 'İddaa')).toBe(true);
    // Kullanici noktasiz yazdiginda da ayni sonucu vermeli
    expect(containsBrand('en iyi bahis sitesi iddaa mi?', 'İddaa')).toBe(true);
    expect(containsBrand('En iyi bahis sitesi İddaa mi?', 'iddaa')).toBe(true);
  });

  it('buyuk/kucuk harf farkini yok sayar', () => {
    expect(containsBrand('KOBIPRATIK nedir?', 'Kobipratik')).toBe(true);
    expect(containsBrand('kobipratik nedir?', 'KOBİPRATİK')).toBe(true);
  });

  it('Turkce ekli kullanimda eslesir', () => {
    expect(containsBrand("Kobipratik'in fiyatlari nedir?", 'Kobipratik')).toBe(true);
    expect(containsBrand('Kobipratik ile ne yapilir?', 'Kobipratik')).toBe(true);
  });
});

describe('containsBrand — kelime siniri', () => {
  it('markanin baska bir kelimenin icinde gecmesini saymaz', () => {
    expect(containsBrand('Kobipratikci firmalar hangileri?', 'Kobipratik')).toBe(false);
    expect(containsBrand('Bu bir mikrokobipratik cozumudur', 'Kobipratik')).toBe(false);
  });

  it('metin basinda ve sonunda eslesir', () => {
    expect(containsBrand('Kobipratik nedir', 'Kobipratik')).toBe(true);
    expect(containsBrand('en iyi secenek Kobipratik', 'Kobipratik')).toBe(true);
  });
});

describe('containsBrand — minimum uzunluk', () => {
  it(`${MIN_BRAND_LEN} karakterden kisa markayi hic denemez`, () => {
    // "ABC" metinde gecse bile sahte eslesme uretmemeli
    expect(containsBrand('ABC firmasi ne yapar?', 'ABC')).toBe(false);
    expect(containsBrand('X hakkinda bilgi', 'X')).toBe(false);
  });

  it('tam esik uzunlugundaki markayi bulur', () => {
    expect(containsBrand('Trendyol guvenilir mi?', 'Tren')).toBe(false); // kelime siniri yok
    expect(containsBrand('Tren bileti nasil alinir?', 'Tren')).toBe(true);
  });
});

describe('containsBrand — markasiz sorgular', () => {
  it('DISCOVERY tipi sorularda false doner', () => {
    expect(containsBrand('Kucuk isletmeler icin en iyi yonetim araclari nelerdir?', 'Kobipratik')).toBe(false);
    expect(containsBrand('Dijital donusum icin hangi saglayicilar daha iyi?', 'Kobipratik')).toBe(false);
  });

  it('fan-out sablon dallari markali sayilir', () => {
    // fanout.service.ts buildFromTemplate ciktilari — tamami markali olmali
    for (const q of [
      'Kobipratik yorumlari ve kullanici deneyimleri',
      'Kobipratik guvenilir mi?',
      'Kobipratik fiyatlari ve ucretleri',
      'Kobipratik alternatifleri neler?',
      "Turkiye'de Kobipratik secenekleri",
    ]) {
      expect(containsBrand(q, 'Kobipratik')).toBe(true);
    }
  });

  it('fan-out "category" dali MARKASIZ uretilir — kesif olcumune girer', () => {
    // buildFromTemplate kategori dali konu olarak nis/soru konusunu kullanir, markayi degil
    expect(containsBrand('en iyi ön muhasebe uygulamaları ve araçları', 'Kobipratik')).toBe(false);
    expect(containsBrand('best bookkeeping apps and tools', 'Kobipratik')).toBe(false);
  });
});

describe('brandMatchIndex — bos ve bozuk girdiler', () => {
  it('bos metin/marka null doner', () => {
    expect(brandMatchIndex('', 'Kobipratik')).toBeNull();
    expect(brandMatchIndex('bir metin', '')).toBeNull();
    expect(brandMatchIndex('bir metin', '   ')).toBeNull();
  });

  it('regex ozel karakterli marka adini kacisla arar', () => {
    expect(containsBrand('C++ Rehberi nedir?', 'C++ Rehberi')).toBe(true);
    expect(containsBrand('Soru: a.b.c nedir', 'a.b.c')).toBe(true);
    // Kacis olmasaydi "a.b.c" deseni "axbxc" ile de eslesirdi
    expect(containsBrand('Soru: axbxc nedir', 'a.b.c')).toBe(false);
  });
});
