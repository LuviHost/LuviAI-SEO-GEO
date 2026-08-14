import { describe, it, expect } from 'vitest';
import { SiteReportService, olculemedi, type RaporGovdesi } from './site-report.service.js';

/**
 * Rapor bolumlerinin DURUSTLUGU.
 *
 * NEDEN VAR: bu kod tabaninda tekrarlayan hata sinifi "veri yokken sifir
 * yazmak". Sifir bir OLCUMDUR ve grafikte dusus gibi okunur; olcumun yoklugu
 * bambaska bir seydir. Uretimde olculdu (14 Agustos 2026):
 *   - AsaPerformanceDaily      0 satir  -> ASA bolumu sifir gosterirse
 *                                          "hic yukleme olmadi" yalani olur
 *   - GeoPromptRun             0 satir
 *   - AgentReadinessScan       0 satir
 *   - AppRanking           14909 satir  -> ASO gercekten karsilastirilabilir
 *   - AiCitationSnapshot    4097 satir  -> GEO gercekten karsilastirilabilir
 *
 * Bu testler her bolumun "veri yok" yolunu ve olcum matematigini sabitler.
 */

/** Sadece ilgili modelleri tanimlayan sahte Prisma. */
function sahtePrisma(veri: Record<string, any>) {
  const bos = { findMany: async () => [], findFirst: async () => null, count: async () => 0, groupBy: async () => [] };
  return new Proxy({} as any, {
    get: (_t, ad: string) => veri[ad] ?? bos,
  });
}

function servis(veri: Record<string, any>) {
  // Ucuncu bagimlilik AppliedFixService — testlerde bos ozet doner.
  const sahteFix = {
    donemOzeti: async () => ({ toplam: 0, etkilenenSayfa: 0, turBazinda: [], basarisiz: 0, geriAlinan: 0 }),
  };
  return new SiteReportService(sahtePrisma(veri) as never, null as never, sahteFix as never);
}

/** private bolum ureticilerine testten erisim */
const cagir = (s: SiteReportService, ad: string, ...args: any[]) => (s as any)[ad](...args);

const DONEM = {
  range: 'custom' as const,
  rangeStart: new Date('2026-05-01'),
  rangeEnd: new Date('2026-08-01'),
  prevStart: new Date('2026-02-01'),
  prevEnd: new Date('2026-05-01'),
  days: 92,
};

const snap = (gun: string, provider: string, score: number | null, available = true, cited = 0, mentioned = 0) => ({
  date: new Date(gun), provider, score, available, citedCount: cited, mentionedCount: mentioned,
});

