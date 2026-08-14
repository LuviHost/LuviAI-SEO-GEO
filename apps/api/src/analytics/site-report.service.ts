import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { ReportsService, donemHesapla, type ReportOpts, type ReportOverview } from './reports.service.js';

/**
 * Bir metrik bolumu ya OLCULDU ya da OLCULEMEDI.
 *
 * Bu ayrimi tip seviyesine tasimak bilincli: bu kod tabaninda tekrarlayan
 * hata sinifi "veri yokken sifir yazmak" oldu. Sifir bir olcumdur ve grafikte
 * dusus gibi okunur; olcumun yoklugu ise bambaska bir sey. `olculemedi`
 * bayragi tasiyan bir bolumu arayuz "veri yok" olarak gostermek ZORUNDA.
 */
export type Olculebilir<T> = ({ olculemedi: false } & T) | { olculemedi: true; neden: string };

export function olculemedi(neden: string): { olculemedi: true; neden: string } {
  return { olculemedi: true, neden };
}

export interface GeoBolumu {
  /** Donem sonundaki AI gorunurluk skoru (0-100) */
  sonSkor: number | null;
  /** Donem basindaki skor — karsilastirma referansi */
  ilkSkor: number | null;
  delta: number | null;
  /** Kac farkli gunde olcum yapildi — seri yogunlugu, guven gostergesi */
  olcumGunu: number;
  /** Saglayici bazinda donem ortalamasi */
  saglayicilar: Array<{ provider: string; ilk: number | null; son: number | null; delta: number | null }>;
  /** Audit'ten gelen teknik GEO skoru (llms.txt, schema, FAQ...) */
  teknikGeoSkoru: number | null;
  teknikGeoDelta: number | null;
  /** Donem boyunca kac probe'ta site kaynak olarak ALINTILANDI (ham sayim) */
  alintilanan: number;
  /** Kac probe'ta marka adi anildi (alinti olmadan da olabilir) */
  anilan: number;
  /** AI botlarinin siteyi ziyaret sayisi */
  aiBotZiyareti: number;
  /** AI'dan gelen gercek ziyaretci */
  aiReferrer: number;
}

export interface AsoBolumu {
  uygulamalar: Array<{
    id: string;
    ad: string;
    store: string;
    /** Izlenen kelime sayisi */
    kelimeSayisi: number;
    /** Donem basi / sonu ortalama sira (yalnizca ilk 100'de olculebilenler) */
    ilkOrtalamaSira: number | null;
    sonOrtalamaSira: number | null;
    delta: number | null;
    yukselen: number;
    dusen: number;
    /** Ilk 10'a giren kelime sayisi (donem sonu) */
    ilkOnda: number;
    /**
     * Ortalama siranin KAC kelimeden hesaplandigi.
     *
     * Kritik: 50 kelime izlenirken bunlarin cogu ilk 100 disinda olabilir ve
     * ortalamaya girmez. Bu sayi yazilmazsa "ortalama sira 3" ifadesi
     * "uygulama 3. sirada" gibi okunur — halbuki yalnizca 2 kelimenin
     * ortalamasi olabilir. Uretimde tam olarak boyle cikti.
     */
    karsilastirilabilirKelime: number;
    olcumGunu: number;
  }>;
  toplamKelime: number;
  ortalamaSiraDelta: number | null;
}

export interface AsaBolumu {
  kampanya: number;
  gosterim: number;
  dokunma: number;
  yukleme: number;
  harcamaUsd: number;
  cpi: number | null;
  oncekiDonem: { yukleme: number; harcamaUsd: number; cpi: number | null } | null;
}

