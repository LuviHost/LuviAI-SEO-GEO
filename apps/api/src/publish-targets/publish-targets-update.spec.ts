import { describe, it, expect, vi } from 'vitest';
import { decrypt, encrypt } from '@luviai/shared';
import { PublishTargetsService } from './publish-targets.service.js';
import { mergeCredentials, readStoredCredentials } from './publish-target-credentials.js';

/**
 * Yayin hedefi duzenleme — kimlik bilgisi KISMI guncellenir.
 *
 * NEDEN VAR: update() gelen kimlik nesnesini kaydin TAMAMININ yerine yaziyordu.
 * Panel formu duzenlemede yalniz doldurulan alanlari gonderir ("Mevcut giriş
 * bilgilerini değiştirmek istemiyorsan boş bırak"): WordPress'te yalniz App
 * Password degisince Site URL ve kullanici adi, WHMCS'e yalniz erisim anahtari
 * eklenince adres + kimlik siliniyordu.
 *
 * Sozlesme (publish-target-credentials.ts): bos dize korur, null siler, eski
 * ad katalog adina tasinir. Adres denetimi BIRLESMIS kimlikle yapilir.
 */

const user = { id: 'u1', role: 'USER' };

function setup(record: { type: string; credentials: unknown; config?: Record<string, unknown> }) {
  const updates: Array<Record<string, any>> = [];
  const resolved: string[] = [];
  const prisma = {
    site: { findUnique: vi.fn(async () => ({ userId: 'u1' })) },
    publishTarget: {
      findUnique: vi.fn(async () => ({ id: 't1', siteId: 's1', config: {}, ...record })),
      update: vi.fn(async ({ data }: any) => { updates.push(data); return { id: 't1', siteId: 's1', ...record, ...data }; }),
      updateMany: vi.fn(async () => ({})),
      create: vi.fn(async ({ data }: any) => ({ id: 't2', ...data })),
    },
  };
  const svc = new PublishTargetsService(prisma as never, { canUsePublishTarget: async () => true } as never);
  // Gercek DNS yok: cozulmek istenen adresler kaydedilir, hepsi genel sayilir
  svc.urlResolver = async (url: string) => { resolved.push(url); };
  const stored = () => {
    const last = updates[updates.length - 1];
    return last?.credentials ? JSON.parse(decrypt(last.credentials.enc)) : undefined;
  };
  return { svc, updates, resolved, stored };
}

const enc = (creds: Record<string, unknown>) => ({ enc: encrypt(JSON.stringify(creds)) });
const WP = { siteUrl: 'https://blog.ornek.com', username: 'editor', appPassword: 'eski sifre' };
const WHMCS = { baseUrl: 'https://destek.ornek.com', apiIdentifier: 'KIM', apiSecret: 'SIR' };

