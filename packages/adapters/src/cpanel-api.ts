import { PublishAdapter } from './base.js';
import type { PublishPayload, PublishResult } from './base.js';
import { adapterFetch, httpErrorDetail, httpErrorText, sanitizeErrorText } from './transport.js';

/*
 * TLS DOGRULAMASI ACIK. Eski kod undici'yi dinamik import edip
 * rejectUnauthorized:false bir Agent kurmak istiyordu; ama undici bu paketin
 * bagimliligi degil ve packages/adapters'tan cozulemiyor (pnpm hoist etmiyor):
 * import her seferinde sessizce dusup global fetch'e geciliyordu, yani uretimde
 * dogrulama hep acikti. O olu yol kaldirildi. Kimlik bilgisi (API token)
 * tasiyan istekte dogrulamayi kapatmak araya giren birine token'i verir;
 * bilerek kapatilmadi. Istekler adapterFetch'ten gecer — API kayitliyken
 * yonlendirme ve ic adres denetimi oradadir (transport.ts).
 */

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
      `Content-Disposition: form-data; name="overwrite"`,
      '',
      '1',
      `--${boundary}`,
      `Content-Disposition: form-data; name="file-1"; filename="${filename}"`,
      'Content-Type: text/html; charset=utf-8',
      '',
      payload.bodyHtml,
      `--${boundary}--`,
      '',
    ].join('\r\n');

    try {
      const res = await adapterFetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `cpanel ${username}:${apiToken}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body,
      });

      if (!res.ok) {
        const detail = await httpErrorDetail(res);
        return {
          ok: false,
          error: `cPanel HTTP ${res.status} (${url})${detail ? `: ${detail}` : ''}`,
        };
      }
      const data: any = await res.json();
      if (data.status !== 1) {
        return { ok: false, error: `cPanel API hata: ${sanitizeErrorText(data.errors?.[0] ?? JSON.stringify(data))}` };
      }

      // Public URL: configurable publicBaseUrl varsa onu kullan; yoksa host'tan tahmin et.
      // .html uzantisi son URL'de gizlenir (Apache MultiViews / .htaccess rewrite varsayar).
      const publicBase = String(this.config.publicBaseUrl ?? '').trim().replace(/\/+$/, '')
        || `https://${new URL(host).hostname.replace(':2083', '').replace(/^cpanel\./, '')}`;
      const cleanPath = remotePath.replace(/^public_html\/?/, '').replace(/\/+$/, '');
      const slugOnly = filename.replace(/\.html?$/i, '');
      const externalUrl = `${publicBase}${cleanPath ? '/' + cleanPath : ''}/${slugOnly}`;
      return { ok: true, externalUrl, externalId: filename };
    } catch (err: any) {
      // undici 'fetch failed' altinda gercek sebep err.cause'da
      const cause = err?.cause;
      const causeMsg = cause?.code ? `${cause.code}: ${cause.message ?? ''}` : (cause?.message ?? '');
      // Baglanti hatasi adresi tasiyabilir (ECONNREFUSED a.b.c.d:2083) — maskelenir
      const detail = sanitizeErrorText([err.message, causeMsg].filter(Boolean).join(' | '), 300);
      return {
        ok: false,
        error: `cPanel baglanti hatasi (${url}): ${detail}. Kontrol et: host URL https:// + port 2083 ile mi? SSL gecerli mi? cPanel servisine ulasilabiliyor mu?`,
      };
    }
  }

  /** Diske gercek .html dosyasi yazar — tam sayfa gerekir. */
  get needsFullPage(): boolean { return true; }

  get supportsRootFiles(): boolean { return true; }

  /**
   * Web root'a ham dosya yazar (robots.txt / llms.txt / sitemap.xml).
   * config.rootPath = web kök dizini (varsayılan "public_html").
   */
  async putRootFile(filename: string, content: string, contentType = 'text/plain; charset=utf-8'): Promise<PublishResult> {
    const host = this.credentials.host ?? this.credentials.cpanelUrl;
    const { username, apiToken } = this.credentials;
    let rootPath = String(this.config.rootPath ?? 'public_html').replace(/^\/+/, '').replace(/\/+$/, '');
    if (!rootPath) rootPath = 'public_html';

    if (!host || !username || !apiToken) {
      return { ok: false, error: `cPanel credentials eksik: host=${!!host}, username=${!!username}, apiToken=${!!apiToken}.` };
    }

    const url = `${host.replace(/\/$/, '')}/execute/Fileman/upload_files`;
    const boundary = `----LuviAIBoundary${Date.now()}`;
    const body = [
      `--${boundary}`,
      `Content-Disposition: form-data; name="dir"`,
      '',
      rootPath,
      `--${boundary}`,
      `Content-Disposition: form-data; name="overwrite"`,
      '',
      '1',
      `--${boundary}`,
      `Content-Disposition: form-data; name="file-1"; filename="${filename}"`,
      `Content-Type: ${contentType}`,
      '',
      content,
      `--${boundary}--`,
      '',
    ].join('\r\n');

    try {
      const res = await adapterFetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `cpanel ${username}:${apiToken}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body,
      });
      if (!res.ok) {
        return { ok: false, error: await httpErrorText('cPanel HTTP', res) };
      }
      const data: any = await res.json();
      if (data.status !== 1) {
        return { ok: false, error: `cPanel API hata: ${sanitizeErrorText(data.errors?.[0] ?? JSON.stringify(data))}` };
      }
      const publicBase = String(this.config.publicBaseUrl ?? '').trim().replace(/\/+$/, '')
        || `https://${new URL(host).hostname.replace(':2083', '').replace(/^cpanel\./, '')}`;
      return { ok: true, externalUrl: `${publicBase}/${filename}`, externalId: filename };
    } catch (err: any) {
      const cause = err?.cause;
      const causeMsg = cause?.code ? `${cause.code}: ${cause.message ?? ''}` : (cause?.message ?? '');
      return { ok: false, error: `cPanel bağlantı hatası: ${sanitizeErrorText([err.message, causeMsg].filter(Boolean).join(' | '), 300)}` };
    }
  }

  async test(): Promise<boolean> {
    const host = this.credentials.host ?? this.credentials.cpanelUrl;
    const { username, apiToken } = this.credentials;
    if (!host || !username || !apiToken) return false;
    const res = await adapterFetch(
      `${host.replace(/\/$/, '')}/execute/Variables/get_user_information`,
      { headers: { 'Authorization': `cpanel ${username}:${apiToken}` } },
    ).catch(() => null);
    return !!res?.ok;
  }
}
