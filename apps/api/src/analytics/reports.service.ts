import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { aiCitationsOlculdu, compareAuditRows, type AuditKarsilastirma } from '../audit/audit.service.js';
import { OVERALL_SCORE_WEIGHTS } from '../audit/audit-checks.service.js';
import type { Provider } from '../audit/ai-citation.service.js';
import type { GeoAccessBlock } from '../audit/geo-runner.service.js';
import {
  crawlAccessMessage, crawlAccessNewerThanAudit, readCrawlAccess, type CrawlAccessRecord,
} from '../sites/crawl-access.js';
import { resolveSiteBrand } from '../audit/brand-in-query.js';
import { splitQueriesByBrand, brandHostFromUrl, type OrganicQueryRow, type OrganicBrandSplit } from './organic-brand-split.js';

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
  /**
   * ESKI ALAN — geriye uyumluluk icin JSON'da kalir. Sosyal yayin modulu
   * kaldirildi (SocialPost artik yazilmiyor); yeni donemlerde hep 0. CSV'ye
   * yalniz sifirdan farkliysa (modul varken dondurulmus eski rapor) yazilir.
   */
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
    /**
     * Onceki doneme gore fark. ONCEKI DONEMDE HIC OLCUM YOKSA null.
     *
     * Onceden her zaman sayi donuyordu: onceki donemde snapshot olmadiginda
     * prevClicks=0 oluyor ve fark toplamin kendisi cikiyordu. Uretimde
     * goruldu — kobipratik icin "14.766 tiklama (+14.766)" yaziyordu, sanki
     * sifirdan buraya gelmis gibi. Halbuki o donemde site henuz olculmuyordu.
     * Buyume iddiasi, olculmemis bir gecmisin uzerine kurulamaz.
     */
    clicksDelta: number | null;
    impressionsDelta: number | null;
    /** Onceki donemde karsilastirilacak olcum var miydi */
    oncekiDonemVeriVar: boolean;
    topQueries: Array<{ query: string; clicks: number; impressions: number; ctr: number; position: number }>;
    topPages: Array<{ page: string; clicks: number; impressions: number; ctr: number; position: number }>;
    /**
     * Markali / markasiz organik ayrimi (organic-brand-split.ts). Markali
     * sorgu hafiza, markasiz sorgu kesif olcer — "tiklamalarin %X'i adini
     * bilmeyenlerden". Marka cozulemediyse null. Orneklem: gunluk ilk 100 sorgu.
     */
    brandSplit: OrganicBrandSplit | null;
  };
  ai: {
    /**
     * Son taramanin AI gorunurluk ortalamasi. HIC saglayici olculemediyse ya da
     * adim atlandiysa (haftalik hak, kota) `null` — 0 DEGIL. Eski taramalar bu
     * durumda 0 yaziyordu ve o 0 trend grafiginde sahte bir cokus uretiyordu
     * ("gorunurlugun sifira dustu"), halbuki olcum hic yapilamamisti. Son tarama
     * denemesi siteye erisemediyse de null (eski deger tarihiyle citationOlcumYok'ta).
     */
    citationScore: number | null;
    /** citationScore null ise nedeni — arayuz "olcum yok" yazabilsin */
    citationOlcumYok: string | null;
    providers: Array<{ provider: string; label: string; score: number | null; available: boolean }>;
  };
  audit: {
    /**
     * Son basarili taramanin skoru. accessBlocked doluysa null: eldeki skor
     * guncel degil (eski deger yalniz tarihiyle birlikte sonBasarili'da).
     */
    overallScore: number | null;
    /** Ayni kural: accessBlocked doluysa null */
    geoScore: number | null;
    /** Son basarili taramanin zamani (ISO); hic tarama yoksa null. Eski raporlarda yok. */
    ranAt?: string | null;
    /**
     * Bu taramadan SONRAKI tarama denemesi siteye erisemedi (kural:
     * crawl-access.ts crawlAccessNewerThanAudit — panel ve MCP ile ayni).
     * Neden ve cozum burada. Eski raporlarda yok (undefined).
     */
    accessBlocked?: CrawlAccessRecord | null;
    /** accessBlocked doluyken son basarili taramanin skorlari, TARIHIYLE; yoksa null */
    sonBasarili?: { ranAt: string; overallScore: number; geoScore: number | null } | null;
    /**
     * Son taramanin GEO olcumu erisim engeline takildiysa (geoScore null) neden
     * ve cozum — audit.checks.geo.blocked (geo-runner.service.ts). Yoksa null.
     *
     * NEDEN RAPORDA: panel bunu canli SiteContext'ten okuyordu; dondurulmus
     * raporda o, raporun degil BUGUNUN taramasidir. Alan rapor govdesiyle
     * birlikte donar. Bu alandan ONCE uretilmis raporlarda yok (undefined).
     */
    geoBlocked: GeoAccessBlock | null;
    /** GEO skorunun dayandigi orneklem (olculen / engele takilan sayfa); yoksa null */
    geoSample: GeoSample | null;
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
    /**
     * Ilk taramadaki sorun son taramada YENIDEN OLCULEMEDI (erisim engeli,
     * atlanan AI olcumu, dar sayfa kapsami) — cozulen sayilmaz. Eski raporlarda yok.
     */
    olculemeyenSayisi?: number;
    /** Donemin ilk ve son taramasi arasindaki tam karsilastirma; tek tarama varsa null */
    karsilastirma: AuditKarsilastirma | null;
    /** Donemde kullanicinin ELLE calistirdigi tarama sayisi (cron/test haric) */
    kullaniciTaramaSayisi: number;
  };
  // Zaman serisi (gunluk)
  timeSeries: {
    dates: string[]; // ISO date YYYY-MM-DD
    publishedArticles: number[];
    /** ESKI ALAN (bkz. social) — yeni donemlerde hep 0 */
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
 * Eski taramalar hicbir saglayici cevap veremediginde `score: 0` yaziyordu;
 * yenileri `score: null` + `skipped` (neden) yazar (audit.service runAudit).
 * O 0 bir OLCUM degil, olcumun YOKLUGU — grafikte gercek bir cokus gibi
 * gorunup "AI gorunurlugun sifira dustu" yalanini uretiyordu. Olcum kurali
 * tek yerde: audit.service aiCitationsOlculdu (karsilastirma da onu kullanir).
 */
export function citationDegerlendir(aiCitations: any): { skor: number | null; olcumYok: string | null } {
  if (!aiCitations) return { skor: null, olcumYok: 'Bu sitede henüz AI görünürlük ölçümü yapılmadı.' };
  if (aiCitationsOlculdu(aiCitations)) return { skor: aiCitations.score, olcumYok: null };
  const atlama = aiCitations.skipped;
  if (atlama && typeof atlama.message === 'string' && atlama.message) return { skor: null, olcumYok: atlama.message };
  const providers: any[] = Array.isArray(aiCitations.providers) ? aiCitations.providers : [];
  if (providers.length > 0 && !providers.some((p) => p?.available)) {
    return { skor: null, olcumYok: 'Hiçbir AI asistanı ölçüm döndüremedi (anahtar, kota ya da servis hatası).' };
  }
  return { skor: null, olcumYok: 'Bu taramada AI ölçümü yapılmadı.' };
}

/** GEO skorunun dayandigi orneklem — geo-runner.service.ts GeoAuditResult.sample */
export interface GeoSample {
  measured: number;
  blocked: number;
}

/**
 * audit.checks.geo → erisim engeli + orneklem (web lib/api.ts geoAccessOf ile
 * ayni kural). Eski taramalarda ya da bozuk JSON'da ikisi de null — engel
 * uydurulmaz. Yalniz belgelenmis alanlar tasinir.
 */
export function geoAccessFromChecks(checks: unknown): { blocked: GeoAccessBlock | null; sample: GeoSample | null } {
  const geo = (checks as { geo?: { blocked?: any; sample?: any } } | null | undefined)?.geo;
  const b = geo?.blocked;
  const s = geo?.sample;
  const blocked: GeoAccessBlock | null = b && typeof b === 'object' && typeof b.reason === 'string'
    ? {
        kind: b.kind,
        vendor: typeof b.vendor === 'string' ? b.vendor : null,
        status: b.status,
        reason: b.reason,
        hint: typeof b.hint === 'string' ? b.hint : '',
        url: typeof b.url === 'string' ? b.url : '',
      }
    : null;
  const sample = s && Number.isFinite(s.measured) && Number.isFinite(s.blocked)
    ? { measured: Number(s.measured), blocked: Number(s.blocked) }
    : null;
  return { blocked, sample };
}

/**
 * CSV / dondurulmus rapor GEO hucresi: skor yoksa NEDEN — bos ya da cikiplak
 * "olcum yok" degil. Engel nedeni ve cozumu (RanksUpBot'a izin) yazilir; diger
 * hucrelerle ayni "olcum yok (neden)" kalibi. Eski raporda geoBlocked yoktur.
 */
export function geoSkorHucresi(audit: {
  geoScore: number | null;
  geoBlocked?: GeoAccessBlock | null;
  accessBlocked?: CrawlAccessRecord | null;
  sonBasarili?: { ranAt: string; geoScore: number | null } | null;
}): string | number {
  if (typeof audit.geoScore === 'number') return audit.geoScore;
  // Son tarama denemesi siteye erisemedi: neden bu kayit (eski taramanin
  // geoBlocked'i o taramayi anlatir, bugunu degil)
  if (audit.accessBlocked?.reason) {
    return erisimYokHucresi(audit.accessBlocked, audit.sonBasarili?.ranAt, audit.sonBasarili?.geoScore);
  }
  const b = audit.geoBlocked;
  if (!b?.reason) return 'olcum yok';
  return `olcum yok (${[b.reason, b.hint].filter(Boolean).join(' ')})`;
}

/** Gecerli tarihse ISO zaman, degilse null (bozuk/eksik alan raporu dusurmez) */
const isoZaman = (v: string | Date | null | undefined): string | null => {
  if (!v) return null;
  const t = new Date(v);
  return Number.isFinite(t.getTime()) ? t.toISOString() : null;
};

const isoGun = (v: string | Date | null | undefined): string | null => isoZaman(v)?.slice(0, 10) ?? null;

/** "olcum yok (Erişim engellendi: neden çözüm; son başarılı tarama 2026-08-28: 78/100)" */
function erisimYokHucresi(access: CrawlAccessRecord, sonRanAt?: string | null, sonSkor?: number | null): string {
  const gun = isoGun(sonRanAt);
  const son = gun ? `; son başarılı tarama ${gun}${typeof sonSkor === 'number' ? `: ${sonSkor}/100` : ''}` : '';
  return `olcum yok (${crawlAccessMessage(access)}${son})`;
}

/**
 * CSV site skoru hucresi. Son tarama denemesi siteye erisemediyse eski skor
 * GUNCEL diye yazilmaz: neden + son basarili taramanin tarihi ve skoru.
 * Bu alanlardan once dondurulmus raporda eski davranis surer.
 */
export function siteSkorHucresi(audit: {
  overallScore: number | null;
  accessBlocked?: CrawlAccessRecord | null;
  sonBasarili?: { ranAt: string; overallScore: number } | null;
}): string | number {
  if (typeof audit.overallScore === 'number') return audit.overallScore;
  if (audit.accessBlocked?.reason) {
    return erisimYokHucresi(audit.accessBlocked, audit.sonBasarili?.ranAt, audit.sonBasarili?.overallScore);
  }
  return 'olcum yok';
}

/** Skorun bir kismi engele takilan orneklemden mi — web geoSampleNote ile ayni metin; degilse null */
export function geoOrneklemNotu(audit: { geoScore: number | null; geoSample?: GeoSample | null }): string | null {
  const s = audit.geoSample;
  if (typeof audit.geoScore !== 'number' || !s || !(s.blocked > 0) || !(s.measured > 0)) return null;
  return `${s.blocked} sayfa erişim engeline takıldı; skor ${s.measured} sayfadan hesaplandı.`;
}

/**
 * Kismi tarama karsilastirmasinin tek satirlik nedeni (CSV "kismi_karsilastirma").
 * Tam karsilastirmada ve bu alandan once dondurulmus raporda null.
 */
export function kismiKarsilastirmaNotu(k: Pick<AuditKarsilastirma, 'kismi' | 'ozet'> | null | undefined): string | null {
  const ks = k?.kismi;
  if (!ks) return null;
  const parcalar: string[] = [];
  const olculemeyenKontroller = ks.olculemeyenKontroller ?? [];
  const skorKapsami = ks.skorKapsamiFarkli ?? [];
  if (olculemeyenKontroller.length) parcalar.push(`son taramada ölçülemeyen kontroller: ${olculemeyenKontroller.join(', ')}`);
  if (ks.sayfaKapsami) {
    parcalar.push(ks.sayfaKapsami.erkenDurdu
      ? 'son tarama bot koruması nedeniyle erken durdu'
      : `son taramada ${ks.sayfaKapsami.engellenenSayfa} sayfa erişim engeli nedeniyle taranamadı`);
  }
  if (skorKapsami.length) parcalar.push(`genel skora giren ${skorKapsami.join(', ')} iki taramadan yalnız birinde ölçülebildi`);
  const olculemeyen = k?.ozet?.olculemeyenSayisi ?? 0;
  if (olculemeyen > 0) parcalar.push(`${olculemeyen} eski sorun yeniden ölçülemediği için çözülmüş sayılmadı`);
  return parcalar.length ? parcalar.join('; ') : null;
}

/** Karsilastirma alanindaki kimlik listesi: dize olmayan/bos ogeler (bozuk eski govde) atilir */
const kimlikListesi = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : [];

/**
 * CSV notundaki AI asistan adlari — ai-citation.service.ts PROVIDER_LABELS ile
 * ayni adlar (o tablo disa acik degil). Record<Provider, ...> oldugu icin yeni
 * bir asistan eklendiginde tsc burayi da ister; bilinmeyen kimlik oldugu gibi yazilir.
 */
const AI_SAGLAYICI_ADI: Record<Provider, string> = {
  anthropic: 'Anthropic Claude',
  gemini: 'Google Gemini',
  openai: 'OpenAI ChatGPT',
  perplexity: 'Perplexity',
  xai: 'xAI Grok',
  deepseek: 'DeepSeek',
  meta: 'Meta AI (Llama)',
};
const saglayiciAdlari = (ids: string[]) =>
  ids.map((p) => (Object.hasOwn(AI_SAGLAYICI_ADI, p) ? AI_SAGLAYICI_ADI[p as Provider] : p)).join(', ');

/**
 * Olcum yontemi degisen kontrollerin CSV notu ("olcum_yontemi_notu").
 *
 * NEDEN: panel (audit-delta-panel) ayni karsilastirmada "Olcum yontemi
 * guncellendi" uyarisini gosterir; CSV yalniz kontrol kimliklerini yaziyordu
 * (olcum_yontemi_degisen). Disa aktarilan rapor, bu kontrollerin farkinin
 * neden 0 yazildigini (durum metodoloji_degisti, compareAuditRows) ve
 * sorunlarinin neden cozulen/yeni sayilmadigini soylemiyordu. GEO yontemi
 * degistiyse geo_skor_farki da 0 yazilir.
 * Genel skor YALNIZ OVERALL_SCORE_WEIGHTS kontrollerinden hesaplanir
 * (computeOverallScore; GEO, AI gorunurluk ve PageSpeed girmez): skor_farki
 * uyarisi yalniz o kontrollerden biri degistiyse yazilir, yoksa yanlis olurdu.
 * Alan yoksa (yontem ayni ya da alandan once dondurulmus rapor) null.
 */
export function olcumYontemiNotu(k: Pick<AuditKarsilastirma, 'metodolojiDegisen'> | null | undefined): string | null {
  const ids = kimlikListesi(k?.metodolojiDegisen);
  if (ids.length === 0) return null;
  const parcalar = [
    `Ölçüm yöntemi iki tarama arasında güncellendi: ${ids.join(', ')}.`,
    'Bu kontrollerin farkı 0 yazıldı (durum metodoloji_degisti) ve sorunları çözülen/yeni sayılmadı; skorlarındaki değişim siteden değil yöntemden kaynaklanabilir.',
  ];
  if (ids.includes('geo')) parcalar.push('GEO skorları kıyaslanmadı (geo_skor_farki 0).');
  const genelSkorda = ids.filter((id) => Object.hasOwn(OVERALL_SCORE_WEIGHTS, id));
  if (genelSkorda.length > 0) {
    parcalar.push(`${genelSkorda.join(', ')} genel skora girdiği için skor_farki değerinin bir kısmı da yöntem değişikliğinden kaynaklanabilir.`);
  }
  return parcalar.join(' ');
}

/**
 * AI gorunurlukte iki taramanin OLCULEN asistan kumesi farkliysa CSV notu
 * ("ai_saglayici_kapsami").
 *
 * NEDEN: compareAuditRows bu durumda aiCitations farkini yalniz IKI taramada da
 * olculen asistanlar uzerinden hesaplar (aiSaglayiciKapsami) ve AI gorunurluk
 * sorunlarini cozulen/yeni saymaz; ortak asistan yoksa satir uretmez. CSV bunu
 * soylemedigi icin aiCitations satirindaki onceki/sonraki degerler
 * ai_gorunurluk_skoru ile celisir gorunuyor, satirin neden olmadigi
 * anlasilmiyordu. Kume ayniysa ya da alandan once dondurulmus raporda null.
 */
export function aiSaglayiciKapsamNotu(k: Pick<AuditKarsilastirma, 'aiSaglayiciKapsami'> | null | undefined): string | null {
  const ks = k?.aiSaglayiciKapsami;
  if (!ks) return null;
  const ortak = kimlikListesi(ks.ortak);
  const yalnizOnceki = kimlikListesi(ks.yalnizOnceki);
  const yalnizSonraki = kimlikListesi(ks.yalnizSonraki);
  const farklar = [
    yalnizOnceki.length ? `yalnız ilk taramada ölçülen: ${saglayiciAdlari(yalnizOnceki)}` : null,
    yalnizSonraki.length ? `yalnız son taramada ölçülen: ${saglayiciAdlari(yalnizSonraki)}` : null,
  ].filter((p): p is string => p !== null);
  const giris = `AI görünürlük ölçümünde iki taramada ölçülebilen asistanlar farklı${farklar.length ? ` (${farklar.join('; ')})` : ''}.`;
  const kiyas = ortak.length
    ? `aiCitations farkı yalnız iki taramada da ölçülen asistanlar (${saglayiciAdlari(ortak)}) üzerinden hesaplandı; satırdaki önceki/sonraki değerler bu asistanların ortalamasıdır.`
    : 'İki taramada ortak ölçülen asistan olmadığı için AI görünürlük kıyaslanmadı.';
  return `${giris} ${kiyas} AI görünürlük sorunları çözülen/yeni sayılmadı.`;
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
    // Onceki donemde HIC snapshot yoksa fark hesaplanamaz — sifirdan
    // buyume iddiasi uretmemek icin delta null donecek.
    const oncekiDonemVeriVar = prevSnapshots.length > 0;
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

    // Markali / markasiz organik ayrimi — overview ile AYNI yardimci
    // (organic-brand-split.ts). Raporda "tiklamalarin %X'i adini bilmeyenlerden".
    const brandSite = await this.prisma.site.findUnique({ where: { id: siteId }, select: { name: true, url: true } });
    const brand = brandSite ? resolveSiteBrand(brandSite.name, brandSite.url) : '';
    const brandSplit = brand
      ? splitQueriesByBrand(
          snapshots.flatMap((s) => (Array.isArray(s.queryDetails) ? (s.queryDetails as unknown as OrganicQueryRow[]) : [])),
          brand,
          // Overview ile ayni: jenerik turetilmis markada yalniz alan adi markali
          brandHostFromUrl(brandSite?.url),
        )
      : null;

    // ── AI citation + audit ────────────────────────────────────
    // Donem sonundan SONRAKI tarama gecmis bir donemin raporuna girmesin
    // (dondurulmus "Temmuz" raporu Ekim skorunu gostermesin).
    const [lastAudit, erisimKaydi] = await Promise.all([
      this.prisma.audit.findFirst({
        where: { siteId, ranAt: { lte: rangeEnd } },
        orderBy: { ranAt: 'desc' },
      }),
      // Hata atmaz (kv sorunu raporu dusurmez)
      readCrawlAccess(this.prisma, siteId),
    ]);
    // Anasayfa okunamayan taramada Audit satiri yazilmaz; son satir eski bir
    // olcumdur. Ondan SONRAKI deneme siteye erisemediyse skor guncel degil —
    // panel ve MCP ile ayni kural (crawl-access.ts). Donemden sonraki deneme
    // gecmis donemin raporunu etkilemez.
    const erisimDonemde = erisimKaydi && Date.parse(erisimKaydi.at) <= rangeEnd.getTime() ? erisimKaydi : null;
    const accessBlocked = crawlAccessNewerThanAudit(erisimDonemde, lastAudit?.ranAt);
    const aiCitations = (lastAudit?.checks as any)?.aiCitations;
    const citationDurumu = citationDegerlendir(aiCitations);
    const eskiCitationSkor = citationDurumu.skor;
    // Erisim engelli: o denetimin AI olcumu de eski (deneme AI adimina hic
    // gelmedi). Deger yalniz tarihiyle anilir; saglayici kirilimi verilmez.
    if (accessBlocked) {
      const gun = isoGun(lastAudit?.ranAt);
      citationDurumu.skor = null;
      citationDurumu.olcumYok = `Son tarama denemesi siteye erişemediği için AI ölçümü yapılmadı${
        gun && typeof eskiCitationSkor === 'number' ? `; son başarılı ölçüm ${gun}: ${eskiCitationSkor}/100` : ''
      }.`;
    }
    const providers = accessBlocked ? [] : aiCitations?.providers ?? [];
    // GEO skoru ile AYNI taramadan: skor yoksa neden, varsa orneklem
    const geoErisim = geoAccessFromChecks(lastAudit?.checks);

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
        clicksDelta: oncekiDonemVeriVar ? totalClicks - prevClicks : null,
        impressionsDelta: oncekiDonemVeriVar ? totalImpressions - prevImpressions : null,
        oncekiDonemVeriVar,
        topQueries,
        topPages,
        brandSplit,
      },
      ai: {
        citationScore: citationDurumu.skor,
        citationOlcumYok: citationDurumu.olcumYok,
        providers: providers.map((p: any) => ({
          provider: p.provider, label: p.label, score: p.score, available: p.available,
        })),
      },
      audit: {
        // Erisim engelliyse eski skor guncel diye verilmez (MCP get_site_overview kurali)
        overallScore: accessBlocked ? null : lastAudit?.overallScore ?? null,
        geoScore: accessBlocked ? null : lastAudit?.geoScore ?? null,
        ranAt: isoZaman(lastAudit?.ranAt),
        accessBlocked,
        sonBasarili: accessBlocked && lastAudit
          ? { ranAt: isoZaman(lastAudit.ranAt) ?? '', overallScore: lastAudit.overallScore, geoScore: lastAudit.geoScore ?? null }
          : null,
        // Eski taramanin GEO engeli/orneklemi bugunu anlatmaz
        geoBlocked: accessBlocked ? null : geoErisim.blocked,
        geoSample: accessBlocked ? null : geoErisim.sample,
        issuesCount: lastIssuesCount,
        cozulenSayisi: karsilastirma?.ozet.cozulenSayisi ?? 0,
        yeniCikanSayisi: karsilastirma?.ozet.yeniSayisi ?? 0,
        devamEdenSayisi: karsilastirma?.ozet.devamEdenSayisi ?? 0,
        olculemeyenSayisi: karsilastirma?.ozet.olculemeyenSayisi ?? 0,
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

    // sosyal_post sutunu YALNIZ sifirdan farkliysa: sosyal yayin modulu
    // kaldirildi, yeni donemlerde hep 0 ve "paylasim yapilmadi" gibi okunuyordu.
    // Modul varken dondurulmus eski raporlar (reportByIdCsv) degerini korur.
    const sosyalVar = (report.social?.posts ?? 0) > 0 || (report.timeSeries.socialPosts ?? []).some((n) => n > 0);

    yaz('# Zaman serisi');
    yaz('tarih', 'yayinlanan_makale', ...(sosyalVar ? ['sosyal_post'] : []), 'tiklama', 'gosterim');
    for (let i = 0; i < report.timeSeries.dates.length; i++) {
      yaz(
        report.timeSeries.dates[i],
        report.timeSeries.publishedArticles[i],
        ...(sosyalVar ? [report.timeSeries.socialPosts?.[i] ?? 0] : []),
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
    if (sosyalVar) yaz('sosyal_post', report.social.posts);
    yaz('toplam_tiklama', report.search.totalClicks);
    yaz('tiklama_farki', report.search.clicksDelta ?? 'onceki donemde olcum yok');
    yaz('toplam_gosterim', report.search.totalImpressions);
    yaz('gosterim_farki', report.search.impressionsDelta ?? 'onceki donemde olcum yok');
    yaz('ortalama_ctr', `${(report.search.avgCtr * 100).toFixed(2)}%`);
    yaz('ortalama_pozisyon', report.search.avgPosition.toFixed(1));
    // Dondurulmus rapor da buradan gecer (analytics.controller reportByIdCsv);
    // eski govdede accessBlocked/geoBlocked/geoSample yoktur — yardimcilar
    // undefined'i tasir, eski cikti aynen kalir.
    yaz('site_skoru', siteSkorHucresi(report.audit));
    yaz('geo_skoru', geoSkorHucresi(report.audit));
    const geoNot = geoOrneklemNotu(report.audit);
    if (geoNot) yaz('geo_orneklem', geoNot);
    // 0 yerine "olcum yok": olculemeyen bir metrigi 0 yazmak sahte dusus uretir.
    yaz('ai_gorunurluk_skoru', report.ai.citationScore ?? `olcum yok${report.ai.citationOlcumYok ? ` (${report.ai.citationOlcumYok})` : ''}`);
    yaz('acik_sorun', report.audit.issuesCount);
    yaz('cozulen_sorun', report.audit.cozulenSayisi);
    yaz('yeni_cikan_sorun', report.audit.yeniCikanSayisi);
    yaz('devam_eden_sorun', report.audit.devamEdenSayisi);
    // Yeniden olculemeyen eski sorunlar — cozulen_sorun'a girmez. Bu alandan
    // once dondurulmus raporda yok; bilinmeyen sayi 0 diye uydurulmaz.
    if (typeof report.audit.olculemeyenSayisi === 'number') yaz('olculemeyen_sorun', report.audit.olculemeyenSayisi);
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
      if (k.metodolojiDegisen?.length) yaz('olcum_yontemi_degisen', k.metodolojiDegisen.join(' '));
      // Panelin yontem/kapsam uyarilari CSV'de de (eklemeli satirlar; eski
      // satirlar ayni). Gerekce olcumYontemiNotu / aiSaglayiciKapsamNotu.
      const yontemNot = olcumYontemiNotu(k);
      if (yontemNot) yaz('olcum_yontemi_notu', yontemNot);
      const kapsamNot = aiSaglayiciKapsamNotu(k);
      if (kapsamNot) yaz('ai_saglayici_kapsami', kapsamNot);
      const kismiNot = kismiKarsilastirmaNotu(k);
      if (kismiNot) yaz('kismi_karsilastirma', kismiNot);
      satirlar.push('');
      yaz('kontrol', 'onceki', 'sonraki', 'fark', 'durum');
      for (const c of k.checks) {
        yaz(c.id, c.oncekiScore ?? '-', c.sonrakiScore ?? '-', c.delta, c.durum);
      }
    }

    return satirlar.join('\n');
  }
}
