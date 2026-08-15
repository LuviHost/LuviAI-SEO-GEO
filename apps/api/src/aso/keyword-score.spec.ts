import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { AsoKeywordService } from './keyword.service.js';

/**
 * Anahtar kelime skorlarinin DURUSTLUGU.
 *
 * NEDEN VAR — kullanici panelde 50 kelimenin HEPSINDE "Pop. 10" gorup
 * "yanlislik mi var?" diye sordu. Uretimde olculdu ve iki ayri sorun cikti:
 *
 *  1. iOS'ta popularity KADEMELI BIR SKOR DEGIL, IKILI BIR SINYAL.
 *     aso-v2 iOS icin `zScore(8000, oneriVar ? 5000 : 0)` hesapliyor
 *     (analyzer.js:78-82), yani matematiksel olarak yalnizca iki sonuc
 *     uretilebilir: 6.63 (-> 66) ya da 1.0 (-> 10). Ara deger YOK.
 *     Canli olcum: "kredi" 66, "oyun" 66, "ticari leasing" 10.
 *     Android'de ayni alan gercekten kademeli: 89 ve 92.
 *     "10/100" diye gostermek kullaniciya "olculmus ama dusuk" dedirtiyordu;
 *     dogrusu "Apple bu terime hic oneri vermiyor".
 *
 *  2. normalizeScore olculemeyeni 0 donuyordu ve `?? 0` NaN'i yakalamiyordu
 *     (NaN ?? 0 -> NaN). Yani "magaza cevap vermedi" sessizce "olctuk, sifir
 *     cikti"ya donusuyordu. Rank tarafinda bu ayrim `measurable` bayragiyla
 *     kurulmustu; skor tarafinda eksikti.
 */

const KAYNAK = readFileSync(new URL('./keyword.service.ts', import.meta.url), 'utf8');

/** private normalizeScore'a testten erisim */
const norm = (v: number | null) =>
  (new AsoKeywordService(null as never) as any).normalizeScore(v) as number | null;

describe('normalizeScore — olculemedi != sifir', () => {
  it('null girdi null doner, 0 DEGIL', () => {
    expect(norm(null)).toBeNull();
  });

  it('NaN null doner — eskiden 0 oluyordu', () => {
    expect(norm(NaN)).toBeNull();
  });

  it('Infinity null doner', () => {
    expect(norm(Infinity)).toBeNull();
  });

  it('gercek deger 0-100 olcegine cekiliyor', () => {
    expect(norm(6.63)).toBe(66);
    expect(norm(1.0)).toBe(10);
    expect(norm(8.91)).toBe(89);
  });
});

describe('ham deger cikarimi', () => {
  it('`?? 0` kalibi kalmamis — NaN yakalanmali', () => {
    expect(KAYNAK, 'NaN yine 0 olarak gecebilir').not.toMatch(/scores\?\.difficulty\?\.score \?\? 0/);
    expect(KAYNAK).not.toMatch(/scores\?\.traffic\?\.score \?\? 0/);
    expect(KAYNAK).toContain('Number.isFinite');
  });

  it('normalizeScore imzasi null kabul ediyor ve null donebiliyor', () => {
    expect(KAYNAK).toMatch(/normalizeScore\(v: number \| null\): number \| null/);
    expect(KAYNAK, 'olculemeyen yine 0 donuyor').not.toMatch(/if \(v == null \|\| isNaN\(v\)\) return 0;/);
  });

  it('TALEP skoru installs\'ten turuyor — suggest\'ten degil', () => {
    // Eski hali: suggest.score ?? installs.score. Iki sorun vardi —
    //  1. `??` sag tarafi HIC calismiyordu (suggest.score her zaman sonlu,
    //     taban 1.0), yani olu koddu.
    //  2. Karistirmak yanlisti: suggest "otomatik tamamlamada mi",
    //     installs "rakipler ne kadar buyuk" — ayni sutun satirdan satira
    //     farkli sey anlatirdi.
    expect(KAYNAK).toContain('const popularityRaw = sayi(scores?.traffic?.installs?.score);');
    expect(KAYNAK, 'eski karisik fallback geri donmus').not.toMatch(
      /popularityRaw = sayi\(scores\?\.traffic\?\.suggest\?\.score\) \?\?/,
    );
  });

  it('oneri sinyali AYRI alanda donuyor', () => {
    expect(KAYNAK).toContain('oneriliyor:');
    // Taban deger (1.0) "oneri yok" demek; ustundeki her sey "oneriliyor".
    expect(KAYNAK).toMatch(/suggest\?\.score\) === null[\s\S]*?> 1/);
  });

  it('hata yolunda oneriliyor null donuyor — "onermiyor" ile karistirilmiyor', () => {
    const hata = KAYNAK.slice(KAYNAK.indexOf('} catch (err: any) {'), KAYNAK.indexOf('private normalizeScore'));
    expect(hata).toContain('oneriliyor: null');
  });

  it('hata yolunda tum skorlar null — sekil tutarli', () => {
    const hata = KAYNAK.slice(KAYNAK.indexOf('} catch (err: any) {'), KAYNAK.indexOf('private normalizeScore'));
    expect(hata).toMatch(/popularity: null, difficulty: null, traffic: null/);
  });
});