describe('GEO bolumu', () => {
  it('hic snapshot yoksa OLCULEMEDI — sifir degil', async () => {
    const r = await cagir(servis({ aiCitationSnapshot: { findMany: async () => [] } }), 'geoBolumu', 's1', DONEM);
    expect(r.olculemedi).toBe(true);
    expect(r.neden).toMatch(/olcum/i);
    expect(r.sonSkor, 'olculemeyen bolum skor tasimamali').toBeUndefined();
  });

  it('ilk ve son GUNUN ortalamasi aliniyor, tek snapshot degil', async () => {
    const veri = {
      aiCitationSnapshot: {
        findMany: async () => [
          snap('2026-05-01', 'anthropic', 10), snap('2026-05-01', 'openai', 30),
          snap('2026-08-01', 'anthropic', 60), snap('2026-08-01', 'openai', 80),
        ],
      },
      audit: { findMany: async () => [] },
      aiCrawlerHit: { count: async () => 0 },
      aiReferrerHit: { count: async () => 0 },
    };
    const r = await cagir(servis(veri), 'geoBolumu', 's1', DONEM);
    expect(r.olculemedi).toBe(false);
    expect(r.ilkSkor).toBe(20);
    expect(r.sonSkor).toBe(70);
    expect(r.delta).toBe(50);
    expect(r.olcumGunu).toBe(2);
  });

  it('olculemeyen saglayici (available=false) ortalamayi ASAGI CEKMIYOR', async () => {
    // available=false + score=null bir olcum degil; ortalamaya girerse
    // "gorunurluk dustu" yalanini uretir.
    const veri = {
      aiCitationSnapshot: {
        findMany: async () => [
          snap('2026-05-01', 'anthropic', 40),
          snap('2026-08-01', 'anthropic', 40),
          snap('2026-08-01', 'openai', null, false),
        ],
      },
      audit: { findMany: async () => [] },
      aiCrawlerHit: { count: async () => 0 },
      aiReferrerHit: { count: async () => 0 },
    };
    const r = await cagir(servis(veri), 'geoBolumu', 's1', DONEM);
    expect(r.sonSkor, 'olculemeyen saglayici ortalamaya karismis').toBe(40);
    expect(r.delta).toBe(0);
  });

  it('GERCEKTEN olculup 0 cikan skor ortalamaya GIRIYOR', async () => {
    // available=true + score=0: sorgu calisti, site hic gecmedi. Bu gercek
    // bir olcumdur ve gizlenmemeli.
    const veri = {
      aiCitationSnapshot: {
        findMany: async () => [snap('2026-05-01', 'anthropic', 40), snap('2026-08-01', 'anthropic', 0)],
      },
      audit: { findMany: async () => [] },
      aiCrawlerHit: { count: async () => 0 },
      aiReferrerHit: { count: async () => 0 },
    };
    const r = await cagir(servis(veri), 'geoBolumu', 's1', DONEM);
    expect(r.sonSkor).toBe(0);
    expect(r.delta).toBe(-40);
  });

  it('alintilanan/anilan ham sayimlari topluyor', async () => {
    const veri = {
      aiCitationSnapshot: {
        findMany: async () => [snap('2026-05-01', 'anthropic', 40, true, 2, 3), snap('2026-08-01', 'anthropic', 50, true, 5, 6)],
      },
      audit: { findMany: async () => [] },
      aiCrawlerHit: { count: async () => 0 },
      aiReferrerHit: { count: async () => 0 },
    };
    const r = await cagir(servis(veri), 'geoBolumu', 's1', DONEM);
    expect(r.alintilanan).toBe(7);
    expect(r.anilan).toBe(9);
  });
});

