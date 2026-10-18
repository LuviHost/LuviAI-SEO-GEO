import { describe, it, expect } from 'vitest';
import {
  asaErrorFromResponse,
  classifyAsaError,
  lastNDaysRange,
  normalizeKeywordStatus,
  normalizeMetrics,
  normalizeReportDate,
  parseAmount,
  parseAppleErrorBody,
  toApiId,
  toAppleDateTime,
} from './asa-types.js';
import { idSpaceMismatch, shouldPauseKeyword } from './asa-rules.js';

/**
 * Surumden bagimsiz normalizasyon: iki Apple API'sinin farkli alan adlari ve
 * hata govdeleri tek tipe inmeli — servis ve DB hangi surumun konustugunu bilmez.
 */

describe('normalizeMetrics — v5 ve Platform alan adlari', () => {
  it('v5 (API 5+) satiri: tapInstalls/tapInstallCPI/tapInstallRate/avgCPT okunur', () => {
    const m = normalizeMetrics({
      impressions: 17,
      taps: 6,
      ttr: 0.2727,
      avgCPT: { amount: '0.1583', currency: 'USD' },
      localSpend: { amount: '0.95', currency: 'USD' },
      totalInstalls: 10,
      tapInstalls: 5,
      tapInstallCPI: { amount: '0.19', currency: 'USD' },
      tapInstallRate: 0.8333,
      date: '2024-04-08',
    });
    expect(m).toEqual({
      impressions: 17,
      taps: 6,
      installs: 5,
      totalInstalls: 10,
      spend: 0.95,
      currency: 'USD',
      avgCpt: 0.1583,
      avgCpa: 0.19,
      ttr: 0.2727,
      conversionRate: 0.8333,
    });
  });

  it('Platform satiri: cpt alani avgCpt olur', () => {
    const m = normalizeMetrics({
      localSpend: { amount: '75.00', currency: 'EUR' },
      impressions: 5000,
      taps: 250,
      ttr: 0.05,
      cpt: { amount: '0.30', currency: 'EUR' },
      tapInstalls: 60,
      totalInstalls: 72,
    });
    expect(m.avgCpt).toBe(0.3);
    expect(m.installs).toBe(60);
    expect(m.totalInstalls).toBe(72);
    expect(m.currency).toBe('EUR');
    expect(m.avgCpa).toBeNull();
  });

  it('eski (API 5 oncesi) installs alani yedek olarak okunur', () => {
    expect(normalizeMetrics({ installs: 3, taps: 9 }).installs).toBe(3);
  });

  it('bos satir sifir/null doner, NaN uretmez', () => {
    const m = normalizeMetrics(undefined);
    expect(m.impressions).toBe(0);
    expect(m.spend).toBe(0);
    expect(m.avgCpt).toBeNull();
    expect(Number.isNaN(m.installs)).toBe(false);
  });
});

describe('tarih ve tutar yardimcilari', () => {
  it('rapor tarihleri YYYY-MM-DD olur (ISO, saatlik ve MM-DD-YYYY)', () => {
    expect(normalizeReportDate('2026-01-08')).toBe('2026-01-08');
    expect(normalizeReportDate('2025-01-10 13')).toBe('2025-01-10');
    expect(normalizeReportDate('04-08-2024 05')).toBe('2024-04-08');
    expect(normalizeReportDate('dun')).toBeNull();
    expect(normalizeReportDate(undefined)).toBeNull();
  });

  it('Apple tarih-saat bicimi Z icermez', () => {
    expect(toAppleDateTime(new Date('2026-10-17T12:34:56.789Z'))).toBe('2026-10-17T12:34:56.789');
  });

  it('parseAmount: string/number/null', () => {
    expect(parseAmount({ amount: '1.50', currency: 'USD' })).toBe(1.5);
    expect(parseAmount({ amount: 2 })).toBe(2);
    expect(parseAmount({ amount: 'null' })).toBeNull();
    expect(parseAmount(null)).toBeNull();
  });

  it('lastNDaysRange: bugun dahil, UTC gunleri', () => {
    expect(lastNDaysRange(7, new Date('2026-10-17T03:30:00Z'))).toEqual({ startDate: '2026-10-10', endDate: '2026-10-17' });
  });

  it('toApiId: guvenli tamsayi sayi, degilse string', () => {
    expect(toApiId('542370539')).toBe(542370539);
    expect(toApiId('99999999999999999999')).toBe('99999999999999999999');
  });

  it('anahtar kelime durumu: Platform ENABLED → ACTIVE', () => {
    expect(normalizeKeywordStatus('ENABLED')).toBe('ACTIVE');
    expect(normalizeKeywordStatus('ACTIVE')).toBe('ACTIVE');
    expect(normalizeKeywordStatus('PAUSED')).toBe('PAUSED');
  });
});

