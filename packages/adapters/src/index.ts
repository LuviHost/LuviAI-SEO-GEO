export { PublishAdapter } from './base.js';
export type {
  PublishPayload, PublishResult, OnPageMetaPayload, OnPageMetaResult, ImageAltPayload, ImageAltResult, LiveEntryRef, UpdateResult, UpdateOptions,
} from './base.js';
// Yayindaki WordPress yazisinin adreslenmesi — API'deki yeniden yayin karari da kullanir
export {
  wordPressPostId, wordPressUrlSlug, wordPressEntryAddressable,
  // Yerinde guncellemeden once kimlik ve cakisma denetimi (REST + XML-RPC ortak kural)
  wordPressGmtToIso, normalizeWordPressSlug, wordPressSlugMatches, expectedWordPressSlugs, wordPressEditedSince, WP_CLOCK_SKEW_TOLERANCE_MS,
  wordPressDateLabel, wordPressIdentityProblem, wordPressEditedText,
} from './wordpress-post-ref.js';
export type { WordPressIdentityProblem } from './wordpress-post-ref.js';
export { patchImgAlt, findImgTags, escapeAttr, readAlt } from './img-alt-patch.js';
export type { ImgAltTarget, PatchResult, PatchReason } from './img-alt-patch.js';
// Ag erisimi: API/worker acilista korumali uygulamayi kaydeder (bkz. transport.ts)
export { setAdapterFetch, setAdapterHostResolver, sanitizeErrorText } from './transport.js';
export type { AdapterFetch, AdapterHostResolver } from './transport.js';

// Publish hedefleri
export { WordPressRestAdapter, wordPressCategoryIds } from './wordpress-rest.js';
export { WordPressXmlrpcAdapter } from './wordpress-xmlrpc.js';
export { FtpAdapter } from './ftp.js';
export { SftpAdapter } from './sftp.js';
export { CpanelApiAdapter } from './cpanel-api.js';
export { GithubAdapter } from './github.js';
export { WebflowAdapter } from './webflow.js';
export { SanityAdapter } from './sanity.js';
export { ContentfulAdapter } from './contentful.js';
export { GhostAdapter } from './ghost.js';
export { WhmcsKbAdapter } from './whmcs-kb.js';
export { StrapiAdapter } from './strapi.js';
export { CustomPhpAdapter } from './custom-php.js';
export { MarkdownZipAdapter } from './markdown-zip.js';
export { ShopifyAdapter } from './shopify.js';
export { WixAdapter } from './wix.js';
export { KobipratikAdapter } from './kobipratik.js';

import type { PublishAdapter } from './base.js';
import { WordPressRestAdapter } from './wordpress-rest.js';
import { WordPressXmlrpcAdapter } from './wordpress-xmlrpc.js';
import { FtpAdapter } from './ftp.js';
import { SftpAdapter } from './sftp.js';
import { CpanelApiAdapter } from './cpanel-api.js';
import { GithubAdapter } from './github.js';
import { WebflowAdapter } from './webflow.js';
import { SanityAdapter } from './sanity.js';
import { ContentfulAdapter } from './contentful.js';
import { GhostAdapter } from './ghost.js';
import { WhmcsKbAdapter } from './whmcs-kb.js';
import { StrapiAdapter } from './strapi.js';
import { CustomPhpAdapter } from './custom-php.js';
import { MarkdownZipAdapter } from './markdown-zip.js';
import { ShopifyAdapter } from './shopify.js';
import { WixAdapter } from './wix.js';
import { KobipratikAdapter } from './kobipratik.js';

/*
 * Form alanlarinin (kimlik + ayar adlari, etiketler) TEK kaynagi API katalogudur:
 * apps/api/src/publish-targets/publish-target-catalog.ts. Burada eskiden ikinci
 * bir liste (ADAPTERS_CATALOG) vardi; hicbir yerden okunmuyordu ve eski alan
 * adlarini (Ghost siteUrl, Strapi strapiUrl/apiToken, WHMCS whmcsUrl...)
 * gosteriyordu — yaniltmasin diye kaldirildi.
 */
export function getAdapter(type: string): typeof PublishAdapter | null {
  const map: Record<string, any> = {
    WORDPRESS_REST:    WordPressRestAdapter,
    WORDPRESS_XMLRPC:  WordPressXmlrpcAdapter,
    FTP:               FtpAdapter,
    SFTP:              SftpAdapter,
    CPANEL_API:        CpanelApiAdapter,
    GITHUB:            GithubAdapter,
    WEBFLOW:           WebflowAdapter,
    SANITY:            SanityAdapter,
    CONTENTFUL:        ContentfulAdapter,
    GHOST:             GhostAdapter,
    WHMCS_KB:          WhmcsKbAdapter,
    STRAPI:            StrapiAdapter,
    CUSTOM_PHP:        CustomPhpAdapter,
    MARKDOWN_ZIP:      MarkdownZipAdapter,
    SHOPIFY:           ShopifyAdapter,
    WIX:               WixAdapter,
    KOBIPRATIK:        KobipratikAdapter,
  };
  return map[type] ?? null;
}
