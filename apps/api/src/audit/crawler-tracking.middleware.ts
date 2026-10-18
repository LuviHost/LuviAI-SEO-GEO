import { Injectable, Logger, NestMiddleware, RequestMethod } from '@nestjs/common';
import type { RouteInfo } from '@nestjs/common/interfaces/middleware/middleware-configuration.interface.js';
import type { Request, Response, NextFunction } from 'express';
import { PrismaService } from '../prisma/prisma.service.js';
import { clientIp } from '../common/client-ip.js';

/**
 * Kullanici ajani (UA) → kanonik bot adi.
 *
 * Google-Extended BILEREK YOK: "Google-Extended doesn't have a separate HTTP
 * request user agent string. Crawling is done with existing Google user agent
 * strings; the robots.txt user-agent token is used in a control capacity."
 * (https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers,
 * 2026-10-18'de dogrulandi). Gercek bir istek bu adla gelmez; eslesen UA ancak
 * taklittir. Robots.txt belirteci olarak known-ai-bots.ts'te kalir.
 */
const BOT_REGISTRY: Record<string, RegExp> = {
  'GPTBot': /GPTBot/i,
  'OAI-SearchBot': /OAI-SearchBot/i,
  'ChatGPT-User': /ChatGPT-User/i,
  'ClaudeBot': /ClaudeBot/i,
  'Claude-Web': /Claude-Web/i,
  'PerplexityBot': /PerplexityBot/i,
  'Perplexity-User': /Perplexity-User/i,
  'Googlebot': /Googlebot[^-]/i,
  'Bingbot': /Bingbot/i,
  'Applebot': /Applebot[^-]/i,
  'Applebot-Extended': /Applebot-Extended/i,
  'Bytespider': /Bytespider/i,
  'Amazonbot': /Amazonbot/i,
  'CCBot': /CCBot/i,
  'YouBot': /YouBot/i,
  'cohere-ai': /cohere-ai/i,
  'DuckAssistBot': /DuckAssistBot/i,
  'Meta-ExternalAgent': /Meta-ExternalAgent/i,
  'Mistral': /Mistral/i,
  'DeepSeek': /DeepSeek/i,
};

/**
 * Ara katmanin calistigi TEK yollar (app.module.ts forRoutes).
 *
 * NEDEN: ara katman eskiden HER API isteginde calisiyordu (forRoutes('*')) ve
 * guard/throttle'dan ONCE kosuyordu: bot UA'si tasiyan herhangi bir istek,
 * sorgudaki ?site= ile istedigi siteye "AI bot ziyareti" yazdirabiliyordu.
 * Mesru bot sinyali yalniz musteri sitesine gomulu betikten gelir:
 *  - GET /api/tracker.js?site=  — bot betik dosyasini indirdi. Buyuk AI
 *    tarayicilari JS calistirmaz ama dosyayi indirir (geo-lab-panel.tsx
 *    TrackerEmbedTab bu iki yolu musteriye anlatiyor);
 *  - GET /api/tracker/beacon?site= — betigi CALISTIRAN ziyaretci.
 * Global onek ('api') Nest tarafindan eklenir (RouteInfoPathExtractor).
 */
export const CRAWLER_TRACKING_ROUTES: RouteInfo[] = [
  { path: 'tracker.js', method: RequestMethod.GET },
  { path: 'tracker/beacon', method: RequestMethod.GET },
];

/**
 * Prisma cuid() (v1) bicimi: 'c' + 24 kucuk harf/rakam. Buyuk harfli varyant
 * BILEREK reddedilir: MySQL'in harf duyarsiz karsilastirmasi 'CMOJ...' ile
 * 'cmoj...'yu ayni siteye esler, ama kayit ham metinle yazilirdi.
 */
const SITE_ID_RE = /^c[a-z0-9]{24}$/;

/**
 * Beacon sayim tavanlari. Bellek ici ve surec basina (en iyi caba): amac
 * sahte istekle sisirilebilecek sayiyi SINIRLAMAK. Mesru hacim cok dusuk:
 * betik adresi sitenin her sayfasinda aynidir (bot bir kez indirir) ve
 * buyuk AI tarayicilari betigi calistirmaz.
 */
