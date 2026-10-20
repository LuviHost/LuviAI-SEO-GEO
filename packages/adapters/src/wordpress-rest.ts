import { PublishAdapter } from './base.js';
import type {
  PublishPayload, PublishResult, OnPageMetaPayload, OnPageMetaResult, ImageAltPayload, ImageAltResult, LiveEntryRef, UpdateOptions, UpdateResult,
} from './base.js';
import { patchImgAlt } from './img-alt-patch.js';
import { trimTrailingSlash } from './credential-keys.js';
import { adapterFetch, httpErrorDetail, httpErrorText, sanitizeErrorText } from './transport.js';
import {
  wordPressEditedSince, wordPressEditedText, wordPressGmtToIso, wordPressIdentityProblem, wordPressPostId, wordPressUrlSlug,
} from './wordpress-post-ref.js';

const WP_MISSING_CREDENTIALS = 'WordPress bilgileri eksik — yayın hedefini düzenleyip Site URL, kullanıcı adı ve App Password girin.';

/**
 * Kayit gercekten YOK mu (silinmis)? Yalniz kesin isaret: 410, ya da
 * WordPress'in "gecersiz yazi kimligi" hatasi (404 rest_post_invalid_id —
 * wordpress-develop class-wp-rest-posts-controller.php get_post()). REST
 * API'si kapali / adresi yanlis sitenin 404'u (rest_no_route, HTML sayfa)
 * "silinmis" SAYILMAZ: oyle sayilsaydi yeni yayin acilir, yazi hala
 * yayindaysa ikinci kopya olurdu.
 */
function wpPostGone(status: number, detail: string): boolean {
  return status === 410 || (status === 404 && /"code"\s*:\s*"rest_post_invalid_id"/.test(detail));
}

/**
 * Katalogdaki "Kategori ID" (config.categoryId) → WordPress kategori kimlikleri.
 *
 * NEDEN: alan formda vardi ama adaptor hic gondermiyordu; yazilar hep varsayilan
 * kategoriye dusuyordu. WP REST POST /wp/v2/posts `categories` alani TAMSAYI
 * dizisi bekler (wordpress-develop class-wp-rest-posts-controller.php
 * get_item_schema: 'type' => 'array', 'items' => array( 'type' => 'integer' )).
 * Bos → kategori gonderilmez, WordPress varsayilan kategoriyi kullanir
 * (wp_insert_post: get_option( 'default_category' )).
 *
 * Kabul: 12 · "12" · "12, 15" · "12 15" · [12, "15"]. Kategori ADI (or.
 * "Haberler") gecersizdir: API kayit/guncellemede form alan adiyla reddedilir
 * (publish-targets.service.ts) — kural tek yerde, burada.
 */
export function wordPressCategoryIds(raw: unknown): { ok: true; ids: number[] } | { ok: false; value: string } {
  if (raw === undefined || raw === null) return { ok: true, ids: [] };
  const parts: unknown[] = Array.isArray(raw)
    ? raw
    : typeof raw === 'number'
      ? [raw]
      : typeof raw === 'string'
        ? raw.split(/[\s,;]+/).filter(Boolean)
        : [raw];
  const ids: number[] = [];
  for (const part of parts) {
    const text = typeof part === 'number' ? String(part) : typeof part === 'string' ? part.trim() : '';
    const n = /^\d{1,15}$/.test(text) ? Number(text) : Number.NaN;
    if (!Number.isSafeInteger(n) || n <= 0) {
      return { ok: false, value: sanitizeErrorText(Array.isArray(raw) ? raw.join(',') : raw, 40) };
    }
    if (!ids.includes(n)) ids.push(n);
  }
  return { ok: true, ids };
}

/**
 * WordPress REST API adapter.
 * Auth: Application Password (kullanıcı /wp-admin/profile.php'den oluşturur)
 *
 * Yetenekler:
 *  - publish: yeni post oluşturma
 *  - update: yayındaki postu yerinde güncelleme (adres/durum/yazar/tarih/kategori değişmez)
 *  - applyOnPageMeta: var olan post/page'e Yoast veya RankMath meta yazma
 *
 * SEO plugin tespit:
 *  GET /wp-json/yoast/v1 (Yoast)  veya  /wp-json/rankmath/v1 (RankMath Pro)
 *  ya da meta keylerinin POST gövdesinde update edilmesi (free RankMath dahil çoğu).
 */
