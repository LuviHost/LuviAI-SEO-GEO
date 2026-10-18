import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SafeTextResult } from '../common/safe-fetch.js';

const fetchMock = vi.fn();
vi.mock('../common/safe-fetch.js', async (orig) => {
  const real: any = await orig();
  return { ...real, safeFetchText: (...a: any[]) => fetchMock(...a) };
});

const { fetchCustomerPage, pageFailureText, declaresNonUtf8, rewriteCharsetProblem } = await import('./customer-page-fetch.js');
const { SafeFetchError } = await import('../common/safe-fetch.js');

const res = (r: Partial<SafeTextResult> & { status: number }): SafeTextResult => ({
  ok: r.status >= 200 && r.status < 300, url: 'https://site.com/', redirected: false, contentType: 'text/html',
  headers: {}, text: '', truncated: false, binary: false, ...r,
});

beforeEach(() => { fetchMock.mockReset(); });

describe('fetchCustomerPage', () => {
  it('okunan sayfa: metin, kesik bilgisi, son adres, bildirilen karakter kumesi', async () => {
    fetchMock.mockResolvedValue(res({ status: 200, url: 'https://www.site.com/', text: '<html>a</html>', truncated: true, headers: { 'content-type': 'text/html; charset=UTF-8' } }));
    expect(await fetchCustomerPage('https://site.com')).toEqual({
      kind: 'ok', text: '<html>a</html>', truncated: true, url: 'https://www.site.com/', status: 200, contentType: 'text/html', charset: 'utf-8',
    });
  });

  it('karakter kumesi basliktan, yoksa <meta charset>tan; hic yoksa null', async () => {
    fetchMock.mockResolvedValue(res({ status: 200, text: '<meta charset="windows-1254"><p>ş</p>' }));
    expect(await fetchCustomerPage('https://site.com')).toMatchObject({ charset: 'windows-1254' });
    fetchMock.mockResolvedValue(res({ status: 200, text: '<p>a</p>' }));
    expect(await fetchCustomerPage('https://site.com')).toMatchObject({ charset: null });
  });

  it('engel sayfasi 403 de 200 de "blocked" — icerik sayilmaz', async () => {
    fetchMock.mockResolvedValue(res({ status: 403, headers: { server: 'cloudflare', 'cf-ray': 'x' }, text: 'Sorry, you have been blocked' }));
    expect(await fetchCustomerPage('https://site.com')).toMatchObject({ kind: 'blocked', signal: { kind: 'waf', vendor: 'cloudflare' } });
    fetchMock.mockResolvedValue(res({ status: 200, text: '<title>Just a moment...</title>' }));
    expect(await fetchCustomerPage('https://site.com')).toMatchObject({ kind: 'blocked', signal: { kind: 'challenge', status: 200 } });
  });

  it('404/500 engel DEGIL, "failed"; metin disi icerik "binary"', async () => {
    fetchMock.mockResolvedValue(res({ status: 404, text: 'yok' }));
    expect(await fetchCustomerPage('https://site.com')).toEqual({ kind: 'failed', code: 'http', status: 404 });
    fetchMock.mockResolvedValue(res({ status: 200, binary: true, contentType: 'application/pdf' }));
    expect(await fetchCustomerPage('https://site.com')).toEqual({ kind: 'failed', code: 'binary', status: 200, contentType: 'application/pdf' });
  });

  it('SafeFetchError kodu korunur (ic adres, zaman asimi); hata ATILMAZ', async () => {
    fetchMock.mockRejectedValue(new SafeFetchError('blocked_address', 'ozel'));
    expect(await fetchCustomerPage('http://169.254.169.254/')).toEqual({ kind: 'failed', code: 'blocked_address', status: null });
    fetchMock.mockRejectedValue(new Error('beklenmeyen'));
    expect(await fetchCustomerPage('https://site.com')).toEqual({ kind: 'failed', code: 'network', status: null });
  });
});

describe('pageFailureText / declaresNonUtf8', () => {
  it('engelde neden + RanksUpBot izin talimati', async () => {
    fetchMock.mockResolvedValue(res({ status: 403, headers: { server: 'cloudflare', 'cf-ray': 'x' }, text: 'Sorry, you have been blocked' }));
    const page = await fetchCustomerPage('https://site.com');
    if (page.kind === 'ok') throw new Error('engel bekleniyordu');
    const text = pageFailureText(page);
    expect(text).toContain('Cloudflare');
    expect(text).toContain('RanksUpBot');
  });
  it('hata kodlarina Turkce aciklama', () => {
    expect(pageFailureText({ kind: 'failed', code: 'http', status: 500 })).toBe('Sayfa HTTP 500 döndü.');
    expect(pageFailureText({ kind: 'failed', code: 'blocked_address', status: null })).toContain('iç ağa');
    expect(pageFailureText({ kind: 'failed', code: 'timeout', status: null })).toBe('Sayfa zamanında yanıt vermedi.');
  });
  it('cozulemeyen sikistirma (content_encoding): kod korunur, "bağlanılamadı" denmez', async () => {
    fetchMock.mockRejectedValue(new SafeFetchError('content_encoding', 'Desteklenmeyen icerik kodlamasi: zstd'));
    const page = await fetchCustomerPage('https://site.com');
    expect(page).toEqual({ kind: 'failed', code: 'content_encoding', status: null });
    if (page.kind === 'ok') throw new Error('hata bekleniyordu');
    expect(pageFailureText(page)).toBe('Sayfa çözülemeyen bir sıkıştırmayla (Content-Encoding) geldi; okunamadı.');
  });
  it('geri yazim: UTF-8 disi bildirim ya da gecersiz UTF-8 govde reddedilir', () => {
    expect(rewriteCharsetProblem({ charset: 'utf-8', text: '<p>şğı</p>' })).toBeNull();
    expect(rewriteCharsetProblem({ charset: null, text: '<p>plain</p>' })).toBeNull();
    expect(rewriteCharsetProblem({ charset: 'windows-1254', text: '<p>şğı</p>' })).toContain('windows-1254');
    // Bildirimsiz windows-1254 baytlari UTF-8 cozumde U+FFFD olur
    expect(rewriteCharsetProblem({ charset: null, text: '<p>��</p>' })).toContain('UTF-8 değil');
  });
  it('UTF-8 disi bildirim', () => {
    expect(declaresNonUtf8({ charset: 'windows-1254' })).toBe(true);
    expect(declaresNonUtf8({ charset: 'iso-8859-9' })).toBe(true);
    expect(declaresNonUtf8({ charset: 'utf-8' })).toBe(false);
    expect(declaresNonUtf8({ charset: 'utf8' })).toBe(false);
    expect(declaresNonUtf8({ charset: null })).toBe(false);
  });
});