export interface BeaconLimits {
  /** Ayni IP + ayni site icin saatte kabul edilen en fazla istek */
  ipSitePerHour: number;
  /** Ayni IP'den saatte (tum siteler) — rastgele kimlik yagmurunu keser */
  ipPerHour: number;
  /** Site basina UTC gununde yazilan en fazla beacon istegi (tum botlar) */
  sitePerDay: number;
  /**
   * Sayac tablolarinin ve site onbelleklerinin anahtar tavani — dagitik
   * saldirida bellek siniri. Dolunca EN ESKI anahtar atilir (yeni anahtar
   * reddedilmez; bkz. WindowCounter).
   */
  maxKeys: number;
  /**
   * Bosaltilmayi bekleyen (site, gun, bot) grubu tavani. Var oldugu bilinen
   * siteler ile henuz dogrulanmamis kimlikler AYRI tamponda, her biri bu
   * tavanla: rastgele kimlik yagmuru bilinen sitelerin tamponunu dolduramaz.
   */
  maxPendingGroups: number;
  /** Bu kadar grup birikince 60 sn beklenmeden bosaltilir */
  flushAtGroups: number;
  /** Site var/yok onbellegi suresi */
  siteCacheMs: number;
}

export const BEACON_LIMITS: BeaconLimits = {
  ipSitePerHour: 30,
  ipPerHour: 600,
  sitePerDay: 500,
  maxKeys: 50_000,
  maxPendingGroups: 5_000,
  flushAtGroups: 1_000,
  siteCacheMs: 10 * 60_000,
};

const HOUR_MS = 3_600_000;

/**
 * Sabit pencereli sayac (saat ya da gun). Pencere degisince sifirlanir.
 *
 * Anahtar tavani doluysa EN ESKI anahtar atilir (Map ekleme sirasi = yas);
 * yeni anahtar REDDEDILMEZ. NEDEN (R15): eski surum doluyken her yeni anahtari
 * reddediyordu; tek bir istemci rastgele (cuid bicimli) site kimlikleriyle
 * tabloyu doldurup saatin geri kalaninda TUM musterilerin bot isabetlerini
 * 'ip_limited' diye, iz birakmadan dusurtebiliyordu. Simdi bellek yine
 * sinirli, ama doluluk baska istemcileri engellemez. Atilan anahtarin sayaci
 * sifirlanir (o anahtarin saatlik tavani gevser — acik hata yonu); yazilan
 * toplam yine site basina gunluk tavanla (sitePerDay) sinirli.
 */
class WindowCounter {
  private window = Number.NaN;
  private readonly counts = new Map<string, number>();
  /** Tavan yuzunden atilan anahtar sayisi (birikimli; bosaltma logu farki yazar) */
  evicted = 0;

  constructor(private readonly windowMs: number, private readonly maxKeys: number) {}

  private roll(now: number) {
    const w = Math.floor(now / this.windowMs);
    if (w !== this.window) {
      this.window = w;
      this.counts.clear();
    }
  }

  /** Anahtar tavana takilmis mi — anahtar ACMADAN bakar */
  allows(key: string, limit: number, now: number): boolean {
    this.roll(now);
    return (this.counts.get(key) ?? 0) < limit;
  }

  take(key: string, limit: number, now: number): boolean {
    this.roll(now);
    const cur = this.counts.get(key) ?? 0;
    if (cur >= limit) return false;
    if (cur === 0) {
      while (this.counts.size >= this.maxKeys) {
        const oldest = this.counts.keys().next().value;
        if (oldest === undefined) break;
        this.counts.delete(oldest);
        this.evicted++;
      }
    }
    this.counts.set(key, cur + 1);
    return true;
  }

  get size(): number {
    return this.counts.size;
  }
}

interface PendingGroup {
  siteId: string;
  /** UTC gun, YYYY-MM-DD */
  day: string;
  bot: string;
  hits: number;
}

/** Sayacin DB'ye dokundugu yuzey — testte sahtelenir */
export interface BeaconDb {
  site: {
    findMany(args: { where: { id: { in: string[] } }; select: { id: true } }): Promise<Array<{ id: string }>>;
  };
  aiCrawlerHit: {
    upsert(args: unknown): Promise<unknown>;
  };
}

export type BeaconRecordResult =
  | 'not_bot'
  | 'bad_site'
  | 'unknown_site'
  | 'ip_limited'
  | 'buffer_full'
  | 'buffered';