export interface IsDokumu {
  yayinlananMakale: number;
  toplamKelime: number | null;
  sosyalPost: number;
  studioVarligi: number;
  kullaniciTaramasi: number;
  cozulenSorun: number | null;
  /**
   * Bu siteye ATFEDILEN AI maliyeti. Kayit yoksa null — 0 DEGIL.
   *
   * NEDEN ONEMLI: uretimde olculdu, TokenUsageRecord'un 1413 satirinin
   * yalnizca 56'sinda siteId dolu (%96'si atifsiz). Bir sitede kayit
   * bulunmamasi "hic para harcanmadi" demek DEGIL, "harcama bu siteye
   * baglanmamis" demek. $0.00 yazmak ikincisini birincisi gibi gosterirdi.
   */
  aiMaliyetiUsd: number | null;
  /** Kac token kaydindan hesaplandi — kapsam gostergesi */
  maliyetKayitSayisi: number;
  /** Maliyetin ise gore kirilimi — TokenUsageRecord.context */
  maliyetKirilimi: Array<{ is: string; usd: number }>;
}

export interface RaporGovdesi {
  meta: {
    siteId: string;
    siteAdi: string;
    siteUrl: string;
    period: string;
    periodStart: string;
    periodEnd: string;
    prevStart: string;
    prevEnd: string;
    uretildi: string;
    /** Bu rapor hangi surumle uretildi — sema degisince eski raporlar okunabilsin */
    surum: 1;
  };
  seo: ReportOverview;
  geo: Olculebilir<GeoBolumu>;
  aso: Olculebilir<AsoBolumu>;
  asa: Olculebilir<AsaBolumu>;
  is: IsDokumu;
}

/** Ortalama — bos dizide null, 0 DEGIL. */
function ort(sayilar: number[]): number | null {
  if (!sayilar.length) return null;
  return sayilar.reduce((a, b) => a + b, 0) / sayilar.length;
}

@Injectable()
export class SiteReportService {
  private readonly log = new Logger(SiteReportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: ReportsService,
  ) {}

  // ────────────────────────────────────────────────────────────────
  //  URETIM
  // ────────────────────────────────────────────────────────────────

  /**
   * Raporu uretir ve DONDURUR.
   *
   * Senkron calisir: butun bolumler indeksli Prisma sorgulari, dis servise
   * gidilmiyor. Kuyruga alinmadi cunku kuyruk hem gereksiz gecikme hem de
   * (bu oturumda oldugu gibi) ayri bir hata yuzeyi demek.
   */
  async generate(
    siteId: string,
    opts: ReportOpts & { userId?: string; trigger?: 'manual' | 'cron' | 'api' } = {},
  ) {
    const t0 = Date.now();
    const site = await this.prisma.site.findUnique({
      where: { id: siteId },
      select: { id: true, name: true, url: true },
    });
    if (!site) throw new NotFoundException('Site bulunamadi');

    const donem = donemHesapla(opts);

    const [seo, geo, aso, asa, is] = await Promise.all([
      this.reports.overview(siteId, { from: donem.rangeStart, to: donem.rangeEnd }),
      this.geoBolumu(siteId, donem),
      this.asoBolumu(siteId, donem),
      this.asaBolumu(siteId, donem),
      this.isDokumu(siteId, donem),
    ]);

    const govde: RaporGovdesi = {
      meta: {
        siteId,
        siteAdi: site.name,
        siteUrl: site.url,
        period: donem.range,
        periodStart: donem.rangeStart.toISOString(),
        periodEnd: donem.rangeEnd.toISOString(),
        prevStart: donem.prevStart.toISOString(),
        prevEnd: donem.prevEnd.toISOString(),
        uretildi: new Date().toISOString(),
        surum: 1,
      },
      seo,
      geo,
      aso,
      asa,
      is,
    };

    return this.prisma.siteReport.create({
      data: {
        siteId,
        userId: opts.userId ?? null,
        period: donem.range,
        periodStart: donem.rangeStart,
        periodEnd: donem.rangeEnd,
        trigger: opts.trigger ?? 'manual',
        data: govde as any,
        // Liste kolonlari — hepsi "olculemedi ise null"
        seoScore: seo.audit.overallScore,
        geoScore: seo.audit.geoScore,
        aiVisibility: geo.olculemedi ? null : geo.sonSkor,
        asoAvgRank: aso.olculemedi ? null : aso.uygulamalar[0]?.sonOrtalamaSira ?? null,
        clicks: seo.search.totalClicks,
        impressions: seo.search.totalImpressions,
        articlesPublished: seo.articles.published,
        costUsd: is.aiMaliyetiUsd ?? 0,
        durationMs: Date.now() - t0,
      },
    });
  }

