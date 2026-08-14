import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { compareAuditRows, type AuditKarsilastirma } from '../audit/audit.service.js';

export type ReportRange = 'week' | 'month' | 'year' | 'custom';

/**
 * Rapor donemi. `from`/`to` verilirse range 'custom' olur ve gun sayisi
 * ikisinin farkindan turer; onceki donem AYNI UZUNLUKTA, hemen oncesidir.
 *
 * NEDEN GEREKLI: imza yalnizca 'week'|'month'|'year' aliyordu, yani
 * "1-31 Temmuz" gibi bir rapor cikarilamiyordu. Alt sorgular zaten
 * `date: { gte, lte }` kullaniyordu — eksik olan sadece parametre yuzeyiydi.
 */
export interface ReportOpts {
  range?: ReportRange;
  from?: Date;
  to?: Date;
}

/** Bir metrik olculemedi mi, yoksa gercekten sifir mi — ikisi ayni sey degil. */
export interface OlcumYok {
  olculemedi: true;
  neden: string;
}

export interface ReportOverview {
  range: ReportRange;
  rangeStart: string;
  rangeEnd: string;
  prevStart: string;
  prevEnd: string;
  // Top-line metrikleri
  articles: {
    published: number;
    publishedDelta: number; // onceki donem ile fark
    scheduled: number;
    failed: number;
    avgEditorScore: number | null;
    totalCost: number; // USD
  };
  social: {
    posts: number;
    postsDelta: number;
    byChannel: Record<string, number>;
  };
  search: {
    totalClicks: number;
    totalImpressions: number;
    avgCtr: number;
    avgPosition: number;
    clicksDelta: number;
    impressionsDelta: number;
    topQueries: Array<{ query: string; clicks: number; impressions: number; ctr: number; position: number }>;
    topPages: Array<{ page: string; clicks: number; impressions: number; ctr: number; position: number }>;
  };
  ai: {
    /**
     * Son taramanin AI gorunurluk ortalamasi. HIC saglayici olculemediyse
     * `null` — 0 DEGIL. runAudit `aiCitationAvg ?? 0` yaziyor ve o 0 trend
     * grafiginde sahte bir cokus uretiyordu ("gorunurlugun sifira dustu"),
     * halbuki olcum hic yapilamamisti.
     */
    citationScore: number | null;
    /** citationScore null ise nedeni — arayuz "olcum yok" yazabilsin */
    citationOlcumYok: string | null;
    providers: Array<{ provider: string; label: string; score: number | null; available: boolean }>;
  };
  audit: {
    overallScore: number | null;
    geoScore: number | null;
    issuesCount: number;
    /**
     * Donem icinde GERCEKTEN cozulen sorun sayisi.
     *
     * ONCEDEN: `max(0, ilkTaramaIssueSayisi - sonTaramaIssueSayisi)` idi. Bu
     * bir "duzeltme kaydi" degil, iki uzunlugun farkiydi: donemde 5 sorun
     * cozulup 5 yeni sorun ciktiysa 0 gosteriyordu ve max(0,..) negatifi
     * yutuyordu. Artik compareAuditRows'un `type|page` eslestirmesi
     * kullaniliyor — cozulen, yeni cikan ve devam eden AYRI AYRI sayiliyor.
     */
    cozulenSayisi: number;
    yeniCikanSayisi: number;
    devamEdenSayisi: number;
    /** Donemin ilk ve son taramasi arasindaki tam karsilastirma; tek tarama varsa null */
    karsilastirma: AuditKarsilastirma | null;
    /** Donemde kullanicinin ELLE calistirdigi tarama sayisi (cron/test haric) */
    kullaniciTaramaSayisi: number;
  };
  // Zaman serisi (gunluk)
  timeSeries: {
    dates: string[]; // ISO date YYYY-MM-DD
    publishedArticles: number[];
    socialPosts: number[];
    clicks: number[];
    impressions: number[];
  };
}