/**
 * Betik/beacon bot sayaci — guvenilmeyen kaynak.
 *
 * KURALLAR (her biri bir saldiri yolunu kapatir):
 *  - site: yalniz kanonik cuid VE veritabaninda var olan site (onbellekli,
 *    bosaltmada toplu sorgu). Eskiden rastgele kimlik de yaziliyordu (sahipsiz satir).
 *  - YALNIZ istek SAYISI yazilir. ?status= / ?bytes= / ?url= OKUNMAZ: mesru
 *    betik bunlari zaten gondermez; eskiden saldirgan status=500 yazip
 *    CrawlerErrorAlarmService'e "GPTBot sitene ulasamiyor" bildirimi
 *    urettirebiliyordu. Durum sayaclari yalniz imzali ingest
 *    (/tracker/events) ve oturumlu log yuklemesinden gelir; alarm da yalniz
 *    durum kodu bilinen istekleri sayar (crawler-error-alarm.service.ts).
 *    topUrls/uniqueUrls'e de dokunulmaz: eski update bunlari her 60 sn'de
 *    yalniz o partinin adresleriyle EZIYOR, log yuklemesinin listesini siliyordu.
 *  - Gruplama anahtari girdiden '|' ile birlestirilmez: eskiden
 *    ?site=<id>|<tarih>|<metin> ile tarih ve bot adi (bildirim basligina
 *    giden serbest metin) secilebiliyordu. Alanlar ayri tutulur, anahtar
 *    JSON.stringify ile kurulur.
 *  - Gun UTC'dir (live-crawler/log yuklemesiyle ayni); eski setHours yerel
 *    gece yarisi Istanbul saatinde kaydi bir onceki gune yaziyordu.
 *  - IP+site ve IP basina saatlik, site basina gunluk tavan.
 *
 * BELLEK SINIRI KIMSEYI KILITLEMEZ (R15). Eskiden IP+site anahtari IP tavanina
 * BAKILMADAN aciliyordu (tavana takilan istek de anahtar aciyordu) ve dolu
 * tablo her yeni anahtari reddediyordu: tek IP saatte 50.000 rastgele kimlikle
 * tabloyu doldurup o saatin kalaninda butun musterilerin bot isabetlerini
 * dusurtebiliyordu. Simdi:
 *  - once IP+site tavanina ANAHTAR ACMADAN bakilir, sonra IP tavani alinir,
 *    en son IP+site anahtari acilir: tavana takilan IP baska anahtar acamaz;
 *  - tablolar dolunca en eski anahtar atilir (WindowCounter);
 *  - var oldugu bilinen siteler (knownSites) ile var olmadigi bilinenler
 *    (missingSites) ayri onbellekte: rastgele kimlikler bilinen siteyi
 *    onbellekten atamaz;
 *  - bilinen sitelerin gruplari ayri tamponda: dogrulanmamis kimlik yagmuru
 *    onlari 'buffer_full'a dusuremez.
 */
export class CrawlerBeaconCounter {
  /** Var oldugu bilinen sitelerin gruplari */
  private readonly pending = new Map<string, PendingGroup>();
  /** Henuz dogrulanmamis kimliklerin gruplari (bosaltmada DB'ye sorulur) */
  private readonly pendingUnresolved = new Map<string, PendingGroup>();
  /** Var oldugu dogrulanan site → dogrulamanin gecerlilik sonu (yalniz gercek siteler girer) */
  private readonly knownSites = new Map<string, number>();
  /** Var olmadigi dogrulanan kimlik → negatif kaydin gecerlilik sonu */
  private readonly missingSites = new Map<string, number>();
  private readonly ipCounter: WindowCounter;
  private readonly ipSiteCounter: WindowCounter;
  private readonly siteDay = new Map<string, number>();
  private flushing: Promise<{ written: number; dropped: number }> | null = null;
  private readonly log = new Logger('CrawlerBeaconCounter');
  /** Gozlem: son bosaltmadan beri tampon dolulugu ve tablo tasmasi */
  private bufferFull = 0;
  private reportedEvictions = 0;

  constructor(
    private readonly db: BeaconDb,
    private readonly limits: BeaconLimits = BEACON_LIMITS,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.ipCounter = new WindowCounter(HOUR_MS, limits.maxKeys);
    this.ipSiteCounter = new WindowCounter(HOUR_MS, limits.maxKeys);
  }

  record(input: { ua: unknown; site: unknown; ip: string }): BeaconRecordResult {
    const bot = typeof input.ua === 'string' ? detectBotName(input.ua) : null;
    if (!bot) return 'not_bot';
    // Express qs ?site=a&site=b'yi diziye, ?site[x]=y'yi nesneye cevirir: yalniz duz metin
    const site = input.site;
    if (typeof site !== 'string' || !SITE_ID_RE.test(site)) return 'bad_site';
    const now = this.now();
    const missingUntil = this.missingSites.get(site);
    if (missingUntil !== undefined && missingUntil > now) return 'unknown_site';

