import archiver from 'archiver';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { PublishAdapter } from './base.js';
import type { PublishPayload, PublishResult } from './base.js';

/**
 * Kullanıcının "manuel publish" istediği durumlar için
 * markdown + frontmatter dosyasını ZIP olarak download verir.
 *
 * config: { outputDir: '/var/luviai/exports' }
 */
export class MarkdownZipAdapter extends PublishAdapter {
  async publish(payload: PublishPayload): Promise<PublishResult> {
    const { outputDir = '/tmp' } = this.config;
    await mkdir(outputDir, { recursive: true });
    const zipPath = path.join(outputDir, `${payload.slug}-${Date.now()}.zip`);

    return new Promise((resolve) => {
      const output = createWriteStream(zipPath);
      const archive = archiver('zip');
      archive.on('error', (err) => resolve({ ok: false, error: err.message }));
      output.on('close', () => resolve({ ok: true, externalUrl: zipPath }));
      archive.pipe(output);
      archive.append(payload.bodyMd, { name: `${payload.slug}.md` });
      if (payload.bodyHtml) archive.append(payload.bodyHtml, { name: `${payload.slug}.html` });
      archive.finalize();
    });
  }

  async test() { return true; }
}