/**
 * Donem sinirlarini hesaplar.
 *
 * `from`/`to` verilirse o aralik aynen kullanilir ve range 'custom' olur.
 * Onceki donem HER ZAMAN ayni uzunlukta ve hemen oncesindedir — yuzde
 * degisim ancak esit uzunluktaki iki donem karsilastirilinca anlamli.
 */
export function donemHesapla(o: ReportOpts): {
  range: ReportRange;
  rangeStart: Date;
  rangeEnd: Date;
  prevStart: Date;
  prevEnd: Date;
  days: number;
} {
  if (o.from && o.to) {
    const rangeStart = new Date(o.from);
    const rangeEnd = new Date(o.to);
    if (rangeEnd < rangeStart) throw new Error('Rapor donemi ters: bitis baslangictan once');
    // En az 1 gun; ayni gun secilirse gun sayisi 0 cikip bolme hatasi olurdu.
    const days = Math.max(1, Math.round((+rangeEnd - +rangeStart) / 86400000));
    return {
      range: 'custom',
      rangeStart,
      rangeEnd,
      prevEnd: new Date(rangeStart),
      prevStart: new Date(+rangeStart - days * 86400000),
      days,
    };
  }

  const range: ReportRange = o.range && o.range !== 'custom' ? o.range : 'month';
  const days = range === 'week' ? 7 : range === 'month' ? 30 : 365;
  const rangeEnd = new Date();
  const rangeStart = new Date(+rangeEnd - days * 86400000);
  return {
    range,
    rangeStart,
    rangeEnd,
    prevEnd: new Date(rangeStart),
    prevStart: new Date(+rangeStart - days * 86400000),
    days,
  };
}

/**
 * Snapshot'lardaki sorgu/sayfa detaylarini DONEM GENELINDE toplar.
 *
 * Her snapshot bir gunun ilk 10-N kaydini tutuyor; bunlari tiklama ve
 * gosterime gore toplayip yeniden siralamak, "son gunun listesi"ni donemin
 * listesi diye gostermekten cok daha dogru. CTR ve pozisyon toplanamaz:
 * CTR toplam tiklama/gosterimden yeniden hesaplanir, pozisyon ise
 * GOSTERIMLE AGIRLIKLI ortalanir — duz ortalama, 3 gosterimli bir gunu
 * 3000 gosterimli gunle esit sayardi.
 */
export function detaylariTopla(
  snapshots: Array<Record<string, unknown>>,
  alan: 'queryDetails' | 'pageDetails',
  anahtar: 'query' | 'page',
): any[] {
  const toplam = new Map<string, { clicks: number; impressions: number; posAgirlik: number }>();

  for (const s of snapshots) {
    const kayitlar = s?.[alan];
    if (!Array.isArray(kayitlar)) continue;
    for (const k of kayitlar as any[]) {
      const ad = k?.[anahtar];
      if (typeof ad !== 'string' || !ad) continue;
      const clicks = Number(k.clicks) || 0;
      const impressions = Number(k.impressions) || 0;
      const position = Number(k.position);
      const mevcut = toplam.get(ad) ?? { clicks: 0, impressions: 0, posAgirlik: 0 };
      mevcut.clicks += clicks;
      mevcut.impressions += impressions;
      if (Number.isFinite(position) && impressions > 0) mevcut.posAgirlik += position * impressions;
      toplam.set(ad, mevcut);
    }
  }

  return [...toplam.entries()]
    .map(([ad, v]) => ({
      [anahtar]: ad,
      clicks: v.clicks,
      impressions: v.impressions,
      ctr: v.impressions > 0 ? v.clicks / v.impressions : 0,
      position: v.impressions > 0 ? v.posAgirlik / v.impressions : 0,
    }))
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
    .slice(0, 10);
}

/**
 * AI gorunurluk skoru olculebildi mi?
 *
 * runAudit hicbir saglayici cevap veremediginde `aiCitationAvg ?? 0` yaziyor.
 * O 0 bir OLCUM degil, olcumun YOKLUGU — ama grafikte gercek bir cokus gibi
 * gorunuyor ve "AI gorunurlugun sifira dustu" yalanini uretiyor.
 */
