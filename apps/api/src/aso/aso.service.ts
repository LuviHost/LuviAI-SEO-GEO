import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AppStore, KeywordSource } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AsoScrapersService } from './scrapers.service.js';
import { AsoKeywordService } from './keyword.service.js';
import { AsoTrackerService } from './tracker.service.js';
import { AsoReviewsService } from './reviews.service.js';
import { AsoAiAgentService } from './ai-agent.service.js';
import { QuotaService } from '../billing/quota.service.js';
import { nextCreativeAssetState, buildIosCreativeAssetFindings } from './creative-asset-findings.js';
import { auditKeywordField, countCharacters } from './keyword-field-audit.js';
import { APP_STORE_LIMITS, GOOGLE_PLAY_LIMITS } from './store-limits.js';

export interface ConnectAppDto {
  siteId: string;
  appStoreId?: string;
  playStoreId?: string;
  country?: string;
}

@Injectable()
export class AsoService {
  private readonly log = new Logger(AsoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scrapers: AsoScrapersService,
    private readonly keywords: AsoKeywordService,
    private readonly tracker: AsoTrackerService,
    private readonly reviews: AsoReviewsService,
    private readonly aiAgent: AsoAiAgentService,
    private readonly quota: QuotaService,
  ) {}

  // ─────────────────────────────────────────────
  //  App search — name → store result list
  // ─────────────────────────────────────────────

  /**
   * Hem App Store hem Play Store'da arar.
   * URL parse fallback: kullanıcı URL yapıştırırsa, ID/package'ı çıkarır + tek app döner.
   */
  async searchApps(opts: {
    term: string;
    store?: 'IOS' | 'ANDROID' | 'BOTH';
    country?: string;
  }) {
    const term = opts.term.trim();
    if (!term) return { results: [] as any[] };

    // URL detection
    const urlInfo = this.parseAppUrl(term);
    if (urlInfo) {
      const country = opts.country ?? urlInfo.country ?? 'tr';
      const app: any = urlInfo.store === 'IOS'
        ? await this.scrapers.getIosApp({ id: urlInfo.id, country })
        : await this.scrapers.getAndroidApp({ appId: urlInfo.id, country });
      const measuredLocale = this.scrapers.locale(country).measuredLocale;
      if (!app) return { results: [], parsedUrl: urlInfo, measuredLocale };
      return {
        parsedUrl: urlInfo,
        measuredLocale,
        results: [{
          id: urlInfo.id,
          store: urlInfo.store,
          name: app.title,
          developer: app.developer,
          icon: app.icon,
          rating: app.score ?? null,
          reviewCount: app.reviews ?? null,
          category: app.primaryGenre ?? app.genre ?? null,
        }],
      };
    }

    // Regular search
    const country = opts.country ?? 'tr';
    const store = opts.store ?? 'BOTH';
    const promises: Promise<any[]>[] = [];

    if (store === 'IOS' || store === 'BOTH') {
      promises.push(
        this.scrapers.iosSearch({ term, country, num: 15 })
          .then(arr => arr.map((a: any) => ({
            id: String(a.id ?? a.appId),
            store: 'IOS' as const,
            name: a.title,
            developer: a.developer,
            icon: a.icon,
            rating: a.score ?? null,
            reviewCount: a.reviews ?? null,
            category: a.primaryGenre ?? null,
          })))
          .catch(() => [])
      );
    }
    if (store === 'ANDROID' || store === 'BOTH') {
      promises.push(
        this.scrapers.androidSearch({ term, country, num: 15 })
          .then(arr => arr.map((a: any) => ({
            id: a.appId,
            store: 'ANDROID' as const,
            name: a.title,
            developer: a.developer,
            icon: a.icon,
            rating: a.score ?? null,
            reviewCount: a.reviews ?? null,
            category: a.genre ?? null,
          })))
          .catch(() => [])
      );
    }

    const results = (await Promise.all(promises)).flat();
    // Hangi ulke+dil ile arandigi doner; ayni terim baska lokalde baska sonuc verir.
    return { results, measuredLocale: this.scrapers.locale(country).measuredLocale };
  }

