import { PublishAdapter } from './base.js';
import type { PublishPayload, PublishResult } from './base.js';

// undici dispatcher: cPanel sunuculari cogu zaman IP veya self-signed
// sertifika ile sunulur. Default Node fetch hostname-cert eslesmesini zorlar
// ('SSL: no alternative certificate subject name'). cPanel API'si icin
// rejectUnauthorized:false yaygin pratik (HTTPS Basic auth + token zaten
// sifreli, MITM riski sinirli host icindeyiz).
let insecureDispatcher: any = null;
async function getInsecureDispatcher() {
  if (insecureDispatcher) return insecureDispatcher;
  try {
    const undici = await import('undici');
    insecureDispatcher = new undici.Agent({ connect: { rejectUnauthorized: false } });
  } catch {
    insecureDispatcher = null;
  }
  return insecureDispatcher;
}

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
    // host (catalog formundaki ad) veya cpanelUrl (eski docstring adi) — ikisini de kabul et
    const host = this.credentials.host ?? this.credentials.cpanelUrl;
    const { username, apiToken } = this.credentials;
    // Path: hem 'public_html/blog' hem '/public_html/blog' kabul edilebilir
    let remotePath = String(this.config.remotePath ?? 'public_html/blog').replace(/^\/+/, '').replace(/\/+$/, '');
    if (!remotePath) remotePath = 'public_html/blog';

    if (!host || !username || !apiToken) {
      return {
        ok: false,
        error: `cPanel credentials eksik: host=${!!host}, username=${!!username}, apiToken=${!!apiToken}. PublishTarget formundaki "cPanel host" alanini kontrol et (orn: https://cpanel.example.com:2083).`,
      };
    }

    const filename = `${payload.slug}.html`;
    const url = `${host.replace(/\/$/, '')}/execute/Fileman/upload_files`;

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
      const dispatcher = await getInsecureDispatcher();
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `cpanel ${username}:${apiToken}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body,
        ...(dispatcher ? { dispatcher } as any : {}),
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        return {
          ok: false,
          error: `cPanel HTTP ${res.status} (${url}): ${txt.slice(0, 200)}`,
        };
      }
      const data: any = await res.json();
      if (data.status !== 1) {
        return { ok: false, error: `cPanel API hata: ${data.errors?.[0] ?? JSON.stringify(data).slice(0, 200)}` };
      }

      const externalUrl = `https://${new URL(host).hostname.replace(':2083', '').replace(/^cpanel\./, '')}/${remotePath.replace(/^public_html\/?/, '')}/${filename}`;
      return { ok: true, externalUrl, externalId: filename };
    } catch (err: any) {
      // undici 'fetch failed' altinda gercek sebep err.cause'da
      const cause = err?.cause;
      const causeMsg = cause?.code ? `${cause.code}: ${cause.message ?? ''}` : (cause?.message ?? '');
      const detail = [err.message, causeMsg].filter(Boolean).join(' | ');
      return {
        ok: false,
        error: `cPanel baglanti hatasi (${url}): ${detail}. Kontrol et: host URL https:// + port 2083 ile mi? SSL gecerli mi? cPanel servisine ulasilabiliyor mu?`,
      };
    }
  }

  async test(): Promise<boolean> {
    const host = this.credentials.host ?? this.credentials.cpanelUrl;
    const { username, apiToken } = this.credentials;
    if (!host || !username || !apiToken) return false;
    const dispatcher = await getInsecureDispatcher();
    const res = await fetch(
      `${host.replace(/\/$/, '')}/execute/Variables/get_user_information`,
      {
        headers: { 'Authorization': `cpanel ${username}:${apiToken}` },
        ...(dispatcher ? { dispatcher } as any : {}),
      },
    ).catch(() => null);
    return !!res?.ok;
  }
}