describe('PublishTargetsService.update — kimlik birlestirme', () => {
  it('yalniz App Password degisince Site URL ve kullanici adi korunur (eski hata: siliniyordu)', async () => {
    const { svc, stored } = setup({ type: 'WORDPRESS_REST', credentials: enc(WP) });
    const res = await svc.update('t1', { credentials: { appPassword: 'yeni sifre' } }, user);
    expect(stored()).toEqual({ ...WP, appPassword: 'yeni sifre' });
    // Yanit kimligi asla tasimaz
    expect(res).not.toHaveProperty('credentials');
    expect(res.hasCredentials).toBe(true);
  });

  it("WHMCS'e yalniz erisim anahtari eklenince adres ve kimlik korunur", async () => {
    const { svc, stored } = setup({ type: 'WHMCS_KB', credentials: enc(WHMCS) });
    await svc.update('t1', { credentials: { accessKey: 'ANAHTAR' } }, user);
    expect(stored()).toEqual({ ...WHMCS, accessKey: 'ANAHTAR' });
  });

  it('bos ve yalniz bosluk dize kayitli degeri silmez; etkili degisiklik yoksa kimlik hic yazilmaz', async () => {
    const { svc, updates, resolved } = setup({ type: 'WORDPRESS_REST', credentials: enc(WP) });
    await svc.update('t1', { name: 'Blog', credentials: { siteUrl: '', username: '   ', appPassword: '' } }, user);
    expect(updates[0]).toEqual({ name: 'Blog' });
    expect(resolved).toHaveLength(0);
  });

  it('null alani acikca siler (istege bagli erisim anahtari kaldirilir)', async () => {
    const { svc, stored } = setup({ type: 'WHMCS_KB', credentials: enc({ ...WHMCS, accessKey: 'ESKI' }) });
    await svc.update('t1', { credentials: { accessKey: null } }, user);
    expect(stored()).toEqual(WHMCS);
  });

  it('katalog adi yazilinca eski adli kopya silinir; eski adla gelen alan katalog adina tasinir', async () => {
    // cPanel adaptoru host ?? cpanelUrl okur: eski cpanelUrl kalsaydi formda gorunmez, silinemezdi
    const cp = setup({ type: 'CPANEL_API', credentials: enc({ cpanelUrl: 'https://cpanel.eski.com:2083', username: 'u', apiToken: 't' }) });
    await cp.svc.update('t1', { credentials: { host: 'https://cpanel.yeni.com:2083' } }, user);
    expect(cp.stored()).toEqual({ host: 'https://cpanel.yeni.com:2083', username: 'u', apiToken: 't' });

    // API eski adla (Ghost siteUrl) gonderirse katalog adina (apiUrl) yazilir — adaptor apiUrl'i once okur
    const gh = setup({ type: 'GHOST', credentials: enc({ apiUrl: 'https://eski.ornek.com', adminApiKey: 'id:00' }) });
    await gh.svc.update('t1', { credentials: { siteUrl: 'https://yeni.ornek.com' } }, user);
    expect(gh.stored()).toEqual({ apiUrl: 'https://yeni.ornek.com', adminApiKey: 'id:00' });

    // Ikisi birden gelirse katalog adi kazanir (adaptorun okuma sirasi)
    const both = setup({ type: 'GHOST', credentials: enc({ adminApiKey: 'id:00' }) });
    await both.svc.update('t1', { credentials: { siteUrl: 'https://b.ornek.com', apiUrl: 'https://a.ornek.com' } }, user);
    expect(both.stored()).toEqual({ apiUrl: 'https://a.ornek.com', adminApiKey: 'id:00' });

    // Ters sira, katalog adi ONCE: oncelik kurali yalniz bu sirada is gorur.
    // Yukaridaki sira tek basina bos bir testti; duz yineleme zaten son gelen
    // katalog degerinde biterdi, kural silinse de yesil kalirdi. Kural
    // olmasaydi eski ad (siteUrl) adresi ezer, yazilar yanlis Ghost sitesine giderdi.
    const catalogFirst = setup({ type: 'GHOST', credentials: enc({ adminApiKey: 'id:00' }) });
    await catalogFirst.svc.update('t1', { credentials: { apiUrl: 'https://a.ornek.com', siteUrl: 'https://b.ornek.com' } }, user);
    expect(catalogFirst.stored()).toEqual({ apiUrl: 'https://a.ornek.com', adminApiKey: 'id:00' });
  });

  it('SFTP: panel "user" yazinca adaptorun ONCE okudugu eski "username" silinir', async () => {
    const { svc, stored } = setup({ type: 'SFTP', credentials: enc({ host: 'ftp.ornek.com', username: 'eski', password: 'p' }) });
    await svc.update('t1', { credentials: { user: 'yeni' } }, user);
    expect(stored()).toEqual({ host: 'ftp.ornek.com', user: 'yeni', password: 'p' });
  });

  it('eski bicim kayit (duz nesne + alan alan sifreli) okunur, birlestirilip yeni bicimde yazilir', async () => {
    const { svc, updates, stored } = setup({
      type: 'WORDPRESS_REST',
      credentials: { siteUrl: 'https://blog.ornek.com', username: encrypt('editor'), appPassword: encrypt('eski') },
    });
    await svc.update('t1', { credentials: { appPassword: 'yeni' } }, user);
    expect(Object.keys(updates[0].credentials)).toEqual(['enc']);
    expect(stored()).toEqual({ siteUrl: 'https://blog.ornek.com', username: 'editor', appPassword: 'yeni' });
  });
});