  // ────────────────────────────────────────────────────────────────
  //  GEO — AI gorunurlugu
  // ────────────────────────────────────────────────────────────────

  private async geoBolumu(
    siteId: string,
    d: ReturnType<typeof donemHesapla>,
  ): Promise<Olculebilir<GeoBolumu>> {
    const snapshots = await this.prisma.aiCitationSnapshot.findMany({
      where: { siteId, date: { gte: d.rangeStart, lte: d.rangeEnd } },
      orderBy: { date: 'asc' },
    });

    if (snapshots.length === 0) {
      return olculemedi(
        'Bu donemde AI gorunurluk olcumu yapilmamis. Olcum, site taramasi calistirildiginda veya gunluk citation cron\'u ile olusur.',
      );
    }

    const gunler = new Set(snapshots.map((s) => s.date.toISOString().slice(0, 10)));

    // Ilk ve son GUNUN ortalamasi — tek bir snapshot'a bakmak saglayici
    // dagilimina gore zipladigi icin yanilticidir.
    const ilkGun = snapshots[0].date.toISOString().slice(0, 10);
    const sonGun = snapshots[snapshots.length - 1].date.toISOString().slice(0, 10);
    const ilkler = snapshots.filter((s) => s.date.toISOString().slice(0, 10) === ilkGun);
    const sonlar = snapshots.filter((s) => s.date.toISOString().slice(0, 10) === sonGun);

    // AiCitationSnapshot.score `Int?` — null, saglayicinin OLCUM DONDUREMEDIGI
    // anlamina geliyor (available=false). Bu satirlar ortalamaya girmez;
    // girseydi "gorunurluk dustu" yalanini uretirdi. Sifir ise gercek bir
    // olcumdur (sorgu calisti, site hic gecmedi) ve ortalamaya GIRER.
    const gecerli = (liste: typeof snapshots) =>
      liste.filter((s) => s.available && s.score !== null).map((s) => s.score as number);

    const ilkSkorHam = ort(gecerli(ilkler));
    const sonSkorHam = ort(gecerli(sonlar));
    const ilkSkor = ilkSkorHam === null ? null : Math.round(ilkSkorHam);
    const sonSkor = sonSkorHam === null ? null : Math.round(sonSkorHam);

    // Saglayici kirilimi
    const adlar = [...new Set(snapshots.map((s) => s.provider))].sort();
    const saglayicilar = adlar.map((ad) => {
      const i = ort(gecerli(ilkler.filter((s) => s.provider === ad)));
      const so = ort(gecerli(sonlar.filter((s) => s.provider === ad)));
      return {
        provider: ad,
        ilk: i === null ? null : Math.round(i),
        son: so === null ? null : Math.round(so),
        delta: i === null || so === null ? null : Math.round(so - i),
      };
    });

    // Donem boyunca kac probe'ta site ALINTILANDI / MARKA ANILDI.
    // Skor turetilmis bir sayi; bunlar ham sayim ve musteriye anlatmasi kolay.
    const alintilanan = snapshots.reduce((a, s) => a + s.citedCount, 0);
    const anilan = snapshots.reduce((a, s) => a + s.mentionedCount, 0);

    // Teknik GEO skoru — Audit.geoScore, donemin ilk/son taramasi
    const auditler = await this.prisma.audit.findMany({
      where: { siteId, ranAt: { gte: d.rangeStart, lte: d.rangeEnd }, geoScore: { not: null } },
      orderBy: { ranAt: 'asc' },
      select: { geoScore: true },
    });
    const teknikIlk = auditler[0]?.geoScore ?? null;
    const teknikSon = auditler[auditler.length - 1]?.geoScore ?? null;

    const [aiBotZiyareti, aiReferrer] = await Promise.all([
      this.prisma.aiCrawlerHit.count({ where: { siteId, date: { gte: d.rangeStart, lte: d.rangeEnd } } }),
      this.prisma.aiReferrerHit.count({ where: { siteId, date: { gte: d.rangeStart, lte: d.rangeEnd } } }),
    ]);

    return {
      olculemedi: false,
      sonSkor,
      ilkSkor,
      delta: ilkSkor === null || sonSkor === null ? null : sonSkor - ilkSkor,
      olcumGunu: gunler.size,
      saglayicilar,
      teknikGeoSkoru: teknikSon,
      teknikGeoDelta: teknikIlk === null || teknikSon === null ? null : teknikSon - teknikIlk,
      alintilanan,
      anilan,
      aiBotZiyareti,
      aiReferrer,
    };
  }

