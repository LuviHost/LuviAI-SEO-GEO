import { PublishAdapter } from './base.js';
import type { PublishPayload, PublishResult } from './base.js';

// undici.fetch + Agent({ rejectUnauthorized: false })
// Node'un native fetch'i (Web Fetch standardina sadik) `dispatcher` option'i
// kabul ETMIYOR -> ayar sessizce ignore ediliyordu, TLS dogrulamasi devam ediyordu.
// Bu yuzden undici'yi DOGRUDAN import edip onun fetch'ini kullaniyoruz —
// dispatcher option'i sadece undici.fetch'te calisir.
let undiciCache: { fetch: any; agent: any } | null = null;
async function getUndiciFetch() {
  if (undiciCache) return undiciCache;
  try {
    // @ts-ignore — undici Node 18+ built-in modul, @types/node tip tanimi vermiyor
    const undici: any = await import('undici');
    undiciCache = {
      fetch: undici.fetch,
      agent: new undici.Agent({ connect: { rejectUnauthorized: false, checkServerIdentity: () => undefined } }),
    };
  } catch {
    undiciCache = null;
  }
  return undiciCache;
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
      const undici = await getUndiciFetch();
      const fetchFn = undici?.fetch ?? fetch;
      const fetchOpts: any = {
        method: 'POST',
        headers: {
          'Authorization': `cpanel ${username}:${apiToken}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body,
      };
      if (undici?.agent) fetchOpts.dispatcher = undici.agent;
      const res = await fetchFn(url, fetchOpts);

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
    const undici = await getUndiciFetch();
    const fetchFn = undici?.fetch ?? fetch;
    const opts: any = { headers: { 'Authorization': `cpanel ${username}:${apiToken}` } };
    if (undici?.agent) opts.dispatcher = undici.agent;
    const res = await fetchFn(
      `${host.replace(/\/$/, '')}/execute/Variables/get_user_information`,
      opts,
    ).catch(() => null);
    return !!res?.ok;
  }
}
