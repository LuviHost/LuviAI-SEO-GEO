import { Injectable, Logger } from '@nestjs/common';

export interface SubmitResult {
  ok: boolean;
  itemId?: string;
  url?: string;
  error?: string;
  warning?: string;
}

/**
 * Knowledge Submitter — Wikidata/Wikipedia'ya manuel onay sonrasi otomatik
 * submit eder.
 *
 * Wikidata: oauth2 + MediaWiki API (https://www.wikidata.org/w/api.php)
 *   - Yeni item: action=wbeditentity new=item
 *   - Claims: action=wbcreateclaim
 *
 * Wikipedia: ayni MediaWiki API (https://tr.wikipedia.org/w/api.php)
 *   - Page create: action=edit createonly=1
 *
 * NOT: Bot account gerekli (env: WIKIDATA_BOT_USER + WIKIDATA_BOT_PASS).
 *      Yoksa endpoint warning doner, kullanici manuel kopyalar.
 */
@Injectable()
export class KnowledgeSubmitterService {
  private readonly log = new Logger(KnowledgeSubmitterService.name);

  async submitWikidata(draft: any): Promise<SubmitResult> {
    const user = process.env.WIKIDATA_BOT_USER;
    const pass = process.env.WIKIDATA_BOT_PASS;
    if (!user || !pass) {
      return {
        ok: false,
        warning: 'WIKIDATA_BOT_USER/PASS env yok. Manuel olarak Special:NewItem sayfasina kopyalayin.',
      };
    }

    try {
      // 1. Login token al
      const tokenRes = await fetch('https://www.wikidata.org/w/api.php?action=query&meta=tokens&type=login&format=json', {
        signal: AbortSignal.timeout(10000),
      });
      const tokenData = await tokenRes.json() as any;
      const loginToken = tokenData?.query?.tokens?.logintoken;
      if (!loginToken) throw new Error('Login token alinamadi');

      // 2. Login
      const cookies: string[] = [];
      const loginRes = await fetch('https://www.wikidata.org/w/api.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          action: 'login',
          lgname: user,
          lgpassword: pass,
          lgtoken: loginToken,
          format: 'json',
        }),
      });
      const setCookie = loginRes.headers.get('set-cookie');
      if (setCookie) cookies.push(setCookie);
      const loginData = await loginRes.json() as any;
      if (loginData?.login?.result !== 'Success') {
        return { ok: false, error: `Login fail: ${loginData?.login?.reason ?? 'unknown'}` };
      }

      // 3. CSRF token
      const csrfRes = await fetch('https://www.wikidata.org/w/api.php?action=query&meta=tokens&format=json', {
        headers: { 'Cookie': cookies.join('; ') },
      });
      const csrfData = await csrfRes.json() as any;
      const csrfToken = csrfData?.query?.tokens?.csrftoken;
      if (!csrfToken) throw new Error('CSRF token alinamadi');

      // 4. Item olustur
      const data = {
        labels: draft.labels,
        descriptions: draft.descriptions,
        aliases: {},
      };
      const createRes = await fetch('https://www.wikidata.org/w/api.php', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Cookie': cookies.join('; '),
        },
        body: new URLSearchParams({
          action: 'wbeditentity',
          new: 'item',
          token: csrfToken,
          data: JSON.stringify(data),
          format: 'json',
        }),
      });
      const createData = await createRes.json() as any;
      if (createData?.error) throw new Error(createData.error.info ?? 'create fail');
      const itemId = createData?.entity?.id;

      // Claims ekle (best-effort)
      // Production'da her claim icin ayri call gerekiyor; MVP'de skip + manuel onay

      return {
        ok: true,
        itemId,
        url: `https://www.wikidata.org/wiki/${itemId}`,
        warning: 'Item olusturuldu. Claim\'leri manuel ekleyin (P31, P856 vs.) — bot bunu desteklemiyor.',
      };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  async submitWikipedia(draft: any, lang: 'tr' | 'en' = 'tr'): Promise<SubmitResult> {
    return {
      ok: false,
      warning: 'Wikipedia auto-submit suanda destek dısı — yeni makaleler manuel onay gerektirir, otomatik bot reddedilir. "Wikipedia\'da Olustur" butonuna manuel tiklayin.',
    };
  }
}
