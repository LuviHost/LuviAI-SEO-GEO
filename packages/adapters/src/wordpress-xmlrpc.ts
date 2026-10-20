import { PublishAdapter } from './base.js';
import type { PublishPayload, PublishResult, LiveEntryRef, UpdateOptions, UpdateResult } from './base.js';
import { trimTrailingSlash } from './credential-keys.js';
import { adapterFetch, httpErrorDetail, httpErrorText, sanitizeErrorText } from './transport.js';
import { wordPressEditedSince, wordPressEditedText, wordPressGmtToIso, wordPressIdentityProblem, wordPressPostId } from './wordpress-post-ref.js';

/**
 * WordPress XML-RPC (eski sürüm WordPress için)
 * credentials: { siteUrl, username, password }
 * config: { postStatus, categories?, tags? }
 *
 * Yayın: metaWeblog.newPost. Yerinde güncelleme: wp.getPost + wp.editPost.
 * Uygulama sifresi olmayan WP < 5.6 icin (REST hedefi Basic auth'u uygulama
 * sifresiyle yapar — WordPress 5.6+). Uygulama sifresi XML-RPC'de de gecer.
 */

/** XML metin dugumu icin kacis (kullanici adi, sifre, baslik, govde) */
function escapeXml(s: unknown): string {
  return String(s ?? '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' } as Record<string, string>)[c]);
}

/** IXR'in (WordPress XML-RPC sunucusu) kactigi karakterleri geri cevirir — hata metni icin */
function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;|&#0?39;/g, "'").replace(/&amp;/g, '&');
}

/**
 * XML-RPC hata yaniti (<fault>) mi; oyleyse WordPress'in hata metni.
 *
 * NEDEN AYRI: WordPress hatayi HTTP 200 ile doner (IXR_Server::output durum
 * kodu koymaz) — basari/hata ayrimi yalniz govdeden yapilabilir. Hata
 * govdesi faultCode'u <int> icinde tasir (IXR_Error::getXml), metin ise
 * <value><string>...</string></value> icindedir.
 */
function xmlrpcFault(body: string): { code: number | null; message: string } | null {
  if (!/<fault[\s>]/i.test(body)) return null;
  const m = body.match(/<name>\s*faultString\s*<\/name>\s*<value>\s*(?:<string>)?([^<]*)/i);
  const text = m?.[1] ? sanitizeErrorText(unescapeXml(m[1])) : '';
  const c = body.match(/<name>\s*faultCode\s*<\/name>\s*<value>\s*(?:<(?:int|i4)>)?\s*(-?\d+)/i);
  return { code: c ? Number(c[1]) : null, message: text || 'WordPress XML-RPC hata döndürdü' };
}

/**
 * Basarili yanittaki struct'in bir dize uyesi (wp.getPost: post_status, link).
 * IXR dizeyi kacisla yazar (class-IXR-value.php) — geri cevrilir.
 */
function xmlrpcMember(body: string, name: string): string | null {
  const m = body.match(new RegExp(`<member>\\s*<name>\\s*${name}\\s*</name>\\s*<value>\\s*(?:<string>)?([^<]*)`, 'i'));
  return m ? unescapeXml(m[1]).trim() : null;
}

/**
 * Basarili yanittaki struct'in tarih uyesi (wp.getPost: post_modified_gmt) —
 * ham IXR bicimi "20260914T10:00:00". IXR tarihi <dateTime.iso8601> icinde yazar
 * (class-IXR-date.php getXml); dize olarak donen sunucular icin dize de okunur.
 */
function xmlrpcDateMember(body: string, name: string): string | null {
  const m = body.match(new RegExp(`<member>\\s*<name>\\s*${name}\\s*</name>\\s*<value>\\s*<dateTime\\.iso8601>\\s*([^<]*?)\\s*</dateTime\\.iso8601>`, 'i'));
  if (m) return m[1];
  return xmlrpcMember(body, name);
}

/** Basarili yanit tek bir <boolean>1</boolean> mi (wp.editPost `return true;`) */
function xmlrpcTrue(body: string): boolean {
  return /<methodResponse[\s>][\s\S]*?<params>\s*<param>\s*<value>\s*<boolean>\s*1\s*<\/boolean>\s*<\/value>/i.test(body);
}