describe('PublishTargetsService.update — adres denetimi birlesmis kimlikle', () => {
  it('degismeyen alan da denetlenir: denetim oncesinden kalma ic adres yakalanir', async () => {
    const { svc, updates } = setup({ type: 'WORDPRESS_REST', credentials: { siteUrl: 'http://10.0.0.5', username: 'u', appPassword: 'p' } });
    await expect(svc.update('t1', { credentials: { appPassword: 'yeni' } }, user))
      .rejects.toThrow(/^Site URL: özel veya iç ağ adresi/);
    expect(updates).toHaveLength(0);
  });

  it('denetim, gonderilmeyen ama kayitta kalan adresi de cozer', async () => {
    const { svc, resolved } = setup({ type: 'WORDPRESS_REST', credentials: enc(WP) });
    await svc.update('t1', { credentials: { appPassword: 'yeni' } }, user);
    expect(resolved).toEqual(['https://blog.ornek.com/']);
  });

  it('hata metni formdaki alan adiyla: Strapi URL, WHMCS URL (eskiden ikisi de "Base URL")', async () => {
    const strapi = setup({ type: 'STRAPI', credentials: enc({ baseUrl: 'https://cms.ornek.com', token: 't' }) });
    await expect(strapi.svc.update('t1', { credentials: { baseUrl: 'http://10.0.0.8:1337' } }, user)).rejects.toThrow(/^Strapi URL: /);
    const whmcs = setup({ type: 'WHMCS_KB', credentials: enc(WHMCS) });
    await expect(whmcs.svc.update('t1', { credentials: { baseUrl: 'http://192.168.1.4' } }, user)).rejects.toThrow(/^WHMCS URL: /);
  });

  it('yalniz ad/aktiflik/varsayilan degisince kayitli adres yeniden cozulmez, kimlik yazilmaz', async () => {
    const { svc, updates, resolved } = setup({ type: 'WORDPRESS_REST', credentials: { siteUrl: 'http://127.0.0.1', username: 'u', appPassword: 'p' } });
    await svc.update('t1', { name: 'Yeni ad', isActive: false, isDefault: true }, user);
    expect(resolved).toHaveLength(0);
    expect(updates[0]).toEqual({ name: 'Yeni ad', isActive: false, isDefault: true });
  });
});

describe('PublishTargetsService.update — okunamayan kayit', () => {
  it('kismi gonderim reddedilir ve eksik zorunlu alanlar formdaki adlariyla soylenir', async () => {
    const { svc, updates } = setup({ type: 'WORDPRESS_REST', credentials: { enc: 'bozuk' } });
    await expect(svc.update('t1', { credentials: { appPassword: 'yeni' } }, user))
      .rejects.toThrow('Kayıtlı bağlantı bilgileri okunamadığı için yalnız değiştirdiğin alanlar kaydedilemez. Tüm bağlantı bilgilerini yeniden gir; eksik: Site URL, Kullanıcı adı.');
    expect(updates).toHaveLength(0);
  });

  it('tum zorunlu alanlar gelirse kayit yenilenir (testConnection\'in "yeniden girin" yolu)', async () => {
    const { svc, stored } = setup({ type: 'WORDPRESS_REST', credentials: { enc: 'bozuk' } });
    await svc.update('t1', { credentials: { siteUrl: 'https://yeni.ornek.com', username: 'u', appPassword: 'p' } }, user);
    expect(stored()).toEqual({ siteUrl: 'https://yeni.ornek.com', username: 'u', appPassword: 'p' });
  });
});

