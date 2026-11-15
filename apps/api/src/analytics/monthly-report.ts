/**
 * Aylik rapor e-postasi — saf kurallar (I/O: monthly-report.cron.ts).
 *
 * NEDEN VAR (15.11.2026, sahip: "gönderilmeyen mailler vardı, bunları da bağlamamız gerekli"):
 * `monthly_report` sablonu e-posta servisinde duruyordu ama onu gonderen hicbir kod yoktu.
 * Musteri aylik ozet almiyordu.
 *
 * DONEM: onceki TAKVIM AYI. Hangi ayin "onceki" oldugu Turkiye saatine gore secilir (UTC+3,
 * yaz saati yok); sinirlar ise UTC GUNUDUR — arama anlik kayitlari UTC gunuyle saklanir
 * (AnalyticsSnapshot.date) ve panelin "1–31 Ekim" ozel donemi de UTC gunuyle baslar
 * (analytics.controller donemParametresi). Kiyas: AYNI UZUNLUKTAKI hemen onceki donem
 * (reports.service donemHesapla) — Ekim icin 31 Agustos–30 Eylul; onceki takvim ayi DEGIL.
 * E-posta bu yuzden "önceki 31 güne göre" der, "geçen aya göre" demez; dondurulmus raporla
 * ayni farki soyler.
 *
 * VERI KURALLARI (bu urunde tekrarlayan hata: olculemeyeni 0 gostermek, olculmemis gecmise
 * buyume demek):
 *  - Arama verisi yoksa (Search Console bagli degil / donemde gosterim yok) tiklama GONDERILMEZ;
 *    sablon buyuk "0 tıklama" basmaz.
 *  - Onceki donemde olcum yoksa ya da onceki donem BASTAN SONA olculmediyse fark GONDERILMEZ
 *    (ozet zaten null doner: reports.service oncekiDonemTam); e-posta hangisi oldugunu soyler.
 *  - Bu donemin BASI ya da SONU olculmediyse (olcum ay ortasinda basladi; Search Console
 *    baglantisi koptu) verinin hangi gunleri kapsadigi yazilir ve kiyas yapilmaz. Aradaki bos
 *    gunler eksik SAYILMAZ: gosterimi olmayan gunun kaydi yazilmaz, az trafikli sitede bu olagan.
 *  - Donemde hic hareket yoksa (arama verisi, yayinlanan makale, calistirilan tarama, AI olcumu)
 *    rapor da e-posta da YOK.
 */

const AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const TR_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

/** Bir hesaba bir ay icin en fazla bu kadar site raporu (gelen kutusu dolmasin) */
export const MONTHLY_REPORT_MAX_SITES_PER_USER = 5;

/**
 * Donemin basinda / sonunda bu kadar gune kadar veri olmamasi eksik sayilmaz (gosterimsiz
 * birkac gun olagandir). Daha uzunu: olcum gec basladi ya da baglanti koptu.
 */
export const MONTHLY_EDGE_TOLERANCE_DAYS = 3;

export interface MonthlyPeriod {
  /** Onceki ayin ilk gunu, 00:00:00.000 UTC */
  from: Date;
  /** Onceki ayin son gunu, 23:59:59.999 UTC */
  to: Date;
  /** "Ekim 2026" */
  label: string;
  /** "2026-10" — ayni ay icin tekrar gonderimi engelleyen kaydin anahtari */
  key: string;
  /** Aydaki gun sayisi */
  days: number;
}

/** `now`a gore onceki takvim ayi (ay Turkiye saatine gore secilir, sinirlar UTC gunu) */
export function oncekiAy(now: Date = new Date()): MonthlyPeriod {
  const tr = new Date(now.getTime() + TR_OFFSET_MS);
  const buAyBasi = Date.UTC(tr.getUTCFullYear(), tr.getUTCMonth(), 1);
  const oncekiBas = new Date(Date.UTC(tr.getUTCFullYear(), tr.getUTCMonth() - 1, 1));
  return {
    from: oncekiBas,
    to: new Date(buAyBasi - 1),
    label: `${AYLAR[oncekiBas.getUTCMonth()]} ${oncekiBas.getUTCFullYear()}`,
    key: `${oncekiBas.getUTCFullYear()}-${String(oncekiBas.getUTCMonth() + 1).padStart(2, '0')}`,
    days: Math.round((buAyBasi - oncekiBas.getTime()) / DAY_MS),
  };
}

/** "2026-10-14" → "14 Ekim" (e-postadaki veri araligi) */
export function gunAy(iso: string): string {
  const [, ay, gun] = iso.split('-').map(Number);
  return `${gun} ${AYLAR[(ay ?? 1) - 1]}`;
}

