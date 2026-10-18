import { describe, it, expect, vi } from 'vitest';
import { SafeFetchError } from '../common/safe-fetch.js';
import { assertPublishTargetSafe, publishTargetBlockReason } from './publish-target-url.js';
import { PublishTargetsService } from './publish-targets.service.js';

/**
 * Yayin hedefi adresleri — SSRF.
 *
 * NEDEN VAR: CMS adaptorleri kullanicinin girdigi "Site URL", "cPanel host",
 * FTP sunucusu gibi adreslere sunucumuzdan baglanir. Ic ag / bulut metadata
 * adresi kayitta ve baglantidan hemen once reddedilir.
 */

const genel = async () => undefined;
const icAg = async () => { throw new SafeFetchError('blocked_address', 'x'); };
const reddedilir = async (p: Promise<unknown>) => {
  try { await p; return 'gecti'; } catch (e) { return (e as Error).message; }
};

describe('assertPublishTargetSafe', () => {
  it('ozel/ic IP yazilmis URL alanlari reddedilir (Turkce, alan adiyla)', async () => {
    expect(await reddedilir(assertPublishTargetSafe('WORDPRESS_REST', { siteUrl: 'http://169.254.169.254' }, {}, genel)))
      .toBe('Site URL: özel veya iç ağ adresi kullanılamaz; herkese açık bir adres girin.');
    expect(await reddedilir(assertPublishTargetSafe('CUSTOM_PHP', { endpointUrl: 'http://127.0.0.1:3001/api' }, {}, genel))).toContain('Endpoint URL');
    expect(await reddedilir(assertPublishTargetSafe('GHOST', { apiUrl: 'http://[::1]:2368' }, {}, genel))).toContain('API URL');
    expect(await reddedilir(assertPublishTargetSafe('STRAPI', { strapiUrl: 'http://10.0.0.8:1337' }, {}, genel))).toContain('Strapi URL');
  });

  it('cPanel host tam URL olarak denetlenir; standart disi port (2083) serbest', async () => {
    expect(await reddedilir(assertPublishTargetSafe('CPANEL_API', { host: 'https://cpanel.ornek.com:2083' }, {}, genel))).toBe('gecti');
    expect(await reddedilir(assertPublishTargetSafe('CPANEL_API', { host: 'https://192.168.1.10:2083' }, {}, genel))).toContain('cPanel host');
  });

  it('FTP/SFTP host sunucu adi olarak denetlenir; genel IP serbest, ozel IP ve localhost red', async () => {
    expect(await reddedilir(assertPublishTargetSafe('FTP', { host: 'ftp.ornek.com' }, {}, genel))).toBe('gecti');
    expect(await reddedilir(assertPublishTargetSafe('SFTP', { host: '185.10.20.30' }, {}, genel))).toBe('gecti');
    expect(await reddedilir(assertPublishTargetSafe('FTP', { host: 'ftp://ftp.ornek.com' }, {}, genel))).toBe('gecti');
    expect(await reddedilir(assertPublishTargetSafe('SFTP', { host: '10.0.0.4' }, {}, genel))).toContain('Host');
    expect(await reddedilir(assertPublishTargetSafe('SFTP', { host: 'localhost' }, {}, genel))).toContain('Host');
    expect(await reddedilir(assertPublishTargetSafe('FTP', { host: '127.0.0.1:21' }, {}, genel))).toContain('Host');
  });

  it('ic aga cozulen alan adi reddedilir', async () => {
    expect(await reddedilir(assertPublishTargetSafe('WORDPRESS_REST', { siteUrl: 'https://ic.ornek.com' }, {}, icAg)))
      .toBe('Site URL: alan adı özel veya iç ağ adresine çıkıyor; herkese açık bir adres girin.');
  });

  it('URL\'de kimlik bilgisi ve http(s) disi sema reddedilir', async () => {
    expect(await reddedilir(assertPublishTargetSafe('WORDPRESS_REST', { siteUrl: 'https://admin:sifre@ornek.com' }, {}, genel))).toContain('kullanıcı adı veya parola');
    expect(await reddedilir(assertPublishTargetSafe('WHMCS_KB', { whmcsUrl: 'file:///etc/passwd' }, {}, genel))).toContain('WHMCS URL');
  });

  it('config.publicBaseUrl da denetlenir', async () => {
    expect(await reddedilir(assertPublishTargetSafe('CPANEL_API', {}, { publicBaseUrl: 'http://169.254.169.254' }, genel))).toContain('Public site URL');
  });

  it('adres alani olmayan tipler (GitHub, Webflow) ve bos alanlar sorun cikarmaz', async () => {
    const resolve = vi.fn(genel);
    expect(await reddedilir(assertPublishTargetSafe('GITHUB', { token: 'x', owner: 'o', repo: 'r' }, {}, resolve))).toBe('gecti');
    expect(await reddedilir(assertPublishTargetSafe('WORDPRESS_REST', { siteUrl: '' }, null, resolve))).toBe('gecti');
    expect(resolve).not.toHaveBeenCalled();
  });
});

