import { PublishAdapter } from './base.js';
import type { PublishPayload, PublishResult, OnPageMetaPayload, OnPageMetaResult } from './base.js';

/**
 * Wix Headless API adapter — sınırlı.
 * Wix REST API SEO meta yazımı için "Wix CLI / SEO Settings API" gerekiyor;
 * Public REST surface dar olduğu için bu adapter şu an `applyOnPageMeta` için
 * "manuel rehber" döndürüyor (skipped) — kullanıcı kendi panelinden uygular.
 *
 * publish(): Wix Blog REST endpoint'i App ID gerektirdiği için MVP'de devre dışı.
 */
export class WixAdapter extends PublishAdapter {
  async publish(_payload: PublishPayload): Promise<PublishResult> {
    return {
      ok: false,
      error: 'Wix publish entegrasyonu henüz aktif değil — Wix Editor üzerinden manuel yayınla, on-page meta\'yı snippet panelinden kopyala',
    };
  }

  async test(): Promise<boolean> {
    const { apiKey, siteId } = this.credentials;
    if (!apiKey || !siteId) return false;
    try {
      const r = await fetch(`https://www.wixapis.com/site-list/v2/sites/${siteId}`, {
        headers: { Authorization: apiKey, 'wix-site-id': siteId },
      });
      return r.ok;
    } catch { return false; }
  }

  async applyOnPageMeta(payload: OnPageMetaPayload): Promise<OnPageMetaResult> {
    return {
      ok: false,
      applied: [],
      skipped: [
        { field: 'all', reason: 'Wix REST API on-page SEO meta yazımı sınırlı. Snippet panelinden çıktıyı al → Wix Editor → Page Settings → SEO (Google) sekmesi → manuel yapıştır.' },
      ],
      externalUrl: payload.pageUrl,
    };
  }
}