describe('ASO bolumu', () => {
  const app = (keywords: string[]) => ({
    id: 'a1', name: 'Test App', appStoreId: '123', playStoreId: null, country: 'tr',
    keywords: keywords.map((k) => ({ id: k, store: 'IOS' })),
  });

  it('izlenen uygulama yoksa OLCULEMEDI', async () => {
    const r = await cagir(servis({ trackedApp: { findMany: async () => [] } }), 'asoBolumu', 's1', DONEM);
    expect(r.olculemedi).toBe(true);
    expect(r.neden).toMatch(/uygulama/i);
  });

  it('uygulama var ama donemde olcum yoksa OLCULEMEDI — sifir sira degil', async () => {
    const veri = {
      trackedApp: { findMany: async () => [app(['k1'])] },
      appRanking: { findMany: async () => [] },
    };
    const r = await cagir(servis(veri), 'asoBolumu', 's1', DONEM);
    expect(r.olculemedi).toBe(true);
  });

  it('sirada KUCUK daha iyi — dusen sayi "yukselen" sayiliyor', async () => {
    const veri = {
      trackedApp: { findMany: async () => [app(['k1', 'k2'])] },
      appRanking: {
        findMany: async () => [
          { trackedAppKeywordId: 'k1', position: 40, checkedAt: new Date('2026-05-01') },
          { trackedAppKeywordId: 'k2', position: 20, checkedAt: new Date('2026-05-01') },
          { trackedAppKeywordId: 'k1', position: 12, checkedAt: new Date('2026-08-01') },
          { trackedAppKeywordId: 'k2', position: 25, checkedAt: new Date('2026-08-01') },
        ],
      },
    };
    const r = await cagir(servis(veri), 'asoBolumu', 's1', DONEM);
    expect(r.olculemedi).toBe(false);
    const u = r.uygulamalar[0];
    expect(u.ilkOrtalamaSira).toBe(30);
    expect(u.sonOrtalamaSira).toBe(18.5);
    expect(u.delta, 'iyilesme negatif delta olmali (sira dustu)').toBe(-11.5);
    expect(u.yukselen, 'k1 40->12 yukseldi').toBe(1);
    expect(u.dusen, 'k2 20->25 dustu').toBe(1);
  });

  it('ilk 100 disindaki kelime (position null) ortalamaya KATILMIYOR', async () => {
    // null'a 100 gibi bir sayi uydurmak "sira 100" yalanini uretirdi.
    const veri = {
      trackedApp: { findMany: async () => [app(['k1', 'k2'])] },
      appRanking: {
        findMany: async () => [
          { trackedAppKeywordId: 'k1', position: 10, checkedAt: new Date('2026-05-01') },
          { trackedAppKeywordId: 'k2', position: null, checkedAt: new Date('2026-05-01') },
          { trackedAppKeywordId: 'k1', position: 8, checkedAt: new Date('2026-08-01') },
          { trackedAppKeywordId: 'k2', position: null, checkedAt: new Date('2026-08-01') },
        ],
      },
    };
    const r = await cagir(servis(veri), 'asoBolumu', 's1', DONEM);
    const u = r.uygulamalar[0];
    expect(u.ilkOrtalamaSira, 'null pozisyon ortalamaya karismis').toBe(10);
    expect(u.sonOrtalamaSira).toBe(8);
    expect(u.kelimeSayisi, 'izlenen kelime sayisi yine 2').toBe(2);
  });

  it('magaza etiketi appStoreId/playStoreId varligindan tureniyor', async () => {
    const ikisiDe = {
      id: 'a1', name: 'Cift', appStoreId: '1', playStoreId: 'com.x', country: 'tr',
      keywords: [{ id: 'k1', store: 'IOS' }],
    };
    const veri = {
      trackedApp: { findMany: async () => [ikisiDe] },
      appRanking: { findMany: async () => [{ trackedAppKeywordId: 'k1', position: 5, checkedAt: new Date('2026-05-01') }] },
    };
    const r = await cagir(servis(veri), 'asoBolumu', 's1', DONEM);
    expect(r.uygulamalar[0].store).toBe('iOS + Android');
  });
});

describe('ASA bolumu', () => {
  it('hesap yoksa OLCULEMEDI', async () => {
    const r = await cagir(servis({ asaAccount: { findFirst: async () => null } }), 'asaBolumu', 's1', DONEM);
    expect(r.olculemedi).toBe(true);
    expect(r.neden).toMatch(/hesab/i);
  });

  it('kampanya var ama performans satiri YOKSA olculemedi — SIFIR YUKLEME DEGIL', async () => {
    // Uretim gercegi: AsaPerformanceDaily bos. "0 yukleme" demek "reklam
    // hic donusturmedi" anlamina gelir ve YANLIS; dogrusu "olcum akmiyor".
    const veri = {
      asaAccount: { findFirst: async () => ({ id: 'acc' }) },
      asaCampaign: { findMany: async () => [{ id: 'c1' }] },
      asaPerformanceDaily: { findMany: async () => [] },
    };
    const r = await cagir(servis(veri), 'asaBolumu', 's1', DONEM);
    expect(r.olculemedi).toBe(true);
    expect(r.neden).toMatch(/performans/i);
    expect(r.yukleme, 'olculemeyen bolum sayi tasimamali').toBeUndefined();
  });

  it('veri varsa toplayip CPI hesapliyor', async () => {
    const veri = {
      asaAccount: { findFirst: async () => ({ id: 'acc' }) },
      asaCampaign: { findMany: async () => [{ id: 'c1' }] },
      asaPerformanceDaily: {
        findMany: async ({ where }: any) =>
          where.date.gte.getTime() === DONEM.rangeStart.getTime()
            ? [{ impressions: 1000, taps: 100, installs: 20, spendUsd: 40 }]
            : [{ impressions: 800, taps: 50, installs: 5, spendUsd: 30 }],
      },
    };
    const r = await cagir(servis(veri), 'asaBolumu', 's1', DONEM);
    expect(r.olculemedi).toBe(false);
    expect(r.yukleme).toBe(20);
    expect(r.cpi).toBe(2);
    expect(r.oncekiDonem.cpi).toBe(6);
  });

  it('yukleme sifirken CPI null — sifira bolme yok', async () => {
    const veri = {
      asaAccount: { findFirst: async () => ({ id: 'acc' }) },
      asaCampaign: { findMany: async () => [{ id: 'c1' }] },
      asaPerformanceDaily: { findMany: async () => [{ impressions: 100, taps: 3, installs: 0, spendUsd: 5 }] },
    };
    const r = await cagir(servis(veri), 'asaBolumu', 's1', DONEM);
    expect(r.cpi).toBeNull();
  });
});

