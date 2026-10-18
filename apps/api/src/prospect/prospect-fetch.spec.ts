import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const m = vi.hoisted(() => ({ safeFetchText: vi.fn(), assertResolvesPublic: vi.fn() }));

vi.mock('../common/safe-fetch.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../common/safe-fetch.js')>();
  return { ...actual, safeFetchText: m.safeFetchText, assertResolvesPublic: m.assertResolvesPublic };
});

import * as utils from './prospect-utils.js';
import { fetchText, FETCH_MAX_BYTES } from './prospect-utils.js';
import { RANKSUP_BOT_UA, SafeFetchError, type SafeTextResult } from '../common/safe-fetch.js';

/**
 * Aday arastirmasi fetchText'i — durust kimlik + SSRF korumasi + script'lerin
 * bekledigi hata sozlesmesi.
 *
 * NEDEN VAR: eskiden masaustu Chrome taklidi yapiliyordu ve adresler hic
 * denetlenmiyordu. Script'ler (scripts/prospect/*) hatalari mesaj/ad
 * deseninden siniflandirdigi icin hata metni de sozlesmenin parcasi.
 */

/** scripts/prospect/01-firmalar.ts ve 02-yoneticiler.ts'teki gecici hata deseni */
const GECICI_HATA_RE = /abort|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ECONNREFUSED|EPIPE|fetch failed|socket hang up|HTTP (5\d\d|429|408)\b/i;

function yanit(over: Partial<SafeTextResult> = {}): SafeTextResult {
  return {
    status: 200, ok: true, url: 'https://ornek.com.tr/', redirected: false, contentType: 'text/html',
    headers: { 'content-type': 'text/html; charset=utf-8' }, text: '<html><title>Ornek</title></html>',
    truncated: false, binary: false, ...over,
  };
}

beforeEach(() => {
  m.safeFetchText.mockReset();
  m.assertResolvesPublic.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchText — GET (safeFetchText)', () => {
  it('durust bot kimligiyle ve tavanla ceker, metni dondurur', async () => {
    m.safeFetchText.mockResolvedValue(yanit());
    const html = await fetchText('https://ornek.com.tr/', { timeoutMs: 15_000 });
    expect(html).toContain('Ornek');
    const [url, opts] = m.safeFetchText.mock.calls[0];
    expect(url).toBe('https://ornek.com.tr/');
    expect(opts.userAgent).toBe(RANKSUP_BOT_UA);
    expect(opts.timeoutMs).toBe(15_000);
    expect(opts.maxBytes).toBe(FETCH_MAX_BYTES);
    expect(opts.headers['accept-language']).toMatch(/^tr-TR/);
  });

  it('cagiranin user-agent basligi YOK SAYILIR (tarayici taklidi yapilamaz), digerleri gecer', async () => {
    m.safeFetchText.mockResolvedValue(yanit());
    await fetchText('https://ornek.com.tr/', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh) Chrome/128.0.0.0 Safari/537.36', Accept: 'application/json' },
    });
    const opts = m.safeFetchText.mock.calls[0][1];
    expect(Object.keys(opts.headers)).not.toContain('user-agent');
    expect(opts.headers.accept).toBe('application/json');
    expect(opts.userAgent).toBe(RANKSUP_BOT_UA);
  });

  it('2xx disi: "HTTP <kod> <url>" — script\'lerin kod ayiklamasi calisir', async () => {
    m.safeFetchText.mockResolvedValue(yanit({ status: 404, ok: false, text: 'yok' }));
    await expect(fetchText('https://ornek.com.tr/iletisim')).rejects.toThrow(/^HTTP 404 https:\/\/ornek\.com\.tr\/iletisim$/);
    m.safeFetchText.mockResolvedValue(yanit({ status: 503, ok: false, text: '' }));
    const e = await fetchText('https://ornek.com.tr/').catch((x: Error) => x);
    expect(GECICI_HATA_RE.test((e as Error).message)).toBe(true);
  });

  it('WAF engeli mesajda belirtilir, kod yine ayiklanir', async () => {
    m.safeFetchText.mockResolvedValue(yanit({
      status: 403, ok: false,
      headers: { server: 'cloudflare', 'cf-ray': 'abc' },
      text: '<title>Attention Required! | Cloudflare</title> Sorry, you have been blocked',
    }));
    const e = (await fetchText('https://ornek.com.tr/').catch((x: Error) => x)) as Error;
    expect(e.message).toMatch(/^HTTP 403 /);
    expect(e.message).toContain('engel: cloudflare');
  });

  it('200 donen bot dogrulama ekrani icerik sayilmaz', async () => {
    m.safeFetchText.mockResolvedValue(yanit({ text: '<title>Just a moment...</title>', headers: { server: 'cloudflare' } }));
    await expect(fetchText('https://ornek.com.tr/')).rejects.toThrow(/bot dogrulamasi/);
  });

  it('ikili icerik ve tavana takilan yanit YARIM veriyle donmez', async () => {
    m.safeFetchText.mockResolvedValue(yanit({ binary: true, contentType: 'application/pdf', text: '' }));
    await expect(fetchText('https://ornek.com.tr/a.pdf')).rejects.toThrow(/Metin olmayan icerik/);
    m.safeFetchText.mockResolvedValue(yanit({ truncated: true }));
    await expect(fetchText('https://ornek.com.tr/')).rejects.toThrow(/sinirini asti/);
  });

  it('zaman asimi: AbortError adi + "abort" — script gecici sayip yeniden dener', async () => {
    m.safeFetchText.mockRejectedValue(new SafeFetchError('timeout', 'Zaman asimi'));
    const e = (await fetchText('https://ornek.com.tr/').catch((x: Error) => x)) as Error;
    expect(e.name).toBe('AbortError');
    expect(GECICI_HATA_RE.test(e.message)).toBe(true);
  });

  it('ag/DNS hatasi: "fetch failed" — eski davranisla ayni siniflandirma', async () => {
    for (const code of ['network', 'dns'] as const) {
      m.safeFetchText.mockRejectedValue(new SafeFetchError(code, 'x'));
      const e = (await fetchText('https://ornek.com.tr/').catch((x: Error) => x)) as Error;
      expect(e.message).toContain('fetch failed');
      expect(GECICI_HATA_RE.test(e.message)).toBe(true);
    }
  });

  it('ozel/ic adres reddi kalici hata olarak oldugu gibi gecer', async () => {
    m.safeFetchText.mockRejectedValue(new SafeFetchError('blocked_address', 'Ozel/ayrilmis adres: 10.0.0.1'));
    const e = await fetchText('http://10.0.0.1/').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(SafeFetchError);
    expect((e as SafeFetchError).code).toBe('blocked_address');
    expect(GECICI_HATA_RE.test((e as Error).message)).toBe(false);
  });
});

