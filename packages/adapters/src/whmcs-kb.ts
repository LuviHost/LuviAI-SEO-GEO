import { PublishAdapter } from './base.js';
import type { PublishPayload, PublishResult } from './base.js';
import { adapterFetch, httpErrorText, sanitizeErrorText } from './transport.js';
import { pickString, trimTrailingSlash } from './credential-keys.js';

/**
 * WHMCS Knowledgebase adapter.
 * credentials: { baseUrl | whmcsUrl, apiIdentifier | identifier,
 *   apiSecret | secret, accessKey? } — once panel katalogu adlari, sonra eski
 *   adlar (bkz. credential-keys.ts)
 * config: { categoryId, useseo?: 1, published?: 1 }
 *
 * WHMCS API: AddKBArticle action
 * Docs: https://developers.whmcs.com/api-reference/addkbarticle/
 *
 * accessKey: WHMCS API varsayilan olarak IP ile kisitlidir; IP izni
 * verilemiyorsa configuration.php'deki $api_access_key her istekte
 * 'accesskey' parametresiyle gonderilir
 * (https://developers.whmcs.com/api/access-control/).
 */
export class WhmcsKbAdapter extends PublishAdapter {
  async publish(payload: PublishPayload): Promise<PublishResult> {
    const { categoryId = 1, useseo = 1, published = 1 } = this.config;

    let auth: WhmcsAuth;
    try {
      auth = this.auth();
    } catch (err: any) {
      return { ok: false, error: err.message };
    }

    const params = new URLSearchParams({
      action: 'AddKBArticle',
      identifier: auth.identifier,
      secret: auth.secret,
      title: payload.title,
      article: payload.bodyHtml,
      categoryid: String(categoryId),
      useseo: String(useseo),
      published: String(published),
      responsetype: 'json',
    });
    if (auth.accessKey) params.append('accesskey', auth.accessKey);

    try {
      const res = await adapterFetch(`${auth.base}/includes/api.php`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });

      // Yonlendirme (govdeli istek izlenmez) — JSON diye ayristirilmaz
      if (res.status >= 300 && res.status < 400) {
        return { ok: false, error: await httpErrorText('WHMCS', res) };
      }
      const data: any = await res.json();
      if (data.result !== 'success') {
        // WHMCS hata mesaji (or. "Invalid IP 1.2.3.4") — kisa ve adres maskeli
        return { ok: false, error: sanitizeErrorText(data.message ?? 'WHMCS API error') };
      }

      return {
        ok: true,
        externalUrl: `${auth.base}/index.php?rp=/knowledgebase/${data.articleid}`,
        externalId: String(data.articleid),
      };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  /** Salt okunur cagri (GetActivityLog, tek kayit) — kimlik + IP/erisim anahtari dogrulanir */
  async test(): Promise<boolean> {
    try {
      const auth = this.auth();
      const params = new URLSearchParams({
        action: 'GetActivityLog',
        identifier: auth.identifier,
        secret: auth.secret,
        limitnum: '1',
        responsetype: 'json',
      });
      // publish ile ayni kural: IP kisitini erisim anahtariyla asan kurulumda
      // anahtarsiz test her zaman "Invalid IP" donerdi
      if (auth.accessKey) params.append('accesskey', auth.accessKey);
      const res = await adapterFetch(`${auth.base}/includes/api.php`, {
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

  private auth(): WhmcsAuth {
    const url = pickString(this.credentials, 'baseUrl', 'whmcsUrl');
    const identifier = pickString(this.credentials, 'apiIdentifier', 'identifier');
    const secret = pickString(this.credentials, 'apiSecret', 'secret');
    if (!url || !identifier || !secret) {
      throw new Error('WHMCS URL, API Identifier ve API Secret zorunlu — yayın hedefini düzenleyip eksik alanı girin.');
    }
    return {
      base: trimTrailingSlash(url),
      identifier,
      secret,
      accessKey: pickString(this.credentials, 'accessKey'),
    };
  }
}

interface WhmcsAuth {
  base: string;
  identifier: string;
  secret: string;
  accessKey?: string;
}
