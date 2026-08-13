import { describe, it, expect } from 'vitest';
import {
  generateIngestSecret,
  computeIngestSignature,
  verifyIngestSignature,
  safeCompareHex,
  ingestSigningPayload,
  INGEST_SECRET_PREFIX,
  INGEST_TIMESTAMP_TOLERANCE_MS,
} from './ingest-auth.js';

/**
 * Live Crawler ingest imza dogrulamasi.
 *
 * Bu mantik gevserse uc yeniden acilir: siteId'yi bilen herkes sahte AI bot
 * ziyareti enjekte edip musteriye "ChatGPT siteni okudu" yalanini gosterebilir.
 * Bu yuzden HER dusme sebebi burada ayri ayri sabitlenmistir — ozellikle
 * "sir yoksa gec" ve "eski damgayi kabul et" gibi sessizce geri gelebilecek
 * gevsemeler.
 */

const SECRET = 'luvi_ing_0123456789abcdef0123456789abcdef0123456789abcdef';
const NOW = Date.parse('2026-08-14T12:00:00.000Z');
const BODY = JSON.stringify({
  site: 'cmsite123',
  source: 'worker',
  events: [{ ua: 'GPTBot/1.2', path: '/blog/ai-seo', status: 200, ts: NOW }],
});
/** Gecerli imza — bozulmus varyantlar bundan turetilir */
const VALID_SIG = computeIngestSignature(SECRET, String(NOW), BODY);

/** Gecerli bir istegi kur — testler yalnizca bozmak istedikleri alani ezer. */
function signedRequest(over: Partial<Parameters<typeof verifyIngestSignature>[0]> = {}) {
  const timestamp = String(NOW);
  return {
    secret: SECRET,
    timestamp,
    signature: computeIngestSignature(SECRET, timestamp, BODY),
    rawBody: BODY,
    now: NOW,
    ...over,
  };
}

describe('generateIngestSecret', () => {
  it('taninabilir onekle ve yeterli entropiyle uretir', () => {
    const secret = generateIngestSecret();
    expect(secret.startsWith(INGEST_SECRET_PREFIX)).toBe(true);
    // 24 byte -> 48 hex karakter
    expect(secret.slice(INGEST_SECRET_PREFIX.length)).toMatch(/^[0-9a-f]{48}$/);
  });

  it('her cagrida farkli sir dondurur', () => {
    expect(generateIngestSecret()).not.toBe(generateIngestSecret());
  });
});