    const ip = input.ip || 'unknown';
    const ipSiteKey = JSON.stringify([ip, site]);
    // Sira onemli: IP+site tavanina takilan istek IP payini harcamaz, IP
    // tavanina takilan istek IP+site anahtari ACAMAZ
    if (!this.ipSiteCounter.allows(ipSiteKey, this.limits.ipSitePerHour, now)) return 'ip_limited';
    if (!this.ipCounter.take(ip, this.limits.ipPerHour, now)) return 'ip_limited';
    this.ipSiteCounter.take(ipSiteKey, this.limits.ipSitePerHour, now);

    // Dogrulama suresi gecmis olsa da bir kez var oldugu gorulen site bilinen
    // tampona girer; varligi bosaltmada yeniden sorulur (silinmis olabilir)
    const buffer = this.knownSites.has(site) ? this.pending : this.pendingUnresolved;
    const day = new Date(now).toISOString().slice(0, 10);
    const key = JSON.stringify([site, day, bot]);
    const group = buffer.get(key);
    if (group) {
      group.hits++;
    } else {
      if (buffer.size >= this.limits.maxPendingGroups) {
        this.bufferFull++;
        this.flush().catch(() => undefined);
        return 'buffer_full';
      }
      buffer.set(key, { siteId: site, day, bot, hits: 1 });
    }
    if (this.pending.size + this.pendingUnresolved.size >= this.limits.flushAtGroups) this.flush().catch(() => undefined);
    return 'buffered';
  }

  /** Bekleyen gruplari yazar; ayni anda tek bosaltma calisir */
  flush(): Promise<{ written: number; dropped: number }> {
    if (this.flushing) return this.flushing;
    const run = this.doFlush().finally(() => {
      this.flushing = null;
    });
    this.flushing = run;
    return run;
  }

  private async doFlush(): Promise<{ written: number; dropped: number }> {
    this.reportPressure();
    if (this.pending.size === 0 && this.pendingUnresolved.size === 0) return { written: 0, dropped: 0 };
    const groups = [...this.pending.values(), ...this.pendingUnresolved.values()];
    this.pending.clear();
    this.pendingUnresolved.clear();

    let existing: Set<string>;
    try {
      existing = await this.existingSites(groups.map((g) => g.siteId));
    } catch (err: any) {
      // En iyi caba: DB'ye ulasilamazsa parti dusurulur, bellek sismez
      this.log.warn(`Beacon site sorgusu basarisiz, ${groups.length} grup atlandi: ${err?.message ?? err}`);
      return { written: 0, dropped: groups.length };
    }

    this.pruneSiteDay();
    let written = 0;
    let dropped = 0;
    for (const g of groups) {
      if (!existing.has(g.siteId)) { dropped++; continue; }
      const accepted = this.takeSiteDay(g.siteId, g.day, g.hits);
      if (accepted <= 0) { dropped++; continue; }
      const date = new Date(`${g.day}T00:00:00.000Z`);
      try {
        await this.db.aiCrawlerHit.upsert({
          where: { siteId_date_bot: { siteId: g.siteId, date, bot: g.bot } },
          // Yalniz istek sayisi: durum sayaclari, bayt ve adres listesi
          // guvenilir kaynaklarin (imzali ingest, log yuklemesi) alanidir.
          update: { hits: { increment: accepted } },
          create: { siteId: g.siteId, date, bot: g.bot, hits: accepted, uniqueUrls: 0, topUrls: [] },
        });
        written++;
      } catch (err: any) {
        dropped++;
        this.log.warn(`Beacon kaydi yazilamadi (${g.siteId} ${g.day} ${g.bot}): ${err?.message ?? err}`);
      }
    }
    if (written > 0 || dropped > 0) this.log.log(`Crawler beacon flush: ${written} grup yazildi, ${dropped} atlandi`);
    return { written, dropped };
  }

  /** Var olan site kimlikleri — gecerli onbellekte olmayanlar tek sorguyla */
  private async existingSites(ids: string[]): Promise<Set<string>> {
    const now = this.now();
    const out = new Set<string>();
    const ask: string[] = [];
    for (const id of new Set(ids)) {
      const knownUntil = this.knownSites.get(id);
      if (knownUntil !== undefined && knownUntil > now) {
        out.add(id);
        continue;
      }
      const missingUntil = this.missingSites.get(id);
      if (missingUntil !== undefined && missingUntil > now) continue;
      ask.push(id);
    }
    if (ask.length > 0) {
      const rows = await this.db.site.findMany({ where: { id: { in: ask } }, select: { id: true } });
      // MySQL harf duyarsiz eslesebilir: yalniz birebir ayni kimlik "var" sayilir
      // (Set.has birebir karsilastirir)
      const found = new Set(rows.map((r) => r.id));
      const until = now + this.limits.siteCacheMs;
      for (const id of ask) {
        if (found.has(id)) {
          this.missingSites.delete(id);
          this.remember(this.knownSites, id, until);
          out.add(id);
        } else {
          // Silinmis site artik bilinen sayilmaz
          this.knownSites.delete(id);
          this.remember(this.missingSites, id, until);
        }
      }
    }
    return out;
  }