export class WordPressRestAdapter extends PublishAdapter {
  /** siteUrl sonundaki "/" atilir: "https://site.com//wp-json" WordPress'te eslesmez */
  private get baseUrl(): string {
    return trimTrailingSlash(String(this.credentials.siteUrl ?? '').trim());
  }

  /**
   * Govde + (verildiyse) one cikan gorsel — publish ve update ORTAK.
   *
   * Hero gorseli verildiyse WP medya kutuphanesine yuklenir ve one cikan gorsel
   * yapilir (liste kucuk resmi + Yoast og:image bundan gelir). One cikan gorseli
   * tema yazinin ustunde zaten gosterir; govdedeki hero <img> kalirsa gorsel
   * iki kez basilir. Bu yuzden govdedeki hero kaldirilir: yeni gorsel
   * yuklendiyse ya da (guncellemede) yazinin zaten bir one cikan gorseli varsa.
   * Ilk yayinda yuklenen gorsel guncellemede yeniden yuklenmez (publisher
   * gorsel baytlarini yalniz YENI hero urettiginde verir) — o yazida govdeye
   * hero eklemek cift gorsel demekti. Guncellemede yazinin zaten bir one cikan
   * gorseli varsa yeni hero YUKLENMEZ: o gorseli musteri WordPress'te kendisi
   * secmis olabilir, ezilmez (medya kutuphanesinde sahipsiz dosya da birikmez).
   */
  private async prepareContent(
    siteUrl: string,
    auth: string,
    payload: PublishPayload,
    opts: { hasFeaturedImage?: boolean } = {},
  ): Promise<{ content: string; featuredMediaId?: number }> {
    let content = payload.bodyHtml;
    let featuredMediaId: number | undefined;

    if (payload.heroImageBase64 && !opts.hasFeaturedImage) {
      try {
        const buf = Buffer.from(payload.heroImageBase64, 'base64');
        const filename = payload.heroImageFilename || 'hero.jpg';
        const mime = payload.heroImageMime || 'image/jpeg';
        const up = await adapterFetch(`${siteUrl}/wp-json/wp/v2/media`, {
          method: 'POST',
          headers: {
            'Authorization': auth,
            'Content-Type': mime,
            'Content-Disposition': `attachment; filename="${filename}"`,
          },
          body: buf,
        });
        if (up.ok) {
          const media: any = await up.json();
          featuredMediaId = Number.isInteger(media?.id) && media.id > 0 ? media.id : undefined;
          // Binary yukleme alt alamaz → ayri istek. Basarisizsa yayini durdurma.
          if (payload.heroImageAlt && featuredMediaId) {
            await adapterFetch(`${siteUrl}/wp-json/wp/v2/media/${featuredMediaId}`, {
              method: 'POST',
              headers: { 'Authorization': auth, 'Content-Type': 'application/json' },
              body: JSON.stringify({ alt_text: payload.heroImageAlt }),
            }).catch(() => {});
          }
        }
      } catch { /* media upload best-effort — yazi yine de yazilir */ }
    }
    if ((featuredMediaId || opts.hasFeaturedImage) && payload.heroImageUrl) {
      const esc = payload.heroImageUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      content = content.replace(new RegExp(`<img[^>]*src=["']${esc}["'][^>]*>`, 'gi'), '');
    }
    // Kalıntı placeholder hero img'lerini her durumda temizle (kırık görsel olmasın)
    content = content.replace(/<img[^>]*placeholder-hero\.webp[^>]*>/gi, '');
    return { content, featuredMediaId };
  }