describe('WordPress Kategori ID — kayitta denetlenir', () => {
  it('kategori adi reddedilir (formdaki alan adiyla), sayi ve liste kabul', async () => {
    const { svc } = setup({ type: 'WORDPRESS_REST', credentials: enc(WP) });
    await expect(svc.update('t1', { config: { postStatus: 'draft', categoryId: 'Haberler' } }, user))
      .rejects.toThrow("Kategori ID: kategori adı değil, sayısal kategori ID'si girin (ör. 12; birden fazlası için 12,15).");
    await expect(svc.update('t1', { config: { postStatus: 'draft', categoryId: '12, 15' } }, user)).resolves.toBeTruthy();
    await expect(svc.update('t1', { config: { postStatus: 'draft', categoryId: '' } }, user)).resolves.toBeTruthy();
  });

  it('yeni hedefte de ayni kural', async () => {
    const { svc } = setup({ type: 'WORDPRESS_REST', credentials: enc(WP) });
    await expect(svc.create('s1', { type: 'WORDPRESS_REST', name: 'WP', credentials: WP, config: { categoryId: 'Genel' } }, user))
      .rejects.toThrow(/^Kategori ID: /);
    await expect(svc.create('s1', { type: 'WORDPRESS_REST', name: 'WP', credentials: WP, config: { categoryId: '3' } }, user)).resolves.toBeTruthy();
  });
});

describe('kimlik yardimcilari', () => {
  it('readStoredCredentials: bos kayit bos nesne; bicimsiz enc ve nesne olmayan deger okunamaz', () => {
    expect(readStoredCredentials(null)).toEqual({ ok: true, creds: {} });
    expect(readStoredCredentials({ enc: 'bozuk' })).toEqual({ ok: false });
    expect(readStoredCredentials({ enc: encrypt('"dize"') })).toEqual({ ok: false });
    expect(readStoredCredentials('duz-metin')).toEqual({ ok: false });
    expect(readStoredCredentials(enc({ a: '1' }))).toEqual({ ok: true, creds: { a: '1' } });
  });

  it('mergeCredentials: prototip anahtarlari yazilmaz; degisiklik yoksa changed=false', () => {
    const patch = JSON.parse('{"__proto__": {"x": 1}, "constructor": "y", "token": "t"}');
    const { merged, changed } = mergeCredentials('GITHUB', { owner: 'o' }, patch);
    expect(changed).toBe(true);
    expect(merged).toEqual({ owner: 'o', token: 't' });
    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
    expect(mergeCredentials('GITHUB', { owner: 'o' }, { owner: '', repo: undefined }).changed).toBe(false);
  });

  it('mergeCredentials: ayni alan iki adla gelirse sira ne olursa olsun katalog adi kazanir', () => {
    // Katalog adi once gelen sira, oncelik kurali olmadan { apiUrl: 'b' } verirdi
    expect(mergeCredentials('GHOST', {}, { apiUrl: 'a', siteUrl: 'b' }).merged).toEqual({ apiUrl: 'a' });
    expect(mergeCredentials('GHOST', {}, { siteUrl: 'b', apiUrl: 'a' }).merged).toEqual({ apiUrl: 'a' });
    // Katalog adiyla gelen null (acik silme) da kazanir: eski adli deger alani geri yazmaz
    expect(mergeCredentials('GHOST', { apiUrl: 'x', adminApiKey: 'k' }, { apiUrl: null, siteUrl: 'b' }).merged)
      .toEqual({ adminApiKey: 'k' });
    // Katalog adi bos gelirse (sozlesme: bos = degistirme) eski adli deger uygulanir
    expect(mergeCredentials('GHOST', { apiUrl: 'x' }, { apiUrl: '', siteUrl: 'b' }).merged).toEqual({ apiUrl: 'b' });
  });
});