  /**
   * URL'den iOS app id veya Android package çıkarır.
   * Desteklenen formatlar:
   * - https://apps.apple.com/tr/app/luvihost/id6444904356
   * - https://apps.apple.com/app/id6444904356
   * - https://play.google.com/store/apps/details?id=com.example.app
   */
  parseAppUrl(input: string): { store: 'IOS' | 'ANDROID'; id: string; country?: string } | null {
    const s = input.trim();
    if (!s.includes('://')) return null;
    try {
      const url = new URL(s);
      const host = url.hostname.toLowerCase();
      if (host.includes('apple.com')) {
        const m = url.pathname.match(/\/id(\d+)/);
        if (m) {
          const cc = url.pathname.match(/^\/([a-z]{2})\//);
          return { store: 'IOS', id: m[1], country: cc ? cc[1] : undefined };
        }
      }
      if (host.includes('play.google.com')) {
        const id = url.searchParams.get('id');
        if (id) {
          const gl = url.searchParams.get('gl');
          return { store: 'ANDROID', id, country: gl ? gl.toLowerCase() : undefined };
        }
      }
    } catch {
      // ignore
    }
    return null;
  }

  /**
   * Bir magazadaki kelimeleri DIGER magazaya kopyalar.
   *
   * NEDEN GEREKLI: TrackedAppKeyword magaza basina AYRI satir tutuyor
   * (@@unique([trackedAppId, keyword, store])) — cunku ayni kelimenin App
   * Store ve Play sirasi farkli seylerdir ve ayri olculmeleri gerekir.
   * Ama kelime ekleme kutusundaki magaza secici varsayilan iOS'ta aciliyor;
   * dokunulmazsa her kelime yalnizca iOS'a yaziliyor. Uretimde tam olarak bu
   * oldu: 91 kelimenin TAMAMI iOS, Android'de tek bir olcum bile yok.
   *
   * Elle 50 kelimeyi tek tek yeniden eklemek yerine tek islemle aynalaniyor.
   * Zaten var olan kelimeler atlanir (kota ve mukerrer satir olusmasin).
   */
  async mirrorKeywords(opts: { trackedAppId: string; from: 'IOS' | 'ANDROID'; to: 'IOS' | 'ANDROID' }) {
    if (opts.from === opts.to) throw new BadRequestException('Kaynak ve hedef mağaza aynı olamaz');

    const app = await this.prisma.trackedApp.findUnique({
      where: { id: opts.trackedAppId },
      select: { id: true, name: true, appStoreId: true, playStoreId: true },
    });
    if (!app) throw new BadRequestException('Uygulama bulunamadı');

    // Hedef magazanin kimligi yoksa olcum yapilamaz — kelimeyi kopyalamak
    // yalnizca olculemeyecek satirlar uretirdi.
    const hedefKimlik = opts.to === 'IOS' ? app.appStoreId : app.playStoreId;
    if (!hedefKimlik) {
      throw new BadRequestException(
        `Bu uygulamanın ${opts.to === 'IOS' ? 'App Store' : 'Google Play'} bağlantısı yok — önce o mağazayı bağla`,
      );
    }

    const kaynak = await this.prisma.trackedAppKeyword.findMany({
      where: { trackedAppId: opts.trackedAppId, store: opts.from as any },
      select: { keyword: true, source: true },
    });
    if (!kaynak.length) throw new BadRequestException('Kopyalanacak kelime yok');

    const mevcut = new Set(
      (
        await this.prisma.trackedAppKeyword.findMany({
          where: { trackedAppId: opts.trackedAppId, store: opts.to as any },
          select: { keyword: true },
        })
      ).map((k) => k.keyword.toLowerCase()),
    );

    const eklenecek = kaynak.filter((k) => !mevcut.has(k.keyword.toLowerCase()));
    if (eklenecek.length) {
      await this.prisma.trackedAppKeyword.createMany({
        data: eklenecek.map((k) => ({
          trackedAppId: opts.trackedAppId,
          keyword: k.keyword,
          store: opts.to as any,
          source: k.source ?? 'mirror',
        })),
        skipDuplicates: true,
      });
    }

    this.log.log(
      `[${app.name}] ${opts.from} -> ${opts.to}: ${eklenecek.length} kelime kopyalandi, ${kaynak.length - eklenecek.length} zaten vardi`,
    );

    // Skorlar ve siralamalar BILEREK burada hesaplanmiyor: 50 kelime x magaza
    // istegi dakikalar surer ve istegi acik tutar. Kullanici "Skorları Yenile"
    // ve "Tüm Rank'leri Çek" ile tetikler.
    return {
      eklenen: eklenecek.length,
      zatenVardi: kaynak.length - eklenecek.length,
      hedefMagaza: opts.to,
    };
  }

  // ─────────────────────────────────────────────
  //  App connect / list / delete
  // ─────────────────────────────────────────────

  async connectApp(dto: ConnectAppDto) {
    if (!dto.appStoreId && !dto.playStoreId) {
      throw new BadRequestException('App Store ID veya Play Store ID gerekli');
    }

    const country = dto.country ?? 'tr';

    // AYNI UYGULAMANIN IKINCI MAGAZASI YENI UYGULAMA DEGILDIR.
    //
    // Sema bir TrackedApp'in HEM appStoreId HEM playStoreId tutmasina izin
    // veriyor — cunku bunlar ayni urunun iki magazasi. Ama eski kod kaydi
    // (appStoreId, playStoreId) CIFTIYLE ariyordu: iOS'ta zaten takip edilen
    // bir uygulamanin Android'i eklenmek istendiginde eslesme bulunamiyor,
    // yeni kayit sayiliyor ve plan kotasina takiliyordu. Uretimde tam olarak
    // bu yasandi: KobiPratik (appStoreId dolu, playStoreId null) icin Android
    // eklenmek istendi, "Plan limiti: 3 uygulama" hatasi alindi.
    //
    // Ikinci kusur: arama `?? ''` ile bos dize ariyor ama create `?? null`
    // yaziyordu. MySQL'de '' ile NULL esit degil ve NULL iceren unique indeks
    // tekrari engellemez — yani ayni Android uygulamasi iki kez eklenirse
    // arama yine bulamaz ve MUKERRER satir olusurdu.
    //
    // Cozum: kaydi MAGAZA KIMLIGIYLE ari. Biri eslesiyorsa ayni uygulamadir;
    // eksik yarisi doldurulur, kota TUKETILMEZ.
    let eslesme = await this.prisma.trackedApp.findFirst({
      where: {
        siteId: dto.siteId,
        country,
        OR: [
          ...(dto.appStoreId ? [{ appStoreId: dto.appStoreId }] : []),
          ...(dto.playStoreId ? [{ playStoreId: dto.playStoreId }] : []),
        ],
      },
      select: { id: true, appStoreId: true, playStoreId: true, name: true, metadata: true },
    });

    // Metadata fetch
    const ios = dto.appStoreId
      ? await this.scrapers.getIosApp({ id: dto.appStoreId, country })
      : null;
    const android = dto.playStoreId
      ? await this.scrapers.getAndroidApp({ appId: dto.playStoreId, country })
      : null;

    if (!ios && !android) {
      throw new BadRequestException('App store\'larında bulunamadı. ID veya country yanlış olabilir.');
    }

    const name = ios?.title ?? android?.title ?? 'Unknown App';

    // IKINCI MAGAZA EKLENIRKEN PAYLASILAN KIMLIK YOKTUR.
    //
    // Yukaridaki eslestirme magaza kimligine bakiyor; ama iOS'ta takip edilen
    // bir uygulamanin Android'i eklenirken elimizde YALNIZCA playStoreId var
    // ve mevcut kaydin playStoreId'si null — ortak hicbir kimlik yok, yani o
    // arama zorunlu olarak bos doner. Uretimde tam olarak bu yasandi:
    // KobiPratik iOS'ta kayitliyken Android eklenemiyor, "Plan limiti"
    // hatasi aliniyordu.
    //
    // Bu yuzden ikinci olcut AD: magaza basligi normalize edilip ayni sitedeki
    // ayni ulkeli kayitlarla karsilastiriliyor. Uc korumasi var:
    //   1. Hedef magaza yuvasi BOS olmali (iOS ekliyorsak appStoreId null)
    //   2. Tam olarak BIR aday eslesmeli — birden fazlaysa hangisi oldugu
    //      belirsiz, yeni kayit acilir
    //   3. Ad normalize edilir (buyuk/kucuk, aksan, bosluk, noktalama)
    //
    // Gelistirici adi BILEREK olcut degil: uretimde ayni uygulama iOS'ta
    // "Emir Burgazl", Play'de "Emirhan Burgazli" olarak kayitli — magazalar
    // farkli yaziyor ve zorunlu tutmak dogru birlestirmeyi engellerdi.
    if (!eslesme) {
      const normalize = (x: string) =>
        x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const hedefIos = !!dto.appStoreId;
      const adaylar = await this.prisma.trackedApp.findMany({
        where: {
          siteId: dto.siteId,
          country,
          // Hedef magaza yuvasi bos olan kayitlar
          ...(hedefIos ? { appStoreId: null } : { playStoreId: null }),
        },
        select: { id: true, appStoreId: true, playStoreId: true, name: true, metadata: true },
      });
      const hedefAd = normalize(name);
      const uyanlar = adaylar.filter((a) => normalize(a.name) === hedefAd);

      if (uyanlar.length === 1) {
        eslesme = uyanlar[0];
        this.log.log(
          `[${dto.siteId}] "${name}" ad eslesmesiyle mevcut kayda baglandi ` +
            `(${hedefIos ? 'iOS' : 'Android'} yuvasi dolduruluyor) — yeni uygulama sayilmiyor`,
        );
      } else if (uyanlar.length > 1) {
        this.log.warn(
          `[${dto.siteId}] "${name}" icin ${uyanlar.length} aday kayit var — belirsiz, yeni kayit aciliyor`,
        );
      }
    }

    // KOTA KONTROLU EN SONDA.
    //
    // Bilerek metadata cekiminden ve HER IKI eslestirmeden sonra: uygulamanin
    // adi ancak magaza metadata'si gelince biliniyor, ad eslestirmesi de ona
    // dayaniyor. Kota once calissaydi (eski hali boyleydi) ikinci magaza
    // eklenirken kayit "yeni" sanilip kotaya takilirdi — uretimde tam olarak
    // bu oldu.
    //
    // Bedeli: kotasi dolu bir kullanici icin bir magaza metadata istegi bosa
    // gider. Bu, dogru uygulamayi eklemeyi engellemekten cok daha ucuz.
    if (!eslesme) {
      const site = await this.prisma.site.findUnique({
        where: { id: dto.siteId },
        select: { userId: true },
      });
      if (!site) throw new BadRequestException('Site bulunamadı');
      await this.quota.enforceTrackedAppQuota(site.userId);
    } else if (
      (dto.appStoreId && !eslesme.appStoreId) ||
      (dto.playStoreId && !eslesme.playStoreId)
    ) {
      this.log.log(
        `[${dto.siteId}] "${eslesme.name}" mevcut kayda ikinci magaza ekleniyor ` +
          `(iOS=${dto.appStoreId ?? eslesme.appStoreId ?? '-'}, Play=${dto.playStoreId ?? eslesme.playStoreId ?? '-'}) — kota tuketilmiyor`,
      );
    }
    const developer = ios?.developer ?? android?.developer ?? null;
    const category = ios?.primaryGenre ?? android?.genre ?? null;
    const iconUrl = ios?.icon ?? android?.icon ?? null;

    // Magaza kimlikleri BIRLESTIRILIYOR: yeni gelen doldurur, eskisi silinmez.
    // Aksi halde Android eklerken iOS kimligi kaybolur ve o magazadaki tum
    // siralama gecmisi kopardi.
    const birlesikIos = dto.appStoreId ?? eslesme?.appStoreId ?? null;
    const birlesikPlay = dto.playStoreId ?? eslesme?.playStoreId ?? null;

    const ortakVeri = {
      name,
      developer,
      category,
      iconUrl,
      // creativeAssets: ekran goruntusu kumesinin degisim takibi (migration'siz,
      // ayni Json kolonu) — "son 90 gunde yaratici varlik degismedi" uyarisi icin.
      metadata: {
        ios, android,
        creativeAssets: nextCreativeAssetState(ios as any, (eslesme?.metadata as any)?.creativeAssets ?? null, new Date()),
      } as any,
      lastFetchedAt: new Date(),
      // Bu turda olculemeyen magazanin degeri EZILMEZ: yalnizca Android
      // eklenirken iOS puani null'a dusmemeli.
      ...(ios ? { iosRating: ios.score ?? null, iosReviewCount: ios.reviews ?? null } : {}),
      ...(android ? { androidRating: android.score ?? null, androidReviewCount: android.reviews ?? null } : {}),
    };

    const tracked = eslesme
      ? await this.prisma.trackedApp.update({
          where: { id: eslesme.id },
          data: { ...ortakVeri, appStoreId: birlesikIos, playStoreId: birlesikPlay },
        })
      : await this.prisma.trackedApp.create({
          data: {
            siteId: dto.siteId,
            appStoreId: birlesikIos,
            playStoreId: birlesikPlay,
            country,
            ...ortakVeri,
          },
        });

    return tracked;
  }

  async listApps(siteId: string) {
    return this.prisma.trackedApp.findMany({
      where: { siteId },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { keywords: true, reviews: true } },
      },
    });
  }

  async getApp(trackedAppId: string) {
    const app = await this.prisma.trackedApp.findUnique({
      where: { id: trackedAppId },
      include: {
        keywords: {
          orderBy: { currentRank: 'asc' },
          take: 200,
        },
        _count: { select: { reviews: true } },
      },
    });
    if (!app) throw new NotFoundException('App bulunamadı');
    return app;
  }

  async deleteApp(trackedAppId: string) {
    await this.prisma.trackedApp.delete({ where: { id: trackedAppId } });
    return { ok: true };
  }

  async refreshMetadata(trackedAppId: string) {
    const app = await this.prisma.trackedApp.findUniqueOrThrow({
      where: { id: trackedAppId },
    });
    return this.connectApp({
      siteId: app.siteId,
      appStoreId: app.appStoreId ?? undefined,
      playStoreId: app.playStoreId ?? undefined,
      country: app.country,
    });
  }

  /**
   * Mevcut TrackedApp'e ikinci store'u (iOS veya Android) ekle.
   * Yeni record yaratmak yerine var olanı update eder.
   */
  async linkStore(opts: {
    trackedAppId: string;
    appStoreId?: string;
    playStoreId?: string;
  }) {
    const app = await this.prisma.trackedApp.findUniqueOrThrow({
      where: { id: opts.trackedAppId },
    });

    if (!opts.appStoreId && !opts.playStoreId) {
      throw new BadRequestException('appStoreId veya playStoreId gerekli');
    }

    // Hangi store ekleniyor?
    if (opts.appStoreId && app.appStoreId) {
      throw new BadRequestException('Bu app\'in zaten App Store versiyonu bağlı');
    }
    if (opts.playStoreId && app.playStoreId) {
      throw new BadRequestException('Bu app\'in zaten Play Store versiyonu bağlı');
    }

    // Yeni store metadata'sını fetch et
    const country = app.country;
    const newIos = opts.appStoreId
      ? await this.scrapers.getIosApp({ id: opts.appStoreId, country })
      : null;
    const newAndroid = opts.playStoreId
      ? await this.scrapers.getAndroidApp({ appId: opts.playStoreId, country })
      : null;

    if (opts.appStoreId && !newIos) {
      throw new BadRequestException('App Store\'da bulunamadı. ID veya country yanlış olabilir.');
    }
    if (opts.playStoreId && !newAndroid) {
      throw new BadRequestException('Play Store\'da bulunamadı. Package adı veya country yanlış olabilir.');
    }

    // Mevcut metadata'yı koru, yeni store'u ekle
    const currentMeta: any = app.metadata ?? {};
    const updatedMeta = {
      ios: newIos ?? currentMeta.ios ?? null,
      android: newAndroid ?? currentMeta.android ?? null,
    };

    return this.prisma.trackedApp.update({
      where: { id: opts.trackedAppId },
      data: {
        appStoreId: opts.appStoreId ?? app.appStoreId,
        playStoreId: opts.playStoreId ?? app.playStoreId,
        metadata: updatedMeta as any,
        lastFetchedAt: new Date(),
        iosRating: newIos ? (newIos as any).score ?? null : app.iosRating,
        iosReviewCount: newIos ? (newIos as any).reviews ?? null : app.iosReviewCount,
        androidRating: newAndroid ? (newAndroid as any).score ?? null : app.androidRating,
        androidReviewCount: newAndroid ? (newAndroid as any).reviews ?? null : app.androidReviewCount,
      },
    });
  }

  // ─────────────────────────────────────────────
  //  Keyword management
  // ─────────────────────────────────────────────

  async addKeyword(opts: {
    trackedAppId: string;
    keyword: string;
    store: AppStore;
    source?: KeywordSource;
  }) {
    const app = await this.prisma.trackedApp.findUniqueOrThrow({
      where: { id: opts.trackedAppId },
    });

    // aso-v2 ile skor
    const scores = await this.keywords.scoreKeyword({
      keyword: opts.keyword,
      store: opts.store as 'IOS' | 'ANDROID',
      country: app.country,
    });

    return this.prisma.trackedAppKeyword.upsert({
      where: {
        trackedAppId_keyword_store: {
          trackedAppId: opts.trackedAppId,
          keyword: opts.keyword,
          store: opts.store,
        },
      },
      create: {
        trackedAppId: opts.trackedAppId,
        keyword: opts.keyword,
        store: opts.store,
        source: opts.source ?? 'MANUAL',
        popularity: scores.popularity,
        difficulty: scores.difficulty,
        traffic: scores.traffic,
        suggested: scores.oneriliyor,
      },
      update: {
        popularity: scores.popularity,
        difficulty: scores.difficulty,
        traffic: scores.traffic,
        suggested: scores.oneriliyor,
      },
    });
  }

  async addKeywordsBulk(opts: {
    trackedAppId: string;
    keywords: string[];
    store: AppStore;
    source?: KeywordSource;
  }) {
    const created: any[] = [];
    for (const kw of opts.keywords) {
      try {
        const k = await this.addKeyword({
          trackedAppId: opts.trackedAppId,
          keyword: kw,
          store: opts.store,
          source: opts.source,
        });
        created.push(k);
      } catch (err: any) {
        this.log.warn(`Keyword "${kw}": ${err.message}`);
      }
    }
    return { count: created.length };
  }

  async removeKeyword(keywordId: string) {
    await this.prisma.trackedAppKeyword.delete({ where: { id: keywordId } });
    return { ok: true };
  }

  /** Mevcut keyword'lerin skorunu yeniden hesapla (aso-v2 score parsing fix sonrası).  */
  async refreshScoresForApp(trackedAppId: string) {
    const app = await this.prisma.trackedApp.findUniqueOrThrow({
      where: { id: trackedAppId },
    });
    const keywords = await this.prisma.trackedAppKeyword.findMany({
      where: { trackedAppId, isActive: true },
    });
    let updated = 0;
    for (const kw of keywords) {
      try {
        const s = await this.keywords.scoreKeyword({
          keyword: kw.keyword,
          store: kw.store as 'IOS' | 'ANDROID',
          country: app.country,
        });
        await this.prisma.trackedAppKeyword.update({
          where: { id: kw.id },
          data: {
            popularity: s.popularity,
            difficulty: s.difficulty,
            traffic: s.traffic,
            suggested: s.oneriliyor,
          },
        });
        updated++;
        await new Promise(r => setTimeout(r, 600)); // rate limit
      } catch (err: any) {
        this.log.warn(`[${kw.id}] score refresh: ${err.message}`);
      }
    }
    return { ok: true, updated, total: keywords.length };
  }

  async getKeywordHistory(keywordId: string, days = 30) {
    const since = new Date(Date.now() - days * 86400000);
    return this.prisma.appRanking.findMany({
      where: { trackedAppKeywordId: keywordId, checkedAt: { gte: since } },
      orderBy: { checkedAt: 'asc' },
    });
  }

  // ─────────────────────────────────────────────
  //  Forwarding to sub-services
  // ─────────────────────────────────────────────

  checkRank(keywordId: string) {
    return this.tracker.checkRank(keywordId);
  }

  checkAllRanks(trackedAppId: string) {
    return this.tracker.checkAllForApp(trackedAppId);
  }

  fetchReviews(trackedAppId: string, opts?: { limit?: number; analyzeSentiment?: boolean }) {
    return this.reviews.fetchAndAnalyze(trackedAppId, opts);
  }

  getReviewStats(trackedAppId: string) {
    return this.reviews.getReviewStats(trackedAppId);
  }

  /** ASO skoru: son 30 gundeki yorum sayisi (bilinmiyorsa skora katilmaz) */
  getRecentReviewSignal(trackedAppId: string) {
    return this.reviews.getRecentReviewSignal(trackedAppId);
  }

  discoverCompetitors(trackedAppId: string) {
    return this.prisma.trackedApp.findUniqueOrThrow({ where: { id: trackedAppId } })
      .then(app => this.aiAgent.discoverCompetitors({
        appStoreId: app.appStoreId ?? undefined,
        playStoreId: app.playStoreId ?? undefined,
        country: app.country,
      }));
  }

  async aiKeywordResearch(opts: {
    trackedAppId: string;
    competitorAppIds?: Array<{ appId: string; store: 'IOS' | 'ANDROID' }>;
    locale?: 'tr' | 'en';
  }) {
    const app = await this.prisma.trackedApp.findUniqueOrThrow({
      where: { id: opts.trackedAppId },
    });

    // Eğer rakip verilmediyse otomatik bul
    let competitors = opts.competitorAppIds;
    let competitorNames: string[] = [];
    if (!competitors || competitors.length === 0) {
      const discovered = await this.discoverCompetitors(opts.trackedAppId);
      competitors = discovered.slice(0, 5).map(c => ({
        appId: c.appId,
        store: c.store,
      }));
      // Tum benzer uygulama adlari: marka adi oneriye sizarsa ayiklanir (Apple 2.3.7)
      competitorNames = discovered.map((c) => c.name).filter((n): n is string => typeof n === 'string' && !!n);
    }

    const meta: any = app.metadata ?? {};
    const description =
      meta.ios?.description ??
      meta.android?.description ??
      '';

    return this.aiAgent.autonomousKeywordResearch({
      appName: app.name,
      appDescription: description,
      category: app.category ?? undefined,
      competitorAppIds: competitors,
      competitorNames,
      country: app.country,
      targetLocale: opts.locale ?? 'tr',
    });
  }

  async optimizeMetadata(opts: {
    trackedAppId: string;
    targetKeywords: string[];
    store: 'IOS' | 'ANDROID';
    locale?: 'tr' | 'en';
  }) {
    const app = await this.prisma.trackedApp.findUniqueOrThrow({
      where: { id: opts.trackedAppId },
    });
    const meta: any = app.metadata ?? {};
    const source = opts.store === 'IOS' ? meta.ios : meta.android;
    if (!source) throw new BadRequestException(`${opts.store} metadata bu app için yok`);

    return this.aiAgent.optimizeMetadata({
      currentTitle: source.title ?? '',
      currentSubtitle: opts.store === 'IOS' ? source.subtitle : undefined,
      // Play kisa aciklamasi scraper'da `summary`; eskiden modele hic gitmiyordu
      currentShortDescription: opts.store === 'ANDROID' ? source.summary : undefined,
      currentDescription: source.description ?? '',
      targetKeywords: opts.targetKeywords,
      locale: opts.locale ?? 'tr',
      store: opts.store,
      // Gercek puan: uretilen metindeki puan iddiasi yalniz bununla eslesirse kalir
      rating: typeof source.score === 'number' ? source.score : null,
      appName: app.name,
    });
  }

  /**
   * App Store anahtar kelime alani denetimi — kurallar saf `keyword-field-audit.ts`'te.
   * Alan herkese acik degil (iTunes dondurmez): kullanici yapistirir.
   * Ad/alt baslik/gelistirici/kategori kayitli metadata'dan (istekle ezilebilir);
   * rakip adlari benzer uygulamalardan (iTunes, LLM yok) — 8 sn'de gelmezse
   * rakip kontrolu atlanir ve bu acikca doner.
   */
  async auditKeywordField(
    trackedAppId: string,
    body: { keywords?: unknown; appName?: string; subtitle?: string; competitorNames?: string[]; checkCompetitors?: boolean },
  ) {
    if (typeof body?.keywords !== 'string') throw new BadRequestException('keywords metin olmalı');
    if (body.keywords.length > 1000) throw new BadRequestException('keywords en fazla 1000 karakter');
    const app = await this.prisma.trackedApp.findUniqueOrThrow({ where: { id: trackedAppId } });
    const ios: any = (app.metadata as any)?.ios ?? {};

    let competitorNames = Array.isArray(body.competitorNames) ? body.competitorNames.filter((n) => typeof n === 'string').slice(0, 50) : [];
    let competitorSource: 'body' | 'similar' | 'skipped' | 'failed' = competitorNames.length ? 'body' : 'skipped';
    if (!competitorNames.length && body.checkCompetitors !== false && app.appStoreId) {
      let timer: NodeJS.Timeout | undefined;
      try {
        const list = await Promise.race([
          this.discoverCompetitors(trackedAppId),
          new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error('zaman asimi')), 8000); }),
        ]);
        competitorNames = list.filter((c) => c.store === 'IOS' && c.name).map((c) => c.name);
        competitorSource = 'similar';
      } catch (err: any) {
        this.log.warn(`[${trackedAppId}] keyword denetimi: rakip adlari alinamadi — ${err.message}`);
        competitorSource = 'failed';
      } finally {
        clearTimeout(timer);
      }
    }

    const appName = body.appName?.trim() || ios.title || app.name;
    const subtitle = body.subtitle?.trim() || ios.subtitle || null;
    const companyName = app.developer ?? ios.developer ?? null;
    const categoryNames = [...new Set([app.category, ios.primaryGenre, ...(Array.isArray(ios.genres) ? ios.genres : [])].filter((c): c is string => typeof c === 'string' && !!c))];
    return {
      ...auditKeywordField({ keywords: body.keywords, appName, subtitle, companyName, competitorNames, categoryNames }),
      context: { appName, subtitle, companyName, categoryNames, competitorSource, competitorCount: competitorNames.length },
    };
  }

  // ─────────────────────────────────────────────
  //  ASO Audit — mevcut metadata vs best practices
  // ─────────────────────────────────────────────

  async auditMetadata(trackedAppId: string) {
    const app = await this.prisma.trackedApp.findUniqueOrThrow({
      where: { id: trackedAppId },
    });
    const meta: any = app.metadata ?? {};
    const ios = meta.ios ?? null;
    const android = meta.android ?? null;

    type Severity = 'ok' | 'warning' | 'error' | 'info';
    type Finding = {
      severity: Severity;
      store: 'IOS' | 'ANDROID' | 'BOTH';
      field: string;
      label: string;
      current: string | number | null;
      message?: string;
      recommendation?: string;
      docsUrl?: string;
    };

    const findings: Finding[] = [];

    // Sinirlar tek kaynaktan (store-limits.ts); karakter = kod noktasi (emoji 2 sayilmasin)
    const A = APP_STORE_LIMITS;
    const G = GOOGLE_PLAY_LIMITS;

    // ─── iOS ───
    if (ios) {
      // Title (30 char limit)
      const title = (ios.title ?? '').toString();
      const titleLen = countCharacters(title);
      if (titleLen === 0) {
        findings.push({ severity: 'error', store: 'IOS', field: 'title', label: 'App Name (Title)', current: title, message: 'Title boş', recommendation: `En kritik alan — ${A.name} char limit, ana keyword içersin.` });
      } else if (titleLen < 15) {
        findings.push({ severity: 'warning', store: 'IOS', field: 'title', label: 'App Name (Title)', current: `${titleLen}/${A.name} char`, message: 'Title çok kısa — keyword kapasitesi kullanılmıyor', recommendation: `${A.name} char limitini olabildiğince doldur. Örn: "PlanIn: Etkinlik Planlama" (25 char).` });
      } else if (titleLen > A.name) {
        findings.push({ severity: 'error', store: 'IOS', field: 'title', label: 'App Name (Title)', current: `${titleLen}/${A.name} char`, message: `Title ${A.name} karakter limitini aşıyor — Apple kabul etmez`, recommendation: `${A.name} char altına indir.` });
      } else {
        findings.push({ severity: 'ok', store: 'IOS', field: 'title', label: 'App Name (Title)', current: `${titleLen}/${A.name} char` });
      }

      // Subtitle (30 char)
      const subtitle = (ios.subtitle ?? '').toString();
      const subLen = countCharacters(subtitle);
      if (subLen === 0) {
        findings.push({ severity: 'error', store: 'IOS', field: 'subtitle', label: 'Subtitle', current: '', message: 'Subtitle boş — büyük keyword fırsatı kaçıyor', recommendation: `İkinci en güçlü ranking sinyali. ${A.subtitle} char limitini doldur, title'da geçmeyen 2-3 kelime ekle.` });
      } else if (subLen > A.subtitle) {
        findings.push({ severity: 'error', store: 'IOS', field: 'subtitle', label: 'Subtitle', current: `${subLen}/${A.subtitle} char`, message: `Subtitle ${A.subtitle} karakter limitini aşıyor — Apple kabul etmez`, recommendation: `${A.subtitle} char altına indir.` });
      } else if (subLen < 15) {
        findings.push({ severity: 'warning', store: 'IOS', field: 'subtitle', label: 'Subtitle', current: `${subLen}/${A.subtitle} char`, message: 'Subtitle çok kısa', recommendation: `${A.subtitle} char'ı doldur, destekleyici keyword ekle.` });
      } else {
        findings.push({ severity: 'ok', store: 'IOS', field: 'subtitle', label: 'Subtitle', current: `${subLen}/${A.subtitle} char` });
      }

      // Description (4000 char) — iOS'ta INDEXLENMEZ ama conversion için kritik
      const desc = (ios.description ?? '').toString();
      const descLen = countCharacters(desc);
      if (descLen === 0) {
        // Apple urun sayfasi rehberi: "The first sentence ... is what users can read without having to tap to read more"
        findings.push({ severity: 'error', store: 'IOS', field: 'description', label: 'Description', current: 0, message: 'Description boş', recommendation: 'Conversion için kritik. Ana faydayı ilk cümlede yaz: kullanıcı "daha fazla"ya dokunmadan yalnızca onu görür.' });
      } else if (descLen > A.description) {
        findings.push({ severity: 'error', store: 'IOS', field: 'description', label: 'Description', current: `${descLen}/${A.description} char`, message: `Description ${A.description} karakter limitini aşıyor`, recommendation: `${A.description} char altına indir.` });
      } else if (descLen < 500) {
        findings.push({ severity: 'warning', store: 'IOS', field: 'description', label: 'Description', current: `${descLen}/${A.description} char`, message: 'Description çok kısa — conversion düşürür', recommendation: '1500-3000 char hedefle. İlk cümlede ana fayda, devamı özellik listesi. App Store açıklamayı arama sıralamasında kullanmaz: anahtar kelime doldurma.' });
      } else {
        findings.push({ severity: 'ok', store: 'IOS', field: 'description', label: 'Description', current: `${descLen}/${A.description} char` });
      }

      // Yenilikler (release notes). Eskiden bu alan "Promotional Text" diye
      // raporlaniyordu — promosyon metni herkese acik magaza verisinde YOK
      // (yalniz ASC'den okunur, bkz. ASC Metadata paneli), releaseNotes ise
      // "What's New" alanidir.
      const whatsNew = (ios.releaseNotes ?? '').toString();
      if (!whatsNew) {
        findings.push({ severity: 'info', store: 'IOS', field: 'whatsNew', label: 'Yenilikler', current: '', message: 'Son sürümün "Yenilikler" notu boş', recommendation: 'Her güncellemede neyin değiştiğini 2-3 maddede anlat; ilk sürümde bu alan girilemez.' });
      }

      // Reviews & Ratings — "365 gunde en fazla 3 kez" ve zamanlama Apple'dan
      // (https://developer.apple.com/app-store/ratings-and-reviews/); ozel istem
      // yasagi App Review 5.6.1. Eski "ilk 3-5. gun" ve "on anket" tavsiyeleri
      // kaynaksizdi (on anket filtreleme sayilabilir).
      const reviewCount = ios.reviews ?? app.iosReviewCount ?? 0;
      const rating = ios.score ?? app.iosRating ?? 0;
      if (reviewCount === 0) {
        findings.push({ severity: 'error', store: 'IOS', field: 'reviews', label: 'Reviews', current: 0, message: 'Hiç review yok', recommendation: 'SKStoreReviewController (requestReview) ile iste: Apple 365 günde en fazla 3 kez gösterir. Kullanıcı bir işi tamamladığında iste; özel inceleme istemi kullanma (App Review 5.6.1).' });
      } else if (reviewCount < 10) {
        findings.push({ severity: 'warning', store: 'IOS', field: 'reviews', label: 'Reviews', current: `${reviewCount} review`, message: 'Review sayısı düşük', recommendation: 'Apple, isteği kullanıcının memnun olduğu anda (bir işi ya da seviyeyi tamamladığında) yapmanı öneriyor; akışı bölme.' });
      } else {
        findings.push({ severity: 'ok', store: 'IOS', field: 'reviews', label: 'Reviews', current: `${reviewCount} review · ${rating.toFixed?.(1) ?? rating}⭐` });
      }
      if (rating > 0 && rating < 4.0 && reviewCount >= 5) {
        findings.push({ severity: 'warning', store: 'IOS', field: 'rating', label: 'Rating', current: `${rating.toFixed?.(1) ?? rating}⭐`, message: 'Rating 4.0 altında', recommendation: 'Negatif review\'lara HEAR framework ile yanıt ver. Kritik bug\'ları çöz.' });
      }

      // Screenshots — 10'a kadar; onizleme yoksa ilk 1-3 gorsel arama sonucunda
      // (https://developer.apple.com/app-store/product-page/)
      const screenshotCount = (ios.screenshots ?? []).length;
      if (screenshotCount === 0) {
        findings.push({ severity: 'error', store: 'IOS', field: 'screenshots', label: 'Screenshots', current: 0, message: 'Screenshot yok' });
      } else if (screenshotCount < 5) {
        findings.push({ severity: 'warning', store: 'IOS', field: 'screenshots', label: 'Screenshots', current: `${screenshotCount}/10`, message: 'Az screenshot', recommendation: '10 slot\'a kadar ekleyebilirsin. Önizleme videosu yoksa ilk 1-3 görsel arama sonuçlarında görünür — en güçlü mesajları başa koy.' });
      } else {
        findings.push({ severity: 'ok', store: 'IOS', field: 'screenshots', label: 'Screenshots', current: `${screenshotCount}/10` });
      }

      // Yaratici varliklar: iPad ekran goruntusu, set tazeligi, video (checklist —
      // iTunes lookup video vermez; eski kod olmayan `appPreviewVideos` alanina
      // bakip videosu olan uygulamaya bile "yok" diyordu). bkz. creative-asset-findings.ts
      findings.push(...(buildIosCreativeAssetFindings(ios, meta.creativeAssets ?? null, new Date()) as Finding[]));

      // Category
      const cat = ios.primaryGenre ?? '';
      if (!cat) {
        findings.push({ severity: 'warning', store: 'IOS', field: 'category', label: 'Category', current: '', message: 'Kategori belirsiz' });
      } else {
        findings.push({ severity: 'ok', store: 'IOS', field: 'category', label: 'Category', current: cat });
      }
    }

    // ─── Android ───
    if (android) {
      // Ad — Google Play siniri 30 karakter (eskiden 50 yaziyordu: denetim
      // "kisa, 50'yi kullan" diyerek politika disi baslik oneriyordu)
      const title = (android.title ?? '').toString();
      const titleLen = countCharacters(title);
      if (titleLen === 0) {
        findings.push({ severity: 'error', store: 'ANDROID', field: 'title', label: 'Title', current: 0, message: 'Title boş' });
      } else if (titleLen > G.title) {
        findings.push({ severity: 'error', store: 'ANDROID', field: 'title', label: 'Title', current: `${titleLen}/${G.title} char`, message: `Title ${G.title} karakter limitini aşıyor — Google Play kabul etmez`, recommendation: `${G.title} char altına indir.` });
      } else if (titleLen < 15) {
        findings.push({ severity: 'warning', store: 'ANDROID', field: 'title', label: 'Title', current: `${titleLen}/${G.title} char`, message: 'Title kısa — keyword kapasitesi kullanılmıyor', recommendation: `${G.title} char sınırında marka + 1-2 keyword. Emoji, "ücretsiz", "#1", "en iyi" gibi ifadeler Google Play politikasına aykırı.` });
      } else {
        findings.push({ severity: 'ok', store: 'ANDROID', field: 'title', label: 'Title', current: `${titleLen}/${G.title} char` });
      }

      // Short Description (80 char)
      const summary = (android.summary ?? '').toString();
      const sumLen = countCharacters(summary);
      if (sumLen === 0) {
        findings.push({ severity: 'error', store: 'ANDROID', field: 'shortDesc', label: 'Short Description', current: 0, message: 'Short description boş', recommendation: `${G.shortDescription} char, kullanıcı genişletmeden önce gördüğü. Ana fayda + USP; "hemen indir" gibi eylem çağrısı ve fiyat bilgisi kullanma.` });
      } else if (sumLen > G.shortDescription) {
        findings.push({ severity: 'error', store: 'ANDROID', field: 'shortDesc', label: 'Short Description', current: `${sumLen}/${G.shortDescription} char`, message: `Short description ${G.shortDescription} karakter limitini aşıyor`, recommendation: `${G.shortDescription} char altına indir.` });
      } else if (sumLen < 50) {
        findings.push({ severity: 'warning', store: 'ANDROID', field: 'shortDesc', label: 'Short Description', current: `${sumLen}/${G.shortDescription} char`, message: 'Short desc kısa', recommendation: `${G.shortDescription} char'ı doldur, anahtar keyword ekle.` });
      } else {
        findings.push({ severity: 'ok', store: 'ANDROID', field: 'shortDesc', label: 'Short Description', current: `${sumLen}/${G.shortDescription} char` });
      }

      // Long Description (4000) — Play TAMAMINI indexler
      const desc = (android.description ?? '').toString();
      const descLen = countCharacters(desc);
      if (descLen === 0) {
        findings.push({ severity: 'error', store: 'ANDROID', field: 'description', label: 'Long Description', current: 0, message: 'Long description boş — Play\'in en kritik alanı', recommendation: 'Play algoritması TÜM long description\'ı indexler. iOS\'tan FARKLI! En az 2500 char yaz.' });
      } else if (descLen > G.fullDescription) {
        findings.push({ severity: 'error', store: 'ANDROID', field: 'description', label: 'Long Description', current: `${descLen}/${G.fullDescription} char`, message: `Long description ${G.fullDescription} karakter limitini aşıyor`, recommendation: `${G.fullDescription} char altına indir.` });
      } else if (descLen < 1500) {
        findings.push({ severity: 'warning', store: 'ANDROID', field: 'description', label: 'Long Description', current: `${descLen}/${G.fullDescription} char`, message: 'Long description kısa — ranking için fırsat kaçıyor', recommendation: 'Play TÜM long desc\'i indexler. 2500-4000 char yaz, hedef keyword\'ler doğal şekilde 3-5 kez geçsin.' });
      } else {
        findings.push({ severity: 'ok', store: 'ANDROID', field: 'description', label: 'Long Description', current: `${descLen}/${G.fullDescription} char` });
      }

      // Reviews — kota Google'da "implementation detail", yayimlanmiyor
      // (https://developer.android.com/guide/playcore/in-app-review); eski
      // "5 kez/yil" sayisi kaynaksizdi.
      const reviewCount = android.reviews ?? app.androidReviewCount ?? 0;
      const rating = android.score ?? app.androidRating ?? 0;
      if (reviewCount < 10) {
        findings.push({ severity: 'warning', store: 'ANDROID', field: 'reviews', label: 'Reviews', current: `${reviewCount} review`, message: 'Review sayısı düşük', recommendation: 'Play In-App Review API ile iste. Google gösterim kotasını yayımlamıyor; kısa aralıkla tekrar çağrı diyalog göstermeyebilir, bu yüzden butona bağlama.' });
      } else {
        findings.push({ severity: 'ok', store: 'ANDROID', field: 'reviews', label: 'Reviews', current: `${reviewCount} review · ${rating.toFixed?.(1) ?? rating}⭐` });
      }

      // Screenshots
      const screenshotCount = (android.screenshots ?? []).length;
      if (screenshotCount < 4) {
        findings.push({ severity: 'warning', store: 'ANDROID', field: 'screenshots', label: 'Screenshots', current: `${screenshotCount}/8`, message: 'Az screenshot' });
      } else {
        findings.push({ severity: 'ok', store: 'ANDROID', field: 'screenshots', label: 'Screenshots', current: `${screenshotCount}/8` });
      }

      // Feature graphic
      if (!android.headerImage) {
        findings.push({ severity: 'warning', store: 'ANDROID', field: 'featureGraphic', label: 'Feature Graphic', current: '', message: 'Feature graphic yok', recommendation: '1024x500 image. Play store öne çıkarma için kritik.' });
      }

      // Video — reklamsiz ve yas kisitlamasiz olmali; eski "%15-25 donusum" iddiasi kaynaksizdi
      // (https://support.google.com/googleplay/android-developer/answer/9866151)
      if (!android.video) {
        findings.push({ severity: 'info', store: 'ANDROID', field: 'video', label: 'Video', current: '', message: 'YouTube videosu yok', recommendation: 'Uygulamanın gerçek kullanımını gösteren bir YouTube tanıtım videosu ekle (reklamsız, yaş kısıtlamasız).' });
      }
    }

    // Summary
    const summary = {
      ok: findings.filter(f => f.severity === 'ok').length,
      warning: findings.filter(f => f.severity === 'warning').length,
      error: findings.filter(f => f.severity === 'error').length,
      info: findings.filter(f => f.severity === 'info').length,
    };
    const total = summary.ok + summary.warning + summary.error;
    const score = total > 0 ? Math.round((summary.ok / total) * 100) : 0;
    const grade = score >= 90 ? 'A+' : score >= 80 ? 'A' : score >= 70 ? 'B' : score >= 60 ? 'C' : score >= 50 ? 'D' : 'F';

    return {
      score,
      grade,
      summary,
      findings,
      currentMetadata: {
        ios: ios ? {
          title: ios.title,
          subtitle: ios.subtitle,
          description: ios.description,
          releaseNotes: ios.releaseNotes,
          screenshots: ios.screenshots ?? [],
          icon: ios.icon,
          rating: ios.score,
          reviews: ios.reviews,
          category: ios.primaryGenre,
          version: ios.version,
        } : null,
        android: android ? {
          title: android.title,
          summary: android.summary,
          description: android.description,
          screenshots: android.screenshots ?? [],
          icon: android.icon,
          headerImage: android.headerImage,
          video: android.video,
          rating: android.score,
          reviews: android.reviews,
          category: android.genre,
          version: android.version,
        } : null,
      },
    };
  }
}
