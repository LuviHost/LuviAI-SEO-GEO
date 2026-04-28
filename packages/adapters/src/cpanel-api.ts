import { PublishAdapter } from './base.js';
import type { PublishPayload, PublishResult } from './base.js';

/**
 * cPanel API Token + File Manager API ile static HTML upload.
 * credentials: { cpanelUrl, username, apiToken }
 * config: { remotePath: 'public_html/blog' }
 *
 * cPanel UAPI: Fileman::upload_files
 * Auth: Authorization: cpanel <user>:<token>
 */
export class CpanelApiAdapter extends PublishAdapter {
  async publish(payload: PublishPayload): Promise<PublishResult> {
    const { cpanelUrl, username, apiToken } = this.credentials;
    const { remotePath = 'public_html/blog' } = this.config;

    if (!cpanelUrl || !username || !apiToken) {
      return {
        ok: false,
        error: `cPanel credentials eksik: cpanelUrl=${!!cpanelUrl}, username=${!!username}, apiToken=${!!apiToken}. PublishTarget yeniden olusturup credentials gir.`,
      };
    }

    const filename = `${payload.slug}.html`;
    const url = `${cpanelUrl.replace(/\/$/, '')}/execute/Fileman/upload_files`;

    // multipart/form-data
    const boundary = `----LuviAIBoundary${Date.now()}`;
    const body = [
      `--${boundary}`,
      `Content-Disposition: form-data; name="dir"`,
      '',
      remotePath,
      `--${boundary}`,
      `Content-Disposition: form-data; name="file-1"; filename="${filename}"`,
      'Content-Type: text/html',
      '',
      payload.bodyHtml,
      `--${boundary}--`,
      '',
    ].join('\r\n');

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `cpanel ${username}:${apiToken}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body,
      });

      const data: any = await res.json();
      if (data.status !== 1) {
        return { ok: false, error: data.errors?.[0] ?? 'cPanel upload failed' };
      }

      const externalUrl = `https://${new URL(cpanelUrl).hostname.replace(':2083', '').replace(/^cpanel\./, '')}/${remotePath.replace(/^public_html\/?/, '')}/${filename}`;
      return { ok: true, externalUrl, externalId: filename };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  async test(): Promise<boolean> {
    const { cpanelUrl, username, apiToken } = this.credentials;
    if (!cpanelUrl || !username || !apiToken) return false;
    const res = await fetch(`${cpanelUrl.replace(/\/$/, '')}/execute/Variables/get_user_information`, {
      headers: { 'Authorization': `cpanel ${username}:${apiToken}` },
    }).catch(() => null);
    return !!res?.ok;
  }
}