  // ────────────────────────────────────────────────────────────────
  //  ASO — uygulama magazasi siralamalari
  // ────────────────────────────────────────────────────────────────

  private async asoBolumu(
    siteId: string,
    d: ReturnType<typeof donemHesapla>,
  ): Promise<Olculebilir<AsoBolumu>> {
    const apps = await this.prisma.trackedApp.findMany({
      where: { siteId },
      select: {
        id: true,
        name: true,
        // TrackedApp'te tek bir `store` alani YOK; ayni kayit hem iOS hem
        // Android kimligi tasiyabiliyor. Magaza etiketi bunlardan turetilir.
        appStoreId: true,
        playStoreId: true,
        country: true,
        keywords: { select: { id: true, store: true } },
      },
    });

    if (apps.length === 0) {
      return olculemedi('Bu siteye bagli izlenen uygulama yok. ASO raporu icin once bir uygulama eklenmeli.');
    }

    const tumKelimeIds = apps.flatMap((a) => a.keywords.map((k) => k.id));
    if (tumKelimeIds.length === 0) {
      return olculemedi('Izlenen uygulama var ama takip edilen anahtar kelime yok.');
    }

    const siralamalar = await this.prisma.appRanking.findMany({
      where: { trackedAppKeywordId: { in: tumKelimeIds }, checkedAt: { gte: d.rangeStart, lte: d.rangeEnd } },
      orderBy: { checkedAt: 'asc' },
      select: { trackedAppKeywordId: true, position: true, checkedAt: true },
    });

    if (siralamalar.length === 0) {
      return olculemedi('Bu donemde siralama olcumu kaydedilmemis.');
    }

    const uygulamalar = apps.map((app) => {
      const kelimeIds = new Set(app.keywords.map((k) => k.id));
      const kayitlar = siralamalar.filter((r) => kelimeIds.has(r.trackedAppKeywordId));
      const gunler = new Set(kayitlar.map((r) => r.checkedAt.toISOString().slice(0, 10)));

      // Kelime basina ilk ve son olcum.
      // position null = ilk 100 disinda; ORTALAMAYA KATILMAZ. 100 gibi bir
      // sayi uydurmak "sira 100" yalanini uretirdi.
      const ilkSon = new Map<string, { ilk: number | null; son: number | null }>();
      for (const r of kayitlar) {
        const mevcut = ilkSon.get(r.trackedAppKeywordId) ?? { ilk: null, son: null };
        if (mevcut.ilk === null && r.position !== null) mevcut.ilk = r.position;
        if (r.position !== null) mevcut.son = r.position;
        ilkSon.set(r.trackedAppKeywordId, mevcut);
      }

      const ciftler = [...ilkSon.values()].filter((v) => v.ilk !== null && v.son !== null) as Array<{ ilk: number; son: number }>;
      const ilkOrt = ort(ciftler.map((c) => c.ilk));
      const sonOrt = ort(ciftler.map((c) => c.son));

      // Sirada KUCUK daha iyi: son < ilk ise yukselmis.
      const yukselen = ciftler.filter((c) => c.son < c.ilk).length;
      const dusen = ciftler.filter((c) => c.son > c.ilk).length;
      const ilkOnda = [...ilkSon.values()].filter((v) => v.son !== null && v.son <= 10).length;

      const magazalar = [app.appStoreId ? 'iOS' : null, app.playStoreId ? 'Android' : null].filter(Boolean);

      return {
        id: app.id,
        ad: app.name,
        store: magazalar.length ? magazalar.join(' + ') : 'bilinmiyor',
        kelimeSayisi: app.keywords.length,
        ilkOrtalamaSira: ilkOrt === null ? null : Math.round(ilkOrt * 10) / 10,
        sonOrtalamaSira: sonOrt === null ? null : Math.round(sonOrt * 10) / 10,
        delta: ilkOrt === null || sonOrt === null ? null : Math.round((sonOrt - ilkOrt) * 10) / 10,
        yukselen,
        dusen,
        ilkOnda,
        karsilastirilabilirKelime: ciftler.length,
        olcumGunu: gunler.size,
      };
    });

    const deltalar = uygulamalar.map((u) => u.delta).filter((x): x is number => x !== null);

    return {
      olculemedi: false,
      uygulamalar,
      toplamKelime: tumKelimeIds.length,
      ortalamaSiraDelta: ort(deltalar),
    };
  }