describe('olculemedi yardimcisi', () => {
  it('bayrak ve neden tasiyor, baska alan tasimıyor', () => {
    const o = olculemedi('sebep');
    expect(o).toEqual({ olculemedi: true, neden: 'sebep' });
  });
});

/**
 * Uretimde gorulen UC YANILTICI SAYI — hepsi ayni hata sinifi.
 *
 * Ilk gercek rapor uretildiginde ciktiya bakildi ve su uc sey duzeltildi:
 *
 *  1. "14.766 tiklama (+14.766)" — onceki donemde HIC snapshot yoktu
 *     (kobipratik'in ilk GSC kaydi 15 Mayis), prevClicks=0 oldugu icin fark
 *     toplamin kendisi cikiyordu. "Sifirdan buraya geldik" gibi okunuyordu.
 *  2. "ortalama sira 3" — 50 kelime izleniyor ama yalnizca 2'si ilk 100
 *     icinde hem basta hem sonda olculebilmis. Kac kelimeden hesaplandigi
 *     yazilmazsa "uygulama 3. sirada" sanilir.
 *  3. "AI maliyeti $0.00" — TokenUsageRecord'un 1413 satirinin yalnizca
 *     56'sinda siteId dolu (%96 atifsiz). Kayit yoklugu "para harcanmadi"
 *     degil, "harcama bu siteye baglanmamis" demek.
 */
describe('yaniltici sayilar — uretim dersleri', () => {
  it('ASO ortalamasinin kac kelimeden geldigi raporlaniyor', async () => {
    const veri = {
      trackedApp: {
        findMany: async () => [{
          id: 'a1', name: 'App', appStoreId: '1', playStoreId: null, country: 'tr',
          keywords: Array.from({ length: 50 }, (_, i) => ({ id: `k${i}`, store: 'IOS' })),
        }],
      },
      appRanking: {
        findMany: async () => [
          // 50 kelimeden yalnizca 2'si ilk 100'de olculebilmis
          { trackedAppKeywordId: 'k0', position: 3, checkedAt: new Date('2026-05-01') },
          { trackedAppKeywordId: 'k1', position: 5, checkedAt: new Date('2026-05-01') },
          { trackedAppKeywordId: 'k0', position: 2, checkedAt: new Date('2026-08-01') },
          { trackedAppKeywordId: 'k1', position: 4, checkedAt: new Date('2026-08-01') },
          ...Array.from({ length: 48 }, (_, i) => ({
            trackedAppKeywordId: `k${i + 2}`, position: null, checkedAt: new Date('2026-08-01'),
          })),
        ],
      },
    };
    const r = await cagir(servis(veri), 'asoBolumu', 's1', DONEM);
    const u = r.uygulamalar[0];
    expect(u.kelimeSayisi, 'izlenen kelime').toBe(50);
    expect(u.karsilastirilabilirKelime, 'ortalama yalnizca 2 kelimeden geliyor, bu yazilmali').toBe(2);
    expect(u.sonOrtalamaSira).toBe(3);
  });

  it('bu siteye atfedilmis token kaydi yoksa maliyet null — $0.00 degil', async () => {
    const veri = {
      article: { findMany: async () => [] },
      socialPost: { count: async () => 0 },
      studioAsset: { count: async () => 0 },
      audit: { count: async () => 0 },
      tokenUsageRecord: { groupBy: async () => [] },
    };
    const r = await cagir(servis(veri), 'isDokumu', 's1', DONEM);
    expect(r.aiMaliyetiUsd, '$0.00 "hic para harcanmadi" gibi okunur').toBeNull();
    expect(r.maliyetKayitSayisi).toBe(0);
  });

  it('kayit varsa maliyet ve kapsam birlikte donuyor', async () => {
    const veri = {
      article: { findMany: async () => [] },
      socialPost: { count: async () => 0 },
      studioAsset: { count: async () => 0 },
      audit: { count: async () => 0 },
      tokenUsageRecord: {
        groupBy: async () => [
          { context: 'article', _sum: { costUsd: 1.5 }, _count: 3 },
          { context: 'audit', _sum: { costUsd: 0.25 }, _count: 2 },
        ],
      },
    };
    const r = await cagir(servis(veri), 'isDokumu', 's1', DONEM);
    expect(r.aiMaliyetiUsd).toBe(1.75);
    expect(r.maliyetKayitSayisi).toBe(5);
    expect(r.maliyetKirilimi[0].is).toBe('article');
  });
});

