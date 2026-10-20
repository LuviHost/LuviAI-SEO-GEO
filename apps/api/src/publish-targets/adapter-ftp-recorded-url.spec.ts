import { describe, it, expect } from 'vitest';
import { FtpAdapter } from '@luviai/adapters';

/**
 * D1 madde 3 — FTP adaptorunun yayin kaydina yazdigi konum.
 *
 * NEDEN VAR: kayit `ftp://${host}${remoteFile}` ile kuruluyordu; remotePath '/' ile baslamiyorsa
 * ('public_html/blog') sunucu adi yola yapisiyordu (`ftp://ftp.ornek.compublic_html/blog/yazi.html`).
 * Adres ayristirmasi sunucu adini 'ftp.ornek.compublic_html' okuyor, klasorun ilk parcasi
 * kayboluyordu (ai-sitemap.service recordedRemoteDir: klasor degisince eski kopyanin adresi).
 * Yalniz KAYIT dizesi normallesir: goreli FTP yolu oturumun acildigi dizine goredir, yukleme yolu
 * bu yuzden aynen kalir.
 *
 * Gercek ag yok: kutuphane istemcisi (createClient) sahtesiyle degistirilir.
 */

const uploads: string[] = [];

class FakeFtp extends FtpAdapter {
  protected createClient(): any {
    return {
      access: async () => {},
      uploadFrom: async (_src: unknown, remote: string) => { uploads.push(remote); },
      close: () => {},
    };
  }
}

const payload = { slug: 'yazi', title: 'T', bodyHtml: '<p>x</p>', bodyMd: 'x' };
const publish = async (config: Record<string, unknown>) => {
  uploads.length = 0;
  return new FakeFtp({ host: 'ftp.ornek.com', user: 'u', password: 'p' }, config).publish(payload);
};

describe('FTP yayin kaydi: sunucu adi ile yol arasinda egik cizgi', () => {
  it('egik cizgiyle baslamayan remotePath: kayit ayracli, yukleme yolu GORELI kalir (oturum dizinine gore)', async () => {
    const r = await publish({ remotePath: 'public_html/blog' });
    expect(r).toMatchObject({ ok: true, externalUrl: 'ftp://ftp.ornek.com/public_html/blog/yazi.html' });
    expect(uploads).toEqual(['public_html/blog/yazi.html']);
    // Kayit ayristirildiginda sunucu adi ve klasor dogru okunur
    const u = new URL(r.externalUrl!);
    expect(u.hostname).toBe('ftp.ornek.com');
    expect(u.pathname).toBe('/public_html/blog/yazi.html');
  });

  it('egik cizgiyle baslayan remotePath ve varsayilan: kayit ve yukleme yolu eskisiyle birebir ayni', async () => {
    expect((await publish({ remotePath: '/public_html/blog' })).externalUrl).toBe('ftp://ftp.ornek.com/public_html/blog/yazi.html');
    expect(uploads).toEqual(['/public_html/blog/yazi.html']);
    // remotePath yok: '/' (yukleme yolu '//yazi.html' — eski davranis)
    expect((await publish({})).externalUrl).toBe('ftp://ftp.ornek.com//yazi.html');
    expect(uploads).toEqual(['//yazi.html']);
  });

  it('putRootFile kaydi zaten ayracli (degismedi)', async () => {
    const r = await new FakeFtp({ host: 'ftp.ornek.com', user: 'u', password: 'p' }, { rootPath: 'public_html' }).putRootFile('llms.txt', 'x');
    expect(r).toMatchObject({ ok: true, externalUrl: 'ftp://ftp.ornek.com/public_html/llms.txt' });
  });
});