describe('fetchText — POST (sabit kaynaklar)', () => {
  it('safeFetchText POST ile durust kimlikle gonderir; govde ve basliklar iletilir', async () => {
    m.safeFetchText.mockResolvedValue(yanit({ text: '<table class="x"></table>' }));
    const html = await fetchText('https://www.fortuneturkey.com/wp-admin/admin-ajax.php', {
      method: 'POST', body: 'action=x', headers: { 'user-agent': 'Chrome taklidi', 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(html).toContain('<table');
    const [url, opts] = m.safeFetchText.mock.calls[0] as [string, any];
    expect(url).toBe('https://www.fortuneturkey.com/wp-admin/admin-ajax.php');
    expect(opts.method).toBe('POST');
    expect(opts.body).toBe('action=x');
    expect(opts.userAgent).toBe(RANKSUP_BOT_UA);
    expect(opts.headers['user-agent']).toBeUndefined();
    expect(opts.headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(m.assertResolvesPublic).not.toHaveBeenCalled();
  });

  it('POST yonlendirmesi hata — denetlenmemis adrese govde gitmez', async () => {
    m.safeFetchText.mockResolvedValue(yanit({ status: 302, ok: false, headers: { location: 'http://10.0.0.1/' }, text: '' }));
    await expect(fetchText('https://kaynak.org.tr/form', { method: 'POST', body: 'a=1' })).rejects.toThrow(/HTTP 302 .*izlenmez/);
  });

  it('ic adrese cozulen POST hedefi SafeFetchError ile reddedilir', async () => {
    m.safeFetchText.mockRejectedValue(new SafeFetchError('blocked_address', 'Ozel/ayrilmis adrese cozuldu: ic.local'));
    await expect(fetchText('https://ic.local/form', { method: 'POST' })).rejects.toBeInstanceOf(SafeFetchError);
  });

  it('POST zaman asimi script sozlesmesindeki gecici hata desenine cevrilir', async () => {
    m.safeFetchText.mockRejectedValue(new SafeFetchError('timeout', 'Zaman asimi'));
    const e = await fetchText('https://kaynak.org.tr/form', { method: 'POST' }).catch((x) => x);
    expect(GECICI_HATA_RE.test((e as Error).message)).toBe(true);
  });
});

describe('tarayici taklidi kaldirildi', () => {
  it('DESKTOP_UA artik disari acilmiyor', () => {
    expect('DESKTOP_UA' in utils).toBe(false);
  });
});
