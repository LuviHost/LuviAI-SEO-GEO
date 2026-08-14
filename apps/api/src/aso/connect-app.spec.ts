import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Ayni uygulamanin ikinci magazasi YENI uygulama degildir.
 *
 * NEDEN VAR — uretimde yasandi (14 Agustos 2026): KobiPratik iOS'ta takip
 * ediliyordu (appStoreId dolu, playStoreId null). Kullanici ayni uygulamanin
 * Android surumunu eklemek istedi ve "Plan limiti: 3 uygulama" hatasi aldi
 * (HTTP 403).
 *
 * IKI KUSUR birlikte calisiyordu:
 *
 *  A) Kayit (appStoreId, playStoreId) CIFTIYLE araniyordu. iOS'ta zaten
 *     takip edilen bir uygulamanin Android'i eklenirken cift eslesmiyor,
 *     kayit "yeni" sayiliyor ve kotaya takiliyordu. Halbuki sema tek bir
 *     TrackedApp'in HEM appStoreId HEM playStoreId tutmasina izin veriyor —
 *     bunlar ayni urunun iki magazasi.
 *
 *  B) Arama `?? ''` ile bos dize ariyor ama create `?? null` yaziyordu.
 *     MySQL'de '' ile NULL esit degil ve NULL iceren unique indeks tekrari
 *     engellemez; yani ayni Android uygulamasi iki kez eklenirse arama yine
 *     bulamaz ve MUKERRER satir olusurdu.
 */

const KAYNAK = readFileSync(new URL('./aso.service.ts', import.meta.url), 'utf8');
const CONNECT = KAYNAK.slice(KAYNAK.indexOf('async connectApp('), KAYNAK.indexOf('async listApps('));