  // ────────────────────────────────────────────────────────────────
  //  ASA — Apple Search Ads
  // ────────────────────────────────────────────────────────────────

  private async asaBolumu(
    siteId: string,
    d: ReturnType<typeof donemHesapla>,
  ): Promise<Olculebilir<AsaBolumu>> {
    const hesap = await this.prisma.asaAccount.findFirst({ where: { siteId }, select: { id: true } });
    if (!hesap) {
      return olculemedi('Bu siteye bagli Apple Search Ads hesabi yok.');
    }

    const kampanyalar = await this.prisma.asaCampaign.findMany({
      where: { accountId: hesap.id },
      select: { id: true },
    });
    if (kampanyalar.length === 0) {
      return olculemedi('ASA hesabi bagli ama kampanya bulunamadi.');
    }

    const ids = kampanyalar.map((k) => k.id);
    const gunluk = await this.prisma.asaPerformanceDaily.findMany({
      where: { campaignId: { in: ids }, date: { gte: d.rangeStart, lte: d.rangeEnd } },
    });

    if (gunluk.length === 0) {
      // Uretimde bu tablo BOS: kampanya kurulmus ama performans cron'u hic
      // veri yazmamis. Sifir gostermek "hic yukleme olmadi" demek olurdu;
      // dogrusu "olcum akmiyor".
      return olculemedi(
        'ASA performans verisi bu donemde kaydedilmemis. Gunluk performans senkronu calismiyor olabilir.',
      );
    }

    const topla = (liste: any[], alan: string) => liste.reduce((a, x) => a + (Number(x[alan]) || 0), 0);
    const gosterim = topla(gunluk, 'impressions');
    const dokunma = topla(gunluk, 'taps');
    const yukleme = topla(gunluk, 'installs');
    const harcama = topla(gunluk, 'spendUsd');

    const oncekiGunluk = await this.prisma.asaPerformanceDaily.findMany({
      where: { campaignId: { in: ids }, date: { gte: d.prevStart, lte: d.prevEnd } },
    });
    const oncekiYukleme = topla(oncekiGunluk, 'installs');
    const oncekiHarcama = topla(oncekiGunluk, 'spendUsd');

    return {
      olculemedi: false,
      kampanya: kampanyalar.length,
      gosterim,
      dokunma,
      yukleme,
      harcamaUsd: Math.round(harcama * 100) / 100,
      cpi: yukleme > 0 ? Math.round((harcama / yukleme) * 100) / 100 : null,
      oncekiDonem: oncekiGunluk.length
        ? {
            yukleme: oncekiYukleme,
            harcamaUsd: Math.round(oncekiHarcama * 100) / 100,
            cpi: oncekiYukleme > 0 ? Math.round((oncekiHarcama / oncekiYukleme) * 100) / 100 : null,
          }
        : null,
    };
  }

  // ────────────────────────────────────────────────────────────────
  //  YAPILAN IS
  // ────────────────────────────────────────────────────────────────

