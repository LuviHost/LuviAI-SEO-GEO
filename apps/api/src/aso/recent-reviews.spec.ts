import { describe, it, expect, vi } from 'vitest';
import {
  buildFetchRecord,
  parseFetchRecord,
  reviewFetchKey,
  summarizeRecentReviews,
  velocityCount,
  type StoreReviewStats,
} from './recent-reviews.js';
import { AsoReviewsService } from './reviews.service.js';

const NOW = new Date('2026-10-17T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

const stats = (over: Partial<StoreReviewStats> = {}): StoreReviewStats => ({
  store: 'IOS',
  storedTotal: 12,
  storedDated: 12,
  inWindow: 4,
  oldestStored: daysAgo(200),
  latestFetchedAt: daysAgo(2),
  lastFetch: { at: daysAgo(1).toISOString(), returned: 12, cap: 50, oldest: daysAgo(200).toISOString() },
  ...over,
});

describe('summarizeRecentReviews — bilinmiyor ile sıfır ayrı', () => {
  it('hiç yorum saklanmamış → bilinmiyor (sıfır değil)', () => {
    const r = summarizeRecentReviews([stats({ storedTotal: 0, storedDated: 0, inWindow: 0, lastFetch: null, latestFetchedAt: null })], NOW);
    expect(r.status).toBe('unknown');
    expect(r.label).toMatch(/bilinmiyor/);
  });

  it('yorum çekilmiş, son 30 günde yorum yok → kesin sıfır', () => {
    const r = summarizeRecentReviews([stats({ inWindow: 0 })], NOW);
    expect(r).toMatchObject({ status: 'known', count: 0, lowerBound: false });
    expect(r.label).toBe('Son 30 gündeki yorum sayısı: 0 (App Store, çekilen yorumlardan)');
  });

  it('son çekim 30 günden eski → bilinmiyor (eski sayı "son 30 gün" diye gösterilmez)', () => {
    const r = summarizeRecentReviews([stats({ lastFetch: { at: daysAgo(45).toISOString(), returned: 12, cap: 50, oldest: daysAgo(300).toISOString() } })], NOW);
    expect(r.status).toBe('unknown');
    if (r.status === 'unknown') expect(r.reason).toMatch(/son 30 günde çekilmedi/);
  });

  it('kayıt yoksa (eski veri) en yeni fetchedAt kullanılır', () => {
    expect(summarizeRecentReviews([stats({ lastFetch: null, latestFetchedAt: daysAgo(3) })], NOW).status).toBe('known');
    expect(summarizeRecentReviews([stats({ lastFetch: null, latestFetchedAt: daysAgo(40) })], NOW).status).toBe('unknown');
  });
});

describe('summarizeRecentReviews — alt sınır', () => {
  it('son çekim tavana dayandı ve pencerenin başına ulaşmadı → "en az N"', () => {
    const r = summarizeRecentReviews([stats({ inWindow: 50, lastFetch: { at: daysAgo(0).toISOString(), returned: 50, cap: 50, oldest: daysAgo(6).toISOString() } })], NOW);
    expect(r).toMatchObject({ status: 'known', count: 50, lowerBound: true });
    expect(r.label).toMatch(/en az 50/);
  });

  it('tavana dayandı ama pencerenin başını geçti → kesin', () => {
    const r = summarizeRecentReviews([stats({ inWindow: 30, lastFetch: { at: daysAgo(0).toISOString(), returned: 50, cap: 50, oldest: daysAgo(40).toISOString() } })], NOW);
    expect(r).toMatchObject({ count: 30, lowerBound: false });
  });

  it('iki mağaza: biri bilinmiyorsa sayı yalnız bilinen mağazadan, alt sınır olarak', () => {
    const r = summarizeRecentReviews([
      stats({ store: 'IOS', inWindow: 7 }),
      stats({ store: 'ANDROID', storedTotal: 0, storedDated: 0, inWindow: 0, lastFetch: null, latestFetchedAt: null }),
    ], NOW);
    expect(r).toMatchObject({ status: 'known', count: 7, lowerBound: true, stores: ['IOS'], missingStores: ['ANDROID'] });
    expect(r.label).toMatch(/Google Play verisi yok/);
  });

  it('iki mağaza da biliniyor → toplanır', () => {
    const r = summarizeRecentReviews([stats({ store: 'IOS', inWindow: 7 }), stats({ store: 'ANDROID', inWindow: 5 })], NOW);
    expect(r).toMatchObject({ status: 'known', count: 12, lowerBound: false, stores: ['IOS', 'ANDROID'] });
  });

  it('bağlı mağaza yok → bilinmiyor', () => {
    expect(summarizeRecentReviews([], NOW).status).toBe('unknown');
  });
});

describe('summarizeRecentReviews — bayat çekim (yorumlar yalnız istenince çekilir)', () => {
  it('25 gün önceki çekim tavana dayanmasa da sayı kesin değil: "en az N" ve kapsam etikette', () => {
    // Çekim -25. günde: pencerenin yalnız -30..-25 aralığı kapsandı
    const r = summarizeRecentReviews([stats({ inWindow: 3, lastFetch: { at: daysAgo(25).toISOString(), returned: 20, cap: 50, oldest: daysAgo(60).toISOString() } })], NOW);
    expect(r).toMatchObject({ status: 'known', count: 3, lowerBound: true, staleStores: ['IOS'] });
    expect(r.label).toBe('Son 30 gündeki yorum sayısı: en az 3 (App Store, çekilen yorumlardan) — App Store yorumları en son 25 gün önce çekildi, sonrası sayılmadı');
    expect(velocityCount(r)).toBeNull();
  });

  it('29 gün önceki çekimde pencerede yorum yoksa kesin 0 yazılmaz → bilinmiyor', () => {
    const r = summarizeRecentReviews([stats({ inWindow: 0, lastFetch: { at: daysAgo(29).toISOString(), returned: 12, cap: 50, oldest: daysAgo(300).toISOString() } })], NOW);
    expect(r.status).toBe('unknown');
    expect(r.label).toMatch(/29 gün önce çekildi/);
    expect(r.label).not.toMatch(/: 0/);
    expect(velocityCount(r)).toBeNull();
  });

  it('48 saatten taze çekim kesin sayıdır ve skora girer', () => {
    const r = summarizeRecentReviews([stats({ inWindow: 4, lastFetch: { at: new Date(NOW.getTime() - 47 * 3_600_000).toISOString(), returned: 12, cap: 50, oldest: daysAgo(200).toISOString() } })], NOW);
    expect(r).toMatchObject({ status: 'known', count: 4, lowerBound: false, staleStores: [] });
    expect(velocityCount(r)).toBe(4);
  });

  it('iki mağaza: biri bayatsa toplam alt sınır, hangi mağazanın eski olduğu etikette', () => {
    const r = summarizeRecentReviews([
      stats({ store: 'IOS', inWindow: 7 }),
      stats({ store: 'ANDROID', inWindow: 3, lastFetch: { at: daysAgo(25).toISOString(), returned: 20, cap: 50, oldest: daysAgo(60).toISOString() } }),
    ], NOW);
    expect(r).toMatchObject({ status: 'known', count: 10, lowerBound: true, staleStores: ['ANDROID'], missingStores: [] });
    expect(r.label).toMatch(/en az 10/);
    expect(r.label).toMatch(/Google Play yorumları en son 25 gün önce çekildi/);
  });

  it('bayat ve boş mağaza sayıya girmez; etiket "verisi yok" değil, çekim zamanını söyler', () => {
    const r = summarizeRecentReviews([
      stats({ store: 'IOS', inWindow: 7 }),
      stats({ store: 'ANDROID', inWindow: 0, lastFetch: { at: daysAgo(20).toISOString(), returned: 9, cap: 50, oldest: daysAgo(90).toISOString() } }),
    ], NOW);
    expect(r).toMatchObject({ status: 'known', count: 7, lowerBound: true, missingStores: ['ANDROID'], staleStores: [] });
    expect(r.label).toMatch(/Google Play yorumları en son 20 gün önce çekildi; sonraki yorumlar sayılmadı/);
    expect(r.label).not.toMatch(/verisi yok/);
  });

  it('tavana dayanan taze çekim de alt sınırdır: hız bileşenine girmez', () => {
    const r = summarizeRecentReviews([stats({ inWindow: 50, lastFetch: { at: daysAgo(0).toISOString(), returned: 50, cap: 50, oldest: daysAgo(6).toISOString() } })], NOW);
    expect(r).toMatchObject({ lowerBound: true });
    expect(velocityCount(r)).toBeNull();
  });
});

describe('çekim kaydı', () => {
  it('boş çekim kayıt üretmez (scraper hatayı yutup boş liste döner)', () => {
    expect(buildFetchRecord([], 50, NOW)).toBeNull();
  });

  it('en eski tarih ve dönen sayı yazılır; bozuk tarih yok sayılır', () => {
    const rec = buildFetchRecord(['2026-10-10T00:00:00Z', 'bozuk', new Date('2026-09-01T00:00:00Z')], 50, NOW);
    expect(rec).toEqual({ at: NOW.toISOString(), returned: 3, cap: 50, oldest: '2026-09-01T00:00:00.000Z' });
    expect(parseFetchRecord(JSON.stringify(rec))).toEqual(rec);
    expect(parseFetchRecord('{"at":1}')).toBeNull();
    expect(parseFetchRecord('bozuk')).toBeNull();
  });
});

describe('AsoReviewsService — KvStore ve sayım', () => {
  it('fetchAndAnalyze çekim kaydını yazar; boş Android çekimi yazmaz', async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = {
      trackedApp: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'a1', appStoreId: '123', playStoreId: 'com.x', country: 'tr' }) },
      appReview: { upsert: vi.fn().mockResolvedValue({ sentiment: 'POSITIVE' }) },
      kvStore: { upsert },
    };
    const scrapers = {
      iosReviews: vi.fn().mockResolvedValue([
        { id: '1', score: 5, text: 'iyi', userName: 'a', updated: '2026-10-15T10:00:00Z' },
        { id: '2', score: 4, text: 'fena değil', userName: 'b', updated: '2026-10-01T10:00:00Z' },
      ]),
      androidReviews: vi.fn().mockResolvedValue([]),
    };
    const svc = new AsoReviewsService(prisma as any, scrapers as any, {} as any);
    await svc.fetchAndAnalyze('a1', { analyzeSentiment: false });
    expect(upsert).toHaveBeenCalledTimes(1);
    const call = upsert.mock.calls[0][0];
    expect(call.where.key).toBe(reviewFetchKey('a1', 'IOS'));
    expect(JSON.parse(call.create.value)).toMatchObject({ returned: 2, cap: 50, oldest: '2026-10-01T10:00:00.000Z' });
  });

  it('getRecentReviewSignal mağaza başına sayar ve kaydı okur', async () => {
    const count = vi.fn(async ({ where }: any) => (where.reviewDate?.gte ? 3 : 9));
    const prisma = {
      trackedApp: { findUniqueOrThrow: vi.fn().mockResolvedValue({ appStoreId: '123', playStoreId: null }) },
      appReview: {
        count,
        aggregate: vi.fn().mockResolvedValue({ _min: { reviewDate: daysAgo(120) }, _max: { fetchedAt: daysAgo(1) } }),
      },
      kvStore: {
        findUnique: vi.fn().mockResolvedValue({ value: JSON.stringify({ at: daysAgo(1).toISOString(), returned: 9, cap: 50, oldest: daysAgo(120).toISOString() }) }),
      },
    };
    const svc = new AsoReviewsService(prisma as any, {} as any, {} as any);
    const r = await svc.getRecentReviewSignal('a1', NOW);
    expect(r).toMatchObject({ status: 'known', count: 3, lowerBound: false, stores: ['IOS'] });
    // Pencere: son 30 gün, şimdiye kadar
    const windowCall = count.mock.calls.find(([a]: any) => a.where.reviewDate?.gte);
    expect(windowCall?.[0].where.reviewDate.gte.toISOString()).toBe(daysAgo(30).toISOString());
  });
});
