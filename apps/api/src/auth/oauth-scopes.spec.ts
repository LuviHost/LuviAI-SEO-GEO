import { describe, it, expect } from 'vitest';
import {
  hasGrantedScope, scopesFromEnv, GSC_DATA_SCOPES, GA_DATA_SCOPES, GOOGLE_ADS_SCOPES,
  DEFAULT_GSC_SCOPES, DEFAULT_GA_SCOPES,
} from './oauth-scopes.js';

const WM = 'https://www.googleapis.com/auth/webmasters';
const WM_RO = 'https://www.googleapis.com/auth/webmasters.readonly';
const GA_RO = 'https://www.googleapis.com/auth/analytics.readonly';

describe('hasGrantedScope', () => {
  it('Search Console kapsami verildiyse gecer (yazma ya da salt-okuma)', () => {
    expect(hasGrantedScope(`openid ${WM}`, DEFAULT_GSC_SCOPES, GSC_DATA_SCOPES)).toBe(true);
    expect(hasGrantedScope(WM_RO, [WM_RO], GSC_DATA_SCOPES)).toBe(true);
  });

  it('kutu bos birakildiysa (yalniz baska kapsamlar) reddeder', () => {
    expect(hasGrantedScope('openid https://www.googleapis.com/auth/userinfo.email', [WM, 'openid'], GSC_DATA_SCOPES)).toBe(false);
    expect(hasGrantedScope(WM, DEFAULT_GA_SCOPES, GA_DATA_SCOPES)).toBe(false);
  });

  it('scope alani yoksa istenen kapsam verilmis sayilir (RFC 6749 §5.1)', () => {
    expect(hasGrantedScope(undefined, DEFAULT_GSC_SCOPES, GSC_DATA_SCOPES)).toBe(true);
    expect(hasGrantedScope('   ', DEFAULT_GA_SCOPES, GA_DATA_SCOPES)).toBe(true);
    // istenen liste veri kapsami icermiyorsa (yanlis env) yine reddeder
    expect(hasGrantedScope(undefined, ['openid'], GSC_DATA_SCOPES)).toBe(false);
  });

  it('kapsam karsilastirmasi buyuk/kucuk harfe duyarli ve tam esitlik', () => {
    expect(hasGrantedScope(`${WM}.extra`, [WM], GSC_DATA_SCOPES)).toBe(false);
    expect(hasGrantedScope(GA_RO.toUpperCase(), [GA_RO], GA_DATA_SCOPES)).toBe(false);
  });

  it('Google Ads adwords kapsami', () => {
    expect(hasGrantedScope('https://www.googleapis.com/auth/adwords', GOOGLE_ADS_SCOPES, GOOGLE_ADS_SCOPES)).toBe(true);
    expect(hasGrantedScope('openid', GOOGLE_ADS_SCOPES, GOOGLE_ADS_SCOPES)).toBe(false);
  });
});

describe('scopesFromEnv', () => {
  it('virgullu listeyi temizler, bossa varsayilana duser', () => {
    expect(scopesFromEnv(` ${WM_RO} , ,openid`, DEFAULT_GSC_SCOPES)).toEqual([WM_RO, 'openid']);
    expect(scopesFromEnv('', DEFAULT_GSC_SCOPES)).toEqual(DEFAULT_GSC_SCOPES);
    expect(scopesFromEnv(undefined, DEFAULT_GA_SCOPES)).toEqual(DEFAULT_GA_SCOPES);
  });
});
