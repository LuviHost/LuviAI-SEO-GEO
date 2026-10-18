import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { encrypt } from '@luviai/shared';
import { SafeFetchError } from '../common/safe-fetch.js';

/**
 * "Bağlantıyı test et" (POST /publish-targets/:id/test).
 *
 * NEDEN VAR: servis adaptorde OLMAYAN testConnection() metodunu ariyordu;
 * hicbir adaptor onu tanimlamadigi icin dugme hic istek atmadan "Bu adapter
 * test fonksiyonu sunmuyor" diyordu. Ortak arayuz test(): Promise<boolean>.
 * Burada adaptor sahte: yalniz servisin ne cagirdigina ve ne soyledigine bakilir.
 */

const h = vi.hoisted(() => {
  const state = {
    test: async (): Promise<boolean> => true,
    testCalls: 0,
    constructed: [] as Array<{ creds: any; config: any }>,
  };
  // Bilerek YALNIZ test() var: eski kod testConnection() aradigi icin bunu hic cagirmazdi
  class FakeAdapter {
    constructor(creds: any, config: any) {
      state.constructed.push({ creds, config });
    }
    test(): Promise<boolean> {
      state.testCalls++;
      return state.test();
    }
  }
  return { state, FakeAdapter };
});

vi.mock('@luviai/adapters', async (orig) => {
  const real: any = await orig();
  return { ...real, getAdapter: (type: string) => (type === 'SHOPIFY_YOK' ? null : h.FakeAdapter) };
});

const { PublishTargetsService } = await import('./publish-targets.service.js');

const user = { id: 'u1', role: 'USER' };

function target(type: string, creds: Record<string, unknown>, config: Record<string, unknown> = {}) {
  return { id: 't1', siteId: 's1', type, config, credentials: { enc: encrypt(JSON.stringify(creds)) } };
}

function service(t: unknown, siteOwner = 'u1') {
  const prisma = {
    publishTarget: { findUnique: vi.fn(async () => t) },
    site: { findUnique: vi.fn(async () => ({ userId: siteOwner })) },
  };
  const svc = new PublishTargetsService(prisma as any, {} as any);
  // Gercek DNS yok: alan adlari genel adrese cikiyor
  svc.urlResolver = async () => undefined;
  svc.testTimeoutMs = 50;
  return svc;
}

const GHOST = { apiUrl: 'https://blog.ornek.com', adminApiKey: 'abc:0f0f' };
const WHMCS = { baseUrl: 'https://destek.ornek.com', apiIdentifier: 'id', apiSecret: 'sec' };

beforeEach(() => {
  h.state.test = async () => true;
  h.state.testCalls = 0;
  h.state.constructed.length = 0;
});

