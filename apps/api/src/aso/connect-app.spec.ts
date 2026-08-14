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
        // Ad eslestirmesi bu yolu kullanir: hedef magaza yuvasi bos olan
        // kayitlar. Testte mevcut kaydi aday olarak veriyoruz.
        findMany: async () => (mevcut ? [mevcut] : []),
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

/**
 * IKINCI MAGAZA — paylasilan kimlik YOKKEN.
 *
 * Ilk duzeltme kaydi magaza kimligiyle ariyordu ve bu, gercek senaryoyu
 * COZMEDI: iOS'ta takip edilen bir uygulamanin Android'i eklenirken elimizde
 * yalnizca playStoreId var, mevcut kaydin playStoreId'si ise null — ortak
 * hicbir kimlik yok, arama zorunlu olarak bos doner ve kota yine patlar.
 * Kullanici "hala ekleyemiyorum" dedi ve hakliydi.
 *
 * Ikinci olcut AD. Uc korumasi var: hedef yuva bos olmali, tam olarak bir
 * aday eslesmeli, ad normalize edilmeli.
 */
describe('ikinci magaza — ortak kimlik olmadan', () => {
  async function kur(adaylar: any[], dto: any) {
    const { AsoService } = await import('./aso.service.js');
    const cagrilar: any = { kotaKontrolu: 0, update: null, create: null };
    const prisma = {
      trackedApp: {
        findFirst: async () => null,            // magaza kimligiyle eslesme YOK
        findMany: async () => adaylar,          // ad eslestirmesinin adaylari
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
      getIosApp: async () => ({ title: 'KobiPratik', score: 5, reviews: 10, developer: 'Emir Burgazl', primaryGenre: 'B', icon: 'i' }),
      getAndroidApp: async () => ({ title: 'KobiPratik', score: 4.2, reviews: 8, developer: 'Emirhan Burgazli', genre: 'B', icon: 'i' }),
    };
    const n = null as any;
    const svc = new AsoService(prisma as any, scrapers as any, n, n, n, n, quota as any);
    return { cagrilar, sonuc: await svc.connectApp(dto).catch((e: Error) => e) };
  }

  const iosKaydi = { id: 'app1', name: 'KobiPratik', appStoreId: '6762136975', playStoreId: null };

  it('AD ile esleserek mevcut kayda baglaniyor — kota tuketilmiyor', async () => {
    const { cagrilar, sonuc } = await kur([iosKaydi], {
      siteId: 's1', playStoreId: 'com.kobipratik.app', country: 'tr',
    });
    expect(sonuc, 'yine kotaya takildi').not.toBeInstanceOf(Error);
    expect(cagrilar.kotaKontrolu).toBe(0);
    expect(cagrilar.update?.where?.id, 'mevcut kayit guncellenmedi').toBe('app1');
    expect(cagrilar.update.data.playStoreId).toBe('com.kobipratik.app');
    expect(cagrilar.update.data.appStoreId, 'iOS kimligi kayboldu').toBe('6762136975');
  });

  it('GELISTIRICI ADI farkli olsa da esliyor', async () => {
    // Uretim gercegi: ayni uygulama iOS'ta "Emir Burgazl", Play'de
    // "Emirhan Burgazli". Gelistiriciyi zorunlu tutmak dogru birlestirmeyi
    // engellerdi.
    const { cagrilar } = await kur([{ ...iosKaydi, developer: 'Emir Burgazl' }], {
      siteId: 's1', playStoreId: 'com.kobipratik.app', country: 'tr',
    });
    expect(cagrilar.update).not.toBeNull();
  });

  it('ad normalize ediliyor — buyuk/kucuk, aksan, bosluk, noktalama', async () => {
    const { cagrilar } = await kur([{ ...iosKaydi, name: 'Kobi-Pratik' }], {
      siteId: 's1', playStoreId: 'com.kobipratik.app', country: 'tr',
    });
    expect(cagrilar.update, '"Kobi-Pratik" ile "KobiPratik" eslesmedi').not.toBeNull();
  });

  it('BIRDEN FAZLA aday varsa birlestirmiyor — belirsizlikte yeni kayit', async () => {
    const { cagrilar, sonuc } = await kur(
      [iosKaydi, { id: 'app2', name: 'KobiPratik', appStoreId: '999', playStoreId: null }],
      { siteId: 's1', playStoreId: 'com.kobipratik.app', country: 'tr' },
    );
    expect(cagrilar.update, 'belirsizken yanlis kayda baglandi').toBeNull();
    expect(cagrilar.kotaKontrolu, 'kota atlandi').toBe(1);
    expect(sonuc).toBeInstanceOf(Error);
  });

  it('ad tutmuyorsa birlestirmiyor — farkli uygulamalar karismasin', async () => {
    const { cagrilar } = await kur([{ ...iosKaydi, name: 'Bambaska Uygulama' }], {
      siteId: 's1', playStoreId: 'com.kobipratik.app', country: 'tr',
    });
    expect(cagrilar.update, 'alakasiz uygulamaya baglandi').toBeNull();
    expect(cagrilar.kotaKontrolu).toBe(1);
  });

  it('kota kontrolu metadata VE ad eslestirmesinden SONRA calisiyor', () => {
    const i = CONNECT.indexOf('const name =');
    const j = CONNECT.indexOf('uyanlar.length === 1');
    const k = CONNECT.indexOf('enforceTrackedAppQuota');
    expect(i, 'ad hesaplanmiyor').toBeGreaterThan(0);
    expect(j, 'ad eslestirmesi yok').toBeGreaterThan(i);
    expect(k, 'kota ad eslestirmesinden ONCE calisiyor — eski hata').toBeGreaterThan(j);
  });
});