describe('computeIngestSignature', () => {
  it('sha256= onekli hex uretir', () => {
    expect(computeIngestSignature(SECRET, NOW, BODY)).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it('zaman damgasini imzanin icine katar — govde ayni kalsa bile imza degisir', () => {
    const a = computeIngestSignature(SECRET, NOW, BODY);
    const b = computeIngestSignature(SECRET, NOW + 1000, BODY);
    expect(a).not.toBe(b);
  });

  it('kanonik metin timestamp.rawBody bicimindedir', () => {
    expect(ingestSigningPayload(NOW, BODY)).toBe(`${NOW}.${BODY}`);
  });
});

describe('verifyIngestSignature', () => {
  it('dogru imzayi kabul eder', () => {
    expect(verifyIngestSignature(signedRequest())).toEqual({ ok: true });
  });

  it('hex buyuk harfle gelse de kabul eder', () => {
    const req = signedRequest();
    // Bazi HMAC yardimcilari (ör. bazi PHP/bash kombinasyonlari) hex'i buyuk
    // harf uretir; bu bir imza farki degil, sadece bicimdir.
    const upperHex = VALID_SIG.replace(/^sha256=(.*)$/, (_m, h: string) => `sha256=${h.toUpperCase()}`);
    expect(verifyIngestSignature({ ...req, signature: upperHex })).toEqual({ ok: true });
  });

  it('yanlis sirla uretilmis imzayi dusurur', () => {
    const timestamp = String(NOW);
    const res = verifyIngestSignature(signedRequest({
      signature: computeIngestSignature('luvi_ing_baskabirsir', timestamp, BODY),
    }));
    expect(res).toEqual({ ok: false, reason: 'signature-mismatch' });
  });

  it('govde imzalandiktan sonra degistirilirse dusurur', () => {
    const tampered = BODY.replace('/blog/ai-seo', '/blog/sahte-sayfa');
    expect(verifyIngestSignature(signedRequest({ rawBody: tampered }))).toEqual({
      ok: false,
      reason: 'signature-mismatch',
    });
  });

  it('ESKI zaman damgasini dusurur — yakalanan istek tekrar oynatilamaz', () => {
    const oldTs = NOW - INGEST_TIMESTAMP_TOLERANCE_MS - 1000;
    const res = verifyIngestSignature({
      secret: SECRET,
      timestamp: String(oldTs),
      signature: computeIngestSignature(SECRET, oldTs, BODY),
      rawBody: BODY,
      now: NOW,
    });
    expect(res).toEqual({ ok: false, reason: 'stale-timestamp' });
  });

  it('pencerenin ucundaki damgayi hala kabul eder', () => {
    const edgeTs = NOW - INGEST_TIMESTAMP_TOLERANCE_MS;
    const res = verifyIngestSignature({
      secret: SECRET,
      timestamp: String(edgeTs),
      signature: computeIngestSignature(SECRET, edgeTs, BODY),
      rawBody: BODY,
      now: NOW,
    });
    expect(res).toEqual({ ok: true });
  });

  it('ileri tarihli damgayi dusurur — saat oynatarak pencere genisletilemez', () => {
    const futureTs = NOW + INGEST_TIMESTAMP_TOLERANCE_MS + 1000;
    const res = verifyIngestSignature({
      secret: SECRET,
      timestamp: String(futureTs),
      signature: computeIngestSignature(SECRET, futureTs, BODY),
      rawBody: BODY,
      now: NOW,
    });
    expect(res).toEqual({ ok: false, reason: 'stale-timestamp' });
  });

  it('imza gecerli olsa bile damga oynatilmissa dusurur', () => {
    // Saldirgan eski govde+imzayi alip taze bir damga yapistirir
    const req = signedRequest();
    const res = verifyIngestSignature({ ...req, timestamp: String(NOW + 1) });
    expect(res).toEqual({ ok: false, reason: 'signature-mismatch' });
  });

  it('sir tanimli degilse dusurur (snippet henuz uretilmemis site)', () => {
    expect(verifyIngestSignature(signedRequest({ secret: null }))).toEqual({ ok: false, reason: 'no-secret' });
    expect(verifyIngestSignature(signedRequest({ secret: '' }))).toEqual({ ok: false, reason: 'no-secret' });
    expect(verifyIngestSignature(signedRequest({ secret: '   ' }))).toEqual({ ok: false, reason: 'no-secret' });
  });

  it('imza header eksikse dusurur', () => {
    expect(verifyIngestSignature(signedRequest({ signature: undefined }))).toEqual({
      ok: false,
      reason: 'missing-signature',
    });
  });

  it('zaman damgasi header eksikse dusurur', () => {
    expect(verifyIngestSignature(signedRequest({ timestamp: undefined }))).toEqual({
      ok: false,
      reason: 'missing-timestamp',
    });
  });

  it('sayisal olmayan zaman damgasini dusurur', () => {
    expect(verifyIngestSignature(signedRequest({ timestamp: 'dun' }))).toEqual({
      ok: false,
      reason: 'bad-timestamp',
    });
  });

  it('sha256= oneki olmayan imzayi dusurur — algoritma dusurulemez', () => {
    const req = signedRequest();
    const hex = VALID_SIG.replace('sha256=', '');
    expect(verifyIngestSignature({ ...req, signature: hex })).toEqual({
      ok: false,
      reason: 'bad-signature-format',
    });
    expect(verifyIngestSignature({ ...req, signature: `md5=${hex}` })).toEqual({
      ok: false,
      reason: 'bad-signature-format',
    });
    expect(verifyIngestSignature({ ...req, signature: 'sha256=degil-hex' })).toEqual({
      ok: false,
      reason: 'bad-signature-format',
    });
  });

  it('kisaltilmis imzada patlamaz, sessizce duser', () => {
    const req = signedRequest();
    const res = verifyIngestSignature({ ...req, signature: VALID_SIG.slice(0, 20) });
    expect(res).toEqual({ ok: false, reason: 'signature-mismatch' });
  });

  it('asiri uzun imzada patlamaz, sessizce duser', () => {
    const req = signedRequest();
    const res = verifyIngestSignature({ ...req, signature: `${VALID_SIG}00ff` });
    expect(res).toEqual({ ok: false, reason: 'signature-mismatch' });
  });

  it('bos govdeli imzali istegi de dogru degerlendirir', () => {
    const timestamp = String(NOW);
    const res = verifyIngestSignature({
      secret: SECRET,
      timestamp,
      signature: computeIngestSignature(SECRET, timestamp, ''),
      rawBody: '',
      now: NOW,
    });
    expect(res).toEqual({ ok: true });
  });
});

describe('safeCompareHex', () => {
  it('esit dizgileri esler', () => {
    expect(safeCompareHex('deadbeef', 'deadbeef')).toBe(true);
  });

  it('ayni uzunlukta farkli dizgileri ayirir', () => {
    expect(safeCompareHex('deadbeef', 'deadbeee')).toBe(false);
  });

  it('UZUNLUK FARKINDA patlamaz — timingSafeEqual ham cagrisi TypeError firlatirdi', () => {
    expect(() => safeCompareHex('deadbeef', 'dead')).not.toThrow();
    expect(safeCompareHex('deadbeef', 'dead')).toBe(false);
    expect(safeCompareHex('', 'dead')).toBe(false);
    expect(safeCompareHex('dead', '')).toBe(false);
    expect(safeCompareHex('', '')).toBe(true);
  });
});