describe('PublishTargetsService — kayit ve test', () => {
  function service() {
    const created: any[] = [];
    const prisma = {
      site: { findUnique: async () => ({ userId: 'u1' }) },
      publishTarget: {
        create: async ({ data }: any) => { created.push(data); return { id: 't1', ...data }; },
        updateMany: async () => ({}),
        findUnique: async () => ({ id: 't1', siteId: 's1', type: 'WORDPRESS_REST', credentials: { siteUrl: 'http://127.0.0.1' }, config: {} }),
        update: async ({ data }: any) => data,
      },
    };
    const quota = { canUsePublishTarget: async () => true };
    const svc = new PublishTargetsService(prisma as never, quota as never);
    svc.urlResolver = genel;
    return { svc, created };
  }

  it('ic adresli hedef kaydedilmez', async () => {
    const { svc, created } = service();
    await expect(svc.create('s1', { type: 'WORDPRESS_REST', name: 'WP', credentials: { siteUrl: 'http://169.254.169.254', username: 'a', appPassword: 'b' } }, { id: 'u1', role: 'USER' }))
      .rejects.toMatchObject({ status: 400 });
    expect(created).toHaveLength(0);
  });

  it('guncellemede yeni kimlik bilgisi ayni denetimden gecer', async () => {
    const { svc } = service();
    await expect(svc.update('t1', { credentials: { siteUrl: 'http://10.0.0.1' } }, { id: 'u1', role: 'USER' })).rejects.toMatchObject({ status: 400 });
    await expect(svc.update('t1', { name: 'Yeni' }, { id: 'u1', role: 'USER' })).resolves.toBeTruthy();
  });

  it('baglanti testi kayitli ic adrese istek atmadan reddeder', async () => {
    const { svc } = service();
    const r = await svc.testConnection('t1', { id: 'u1', role: 'USER' });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('Site URL');
  });
});

describe('publishTargetBlockReason — alti cagiranin ortak kapisi', () => {
  it('reddedilen hedefte cagiranlarin bekledigi Turkce neden; hata ATMAZ', async () => {
    expect(await publishTargetBlockReason('WORDPRESS_REST', { siteUrl: 'http://127.0.0.1:8080' }, {}, genel))
      .toBe('Yayın hedefine bağlanılmadı — Site URL: özel veya iç ağ adresi kullanılamaz; herkese açık bir adres girin.');
    expect(await publishTargetBlockReason('SFTP', { host: 'ic.ornek.com' }, null, icAg))
      .toBe('Yayın hedefine bağlanılmadı — Host: alan adı özel veya iç ağ adresine çıkıyor; herkese açık bir adres girin.');
  });

  it('gecen hedefte null; config null/undefined bos sayilir', async () => {
    expect(await publishTargetBlockReason('SFTP', { host: '185.10.20.30' }, undefined, genel)).toBeNull();
    expect(await publishTargetBlockReason('CPANEL_API', { host: 'https://cpanel.ornek.com:2083' }, null, genel)).toBeNull();
    expect(await publishTargetBlockReason('GITHUB', null, undefined, genel)).toBeNull();
  });

  it('config alanlari da denetlenir (publicBaseUrl)', async () => {
    expect(await publishTargetBlockReason('CPANEL_API', {}, { publicBaseUrl: 'http://169.254.169.254' }, genel)).toContain('Public site URL');
  });
});
