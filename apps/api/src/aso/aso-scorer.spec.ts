import { describe, it, expect } from 'vitest';
import { ASOScorerService } from './aso-scorer.service.js';
import { ratingsInputFor, storeMetadataInputs } from './aso-score-inputs.js';

const scorer = new ASOScorerService();

describe('scoreRatingsReviews — son 30 gün yorum sayısı', () => {
  const base = { average_rating: 4.6, total_ratings: 6000 };

  it('bilinmiyorsa (null) skora katılmaz: kalite + hacim 80 üzerinden 100\'e ölçeklenir', () => {
    // kalite 50 + hacim 30 = 80 → 100; eskiden sabit 0 gönderilip 5 puan tabanla 85'te kalıyordu
    expect(scorer.scoreRatingsReviews({ ...base, recent_reviews_30d: null })).toBe(100);
    expect(scorer.scoreRatingsReviews({ ...base })).toBe(100);
  });

  it('bilinen sıfır sıfır sayılır (taban 5 puan)', () => {
    expect(scorer.scoreRatingsReviews({ ...base, recent_reviews_30d: 0 })).toBe(85);
  });

  it('eşikler: >10 → 10, >50 → 15, >100 → 20', () => {
    expect(scorer.scoreRatingsReviews({ ...base, recent_reviews_30d: 11 })).toBe(90);
    expect(scorer.scoreRatingsReviews({ ...base, recent_reviews_30d: 51 })).toBe(95);
    expect(scorer.scoreRatingsReviews({ ...base, recent_reviews_30d: 101 })).toBe(100);
  });

  it('eski alan adı (recent_ratings_30d) hâlâ okunur', () => {
    expect(scorer.scoreRatingsReviews({ ...base, recent_ratings_30d: 11 })).toBe(90);
  });

  it('bilinmiyorsa breakdown notu açıklar', () => {
    const r = scorer.calculateOverallScore({}, { ...base, recent_reviews_30d: null }, {}, {});
    expect(r.breakdown.ratings_reviews.notes?.[0]).toMatch(/son 30 gündeki yorum sayısı bilinmiyor/i);
    const k = scorer.calculateOverallScore({}, { ...base, recent_reviews_30d: 3 }, {}, {});
    expect(k.breakdown.ratings_reviews.notes).toBeUndefined();
  });
});

describe('scoreMetadataQuality — App Store açıklama yoğunluğu skora girmez', () => {
  const common = { title_keyword_count: 2, title_length: 28, description_length: 2500, description_quality: 0.8 };

  it('iOS: yoğunluk değeri skoru değiştirmez (0 ya da 20 aynı)', () => {
    const a = scorer.scoreMetadataQuality({ ...common, keyword_density: 0, platform: 'ios' });
    const b = scorer.scoreMetadataQuality({ ...common, keyword_density: 20, platform: 'ios' });
    expect(a).toBe(b);
    // başlık 35 + açıklama 33 = 68 → 70 üzerinden 100'e
    expect(a).toBe(97.1);
  });

  it('Android: yoğunluk sayılır (aralık dışı düşürür)', () => {
    const inRange = scorer.scoreMetadataQuality({ ...common, keyword_density: 3, platform: 'android' });
    const none = scorer.scoreMetadataQuality({ ...common, keyword_density: 0, platform: 'android' });
    expect(inRange).toBe(98);
    expect(none).toBe(68);
  });

  it('çok mağazalı girdi ortalanır; iOS notu ve yoğunluksuz öneri', () => {
    const r = scorer.calculateOverallScore(
      [{ ...common, platform: 'ios', title_keyword_count: 0, description_length: 100, description_quality: 0.3 }],
      { average_rating: 4.6, total_ratings: 6000, recent_reviews_30d: 0 },
      {},
      {},
    );
    expect(r.breakdown.metadata_quality.notes?.[0]).toMatch(/App Store açıklamasındaki anahtar kelime yoğunluğu skora katılmadı/);
    const rec = r.recommendations.find((x) => x.category === 'metadata_quality');
    expect(rec?.details).not.toMatch(/density/i);
    expect(rec?.details).toMatch(/alt başlık ve anahtar kelime alanına/);
  });

  it('Android varsa öneri benchmark ile aynı aralığı söyler (%2-5)', () => {
    const r = scorer.calculateOverallScore(
      [{ title_keyword_count: 0, title_length: 10, description_length: 100, keyword_density: 0, platform: 'android' }],
      {}, {}, {},
    );
    expect(r.recommendations.find((x) => x.category === 'metadata_quality')?.details).toMatch(/%2-5/);
  });
});

describe('storeMetadataInputs — mağaza başına girdi', () => {
  const meta = {
    ios: { title: 'Bütçem: Harcama Takibi', description: 'Harcama takibi harcama takibi.' },
    android: { title: 'Bütçem - Gider Takip', description: 'Çiçek bütçe gider takip gider takip uygulaması' },
  };

  it('iOS adı iOS açıklamasıyla, Android adı Android açıklamasıyla; iOS yoğunluğu hesaplanmaz', () => {
    const r = storeMetadataInputs(meta, { ios: true, android: true }, ['harcama', 'gider takip']);
    expect(r.map((x) => x.store)).toEqual(['IOS', 'ANDROID']);
    expect(r[0]).toMatchObject({ keywordDensity: null, input: { platform: 'ios', title_keyword_count: 1 } });
    expect(r[0].input).not.toHaveProperty('keyword_density');
    // 7 kelimede "gider takip" 2 kez → 28.6 ("Çiçek" tek kelime sayılır — Türkçe harf güvenli)
    expect(r[1]).toMatchObject({ keywordDensity: 28.6, input: { platform: 'android', keyword_density: 28.6, title_keyword_count: 1 } });
  });

  it('bağlı olmayan ya da metadata\'sı olmayan mağaza girdi üretmez', () => {
    expect(storeMetadataInputs(meta, { ios: false, android: true }, []).map((x) => x.store)).toEqual(['ANDROID']);
    expect(storeMetadataInputs({ ios: meta.ios }, { ios: true, android: true }, []).map((x) => x.store)).toEqual(['IOS']);
  });
});

describe('ratingsInputFor — puan girdisi', () => {
  it('iki mağaza: değerlendirme sayısıyla ağırlıklı ortalama; Play değerlendirme sayısı `ratings` alanından', () => {
    const r = ratingsInputFor(
      { iosRating: 4.0, iosReviewCount: 100, androidRating: 5.0, androidReviewCount: 10 },
      { android: { ratings: 300 } },
      7,
    );
    expect(r).toEqual({ average_rating: 4.75, total_ratings: 400, recent_reviews_30d: 7 });
  });

  it('tek mağaza ve bilinmeyen yorum hızı', () => {
    expect(ratingsInputFor({ iosRating: null, iosReviewCount: null, androidRating: 4.2, androidReviewCount: 12 }, {}, null))
      .toEqual({ average_rating: 4.2, total_ratings: 12, recent_reviews_30d: null });
  });
});