describe('connectApp — magaza birlestirme', () => {
  it('kayit MAGAZA KIMLIGIYLE araniyor, cift ile degil', () => {
    // Eski hali: findUnique({ siteId_appStoreId_playStoreId_country: {...} })
    expect(CONNECT, 'hala bilesik cift ile araniyor').not.toContain('siteId_appStoreId_playStoreId_country');
    expect(CONNECT).toContain('OR: [');
    expect(CONNECT).toMatch(/appStoreId: dto\.appStoreId/);
    expect(CONNECT).toMatch(/playStoreId: dto\.playStoreId/);
  });

  it("`?? ''` kalmamis — bos dize ile NULL karistirilmiyor", () => {
    expect(CONNECT, "arama hala bos dize kullaniyor").not.toMatch(/appStoreId: dto\.appStoreId \?\? ''/);
    expect(CONNECT).not.toMatch(/playStoreId: dto\.playStoreId \?\? ''/);
  });

  it('eslesme VARSA kota kontrolu CALISMIYOR', () => {
    // Kota yalnizca gercekten yeni uygulamada tuketilmeli.
    expect(CONNECT).toMatch(/if \(!eslesme\) \{[\s\S]*?enforceTrackedAppQuota/);
  });

  it('magaza kimlikleri birlestiriliyor — eski kimlik silinmiyor', () => {
    // Android eklenirken iOS kimligi kaybolursa o magazadaki tum siralama
    // gecmisi koparadi.
    expect(CONNECT).toContain('dto.appStoreId ?? eslesme?.appStoreId ?? null');
    expect(CONNECT).toContain('dto.playStoreId ?? eslesme?.playStoreId ?? null');
  });

  it('olculemeyen magazanin puani EZILMIYOR', () => {
    // Yalnizca Android eklenirken iOS puani null'a dusmemeli.
    expect(CONNECT).toMatch(/\.\.\.\(ios \? \{ iosRating/);
    expect(CONNECT).toMatch(/\.\.\.\(android \? \{ androidRating/);
  });

  it('upsert yerine acik create/update — hangi yolun secildigi belli', () => {
    expect(CONNECT).toContain('trackedApp.update(');
    expect(CONNECT).toContain('trackedApp.create(');
    expect(CONNECT).not.toContain('trackedApp.upsert(');
  });
});

describe('connectApp — davranis', () => {
  /** connectApp'i gercek sinifla, sahte bagimliliklarla calistirir. */
  async function calistir(mevcut: any, dto: any) {
    const { AsoService } = await import('./aso.service.js');
    const cagrilar: any = { kotaKontrolu: 0, update: null, create: null };

    const prisma = {
      trackedApp: {
        findFirst: async () => mevcut,
        update: async (a: any) => { cagrilar.update = a; return { id: 'x', ...a.data }; },
        create: async (a: any) => { cagrilar.create = a; return { id: 'y', ...a.data }; },
      },
      site: { findUnique: async () => ({ userId: 'u1' }) },
    };
    const quota = {
      enforceTrackedAppQuota: async () => {
        cagrilar.kotaKontrolu++;
        throw new Error('Plan limiti: 3 uygulama');
      },
    };
    const scrapers = {
      getIosApp: async () => ({ title: 'KobiPratik', score: 5, reviews: 10, developer: 'E', primaryGenre: 'Business', icon: 'i' }),
      getAndroidApp: async () => ({ title: 'KobiPratik', score: 4.2, reviews: 8, developer: 'E', genre: 'Business', icon: 'i' }),
    };
    // Kurucu sirasi: prisma, scrapers, keywords, tracker, reviews, aiAgent, quota
    const n = null as any;
    const svc = new AsoService(prisma as any, scrapers as any, n, n, n, n, quota as any);
    return { svc, cagrilar, sonuc: await svc.connectApp(dto).catch((e: Error) => e) };
  }

  it('iOS\'ta takip edilen uygulamaya Android eklenince KOTAYA TAKILMIYOR', async () => {
    // Uretimdeki tam senaryo.
    const { cagrilar, sonuc } = await calistir(
      { id: 'app1', appStoreId: '6762136975', playStoreId: null, name: 'KobiPratik' },
      { siteId: 's1', playStoreId: 'com.kobipratik.app', country: 'tr' },
    );
    expect(sonuc, 'kota hatasi firlatildi').not.toBeInstanceOf(Error);
    expect(cagrilar.kotaKontrolu, 'kota kontrolu calisti — ayni uygulama yeni sayilmis').toBe(0);
    expect(cagrilar.update, 'mevcut kayit guncellenmedi').not.toBeNull();
    expect(cagrilar.create, 'yeni kayit acildi — ayni uygulama ikilendi').toBeNull();
  });

  it('birlestirmede iOS kimligi KORUNUYOR', async () => {
    const { cagrilar } = await calistir(
      { id: 'app1', appStoreId: '6762136975', playStoreId: null, name: 'KobiPratik' },
      { siteId: 's1', playStoreId: 'com.kobipratik.app', country: 'tr' },
    );
    expect(cagrilar.update.data.appStoreId, 'iOS kimligi silinmis — siralama gecmisi koparadi').toBe('6762136975');
    expect(cagrilar.update.data.playStoreId).toBe('com.kobipratik.app');
  });

  it('GERCEKTEN yeni uygulamada kota kontrolu CALISIYOR', async () => {
    const { cagrilar, sonuc } = await calistir(null, {
      siteId: 's1', appStoreId: '999', country: 'tr',
    });
    expect(cagrilar.kotaKontrolu, 'kota atlandi — limitsiz uygulama eklenebilirdi').toBe(1);
    expect(sonuc).toBeInstanceOf(Error);
  });

  it('yalnizca Android eklenirken iOS puani null\'a dusmuyor', async () => {
    const { cagrilar } = await calistir(
      { id: 'app1', appStoreId: '6762136975', playStoreId: null, name: 'KobiPratik' },
      { siteId: 's1', playStoreId: 'com.kobipratik.app', country: 'tr' },
    );
    expect(cagrilar.update.data).not.toHaveProperty('iosRating');
    expect(cagrilar.update.data.androidRating).toBe(4.2);
  });
});
