import { describe, it, expect } from 'vitest';
import { ApiKeysService } from './api-keys.service.js';

/**
 * Scope haritasi yol harfine duyarsiz olmali.
 *
 * NEDEN VAR: Express rotalari buyuk/kucuk harf ayirt etmez ('case sensitive
 * routing' kapali); /api/SITES/:id, /api/sites/:id ile ayni handler'a gider.
 * resolveResource eskiden harf duyarliydi: buyuk harfli yol null donuyor,
 * AuthGuard "herhangi bir :write" geri dususune iniyordu — yalniz
 * 'social:write' tasiyan anahtar siteyi silebiliyor, reklam kimligini
 * degistirebiliyor, duraklatilmis kampanyayi baslatabiliyordu; GET'lerde hic
 * scope aranmiyordu.
 */
const svc = new ApiKeysService({} as never);

describe('requiredScope — yol harfi scope\'u degistirmez', () => {
  it.each([
    ['DELETE', '/api/SITES/s1', 'sites:write'],
    ['DELETE', '/api/Sites/s1', 'sites:write'],
    ['PATCH', '/api/sites/s1/ADS/google-ads', 'ads:write'],
    ['POST', '/api/sites/s1/Ads/c1/launch', 'ads:write'],
    ['POST', '/api/sites/s1/AUDIT/auto-fix-now', 'audit:write'],
    ['PATCH', '/API/sites/s1/ads/google-ads', 'ads:write'],
    ['GET', '/API/sites', 'sites:read'],
    ['GET', '/api/SITES', 'sites:read'],
    ['GET', '/api/sites/s1/ANALYTICS/overview', 'analytics:read'],
    ['GET', '/api/ARTICLES/', 'articles:read'],
    ['POST', '/api/Social/x?y=Z', 'social:write'],
  ])('%s %s -> %s', (method, path, scope) => {
    expect(svc.requiredScope(method, path)).toBe(scope);
  });

  it('kucuk harfli yolla birebir ayni sonuc (kimlik segmenti harfi etkisiz)', () => {
    for (const [method, path] of [
      ['DELETE', '/api/sites/CMSQ25BKO005FARSWO54HF856'],
      ['PATCH', '/api/sites/s1/ads/google-ads'],
      ['GET', '/api/sites/s1/analytics/overview'],
    ] as const) {
      expect(svc.requiredScope(method, path.toUpperCase())).toBe(svc.requiredScope(method, path));
    }
  });

  it('haritada olmayan kaynak her yazimda null kalir (bilinmeyen kaynak kurali)', () => {
    expect(svc.requiredScope('POST', '/api/BILLING/subscribe')).toBeNull();
    expect(svc.requiredScope('POST', '/api/sites/s1/ASO/asc/connect')).toBeNull();
    expect(svc.requiredScope('POST', '/api/MCP')).toBeNull();
  });
});