  /** Onbellege yazar; ekleme sirasi = yas, tavan asilinca en eski kayitlar atilir */
  private remember(cache: Map<string, number>, id: string, until: number) {
    cache.delete(id);
    cache.set(id, until);
    while (cache.size > this.limits.maxKeys) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  }

  /**
   * Tampon doldu ya da sayac tablolari tasti mi: rastgele kimlik yagmuru
   * gibi bir saldiri ops'ta gorunsun (eskiden isabetler iz birakmadan dusuyordu).
   */
  private reportPressure() {
    const evicted = this.ipCounter.evicted + this.ipSiteCounter.evicted;
    const newEvictions = evicted - this.reportedEvictions;
    if (newEvictions > 0 || this.bufferFull > 0) {
      this.log.warn(
        `Beacon tablolari dolu: son bosaltmadan beri ${newEvictions} sayac anahtari tasindi (en eskiler atildi), ` +
        `${this.bufferFull} istek tampon dolu diye yazilmadi — olasi rastgele kimlik yagmuru`,
      );
    }
    this.reportedEvictions = evicted;
    this.bufferFull = 0;
  }

  /** Site+gun tavanindan kalan payi dusup kabul edilen sayiyi doner */
  private takeSiteDay(siteId: string, day: string, hits: number): number {
    const key = JSON.stringify([day, siteId]);
    const used = this.siteDay.get(key) ?? 0;
    const accepted = Math.max(0, Math.min(hits, this.limits.sitePerDay - used));
    if (accepted > 0) this.siteDay.set(key, used + accepted);
    return accepted;
  }

  /** Bugun ve dunden eski gun sayaclari silinir (gece yarisini asan parti dunu yazabilir) */
  private pruneSiteDay() {
    const today = new Date(this.now()).toISOString().slice(0, 10);
    const yesterday = new Date(this.now() - 86_400_000).toISOString().slice(0, 10);
    for (const key of this.siteDay.keys()) {
      const day = (JSON.parse(key) as [string, string])[0];
      if (day !== today && day !== yesterday) this.siteDay.delete(key);
    }
  }
}

function detectBotName(ua: string): string | null {
  for (const [name, re] of Object.entries(BOT_REGISTRY)) {
    if (re.test(ua)) return name;
  }
  return null;
}

/**
 * Crawler Tracking Middleware — YALNIZ betik/beacon uclarinda (CRAWLER_TRACKING_ROUTES)
 * calisir; bot UA'si tasiyan istegi sayar, 60 sn'de bir DB'ye yazar.
 *
 * Bu yol GUVENILMEYEN bir sinyaldir: UA ve site kimligi herkese aciktir
 * (betik gomme kodu, sitemap-ai adresi). Bu yuzden yalniz istek sayisi tutulur;
 * bot hata alarmi ve durum sayaclari imzali ingest ile log yuklemesinden beslenir.
 */
@Injectable()
export class CrawlerTrackingMiddleware implements NestMiddleware {
  /**
   * Sayac surec basina TEK: sinif hem AppModule ara katmani hem AuditModule
   * saglayicisi olarak iki kez orneklenebilir; ikisi ayni tamponu paylasir.
   */
  private static counter: CrawlerBeaconCounter | null = null;
  private static flushTimer: NodeJS.Timeout | null = null;

  constructor(private readonly prisma: PrismaService) {
    CrawlerTrackingMiddleware.counter ??= new CrawlerBeaconCounter(prisma as unknown as BeaconDb);
    if (!CrawlerTrackingMiddleware.flushTimer) {
      const timer = setInterval(() => {
        CrawlerTrackingMiddleware.counter?.flush().catch(() => undefined);
      }, 60_000);
      // Zamanlayici sureci tek basina ayakta tutmasin (worker, testler)
      timer.unref?.();
      CrawlerTrackingMiddleware.flushTimer = timer;
    }
  }

  use(req: Request, _res: Response, next: NextFunction) {
    try {
      CrawlerTrackingMiddleware.counter?.record({
        ua: req.headers['user-agent'],
        site: req.query?.site,
        ip: clientIp(req),
      });
    } catch {
      // Sayim istegi asla dusurmez
    }
    next();
  }

  private detectBot(ua: string): string | null {
    return detectBotName(ua);
  }
}