  /**
   * Yalnizca KALICI KAYDI OLAN isler sayilir.
   *
   * Bilerek DISARIDA birakilanlar — kod calisiyor ama hicbir DB satiri
   * acmiyor, dolayisiyla sayilari uydurulmus olurdu:
   *   - uygulanan meta/schema duzeltmeleri (snippet-applier, static-html-fixer)
   *   - auto-fix adedi (her kosum oncekinin izini siliyor)
   *   - ASO metadata onerileri, App Store yorum cevaplari
   */
  private async isDokumu(siteId: string, d: ReturnType<typeof donemHesapla>): Promise<IsDokumu> {
    const [makaleler, sosyal, studio, tarama, maliyet] = await Promise.all([
      this.prisma.article.findMany({
        where: { siteId, status: 'PUBLISHED' as any, publishedAt: { gte: d.rangeStart, lte: d.rangeEnd } },
        select: { wordCount: true },
      }),
      this.prisma.socialPost.count({
        where: { article: { siteId }, status: 'PUBLISHED' as any, publishedAt: { gte: d.rangeStart, lte: d.rangeEnd } },
      }),
      this.prisma.studioAsset.count({ where: { siteId, createdAt: { gte: d.rangeStart, lte: d.rangeEnd } } }),
      this.prisma.audit.count({
        where: { siteId, trigger: 'user', ranAt: { gte: d.rangeStart, lte: d.rangeEnd } },
      }),
      this.prisma.tokenUsageRecord.groupBy({
        by: ['context'],
        where: { siteId, createdAt: { gte: d.rangeStart, lte: d.rangeEnd } },
        _sum: { costUsd: true },
        _count: true,
      }),
    ]);

    const kelimeler = makaleler.map((m) => Number(m.wordCount) || 0).filter((n) => n > 0);
    const maliyetKirilimi = maliyet
      .map((m) => ({ is: m.context ?? 'diger', usd: Math.round(Number(m._sum.costUsd ?? 0) * 10000) / 10000 }))
      .filter((m) => m.usd > 0)
      .sort((a, b) => b.usd - a.usd);

    const kayitSayisi = maliyet.reduce((a: number, m: any) => a + (Number(m._count) || 0), 0);

    return {
      yayinlananMakale: makaleler.length,
      toplamKelime: kelimeler.length ? kelimeler.reduce((a, b) => a + b, 0) : null,
      sosyalPost: sosyal,
      studioVarligi: studio,
      kullaniciTaramasi: tarama,
      cozulenSorun: null, // seo.audit.cozulenSayisi'ndan okunur; burada tekrar hesaplanmaz
      // Hic kayit yoksa null: "harcama yok" ile "harcama bu siteye
      // baglanmamis" ayni sey degil ve ikincisi cok daha olasi (%96 atifsiz).
      aiMaliyetiUsd: kayitSayisi === 0 ? null : Math.round(maliyetKirilimi.reduce((a, b) => a + b.usd, 0) * 100) / 100,
      maliyetKayitSayisi: kayitSayisi,
      maliyetKirilimi: maliyetKirilimi.slice(0, 10),
    };
  }

  // ────────────────────────────────────────────────────────────────
  //  GECMIS
  // ────────────────────────────────────────────────────────────────

  /**
   * Rapor gecmisi. `data` BILEREK cekilmiyor: dondurulmus govde rapor basina
   * yuzlerce KB ve liste ucunda hicbir ise yaramiyor. Ayni gerekce
   * AuditService.getHistory'nin `checks`'i cekmemesiyle ayni.
   */
  async list(siteId: string, limit = 30) {
    const guvenliLimit = Math.min(100, Math.max(1, Math.floor(limit) || 30));
    return this.prisma.siteReport.findMany({
      where: { siteId },
      orderBy: { generatedAt: 'desc' },
      take: guvenliLimit,
      select: {
        id: true, period: true, periodStart: true, periodEnd: true, trigger: true,
        seoScore: true, geoScore: true, aiVisibility: true, asoAvgRank: true,
        clicks: true, impressions: true, articlesPublished: true, costUsd: true,
        status: true, durationMs: true, generatedAt: true,
      },
    });
  }

  async get(siteId: string, reportId: string) {
    const r = await this.prisma.siteReport.findFirst({ where: { id: reportId, siteId } });
    if (!r) throw new NotFoundException('Rapor bulunamadi');
    return r;
  }

  async remove(siteId: string, reportId: string) {
    await this.get(siteId, reportId);
    await this.prisma.siteReport.delete({ where: { id: reportId } });
    return { id: reportId };
  }
}