describe('PublishTargetsService.testConnection', () => {
  it('adaptorun test() metodunu cozulmus kimlikle cagirir; basari testin kanitladigini soyler', async () => {
    const res = await service(target('GHOST', GHOST)).testConnection('t1', user);
    expect(h.state.testCalls).toBe(1);
    expect(h.state.constructed[0].creds).toEqual(GHOST);
    expect(res).toEqual({ ok: true, tested: true, message: 'Bağlantı başarılı: Ghost Admin API anahtarı doğrulandı.' });
  });

  it('WordPress REST ve XML-RPC basarisi kimligin dogrulandigini, yazi yetkisinin denenmedigini soyler', async () => {
    // test() artik kimlik ister: REST GET /users/me (Basic), XML-RPC wp.getUsersBlogs
    const rest = await service(target('WORDPRESS_REST', { siteUrl: 'https://ornek.com', username: 'a', appPassword: 'b' })).testConnection('t1', user);
    expect(rest).toEqual({
      ok: true,
      tested: true,
      message: 'Bağlantı başarılı: WordPress kullanıcı adı ve uygulama şifresi doğrulandı. Yazı oluşturma yetkisi ilk yayında denenir.',
    });
    const xmlrpc = await service(target('WORDPRESS_XMLRPC', { siteUrl: 'https://ornek.com', username: 'a', password: 'b' })).testConnection('t1', user);
    expect(xmlrpc).toEqual({
      ok: true,
      tested: true,
      message: 'Bağlantı başarılı: XML-RPC ile kullanıcı adı ve şifre doğrulandı. Yazı oluşturma yetkisi ilk yayında denenir.',
    });
    expect(h.state.testCalls).toBe(2);
  });

  it('WordPress basarisiz testinde dogrulanmis ipucu: REST uygulama sifresi, XML-RPC kapali olabilir', async () => {
    h.state.test = async () => false;
    const rest = await service(target('WORDPRESS_REST', { siteUrl: 'https://ornek.com', username: 'a', appPassword: 'b' })).testConnection('t1', user);
    expect(rest).toMatchObject({ ok: false, tested: true });
    expect(rest.message).toContain('Kontrol et: Site URL, Kullanıcı adı, App Password.');
    expect(rest.message).toContain('Application Passwords');
    const xmlrpc = await service(target('WORDPRESS_XMLRPC', { siteUrl: 'https://ornek.com', username: 'a', password: 'b' })).testConnection('t1', user);
    expect(xmlrpc.message).toContain('Kontrol et: Site URL, Kullanıcı, Şifre.');
    expect(xmlrpc.message).toContain('XML-RPC bir eklentiyle kapatılmış olabilir');
  });

  it('test() false → basarisiz; formdaki zorunlu alan adlari ve dogrulanmis ipucu', async () => {
    h.state.test = async () => false;
    const ghost = await service(target('GHOST', GHOST)).testConnection('t1', user);
    expect(ghost.ok).toBe(false);
    expect(ghost.tested).toBe(true);
    expect(ghost.message).toContain('Ghost bağlantı testi başarısız');
    expect(ghost.message).toContain('Kontrol et: API URL, Admin API Key.');
    expect(ghost.message).toContain("'id:secret'");

    // WHMCS: istege bagli erisim anahtari "kontrol et" listesine girmez, IP ipucu girer
    const whmcs = await service(target('WHMCS_KB', WHMCS)).testConnection('t1', user);
    expect(whmcs.message).toContain('Kontrol et: WHMCS URL, API Identifier, API Secret.');
    expect(whmcs.message).toContain('IP ile kısıtlıdır');
    expect(whmcs.message).toContain('$api_access_key');
  });

  it('test() hata firlatirsa metin kisaltilir, ic IP maskelenir', async () => {
    h.state.test = async () => { throw new Error('connect ECONNREFUSED 10.1.2.3:443'); };
    const res = await service(target('GHOST', GHOST)).testConnection('t1', user);
    expect(res.ok).toBe(false);
    expect(res.message).toBe('Ghost bağlantısı kurulamadı: connect ECONNREFUSED [adres]');
    expect(res.message).not.toContain('10.1.2.3');
  });

  it('yonlendirme rehberi (adres + ne yapilacagi) yarida kesilmeden gosterilir', async () => {
    const guide = 'hedef adres isteği başka bir adrese yönlendiriyor (https://www.uzun-bir-alan-adi-ornegi.com.tr/wp-json/wp/v2/users/me); '
      + 'ayarlardaki adresi yönlendirmenin son hâliyle (https:// ve www dahil) güncelleyin.';
    h.state.test = async () => { throw new Error(guide); };
    const res = await service(target('WORDPRESS_REST', { siteUrl: 'https://ornek.com', username: 'a', appPassword: 'b' })).testConnection('t1', user);
    expect(res).toEqual({ ok: false, tested: true, message: `WordPress (REST API) bağlantısı kurulamadı: ${guide}` });
  });

  it('yanit vermeyen hedef → zaman asimi mesaji (panel asili kalmaz)', async () => {
    h.state.test = () => new Promise<boolean>(() => {});
    const res = await service(target('GHOST', GHOST)).testConnection('t1', user);
    expect(res.ok).toBe(false);
    expect(res.message).toContain('saniye içinde yanıt vermedi');
  });

  it('ic adres: adaptor HIC kurulmaz, ortak kapinin (publishTargetBlockReason) mesaji doner', async () => {
    const yazili = await service(target('GHOST', { ...GHOST, apiUrl: 'http://10.0.0.5:2368' })).testConnection('t1', user);
    expect(yazili.ok).toBe(false);
    expect(yazili.tested).toBe(false);
    expect(yazili.message).toMatch(/^Yayın hedefine bağlanılmadı — API URL: /);

    // Kayittan sonra ic adrese donen DNS
    const svc = service(target('WHMCS_KB', WHMCS));
    svc.urlResolver = async () => { throw new SafeFetchError('blocked_address', 'x'); };
    const dns = await svc.testConnection('t1', user);
    expect(dns.message).toContain('iç ağ adresine çıkıyor');

    expect(h.state.constructed).toHaveLength(0);
    expect(h.state.testCalls).toBe(0);
  });

  it('Markdown ZIP: uzak sunucu yok, istek atilmaz, "test yok" denir (tested:false — panel notr gosterir)', async () => {
    const zip = await service(target('MARKDOWN_ZIP', {})).testConnection('t1', user);
    expect(zip).toEqual({ ok: true, tested: false, message: 'Markdown ZIP uzak bir sunucuya bağlanmaz; bağlantı testi gerekmez.' });
    expect(h.state.testCalls).toBe(0);
  });

  it('eski bicim (alan alan sifreli) kimlik de yayincinin gordugu gibi cozulup adaptore verilir', async () => {
    const legacy = { id: 't1', siteId: 's1', type: 'GHOST', config: {}, credentials: { apiUrl: 'https://blog.ornek.com', adminApiKey: encrypt('abc:0f0f') } };
    const res = await service(legacy).testConnection('t1', user);
    expect(res.ok).toBe(true);
    expect(h.state.constructed[0].creds).toEqual({ apiUrl: 'https://blog.ornek.com', adminApiKey: 'abc:0f0f' });
  });

  it('cozulemeyen kimlik bilgisi: ic hata metni yerine ne yapilacagi', async () => {
    const res = await service({ id: 't1', siteId: 's1', type: 'GHOST', config: {}, credentials: { enc: 'bozuk' } }).testConnection('t1', user);
    expect(res).toEqual({ ok: false, tested: false, message: 'Kayıtlı kimlik bilgileri okunamadı. Hedefi düzenleyip bilgileri yeniden girin.' });
  });

  it('baskasinin hedefi 403; adaptor kurulmaz', async () => {
    await expect(service(target('GHOST', GHOST), 'baskasi').testConnection('t1', user)).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.state.constructed).toHaveLength(0);
  });

  it('adaptoru olmayan tip net mesajla doner', async () => {
    const res = await service(target('SHOPIFY_YOK', {})).testConnection('t1', user);
    expect(res).toEqual({ ok: false, tested: false, message: 'SHOPIFY_YOK için yayın bağdaştırıcısı bulunamadı.' });
  });
});
