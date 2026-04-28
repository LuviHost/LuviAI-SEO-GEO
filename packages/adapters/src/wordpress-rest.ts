import { PublishAdapter } from './base.js';
import type { PublishPayload, PublishResult, OnPageMetaPayload, OnPageMetaResult } from './base.js';

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

    const res = await fetch(`${siteUrl}/wp-json/wp/v2/posts`, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: payload.title,
        slug: payload.slug,
        content: payload.bodyHtml,
        status: this.config.postStatus ?? 'publish',
        excerpt: payload.metaDescription,
      }),
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