  /**
   * Yeni yazi olusturur (POST /wp/v2/posts). Sonucta `status`: WordPress'in KAYDETTIGI
   * durum (istenen config.postStatus degil). Yayinci bunu yayin kaydina yazar; "kayitli ?p=
   * adresi herkese acik mi" karari (canlilik denetimi, site haritasi) hedefin sonradan
   * degisebilen ayarina degil bu bilgiye bakar. Iki kaynak (2026-10-18'de okundu):
   *  - developer.wordpress.org/rest-api/reference/posts — "status: A named status for the
   *    post ... Context: view, edit ... One of: publish, future, draft, pending, private".
   *  - wordpress-develop class-wp-rest-posts-controller.php create_item: yazi eklendikten
   *    sonra "$post = get_post( $post_id );", "$request->set_param( 'context', 'edit' );",
   *    prepare_item_for_response ve 201; prepare_item_for_response
   *    "$data['status'] = $post->post_status;". Istenen durum degisebilir: bilinmeyen durum
   *    'draft' olur (handle_status_param), gelecek tarihli 'publish' wp_insert_post'ta 'future' olur.
   */
  async publish(payload: PublishPayload): Promise<PublishResult & Pick<UpdateResult, 'status'>> {
    const { username, appPassword } = this.credentials;
    const siteUrl = this.baseUrl;
    if (!siteUrl || !username || !appPassword) {
      return { ok: false, error: WP_MISSING_CREDENTIALS };
    }
    const auth = `Basic ${Buffer.from(`${username}:${appPassword}`).toString('base64')}`;

    const { content, featuredMediaId } = await this.prepareContent(siteUrl, auth, payload);

    const postBody: Record<string, any> = {
      title: payload.title,
      slug: payload.slug,
      content,
      status: this.config.postStatus ?? 'publish',
      excerpt: payload.metaDescription,
    };
    if (featuredMediaId) postBody.featured_media = featuredMediaId;
    // Gecersiz deger (or. kategori adi) yayini DURDURMAZ: kayitta artik
    // reddediliyor ama eski kayitlarda kalmis olabilir. Alan bugune kadar hic
    // gonderilmedigi icin o hedefler varsayilan kategoriyle yayin yapiyordu;
    // yayinin birden kesilmesi yanlis kategoriden daha buyuk zarar.
    const categories = wordPressCategoryIds(this.config.categoryId);
    if (categories.ok && categories.ids.length > 0) postBody.categories = categories.ids;

    const res = await adapterFetch(`${siteUrl}/wp-json/wp/v2/posts`, {
      method: 'POST',
      headers: { 'Authorization': auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(postBody),
    });
    if (!res.ok) {
      // Govdenin tamami degil: temiz, kisa alinti (ic adres/HTML tasimaz)
      return { ok: false, error: await httpErrorText('WP REST', res) };
    }
    const data: any = await res.json();
    // Olusturma yanitindaki modified_gmt: sonraki yerinde guncelleme "yazi o
    // zamandan beri WordPress'te degisti mi" diye bununla karsilastirir
    const remoteModifiedAt = wordPressGmtToIso(data?.modified_gmt);
    // Olusan yazinin WordPress'teki durumu (yanitta yoksa bilinmiyor: alan hic yazilmaz)
    const status = typeof data?.status === 'string' && data.status ? data.status : undefined;
    return {
      ok: true,
      externalUrl: data.link,
      externalId: String(data.id),
      ...(remoteModifiedAt ? { remoteModifiedAt } : {}),
      ...(status ? { status } : {}),
    };
  }

  /**
   * Yayindaki yaziyi YERINDE gunceller — yeni yazi ACMAZ.
   *
   * Akis:
   *  1. Kimlik: kayitli externalId, yoksa adresteki ?p=; o da yoksa adresteki
   *     slug ile YALNIZ yazilarda (posts) aranir — sayfalara ve on sayfaya
   *     dusulmez (yanlis kaydin icerigi ezilmesin). Slug ile bulunamazsa kesin
   *     "silinmis" denemez (slug degismis olabilir): yeni yazi acilmaz.
   *  2. GET /wp/v2/posts/<id>?context=edit — kayit var mi, durumu ne, duzenleme
   *     yetkisi var mi. Edit baglami yetki yoksa rest_forbidden_context doner
   *     (class-wp-rest-posts-controller.php get_item_permissions_check), yani
   *     guncellenemeyecek kayit POST'tan once anlasilir. 404 rest_post_invalid_id
   *     / 410 → notFound (silinmis; cagiran yeni yazi acabilir).
   *     Kimlik: yanittaki slug (ve tur) BU yaziya ait olmali
   *     (wordPressIdentityProblem) — site tasindiysa / yedekten donulduyse /
   *     hedef baska bir WordPress'e baglandiysa ayni kimlik baska bir yazidir;
   *     tutmazsa mismatch: hicbir sey yazilmaz, notFound da DEGIL (kopya acilmaz).
   *     Cop kutusundaki yazi (status 'trash') → trashed: musteri kaldirmis,
   *     dokunulmaz — cop kutusundaki yaziya yazmak icerigi gorunmez yere yazip
   *     "guncellendi" demekti. Cop kutusu iki kaynakla: REST belgesinde silme
   *     "force: Whether to bypass Trash" (zorlamasiz silme cop kutusuna atar);
   *     kaynakta get_item cop kutusundaki yaziyi reddetmez ve
   *     prepare_item_for_response ham durumu doner ("$data['status'] = $post->post_status;").
   *     Cakisma: yanittaki modified_gmt, kayittaki remoteModifiedAt'ten (yoksa
   *     RanksUp'in son yazim anindan, saat payiyla) farkliysa yazi RanksUp
   *     disinda degismistir → edited: musterinin duzenlemesi EZILMEZ; yalniz
   *     opts.force (kullanicinin acik onayi) ile yazilir (wordPressEditedSince).
   *     Alanlar iki kaynakla: developer.wordpress.org/rest-api/reference/posts/
   *     (slug, type, modified_gmt "view, edit" baglaminda) ve
   *     class-wp-rest-posts-controller.php prepare_item_for_response
   *     ("$data['slug'] = $post->post_name;", "$data['type'] = $post->post_type;").
   *     GET ile POST arasindaki pencere milisaniyelerdir (one cikan gorsel
   *     yuklemesi varsa birkac saniye); REST cekirdegi kosullu guncelleme sunmaz.
   *  3. POST /wp/v2/posts/<id> yalniz title + content + excerpt (yayin yolunun
   *     gonderdigi SEO alani yalniz excerpt = meta aciklama) ve yazinin one
   *     cikan gorseli YOKKEN yeni hero yuklendiyse featured_media. slug / status / author / date / categories
   *     GONDERILMEZ: adres ayni kalir, taslak taslak kalir, yazar ve ilk yayin
   *     tarihi korunur, musterinin sonradan sectigi kategoriler ezilmez.
   *
   * Gonderilmeyen alanin degismedigi iki kaynakla dogrulandi:
   *  - developer.wordpress.org/rest-api/reference/posts/#update-a-post —
   *    "POST /wp/v2/posts/<id>", hicbir arguman zorunlu degil.
   *  - wordpress-develop src/wp-includes/rest-api/endpoints/class-wp-rest-posts-controller.php:
   *    prepare_item_for_database() slug/status/title/content/excerpt'i yalniz
   *    istekte varsa (isset) yazar, author/date'i yalniz bos degilse;
   *    handle_terms() istekte olmayan taksonomiyi atlar ("if ( ! isset(
   *    $request[ $base ] ) ) continue;"), featured_media yalniz isset ise;
   *    update_item() wp_update_post() cagirir ve wp_update_post eski kaydi
   *    yenisiyle birlestirir (post.php: "array_merge( $post, $postarr )").
   *
   * Basarida yanittaki modified_gmt remoteModifiedAt olarak doner (update_item
   * yaniti edit baglaminda hazirlar: "$request->set_param( 'context', 'edit' );").
   */
  async update(ref: LiveEntryRef, payload: PublishPayload, opts: UpdateOptions = {}): Promise<UpdateResult> {
    const { username, appPassword } = this.credentials;
    const siteUrl = this.baseUrl;
    if (!siteUrl || !username || !appPassword) {
      return { ok: false, error: WP_MISSING_CREDENTIALS };
    }
    const auth = `Basic ${Buffer.from(`${username}:${appPassword}`).toString('base64')}`;

    let id = wordPressPostId(ref);
    if (id === null) {
      const slug = wordPressUrlSlug(ref?.externalUrl);
      if (!slug) {
        return { ok: false, error: 'Yayındaki WordPress yazısının kimliği ya da adresi kayıtlı değil; mevcut yazı bulunamadığı için güncellenmedi, kopya da açılmadı.' };
      }
      const found = await this.findBySlug(siteUrl, slug, auth, ['posts'], { status: 'any' });
      if (!found) {
        return { ok: false, error: `Yayındaki WordPress yazısı adresinden bulunamadı (${sanitizeErrorText(slug, 80)}); kopya açmamak için güncellenmedi. Yazı WordPress'te duruyorsa güncel metni oradan elle güncelleyin.` };
      }
      id = found.id;
    }

    const cur = await adapterFetch(`${siteUrl}/wp-json/wp/v2/posts/${id}?context=edit&_fields=id,status,link,slug,type,featured_media,modified_gmt`, {
      headers: { Authorization: auth },
    });
    if (!cur.ok) return this.updateFailure(cur, id);
    const post: any = await cur.json().catch(() => null);
    if (!post || Number(post.id) !== id) {
      return { ok: false, error: 'WP REST yanıtı anlaşılamadı (yazı kaydı gelmedi); yazı güncellenmedi.' };
    }
    const status = typeof post.status === 'string' ? post.status : undefined;
    // Kimlik ONCE: cop kutusundaki ilgisiz bir yazi bu yazinin "cop kutusunda"
    // oldugu sanilmasin (cop kutusu eki "__trashed" eslesmede yok sayilir)
    const identity = wordPressIdentityProblem({ id, type: post.type, slug: post.slug, ref, articleSlug: payload.slug });
    if (identity) {
      return { ok: false, mismatch: true, externalId: String(id), remoteSlug: identity.remoteSlug, ...(status ? { status } : {}), error: identity.error };
    }
    if (status === 'trash') {
      return { ok: false, trashed: true, status, externalId: String(id), error: 'WordPress yazısı çöp kutusunda; güncellenmedi.' };
    }
    const remoteModifiedAt = wordPressGmtToIso(post.modified_gmt);
    if (!opts.force && wordPressEditedSince(remoteModifiedAt, ref)) {
      return {
        ok: false,
        edited: true,
        externalId: String(id),
        ...(status ? { status } : {}),
        ...(remoteModifiedAt ? { remoteModifiedAt } : {}),
        error: wordPressEditedText(remoteModifiedAt),
      };
    }

    const { content, featuredMediaId } = await this.prepareContent(siteUrl, auth, payload, {
      hasFeaturedImage: Number(post.featured_media) > 0,
    });
    const body: Record<string, unknown> = { title: payload.title, content };
    // Ozet bos/eksikse gonderilmez: musterinin elle yazdigi ozet silinmesin
    if (typeof payload.metaDescription === 'string' && payload.metaDescription.trim()) body.excerpt = payload.metaDescription;
    if (featuredMediaId) body.featured_media = featuredMediaId;

    const res = await adapterFetch(`${siteUrl}/wp-json/wp/v2/posts/${id}`, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return this.updateFailure(res, id);
    const data: any = await res.json().catch(() => null);
    // 200 ama yazi kaydi degil (guvenlik eklentisi / onbellek HTML'i): basari sayilmaz
    if (!data || Number(data.id) !== id) {
      return { ok: false, error: 'WP REST yanıtı anlaşılamadı (güncellenen yazı kaydı gelmedi); güncelleme doğrulanamadı.' };
    }
    const link = typeof data.link === 'string' && data.link ? data.link : typeof post.link === 'string' && post.link ? post.link : ref?.externalUrl;
    const written = wordPressGmtToIso(data.modified_gmt);
    return {
      ok: true,
      externalId: String(id),
      externalUrl: link,
      status: typeof data.status === 'string' ? data.status : status,
      ...(written ? { remoteModifiedAt: written } : {}),
    };
  }

  /** Guncellemenin GET/POST hatasi: silinmis mi, yoksa yeni yazi acilmamasi gereken hata mi */
  private async updateFailure(res: Response, id: number): Promise<UpdateResult> {
    const detail = await httpErrorDetail(res);
    const error = detail ? `WP REST ${res.status}: ${detail}` : `WP REST ${res.status}`;
    if (wpPostGone(res.status, detail)) return { ok: false, notFound: true, externalId: String(id), error };
    return { ok: false, error };
  }

  /**
   * Kimlik dogrulayan test: GET /wp-json/wp/v2/users/me, Basic auth (uygulama sifresi).
   *
   * NEDEN: eski test kimliksiz GET /wp-json/wp/v2 atiyordu — yanlis sifrede de
   * "basarili" diyordu, musteri ilk yayinda 401 aliyordu. users/me oturum
   * yoksa 401 rest_not_logged_in doner (wordpress-develop
   * class-wp-rest-users-controller.php get_current_item); Basic auth yalniz
   * uygulama sifresiyle kabul edilir (developer.wordpress.org/rest-api/
   * using-the-rest-api/authentication — WordPress 5.6+).
   *
   * Yonlendirme izlenmez (redirect: 'manual'): http→https ya da www'ye
   * yonlendiren sitede yayin POST'u da yonlendirmeye takilir (korumali fetch
   * govdeli istegi 301/302'de izlemez); baska kokene izlenen GET ise kimlik
   * basligini dusurur ve yaniltici bir 401 alirdi. Yonlendirmede ne
   * yapilacagi soylenir (hata metni panelde aynen gosterilir).
   */
  async test(): Promise<boolean> {
    const { username, appPassword } = this.credentials;
    const siteUrl = this.baseUrl;
    if (!siteUrl || !username || !appPassword) return false;
    const auth = Buffer.from(`${username}:${appPassword}`).toString('base64');
    const res = await adapterFetch(`${siteUrl}/wp-json/wp/v2/users/me`, {
      headers: { Authorization: `Basic ${auth}` },
      redirect: 'manual',
    });
    if (res.status >= 300 && res.status < 400) throw new Error(await httpErrorDetail(res));
    if (!res.ok) {
      // Govde gerekmiyor — baglanti bos yere acik kalmasin
      await res.body?.cancel().catch(() => {});
      return false;
    }
    // Yalniz gercek kullanici kaydi basari sayilir: bilinmeyen adresi 200 ile
    // ana sayfaya ceviren site/onbellek (HTML) "dogrulandi" gostermesin
    const me: any = await res.json().catch(() => null);
    return Number.isInteger(me?.id);
  }

  /** Var olan post/page'e on-page meta yaz (Yoast / RankMath / WP core meta). */
  async applyOnPageMeta(payload: OnPageMetaPayload): Promise<OnPageMetaResult> {
    try {
      return await this.writeOnPageMeta(payload);
    } catch (err: any) {
      // Ag/adres hatasi (korumali fetch: ic adrese yonlendirme, cozulemeyen ad,
      // baglanti hatasi) firlatilmaz: cagiran (snippet uygulayici) yapilandirilmis
      // sonuc bekler ve basarisiz alani kaydeder.
      return { ok: false, applied: [], skipped: [{ field: 'all', reason: sanitizeErrorText(err?.message ?? err) }] };
    }
  }

  private async writeOnPageMeta(payload: OnPageMetaPayload): Promise<OnPageMetaResult> {
    const { username, appPassword } = this.credentials;
    const siteUrl = this.baseUrl;
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
    const updateRes = await adapterFetch(`${siteUrl}/wp-json/wp/v2/${target.type}/${target.id}`, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ meta: metaUpdate }),
    });
    if (!updateRes.ok) {
      return {
        ok: false,
        applied: [],
        skipped: [{ field: 'all', reason: await httpErrorText('WP update', updateRes) }],
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
        const settings = await adapterFetch(`${siteUrl}/wp-json/wp/v2/settings`, { headers: { Authorization: auth } });
        if (settings.ok) {
          const data: any = await settings.json();
          if (data.show_on_front === 'page' && data.page_on_front) {
            const pg = await adapterFetch(`${siteUrl}/wp-json/wp/v2/pages/${data.page_on_front}`, { headers: { Authorization: auth } });
            if (pg.ok) {
              const p: any = await pg.json();
              return { id: p.id, type: 'pages', link: p.link };
            }
          }
        }
      } catch { /* on sayfa cozulemedi — null */ }
      return null;
    }