/**
 * Basarili metodun donus degeri (ilk <param>'in <value>'su) dize/sayi ise o.
 *
 * metaWeblog.newPost yazi kimligini DIZE olarak doner — `return (string) $post_id;`
 * (wordpress-develop src/wp-includes/class-wp-xmlrpc-server.php mw_newPost),
 * IXR bunu <string>123</string> diye yazar (class-IXR-value.php calculateType:
 * is_int degil → 'string'). Turu yazilmamis <value>123</value> da XML-RPC'de dizedir.
 */
function xmlrpcScalarResult(body: string): string | null {
  const params = body.match(/<methodResponse[\s>][\s\S]*?<params>\s*<param>\s*<value>([\s\S]*?)<\/value>\s*<\/param>/i);
  if (!params) return null;
  const inner = params[1].trim();
  const typed = inner.match(/^<(string|int|i4|i8)>\s*([^<]*?)\s*<\/\1>$/i);
  if (typed) return typed[2];
  return /^[^<]*$/.test(inner) ? inner : null;
}

export class WordPressXmlrpcAdapter extends PublishAdapter {
  /** siteUrl sonundaki "/" atilir: "https://site.com//xmlrpc.php" olusmasin */
  private get baseUrl(): string {
    return trimTrailingSlash(String(this.credentials.siteUrl ?? '').trim());
  }

