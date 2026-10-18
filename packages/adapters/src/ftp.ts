import { Client } from 'basic-ftp';
import type { AccessOptions, ClientOptions } from 'basic-ftp';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';
import { PublishAdapter } from './base.js';
import type { PublishPayload, PublishResult } from './base.js';
import { hasAdapterHostResolver, resolveAdapterHost, socketPort } from './transport.js';

/**
 * FTP/FTPS — static HTML upload
 * credentials: { host, port?, user, password, secure? }
 * config: { remotePath: '/public_html/blog' }
 */
export class FtpAdapter extends PublishAdapter {
  async publish(payload: PublishPayload): Promise<PublishResult> {
    const { host } = this.credentials;
    const { remotePath = '/' } = this.config;

    const client = this.newClient();
    try {
      await client.access(await this.accessOptions());
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
    const client = this.newClient();
    try {
      await client.access(await this.accessOptions());
      return true;
    } catch { return false; }
    finally { client.close(); }
  }

  /** Diske gercek .html dosyasi yazar — tam sayfa gerekir. */
  get needsFullPage(): boolean { return true; }

  get supportsRootFiles(): boolean { return true; }

  /**
   * Web root'a ham dosya yazar (robots.txt / llms.txt / sitemap.xml).
   * config.rootPath = web kök dizini (genelde "public_html"). Boşsa FTP'nin
   * indiği dizine yazar.
   */
  async putRootFile(filename: string, content: string): Promise<PublishResult> {
    const { host } = this.credentials;
    const rootPath = String(this.config.rootPath ?? this.config.docRoot ?? '').replace(/^\/+|\/+$/g, '');
    const remoteFile = rootPath ? `${rootPath}/${filename}` : filename;
    const client = this.newClient();
    try {
      await client.access(await this.accessOptions());
      await client.uploadFrom(Readable.from([content]), remoteFile);
      return { ok: true, externalUrl: `ftp://${host}/${remoteFile}` };
    } catch (err: any) {
      return { ok: false, error: err.message };
    } finally {
      client.close();
    }
  }

  /**
   * Veri baglantisi kurali. API korumali cozucuyu kaydettiyse
   * (setAdapterHostResolver) sunucunun PASV yanitinda verdigi adres
   * KULLANILMAZ; veri baglantisi da kontrol baglantisinin (denetlenmis)
   * adresine gider.
   *
   * NEDEN: PASV adresini sunucu yazar. basic-ftp yalniz RFC 1918 ve 127.0.0.1'i
   * kontrol adresiyle degistirir; 169.254.169.254 (bulut metadata), 127.0.0.2,
   * 100.64/10 gibi bir adres verilirse yuklenen dosya oraya gonderilirdi.
   * allowSeparateTransferHost:false kutuphanenin belgeledigi koruma (EPSV,
   * ardindan kontrol adresli PASV); ayri veri sunucusu kullanan FTP cok nadir.
   * Kayit yoksa kutuphane varsayilani (eski davranis) aynen kalir.
   */
  private newClient(): Client {
    return this.createClient(hasAdapterHostResolver() ? { allowSeparateTransferHost: false } : undefined);
  }

  /** Kutuphane istemcisi — testler sahtesini vermek icin ezer (ag yok). */
  protected createClient(options?: Partial<ClientOptions>): Client {
    return options ? new Client(undefined, options) : new Client();
  }

  /**
   * Baglanti secenekleri — yalniz bilinen alanlar.
   *
   * NEDEN beyaz liste: test() eskiden credentials'i oldugu gibi basic-ftp'ye
   * veriyordu; kayitta denetlenmeyen alanlar (secureOptions...) dogrudan
   * baglantiya gidiyordu. port artik publish'te de kullanilir (eskiden yalniz
   * test() gonderiyordu; formdaki port yayinda yok sayiliyordu).
   *
   * NEDEN host cozumu: API kayitliysa ad simdi cozulur, denetlenir ve
   * DENETLENEN IP'ye baglanilir — denetim ile baglanti arasinda DNS
   * degistirilemez (rebinding). FTPS'te sertifika yine alan adina gore
   * dogrulanir: servername verilince Node kimlik denetimini ona gore yapar
   * (tls.connect checkServerIdentity — "or the provided servername").
   */
  private async accessOptions(): Promise<AccessOptions> {
    const { host, user, password, secure } = this.credentials;
    const name = String(host ?? '').trim();
    const target = await resolveAdapterHost(name);
    const port = socketPort(this.credentials.port);
    const pinned = !!secure && target !== name && !isIP(name);
    return {
      host: target,
      user,
      password,
      secure: !!secure,
      ...(port ? { port } : {}),
      ...(pinned ? { secureOptions: { host: name, servername: name } } : {}),
    };
  }
}
