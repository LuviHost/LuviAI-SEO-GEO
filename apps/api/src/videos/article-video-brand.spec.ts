import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { applyBrandOverrides, extractSiteBrand, normalizeHexColor, prepareLogo, safeBrandFetcher } from './article-video-brand.js';
import { loadBrandKit } from './article-short-kit.js';
import { safeFetchBinary, SafeFetchError, type SafeTextResult } from '../common/safe-fetch.js';

/**
 * RanksUp Video marka cikarimi: indirmeler SSRF korumali (common/safe-fetch.ts), logo
 * guvenilmeyen veri (sharp ile sinirli PNG), hicbir hata videoyu dusurmez.
 */

const page = (html: string, url = 'https://www.ornekklinik.com/'): SafeTextResult => ({
  status: 200, ok: true, url, redirected: false, contentType: 'text/html', headers: {}, text: html, truncated: false, binary: false,
});

async function png(w: number, h: number, color = '#2563eb'): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer();
}

describe('SSRF — ozel / yerel adreslere istek atilmaz', () => {
  it('site adresi yerel IP ise anasayfa HIC indirilmez; video varsayilan markayla devam eder', async () => {
    // Varsayilan indirici (verilmezse) SSRF korumali safe-fetch olmali
    const b = await extractSiteBrand({ url: 'http://127.0.0.1/', name: 'Yerel' }, { kit: await loadBrandKit() });
    expect(b.name).toBe('Yerel');
    expect(b.logoDataUri).toBeNull();
    expect(b.notes.join(' ')).toMatch(/blocked_address/);
  });

  it('bulut metadata adresi (169.254.169.254) ve yonlendirme hilesi reddedilir', async () => {
    const f = safeBrandFetcher();
    await expect(f('http://169.254.169.254/latest/meta-data/', { maxBytes: 1000, accept: 'text/css' })).rejects.toMatchObject({ code: 'blocked_address' });
    await expect(f('http://[::ffff:127.0.0.1]/logo.png', { maxBytes: 1000, accept: 'image/*' })).rejects.toMatchObject({ code: 'blocked_address' });
    await expect(f('http://10.0.0.5:8080/x.png', { maxBytes: 1000, accept: 'image/*' })).rejects.toBeInstanceOf(SafeFetchError);
    await expect(f('file:///etc/passwd', { maxBytes: 1000, accept: 'image/*' })).rejects.toMatchObject({ code: 'protocol' });
  });

  it('sayfadaki logo baglantisi ic aga isaret ediyorsa aday atlanir, sonraki aday denenir', async () => {
    const html = `<html><head><meta property="og:site_name" content="Örnek Klinik">
      <link rel="apple-touch-icon" href="http://192.168.1.10/icon.png">
      <link rel="icon" href="/logo.png" sizes="64x64"></head><body></body></html>`;
    const logo = await png(64, 64);
    const fetchBinary = vi.fn(async (url: string) => {
      // Gercek koruma: ozel IP icin safe-fetch'in kendisi cagrilir
      if (url.startsWith('http://192.168.')) return safeFetchBinary(url, { maxBytes: 1000 });
      return { url, contentType: 'image/png', body: logo };
    });
    const b = await extractSiteBrand({ url: 'https://www.ornekklinik.com/', name: 'x' }, {
      kit: await loadBrandKit(),
      fetchText: vi.fn(async (u: string) => (u.endsWith('/') ? page(html) : page(''))) as any,
      fetchBinary: fetchBinary as any,
    });
    expect(b.name).toBe('Örnek Klinik');
    expect(b.notes.join(' ')).toMatch(/logo adayi atlandi \(http:\/\/192\.168\.1\.10\/icon\.png\)/);
    expect(b.logoDataUri?.startsWith('data:image/png;base64,')).toBe(true);
  });
});

describe('logo — guvenilmeyen ikili, sinirli PNG', () => {
  it('buyuk gorsel en fazla 256 px PNG olur', async () => {
    const r = await prepareLogo(await png(1024, 512), 'image/png');
    const meta = await sharp(r!.body).metadata();
    expect(r!.type).toBe('image/png');
    expect(Math.max(meta.width!, meta.height!)).toBe(256);
  });

  it('SVG rasterlenir: betik PNG ciktisina tasinmaz', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><script>alert(1)</script><rect width="40" height="40" fill="#16a34a"/></svg>');
    const r = await prepareLogo(svg, 'image/svg+xml');
    expect(r?.type).toBe('image/png');
    expect(r!.body.includes(Buffer.from('script'))).toBe(false);
  });

  it('cozulemeyen / ICO / cok kucuk / piksel bombasi -> null (aday atlanir)', async () => {
    expect(await prepareLogo(Buffer.from('bu bir resim degil'), 'image/png')).toBeNull();
    expect(await prepareLogo(await png(64, 64), 'image/x-icon')).toBeNull();
    expect(await prepareLogo(await png(8, 8), 'image/png')).toBeNull();
    // 5000x5000 > 4096*4096 piksel tavani
    const bomb = await sharp({ create: { width: 5000, height: 5000, channels: 3, background: '#000000' } }).png({ compressionLevel: 9 }).toBuffer();
    expect(await prepareLogo(bomb, 'image/png')).toBeNull();
  });
});

describe('renk ve kullanici duzeltmeleri', () => {
  it('yalniz #rrggbb kabul (kisa yazim acilir), digerleri null', () => {
    expect(normalizeHexColor('#ABC')).toBe('#aabbcc');
    expect(normalizeHexColor('1d4ed8')).toBe('#1d4ed8');
    for (const v of ['red', 'rgb(1,2,3)', '#12345', '', null, 7, 'url(javascript:1)']) expect(normalizeHexColor(v)).toBeNull();
  });

  it('renk / logo / ad duzeltmesi markanin ustune; null renk sablon rengine doner', () => {
    const base = { name: 'Örnek', domain: 'ornek.com', primary: '#2563eb', colorSource: 'meta:theme-color', logoDataUri: 'data:image/png;base64,AAAA', logoSource: 'x', notes: [] };
    expect(applyBrandOverrides(base, { primaryColor: '#DC2626' })).toMatchObject({ primary: '#dc2626', colorSource: 'kullanici', logoDataUri: base.logoDataUri });
    expect(applyBrandOverrides(base, { primaryColor: null }).primary).toBeNull();
    expect(applyBrandOverrides(base, { useLogo: false }).logoDataUri).toBeNull();
    expect(applyBrandOverrides(base, { brandName: '  Yeni   Ad ' }).name).toBe('Yeni Ad');
    expect(applyBrandOverrides(base, { primaryColor: 'javascript:alert(1)' }).primary).toBe('#2563eb');
    expect(applyBrandOverrides(base, undefined)).toBe(base);
  });
});