    return this.findBySlug(siteUrl, slug, auth, ['posts', 'pages']);
  }

  /**
   * Slug → yazi/sayfa (verilen turlerde, sirayla). status verilmezse REST
   * varsayilani gecerli (yalniz yayindakiler — 'publish'); 'any' taslak,
   * zamanlanmis ve ozel yazilari da bulur (duzenleme yetkili kullanici; cop
   * kutusu haric). Kaynak: developer.wordpress.org/rest-api/reference/posts/
   * (List Posts: slug, status varsayilani publish) ve
   * class-wp-rest-posts-controller.php get_collection_params() — status enum'u
   * "array_merge( array_keys( get_post_stati() ), array( 'any' ) )".
   */
  private async findBySlug(
    siteUrl: string,
    slug: string,
    auth: string,
    types: ReadonlyArray<'posts' | 'pages'>,
    opts: { status?: string } = {},
  ): Promise<{ id: number; type: 'posts' | 'pages'; link: string } | null> {
    const status = opts.status ? `&status=${encodeURIComponent(opts.status)}` : '';
    for (const type of types) {
      const res = await adapterFetch(`${siteUrl}/wp-json/wp/v2/${type}?slug=${encodeURIComponent(slug)}${status}`, {
        headers: { Authorization: auth },
      });
      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        continue;
      }
      const arr: any = await res.json().catch(() => null);
      if (Array.isArray(arr) && arr.length > 0 && Number.isInteger(arr[0]?.id)) {
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
        const r = await adapterFetch(url, { signal: AbortSignal.timeout(5000) });
        if (r.status === 200 || r.status === 401) return name;
      } catch { /* eklenti ucu yok ya da zaman asimi — siradakini dene */ }
    }
    // Fallback: anasayfa HTML'inde signature ara
    try {
      const home = await adapterFetch(siteUrl, { signal: AbortSignal.timeout(8000) });
      if (home.ok) {
        const html = await home.text();
        if (/yoast/i.test(html)) return 'yoast';
        if (/rank-math|rankmath/i.test(html)) return 'rankmath';
      }
    } catch { /* anasayfa okunamadi — eklenti yok say */ }
    return 'none';
  }

  /**
   * Gorsel alt metni yaz:
   *  - medya kutuphanesi alt_text (one cikan gorsel, yeni eklemeler bunu kullanir)
   *  - gonderi/sayfa icerigindeki <img alt> (WordPress eklenmis etiketin alt'ini
   *    kutuphaneden GUNCELLEMEZ — ayri duzenleme gerekir; Trac #49165)
   * Icerik yazimi cerrahidir (img-alt-patch) ve iyimser kilitlidir: yazmadan
   * hemen once modified_gmt yeniden okunur, degistiyse yazilmaz.
   */
  async applyImageAlt(p: ImageAltPayload): Promise<ImageAltResult> {
    const { siteUrl, username, appPassword } = this.credentials;
    if (!siteUrl || !username || !appPassword) {
      return { ok: false, applied: [], skipped: [{ field: 'all', reason: 'WP credentials eksik' }] };
    }
    const auth = 'Basic ' + Buffer.from(`${username}:${appPassword}`).toString('base64');
    const base = String(siteUrl).replace(/\/+$/, '');
    const json = { Authorization: auth, 'Content-Type': 'application/json' };
    const applied: string[] = [];
    const skipped: { field: string; reason: string }[] = [];
    const previous: NonNullable<ImageAltResult['previous']> = {};
    let externalUrl: string | undefined;

    if (p.updateMedia) {
      const mediaId = p.wpAttachmentId ?? await this.findMediaId(base, p.src, auth);
      if (!mediaId) {
        skipped.push({ field: 'media_library', reason: 'Medya kutuphanesinde bu gorsel bulunamadi' });
      } else {
        const cur = await adapterFetch(`${base}/wp-json/wp/v2/media/${mediaId}?context=edit&_fields=id,alt_text`, { headers: { Authorization: auth } });
        if (!cur.ok) {
          skipped.push({ field: 'media_library', reason: `WP medya ${cur.status}` });
        } else {
          const m: any = await cur.json();
          const oldAlt = typeof m?.alt_text === 'string' ? m.alt_text : '';
          previous.mediaId = mediaId;
          previous.mediaAlt = oldAlt;
          if (p.expectCurrentAlt !== undefined && oldAlt.trim() !== p.expectCurrentAlt.trim()) {
            skipped.push({ field: 'media_library', reason: 'Alt metni o arada degismis — dokunulmadi' });
          } else if (oldAlt === (p.alt ?? '')) {
            skipped.push({ field: 'media_library', reason: 'Zaten ayni' });
          } else {
            const up = await adapterFetch(`${base}/wp-json/wp/v2/media/${mediaId}`, { method: 'POST', headers: json, body: JSON.stringify({ alt_text: p.alt ?? '' }) });
            if (up.ok) applied.push('media_library');
            else skipped.push({ field: 'media_library', reason: await httpErrorText('WP medya', up, 150) });
          }
        }
      }
    }

    if (p.updateContent) {
      const target = await this.resolvePost(base, p.pageUrl, auth);
      if (!target) {
        skipped.push({ field: 'post_content', reason: 'Bu URL icin WordPress yazisi/sayfasi bulunamadi (ozel icerik turu olabilir)' });
      } else {
        externalUrl = target.link;
        const read = async () => {
          const r = await adapterFetch(`${base}/wp-json/wp/v2/${target.type}/${target.id}?context=edit&_fields=id,content,modified_gmt`, { headers: { Authorization: auth } });
          return r.ok ? (await r.json() as any) : null;
        };
        const post = await read();
        const raw = post?.content?.raw;
        if (typeof raw !== 'string' || !raw) {
          skipped.push({ field: 'post_content', reason: 'Gonderinin ham icerigi okunamadi (sayfa olusturucu olabilir)' });
        } else {
          const patched = patchImgAlt(raw, { srcRaw: p.srcRaw, src: p.src, wpAttachmentId: p.wpAttachmentId }, p.alt, { expectCurrentAlt: p.expectCurrentAlt });
          previous.postId = target.id;
          previous.postType = target.type;
          previous.contentAlt = patched.oldAlt;
          if (!patched.changed) {
            const why: Record<string, string> = {
              not_found: 'Gorsel gonderi iceriginde yok (tema/sayfa olusturucu ekliyor olabilir)',
              ambiguous: 'Ayni adli birden cok gorsel var — hangisi oldugu belirsiz, yazilmadi',
              unchanged: 'Zaten ayni',
              expect_mismatch: 'Alt metni o arada degismis — dokunulmadi',
            };
            skipped.push({ field: 'post_content', reason: why[patched.reason ?? 'not_found'] });
          } else {
            const again = await read();
            if (!again || again.modified_gmt !== post.modified_gmt) {
              skipped.push({ field: 'post_content', reason: 'Gonderi o sirada degisti — yazilmadi, tekrar dene' });
            } else {
              const up = await adapterFetch(`${base}/wp-json/wp/v2/${target.type}/${target.id}`, { method: 'POST', headers: json, body: JSON.stringify({ content: patched.html }) });
              if (up.ok) applied.push('post_content');
              else skipped.push({ field: 'post_content', reason: await httpErrorText('WP', up, 150) });
            }
          }
        }
      }
    }

    return { ok: applied.length > 0, applied, skipped, previous, externalUrl };
  }

  /** Mutlak gorsel URL'i → medya id (orijinal ya da boyutlandirilmis kopya) */
  private async findMediaId(base: string, src: string, auth: string): Promise<number | null> {
    const file = (src.split(/[?#]/)[0].split('/').pop() ?? '').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/-(?:\d+x\d+|scaled)$/i, '');
    if (!file) return null;
    const res = await adapterFetch(`${base}/wp-json/wp/v2/media?search=${encodeURIComponent(file)}&per_page=20&_fields=id,source_url,media_details`, { headers: { Authorization: auth } });
    if (!res.ok) return null;
    const items: any[] = await res.json().catch(() => []);
    const clean = (u: string) => String(u ?? '').split(/[?#]/)[0];
    const want = clean(src);
    const hit = items.find((m) =>
      clean(m?.source_url) === want
      || Object.values(m?.media_details?.sizes ?? {}).some((s: any) => clean(s?.source_url) === want));
    return hit ? Number(hit.id) : null;
  }

  private async coreUpdate(
    siteUrl: string,
    target: { id: number; type: 'posts' | 'pages' },
    body: Record<string, any>,
    auth: string,
  ): Promise<{ ok: boolean; error?: string }> {
    const res = await adapterFetch(`${siteUrl}/wp-json/wp/v2/${target.type}/${target.id}`, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { ok: false, error: await httpErrorText('WP', res, 150) };
    return { ok: true };
  }
}
