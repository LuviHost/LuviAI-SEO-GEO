import { describe, it, expect, vi, afterEach } from 'vitest';
import { WordPressRestAdapter } from '@luviai/adapters';

/**
 * WordPress alt metni yazimi — gercek ag YOK, fetch sahte bir WP REST'i taklit eder.
 */
const RAW = `<!-- wp:image {"id":123} -->
<figure class="wp-block-image"><img src="https://x.com/wp-content/uploads/a-1024x683.jpg" alt="" class="wp-image-123"/></figure>
<!-- /wp:image -->`;

type Opts = { mediaAlt?: string; raw?: string; modifiedSecondRead?: string };

function fakeWp(o: Opts = {}) {
  const calls: Array<{ method: string; url: string; body?: any }> = [];
  let postReads = 0;
  const fetchMock = vi.fn(async (url: string, init: any = {}) => {
    const method = (init.method ?? 'GET').toUpperCase();
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, body });
    const ok = (data: any) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.includes('/wp/v2/media/123?context=edit')) return ok({ id: 123, alt_text: o.mediaAlt ?? '' });
    if (url.endsWith('/wp/v2/media/123') && method === 'POST') return ok({ id: 123 });
    if (url.includes('/wp/v2/posts?slug=')) return ok([{ id: 9, link: 'https://x.com/bisiklet-bakimi/' }]);
    if (url.includes('/wp/v2/posts/9?context=edit')) {
      postReads++;
      const modified = postReads > 1 && o.modifiedSecondRead ? o.modifiedSecondRead : '2026-10-01T00:00:00';
      return ok({ id: 9, content: { raw: o.raw ?? RAW }, modified_gmt: modified });
    }
    if (url.endsWith('/wp/v2/posts/9') && method === 'POST') return ok({ id: 9 });
    return new Response('nf', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  const adapter = new WordPressRestAdapter({ siteUrl: 'https://x.com', username: 'u', appPassword: 'p' }, {});
  return { adapter, calls };
}

const payload = {
  pageUrl: 'https://x.com/bisiklet-bakimi/',
  srcRaw: 'https://x.com/wp-content/uploads/a-1024x683.jpg',
  src: 'https://x.com/wp-content/uploads/a-1024x683.jpg',
  wpAttachmentId: 123,
  alt: 'Zincire yağ damlatılan bisiklet',
  updateMedia: true,
  updateContent: true,
};

afterEach(() => vi.unstubAllGlobals());

describe('WordPressRestAdapter.applyImageAlt', () => {
  it('medya kutuphanesi + gonderi icerigi; onceki degerler geri alma icin doner', async () => {
    const { adapter, calls } = fakeWp();
    const r = await adapter.applyImageAlt(payload);
    expect(r.applied).toEqual(['media_library', 'post_content']);
    expect(r.previous).toMatchObject({ mediaId: 123, mediaAlt: '', postId: 9, postType: 'posts', contentAlt: '' });
    const postWrite = calls.find((c) => c.method === 'POST' && c.url.endsWith('/posts/9'));
    expect(postWrite?.body.content).toBe(RAW.replace('alt=""', 'alt="Zincire yağ damlatılan bisiklet"'));
    expect(calls.find((c) => c.method === 'POST' && c.url.endsWith('/media/123'))?.body).toEqual({ alt_text: payload.alt });
  });

  it('gonderi yazmadan hemen once degistiyse icerik YAZILMAZ (iyimser kilit)', async () => {
    const { adapter, calls } = fakeWp({ modifiedSecondRead: '2026-10-02T09:00:00' });
    const r = await adapter.applyImageAlt(payload);
    expect(r.applied).toEqual(['media_library']);
    expect(r.skipped.map((s) => s.field)).toContain('post_content');
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/posts/9'))).toBe(false);
  });

  it('ham icerik yok (sayfa olusturucu) → yalnizca medya, durust neden', async () => {
    const { adapter } = fakeWp({ raw: '' });
    const r = await adapter.applyImageAlt(payload);
    expect(r.ok).toBe(true);
    expect(r.applied).toEqual(['media_library']);
    expect(r.skipped[0].reason).toMatch(/sayfa olusturucu/);
  });

  it('geri alma: mevcut alt beklenenden farkliysa hicbir yere dokunmaz', async () => {
    const { adapter, calls } = fakeWp({ mediaAlt: 'kullanici elle degistirdi', raw: RAW.replace('alt=""', 'alt="kullanici elle degistirdi"') });
    const r = await adapter.applyImageAlt({ ...payload, alt: '', expectCurrentAlt: payload.alt });
    expect(r.applied).toEqual([]);
    expect(calls.filter((c) => c.method === 'POST')).toEqual([]);
  });
});
