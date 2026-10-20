import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { LlmsFullBuilderService } from '../audit/llms-full-builder.service.js';
// Site haritasi / llms-full ile AYNI yazi secimi, ayni "sitenin kendi adresi" kurali, dosya
// hedefindeki kopyanin AYNI adresi (fileCopyPublicUrl) ve ayni ilan kurali (advertisedArticleEntry)
import {
  advertisedArticleEntry, fileCopyPublicUrl, flagRetiredCanonicalCopies, parseSiteUrl, publicArticleFilter, publicArticleWhere, recordedRemoteDir, sameSiteUrl,
} from '../audit/ai-sitemap.service.js';
import { acquireCronLock } from '../common/cron-lock.js';
// SSRF korumali okuma: yalniz http/https + 80/443, ic aga baglanmaz, yonlendirmenin her
// adimi yeniden denetlenir, durust bot kimligi (RANKSUP_BOT_UA) gonderilir
import { safeFetchText, type SafeTextOptions, type SafeTextResult } from '../common/safe-fetch.js';
// Yanit siniflandirmasi ve istek secenekleri yayinciyla ortak (public-url-probe.ts): ayni yanit iki yerde ayni okunur
import { PUBLIC_URL_FETCH, classifyLivenessResponse, publicUrlFetchOptions, siteHomepage } from './public-url-probe.js';
import {
  UPDATE_TARGET_TYPES, applyLivenessObservations, liveEntries, liveEntryRef, recordedWordPressStatus, siteLiveEntries,
  statusAfterRetirement, targetLabel, wordPressLinkNeedsSighting, wordPressNonPublicCopy, wordPressPlainLink,
  type LiveEntry, type LivenessObservation, type LivenessOutcome,
} from './republish-policy.js';

// Eski ice aktaranlar (spec'ler) icin ayni adlarla yeniden disa aktarilir; tanimlar paylasilan dosyalarda
export { classifyLivenessResponse, recordedRemoteDir, wordPressPlainLink };