/**
 * Uygulanan duzeltmeler — kayit katmani sonrasi.
 *
 * NEDEN VAR: bu satir uzun sure rapora GIREMIYORDU. snippet-applier,
 * static-html-fixer ve auto-fix siteye gercek degisiklik yaziyor ama hicbiri
 * kalici kayit acmiyordu; auto-fix ustelik en son Audit satirinin
 * fixesApplied alaninin uzerine yazip onceki kosumun izini siliyordu.
 * AppliedFix tablosu eklendikten sonra sayilabilir hale geldi.
 */
describe('uygulanan duzeltmeler', () => {
  const temelVeri = {
    article: { findMany: async () => [] },
    socialPost: { count: async () => 0 },
    studioAsset: { count: async () => 0 },
    audit: { count: async () => 0 },
    tokenUsageRecord: { groupBy: async () => [] },
  };

  const servisFix = (ozet: any) => {
    const sahteFix = { donemOzeti: async () => ozet };
    return new SiteReportService(
      new Proxy({} as any, {
        get: (_t, ad: string) =>
          (temelVeri as any)[ad] ?? { findMany: async () => [], count: async () => 0, groupBy: async () => [] },
      }) as never,
      null as never,
      sahteFix as never,
    );
  };

  it('hic kayit yoksa null — "0 duzeltme" demiyor', async () => {
    // Kayit katmani 14 Agustos 2026'da eklendi; oncesindeki donemlerde
    // "0 duzeltme uygulandi" demek yanlis olurdu, cunku kayit tutulmuyordu.
    const s = servisFix({ toplam: 0, etkilenenSayfa: 0, turBazinda: [], basarisiz: 0, geriAlinan: 0 });
    const r = await cagir(s, 'isDokumu', 's1', DONEM);
    expect(r.uygulananDuzeltme).toBeNull();
  });

  it('kayit varsa ozet raporda gorunuyor', async () => {
    const s = servisFix({
      toplam: 12, etkilenenSayfa: 5,
      turBazinda: [{ tur: 'meta_title', adet: 5 }, { tur: 'canonical', adet: 4 }],
      basarisiz: 2, geriAlinan: 0,
    });
    const r = await cagir(s, 'isDokumu', 's1', DONEM);
    expect(r.uygulananDuzeltme.toplam).toBe(12);
    expect(r.uygulananDuzeltme.etkilenenSayfa).toBe(5);
    expect(r.uygulananDuzeltme.turBazinda[0].tur).toBe('meta_title');
  });

  it('yalnizca basarisiz kayit varsa da bolum gorunuyor — sessiz kalmiyor', async () => {
    const s = servisFix({ toplam: 0, etkilenenSayfa: 0, turBazinda: [], basarisiz: 3, geriAlinan: 0 });
    const r = await cagir(s, 'isDokumu', 's1', DONEM);
    expect(r.uygulananDuzeltme, 'basarisiz denemeler gizlenmis').not.toBeNull();
    expect(r.uygulananDuzeltme.basarisiz).toBe(3);
    expect(r.uygulananDuzeltme.toplam, 'basarisizlar "uygulandi" sayilmis').toBe(0);
  });
});

