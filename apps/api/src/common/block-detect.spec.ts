import { describe, it, expect } from 'vitest';
import { detectBlock, unblockHint } from './block-detect.js';

const cf = { server: 'cloudflare', 'cf-ray': '8a1b2c3d4e5f-IST' };

describe('detectBlock', () => {
  it('Cloudflare "Sorry, you have been blocked" (ofsayt.com vakasi) → waf', () => {
    const s = detectBlock({ status: 403, headers: cf, text: '<title>Attention Required! | Cloudflare</title><h1>Sorry, you have been blocked</h1>' });
    expect(s).toMatchObject({ kind: 'waf', vendor: 'cloudflare', status: 403 });
    expect(unblockHint(s!)).toContain('RanksUpBot');
  });
  it('Cloudflare challenge: cf-mitigated basligi ya da "Just a moment..." → challenge', () => {
    expect(detectBlock({ status: 403, headers: { ...cf, 'cf-mitigated': 'challenge' }, text: '' })?.kind).toBe('challenge');
    expect(detectBlock({ status: 200, headers: cf, text: '<title>Just a moment...</title><script>window._cf_chl_opt={}</script>' })?.kind).toBe('challenge');
  });
  it('NORMAL sayfadaki Cloudflare JS detection / Incapsula betigi engel DEGILDIR', () => {
    const normal = '<html><title>Anasayfa</title><script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script><script src="/_Incapsula_Resource?SWJIYLWA=1"></script></html>';
    expect(detectBlock({ status: 200, headers: cf, text: normal })).toBeNull();
  });
  it('Cloudflare 52x kaynak sunucu hatasi engel degil (sitenin kendi arizasi)', () => {
    expect(detectBlock({ status: 521, headers: cf, text: 'Web server is down ... Cloudflare Ray ID: 8a1b' })).toBeNull();
  });
  it('Akamai / Sucuri / Imperva red sayfalari → waf', () => {
    expect(detectBlock({ status: 403, headers: { server: 'AkamaiGHost' }, text: '<H1>Access Denied</H1> ... Reference #18.2f3e4d5c.1700000000.abc' })).toMatchObject({ kind: 'waf', vendor: 'akamai' });
    expect(detectBlock({ status: 403, headers: { 'x-sucuri-id': '1' }, text: 'Sucuri WebSite Firewall - Access Denied' })).toMatchObject({ kind: 'waf', vendor: 'sucuri' });
    expect(detectBlock({ status: 403, headers: { 'x-iinfo': '1' }, text: 'Request unsuccessful. Incapsula incident ID: 123' })).toMatchObject({ kind: 'waf', vendor: 'imperva' });
  });
  it('genel durumlar', () => {
    expect(detectBlock({ status: 401, headers: {} })?.kind).toBe('auth');
    expect(detectBlock({ status: 429, headers: cf })).toMatchObject({ kind: 'rate_limited', vendor: 'cloudflare' });
    expect(detectBlock({ status: 403, headers: {}, text: 'Forbidden' })?.kind).toBe('forbidden');
    expect(detectBlock({ status: 503, headers: {} })?.kind).toBe('unavailable');
    expect(detectBlock({ status: 999, headers: {} })?.kind).toBe('waf');
  });
  it('reCAPTCHA iceren siradan 404 sayfasi challenge DEGILDIR (link denetimi olu linke hukum verebilmeli)', () => {
    expect(detectBlock({ status: 404, headers: {}, text: '<form><div class="g-recaptcha"></div></form> Sayfa bulunamadi' })).toBeNull();
    expect(detectBlock({ status: 403, headers: {}, text: '<div class="g-recaptcha"></div>' })?.kind).toBe('challenge');
    // Incapsula betigi Incapsula arkasindaki HER sayfada var — 404'te engel sayilmaz
    expect(detectBlock({ status: 404, headers: {}, text: '<script src="/_Incapsula_Resource?SWJIYLWA=1"></script>' })).toBeNull();
  });
  it('satici engel sayfasi isareti (DataDome / PerimeterX) her hata durumunda challenge', () => {
    expect(detectBlock({ status: 404, headers: {}, text: '<script src="https://geo.captcha-delivery.com/captcha/"></script>' })?.kind).toBe('challenge');
    expect(detectBlock({ status: 405, headers: {}, text: '<div id="px-captcha"></div>' })?.kind).toBe('challenge');
  });
  it('Cloudflare ipucu guncel menu adini ve Bot Fight Mode sinirini soyler', () => {
    const hint = unblockHint({ kind: 'waf', vendor: 'cloudflare', status: 403, reason: '' });
    expect(hint).toContain('Security rules → Create rule → Custom rules');
    expect(hint).toContain('Bot Fight Mode');
    expect(hint).toContain('ranksup.ai/bot');
  });
  it('sitenin kendi durumu engel degildir', () => {
    expect(detectBlock({ status: 200, headers: {}, text: '<title>Ok</title>' })).toBeNull();
    expect(detectBlock({ status: 404, headers: cf, text: 'Not found' })).toBeNull();
    expect(detectBlock({ status: 500, headers: {}, text: 'error' })).toBeNull();
    expect(detectBlock({ status: 301, headers: {} })).toBeNull();
  });
});