/**
 * YAYINDAKI YAZININ SITEDE GERCEKTEN YAYINDA OLDUGUNU DOGRULAMA (gunluk).
 *
 * NEDEN: yazi musterinin sitesinden kaldirildiginda (WordPress'te silindi, taslaga
 * alindi, cop kutusuna atildi; sunucudan dosya silindi) RanksUp bunu ancak bir
 * sonraki yayin denemesinde goruyordu. Panel yaziyi "yayında" gosteriyor, site
 * haritasi (sitemap-ai.xml) ve llms-full olu adresi AI tarayicilarina ilan ediyor,
 * KPI'lar ve raporlar olmayan sayfayi sayiyordu (uretim, 18.10.2026:
 * isgetkinlikleri.com'daki 5 yayindaki yazinin adresi 404, ana sayfa 200).
 *
 * KURAL (republish-policy.ts applyLivenessObservations): kopya YALNIZ dogrulanmis
 * 404/410'da emekliye ayrilir —
 *  - ayni turda sitenin ana sayfasi 2xx/3xx vermeli (site ayakta);
 *  - AYNI adreste en az LIVENESS_CONFIRM_MS (20 saat) arayla iki basarisiz denetim: ilki
 *    kayda goneSince + goneUrl olarak yazilir, arada canli goren denetim onu siler;
 *  - 401/403/429/5xx, zaman asimi, ag hatasi, WAF engeli ya da bot dogrulama sayfasi
 *    (common/block-detect.ts) HICBIR zaman emekliye ayirmaz;
 *  - adresi RanksUp'in tahmini olan ya da herkese acik oldugu bilinmeyen kopya
 *    (dosya hedefleri, KobiPratik, GitHub, WordPress'in herkese acik olmayan ya da
 *    durumu bilinmeyen duz ?p= kopyasi) o adres bir kez canli gorulmeden emekliye
 *    ayrilmaz (liveSeenAt + liveSeenUrl: kanit goruldugu adrese baglidir).
 * Emekliye ayirma sozlesme D3'tur (missingAt): kopya canli sayilmaz, kimlik ve adres
 * korunur. Sitede canli kopyasi kalmayan PUBLISHED yazi READY_TO_PUBLISH olur
 * (statusAfterRetirement: yayincinin cop kutusu / silinmis kopya kurali), ilk yayin
 * tarihi (publishedAt) gecmis olarak kalir; llms-full yeniden uretilir ve site
 * sahibine panel bildirimi gider.
 *
 * Denetlenen kopyalar: PUBLISHED yazilar ile yeniden yazimi onay bekleyen yayindaki
 * yazilar (site haritasi ve llms-full onlari da listeler — ai-sitemap.service
 * publicArticleWhere); kaydin adresi sitenin KENDI host'unda olmali (site haritasi
 * kurali, sameSiteUrl). Hedef tipleri (republish-policy.ts kipleri):
 *  - WordPress (REST / XML-RPC): adaptorun yayinda dondurdugu adres (kalici baglanti
 *    ya da ?p=). Kanit kosulu kayittaki yazi durumundan (remoteStatus: RanksUp'in son
 *    yaziminda WordPress'in bildirdigi durum), hedefin bugunku ayarindan DEGIL:
 *    'publish' dogrudan kanit; taslak / bekleyen / ozel yazi once bir kez canli
 *    gorulmeli; durumu bilinmeyen eski kayitta duz ?p= baglantisi once gorulmeli, guzel
 *    kalici baglanti dogrudan kanit (republish-policy wordPressLinkNeedsSighting; site
 *    haritasi ayni kurali kullanir). NEDEN: musteri hedefin "Yayın durumu"nu "Taslak"tan
 *    "Yayında"ya alinca WordPress'te taslak kalan eski yazilar emekliye ayriliyordu.
 *  - FTP / SFTP / cPanel: kayitli adres sitedeyse o (cPanel), degilse dosya
 *    hedefinin kanonik adresi (article-url.util.ts — yayinci sayfaya ayni kuralla
 *    <link rel="canonical"> yazar): klasor ve dosya adi KAYITTAKI konumdan (yayinin
 *    dosyayi yazdigi yer), hedefin bugunku klasor ayarindan degil. NEDEN: musteri yeni
 *    yazilar icin klasoru degistirince eski sayfa eski adreste yayinda kaliyor, bugunku
 *    ayardan kurulan adres ise 404 veriyordu. Kural site haritasi / llms-full ile TEK
 *    islevde (ai-sitemap.service fileCopyPublicUrl): denetlenen adres ilan edilen adrestir.
 *  - KobiPratik, GitHub: kayitli adres sitedeyse (GitHub'in kaydettigi github.com
 *    dosya gorunumu sitenin sayfasi degildir ve ozel depoda anonim 404 verir: denetlenmez).
 *  - Yalniz yeni kayit acan hedefler (Ghost, Strapi, Webflow, Sanity, Contentful,
 *    WHMCS, ozel PHP, Shopify, Wix) ve Markdown ZIP DENETLENMEZ: yonetim paneli adresi
 *    ya da disa aktarim dosyasidir; ayrica emekliye ayrilan kaydin hedefine yeniden yayin
 *    bu hedeflerde "zaten yayında" diye engellenirdi (decideRepublish 'create_only').
 *
 * Sinirlar: tur basina en fazla LIVENESS_RUN_MAX_REQUESTS istek (ana sayfalar dahil),
 * site basina en fazla LIVENESS_SITE_MAX_CHECKS adres, ayni siteye ardisik istekler
 * arasinda LIVENESS_SPACING_MS, turun toplam suresi LIVENESS_RUN_MAX_MS. Ayni adres tek
 * istek. Site basina kapasiteyi asan kopyalar gunden gune donusumlu denetlenir; ilk
 * basarisizligi kayitli olanlar (onay bekleyen) her zaman once. Tur yeniden calissa da
 * ayni sonucu uretir (20 saat kurali); bir sitenin ya da yazinin hatasi turu durdurmaz.
 *
 * API ve worker ayni AppModule'u yukler: @Cron iki proseste tetiklenir, gunluk kilit
 * (common/cron-lock.ts) yalniz birinin calismasina izin verir.
 */

/** Tur basina toplam istek tavani (ana sayfalar dahil) */
export const LIVENESS_RUN_MAX_REQUESTS = 400;
/** Site basina tur basina en fazla denetlenen adres (ana sayfa haric) */
export const LIVENESS_SITE_MAX_CHECKS = 40;
/** Ayni siteye ardisik iki istek arasindaki bekleme (nazik tarama) */
export const LIVENESS_SPACING_MS = 2_000;
/** Turun duvar saati tavani: asilinca yeni istek baslatilmaz */
export const LIVENESS_RUN_MAX_MS = 30 * 60_000;
/** Bir turda okunan en fazla site (bugun 11; tavan buyuk olcekte sorguyu sinirlar) */
export const LIVENESS_MAX_SITES = 500;
/** Site basina okunan en fazla yazi — site haritasiyla ayni (ai-sitemap.service take 1000) */
export const LIVENESS_ARTICLES_PER_SITE = 1000;
/** Site basina tur basina tek tek bildirilen yazi; fazlasi tek ozet bildirimde */
export const LIVENESS_NOTIFY_PER_SITE = 5;
/** Kilit adi (common/cron-lock.ts) */
export const LIVENESS_LOCK = 'published-liveness';

/**
 * Istek secenekleri — yayincinin adres yoklamasiyla AYNI (public-url-probe.ts PUBLIC_URL_FETCH:
 * 32 KB govde tavani, en fazla 3 yonlendirme, 10 sn; gerekce ve kaynaklar orada). Sorgulu
 * adreste (WordPress ?p=<id>) govdenin daha uzun bir on kismi okunur: kanonik baglanti
 * denetimi (publicUrlFetchOptions).
 */
export const LIVENESS_FETCH: SafeTextOptions = PUBLIC_URL_FETCH;

