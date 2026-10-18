import SftpClient from 'ssh2-sftp-client';
import { PublishAdapter } from './base.js';
import type { PublishPayload, PublishResult } from './base.js';
import { resolveAdapterHost, socketPort } from './transport.js';

/**
 * SFTP/SSH — static HTML upload
 * credentials: { host, port, username (formda "user"), password OR privateKey, passphrase? }
 * config: { remotePath: '/var/www/html/blog' }
 */
export class SftpAdapter extends PublishAdapter {
  async publish(payload: PublishPayload): Promise<PublishResult> {
    const { remotePath = '/' } = this.config;
    const sftp = this.createClient();
    try {
      await sftp.connect(await this.connectOptions());
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
    const sftp = this.createClient();
    try {
      await sftp.connect(await this.connectOptions());
      return true;
    } catch { return false; }
    finally { try { await sftp.end(); } catch { /* kapanis hatasi sonucu degistirmez */ } }
  }

  /** Diske gercek .html dosyasi yazar — tam sayfa gerekir. */
  get needsFullPage(): boolean { return true; }

  get supportsRootFiles(): boolean { return true; }

  /**
   * Web root'a ham dosya yazar (robots.txt / llms.txt / sitemap.xml).
   * config.rootPath = web kök dizini. WordPress.com Atomic için genellikle
   * "htdocs", klasik hosting için "public_html". Boşsa SFTP'nin indiği dizine yazar.
   */
  async putRootFile(filename: string, content: string): Promise<PublishResult> {
    const rootPath = String(this.config.rootPath ?? this.config.docRoot ?? '').replace(/^\/+|\/+$/g, '');
    const remoteFile = rootPath ? `${rootPath}/${filename}` : filename;
    const sftp = this.createClient();
    try {
      await sftp.connect(await this.connectOptions());
      await sftp.put(Buffer.from(content, 'utf8'), remoteFile);
      return { ok: true, externalUrl: remoteFile };
    } catch (err: any) {
      return { ok: false, error: err.message };
    } finally {
      try { await sftp.end(); } catch { /* kapanis hatasi sonucu degistirmez */ }
    }
  }

  /** Kutuphane istemcisi — testler sahtesini vermek icin ezer (ag yok). */
  protected createClient(): SftpClient {
    return new SftpClient();
  }

  /**
   * ssh2 baglanti secenekleri — yalniz bilinen alanlar.
   *
   * NEDEN beyaz liste: credentials eskiden oldugu gibi ssh2'ye veriliyordu.
   * ssh2 `hostname` alanini `host`'tan ONCE kullanir (lib/client.js:
   * cfg.hostname || cfg.host); kayitta yalniz `host` denetlendigi icin
   * credentials'a hostname yazan biri adres denetimini tamamen atlayabiliyordu.
   * `agent` (yerel ssh-agent soketi) gibi alanlar da sunucu tarafinda bir sey
   * acmamali. Panel formu kullanici adini `user` diye kaydediyor; ssh2
   * `username` bekler — ikisi de kabul edilir.
   *
   * NEDEN host cozumu: API kayitliysa ad simdi cozulur, denetlenir ve
   * DENETLENEN IP'ye baglanilir (DNS rebinding araligi yok). SSH'de sunucu
   * kimligi ad ile degil anahtarla dogrulanir; IP'ye baglanmak bir sey bozmaz.
   */
  private async connectOptions(): Promise<SftpClient.ConnectOptions> {
    const c = this.credentials;
    const port = socketPort(c.port);
    const username = c.username ?? c.user;
    return {
      host: await resolveAdapterHost(String(c.host ?? '').trim()),
      ...(port ? { port } : {}),
      ...(username ? { username: String(username) } : {}),
      ...(c.password ? { password: String(c.password) } : {}),
      ...(c.privateKey ? { privateKey: String(c.privateKey) } : {}),
      ...(c.passphrase ? { passphrase: String(c.passphrase) } : {}),
    };
  }
}