describe('arayuz — ikili sinyal sayi gibi cizilmiyor', () => {
  const UI = readFileSync(
    new URL('../../../web/src/app/(dashboard)/sites/[id]/aso/page.tsx', import.meta.url),
    'utf8',
  );

  it('sutun "Talep" adiyla geri gelmis, yaniltici "Pop." adi kullanilmiyor', () => {
    // "Pop." adi yanlisti: olculen sey populerlik degil, o terimde siralanan
    // uygulamalarin buyuklugu. Isim de olcumle ayni seyi soylemeli.
    //
    // YORUMLAR HARIC tutuluyor: kodda eski adin GECMISI anlatiliyor ve o
    // metni yasaklamak, aciklamayi silmeye zorlardi.
    const gorunen = UI.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(gorunen).toContain('Talep');
    expect(gorunen, 'yaniltici eski baslik geri donmus').not.toContain('Pop.');
  });

  it('oneri sinyali AYRI rozet — talep sayisina karistirilmamis', () => {
    expect(UI).toContain('kw.suggested');
    expect(UI).toContain('✦');
  });

  it('talep 0/null iken sayi degil "olculemedi" gosteriliyor', () => {
    expect(UI).toMatch(/kw\.popularity \?/);
    expect(UI).toContain('bu terimde sıralanan uygulama bulunamadı');
  });

  it('Rank tooltip\'i magaza derinligini dogru soyluyor', () => {
    expect(UI, 'Android icin 100 vaat ediliyor').not.toMatch(/gerçek sırası \(1-100\)/);
    expect(UI).toContain('~25-30');
  });

  it('Diff/Traffic hucrelerinde `> 0` suzgeci kalmamis', () => {
    // Sunucu artik olculemeyeni null donuyor; `> 0` gercek bir 0'i da
    // gizlerdi (gerci aso-v2 tabani 1.0 oldugu icin gercek 0 uretilemez).
    expect(UI).not.toMatch(/kw\.difficulty != null && kw\.difficulty > 0/);
    expect(UI).not.toMatch(/kw\.traffic != null && kw\.traffic > 0/);
  });
});

/**
 * Kelime aynalama — magaza basina ayri satir.
 *
 * NEDEN VAR: TrackedAppKeyword magaza basina AYRI satir tutuyor
 * (@@unique([trackedAppId, keyword, store])) cunku ayni kelimenin App Store
 * ve Play sirasi farkli seylerdir. Ama kelime ekleme kutusunun magaza secici
 * varsayilan iOS'ta aciliyor; dokunulmazsa her kelime yalnizca iOS'a
 * yaziliyor. Uretimde tam olarak bu oldu: 91 kelimenin TAMAMI iOS, Android'de
 * tek bir olcum bile yok. Kullanici "sadece ios icin mi siralama yapiliyor?"
 * diye sordu — evet, cunku Android satiri hic olusturulmamis.
 */
describe('mirrorKeywords', () => {
  async function kur(app: any, kaynak: any[], hedef: any[]) {
    const { AsoService } = await import('./aso.service.js');
    const yazilan: any = { data: null };
    const prisma = {
      trackedApp: { findUnique: async () => app },
      trackedAppKeyword: {
        findMany: async ({ where }: any) =>
          where.store === 'IOS' ? kaynak : hedef,
        createMany: async (a: any) => { yazilan.data = a.data; return { count: a.data.length }; },
      },
    };
    const n = null as any;
    const svc = new AsoService(prisma as any, n, n, n, n, n, n);
    return { yazilan, sonuc: await svc.mirrorKeywords({ trackedAppId: 'a1', from: 'IOS', to: 'ANDROID' }).catch((e: Error) => e) };
  }

  const app = { id: 'a1', name: 'KobiPratik', appStoreId: '676', playStoreId: 'com.x' };

  it('eksik kelimeleri hedef magazaya kopyaliyor', async () => {
    const { yazilan, sonuc }: any = await kur(app, [{ keyword: 'kobi kredisi', source: 'manual' }, { keyword: 'ticari leasing', source: 'ai' }], []);
    expect(sonuc.eklenen).toBe(2);
    expect(yazilan.data.every((d: any) => d.store === 'ANDROID')).toBe(true);
    expect(yazilan.data[0].keyword).toBe('kobi kredisi');
  });

  it('zaten var olan kelimeyi TEKRAR eklemiyor', async () => {
    const { sonuc }: any = await kur(
      app,
      [{ keyword: 'kobi kredisi', source: 'manual' }, { keyword: 'ticari leasing', source: 'ai' }],
      [{ keyword: 'Kobi Kredisi' }],  // buyuk/kucuk harf farki
    );
    expect(sonuc.eklenen, 'buyuk/kucuk harf farki mukerrer satir uretti').toBe(1);
    expect(sonuc.zatenVardi).toBe(1);
  });

  it('hedef magaza bagli DEGILSE reddediyor — olculemeyecek satir uretmiyor', async () => {
    const { sonuc }: any = await kur({ ...app, playStoreId: null }, [{ keyword: 'x', source: 'm' }], []);
    expect(sonuc).toBeInstanceOf(Error);
    expect((sonuc as Error).message).toMatch(/Google Play/);
  });

  it('kaynak ve hedef ayni olamaz', async () => {
    const { AsoService } = await import('./aso.service.js');
    const svc = new AsoService({} as any, null as any, null as any, null as any, null as any, null as any, null as any);
    await expect(svc.mirrorKeywords({ trackedAppId: 'a1', from: 'IOS', to: 'IOS' })).rejects.toThrow(/aynı olamaz/);
  });

  it('kopyalanacak kelime yoksa acik hata veriyor', async () => {
    const { sonuc }: any = await kur(app, [], []);
    expect(sonuc).toBeInstanceOf(Error);
    expect((sonuc as Error).message).toMatch(/kelime yok/);
  });
});