/** Yazma yarisinda yeniden okuma sayisi; tukenirse kopya bu tur yazilmaz (sonraki tur yeniden bakar) */
const COMMIT_ATTEMPTS = 3;

const DAY_MS = 86_400_000;

/** Denetlenecek adres ve kanit kosulu */
export interface LivenessCheckTarget {
  url: string;
  /** Adres bir kez canli gorulmeden 404 kanit sayilmaz (LivenessObservation.needsSighting) */
  needsSighting: boolean;
}

/**
 * Kopyanin denetlenecek herkese acik adresi (saf); denetlenmeyecekse null. Kurallar
 * dosya basindaki aciklamada. target: kaydin hedef satiri (silinmisse undefined).
 */
export function livenessCheckTarget(
  site: URL,
  articleSlug: string,
  entry: LiveEntry,
  target: { type?: unknown; config?: unknown } | undefined,
): LivenessCheckTarget | null {
  const type = String(target?.type ?? entry.targetType ?? '');
  const recorded = liveEntryRef(entry).externalUrl;
  if (type === 'WORDPRESS_REST' || type === 'WORDPRESS_XMLRPC') {
    const url = sameSiteUrl(site, recorded);
    if (!url) return null;
    // Kanit kosulu kayittaki yazi durumundan (RanksUp'in son yaziminda WordPress'in bildirdigi):
    // hedefin bugunku "Yayın durumu" ayari eski yazilarin WordPress'teki durumunu soylemez
    return { url, needsSighting: wordPressLinkNeedsSighting(entry, url) };
  }
  if (type === 'KOBIPRATIK' || type === 'GITHUB') {
    const url = sameSiteUrl(site, recorded);
    return url ? { url, needsSighting: true } : null;
  }
  if (type === 'FTP' || type === 'SFTP' || type === 'CPANEL_API') {
    const onSite = sameSiteUrl(site, recorded);
    if (onSite) return { url: onSite, needsSighting: true };
    if (!target) return null;
    // Klasor ve dosya adi yayinin dosyayi YAZDIGI yerden (kayittaki konum); hedefin bugunku
    // klasor ayari ve yazinin slug'i yalniz konumu kayitli olmayan eski kayitta. Site haritasi
    // ve llms-full ayni islevi kullanir: yoklanan adres ilan edilen adrestir.
    const url = fileCopyPublicUrl(site, entry, { type, config: target.config }, articleSlug);
    return url ? { url, needsSighting: true } : null;
  }
  return null;
}

/** Bir adresin denetimi: hangi yazilarin hangi kayitlarina islenecegi */
interface CheckSlot {
  url: string;
  /** Bu adresteki kopyalardan birinin ilk basarisiz denetimi kayitli (onay bekliyor) */
  pending: boolean;
  refs: Array<{
    articleId: string;
    targetId: string;
    address: string;
    needsSighting: boolean;
    /** Okunan kayitta ilk basarisiz denetim var mi (goneSince) */
    gonePending: boolean;
    /** Okunan kayitta BU adres bir kez canli gorulmus mu (liveSeenAt + liveSeenUrl === url) */
    seen: boolean;
  }>;
}

/**
 * Sonuc bu kaydi degistirebilir mi (okunan kayda gore)? Degistiremeyecekse yazi yeniden
 * okunmaz: saglikli kopyalar her gun bosuna DB okumasi yaptirmasin. Karar yine de
 * yazmadan once guncel kayda gore verilir (commitArticle); goneSince / liveSeenAt'i
 * yalniz bu (kilitli, gunde tek) tur yazdigi icin okunan kayit burada yeterlidir.
 * Baska bir adreste gorulmus kopya bu adres icin gorulmemis sayilir (kanit adrese bagli).
 */
function mayChange(outcome: LivenessOutcome, ref: CheckSlot['refs'][number]): boolean {
  const kanit = !ref.needsSighting || ref.seen;
  if (outcome === 'gone') return kanit;
  if (outcome === 'live') return ref.gonePending || !kanit;
  return false;
}

/** Listeyi offset kadar dondurur (girdi degismez) */
function rotate<T>(list: readonly T[], offset: number): T[] {
  if (list.length === 0) return [];
  const k = ((offset % list.length) + list.length) % list.length;
  return [...list.slice(k), ...list.slice(0, k)];
}

/**
 * Site icin bu turda denetlenecek adresler (saf): ilk basarisizligi kayitli olanlar once
 * (ikinci denetim gecikmesin), geri kalan gunden gune donusumlu (kapasiteyi asan sitede
 * her adres sirayla denetlenir; denetim zamani kayda yazilmaz, gereksiz yazim olmaz).
 */
export function planSiteChecks<T extends { pending: boolean }>(slots: readonly T[], cap: number, day: number): T[] {
  if (cap <= 0) return [];
  const pending = slots.filter((s) => s.pending);
  const rest = slots.filter((s) => !s.pending);
  return [...pending, ...rotate(rest, day * cap)].slice(0, cap);
}