describe('Apple hata govdesi normalizasyonu', () => {
  it('v5 govdesi: error.errors[].messageCode/message', () => {
    const r = parseAppleErrorBody({
      data: null,
      error: { errors: [{ messageCode: 'DUPLICATE_CAMPAIGN_NAME', message: 'Campaign name is not unique', field: 'name' }] },
    });
    expect(r.codes).toEqual(['DUPLICATE_CAMPAIGN_NAME']);
    expect(r.messages[0]).toContain('not unique');
  });

  it('Platform govdesi: error.code + details[].code/info.field', () => {
    const r = parseAppleErrorBody({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation errors found',
        details: [{ code: 'DUPLICATE_NAME', message: 'AdGroup name already exists under this Campaign.', info: { field: 'name' } }],
      },
    });
    expect(r.codes).toEqual(['VALIDATION_ERROR', 'DUPLICATE_NAME']);
    expect(r.messages).toContain('AdGroup name already exists under this Campaign. (name)');
  });

  it('turler: kopya isim, odeme, app, hiz siniri, sunucu', () => {
    expect(classifyAsaError(400, ['DUPLICATE_NAME'], [])).toBe('duplicate_name');
    expect(classifyAsaError(400, [], ['NO_PAYMENT_METHOD_ON_FILE'])).toBe('payment');
    expect(classifyAsaError(400, ['INVALID_ADAMID'], [])).toBe('app_ineligible');
    expect(classifyAsaError(429, [], [])).toBe('rate_limited');
    expect(classifyAsaError(503, [], [])).toBe('server');
    expect(classifyAsaError(403, [], [])).toBe('forbidden');
  });

  it('"paymentModel" dogrulama hatasi odeme eksik sanilmaz', () => {
    expect(classifyAsaError(400, ['INVALID_FIELD'], ['paymentModel is read-only'])).toBe('validation');
  });

  it('"Apple ... not found" mesaji uygulama hatasi sanilmaz', () => {
    expect(classifyAsaError(404, [], ['Apple could not locate the resource: not found'])).toBe('not_found');
  });

  it('mesaj eski bicimi korur: ASA METHOD path → status: ...', () => {
    const e = asaErrorFromResponse({
      status: 400,
      bodyText: JSON.stringify({ error: { code: 'INVALID_ARGUMENT', message: 'bad' } }),
      method: 'POST',
      path: '/campaigns',
      apiVersion: 'platform',
    });
    expect(e.message).toBe('ASA POST /campaigns → 400: INVALID_ARGUMENT; bad');
    expect(e.kind).toBe('validation');
    expect(e.apiVersion).toBe('platform');
  });

  it('JSON olmayan govde ham metinle doner', () => {
    const e = asaErrorFromResponse({ status: 502, bodyText: '<html>Bad gateway</html>', method: 'GET', path: '/acls', apiVersion: 'v5' });
    expect(e.message).toContain('<html>Bad gateway</html>');
    expect(e.kind).toBe('server');
  });
});

describe('karar kurallari', () => {
  it('otopilot: yalniz kelime duzeyinde 20+ dokunma ve 0 yukleme durdurulur', () => {
    expect(shouldPauseKeyword({ taps: 20, installs: 0 })).toBe(true);
    expect(shouldPauseKeyword({ taps: 19, installs: 0 })).toBe(false);
    expect(shouldPauseKeyword({ taps: 80, installs: 1 })).toBe(false);
    expect(shouldPauseKeyword(undefined)).toBe(false);
  });

  it('surum gecisi: kimlikler hic eslesmiyorsa senkron durmali', () => {
    expect(idSpaceMismatch('v5', 'platform', ['1', '2'], ['9'])).toBe(true);
    expect(idSpaceMismatch('v5', 'platform', ['1', '2'], ['2', '9'])).toBe(false);
    expect(idSpaceMismatch('platform', 'platform', ['1'], ['9'])).toBe(false); // normal yetim temizligi
    expect(idSpaceMismatch(null, 'platform', ['1'], ['9'])).toBe(false);
    expect(idSpaceMismatch('v5', 'platform', [], ['9'])).toBe(false);
    expect(idSpaceMismatch('v5', 'platform', ['1'], [])).toBe(false);
  });
});
