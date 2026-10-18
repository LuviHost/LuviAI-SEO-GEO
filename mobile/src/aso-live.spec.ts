/**
 * F18 — ASO sekmesi yalnız API verisini gösterir; sıra etiketleri web tablosuyla aynı.
 * Çalıştırma: cd mobile && ../apps/api/node_modules/.bin/vitest run --root . src
 */
import { describe, expect, it } from 'vitest';
import type { AsoAppDetail, AsoKeyword, AsoTrackedApp } from './api';
import {
  detailMatches,
  hasStore,
  keywordsForStore,
  latestCheck,
  latestDataDay,
  pickAppId,
  rankDelta,
  rankLabel,
  storeRating,
  unrankedReason,
} from './aso-live';

function kw(id: string, extra: Partial<AsoKeyword> = {}): AsoKeyword {
  return { id, keyword: id, store: 'IOS', currentRank: null, previousRank: null, bestRank: null, lastCheckedAt: null, ...extra };
}

const APP: AsoTrackedApp = {
  id: 'app1',
  name: 'Uygulama',
  appStoreId: '123',
  playStoreId: null,
  iconUrl: null,
  developer: null,
  iosRating: 4.6,
  iosReviewCount: 1234,
  androidRating: null,
  androidReviewCount: null,
};

describe('keywordsForStore', () => {
  it('seçili mağazanın aktif kelimelerini, sıralılar önce olacak şekilde dizer', () => {
    // Sunucu currentRank ASC sıralar; MySQL null'ları en başa koyar
    const list = [
      kw('olculmedi'),
      kw('sirada-yok', { lastCheckedAt: '2026-10-17T03:30:00Z' }),
      kw('on', { currentRank: 10 }),
      kw('uc', { currentRank: 3 }),
      kw('android', { store: 'ANDROID', currentRank: 1 }),
      kw('pasif', { currentRank: 2, isActive: false }),
    ];
    expect(keywordsForStore(list, 'ios').map((k) => k.id)).toEqual(['uc', 'on', 'olculmedi', 'sirada-yok']);
    expect(keywordsForStore(list, 'play').map((k) => k.id)).toEqual(['android']);
  });
});

describe('sıra etiketleri (web keywords tablosuyla aynı)', () => {
  it('rankDelta: pozitif = yükseldi, iki ölçüm yoksa null', () => {
    expect(rankDelta({ previousRank: 8, currentRank: 3 })).toBe(5);
    expect(rankDelta({ previousRank: 3, currentRank: 8 })).toBe(-5);
    expect(rankDelta({ previousRank: 4, currentRank: 4 })).toBe(0);
    expect(rankDelta({ previousRank: null, currentRank: 4 })).toBeNull();
    expect(rankDelta({ previousRank: 4, currentRank: null })).toBeNull();
  });

  it('rankLabel: sıra yoksa "—" (uydurma "100+" yok)', () => {
    expect(rankLabel({ currentRank: 7 })).toBe('#7');
    expect(rankLabel({ currentRank: null })).toBe('—');
  });

  it('unrankedReason: App Store ~100, Google Play ~30, hiç ölçülmediyse "henüz ölçülmedi"', () => {
    const checked = '2026-10-17T03:30:00Z';
    expect(unrankedReason({ currentRank: null, lastCheckedAt: checked, store: 'IOS' }, 'tr')).toBe('İlk ~100 sonuçta yok');
    expect(unrankedReason({ currentRank: null, lastCheckedAt: checked, store: 'ANDROID' }, 'tr')).toBe('İlk ~30 sonuçta yok');
    expect(unrankedReason({ currentRank: null, lastCheckedAt: null, store: 'IOS' }, 'tr')).toBe('Henüz ölçülmedi');
    expect(unrankedReason({ currentRank: 5, lastCheckedAt: checked, store: 'IOS' }, 'en')).toBeNull();
    expect(unrankedReason({ currentRank: null, lastCheckedAt: checked, store: 'ANDROID' }, 'en')).toBe('Not in the first ~30 results');
  });
});

describe('tarih yardımcıları', () => {
  it('latestCheck en yeni ölçümü seçer, boş/geçersizi atlar', () => {
    expect(latestCheck([
      { lastCheckedAt: '2026-10-15T03:30:00Z' },
      { lastCheckedAt: null },
      { lastCheckedAt: 'bozuk' },
      { lastCheckedAt: '2026-10-17T03:30:00Z' },
    ])).toBe('2026-10-17T03:30:00Z');
    expect(latestCheck([{ lastCheckedAt: null }])).toBeNull();
  });

  it('latestDataDay ASA günlük satırlarının en yeni gününü verir', () => {
    expect(latestDataDay([{ date: '2026-10-10T00:00:00.000Z' }, { date: '2026-10-16T00:00:00.000Z' }])).toBe('2026-10-16T00:00:00.000Z');
    expect(latestDataDay([])).toBeNull();
  });
});

describe('uygulama seçimi ve mağaza bilgisi', () => {
  it('pickAppId mevcut seçimi korur, yoksa ilkini seçer', () => {
    const apps = [{ id: 'a' }, { id: 'b' }];
    expect(pickAppId(apps, 'b')).toBe('b');
    expect(pickAppId(apps, 'silinmis')).toBe('a');
    expect(pickAppId(apps, null)).toBe('a');
    expect(pickAppId([], 'a')).toBeNull();
  });

  it('hasStore / storeRating bağlı mağazaya göre', () => {
    expect(hasStore(APP, 'ios')).toBe(true);
    expect(hasStore(APP, 'play')).toBe(false);
    // App Store sayacı değerlendirme, Google Play sayacı yazılı yorum sayısıdır
    expect(storeRating(APP, 'ios')).toEqual({ rating: 4.6, count: 1234, countKind: 'ratings' });
    expect(storeRating(APP, 'play')).toEqual({ rating: null, count: null, countKind: 'reviews' });
  });

  it('detailMatches geç gelen başka uygulamanın detayını reddeder', () => {
    const detail: AsoAppDetail = { ...APP, keywords: [] };
    expect(detailMatches(detail, 'app1')).toBe(true);
    expect(detailMatches(detail, 'app2')).toBe(false);
    expect(detailMatches(null, 'app1')).toBe(false);
  });
});
