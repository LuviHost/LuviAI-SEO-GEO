import { PublishAdapter } from './base.js';
import type { PublishPayload, PublishResult, OnPageMetaPayload, OnPageMetaResult, ImageAltPayload, ImageAltResult } from './base.js';
import { patchImgAlt } from './img-alt-patch.js';

/**
 * WordPress REST API adapter.
 * Auth: Application Password (kullanıcı /wp-admin/profile.php'den oluşturur)
 *
 * Yetenekler:
 *  - publish: yeni post oluşturma
 *  - applyOnPageMeta: var olan post/page'e Yoast veya RankMath meta yazma
 *
 * SEO plugin tespit:
 *  GET /wp-json/yoast/v1 (Yoast)  veya  /wp-json/rankmath/v1 (RankMath Pro)
 *  ya da meta keylerinin POST gövdesinde update edilmesi (free RankMath dahil çoğu).
 */
export class WordPressRestAdapter extends PublishAdapter {
  async publish(payload: PublishPayload): Promise<PublishResult> {
    const { siteUrl, username, appPassword } = this.credentials;
    const auth = Buffer.from(`${username}:${appPassword}`).toString('base64');

    let content = payload.bodyHtml;
    let featuredMediaId: number | undefined;

    // Hero görseli WP media kütüphanesine yükle → featured image (öne çıkan görsel) yap.
    // Liste küçük resmi + Yoast og:image bundan gelir. Tema tek-yazıda da gösterir.
    if (payload.heroImageBase64) {
      try {
        const buf = Buffer.from(payload.heroImageBase64, 'base64');
        const filename = payload.heroImageFilename || 'hero.jpg';
        const mime = payload.heroImageMime || 'image/jpeg';
        const up = await fetch(`${siteUrl}/wp-json/wp/v2/media`, {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': mime,
            'Content-Disposition': `attachment; filename="${filename}"`,
          },
          body: buf,
        });
        if (up.ok) {
          const media: any = await up.json();
          featuredMediaId = media.id;
          // Featured image tema tarafından üstte gösterileceği için body'deki
          // hero <img>'i kaldır (çift görsel olmasın).
          if (payload.heroImageUrl) {
            const esc = payload.heroImageUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            content = content.replace(new RegExp(`<img[^>]*src=["']${esc}["'][^>]*>`, 'gi'), '');
          }
        }
      } catch { /* media upload best-effort — yine de post oluştur */ }
    }
    // Kalıntı placeholder hero img'lerini her durumda temizle (kırık görsel olmasın)
    content = content.replace(/<img[^>]*placeholder-hero\.webp[^>]*>/gi, '');

    const postBody: Record<string, any> = {
      title: payload.title,
      slug: payload.slug,
      content,
      status: this.config.postStatus ?? 'publish',
      excerpt: payload.metaDescription,
    };
    if (featuredMediaId) postBody.featured_media = featuredMediaId;