export function citationDegerlendir(aiCitations: any): { skor: number | null; olcumYok: string | null } {
  if (!aiCitations) return { skor: null, olcumYok: 'Bu sitede henuz AI gorunurluk olcumu yapilmadi' };
  const providers: any[] = Array.isArray(aiCitations.providers) ? aiCitations.providers : [];
  const olculebilen = providers.filter((p) => p?.available);
  if (providers.length > 0 && olculebilen.length === 0) {
    return { skor: null, olcumYok: 'Hicbir AI saglayicisi olcum donduremedi (kota, anahtar veya servis hatasi)' };
  }
  const skor = typeof aiCitations.score === 'number' ? aiCitations.score : null;
  if (skor === 0 && olculebilen.length === 0) {
    return { skor: null, olcumYok: 'Olcum yapilamadi' };
  }
  return { skor, olcumYok: null };
}

/**
 * RFC 4180 hucre kacislamasi. Virgul, tirnak veya satir sonu iceren deger
 * tirnaklanir, ic tirnaklar ikilenir. Bu olmadan tek bir sorgu metni
 * ("ankara, oto kiralama") tum tabloyu kaydiriyordu.
 */
export function csvHucre(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

@Injectable()
export class ReportsService {
  private readonly log = new Logger(ReportsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async overview(siteId: string, opts: ReportRange | ReportOpts = 'month'): Promise<ReportOverview> {
    // Eski cagrilar `overview(siteId, 'month')` seklinde; bozmadan genisletiyoruz.
    const o: ReportOpts = typeof opts === 'string' ? { range: opts } : opts;

    const { range, rangeStart, rangeEnd, prevStart, prevEnd, days } = donemHesapla(o);
    const now = rangeEnd;

    // ── Articles ───────────────────────────────────────────────
    const [publishedArticles, prevPublished, scheduled, failed, articleStats] = await Promise.all([
      this.prisma.article.findMany({
        where: { siteId, status: 'PUBLISHED' as any, publishedAt: { gte: rangeStart, lte: now } },
        select: { id: true, publishedAt: true, totalCost: true, editorScore: true },
      }),
      this.prisma.article.count({
        where: { siteId, status: 'PUBLISHED' as any, publishedAt: { gte: prevStart, lte: prevEnd } },
      }),
      this.prisma.article.count({ where: { siteId, status: 'SCHEDULED' as any } }),
      this.prisma.article.count({
        where: { siteId, status: 'FAILED' as any, updatedAt: { gte: rangeStart, lte: now } },
      }),
      this.prisma.article.aggregate({
        where: { siteId, status: 'PUBLISHED' as any, publishedAt: { gte: rangeStart, lte: now } },
        _avg: { editorScore: true, totalCost: true },
        _sum: { totalCost: true },
      }),
    ]);

    // ── Social posts ───────────────────────────────────────────
    const socialPosts = await this.prisma.socialPost.findMany({
      where: {
        article: { siteId },
        status: 'PUBLISHED' as any,
        publishedAt: { gte: rangeStart, lte: now },
      },
      select: { id: true, publishedAt: true, channel: { select: { type: true } } },
    });
    const prevSocialCount = await this.prisma.socialPost.count({
      where: {
        article: { siteId },
        status: 'PUBLISHED' as any,
        publishedAt: { gte: prevStart, lte: prevEnd },
      },
    });
    const byChannel: Record<string, number> = {};
    for (const p of socialPosts) {
      const t = p.channel?.type ?? 'OTHER';
      byChannel[t] = (byChannel[t] ?? 0) + 1;
    }

    // ── GSC analytics ──────────────────────────────────────────
    const snapshots = await this.prisma.analyticsSnapshot.findMany({
      where: { siteId, date: { gte: rangeStart, lte: now } },
      orderBy: { date: 'asc' },
    });
    const prevSnapshots = await this.prisma.analyticsSnapshot.findMany({
      where: { siteId, date: { gte: prevStart, lte: prevEnd } },
    });

    const totalClicks = snapshots.reduce((a, s) => a + s.totalClicks, 0);
    const totalImpressions = snapshots.reduce((a, s) => a + s.totalImpressions, 0);
    // CTR ve pozisyon GOSTERIMLE AGIRLIKLI.
    //
    // Onceden gunlerin duz ortalamasi aliniyordu: 3 gosterimli bir gun,
    // 3000 gosterimli gunle ESIT sayiliyordu. Trafigin dalgali oldugu
    // sitelerde bu, ortalama pozisyonu bir-iki sessiz gunun belirlemesine
    // yol aciyordu. Ayni dosyadaki detaylariTopla zaten dogrusunu yapiyordu;
    // ust seviye ondan geri kalmisti.
    //
    // CTR ayrica ortalanmaz, TOPLAMLARDAN yeniden hesaplanir — oranlarin
    // ortalamasi, oranların toplamı degildir.
    const avgCtr = totalImpressions > 0 ? totalClicks / totalImpressions : 0;
    const posAgirlik = snapshots.reduce((a, s) => a + s.avgPosition * s.totalImpressions, 0);
    const avgPosition = totalImpressions > 0 ? posAgirlik / totalImpressions : 0;
    const prevClicks = prevSnapshots.reduce((a, s) => a + s.totalClicks, 0);
    const prevImpressions = prevSnapshots.reduce((a, s) => a + s.totalImpressions, 0);

    // Top queries / pages — DONEMIN TAMAMI uzerinde toplanir.
    //
    // ONCEDEN yalnizca son snapshot'tan aliniyordu (kodun kendi yorumu bunu
    // itiraf ediyordu: "son snapshot'tan al"). Sonuc: aylik raporda "donemin
    // en cok tiklanan sorgulari" basligi altinda SON GUNUN sorgulari
    // gosteriliyordu. Baslik ile sayi ayni seyi soylemiyordu.
    const topQueries = detaylariTopla(snapshots, 'queryDetails', 'query');
    const topPages = detaylariTopla(snapshots, 'pageDetails', 'page');

    // ── AI citation + audit ────────────────────────────────────
    const lastAudit = await this.prisma.audit.findFirst({
      where: { siteId },
      orderBy: { ranAt: 'desc' },
    });
    const aiCitations = (lastAudit?.checks as any)?.aiCitations;
    const providers = aiCitations?.providers ?? [];
    const citationDurumu = citationDegerlendir(aiCitations);

    // Donemdeki taramalar — karsilastirma icin TAM satir gerekiyor
    // (compareAuditRows checks + issues okuyor, sadece sayilari degil).
    const auditsInRange = await this.prisma.audit.findMany({
      where: { siteId, ranAt: { gte: rangeStart, lte: rangeEnd } },
      orderBy: { ranAt: 'asc' },
    });

    // Ilk ve son tarama arasindaki GERCEK delta. compareAuditRows `type|page`
    // ile eslestirdigi icin "5 cozuldu + 5 yeni cikti" durumunu dogru ayirir;
    // eski uzunluk farki bunu 0 gosteriyordu.
    const karsilastirma =
      auditsInRange.length >= 2
        ? compareAuditRows(auditsInRange[0], auditsInRange[auditsInRange.length - 1])
        : null;

    const lastIssuesCount = Array.isArray(lastAudit?.issues) ? (lastAudit!.issues as any[]).length : 0;

    // "Yapilan is" olarak yalnizca KULLANICININ elle baslattigi taramalar
    // sayilir. AUDIT_CRON acildiginda haftalik otomatik taramalar bu sayiyi
    // kendiliginden sisirirdi; dogrulama kosumlari da ('test') ayni sekilde.
    const kullaniciTaramaSayisi = await this.prisma.audit.count({
      where: { siteId, trigger: 'user', ranAt: { gte: rangeStart, lte: rangeEnd } },
    });

    // ── Zaman serisi (gunluk) ──────────────────────────────────
    const dates: string[] = [];
    const publishedSeries: number[] = [];
    const socialSeries: number[] = [];
    const clicksSeries: number[] = [];
    const impressionsSeries: number[] = [];

    // Bucket: gunluk; uzun donemlerde haftalik.
    // 'custom' araligi 365 gun secilirse gunluk kova 365 nokta uretirdi —
    // grafik okunmaz olur ve rapor gövdesi gereksiz sisar.
    const bucketSize = days > 90 ? 7 : 1;
    for (let i = 0; i < days; i += bucketSize) {
      const dStart = new Date(rangeStart.getTime() + i * 86400000);
      const dEnd = new Date(dStart.getTime() + bucketSize * 86400000);
      dates.push(dStart.toISOString().slice(0, 10));

      publishedSeries.push(
        publishedArticles.filter((a) => a.publishedAt && a.publishedAt >= dStart && a.publishedAt < dEnd).length,
      );
      socialSeries.push(
        socialPosts.filter((p: any) => p.publishedAt && p.publishedAt >= dStart && p.publishedAt < dEnd).length,
      );
      const bucketSnapshots = snapshots.filter((s) => s.date >= dStart && s.date < dEnd);
      clicksSeries.push(bucketSnapshots.reduce((a, s) => a + s.totalClicks, 0));
      impressionsSeries.push(bucketSnapshots.reduce((a, s) => a + s.totalImpressions, 0));
    }

    return {
      range,
      rangeStart: rangeStart.toISOString(),
      rangeEnd: rangeEnd.toISOString(),
      prevStart: prevStart.toISOString(),
      prevEnd: prevEnd.toISOString(),
      articles: {
        published: publishedArticles.length,
        publishedDelta: publishedArticles.length - prevPublished,
        scheduled,
        failed,
        avgEditorScore: articleStats._avg.editorScore,
        totalCost: Number(articleStats._sum.totalCost ?? 0),
      },
      social: {
        posts: socialPosts.length,
        postsDelta: socialPosts.length - prevSocialCount,
        byChannel,
      },
      search: {
        totalClicks,
        totalImpressions,
        avgCtr,
        avgPosition,
        clicksDelta: totalClicks - prevClicks,
        impressionsDelta: totalImpressions - prevImpressions,
        topQueries,
        topPages,
      },
      ai: {
        citationScore: citationDurumu.skor,
        citationOlcumYok: citationDurumu.olcumYok,
        providers: providers.map((p: any) => ({
          provider: p.provider, label: p.label, score: p.score, available: p.available,
        })),
      },
      audit: {
        overallScore: lastAudit?.overallScore ?? null,
        geoScore: lastAudit?.geoScore ?? null,
        issuesCount: lastIssuesCount,
        cozulenSayisi: karsilastirma?.ozet.cozulenSayisi ?? 0,
        yeniCikanSayisi: karsilastirma?.ozet.yeniSayisi ?? 0,
        devamEdenSayisi: karsilastirma?.ozet.devamEdenSayisi ?? 0,
        karsilastirma,
        kullaniciTaramaSayisi,
      },
      timeSeries: {
        dates,
        publishedArticles: publishedSeries,
        socialPosts: socialSeries,
        clicks: clicksSeries,
        impressions: impressionsSeries,
      },
    };
  }

  /**
   * CSV disa aktarim — Excel'e dogrudan acilir.
   *
   * KACISLAMA ZORUNLU: onceki surum degerleri duz `join(',')` ile yaziyordu.
   * Sorgu metinleri virgul, tirnak ve satir sonu icerebiliyor ("ankara, oto
   * kiralama" gibi) — kacislama olmadan bir sorgu tabloyu kaydirip tum
   * kolonlari bozuyordu. Simdi RFC 4180'e uygun tirnaklama var.
   */
  toCsv(report: ReportOverview): string {
    const satirlar: string[] = [];
    const yaz = (...hucre: Array<string | number | null | undefined>) =>
      satirlar.push(hucre.map(csvHucre).join(','));

    yaz('# RanksUp raporu');
    yaz('donem', report.range);
    yaz('baslangic', report.rangeStart.slice(0, 10));
    yaz('bitis', report.rangeEnd.slice(0, 10));
    yaz('onceki_donem', `${report.prevStart.slice(0, 10)} - ${report.prevEnd.slice(0, 10)}`);
    satirlar.push('');

    yaz('# Zaman serisi');
    yaz('tarih', 'yayinlanan_makale', 'sosyal_post', 'tiklama', 'gosterim');
    for (let i = 0; i < report.timeSeries.dates.length; i++) {
      yaz(
        report.timeSeries.dates[i],
        report.timeSeries.publishedArticles[i],
        report.timeSeries.socialPosts[i],
        report.timeSeries.clicks[i],
        report.timeSeries.impressions[i],
      );
    }
    satirlar.push('');

    yaz('# Ozet');
    yaz('yayinlanan_makale', report.articles.published);
    yaz('yayinlanan_makale_onceki_doneme_fark', report.articles.publishedDelta);
    yaz('planlanan_makale', report.articles.scheduled);
    yaz('basarisiz_makale', report.articles.failed);
    yaz('sosyal_post', report.social.posts);
    yaz('toplam_tiklama', report.search.totalClicks);
    yaz('tiklama_farki', report.search.clicksDelta);
    yaz('toplam_gosterim', report.search.totalImpressions);
    yaz('gosterim_farki', report.search.impressionsDelta);
    yaz('ortalama_ctr', `${(report.search.avgCtr * 100).toFixed(2)}%`);
    yaz('ortalama_pozisyon', report.search.avgPosition.toFixed(1));
    yaz('site_skoru', report.audit.overallScore ?? 'olcum yok');
    yaz('geo_skoru', report.audit.geoScore ?? 'olcum yok');
    // 0 yerine "olcum yok": olculemeyen bir metrigi 0 yazmak sahte dusus uretir.
    yaz('ai_gorunurluk_skoru', report.ai.citationScore ?? `olcum yok${report.ai.citationOlcumYok ? ` (${report.ai.citationOlcumYok})` : ''}`);
    yaz('acik_sorun', report.audit.issuesCount);
    yaz('cozulen_sorun', report.audit.cozulenSayisi);
    yaz('yeni_cikan_sorun', report.audit.yeniCikanSayisi);
    yaz('devam_eden_sorun', report.audit.devamEdenSayisi);
    yaz('kullanici_taramasi', report.audit.kullaniciTaramaSayisi);
    yaz('makale_maliyeti_usd', report.articles.totalCost.toFixed(2));
    satirlar.push('');

    yaz('# En cok tiklanan sorgular (donem geneli)');
    yaz('sorgu', 'tiklama', 'gosterim', 'ctr', 'pozisyon');
    for (const q of report.search.topQueries) {
      yaz(q.query, q.clicks, q.impressions, `${(q.ctr * 100).toFixed(2)}%`, q.position.toFixed(1));
    }
    satirlar.push('');

    yaz('# En cok tiklanan sayfalar (donem geneli)');
    yaz('sayfa', 'tiklama', 'gosterim', 'ctr', 'pozisyon');
    for (const pg of report.search.topPages) {
      yaz(pg.page, pg.clicks, pg.impressions, `${(pg.ctr * 100).toFixed(2)}%`, pg.position.toFixed(1));
    }
    satirlar.push('');

    yaz('# AI saglayici kirilimi');
    yaz('saglayici', 'skor', 'olculebildi');
    for (const pr of report.ai.providers) {
      yaz(pr.label ?? pr.provider, pr.available ? (pr.score ?? '-') : 'olcum yok', pr.available ? 'evet' : 'hayir');
    }

    const k = report.audit.karsilastirma;
    if (k?.from && k.to) {
      satirlar.push('');
      yaz('# Tarama karsilastirmasi');
      yaz('ilk_tarama', new Date(k.from.ranAt).toISOString().slice(0, 10), k.from.overallScore);
      yaz('son_tarama', new Date(k.to.ranAt).toISOString().slice(0, 10), k.to.overallScore);
      yaz('skor_farki', k.scoreDelta);
      yaz('geo_skor_farki', k.geoScoreDelta);
      satirlar.push('');
      yaz('kontrol', 'onceki', 'sonraki', 'fark', 'durum');
      for (const c of k.checks) {
        yaz(c.id, c.oncekiScore ?? '-', c.sonrakiScore ?? '-', c.delta, c.durum);
      }
    }

    return satirlar.join('\n');
  }
}
