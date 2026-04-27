import SftpClient from 'ssh2-sftp-client';
import { PublishAdapter } from './base.js';
import type { PublishPayload, PublishResult } from './base.js';

/**
 * SFTP/SSH — static HTML upload
 * credentials: { host, port, username, password OR privateKey }
 * config: { remotePath: '/var/www/html/blog' }
 */
export class SftpAdapter extends PublishAdapter {
  async publish(payload: PublishPayload): Promise<PublishResult> {
    const { remotePath = '/' } = this.config;
    const sftp = new SftpClient();
    try {
      await sftp.connect(this.credentials as any);
      const remoteFile = `${remotePath}/${payload.slug}.html`;
      await sftp.put(Buffer.from(payload.bodyHtml, 'utf8'), remoteFile);
      return { ok: true, externalUrl: remoteFile };
    } catch (err: any) {
      return { ok: false, error: err.message };
    } finally {
      await sftp.end();
    }
  }

  async test(): Promise<boolean> {
    const sftp = new SftpClient();
    try {
      await sftp.connect(this.credentials as any);
      return true;
    } catch { return false; }
    finally { try { await sftp.end(); } catch {} }
  }
}
