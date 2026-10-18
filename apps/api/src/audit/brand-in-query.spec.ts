import { describe, it, expect } from 'vitest';
import {
  containsBrand, brandMatchIndex, MIN_BRAND_LEN, resolveSiteBrand,
  isGenericBrandWord, isDomainDerivedBrand, brandMatcher, brandHintFor,
} from './brand-in-query.js';
import { splitQueriesByBrand } from '../analytics/organic-brand-split.js';

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

describe('resolveSiteBrand — yedek kok', () => {
  it('iki etiketli sonekte "com" degil gercek kok', () => {
    expect(resolveSiteBrand('ab', 'https://kobipratik.com.tr')).toBe('kobipratik');
    expect(resolveSiteBrand('', 'https://www.ranksup.ai/blog')).toBe('ranksup');
    expect(resolveSiteBrand(null, 'https://blog.ornek.co.uk')).toBe('ornek');
  });

  it('yeterince uzun ad aynen kullanilir; alan adi yoksa ad doner', () => {
    expect(resolveSiteBrand('Kobipratik', 'https://kobipratik.com.tr')).toBe('Kobipratik');
    expect(resolveSiteBrand('ab', 'http://localhost:3000')).toBe('ab');
    expect(resolveSiteBrand('ab', 'gecersiz')).toBe('ab');
  });
});

describe('jenerik marka korumasi', () => {
  it('gundelik kelimeler ve cekimleri jenerik; bilesik ozel adlar degil', () => {
    for (const b of ['Emlak', 'sigorta', 'Kuaför', 'oyunlar', 'emlakci', 'E-Ticaret', 'Emlak İlanları', 'Sigorta Online', 'hotels']) {
      expect(isGenericBrandWord(b), b).toBe(true);
    }
    for (const b of ['Kobipratik', 'Hepsiemlak', 'Yemeksepeti', 'Trendyol', 'Emlak 365', 'emlak24x']) {
      expect(isGenericBrandWord(b), b).toBe(false);
    }
  });

  it('alan adindan turetilmis marka tespiti (onboarding ve public kontrol kokleri)', () => {
    expect(isDomainDerivedBrand('eticaret', 'eticaret.com')).toBe(true);
    expect(isDomainDerivedBrand('Emlak', 'www.emlak.com.tr')).toBe(true);
    expect(isDomainDerivedBrand('Emlak İlanları', 'emlak.com')).toBe(true); // basliktan secilen segment
    expect(isDomainDerivedBrand('blog', 'blog.ornek.com')).toBe(true); // onboarding ilk etiket
    expect(isDomainDerivedBrand('Sigorta Dünyası', 'sigortam.net')).toBe(false);
    expect(isDomainDerivedBrand('Emlak', '')).toBe(false);
  });

  it('jenerik + turetilmis markada yalin kelime anilma sayilmaz, alan adi sayilir', () => {
    const m = brandMatcher('Eticaret', 'eticaret.com');
    expect(m.mode).toBe('domain');
    expect(m.inText('Türkiye’de eticaret yapmak için en iyi platformlar')).toBe(false);
    expect(m.inText('Kaynak: eticaret.com rehberi')).toBe(true);
    expect(m.inText('www.eticaret.com/blog adresinde')).toBe(true);
    // baska alan: etiket siniri
    expect(m.inText('eticaret.com.tr ve noteticaret.com')).toBe(false);
  });

  it('musterinin ozel markasi ve jenerik olmayan kok eski kurala tabi', () => {
    expect(brandMatcher('Kobipratik', 'kobipratik.com').mode).toBe('word');
    expect(brandMatcher('Sigorta Dünyası', 'sigortadunyasi.com').mode).toBe('word');
    expect(brandMatcher('Emlak', undefined).mode).toBe('word');
  });

  it('containsBrand: host verilince soru da AYNI kuralla markali sayilir', () => {
    // eski davranis (host yok) — geriye donuk uyum
    expect(containsBrand('en iyi emlak siteleri hangileri?', 'emlak')).toBe(true);
    // jenerik kelime soruyu markali yapmaz; alan adi yapar
    expect(containsBrand('en iyi emlak siteleri hangileri?', 'emlak', 'emlak.com')).toBe(false);
    expect(containsBrand('emlak.com güvenilir mi?', 'emlak', 'emlak.com')).toBe(true);
    // jenerik olmayan marka host ile de ayni sonucu verir
    expect(containsBrand('Kobipratik guvenilir mi?', 'Kobipratik', 'kobipratik.com')).toBe(true);
  });

  it('brandHintFor: jenerik markada sablona alan adi konur', () => {
    expect(brandHintFor('Emlak', 'emlak.com')).toBe('emlak.com');
    expect(brandHintFor('Kobipratik', 'kobipratik.com')).toBe('Kobipratik');
  });

  it('domain modunda indeks alan adinin konumu', () => {
    const m = brandMatcher('emlak', 'emlak.com');
    const folded = 'satilik daire icin emlak.com iyi';
    expect(m.indexInFolded(folded)).toBe(folded.indexOf('emlak.com'));
    expect(m.matchLength).toBe('emlak.com'.length);
  });
});

