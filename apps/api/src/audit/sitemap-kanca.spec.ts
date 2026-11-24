import { describe, it, expect, vi } from 'vitest';
import { bearerAnahtar, kancaHash, kancaSitemapAdresi, yeniKancaAnahtari } from './sitemap-kanca.js';
import { SitemapKancaController } from './sitemap-kanca.controller.js';

describe('site haritasi tetigi — yardimcilar', () => {
  it('anahtar 64 hex; ozet deterministik ve anahtarin kendisi degil', () => {
    const a = yeniKancaAnahtari();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(kancaHash(a)).toBe(kancaHash(a));
    expect(kancaHash(a)).not.toBe(a);
  });

  it('Bearer basligi', () => {
    const a = 'a'.repeat(64);
    expect(bearerAnahtar(`Bearer ${a}`)).toBe(a);
    expect(bearerAnahtar(a)).toBeNull();
    expect(bearerAnahtar('Bearer kisa')).toBeNull();
    expect(bearerAnahtar(undefined)).toBeNull();
  });

  it('site haritasi adresi: varsayilan, ayni alan adi (www/alt alan), yabanci alan adi ve http reddi', () => {
    expect(kancaSitemapAdresi('https://kobipratik.com', undefined)).toBe('https://kobipratik.com/sitemap.xml');
    expect(kancaSitemapAdresi('https://kobipratik.com', 'https://www.kobipratik.com/sitemap.xml')).toBe('https://www.kobipratik.com/sitemap.xml');
    expect(kancaSitemapAdresi('https://kobipratik.com', 'https://kobipratik.com.evil.net/sitemap.xml')).toBeNull();
    expect(kancaSitemapAdresi('https://kobipratik.com', 'http://www.kobipratik.com/sitemap.xml')).toBeNull();
    expect(kancaSitemapAdresi('https://kobipratik.com', 42)).toBeNull();
  });
});

describe('POST /api/hooks/sitemap', () => {
  const anahtar = 'b'.repeat(64);
  const kur = (site: { id: string; url: string } | null, submit = { ok: true } as { ok: boolean; skipped?: string; error?: string }) => {
    const findUnique = vi.fn().mockResolvedValue(site);
    const submitSitemap = vi.fn().mockResolvedValue(submit);
    const c = new SitemapKancaController({ site: { findUnique } } as never, { submitSitemap } as never);
    return { c, findUnique, submitSitemap };
  };

  it('dogru anahtar: ozetle arar ve gonderir', async () => {
    const { c, findUnique, submitSitemap } = kur({ id: 's1', url: 'https://kobipratik.com' });
    await expect(c.gonder(`Bearer ${anahtar}`, { sitemap: 'https://www.kobipratik.com/sitemap.xml' })).resolves.toEqual({ ok: true, sitemap: 'https://www.kobipratik.com/sitemap.xml' });
    expect(findUnique.mock.calls[0][0].where).toEqual({ sitemapKancaHash: kancaHash(anahtar) });
    expect(submitSitemap).toHaveBeenCalledWith('s1', 'https://www.kobipratik.com/sitemap.xml');
  });

  it('anahtar yok ya da bilinmiyor → 401, gonderim yok', async () => {
    const { c, submitSitemap } = kur(null);
    await expect(c.gonder(undefined, {})).rejects.toMatchObject({ status: 401 });
    await expect(c.gonder(`Bearer ${anahtar}`, {})).rejects.toMatchObject({ status: 401 });
    expect(submitSitemap).not.toHaveBeenCalled();
  });

  it('baska alan adinin site haritasi → 400', async () => {
    const { c } = kur({ id: 's1', url: 'https://kobipratik.com' });
    await expect(c.gonder(`Bearer ${anahtar}`, { sitemap: 'https://ranksup.ai/sitemap.xml' })).rejects.toMatchObject({ status: 400 });
  });

  it('5 dakika icinde ikinci tetik → 429', async () => {
    const { c, submitSitemap } = kur({ id: 's1', url: 'https://kobipratik.com' });
    await c.gonder(`Bearer ${anahtar}`, {});
    await expect(c.gonder(`Bearer ${anahtar}`, {})).rejects.toMatchObject({ status: 429 });
    expect(submitSitemap).toHaveBeenCalledTimes(1);
  });

  it('Search Console reddederse → 502', async () => {
    const { c } = kur({ id: 's1', url: 'https://kobipratik.com' }, { ok: false, error: 'insufficient_scope (reconnect GSC)' });
    await expect(c.gonder(`Bearer ${anahtar}`, {})).rejects.toMatchObject({ status: 502 });
  });
});