/** Emekliye ayrilan kopyasi olan yazi (bildirim icin) */
export interface RetiredArticle {
  articleId: string;
  title: string;
  /** Emekliye ayrilan kopyalarin hedef adlari (Turkce) */
  labels: string[];
  /** Sitede canli kopyasi kaldi mi (Markdown ZIP sayilmaz) */
  otherLiveCopies: boolean;
  /**
   * Emekliye ayrilan bir WordPress kopyasini RanksUp en son herkese acik OLMAYAN bir yazi
   * olarak yazdi: kayittaki durum (draft, pending, private...; republish-policy
   * wordPressNonPublicCopy). Yoksa undefined (durum 'publish' ya da bilinmiyor).
   */
  wordPressNonPublicStatus?: string;
}

/** Bildirim basliginda uzun yazi basligi kisaltilir */
function kisaBaslik(title: string, max = 80): string {
  const t = title.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** Kayitli WordPress durumunun bildirimdeki adi ("... olarak yazdı" cumlesi icin) */
function wordPressDurumAdi(status: string): string {
  switch (status) {
    case 'draft': return 'taslak';
    case 'pending': return 'onay bekleyen bir yazı';
    case 'private': return 'özel bir yazı';
    case 'future': return 'zamanlanmış bir yazı';
    default: return 'herkese açık olmayan bir yazı';
  }
}

/**
 * Site sahibine gidecek panel bildirimi (saf). Sitede canli kopyasi kalmayan yazi icin
 * metin urun sahibinin verdigi metindir; baska hedefte canli kopyasi kalan yazi icin
 * "RanksUp bu yazıyı yayında saymıyor" dogru olmazdi: yalniz o kopya dusurulur.
 *
 * RanksUp'in en son herkese acik olmayan bir WordPress yazisi olarak yazdigi kopyada
 * (wordPressNonPublicStatus) "yazinin sayfasindan yeniden yayinla" onerisi YANLIS olurdu:
 * yerinde guncelleme WordPress'teki durumu degistirmez (adaptor update() status gondermez),
 * yazi taslak kalir, panel onu yine yayinda gosterirdi. Metin musteriye yaziyi WordPress'te
 * yayina almasini soyler; RanksUp'ta yeniden yayin yalniz ondan SONRA kaydi yeniler
 * (emekli kopya kendiliginden denetlenmez).
 */
export function retirementNotice(item: RetiredArticle): { title: string; body: string } {
  const baslik = item.title.replace(/\s+/g, ' ').trim() || 'Adsız yazı';
  const wpDurum = item.wordPressNonPublicStatus !== undefined ? wordPressDurumAdi(item.wordPressNonPublicStatus) : null;
  if (!item.otherLiveCopies) {
    const title = `“${kisaBaslik(baslik)}” yazısı sitende artık yayında görünmüyor`;
    if (wpDurum) {
      return {
        title,
        body: `“${baslik}” yazısı sitende artık yayında görünmüyor (adres 404 veriyor). RanksUp bu yazıyı yayında saymıyor. RanksUp yazıyı WordPress’e en son ${wpDurum} olarak yazdı ve WordPress’teki yazının durumunu değiştirmez; bu yüzden yazının sayfasından yeniden yayınlamak onu sitende yayına almaz. Yeniden yayında görmek istersen yazıyı WordPress’te yayına al (çöp kutusundaysa önce geri yükle); ardından yazının sayfasından WordPress hedefini seçerek yayınlarsan RanksUp onu yeniden yayında sayar.`,
      };
    }
    return {
      title,
      body: `“${baslik}” yazısı sitende artık yayında görünmüyor (adres 404 veriyor). RanksUp bu yazıyı yayında saymıyor; yeniden yayınlamak istersen yazının sayfasından yayınlayabilirsin.`,
    };
  }
  const hedef = [...new Set(item.labels)].join(', ') || 'bir yayın hedefi';
  const title = `“${kisaBaslik(baslik)}” yazısının bir kopyası sitende artık yayında görünmüyor`;
  const head = `“${baslik}” yazısının ${hedef} üzerindeki kopyası sitende artık yayında görünmüyor (adres 404 veriyor). RanksUp bu kopyayı yayında saymıyor; yazının diğer yayın hedeflerindeki kopyaları yayında sayılmaya devam ediyor.`;
  if (wpDurum) {
    return {
      title,
      body: `${head} RanksUp WordPress’teki kopyayı en son ${wpDurum} olarak yazdı ve WordPress’teki yazının durumunu değiştirmez; bu yüzden yeniden yayınlamak onu sitende yayına almaz. Bu kopyayı yeniden yayında görmek istersen yazıyı WordPress’te yayına al (çöp kutusundaysa önce geri yükle); ardından yazının sayfasından ${hedef} hedefini seçerek yayınlarsan RanksUp onu yeniden yayında sayar.`,
    };
  }
  return {
    title,
    body: `${head} Bu kopyayı yeniden yayınlamak istersen yazının sayfasından ${hedef} hedefini seçerek yayınlayabilirsin.`,
  };
}

/** Bir sitede LIVENESS_NOTIFY_PER_SITE'i asan yazilar icin tek ozet bildirim (saf) */
export function retirementSummaryNotice(siteName: string, items: readonly RetiredArticle[]): { title: string; body: string } {
  const ornek = items.slice(0, 3).map((i) => `“${kisaBaslik(i.title, 60)}”`).join(', ');
  const devam = items.length > 3 ? ' ve diğerleri' : '';
  // Herkese acik olmayan WordPress kopyasi: yeniden yayin onu yayina almaz (retirementNotice)
  const wp = items.some((i) => i.wordPressNonPublicStatus !== undefined)
    ? ' RanksUp’ın WordPress’e en son herkese açık olmayan (taslak, onay bekleyen ya da özel) bir yazı olarak yazdıklarını yeniden yayınlamak onları sitende yayına almaz: önce WordPress’te yayına al.'
    : '';
  return {
    title: `${items.length} yazı daha sitende artık yayında görünmüyor`,
    body: `${siteName} sitesinde ${items.length} yazının adresi daha 404 veriyor: ${ornek}${devam}. RanksUp bu yazıları (ya da 404 veren kopyalarını) yayında saymıyor; yeniden yayınlamak istediklerini yazının sayfasından yayınlayabilirsin.${wp}`,
  };
}

/** Turun ozeti (log ve test) */
export interface LivenessRunSummary {
  /** Ana sayfasi ayakta bulunup kopyalari denetlenen site */
  sites: number;
  /** Ana sayfasi ayakta degil / engelli: bu turda o sitede hicbir sey yazilmadi */
  sitesDown: number;
  requests: number;
  live: number;
  gone: number;
  unknown: number;
  /** Ilk basarisiz denetimi yazilan kopya */
  goneMarked: number;
  /** Basarili denetimle ilk basarisizligi silinen kopya */
  cleared: number;
  /** Ilk kez canli gorulen (adresi artik kanit sayilan) kopya */
  seen: number;
  /**
   * Canli gorulmesiyle ilan edilen adresi degisen yazi (advertisedArticleEntry): or. durumu
   * bilinmeyen eski duz ?p= kopya ya da WordPress'te sonradan yayina alinan taslak. Sitede
   * boyle yazi varsa llms-full o turda bir kez yeniden uretilir.
   */
  advertised: number;
  /** Emekliye ayrilan kopya */
  retired: number;
  /** PUBLISHED'dan cikan yazi */
  movedOut: number;
  notified: number;
  /** Tavanlardan biri (istek, site basina adres, sure) devreye girdi */
  capped: boolean;
  errors: number;
}

function emptySummary(): LivenessRunSummary {
  return {
    sites: 0, sitesDown: 0, requests: 0, live: 0, gone: 0, unknown: 0, goneMarked: 0, cleared: 0, seen: 0,
    advertised: 0, retired: 0, movedOut: 0, notified: 0, capped: false, errors: 0,
  };
}

type TargetRow = { id: string; type: unknown; config: unknown };
type SiteRow = { id: string; url: string; userId: string; name: string; publishTargets: TargetRow[] };

@Injectable()
export class PublishedLivenessService {
  private readonly log = new Logger(PublishedLivenessService.name);
  /** SSRF korumali metin okuma (testte degistirilir) */
  protected fetchText: (url: string, opts: SafeTextOptions) => Promise<SafeTextResult> = safeFetchText;
  /** Istekler arasi bekleme (testte aninda) */
  protected sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  /** Saat (testte sabit) */
  protected now: () => Date = () => new Date();

  constructor(
    private readonly prisma: PrismaService,
    private readonly llmsFull: LlmsFullBuilderService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Her gun 05:20 (Istanbul): ayni saat, iki denetim arasinda ~24 saat (LIVENESS_CONFIRM_MS 20 saat) */
  @Cron('20 5 * * *', { timeZone: 'Europe/Istanbul' })
  async cron(): Promise<void> {
    if (!(await acquireCronLock(this.prisma, LIVENESS_LOCK, 'daily'))) return;
    try {
      const s = await this.run();
      if (s.requests > 0) {
        this.log.log(
          `Yayın canlılık denetimi: ${s.sites} site (${s.sitesDown} sitenin ana sayfası açılmadı), ${s.requests} istek; `
          + `${s.live} canlı, ${s.gone} 404/410, ${s.unknown} belirsiz; ${s.goneMarked} ilk 404 kaydı, ${s.cleared} geri geldi, `
          + `${s.advertised} yazının adresi canlı görüldüğü için artık ilan ediliyor, `
          + `${s.retired} kopya yayında sayılmıyor, ${s.movedOut} yazı PUBLISHED'dan çıktı, ${s.notified} bildirim`
          + `${s.capped ? ' — tavana ulaşıldı, kalanlar sonraki turlarda' : ''}${s.errors > 0 ? `; ${s.errors} hata` : ''}`,
        );
      }
    } catch (err: any) {
      this.log.error(`Yayın canlılık denetimi başarısız: ${String(err?.message ?? err).slice(0, 300)}`);
    }
  }

  /** Tek tur (kilitsiz; cron kilidi alir) */
  async run(): Promise<LivenessRunSummary> {
    const summary = emptySummary();
    const startedAt = this.now().getTime();
    const deadline = startedAt + LIVENESS_RUN_MAX_MS;
    const day = Math.floor(startedAt / DAY_MS);
    const sites = (await this.prisma.site.findMany({
      where: {
        // Hesap silme talebi olan kullanicinin sitesi: erisim kapandi, bildirim de gitmez
        user: { deletionRequestedAt: null },
        articles: { some: publicArticleFilter() },
      },
      // Kimlik bilgisi (credentials) okunmaz: yalniz tip ve adres kurali icin ayar
      select: { id: true, url: true, userId: true, name: true, publishTargets: { select: { id: true, type: true, config: true } } },
      orderBy: { id: 'asc' },
      take: LIVENESS_MAX_SITES,
    })) as SiteRow[];
    // Istek tavani dolarsa her gun ayni siteler kalmasin: baslangic gunden gune kayar
    for (const site of rotate(sites, day)) {
      if (summary.requests >= LIVENESS_RUN_MAX_REQUESTS || this.now().getTime() > deadline) {
        summary.capped = true;
        break;
      }
      try {
        await this.checkSite(site, day, deadline, summary);
      } catch (err: any) {
        // Bir sitenin hatasi turu durdurmaz
        summary.errors += 1;
        this.log.warn(`[${site.id}] Yayın canlılık denetimi bu site için yapılamadı: ${String(err?.message ?? err).slice(0, 200)}`);
      }
    }
    return summary;
  }

  private async checkSite(site: SiteRow, day: number, deadline: number, summary: LivenessRunSummary): Promise<void> {
    const siteUrl = parseSiteUrl(site.url);
    if (!siteUrl) return;
    const articles = await this.prisma.article.findMany({
      where: publicArticleWhere(site.id),
      select: { id: true, title: true, slug: true, publishedTo: true },
      orderBy: { publishedAt: 'desc' },
      take: LIVENESS_ARTICLES_PER_SITE,
    });
    const targetById = new Map(site.publishTargets.map((t) => [t.id, t]));
    // Ayni adres (ayni yazinin yinelenen kaydi, ayni sayfayi gosteren iki yazi) tek istek
    const slots = new Map<string, CheckSlot>();
    for (const a of articles) {
      for (const e of liveEntries(a.publishedTo)) {
        const t = livenessCheckTarget(siteUrl, a.slug, e, targetById.get(e.targetId));
        if (!t) continue;
        const slot = slots.get(t.url) ?? { url: t.url, pending: false, refs: [] };
        const iso = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v));
        slot.pending ||= iso(e.goneSince);
        slot.refs.push({
          articleId: a.id,
          targetId: e.targetId,
          address: liveEntryRef(e).externalUrl ?? '',
          needsSighting: t.needsSighting,
          gonePending: e.goneSince !== undefined || e.goneUrl !== undefined,
          // Canli gorulme yalniz goruldugu adres icin kanit (applyLivenessObservations ile ayni kural)
          seen: iso(e.liveSeenAt) && e.liveSeenUrl === t.url,
        });
        slots.set(t.url, slot);
      }
    }
    if (slots.size === 0) return;

    const room = LIVENESS_RUN_MAX_REQUESTS - summary.requests - 1;
    if (room <= 0) {
      summary.capped = true;
      return;
    }
    const plan = planSiteChecks([...slots.values()], Math.min(LIVENESS_SITE_MAX_CHECKS, room), day);
    if (plan.length < slots.size) summary.capped = true;

    // Site ayakta mi — ayni turda. Ana sayfa acilmiyorsa (kesinti, bakim, engel) 404'ler
    // sitenin genel durumundan olabilir: bu site icin hicbir sey yazilmaz.
    const homepage = siteHomepage(siteUrl);
    summary.requests += 1;
    if ((await this.probe(homepage, null)) !== 'live') {
      summary.sitesDown += 1;
      this.log.warn(`[${site.id}] Ana sayfa açılmadı (${homepage}); yayındaki kopyalar bu turda değerlendirilmedi`);
      return;
    }
    summary.sites += 1;

    const observations = new Map<string, LivenessObservation[]>();
    const changing = new Set<string>();
    for (const slot of plan) {
      if (this.now().getTime() > deadline) {
        summary.capped = true;
        break;
      }
      await this.sleep(LIVENESS_SPACING_MS);
      const checkedAt = this.now().toISOString();
      summary.requests += 1;
      const outcome = await this.probe(slot.url, homepage);
      summary[outcome] += 1;
      for (const r of slot.refs) {
        const list = observations.get(r.articleId) ?? [];
        // url: kanit (liveSeenUrl / goneUrl) gercekten yoklanan adrese baglanir
        list.push({ targetId: r.targetId, address: r.address, url: slot.url, outcome, checkedAt, needsSighting: r.needsSighting });
        observations.set(r.articleId, list);
        if (mayChange(outcome, r)) changing.add(r.articleId);
      }
    }

    // Ilan kurali site haritasi / llms-full ile ayni (advertisedArticleEntry); hedef satirindan tip + ayar
    const targetRefs = new Map(site.publishTargets.map((t) => [t.id, { type: String(t.type), config: t.config }]));
    const advertisedUrl = (slug: string, publishedTo: unknown) => advertisedArticleEntry(siteUrl, slug, publishedTo, targetRefs)?.url ?? null;
    const retired: RetiredArticle[] = [];
    let advertisedHere = 0;
    for (const [articleId, obs] of observations) {
      // Belirsiz sonuc, saglikli kopya ve kanit sayilmayan 404 hicbir seyi degistirmez: okuma / yazma yok
      if (!changing.has(articleId)) continue;
      try {
        const r = await this.commitArticle(articleId, obs, targetById, { siteUrl, targetRefs });
        if (!r) continue;
        summary.goneMarked += r.marked;
        summary.cleared += r.cleared;
        summary.seen += r.seen;
        // Ilk canli gorulme kopyayi ilan edilebilir yaptiysa (durumu bilinmeyen eski duz ?p= kopya,
        // WordPress'te sonradan yayina alinan taslak) sitemap-ai bir sonraki uretimde alir; llms-full
        // ise yalniz haftalik / yayin / emeklilik yeniden uretiminde. Asagida site icin bir kez uretilir.
        if (r.seen > 0) {
          const after = advertisedUrl(r.slug, r.publishedTo);
          if (after !== null && after !== advertisedUrl(r.slug, r.previousPublishedTo)) {
            summary.advertised += 1;
            advertisedHere += 1;
          }
        }
        if (r.retired.length > 0) {
          summary.retired += r.retired.length;
          if (r.movedOut) summary.movedOut += 1;
          // RanksUp'in en son herkese acik olmayan WordPress yazisi olarak yazdigi kopya:
          // bildirim "WordPress'te yayina al" der (yeniden yayin durumu degistirmez)
          const wpNonPublic = r.retired.find((e) => UPDATE_TARGET_TYPES.has(String(targetById.get(e.targetId)?.type ?? e.targetType ?? ''))
            && wordPressNonPublicCopy(e));
          const wpStatus = wpNonPublic ? recordedWordPressStatus(wpNonPublic) : null;
          retired.push({
            articleId,
            title: r.title,
            labels: r.retired.map((e) => targetLabel(targetById.get(e.targetId)?.type ?? e.targetType)),
            otherLiveCopies: r.otherLiveCopies,
            ...(wpStatus ? { wordPressNonPublicStatus: wpStatus } : {}),
          });
        }
      } catch (err: any) {
        summary.errors += 1;
        this.log.warn(`[${articleId}] Canlılık sonucu kaydedilemedi: ${String(err?.message ?? err).slice(0, 200)}`);
      }
    }
    if (retired.length === 0 && advertisedHere === 0) return;

    if (retired.length > 0) {
      this.log.warn(`[${site.id}] Adresi iki denetimde 404/410 veren ${retired.length} yazının kopyası artık yayında sayılmıyor: ${retired.map((r) => r.articleId).join(', ')}`);
    }
    // llms-full haftalik yenilemeyi beklemesin (en iyi caba): olu adres AI tarayicilarina
    // gosterilmesin, ilk kez canli gorulen adres de ilan edilsin. Site basina turda TEK uretim
    // (emeklilik ve yeni ilan ayni turda olsa da); hatasi turu durdurmaz. sitemap-ai.xml istekte
    // uretilir; surec ici onbellegi en gec PUBLIC_SITEMAP_TTL_MS sonra yenilenir.
    await this.llmsFull.build(site.id)
      .catch((err: any) => this.log.warn(`[${site.id}] llms-full.txt yeniden üretilemedi: ${String(err?.message ?? err).slice(0, 200)}`));
    if (retired.length > 0) summary.notified += await this.notifyRetired(site, retired);
  }

  /**
   * Adresi yoklar; hata firlatmaz (her belirsizlik 'unknown'). Sorgulu adreste (WordPress ?p=<id>)
   * govdenin daha uzun on kismi okunur: sorguyu yok sayan onbellek ana sayfayi sunduysa sayfanin
   * kanonik baglantisi bunu gosterir (public-url-probe.ts publicUrlFetchOptions).
   */
  private async probe(url: string, homepage: string | null): Promise<LivenessOutcome> {
    try {
      const res = await this.fetchText(url, publicUrlFetchOptions(url));
      return classifyLivenessResponse(res, { requested: url, homepage });
    } catch {
      return 'unknown';
    }
  }

  /**
   * Gozlemleri yaziya yazar — GUNCEL kayit uzerine, iyimser kilitle (publisher.service
   * commitArticleState / articles.service writeEntries ile ayni yaklasim): kayit
   * yeniden okunur, karar o listeye gore verilir, yazim yalniz okunan updatedAt hala
   * gecerliyse yapilir. Yarisirsa yeniden okunur; COMMIT_ATTEMPTS sonra bu tur
   * yazilmaz. Yayincidan farki: kosulsuz yazim YOK — kaybolan bir canlilik gozlemi
   * zararsizdir (ertesi gun yeniden gorulur), eski listeyle yayin kaydini ezmek degil.
   */
  private async commitArticle(
    articleId: string,
    observations: LivenessObservation[],
    targetById: Map<string, TargetRow>,
    site: { siteUrl: URL; targetRefs: Map<string, { type: string; config: unknown }> },
  ): Promise<{
    title: string; slug: string; retired: LiveEntry[]; marked: number; cleared: number; seen: number; movedOut: boolean; otherLiveCopies: boolean;
    /** Yazimdan onceki (okunan) ve sonraki kayitlar: ilan edilen adres degisti mi (checkSite) */
    previousPublishedTo: unknown; publishedTo: unknown;
  } | null> {
    const typeOf = (targetId: string) => targetById.get(targetId)?.type;
    for (let attempt = 1; attempt <= COMMIT_ATTEMPTS; attempt += 1) {
      const fresh = await this.prisma.article.findUnique({
        where: { id: articleId },
        select: { id: true, title: true, slug: true, status: true, publishedTo: true, updatedAt: true },
      });
      if (!fresh) return null;
      const applied = applyLivenessObservations(fresh.publishedTo, observations);
      if (!applied.changed) return null;
      const previous = String(fresh.status ?? '');
      const status = applied.retired.length > 0 ? statusAfterRetirement(previous, applied.publishedTo, typeOf) : previous;
      // Emekli kopyanin adresini canonical bildiren dosya kopyalari "elle guncelleme bekliyor"
      // (ai-sitemap.service flagRetiredCanonicalCopies): site haritasi artik dosya kopyasini ilan
      // ediyor, sayfasi ise hala 404 veren adresi kanonik bildiriyor
      const canonical = applied.retired.length > 0
        ? flagRetiredCanonicalCopies({
          site: site.siteUrl, slug: String(fresh.slug ?? ''), before: fresh.publishedTo, after: applied.publishedTo,
          targets: site.targetRefs, now: this.now().toISOString(),
        })
        : { publishedTo: applied.publishedTo, flagged: [] as string[] };
      const r = await this.prisma.article.updateMany({
        where: { id: articleId, updatedAt: fresh.updatedAt },
        data: {
          publishedTo: canonical.publishedTo as any,
          ...(status !== previous ? { status: status as any } : {}),
          updatedAt: new Date(),
        },
      });
      if (r.count === 1) {
        if (canonical.flagged.length > 0) {
          this.log.warn(`[${articleId}] Emekli kopyanın adresini canonical bildiren kopyalar elle güncelleme bekliyor: ${canonical.flagged.join(', ')}`);
        }
        const otherLiveCopies = siteLiveEntries(applied.publishedTo, typeOf).length > 0;
        return {
          title: String(fresh.title ?? ''),
          slug: String(fresh.slug ?? ''),
          retired: applied.retired,
          marked: applied.marked.length,
          cleared: applied.cleared,
          seen: applied.seen,
          movedOut: status !== previous,
          otherLiveCopies,
          previousPublishedTo: fresh.publishedTo,
          publishedTo: canonical.publishedTo,
        };
      }
    }
    this.log.warn(`[${articleId}] Canlılık sonucu yazılmadı: kayıt ${COMMIT_ATTEMPTS} kez değişti; sonraki tur yeniden bakar`);
    return null;
  }

  /** Site sahibine panel bildirimi; bildirim hatasi turu durdurmaz. Gonderilen bildirim sayisi doner. */
  private async notifyRetired(site: SiteRow, items: RetiredArticle[]): Promise<number> {
    let sent = 0;
    const send = async (n: { title: string; body: string }, link: string, refId?: string) => {
      try {
        await this.notifications.create({
          userId: site.userId,
          type: 'SYSTEM',
          title: n.title,
          body: n.body,
          link,
          ...(refId ? { refKind: 'article', refId } : {}),
          channels: ['inapp'],
        });
        sent += 1;
      } catch (err: any) {
        this.log.warn(`[${site.id}] Canlılık bildirimi oluşturulamadı: ${String(err?.message ?? err).slice(0, 200)}`);
      }
    };
    for (const item of items.slice(0, LIVENESS_NOTIFY_PER_SITE)) {
      await send(retirementNotice(item), `/sites/${site.id}/articles/${item.articleId}`, item.articleId);
    }
    const rest = items.slice(LIVENESS_NOTIFY_PER_SITE);
    if (rest.length > 0) await send(retirementSummaryNotice(site.name, rest), `/sites/${site.id}/articles`);
    return sent;
  }
}