/**
 * Bilesik alan adi koku olan gercek markalar alan-adi moduna DUSMEZ. Ilk v4
 * korumasi "Yapı Kredi" (yapikredi.com.tr) gibi gundelik kelimelerden olusan
 * ozel adlari yalniz-alan-adi moduna aliyordu: cevapta adiyla onerilen banka
 * "anilmadi", public kontrol sorularina "yapikredi.com.tr" yaziliyordu.
 */
describe('jenerik koruma yalniz TEK jenerik kelimelik koke uygulanir', () => {
  const MARKALAR: Array<[string, string, string]> = [
    ['Yapı Kredi', 'yapikredi.com.tr', 'Kredi kartında Yapı Kredi World öne çıkıyor.'],
    ['Emlak Konut', 'emlakkonut.com.tr', 'Konut projelerinde Emlak Konut GYO sık anılır.'],
    ['Ak Sigorta', 'aksigorta.com.tr', 'Kasko için Ak Sigorta ve Allianz değerlendirilebilir.'],
    ['İş Yatırım', 'isyatirim.com.tr', 'Aracı kurum olarak İş Yatırım tercih ediliyor.'],
    ['Q Yatırım Bankası', 'qyatirimbankasi.com.tr', 'Q Yatırım Bankası kurumsal hizmet verir.'],
    ['NG Hotels', 'nghotels.com.tr', 'Sapanca için NG Hotels önerilebilir.'],
    ['C3 Teknoloji', 'c3teknoloji.com.tr', 'Yazılım ortağı olarak C3 Teknoloji anılıyor.'],
  ];

  for (const [brand, host, cevap] of MARKALAR) {
    it(`${brand} (${host}): kelime modu, adiyla anilma sayilir`, () => {
      const m = brandMatcher(brand, host);
      expect(m.mode).toBe('word');
      expect(m.inText(cevap)).toBe(true);
      expect(brandHintFor(brand, host)).toBe(brand);
    });
  }

  it('soru tarafi da ayni kural: markanin adi gecen soru markali', () => {
    expect(containsBrand('Yapı Kredi kredi kartı aidatı ne kadar?', 'Yapı Kredi', 'yapikredi.com.tr')).toBe(true);
    expect(containsBrand('İş Yatırım komisyon oranları', 'İş Yatırım', 'isyatirim.com.tr')).toBe(true);
    // kelime siniri yine gecerli: "yapı kredisi" farkli ifade
    expect(containsBrand('yapı kredisi faizleri', 'Yapı Kredi', 'yapikredi.com.tr')).toBe(false);
  });

  it('tek jenerik kelimelik kok korunmaya devam eder (eticaret.com, emlak.com, blog.*)', () => {
    expect(brandMatcher('Eticaret', 'eticaret.com').mode).toBe('domain');
    expect(brandMatcher('E-Ticaret', 'e-ticaret.com').mode).toBe('domain');
    expect(brandMatcher('Emlak', 'emlak.com').mode).toBe('domain');
    expect(brandMatcher('Emlak', 'www.emlak.com.tr').mode).toBe('domain');
    expect(brandMatcher('Emlak İlanları', 'emlak.com').mode).toBe('domain');
    expect(brandMatcher('blog', 'blog.ornek.com').mode).toBe('domain');
    expect(brandMatcher('Emlakçı', 'emlakci.com').mode).toBe('domain'); // cekimli tek kelime
    expect(brandMatcher('Emlak İlanları', 'emlak.com').inText('En iyi emlak ilanları siteleri')).toBe(false);
  });

  it('isDomainDerivedBrand bilesik kokte de "turetilmis" der (mod karari kokun jenerikligine bakar)', () => {
    expect(isDomainDerivedBrand('Yapı Kredi', 'yapikredi.com.tr')).toBe(true);
    expect(isGenericBrandWord('Yapı Kredi')).toBe(true);
    expect(brandMatcher('Yapı Kredi', 'yapikredi.com.tr').mode).toBe('word');
  });

  it('GSC markali/markasiz ayrimi: "yapı kredi" aramalari markali, sektor aramalari markasiz', () => {
    const split = splitQueriesByBrand([
      { query: 'yapı kredi', clicks: 50, impressions: 400 },
      { query: 'yapı kredi kredi kartı başvuru', clicks: 30, impressions: 300 },
      { query: 'en düşük faizli ihtiyaç kredisi', clicks: 20, impressions: 900 },
    ], 'Yapı Kredi', 'yapikredi.com.tr');
    expect(split.branded).toMatchObject({ clicks: 80, queries: 2 });
    expect(split.unbranded).toMatchObject({ clicks: 20, queries: 1 });
    expect(split.unbrandedClickSharePct).toBe(20);
  });
});