  /**
   * Yeni yazi olusturur (metaWeblog.newPost). metaWeblog.newPost yalniz yazi kimligini doner;
   * olusan yazinin durumu (sonuctaki `status`) ve hedef damgasi yazimdan sonra wp.getPost ile
   * okunur. Durum, istenenden farkli olabilir: mw_newPost content_struct'taki post_status'u
   * yalniz 'draft' / 'pending' / 'private' / 'publish' ise kullanir, degilse publish bayragina
   * duser ("$post_status = $publish ? 'publish' : 'draft';"). Yayinci durumu yayin kaydina
   * yazar ("?p= adresi herkese acik mi" karari ona bakar). Okunamazsa durum bilinmiyor
   * sayilir ve hic yazilmaz (tahmin edilmez). Iki kaynak (2026-10-18'de okundu):
   *  - developer.wordpress.org/reference/classes/wp_xmlrpc_server/mw_newpost ("post_status |
   *    page_status – can be 'draft', 'private', 'publish', or 'pending'"; donus: kimlik) ve
   *    .../wp_getpost (donen alanlar arasinda 'post_status').
   *  - wordpress-develop class-wp-xmlrpc-server.php mw_newPost (yukaridaki switch) ve
   *    _prepare_post: "'post_status' => $post['post_status']" (zamanlanmis 'future' yazi
   *    burada 'publish' bildirilir; RanksUp tarih gondermedigi icin bu yoldan 'future' olusmaz).
   */
  async publish(payload: PublishPayload): Promise<PublishResult & Pick<UpdateResult, 'status'>> {
    const { username, password } = this.credentials;
    const base = this.baseUrl;
    if (!base || !username || !password) {
      return { ok: false, error: 'WordPress XML-RPC bilgileri eksik — yayın hedefini düzenleyip Site URL, kullanıcı ve şifreyi girin.' };
    }

    const xml = this.buildNewPostXml({
      blogId: 1,
      username,
      password,
      title: payload.title,
      content: payload.bodyHtml,
      categories: this.config.categories ?? [],
      tags: this.config.tags ?? [],
      slug: payload.slug,
      excerpt: payload.metaDescription ?? '',
      status: this.config.postStatus ?? 'publish',
    });

    try {
      const res = await adapterFetch(`${base}/xmlrpc.php`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml; charset=UTF-8' },
        body: xml,
      });
      if (!res.ok) {
        return { ok: false, error: await httpErrorText('XML-RPC', res) };
      }
      const body = await res.text();
      // ONCE hata: hata govdesindeki faultCode da <int> tasir (403 → "yazi 403
      // yayinlandi" denirdi). Sonra basari: kimlik <string> icinde gelir — eski
      // kod yalniz <int> aradigi icin olusan yaziyi "basarisiz" sayiyordu.
      const fault = xmlrpcFault(body);
      if (fault) return { ok: false, error: `XML-RPC: ${fault.message}` };
      const postId = xmlrpcScalarResult(body);
      if (!postId || !/^\d+$/.test(postId)) {
        return { ok: false, error: `XML-RPC yanıtı anlaşılamadı: ${sanitizeErrorText(body, 120) || 'boş yanıt'}` };
      }
      // metaWeblog.newPost yalniz kimlik doner; sonraki yerinde guncellemenin
      // cakisma denetimi icin olusturma aninin hedef damgasi (post_modified_gmt)
      // ve olusan yazinin durumu (post_status) wp.getPost ile okunur. Okunamazsa
      // yayin yine basarilidir: denetim RanksUp'in yazim anina saat payiyla duser,
      // durum bilinmiyor sayilir.
      const after = await this.readAfterWrite(base, username, password, Number(postId));
      return {
        ok: true,
        // Adres WordPress'in bildirdigi kalici baglanti (wp.getPost link = get_permalink), update()
        // ile ayni kural. NEDEN: kayit duz ?p= adresini tutuyordu; site haritasi, llms, persona ve
        // canonical yazinin kanonik adresi yerine kalici baglantiya YONLENEN ?p= adresini ilan
        // ediyordu. Taslak yine guvende: ilan karari kayittaki durumdan (status → remoteStatus)
        // verilir; WordPress 5.7+ taslaga zaten duz baglanti verir. Okunamazsa eskisi gibi ?p=.
        externalUrl: after.link || `${base}/?p=${postId}`,
        externalId: postId,
        ...(after.remoteModifiedAt ? { remoteModifiedAt: after.remoteModifiedAt } : {}),
        ...(after.status ? { status: after.status } : {}),
      };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  /**
   * Yayindaki yaziyi YERINDE gunceller: wp.getPost ile varlik/durum, sonra
   * wp.editPost ile yalniz post_title, post_content ve (verildiyse)
   * post_excerpt. Yeni yazi ACMAZ.
   *
   * NEDEN wp.editPost (metaWeblog.editPost degil): metaWeblog.editPost'un
   * "publish" bayragi durumu zorlar — wordpress-develop
   * src/wp-includes/class-wp-xmlrpc-server.php mw_editPost:
   * "$post_status = $publish ? 'publish' : 'draft';" (taslagi yayina alir ya da
   * yayindaki yaziyi taslaga ceker). wp.editPost ise yalniz verilen alanlari
   * degistirir, gerisi (durum, slug, yazar, tarih, terimler, one cikan gorsel)
   * oldugu gibi kalir. Iki kaynak:
   *  - developer.wordpress.org/reference/classes/wp_xmlrpc_server/wp_editpost/ —
   *    "The $content_struct parameter only needs to contain fields that should
   *    be changed. All other fields will retain their existing values."
   *  - class-wp-xmlrpc-server.php wp_editPost: get_post( $post_id, ARRAY_A ),
   *    kayit yoksa IXR_Error( 404, 'Invalid post ID.' ), sonra
   *    "array_merge( $post, $content_struct )" → _insert_post (terimler yalniz
   *    istekte terms/terms_names varsa yazilir), basarida "return true;".
   * wp.getPost (ayni dosya + .../wp_getpost/ referansi): kayit yoksa 404
   * "Invalid post ID.", duzenleme yetkisi yoksa 401; yanitta post_status ve
   * link (get_permalink) var. Cop kutusundaki yazi (post_status 'trash')
   * guncellenmez: wp.editPost onu da guncellerdi (durum korunur), icerik
   * gorunmez yere yazilip "guncellendi" denirdi.
   *
   * Yayin yolu (metaWeblog.newPost) one cikan gorsel koymadigi icin guncelleme
   * de koymaz. Kimlik yalniz externalId ya da adresteki ?p= ile bulunur:
   * XML-RPC'de slug ile yazi arama yok — tahminle yanlis yaziyi ezmeyiz.
   *
   * Yazmadan once (REST ile ayni kural, wordpress-post-ref.ts):
   *  - Kimlik: wp.getPost post_type 'post' ve post_name bu yazinin slug'i
   *    olmali. wp.getPost / wp.editPost TURE BAKMAZ: kayitli kimlik bir sayfaya
   *    (on sayfa dahil) kaymissa onu ezerdi. Tutmazsa mismatch, hicbir sey yazilmaz.
   *  - Cakisma: post_modified_gmt RanksUp'in son yaziminden sonra degistiyse
   *    edited (yalniz opts.force ile yazilir). wp.editPost'a ayrica okunan damga
   *    if_not_modified_since olarak verilir: okuma ile yazma arasinda yazi
   *    degisirse WordPress 409 doner ve yazilmaz. Iki kaynak:
   *    developer.wordpress.org/reference/classes/wp_xmlrpc_server/wp_editpost/
   *    ve class-wp-xmlrpc-server.php wp_editPost: "if ( mysql2date( 'U',
   *    $post['post_modified_gmt'] ) > $content_struct['if_not_modified_since']
   *    ->getTimestamp() ) { return new IXR_Error( 409, ... ); }". IXR_Date
   *    getTimestamp() mktime kullanir; WordPress saat dilimini UTC'ye sabitler
   *    (wp-settings.php "date_default_timezone_set( 'UTC' );") — GMT damga dogru kiyaslanir.
   *  Alanlar: _prepare_post 'post_name', 'post_type', 'post_modified_gmt'
   *  (developer.wordpress.org/reference/classes/wp_xmlrpc_server/_prepare_post/
   *  ve ayni kaynak dosya).
   * Basarida yaziminin hedef damgasi wp.getPost ile yeniden okunur (remoteModifiedAt).
   */
  async update(ref: LiveEntryRef, payload: PublishPayload, opts: UpdateOptions = {}): Promise<UpdateResult> {
    const { username, password } = this.credentials;
    const base = this.baseUrl;
    if (!base || !username || !password) {
      return { ok: false, error: 'WordPress XML-RPC bilgileri eksik — yayın hedefini düzenleyip Site URL, kullanıcı ve şifreyi girin.' };
    }
    const id = wordPressPostId(ref);
    if (id === null) {
      return { ok: false, error: 'Yayındaki WordPress yazısının kimliği kayıtlı değil; XML-RPC mevcut yazıyı yalnız kimliğiyle bulabildiği için güncellenmedi, kopya da açılmadı.' };
    }
    try {
      const got = await this.rpc(base, this.buildGetPostXml(username, password, id, ['post_status', 'link', 'post_name', 'post_type', 'post_modified_gmt']));
      if (got.kind !== 'ok') return this.rpcFailure(got, id);
      const status = xmlrpcMember(got.body, 'post_status');
      if (!status) {
        return { ok: false, error: `XML-RPC yanıtı anlaşılamadı: ${sanitizeErrorText(got.body, 120) || 'boş yanıt'}` };
      }
      const identity = wordPressIdentityProblem({
        id,
        type: xmlrpcMember(got.body, 'post_type') ?? undefined,
        slug: xmlrpcMember(got.body, 'post_name') ?? '',
        ref,
        articleSlug: payload.slug,
      });
      if (identity) {
        return { ok: false, mismatch: true, externalId: String(id), remoteSlug: identity.remoteSlug, status, error: identity.error };
      }
      if (status === 'trash') {
        return { ok: false, trashed: true, status, externalId: String(id), error: 'WordPress yazısı çöp kutusunda; güncellenmedi.' };
      }
      const rawModified = xmlrpcDateMember(got.body, 'post_modified_gmt');
      const remoteModifiedAt = wordPressGmtToIso(rawModified);
      if (!opts.force && wordPressEditedSince(remoteModifiedAt, ref)) {
        return { ok: false, edited: true, externalId: String(id), status, ...(remoteModifiedAt ? { remoteModifiedAt } : {}), error: wordPressEditedText(remoteModifiedAt) };
      }

      const edited = await this.rpc(base, this.buildEditPostXml(username, password, id, {
        title: payload.title,
        content: payload.bodyHtml,
        excerpt: payload.metaDescription,
        // Ham IXR damgasi aynen geri verilir (sifir tarih "…Z" ise kosul konmaz)
        ifNotModifiedSince: remoteModifiedAt && rawModified && /^\d{8}T\d{2}:\d{2}:\d{2}$/.test(rawModified) ? rawModified : undefined,
      }));
      if (edited.kind === 'fault' && edited.code === 409) {
        // Okuma ile yazma arasinda yazi WordPress'te degisti: yazilmadi
        return { ok: false, edited: true, externalId: String(id), status, ...(remoteModifiedAt ? { remoteModifiedAt } : {}), error: wordPressEditedText(null) };
      }
      if (edited.kind !== 'ok') return this.rpcFailure(edited, id);
      if (!xmlrpcTrue(edited.body)) {
        return { ok: false, error: `XML-RPC yanıtı anlaşılamadı: ${sanitizeErrorText(edited.body, 120) || 'boş yanıt'}` };
      }
      const after = await this.readAfterWrite(base, username, password, id);
      const link = after.link || xmlrpcMember(got.body, 'link');
      return {
        ok: true,
        externalId: String(id),
        externalUrl: link || `${base}/?p=${id}`,
        status,
        ...(after.remoteModifiedAt ? { remoteModifiedAt: after.remoteModifiedAt } : {}),
      };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  }

  /**
   * Yazimdan sonra yazinin hedef damgasi, adresi ve durumu (wp.getPost). En iyi caba:
   * hata yaziminin sonucunu degistirmez (yazi zaten yazildi).
   */
  private async readAfterWrite(
    base: string,
    username: unknown,
    password: unknown,
    id: number,
  ): Promise<{ remoteModifiedAt: string | null; link: string | null; status: string | null }> {
    try {
      const got = await this.rpc(base, this.buildGetPostXml(username, password, id, ['post_modified_gmt', 'link', 'post_status']));
      if (got.kind !== 'ok') return { remoteModifiedAt: null, link: null, status: null };
      return {
        remoteModifiedAt: wordPressGmtToIso(xmlrpcDateMember(got.body, 'post_modified_gmt')),
        link: xmlrpcMember(got.body, 'link') || null,
        status: xmlrpcMember(got.body, 'post_status') || null,
      };
    } catch {
      return { remoteModifiedAt: null, link: null, status: null };
    }
  }

  /** Tek XML-RPC cagrisi: HTTP hatasi, <fault> ya da basarili govde */
  private async rpc(base: string, xml: string): Promise<
    { kind: 'ok'; body: string } | { kind: 'fault'; code: number | null; message: string } | { kind: 'http'; error: string }
  > {
    const res = await adapterFetch(`${base}/xmlrpc.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=UTF-8' },
      body: xml,
    });
    if (!res.ok) return { kind: 'http', error: await httpErrorText('XML-RPC', res) };
    const body = await res.text();
    // WordPress hatayi HTTP 200 + <fault> ile doner (IXR_Server::output)
    const fault = xmlrpcFault(body);
    if (fault) return { kind: 'fault', code: fault.code, message: fault.message };
    return { kind: 'ok', body };
  }

  /** 404 "Invalid post ID." → silinmis (notFound); diger hatalarda yeni yazi acilmamali */
  private rpcFailure(r: { kind: 'fault'; code: number | null; message: string } | { kind: 'http'; error: string }, id: number): UpdateResult {
    if (r.kind === 'http') return { ok: false, error: r.error };
    const error = `XML-RPC: ${r.message}`;
    return r.code === 404 ? { ok: false, notFound: true, externalId: String(id), error } : { ok: false, error };
  }

  private buildGetPostXml(username: unknown, password: unknown, postId: number, fields: readonly string[]): string {
    // Yalniz gereken alanlar (_prepare_post: istenen anahtarlar array_intersect_key ile suzulur)
    const values = fields.map((f) => `      <value><string>${escapeXml(f)}</string></value>`).join('\n');
    return `<?xml version="1.0"?>
<methodCall>
  <methodName>wp.getPost</methodName>
  <params>
    <param><value><int>1</int></value></param>
    <param><value><string>${escapeXml(username)}</string></value></param>
    <param><value><string>${escapeXml(password)}</string></value></param>
    <param><value><int>${postId}</int></value></param>
    <param><value><array><data>
${values}
    </data></array></value></param>
  </params>
</methodCall>`;
  }

  /**
   * wp.editPost govdesi — YALNIZ baslik, icerik ve (verildiyse) ozet; okunan
   * damga verildiyse if_not_modified_since (yazi o arada degistiyse WordPress
   * 409 doner, yazmaz). Ozet bos/eksikse gonderilmez: musterinin elle yazdigi
   * ozet silinmesin.
   */
  private buildEditPostXml(
    username: unknown,
    password: unknown,
    postId: number,
    p: { title: string; content: string; excerpt?: string; ifNotModifiedSince?: string },
  ): string {
    const excerpt = typeof p.excerpt === 'string' && p.excerpt.trim()
      ? `\n      <member><name>post_excerpt</name><value><string>${escapeXml(p.excerpt)}</string></value></member>`
      : '';
    const guard = p.ifNotModifiedSince
      ? `\n      <member><name>if_not_modified_since</name><value><dateTime.iso8601>${escapeXml(p.ifNotModifiedSince)}</dateTime.iso8601></value></member>`
      : '';
    return `<?xml version="1.0"?>
<methodCall>
  <methodName>wp.editPost</methodName>
  <params>
    <param><value><int>1</int></value></param>
    <param><value><string>${escapeXml(username)}</string></value></param>
    <param><value><string>${escapeXml(password)}</string></value></param>
    <param><value><int>${postId}</int></value></param>
    <param><value><struct>
      <member><name>post_title</name><value><string>${escapeXml(p.title)}</string></value></member>
      <member><name>post_content</name><value><string>${escapeXml(p.content)}</string></value></member>${excerpt}${guard}
    </struct></value></param>
  </params>
</methodCall>`;
  }

  /**
   * Kimlik dogrulayan test: wp.getUsersBlogs(kullanici, sifre).
   *
   * NEDEN POST: WordPress XML-RPC sunucusu POST disindaki istege 405 doner
   * (class-IXR-server.php serve(): status_header( 405 ), "XML-RPC server accepts
   * POST requests only.") — eski GET testi calisan sitede de basarisizdi.
   * wp.getUsersBlogs giris yapar: yanlis kimlikte 403 "Incorrect username or
   * password.", XML-RPC kapaliysa 405 "XML-RPC services are disabled on this
   * site." hatasi (<fault>) HTTP 200 ile gelir (class-wp-xmlrpc-server.php login()).
   * Basari yalniz gecerli bir <methodResponse><params> ile sayilir: xmlrpc.php'yi
   * engelleyip 200 HTML donen guvenlik eklentisi "basarili" gorunmesin.
   */
  async test(): Promise<boolean> {
    const { username, password } = this.credentials;
    const base = this.baseUrl;
    if (!base || !username || !password) return false;
    const res = await adapterFetch(`${base}/xmlrpc.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=UTF-8' },
      body: this.buildGetUsersBlogsXml(username, password),
    });
    if (res.status >= 300 && res.status < 400) {
      // Govdeli istek yonlendirmede izlenmez (yayin da ayni yere takilir):
      // "basarisiz" yerine ne yapilacagi soylenir
      throw new Error(await httpErrorDetail(res));
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return false;
    }
    const body = await res.text();
    return !xmlrpcFault(body) && /<methodResponse[\s>]/i.test(body) && /<params[\s>]/i.test(body);
  }

  private buildGetUsersBlogsXml(username: unknown, password: unknown): string {
    return `<?xml version="1.0"?>
<methodCall>
  <methodName>wp.getUsersBlogs</methodName>
  <params>
    <param><value><string>${escapeXml(username)}</string></value></param>
    <param><value><string>${escapeXml(password)}</string></value></param>
  </params>
</methodCall>`;
  }

  private buildNewPostXml(p: any): string {
    return `<?xml version="1.0"?>
<methodCall>
  <methodName>metaWeblog.newPost</methodName>
  <params>
    <param><value><int>${p.blogId}</int></value></param>
    <param><value><string>${escapeXml(p.username)}</string></value></param>
    <param><value><string>${escapeXml(p.password)}</string></value></param>
    <param><value><struct>
      <member><name>title</name><value><string>${escapeXml(p.title)}</string></value></member>
      <member><name>description</name><value><string>${escapeXml(p.content)}</string></value></member>
      <member><name>mt_excerpt</name><value><string>${escapeXml(p.excerpt)}</string></value></member>
      <member><name>wp_slug</name><value><string>${escapeXml(p.slug)}</string></value></member>
      <member><name>post_status</name><value><string>${escapeXml(p.status)}</string></value></member>
    </struct></value></param>
    <param><value><boolean>${p.status === 'publish' ? 1 : 0}</boolean></value></param>
  </params>
</methodCall>`;
  }
}