/** Rapor ozetinden e-postaya giren alanlar (reports.service ReportOverview'in alt kumesi) */
export interface MonthlyOverview {
  search: {
    totalClicks: number;
    totalImpressions: number;
    /** Onceki donem bastan sona olculmediyse null (reports.service) */
    clicksDelta: number | null;
    oncekiDonemVeriVar?: boolean;
    oncekiDonemTam?: boolean;
    /** Saklanan gunlerin donemi ne kadar kapsadigi (gsc-aggregate snapshotCoverage) */
    coverage?: { from: string | null; to: string | null; windowFrom: string; windowTo: string };
  };
  ai: { citationScore: number | null };
  audit: { overallScore: number | null; geoScore: number | null; kullaniciTaramaSayisi: number };
  articles: { published: number };
}

export interface MonthlyReportData {
  siteName: string;
  siteId: string;
  periodLabel: string;
  /** Donemin gun sayisi — "önceki 31 güne göre" */
  periodDays?: number;
  /** Dondurulmus raporun kimligi — e-postadaki baglanti panelde bu raporu acar */
  reportId?: string;
  /** Yalniz arama verisi varsa */
  totalClicks?: number;
  /** Yalniz iki donem de bastan sona olculduyse */
  prevClicks?: number;
  /** Onceki donemde veri var ama o donem bastan sona olculmedi (kiyas yok) */
  prevPartial?: true;
  /** Yalniz bu donemin basi ya da sonu olculmediyse: verinin kapsadigi ilk / son gun ("14 Ekim") */
  dataFrom?: string;
  dataTo?: string;
  seoScore: number | null;
  geoScore: number | null;
  aiVisibility: number | null;
  articlesPublished: number;
  auditCount: number;
}

const gunFarki = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);

/**
 * Bu donemin basi ya da sonu olculmemis mi. Bas: veri donemin ortasinda basliyor VE daha once
 * hic olcum yok (onceki donemde veri varsa olcum zaten suruyordu; bastaki bos gunler gosterimsiz
 * gunlerdir). Son: verinin bittigi gun ile donem sonu arasi toleranstan uzun.
 */
function donemEksik(s: MonthlyOverview['search']): boolean {
  const k = s.coverage;
  if (!k || !k.from || !k.to) return false;
  const bastaBosluk = gunFarki(k.windowFrom, k.from) > MONTHLY_EDGE_TOLERANCE_DAYS && s.oncekiDonemVeriVar !== true;
  const sondaBosluk = gunFarki(k.to, k.windowTo) > MONTHLY_EDGE_TOLERANCE_DAYS;
  return bastaBosluk || sondaBosluk;
}

/**
 * Sablon verisi; donemde hic hareket yoksa null (rapor uretilmez, e-posta gonderilmez).
 *
 * `ek.aiMeasured`: donemde en az bir AI gorunurluk olcumu var mi (zamanlayici sayar) — Search
 * Console bagli olmayan, makale uretmeyen (Baslangic) ama AI olcumu yapan hesap da rapor alir.
 * `ek.reportId` / `ek.aiVisibility`: dondurulmus rapor uretildiyse kimligi ve o raporun liste
 * kolonundaki AI gorunurluk skoru (SiteReport.aiVisibility — panelin rapor gecmisinde yazan
 * sayi; verilmezse ozetteki).
 */
export function monthlyReportData(
  site: { id: string; name: string },
  donem: { label: string; days?: number },
  o: MonthlyOverview,
  ek: { reportId?: string; aiVisibility?: number | null; aiMeasured?: boolean } = {},
): MonthlyReportData | null {
  const aramaVar = o.search.totalImpressions > 0 || o.search.totalClicks > 0;
  const makale = Math.max(0, o.articles.published || 0);
  const tarama = Math.max(0, o.audit.kullaniciTaramaSayisi || 0);
  if (!aramaVar && makale === 0 && tarama === 0 && !ek.aiMeasured) return null;
  const eksik = aramaVar && donemEksik(o.search);
  const kiyas = aramaVar && !eksik && o.search.clicksDelta !== null;
  return {
    siteName: site.name,
    siteId: site.id,
    periodLabel: donem.label,
    ...(typeof donem.days === 'number' ? { periodDays: donem.days } : {}),
    ...(ek.reportId ? { reportId: ek.reportId } : {}),
    ...(aramaVar ? { totalClicks: o.search.totalClicks } : {}),
    ...(kiyas ? { prevClicks: o.search.totalClicks - (o.search.clicksDelta as number) } : {}),
    // Onceki donemde veri var ama fark yok: o donem bastan sona olculmemis
    ...(aramaVar && !eksik && !kiyas && o.search.oncekiDonemVeriVar === true ? { prevPartial: true as const } : {}),
    ...(eksik ? { dataFrom: gunAy(o.search.coverage!.from!), dataTo: gunAy(o.search.coverage!.to!) } : {}),
    seoScore: o.audit.overallScore,
    geoScore: o.audit.geoScore,
    aiVisibility: ek.aiVisibility !== undefined ? ek.aiVisibility : o.ai.citationScore,
    articlesPublished: makale,
    auditCount: tarama,
  };
}
