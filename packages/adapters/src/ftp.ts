import { Client } from 'basic-ftp';
import { Readable } from 'node:stream';
import { PublishAdapter } from './base.js';
import type { PublishPayload, PublishResult } from './base.js';

/**
 * FTP/FTPS — static HTML upload
 * config: { remotePath: '/public_html/blog' }
 */
export class FtpAdapter extends PublishAdapter {
  async publish(payload: PublishPayload): Promise<PublishResult> {
    const { host, user, password, secure } = this.credentials;
    const { remotePath = '/' } = this.config;

    const client = new Client();
    try {
      await client.access({ host, user, password, secure: !!secure });
      const remoteFile = `${remotePath}/${payload.slug}.html`;
      const stream = Readable.from([payload.bodyHtml]);
      await client.uploadFrom(stream, remoteFile);
      return { ok: true, externalUrl: `ftp://${host}${remoteFile}` };
    } catch (err: any) {
      return { ok: false, error: err.message };
    } finally {
      client.close();
    }
  }

  async test(): Promise<boolean> {
    const client = new Client();
    try {
      await client.access(this.credentials as any);
      return true;
    } catch { return false; }
    finally { client.close(); }
  }
}
