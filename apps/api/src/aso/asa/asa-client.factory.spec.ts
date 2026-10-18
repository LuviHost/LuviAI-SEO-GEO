import { describe, it, expect } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { createAsaClient, getAsaApiVersion, resolveAsaApiVersion, v5SunsetNotice } from './asa-client.factory.js';
import { AsaApiClient } from './asa-api.client.js';
import { AsaPlatformClient } from './asa-platform.client.js';
import {
  ASA_RELATIVE_SCORE_LABEL,
  buildImpressionShareResponse,
  buildPopularityResponse,
  impressionShareWindow,
  insightsUnavailable,
  popularityWindow,
} from './asa-insights.js';

const PEM = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const CREDS = { orgId: 'SEARCHADS.c', keyId: 'k', privateKeyPem: PEM };

describe('ASA_API_VERSION anahtari', () => {
  it('varsayilan v5; platform tek satirla secilir', () => {
    expect(resolveAsaApiVersion(undefined)).toEqual({ version: 'v5', invalid: null });
    expect(resolveAsaApiVersion('')).toEqual({ version: 'v5', invalid: null });
    expect(resolveAsaApiVersion('v5')).toEqual({ version: 'v5', invalid: null });
    expect(resolveAsaApiVersion('platform')).toEqual({ version: 'platform', invalid: null });
    expect(resolveAsaApiVersion(' PLATFORM ')).toEqual({ version: 'platform', invalid: null });
  });

  it('taninmayan deger uygulamayi dusurmez: v5 + uyari', () => {
    expect(resolveAsaApiVersion('v1')).toEqual({ version: 'v5', invalid: 'v1' });
    expect(getAsaApiVersion({ ASA_API_VERSION: 'plataform' } as any)).toBe('v5');
  });

  it('fabrika surume gore adaptor uretir', () => {
    expect(createAsaClient(CREDS, { version: 'v5' })).toBeInstanceOf(AsaApiClient);
    expect(createAsaClient(CREDS, { version: 'platform' })).toBeInstanceOf(AsaPlatformClient);
    expect(createAsaClient(CREDS, { version: 'platform' }).version).toBe('platform');
  });
});

describe('v5 kapanis uyarisi', () => {
  it('1 Aralik 2026 oncesi uyari yok', () => {
    expect(v5SunsetNotice('v5', new Date('2026-11-30T23:59:59Z'))).toBeNull();
  });

  it('1 Aralik 2026 itibariyla v5 kullaniliyorsa uyari', () => {
    const msg = v5SunsetNotice('v5', new Date('2026-12-01T00:00:00Z'));
    expect(msg).toContain('2027-01-26');
    expect(msg).toContain('ASA_API_VERSION=platform');
  });

  it('26 Ocak 2027 ve sonrasi: kapandi mesaji', () => {
    expect(v5SunsetNotice('v5', new Date('2027-01-26T08:00:00Z'))).toMatch(/kapatıldı/);
  });

  it('platform kullanilirken uyari yok', () => {
    expect(v5SunsetNotice('platform', new Date('2027-02-01T00:00:00Z'))).toBeNull();
  });
});

describe('Insights pencereleri', () => {
  it('populerlik: tamamlanmis son iki Pazar-Cumartesi haftasi (pazartesi 07:00 UTC uretim)', () => {
    // Cumartesi 17 Ekim 2026: son uretilen hafta 4-10 Ekim (12 Ekim pzt uretildi)
    expect(popularityWindow(new Date('2026-10-17T12:00:00Z'))).toEqual({ startDate: '2026-09-27', endDate: '2026-10-10' });
    // Pazartesi 06:00 — 11-17 Ekim haftasi henuz uretilmedi
    expect(popularityWindow(new Date('2026-10-19T06:00:00Z'))).toEqual({ startDate: '2026-09-27', endDate: '2026-10-10' });
    // Pazartesi 08:00 — uretildi
    expect(popularityWindow(new Date('2026-10-19T08:00:00Z'))).toEqual({ startDate: '2026-10-04', endDate: '2026-10-17' });
  });

  it('pencere baslangici Pazar, bitisi Cumartesi', () => {
    const w = popularityWindow(new Date('2026-12-03T10:00:00Z'));
    expect(new Date(`${w.startDate}T00:00:00Z`).getUTCDay()).toBe(0);
    expect(new Date(`${w.endDate}T00:00:00Z`).getUTCDay()).toBe(6);
  });

  it('gosterim payi: dun dahil N gun, 1..30 araligina kirpilir', () => {
    expect(impressionShareWindow(7, new Date('2026-10-17T12:00:00Z'))).toEqual({ startDate: '2026-10-10', endDate: '2026-10-16' });
    const w = impressionShareWindow(90, new Date('2026-10-17T12:00:00Z'));
    expect(w).toEqual({ startDate: '2026-09-17', endDate: '2026-10-16' });
  });
});

describe('Insights cevaplari — goreli skor etiketi, hacim degil', () => {
  it('populerlik: etiket + terim basina en yeni hafta + bulunamayanlar', () => {
    const res = buildPopularityResponse(
      [
        { searchTerm: 'yemek tarifi', countryOrRegion: 'TR', genre: 'FOOD_DRINK', period: '2026-10-04', popularity1to100: 60, popularityInGenre: 80, popularity1to5: 4, rankInGenre: 9 },
        { searchTerm: 'yemek tarifi', countryOrRegion: 'TR', genre: 'FOOD_DRINK', period: '2026-10-11', popularity1to100: 62, popularityInGenre: 81, popularity1to5: 4, rankInGenre: 8 },
      ],
      { country: 'TR', genre: null, window: { startDate: '2026-09-27', endDate: '2026-10-10' }, requestedTerms: ['yemek tarifi', 'diyet'] },
    );
    expect(res.label).toBe(ASA_RELATIVE_SCORE_LABEL);
    expect(res.label).toBe('göreli skor (Apple Ads)');
    expect(res.note).toContain('mutlak arama hacmi değildir');
    expect(res.terms).toEqual([{ term: 'yemek tarifi', genre: 'FOOD_DRINK', week: '2026-10-11', relativeScore: 62, relativeScoreInGenre: 81, relativeTier1to5: 4, rankInGenre: 8 }]);
    expect(res.notFound).toEqual(['diyet']);
    // Hicbir alan "volume"/"hacim" diye adlandirilmaz
    expect(JSON.stringify(res.terms)).not.toMatch(/volume/i);
  });

  it('gosterim payi: %91-100 kovasi tek dilim olarak yazilir', () => {
    const res = buildImpressionShareResponse(
      [
        { date: '2026-10-10', searchTerm: 'a', countryOrRegion: 'TR', lowShare: 0.91, highShare: 1, rank: 1, popularity1to5: 5 },
        { date: '2026-10-10', searchTerm: 'b', countryOrRegion: 'TR', lowShare: 0.23, highShare: 0.23, rank: 3, popularity1to5: 2 },
      ],
      { country: 'TR', adamId: '1', window: { startDate: '2026-10-10', endDate: '2026-10-16' } },
    );
    expect(res.label).toBe('göreli skor (Apple Ads)');
    expect(res.rows.map((r) => r.shareText)).toEqual(['%91–100', '%23']);
  });

  it('v5 modunda acik "kullanilamiyor" cevabi', () => {
    expect(insightsUnavailable('v5')).toMatchObject({ available: false, apiVersion: 'v5' });
  });
});