    const res = await fetch(`${siteUrl}/wp-json/wp/v2/posts`, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(postBody),
    });
    if (!res.ok) {
      return { ok: false, error: `WP REST ${res.status}: ${await res.text()}` };
    }
    const data: any = await res.json();
    return { ok: true, externalUrl: data.link, externalId: String(data.id) };
  }

  async test(): Promise<boolean> {
    const { siteUrl } = this.credentials;
    const res = await fetch(`${siteUrl}/wp-json/wp/v2`);
    return res.ok;
  }

  /** Var olan post/page'e on-page meta yaz (Yoast / RankMath / WP core meta). */
  async applyOnPageMeta(payload: OnPageMetaPayload): Promise<OnPageMetaResult> {
    const { siteUrl, username, appPassword } = this.credentials;
    if (!siteUrl || !username || !appPassword) {
      return { ok: false, applied: [], skipped: [{ field: 'all', reason: 'WP credentials eksik' }] };
    }
    const auth = 'Basic ' + Buffer.from(`${username}:${appPassword}`).toString('base64');

    // 1) URL → post/page çöz
    const target = await this.resolvePost(siteUrl, payload.pageUrl, auth);
    if (!target) {
      return {
        ok: false,
        applied: [],
        skipped: [{ field: 'all', reason: `WP'de bu URL'e karşılık post/page bulunamadı: ${payload.pageUrl}` }],
      };
    }

    // 2) Plugin tespiti
    const plugin = await this.detectSeoPlugin(siteUrl);

    // 3) Meta key map
    const metaUpdate: Record<string, any> = {};
    const applied: string[] = [];
    const skipped: { field: string; reason: string }[] = [];

    if (plugin === 'yoast') {
      if (payload.metaTitle) { metaUpdate._yoast_wpseo_title = payload.metaTitle; applied.push('metaTitle'); }
      if (payload.metaDescription) { metaUpdate._yoast_wpseo_metadesc = payload.metaDescription; applied.push('metaDescription'); }
      if (payload.canonical) { metaUpdate._yoast_wpseo_canonical = payload.canonical; applied.push('canonical'); }
      if (payload.ogTitle) { metaUpdate._yoast_wpseo_opengraph_title = payload.ogTitle; applied.push('ogTitle'); }
      if (payload.ogDescription) { metaUpdate._yoast_wpseo_opengraph_description = payload.ogDescription; applied.push('ogDescription'); }
      if (payload.ogImage) { metaUpdate._yoast_wpseo_opengraph_image = payload.ogImage; applied.push('ogImage'); }
    } else if (plugin === 'rankmath') {
      if (payload.metaTitle) { metaUpdate.rank_math_title = payload.metaTitle; applied.push('metaTitle'); }
      if (payload.metaDescription) { metaUpdate.rank_math_description = payload.metaDescription; applied.push('metaDescription'); }
      if (payload.canonical) { metaUpdate.rank_math_canonical_url = payload.canonical; applied.push('canonical'); }
      if (payload.ogTitle) { metaUpdate.rank_math_facebook_title = payload.ogTitle; applied.push('ogTitle'); }
      if (payload.ogDescription) { metaUpdate.rank_math_facebook_description = payload.ogDescription; applied.push('ogDescription'); }
      if (payload.ogImage) { metaUpdate.rank_math_facebook_image = payload.ogImage; applied.push('ogImage'); }
    } else {
      // Plugin yok — sadece WP core excerpt + slug güncellenebilir, gerisi snippet'e bırakılmalı
      if (payload.metaDescription) {
        const r = await this.coreUpdate(siteUrl, target, { excerpt: payload.metaDescription }, auth);
        if (r.ok) applied.push('metaDescription (excerpt)');
        else skipped.push({ field: 'metaDescription', reason: r.error ?? 'WP core update başarısız' });
      }
      const all = ['metaTitle', 'canonical', 'ogTitle', 'ogDescription', 'ogImage', 'twitterCard', 'jsonLd'];
      for (const f of all) {
        if ((payload as any)[f] !== undefined && f !== 'metaDescription') {
          skipped.push({ field: f, reason: 'Yoast / RankMath plugin gerekli' });
        }
      }
      return {
        ok: applied.length > 0,
        applied,
        skipped,
        externalUrl: target.link,
      };
    }

    if (Object.keys(metaUpdate).length === 0) {
      return { ok: false, applied: [], skipped: [{ field: 'all', reason: 'Uygulanacak meta yok' }] };
    }

    // 4) POST/PAGE update — meta REST içine yazılır (Yoast/RankMath ikisi de register_meta yapıyor)
    const updateRes = await fetch(`${siteUrl}/wp-json/wp/v2/${target.type}/${target.id}`, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ meta: metaUpdate }),
    });
    if (!updateRes.ok) {
      const errText = await updateRes.text();
      return {
        ok: false,
        applied: [],
        skipped: [{ field: 'all', reason: `WP update ${updateRes.status}: ${errText.slice(0, 200)}` }],
      };
    }

    return {
      ok: true,
      applied,
      skipped,
      externalUrl: target.link,
    };
  }

  /** URL → posts veya pages REST endpoint'inden çözer */
  private async resolvePost(siteUrl: string, pageUrl: string, auth: string): Promise<{ id: number; type: 'posts' | 'pages'; link: string } | null> {
    const slug = (() => {
      try {
        const u = new URL(pageUrl);
        const seg = u.pathname.replace(/\/$/, '').split('/').filter(Boolean);
        return seg[seg.length - 1] || '';
      } catch { return ''; }
    })();

    if (!slug) {
      // Anasayfa olabilir — front page id'sini al
      try {
        const settings = await fetch(`${siteUrl}/wp-json/wp/v2/settings`, { headers: { Authorization: auth } });
        if (settings.ok) {
          const data: any = await settings.json();
          if (data.show_on_front === 'page' && data.page_on_front) {
            const pg = await fetch(`${siteUrl}/wp-json/wp/v2/pages/${data.page_on_front}`, { headers: { Authorization: auth } });
            if (pg.ok) {
              const p: any = await pg.json();
              return { id: p.id, type: 'pages', link: p.link };
            }
          }
        }
      } catch {}
      return null;
    }

    for (const type of ['posts', 'pages'] as const) {
      const res = await fetch(`${siteUrl}/wp-json/wp/v2/${type}?slug=${encodeURIComponent(slug)}`, {
        headers: { Authorization: auth },
      });
      if (!res.ok) continue;
      const arr: any[] = await res.json();
      if (arr.length > 0) {
        return { id: arr[0].id, type, link: arr[0].link };
      }
    }
    return null;
  }

  private async detectSeoPlugin(siteUrl: string): Promise<'yoast' | 'rankmath' | 'none'> {
    const tries: Array<['yoast' | 'rankmath', string]> = [
      ['yoast', `${siteUrl}/wp-json/yoast/v1/configuration`],
      ['rankmath', `${siteUrl}/wp-json/rankmath/v1`],
    ];
    for (const [name, url] of tries) {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (r.status === 200 || r.status === 401) return name;
      } catch {}
    }
    // Fallback: anasayfa HTML'inde signature ara
    try {
      const home = await fetch(siteUrl, { signal: AbortSignal.timeout(8000) });
      if (home.ok) {
        const html = await home.text();
        if (/yoast/i.test(html)) return 'yoast';
        if (/rank-math|rankmath/i.test(html)) return 'rankmath';
      }
    } catch {}
    return 'none';
  }

  /**
   * Gorsel alt metni yaz:
   *  - medya kutuphanesi alt_text (one cikan gorsel, yeni eklemeler bunu kullanir)
   *  - gonderi/sayfa icerigindeki <img alt> (WordPress eklenmis etiketin alt'ini
   *    kutuphaneden GUNCELLEMEZ — ayri duzenleme gerekir; Trac #49165)
   * Icerik yazimi cerrahidir (img-alt-patch) ve iyimser kilitlidir: yazmadan
   * hemen once modified_gmt yeniden okunur, degistiyse yazilmaz.
   */
  async applyImageAlt(p: ImageAltPayload): Promise<ImageAltResult> {
    const { siteUrl, username, appPassword } = this.credentials;
    if (!siteUrl || !username || !appPassword) {
      return { ok: false, applied: [], skipped: [{ field: 'all', reason: 'WP credentials eksik' }] };
    }
    const auth = 'Basic ' + Buffer.from(`${username}:${appPassword}`).toString('base64');
    const base = String(siteUrl).replace(/\/+$/, '');
    const json = { Authorization: auth, 'Content-Type': 'application/json' };
    const applied: string[] = [];
    const skipped: { field: string; reason: string }[] = [];
    const previous: NonNullable<ImageAltResult['previous']> = {};
    let externalUrl: string | undefined;

    if (p.updateMedia) {
      const mediaId = p.wpAttachmentId ?? await this.findMediaId(base, p.src, auth);
      if (!mediaId) {
        skipped.push({ field: 'media_library', reason: 'Medya kutuphanesinde bu gorsel bulunamadi' });
      } else {
        const cur = await fetch(`${base}/wp-json/wp/v2/media/${mediaId}?context=edit&_fields=id,alt_text`, { headers: { Authorization: auth } });
        if (!cur.ok) {
          skipped.push({ field: 'media_library', reason: `WP medya ${cur.status}` });
        } else {
          const m: any = await cur.json();
          const oldAlt = typeof m?.alt_text === 'string' ? m.alt_text : '';
          previous.mediaId = mediaId;
          previous.mediaAlt = oldAlt;
          if (p.expectCurrentAlt !== undefined && oldAlt.trim() !== p.expectCurrentAlt.trim()) {
            skipped.push({ field: 'media_library', reason: 'Alt metni o arada degismis — dokunulmadi' });
          } else if (oldAlt === (p.alt ?? '')) {
            skipped.push({ field: 'media_library', reason: 'Zaten ayni' });
          } else {
            const up = await fetch(`${base}/wp-json/wp/v2/media/${mediaId}`, { method: 'POST', headers: json, body: JSON.stringify({ alt_text: p.alt ?? '' }) });
            if (up.ok) applied.push('media_library');
            else skipped.push({ field: 'media_library', reason: `WP medya ${up.status}: ${(await up.text()).slice(0, 150)}` });
          }
        }
      }
    }

    if (p.updateContent) {
      const target = await this.resolvePost(base, p.pageUrl, auth);
      if (!target) {
        skipped.push({ field: 'post_content', reason: 'Bu URL icin WordPress yazisi/sayfasi bulunamadi (ozel icerik turu olabilir)' });
      } else {
        externalUrl = target.link;
        const read = async () => {
          const r = await fetch(`${base}/wp-json/wp/v2/${target.type}/${target.id}?context=edit&_fields=id,content,modified_gmt`, { headers: { Authorization: auth } });
          return r.ok ? (await r.json() as any) : null;
        };
        const post = await read();
        const raw = post?.content?.raw;
        if (typeof raw !== 'string' || !raw) {
          skipped.push({ field: 'post_content', reason: 'Gonderinin ham icerigi okunamadi (sayfa olusturucu olabilir)' });
        } else {
          const patched = patchImgAlt(raw, { srcRaw: p.srcRaw, src: p.src, wpAttachmentId: p.wpAttachmentId }, p.alt, { expectCurrentAlt: p.expectCurrentAlt });
          previous.postId = target.id;
          previous.postType = target.type;
          previous.contentAlt = patched.oldAlt;
          if (!patched.changed) {
            const why: Record<string, string> = {
              not_found: 'Gorsel gonderi iceriginde yok (tema/sayfa olusturucu ekliyor olabilir)',
              ambiguous: 'Ayni adli birden cok gorsel var — hangisi oldugu belirsiz, yazilmadi',
              unchanged: 'Zaten ayni',
              expect_mismatch: 'Alt metni o arada degismis — dokunulmadi',
            };
            skipped.push({ field: 'post_content', reason: why[patched.reason ?? 'not_found'] });
          } else {
            const again = await read();
            if (!again || again.modified_gmt !== post.modified_gmt) {
              skipped.push({ field: 'post_content', reason: 'Gonderi o sirada degisti — yazilmadi, tekrar dene' });
            } else {
              const up = await fetch(`${base}/wp-json/wp/v2/${target.type}/${target.id}`, { method: 'POST', headers: json, body: JSON.stringify({ content: patched.html }) });
              if (up.ok) applied.push('post_content');
              else skipped.push({ field: 'post_content', reason: `WP ${up.status}: ${(await up.text()).slice(0, 150)}` });
            }
          }
        }
      }
    }

    return { ok: applied.length > 0, applied, skipped, previous, externalUrl };
  }

  /** Mutlak gorsel URL'i → medya id (orijinal ya da boyutlandirilmis kopya) */
  private async findMediaId(base: string, src: string, auth: string): Promise<number | null> {
    const file = (src.split(/[?#]/)[0].split('/').pop() ?? '').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/-(?:\d+x\d+|scaled)$/i, '');
    if (!file) return null;
    const res = await fetch(`${base}/wp-json/wp/v2/media?search=${encodeURIComponent(file)}&per_page=20&_fields=id,source_url,media_details`, { headers: { Authorization: auth } });
    if (!res.ok) return null;
    const items: any[] = await res.json().catch(() => []);
    const clean = (u: string) => String(u ?? '').split(/[?#]/)[0];
    const want = clean(src);
    const hit = items.find((m) =>
      clean(m?.source_url) === want
      || Object.values(m?.media_details?.sizes ?? {}).some((s: any) => clean(s?.source_url) === want));
    return hit ? Number(hit.id) : null;
  }

  private async coreUpdate(
    siteUrl: string,
    target: { id: number; type: 'posts' | 'pages' },
    body: Record<string, any>,
    auth: string,
  ): Promise<{ ok: boolean; error?: string }> {
    const res = await fetch(`${siteUrl}/wp-json/wp/v2/${target.type}/${target.id}`, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { ok: false, error: `WP ${res.status}: ${(await res.text()).slice(0, 150)}` };
    return { ok: true };
  }
}
