import { PublishAdapter } from './base.js';
import type { PublishPayload, PublishResult } from './base.js';

/**
 * WHMCS Knowledgebase adapter.
 * credentials: { whmcsUrl, identifier, secret, accessKey? }
 * config: { categoryId, useseo?: 1, published?: 1 }
 *
 * WHMCS API: AddKBArticle action
 * Docs: https://developers.whmcs.com/api-reference/addkbarticle/
 */
export class WhmcsKbAdapter extends PublishAdapter {
  async publish(payload: PublishPayload): Promise<PublishResult> {
    const { whmcsUrl, identifier, secret, accessKey } = this.credentials;
    const { categoryId = 1, useseo = 1, published = 1 } = this.config;

    const apiUrl = `${whmcsUrl.replace(/\/$/, '')}/includes/api.php`;

    const params = new URLSearchParams({
      action: 'AddKBArticle',
      identifier,
      secret,
      title: payload.title,
      article: payload.bodyHtml,
      categoryid: String(categoryId),
      useseo: String(useseo),
      published: String(published),
      responsetype: 'json',
    });
    if (accessKey) params.append('accesskey', accessKey);

    try {
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });

      const data: any = await res.json();
      if (data.result !== 'success') {
        return { ok: false, error: data.message ?? 'WHMCS API error' };
      }

      return {
        ok: true,
        externalUrl: `${whmcsUrl}/index.php?rp=/knowledgebase/${data.articleid}`,
        externalId: String(data.articleid),
      };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  async test(): Promise<boolean> {
    const { whmcsUrl, identifier, secret } = this.credentials;
    try {
      const params = new URLSearchParams({
        action: 'GetActivityLog',
        identifier,
        secret,
        limitnum: '1',
        responsetype: 'json',
      });
      const res = await fetch(`${whmcsUrl}/includes/api.php`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });
      const data: any = await res.json();
      return data.result === 'success';
    } catch {
      return false;
    }
  }
}
