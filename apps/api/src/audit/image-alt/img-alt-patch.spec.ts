import { describe, it, expect } from 'vitest';
import { patchImgAlt, escapeAttr } from '@luviai/adapters';

const GUTENBERG = `<!-- wp:paragraph -->
<p>Giriş.</p>
<!-- /wp:paragraph -->

<!-- wp:image {"id":123,"sizeSlug":"large","linkDestination":"none"} -->
<figure class="wp-block-image size-large"><img src="https://x.com/wp-content/uploads/2026/05/bisiklet-1024x683.jpg" alt="" class="wp-image-123"/></figure>
<!-- /wp:image -->`;

describe('patchImgAlt', () => {
  it('Gutenberg: yalnizca alt degeri degisir, blok yorumlari ve geri kalan bayt aynen kalir', () => {
    const r = patchImgAlt(GUTENBERG, { srcRaw: 'x', wpAttachmentId: 123 }, 'Kırmızı bisiklet');
    expect(r.changed).toBe(true);
    expect(r.oldAlt).toBe('');
    expect(r.html).toBe(GUTENBERG.replace('alt=""', 'alt="Kırmızı bisiklet"'));
  });

  it('alt attribute u yoksa eklenir; self-closing korunur', () => {
    const html = '<p><img src="/a.png" width="10"/></p>';
    const r = patchImgAlt(html, { srcRaw: '/a.png' }, 'Logo');
    expect(r.html).toBe('<p><img alt="Logo" src="/a.png" width="10"/></p>');
    expect(r.oldAlt).toBeNull();
  });

  it('classic editor: tek tirnakli ve tirnaksiz alt degistirilir', () => {
    expect(patchImgAlt(`<img src='/a.png' alt='eski'>`, { srcRaw: '/a.png' }, 'yeni').html).toBe(`<img src='/a.png' alt="yeni">`);
    expect(patchImgAlt('<img alt=eski src=/a.png>', { srcRaw: '/a.png' }, 'yeni').html).toBe('<img alt="yeni" src=/a.png>');
  });

  it('data-alt gibi benzer attribute a dokunmaz', () => {
    const r = patchImgAlt('<img data-alt="x" src="/a.png">', { srcRaw: '/a.png' }, 'Yeni');
    expect(r.html).toBe('<img alt="Yeni" data-alt="x" src="/a.png">');
  });

  it('kacis: tirnak ve < > & guvenli', () => {
    const r = patchImgAlt('<img src="/a.png">', { srcRaw: '/a.png' }, 'A "B" <C> & D');
    expect(r.html).toBe(`<img alt="${escapeAttr('A "B" <C> & D')}" src="/a.png">`);
    expect(r.html).toContain('&quot;B&quot; &lt;C&gt; &amp; D');
  });

  it('mutlak src ile goreli yazim eslesir; ayni gorselin tum kopyalari guncellenir', () => {
    const html = '<img src="/u/a.jpg"><p>x</p><img src="/u/a.jpg">';
    const r = patchImgAlt(html, { srcRaw: 'nope', src: 'https://x.com/u/a.jpg' }, 'Alt');
    expect(r.matched).toBe(2);
  });

  it('taban ad eslesmesi: boyut eki farkli tek kaynak → yazilir; farkli kaynaklar → BELIRSIZ, yazilmaz', () => {
    const one = patchImgAlt('<img src="/up/kedi-300x200.jpg">', { srcRaw: '/up/kedi.jpg' }, 'Kedi');
    expect(one.changed).toBe(true);
    const two = patchImgAlt('<img src="/a/kedi-300x200.jpg"><img src="/b/kedi.jpg">', { srcRaw: '/c/kedi.jpg' }, 'Kedi');
    expect(two).toMatchObject({ changed: false, reason: 'ambiguous' });
  });

  it('bulunamazsa ve zaten ayniysa degisiklik yok (idempotent)', () => {
    expect(patchImgAlt('<img src="/b.png">', { srcRaw: '/a.png' }, 'x').reason).toBe('not_found');
    expect(patchImgAlt('<img src="/a.png" alt="x">', { srcRaw: '/a.png' }, 'x').reason).toBe('unchanged');
  });

  it('geri alma kosulu: mevcut alt beklenen degilse dokunmaz', () => {
    const r = patchImgAlt('<img src="/a.png" alt="kullanici degistirdi">', { srcRaw: '/a.png' }, '', { expectCurrentAlt: 'bizim yazdigimiz' });
    expect(r).toMatchObject({ changed: false, reason: 'expect_mismatch' });
    const ok = patchImgAlt('<img src="/a.png" alt="bizim yazdigimiz">', { srcRaw: '/a.png' }, '', { expectCurrentAlt: 'bizim yazdigimiz' });
    expect(ok.html).toBe('<img src="/a.png" alt="">');
  });

  it('lazy-load: data-src ile eslesir', () => {
    const r = patchImgAlt('<img src="data:image/gif;base64,R0" data-src="/gercek.jpg">', { srcRaw: '/gercek.jpg' }, 'Gerçek');
    expect(r.changed).toBe(true);
  });
});

describe('patchImgAlt — attribute kaldirma (geri alma)', () => {
  it('null → alt attribute kaldirilir; yoksa degisiklik yok', () => {
    expect(patchImgAlt('<img src="/a.png" alt="Bizim">', { srcRaw: '/a.png' }, null).html).toBe('<img src="/a.png">');
    expect(patchImgAlt('<img src="/a.png">', { srcRaw: '/a.png' }, null).reason).toBe('unchanged');
    expect(patchImgAlt('<img src="/a.png" alt="Bizim" class="x">', { srcRaw: '/a.png' }, null, { expectCurrentAlt: 'Bizim' }).html).toBe('<img src="/a.png" class="x">');
  });
});
