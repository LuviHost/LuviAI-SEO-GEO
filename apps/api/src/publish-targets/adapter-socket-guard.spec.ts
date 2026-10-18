import { describe, it, expect, afterEach } from 'vitest';
import { FtpAdapter, SftpAdapter, setAdapterHostResolver } from '@luviai/adapters';
import { makeGuardedHostResolver } from './adapter-egress.js';

/**
 * FTP/SFTP adaptorleri — baglanilan adres (F16, soket tarafi).
 *
 * NEDEN VAR: FTP/SFTP kutuphaneleri adi baglanti aninda kendileri cozuyordu
 * (DNS rebinding araligi). SFTP ayrica credentials'i oldugu gibi ssh2'ye
 * veriyordu: ssh2 `hostname`'i `host`'tan once kullandigi icin kayitta
 * denetlenmeyen bir alanla adres denetimi atlanabiliyordu. FTP'de PASV
 * yanitindaki adresi sunucu yazar.
 *
 * Gercek ag yok: adaptorlerin kutuphane istemcisi (createClient) sahtesiyle
 * degistirilir; yalniz adaptorun kutuphaneye ne verdigine bakilir.
 */

type FtpRecord = { options: unknown; access: any[]; uploads: string[] };
const ftpClients: FtpRecord[] = [];
const sftpConnects: any[] = [];

class FakeFtp extends FtpAdapter {
  protected createClient(options?: unknown): any {
    const rec: FtpRecord = { options, access: [], uploads: [] };
    ftpClients.push(rec);
    return {
      access: async (o: any) => { rec.access.push(o); },
      uploadFrom: async (_src: unknown, remote: string) => { rec.uploads.push(remote); },
      close: () => {},
    };
  }
}

class FakeSftp extends SftpAdapter {
  protected createClient(): any {
    return {
      connect: async (cfg: any) => { sftpConnects.push(cfg); },
      put: async () => {},
      end: async () => true,
    };
  }
}

/** Uretim politikasi; DNS sahte: ftp.ornek.com genel, ic.ornek.com ic adrese cikiyor */
const resolver = makeGuardedHostResolver({
  ipv4Only: true,
  resolveHost: async (h) => {
    // Genel IP (203.0.113/24 dokumantasyon blogu engelli listede oldugu icin kullanilmaz)
    if (h === 'ftp.ornek.com') return ['185.10.20.10'];
    if (h === 'ic.ornek.com') return ['10.0.0.7'];
    throw new Error('ENOTFOUND');
  },
});

const payload = { slug: 'yazi', title: 'T', bodyHtml: '<p>x</p>', bodyMd: 'x' };

afterEach(() => {
  setAdapterHostResolver(null);
  ftpClients.length = 0;
  sftpConnects.length = 0;
});

describe('SFTP', () => {
  it('kayit yokken ad aynen gider; yalniz bilinen alanlar, formdaki "user" → username', async () => {
    const r = await new FakeSftp({ host: 'ftp.ornek.com', port: '2222', user: 'deploy', password: 'p', hostname: '127.0.0.1', agent: '/tmp/ssh-agent.sock' }, {}).publish(payload);
    expect(r.ok).toBe(true);
    expect(sftpConnects[0]).toEqual({ host: 'ftp.ornek.com', port: 2222, username: 'deploy', password: 'p' });
  });

  it('kayitliyken DENETLENEN IP\'ye baglanir; hostname ile denetim atlanamaz', async () => {
    setAdapterHostResolver(resolver);
    expect(await new FakeSftp({ host: 'ftp.ornek.com', username: 'deploy', privateKey: 'KEY', hostname: '127.0.0.1' }, {}).test()).toBe(true);
    expect(sftpConnects[0]).toEqual({ host: '185.10.20.10', username: 'deploy', privateKey: 'KEY' });
  });

  it('ic adrese cikan ad ya da yazili ic IP: baglanti hic denenmez, neden durust', async () => {
    setAdapterHostResolver(resolver);
    const a = await new FakeSftp({ host: 'ic.ornek.com', username: 'u', password: 'p' }, {}).publish(payload);
    expect(a.ok).toBe(false);
    expect(a.error).toMatch(/özel veya iç ağ adresine çıkıyor/);
    expect(a.error).not.toContain('10.0.0.7');
    const b = await new FakeSftp({ host: '169.254.169.254', username: 'u', password: 'p' }, {}).putRootFile('robots.txt', 'x');
    expect(b.ok).toBe(false);
    expect(sftpConnects).toEqual([]);
  });
});

describe('FTP', () => {
  it('kayit yokken eski davranis: ad aynen, kutuphane varsayilan istemcisi; formdaki port yayinda da kullanilir', async () => {
    const r = await new FakeFtp({ host: 'ftp.ornek.com', user: 'u', password: 'p', port: 2121 }, { remotePath: '/blog' }).publish(payload);
    expect(r).toMatchObject({ ok: true, externalUrl: 'ftp://ftp.ornek.com/blog/yazi.html' });
    expect(ftpClients[0].options).toBeUndefined();
    expect(ftpClients[0].access[0]).toEqual({ host: 'ftp.ornek.com', user: 'u', password: 'p', secure: false, port: 2121 });
    expect(ftpClients[0].uploads).toEqual(['/blog/yazi.html']);
  });

  it('kayitliyken DENETLENEN IP\'ye baglanir; veri baglantisi PASV adresine degil kontrol adresine gider', async () => {
    setAdapterHostResolver(resolver);
    const r = await new FakeFtp({ host: 'ftp.ornek.com', user: 'u', password: 'p' }, {}).putRootFile('llms.txt', 'x');
    expect(r).toMatchObject({ ok: true, externalUrl: 'ftp://ftp.ornek.com/llms.txt' });
    expect(ftpClients[0].options).toEqual({ allowSeparateTransferHost: false });
    expect(ftpClients[0].access[0]).toEqual({ host: '185.10.20.10', user: 'u', password: 'p', secure: false });
  });

  it('FTPS: IP\'ye baglanirken sertifika alan adina gore dogrulanir (servername)', async () => {
    setAdapterHostResolver(resolver);
    expect(await new FakeFtp({ host: 'ftp.ornek.com', user: 'u', password: 'p', secure: true }, {}).test()).toBe(true);
    expect(ftpClients[0].access[0]).toMatchObject({ host: '185.10.20.10', secure: true, secureOptions: { host: 'ftp.ornek.com', servername: 'ftp.ornek.com' } });
  });

  it('test() credentials\'i oldugu gibi vermez (secureOptions vb. denetimsiz alan gitmez)', async () => {
    await new FakeFtp({ host: 'ftp.ornek.com', user: 'u', password: 'p', secureOptions: { rejectUnauthorized: false } }, {}).test();
    expect(ftpClients[0].access[0]).toEqual({ host: 'ftp.ornek.com', user: 'u', password: 'p', secure: false });
  });

  it('ic adrese cikan ad: baglanti denenmez, neden durust', async () => {
    setAdapterHostResolver(resolver);
    const r = await new FakeFtp({ host: 'ic.ornek.com', user: 'u', password: 'p' }, {}).publish(payload);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/özel veya iç ağ adresine çıkıyor/);
    expect(ftpClients[0].access).toEqual([]);
  });
});
