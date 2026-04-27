export { PublishAdapter } from './base.js';
export { WordPressRestAdapter } from './wordpress-rest.js';
export { FtpAdapter } from './ftp.js';
export { SftpAdapter } from './sftp.js';
export { MarkdownZipAdapter } from './markdown-zip.js';

import type { PublishAdapter } from './base.js';
import { WordPressRestAdapter } from './wordpress-rest.js';
import { FtpAdapter } from './ftp.js';
import { SftpAdapter } from './sftp.js';
import { MarkdownZipAdapter } from './markdown-zip.js';

/** Publish target type → Adapter factory */
export function getAdapter(type: string): typeof PublishAdapter | null {
  const map: Record<string, any> = {
    WORDPRESS_REST: WordPressRestAdapter,
    FTP: FtpAdapter,
    SFTP: SftpAdapter,
    MARKDOWN_ZIP: MarkdownZipAdapter,
    // Faz 2'de eklenir:
    // GITHUB, WEBFLOW, SANITY, CONTENTFUL, GHOST, CPANEL_API, WHMCS_KB, CUSTOM_PHP
  };
  return map[type] ?? null;
}
