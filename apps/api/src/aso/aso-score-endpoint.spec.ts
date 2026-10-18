import { describe, it, expect, vi } from 'vitest';
import { AsoController } from './aso.controller.js';
import { ASOScorerService } from './aso-scorer.service.js';

/**
 * POST /aso/apps/:appId/score — eskiden `recent_ratings_30d: 0` sabitti (TODO)
 * ve tek bir karisik metadata girdisi vardi. Artik:
 *  - yorum hizi saklanan yorumlardan; bilinmiyorsa skora katilmaz
 *  - App Store aciklama yogunlugu skora girmez
 */
function make(app: Record<string, unknown>, signal: unknown) {
  const prisma = { trackedApp: { findUniqueOrThrow: vi.fn().mockResolvedValue(app) } };
  const aso = { getRecentReviewSignal: vi.fn().mockResolvedValue(signal) };
  const ctrl = new AsoController(
    aso as any, {} as any, new ASOScorerService(), {} as any, prisma as any,
    {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
  );
  return { ctrl, aso };
}

const IOS_APP = {
  id: 'a1',
  name: 'Bütçem',
  appStoreId: '123',
  playStoreId: null,
  iosRating: 4.6,
  iosReviewCount: 6000,
  androidRating: null,
  androidReviewCount: null,
  metadata: { ios: { title: 'Bütçem: Bütçe Takibi', description: 'bütçe '.repeat(400) } },
};

describe('AsoController.calculateScore', () => {
  it('yorum verisi yoksa hız bileşeni skora katılmaz; etiket ve not dürüst', async () => {
    const signal = { status: 'unknown', windowDays: 30, reason: 'App Store için saklanmış yorum yok', label: 'Son 30 gündeki yorum sayısı bilinmiyor — App Store için saklanmış yorum yok' };
    const { ctrl, aso } = make(IOS_APP, signal);
    const r = await ctrl.calculateScore('a1', { targetKeywords: ['bütçe'] });
    expect(aso.getRecentReviewSignal).toHaveBeenCalledWith('a1');
    // kalite 50 + hacim 30 → 100 (eskiden sabit 0 → 85)
    expect(r.breakdown.ratings_reviews.score).toBe(100);
    expect(r.breakdown.ratings_reviews.notes?.[0]).toMatch(/bilinmiyor/);
    expect(r.signals.recentReviews30d).toEqual(signal);
  });

  it('bilinen yorum sayısı skora girer', async () => {
    const { ctrl } = make(IOS_APP, { status: 'known', count: 12, lowerBound: false, windowDays: 30, stores: ['IOS'], missingStores: [], staleStores: [], lastFetchAt: '2026-10-16T00:00:00.000Z', label: 'x' });
    const r = await ctrl.calculateScore('a1', {});
    expect(r.breakdown.ratings_reviews.score).toBe(90);
  });

  it('yalnız alt sınır ("en az N", bayat çekim) hız bileşenine girmez', async () => {
    const signal = { status: 'known', count: 3, lowerBound: true, windowDays: 30, stores: ['IOS'], missingStores: [], staleStores: ['IOS'], lastFetchAt: '2026-09-22T00:00:00.000Z', label: 'Son 30 gündeki yorum sayısı: en az 3' };
    const { ctrl } = make(IOS_APP, signal);
    const r = await ctrl.calculateScore('a1', {});
    // Eskiden 3 kesin sayılıp hız 5 puan veriyordu (90 yerine 85); artık bileşen dışarıda → 100
    expect(r.breakdown.ratings_reviews.score).toBe(100);
    expect(r.breakdown.ratings_reviews.notes?.[0]).toMatch(/alt sınırı/);
    expect(r.signals.recentReviews30d).toEqual(signal);
  });

  it('yalnız iOS: açıklamadaki yoğun tekrar metadata skorunu etkilemez, sinyalde yoğunluk sayılmadı görünür', async () => {
    const unknown = { status: 'unknown', windowDays: 30, reason: '-', label: '-' };
    const a = await make(IOS_APP, unknown).ctrl.calculateScore('a1', { targetKeywords: ['bütçe'] });
    const b = await make({ ...IOS_APP, metadata: { ios: { title: 'Bütçem: Bütçe Takibi', description: 'harcama '.repeat(400) } } }, unknown).ctrl.calculateScore('a1', { targetKeywords: ['bütçe'] });
    expect(a.breakdown.metadata_quality.score).toBe(b.breakdown.metadata_quality.score);
    expect(a.signals.metadataStores).toEqual([{ store: 'IOS', keywordDensity: null, densityCounted: false }]);
    expect(a.breakdown.metadata_quality.notes?.[0]).toMatch(/App Store açıklamasındaki anahtar kelime yoğunluğu skora katılmadı/);
  });
});
