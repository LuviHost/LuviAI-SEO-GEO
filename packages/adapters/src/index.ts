export { PublishAdapter } from './base.js';

// 14 publish hedefi
export { WordPressRestAdapter } from './wordpress-rest.js';
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

/** Publish target type → Adapter factory (14 hedef) */
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
  };
  return map[type] ?? null;
}

/** Tüm adapter'ları metadata ile listele (UI dropdown için) */
export const ADAPTERS_CATALOG = [
  { type: 'WORDPRESS_REST',   label: 'WordPress REST API',  description: 'App Password ile otomatik yayın',          fields: ['siteUrl', 'username', 'appPassword'] },
  { type: 'WORDPRESS_XMLRPC', label: 'WordPress XML-RPC',   description: 'Eski WP sürümleri (4.7 öncesi)',           fields: ['siteUrl', 'username', 'password'] },
  { type: 'FTP',              label: 'FTP',                 description: 'Static HTML + FTP upload',                  fields: ['host', 'user', 'password'] },
  { type: 'SFTP',             label: 'SFTP / SSH',          description: 'Static HTML + SSH key veya password',       fields: ['host', 'username', 'password|privateKey'] },
  { type: 'CPANEL_API',       label: 'cPanel API Token',    description: 'cPanel File Manager UAPI',                  fields: ['cpanelUrl', 'username', 'apiToken'] },
  { type: 'GITHUB',           label: 'GitHub Repo',         description: 'Static site generator (Hugo, Jekyll, Astro)', fields: ['token', 'owner', 'repo', 'branch'] },
  { type: 'WEBFLOW',          label: 'Webflow CMS',         description: 'Webflow CMS Collection item',               fields: ['apiToken', 'siteId', 'collectionId'] },
  { type: 'SANITY',           label: 'Sanity',              description: 'Headless CMS — Portable Text',              fields: ['projectId', 'dataset', 'token'] },
  { type: 'CONTENTFUL',       label: 'Contentful',          description: 'Management API + publish',                  fields: ['spaceId', 'environmentId', 'managementToken'] },
  { type: 'GHOST',            label: 'Ghost',               description: 'Ghost Admin API (JWT)',                     fields: ['siteUrl', 'adminApiKey'] },
  { type: 'WHMCS_KB',         label: 'WHMCS Knowledgebase', description: 'WHMCS API ile bilgi bankası makalesi',     fields: ['whmcsUrl', 'identifier', 'secret'] },
  { type: 'STRAPI',           label: 'Strapi',              description: 'Strapi 4+ REST API',                        fields: ['strapiUrl', 'apiToken'] },
  { type: 'CUSTOM_PHP',       label: 'Custom PHP Endpoint', description: 'Kendi PHP API\'ınız + HMAC imza',          fields: ['endpointUrl', 'apiKey?', 'hmacSecret?'] },
  { type: 'MARKDOWN_ZIP',     label: 'Markdown ZIP indir',  description: 'Manuel yayın için ZIP export',              fields: [] },
] as const;