/**
 * Magaza arama derinligi.
 *
 * NEDEN VAR: kod her sorguda 100 sonuc istiyor ama magazalar farkli davraniyor.
 * Uretimde olculdu (14 Agustos 2026, num=50/100/250 ile ayni terimler):
 *   App Store  istenen kadar doner  (100 -> 100, 250 -> 210)
 *   Play       num NE OLURSA OLSUN 23-30'da tavan yapiyor
 *
 * Yani Android'de position=null "ilk 100 disinda" DEGIL, "ilk ~25 disinda"
 * demek. Rapor 100 varsayarsa olcmedigi bir seyi olcmus gibi gosterir.
 */
describe('ASO — olculen derinlik', () => {
  const app = (n: number) => ({
    id: 'a1', name: 'App', appStoreId: null, playStoreId: 'com.x', country: 'tr',
    keywords: Array.from({ length: n }, (_, i) => ({ id: `k${i}`, store: 'ANDROID' })),
  });

  it('gercek derinlik totalResults\'tan turetiliyor, 100 varsayilmiyor', async () => {
    const veri = {
      trackedApp: { findMany: async () => [app(2)] },
      appRanking: {
        findMany: async () => [
          { trackedAppKeywordId: 'k0', position: 3, totalResults: 25, checkedAt: new Date('2026-05-01') },
          { trackedAppKeywordId: 'k0', position: 2, totalResults: 27, checkedAt: new Date('2026-08-01') },
          { trackedAppKeywordId: 'k1', position: null, totalResults: 24, checkedAt: new Date('2026-08-01') },
        ],
      },
    };
    const r = await cagir(servis(veri), 'asoBolumu', 's1', DONEM);
    expect(r.uygulamalar[0].olculenDerinlik, 'derinlik 100 varsayilmis').toBe(25);
  });

  it('MEDYAN aliniyor — tek bozuk olcum ortalamayi bozmasin', async () => {
    const veri = {
      trackedApp: { findMany: async () => [app(1)] },
      appRanking: {
        findMany: async () => [
          { trackedAppKeywordId: 'k0', position: 1, totalResults: 30, checkedAt: new Date('2026-05-01') },
          { trackedAppKeywordId: 'k0', position: 1, totalResults: 28, checkedAt: new Date('2026-06-01') },
          { trackedAppKeywordId: 'k0', position: 1, totalResults: 1, checkedAt: new Date('2026-08-01') },
        ],
      },
    };
    const r = await cagir(servis(veri), 'asoBolumu', 's1', DONEM);
    // Siralanmis: [1, 28, 30] -> medyan 28. Ortalama olsaydi 19.7 cikardi.
    expect(r.uygulamalar[0].olculenDerinlik).toBe(28);
  });

  it('hic gecerli derinlik yoksa null — sahte bir sayi uretilmiyor', async () => {
    const veri = {
      trackedApp: { findMany: async () => [app(1)] },
      appRanking: {
        findMany: async () => [
          { trackedAppKeywordId: 'k0', position: 5, totalResults: null, checkedAt: new Date('2026-05-01') },
        ],
      },
    };
    const r = await cagir(servis(veri), 'asoBolumu', 's1', DONEM);
    expect(r.uygulamalar[0].olculenDerinlik).toBeNull();
  });
});
