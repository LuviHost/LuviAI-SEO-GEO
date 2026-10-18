import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { encrypt, decrypt } from '@luviai/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { AsaCredentials } from './asa-http.js';
import { createAsaClient, getAsaApiVersion, v5SunsetNotice, type CreateAsaClientOptions } from './asa-client.factory.js';
import { isAsaApiError, lastNDaysRange, type AsaAdsClient, type AsaApiVersion, type AsaKeywordReportRow } from './asa-types.js';
import { ASA_PERF_BACKFILL_DAYS, asaKvKeys, idSpaceMismatch, shouldPauseKeyword } from './asa-rules.js';
import {
  asaCurrencyKey,
  budgetCapReason,
  combineAsaCurrencies,
  isIsoCurrency,
  parseAsaCurrency,
  reportCurrencyValue,
} from './asa-currency.js';
import {
  ASA_POPULARITY_GENRES,
  buildImpressionShareResponse,
  buildPopularityResponse,
  impressionShareWindow,
  insightsUnavailable,
  popularityWindow,
} from './asa-insights.js';

interface RequestingUser {
  id: string;
  role: 'USER' | 'ADMIN' | 'AGENCY_OWNER';
}

/**
 * AsaAccount satirindaki sirlar — API cevabina ASLA cikmamali.
 * encryptedKey: musterinin .p8 ozel anahtari (sifreli). tokenCacheValue:
 * Apple'a karsi imzalanmis gecerli client-secret JWT (180 gune kadar) — sizarsa
 * sifre cozmeye gerek kalmadan musterinin Apple Ads hesabina erisilir.
 * setAutoPilot eskiden tam satiri donuyordu. Tip acik yazili: yanlis alan adi
 * derlemede yakalanir (bkz. sites.service SITE_SECRET_FIELDS gerekcesi).
 */
export const ASA_ACCOUNT_SECRET_FIELDS: Prisma.AsaAccountOmit = {
  encryptedKey: true,
  tokenCacheValue: true,
};

@Injectable()
export class AsaService {
  private readonly log = new Logger(AsaService.name);
  // API client cache — aynı account için tekrar tekrar instance açma (anahtar: surum + hesap)
  private readonly clientCache = new Map<string, { client: AsaAdsClient; cachedAt: number }>();
  private sunsetWarned = false;

  constructor(private readonly prisma: PrismaService) {}

  // ─── Account management ──────────────────────────────

  /** Site sahipliği kontrolü */
  private async assertSiteOwner(siteId: string, user: RequestingUser) {
    const site = await this.prisma.site.findUnique({ where: { id: siteId } });
    if (!site) throw new NotFoundException('Site bulunamadı');
    if (user.role !== 'ADMIN' && site.userId !== user.id) {
      throw new ForbiddenException('Bu site sana ait değil');
    }
    return site;
  }

  /**
   * Apple Search Ads account bağla.
   * Kullanıcı Apple Ads → Account Settings → API'de public key yükler; Apple
   * clientId / teamId / keyId verir. "orgId" alanı tarihsel olarak clientId taşır.
   */
  async connectAccount(args: {
    siteId: string;
    orgId: string;
    keyId: string;
    privateKeyPem: string;
    teamId?: string;
  }, user: RequestingUser) {
    await this.assertSiteOwner(args.siteId, user);

    if (!args.privateKeyPem.includes('PRIVATE KEY')) {
      throw new BadRequestException('Geçersiz .p8 dosyası — "BEGIN PRIVATE KEY" header bulunamadı');
    }

    // Validation: gerçek API'ye dene. Kayitli reklam hesabi kullanilmaz — yeniden
    // baglanti Platform'da hesabi tazeden cozer.
    const version = getAsaApiVersion();
    const tempClient = this.createClient(
      { orgId: args.orgId, keyId: args.keyId, privateKeyPem: args.privateKeyPem, teamId: args.teamId },
      { version },
    );
    try {
      await tempClient.getAccessToken();
    } catch (err: any) {
      throw new BadRequestException(`Apple Search Ads auth başarısız: ${err.message}`);
    }
    // Token tek basina yetmez: hesap erisimi yoksa senkron her seferinde duserdi
    let accountInfo: Awaited<ReturnType<AsaAdsClient['getAccountInfo']>>;
    try {
      accountInfo = await tempClient.getAccountInfo();
    } catch (err: any) {
      if (isAsaApiError(err) && err.kind === 'config') throw new BadRequestException(err.message);
      throw new BadRequestException(`Apple Ads hesap bilgisi alınamadı: ${err.message}`);
    }

    // Aynı orgId siteye zaten bağlıysa update et
    const existing = await this.prisma.asaAccount.findFirst({
      where: { siteId: args.siteId, orgId: args.orgId },
    });
    let result: { id: string; orgId: string; status: 'created' | 'updated' };
    if (existing) {
      const updated = await this.prisma.asaAccount.update({
        where: { id: existing.id },
        data: {
          keyId: args.keyId,
          encryptedKey: encrypt(args.privateKeyPem),
          teamId: args.teamId ?? null,
          isActive: true,
          lastError: null,
          tokenCacheValue: null,
          tokenCacheExpAt: null,
        },
      });
      result = { id: updated.id, orgId: updated.orgId, status: 'updated' };
    } else {
      const created = await this.prisma.asaAccount.create({
        data: {
          siteId: args.siteId,
          orgId: args.orgId,
          keyId: args.keyId,
          encryptedKey: encrypt(args.privateKeyPem),
          teamId: args.teamId ?? null,
          isActive: true,
        },
      });
      result = { id: created.id, orgId: created.orgId, status: 'created' };
    }

    if (version === 'platform') {
      await this.writeKv(asaKvKeys.platformAdAccount(result.id), accountInfo.contextId);
    }
    // Hesabin para birimi baglanti aninda biliniyor (ACL / reklam hesabi) —
    // ilk performans cekimini beklemeden panel tutarlari dogru birimle gosterir
    if (isIsoCurrency(accountInfo.currency)) {
      await this.writeKv(asaCurrencyKey(args.siteId, result.id), accountInfo.currency).catch(() => undefined);
    }
    this.clearClientCache(result.id);
    return result;
  }

  async listAccounts(siteId: string, user: RequestingUser) {
    await this.assertSiteOwner(siteId, user);
    const rows = await this.prisma.asaAccount.findMany({
      where: { siteId },
      select: {
        id: true, orgId: true, keyId: true, teamId: true,
        isActive: true, lastSyncAt: true, lastError: true, createdAt: true,
        autoPilotEnabled: true, autoPilotBudgetCap: true,
        autoPilotLastRunAt: true, autoPilotLastResult: true,
        _count: { select: { campaigns: true } },
      },
    });
    // Ek alan (geriye uyumlu): hesabin para birimi; bilinmiyorsa null
    return Promise.all(rows.map(async (row) => ({ ...row, currency: await this.accountCurrency(siteId, row.id) })));
  }

  /** Hesabin bilinen para birimi (ISO 4217) ya da null — bkz. asa-currency.ts */
  private async accountCurrency(siteId: string, accountId: string): Promise<string | null> {
    return parseAsaCurrency(await this.readKv(asaCurrencyKey(siteId, accountId)));
  }

  async disconnectAccount(accountId: string, user: RequestingUser) {
    const acc = await this.prisma.asaAccount.findUnique({ where: { id: accountId } });
    if (!acc) throw new NotFoundException('Hesap bulunamadı');
    await this.assertSiteOwner(acc.siteId, user);
    await this.prisma.asaAccount.delete({ where: { id: accountId } });
    this.clearClientCache(accountId);
    await this.prisma.kvStore
      .deleteMany({
        where: {
          key: {
            in: [
              asaKvKeys.platformAdAccount(accountId),
              asaKvKeys.syncApiVersion(accountId),
              asaKvKeys.perfBackfill(accountId),
              asaCurrencyKey(acc.siteId, accountId),
            ],
          },
        },
      })
      .catch(() => undefined);
    return { ok: true };
  }

  /** Test kancasi: istemci uretimi tek noktada (spec'ler bunu taklit eder). */
  protected createClient(creds: AsaCredentials, opts: CreateAsaClientOptions): AsaAdsClient {
    return createAsaClient(creds, opts);
  }

  private clearClientCache(accountId: string) {
    for (const key of [...this.clientCache.keys()]) {
      if (key.endsWith(`:${accountId}`)) this.clientCache.delete(key);
    }
  }

  private warnSunsetOnce(version: AsaApiVersion) {
    if (this.sunsetWarned) return;
    const notice = v5SunsetNotice(version);
    if (notice) {
      this.sunsetWarned = true;
      this.log.warn(`[asa] ${notice}`);
    }
  }

  /** Cached API client (5 dk TTL). */
  private async getClient(accountId: string): Promise<AsaAdsClient> {
    const version = getAsaApiVersion();
    const cacheKey = `${version}:${accountId}`;
    const cached = this.clientCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < 5 * 60_000) {
      return cached.client;
    }
    const acc = await this.prisma.asaAccount.findUnique({ where: { id: accountId } });
    if (!acc) throw new NotFoundException(`AsaAccount ${accountId} bulunamadı`);
    const creds: AsaCredentials = {
      orgId: acc.orgId,
      keyId: acc.keyId,
      privateKeyPem: decrypt(acc.encryptedKey),
      teamId: acc.teamId ?? undefined,
    };
    this.warnSunsetOnce(version);
    let client: AsaAdsClient;
    if (version === 'platform') {
      const stored = await this.readKv(asaKvKeys.platformAdAccount(accountId));
      client = this.createClient(creds, {
        version,
        adAccountId: stored,
        onAdAccountResolved: (adAccountId) => this.writeKv(asaKvKeys.platformAdAccount(accountId), adAccountId),
      });
    } else {
      client = this.createClient(creds, { version });
    }
    this.clientCache.set(cacheKey, { client, cachedAt: Date.now() });
    return client;
  }

  private async readKv(key: string): Promise<string | null> {
    const row = await this.prisma.kvStore.findUnique({ where: { key } }).catch(() => null);
    return row?.value ?? null;
  }

  private async writeKv(key: string, value: string): Promise<void> {
    await this.prisma.kvStore.upsert({ where: { key }, create: { key, value }, update: { value } });
  }

  // ─── Campaign management ─────────────────────────────

  /** Apple'dan kampanyaları sync et + DB'ye yaz */
  async syncCampaigns(accountId: string, user: RequestingUser) {
    const acc = await this.prisma.asaAccount.findUnique({ where: { id: accountId } });
    if (!acc) throw new NotFoundException('Hesap bulunamadı');
    await this.assertSiteOwner(acc.siteId, user);

    const client = await this.getClient(accountId);
    try {
      const campaigns = await client.listCampaigns();
      const dbCampaigns = await this.prisma.asaCampaign.findMany({
        where: { accountId },
        select: { id: true, asaCampaignId: true, status: true },
      });

      // Surum gecisinden sonraki ilk senkron: kimlikler hic eslesmiyorsa toplu silmeden once dur
      const recorded = await this.readKv(asaKvKeys.syncApiVersion(accountId));
      const previousVersion = (recorded === 'v5' || recorded === 'platform')
        ? recorded
        : dbCampaigns.length > 0 ? 'v5' : null; // eski kayitlar v5 doneminden
      if (idSpaceMismatch(previousVersion, client.version, dbCampaigns.map((c) => c.asaCampaignId), campaigns.map((c) => c.id))) {
        this.log.error(`[asa:${accountId}] ${previousVersion}→${client.version} sonrasi kampanya kimlikleri eslesmedi; senkron durduruldu`);
        throw new BadRequestException(
          'Apple Ads API sürüm geçişinden sonra Apple’ın döndürdüğü kampanya kimlikleri kayıtlı kampanyalarla eşleşmedi. Veri kaybını önlemek için eşitleme durduruldu; lütfen destek ile iletişime geçin.',
        );
      }

      let synced = 0;
      let markedDeleted = 0;
      const appleIds = new Set<string>();
      const dbByAsaId = new Map(dbCampaigns.map((c) => [c.asaCampaignId, c]));
      for (const c of campaigns) {
        appleIds.add(c.id);
        const existing = dbByAsaId.get(c.id);
        if (c.deleted) {
          // Apple'da silinmis (soft-delete): ENABLED kalirsa UI "Yayında" gosterir;
          // satiri silmek ise harcanmis paranin performans gecmisini (aylik rapor)
          // cascade ile yok eder → durum DELETED, gecmis kalir. DB'de yoksa eklenmez.
          if (existing && existing.status !== 'DELETED') {
            await this.prisma.asaCampaign.update({ where: { id: existing.id }, data: { status: 'DELETED' } });
            markedDeleted++;
          }
          continue;
        }
        await this.prisma.asaCampaign.upsert({
          where: { asaCampaignId: c.id },
          create: {
            accountId,
            asaCampaignId: c.id,
            name: c.name,
            // budget sutunu GUNLUK butce: eski kod omur boyu butceyi (budgetAmount) yaziyordu
            budget: c.dailyBudget ?? 0,
            totalBudget: c.totalBudget,
            status: c.status,
            countriesOrRegions: c.countriesOrRegions,
            supplySources: c.supplySources,
            appAdamId: c.adamId,
          },
          update: {
            name: c.name,
            ...(c.dailyBudget !== null ? { budget: c.dailyBudget } : {}),
            totalBudget: c.totalBudget,
            status: c.status,
            countriesOrRegions: c.countriesOrRegions,
            supplySources: c.supplySources,
            ...(c.adamId ? { appAdamId: c.adamId } : {}),
          },
        });
        synced++;
      }

      // Apple'in HIC dondurmedigi kampanyalari DB'den de sil (cascade adgroup + keywords)
      const orphans = dbCampaigns.filter((c) => !appleIds.has(c.asaCampaignId));
      let removed = markedDeleted;
      if (orphans.length > 0) {
        await this.prisma.asaCampaign.deleteMany({
          where: { id: { in: orphans.map((o) => o.id) } },
        });
        removed += orphans.length;
        this.log.log(`[asa:${accountId}] ${orphans.length} silinmiş kampanya DB'den temizlendi`);
      }

      if (recorded !== client.version) {
        await this.writeKv(asaKvKeys.syncApiVersion(accountId), client.version);
      }
      await this.prisma.asaAccount.update({
        where: { id: accountId },
        data: { lastSyncAt: new Date(), lastError: null },
      });
      this.log.log(`[asa:${accountId}] ${synced} kampanya sync, ${removed} silindi (${client.version})`);
      return { synced, removed };
    } catch (err: any) {
      await this.prisma.asaAccount.update({
        where: { id: accountId },
        data: { lastError: err.message },
      });
      throw err;
    }
  }

  /**
   * AI ile kampanya önerisi: ASO keyword'lerinden (TrackedAppKeyword)
   * organic rank'i düşük (>15 veya null) + traffic'i yüksek olanları top 10 al.
   * Bid'i niş/pazara göre öner. Apple App ID'yi TrackedApp.appStoreId'den al.
   */
  async suggestCampaign(siteId: string, user: RequestingUser) {
    await this.assertSiteOwner(siteId, user);

    // iOS tracked app
    const trackedApp = await this.prisma.trackedApp.findFirst({
      where: { siteId, appStoreId: { not: null }, isActive: true },
      orderBy: { lastFetchedAt: 'desc' },
    });
    if (!trackedApp?.appStoreId) {
      throw new BadRequestException('Bu site için iOS app (App Store ID) bulunamadı. Önce ASO sekmesinden app ekle.');
    }

    // Keyword'ler — TrackedAppKeyword (IOS)
    const allKeywords = await this.prisma.trackedAppKeyword.findMany({
      where: { trackedAppId: trackedApp.id, store: 'IOS', isActive: true },
    });

    // Skor: top 10'u seç
    // - rank > 15 ya da null (organic'te yok) → ASA için uygun
    // - traffic var → öncelik
    const scored = allKeywords
      .map((k) => {
        const isOpportunity = !k.currentRank || k.currentRank > 15;
        if (!isOpportunity) return null;
        const trafficScore = k.traffic ?? k.popularity ?? 30;
        const rankPenalty = k.currentRank ? Math.min(k.currentRank / 100, 1) : 0.5;
        return { keyword: k.keyword, trafficScore, score: trafficScore * (1 + rankPenalty) };
      })
      .filter((x): x is { keyword: string; trafficScore: number; score: number } => x !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    if (scored.length === 0) {
      // Fallback: top 10 all keywords
      const fallback = allKeywords.slice(0, 10).map((k) => ({ keyword: k.keyword }));
      if (fallback.length === 0) {
        throw new BadRequestException('Keyword bulunamadı. Önce ASO sekmesinden keyword ekle veya AI Keyword Research çalıştır.');
      }
      return this.buildSuggestion(trackedApp, fallback.map((f) => f.keyword), 0.50);
    }

    // Bid öner: TR pazarı $0.40-0.80 default
    const suggestedBid = trackedApp.country?.toLowerCase() === 'us' ? 0.85 : 0.50;
    return this.buildSuggestion(trackedApp, scored.map((s) => s.keyword), suggestedBid);
  }

  private buildSuggestion(trackedApp: any, keywords: string[], bidUsd: number) {
    // Apple "campaign name must be unique within org" der, o yüzden tarih+saat:dk şart
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    return {
      name: `${trackedApp.name} — AI Auto / ${stamp}`,
      dailyBudgetUsd: 15,
      countries: [trackedApp.country?.toUpperCase() ?? 'TR'],
      appleAppId: parseInt(trackedApp.appStoreId, 10),
      bidUsd,
      keywords,
      meta: {
        keywordCount: keywords.length,
        country: trackedApp.country?.toUpperCase() ?? 'TR',
        appName: trackedApp.name,
      },
    };
  }

  async listCampaigns(siteId: string, user: RequestingUser) {
    await this.assertSiteOwner(siteId, user);
    return this.prisma.asaCampaign.findMany({
      // Apple'da silinmis kampanyalar gecmis icin DB'de kalir, listede gosterilmez
      where: { account: { siteId }, status: { not: 'DELETED' } },
      orderBy: { createdAt: 'desc' },
      include: {
        account: { select: { id: true, orgId: true } },
        _count: { select: { adGroups: true } },
      },
    });
  }

  /**
   * Yeni kampanya oluştur (RanksUp UI'dan). Apple'a POST eder, DB'ye yazar.
   * payload.keywords[] varsa otomatik 1 adgroup + keyword bid'leri ekler.
   */
  async createCampaign(args: {
    accountId: string;
    name: string;
    dailyBudgetUsd: number;
    countries: string[];   // ['US', 'TR', ...]
    appleAppId: number;    // adamId
    keywords?: Array<{ text: string; bidUsd: number; matchType?: 'EXACT' | 'BROAD' }>;
  }, user: RequestingUser) {
    const acc = await this.prisma.asaAccount.findUnique({ where: { id: args.accountId } });
    if (!acc) throw new NotFoundException('Hesap bulunamadı');
    await this.assertSiteOwner(acc.siteId, user);

    // Gecersiz sayi Apple'a "NaN" diye gitmesin
    if (!Number.isFinite(args.dailyBudgetUsd) || args.dailyBudgetUsd <= 0) {
      throw new BadRequestException('Günlük bütçe pozitif bir sayı olmalı.');
    }
    if (!Array.isArray(args.countries) || args.countries.length === 0) {
      throw new BadRequestException('En az bir ülke seçilmeli.');
    }
    if (!Number.isSafeInteger(Number(args.appleAppId)) || Number(args.appleAppId) <= 0) {
      throw new BadRequestException('Geçersiz Apple App ID.');
    }
    const keywords = (args.keywords ?? [])
      .map((k) => ({ ...k, text: String(k.text ?? '').trim() }))
      .filter((k) => k.text.length > 0);
    if (keywords.some((k) => !Number.isFinite(k.bidUsd) || k.bidUsd <= 0)) {
      throw new BadRequestException('Anahtar kelime teklifleri pozitif bir sayı olmalı.');
    }

    const client = await this.getClient(args.accountId);
    const warnings: string[] = [];
    const campaignInput = (name: string) => ({
      name,
      // Kayan nokta artigi ("0.30000000000000004") Apple'a gitmesin; teklifler gibi 2 hane
      dailyBudget: { amount: args.dailyBudgetUsd.toFixed(2), currency: 'USD' },
      countriesOrRegions: args.countries,
      adamId: Number(args.appleAppId),
      supplySources: ['APPSTORE_SEARCH_RESULTS'],
    });

    // 1) Campaign create
    let campaignName = args.name;
    let camp: Awaited<ReturnType<AsaAdsClient['createCampaign']>> | null = null;
    try {
      camp = await client.createCampaign(campaignInput(campaignName));
    } catch (err: any) {
      const raw = err?.message ?? String(err);
      const kind = isAsaApiError(err) ? err.kind : null;
      this.log.error(`[asa:createCampaign] Apple reddetti: ${raw}`);
      // Apple'ın spesifik hata kodları — normalize tur once, eski regex yedek
      if (kind === 'payment' || (!kind && /no.*payment.*method|payment.*required|payment.*not.*found|MISSING_PAYMENT|invalid.*payment/i.test(raw))) {
        throw new BadRequestException('Apple ödeme yöntemi yok. Apple Search Ads → Account Settings → Billing → Add Payment Method ekledikten sonra tekrar dene.');
      }
      if (kind === 'app_ineligible' || (!kind && /ADAMID|adamId|app.*not.*found/i.test(raw))) {
        throw new BadRequestException(`Apple App ID (${args.appleAppId}) bu hesaba bağlı değil. App'in Apple Developer hesabınla aynı org'da olduğundan emin ol.`);
      }
      if (kind === 'rate_limited') {
        throw new BadRequestException(`Apple Ads istek sınırına ulaşıldı; ${err.retryAfterSeconds ?? 60} sn sonra tekrar dene.`);
      }
      if (kind === 'duplicate_name' || (!kind && /DUPLICATE_CAMPAIGN_NAME|not unique/i.test(raw))) {
        // Otomatik retry: timestamp suffix ekle
        const retryName = `${args.name} #${Date.now().toString().slice(-5)}`;
        try {
          this.log.warn(`[asa:createCampaign] DUPLICATE → otomatik retry: ${retryName}`);
          camp = await client.createCampaign(campaignInput(retryName));
        } catch (err2: any) {
          throw new BadRequestException(`Apple aynı isimde kampanya var ve otomatik retry de başarısız: ${err2.message?.slice(0, 200)}. Önce "Sync" basıp mevcut kampanyaları çek, sonra farklı isimle dene.`);
        }
        // DB'ye yazılacak ismi de güncelle
        campaignName = retryName;
      } else {
        throw new BadRequestException(`Apple kampanya oluşturmayı reddetti: ${raw.slice(0, 300)}`);
      }
    }
    if (!camp?.id || camp.id === 'undefined') throw new BadRequestException('Kampanya oluşturulamadı');
    const asaCampaignId = camp.id;

    // DB'ye yaz
    const dbCampaign = await this.prisma.asaCampaign.create({
      data: {
        accountId: args.accountId,
        asaCampaignId,
        name: campaignName,
        budget: args.dailyBudgetUsd,
        status: 'ENABLED',
        countriesOrRegions: args.countries,
        supplySources: ['APPSTORE_SEARCH_RESULTS'],
        appAdamId: String(args.appleAppId),
      },
    });

    // 2) Default adgroup + keyword'ler — kampanya zaten Apple'da yaratıldı,
    //    burada hata olsa bile kampanyayı silmiyoruz; kullanıcıya net mesaj ver.
    if (keywords.length > 0) {
      const avgBid = keywords.reduce((s, k) => s + k.bidUsd, 0) / keywords.length;
      let asaAdGroupId: string;
      try {
        const adg = await client.createAdGroup(asaCampaignId, {
          name: `${campaignName} — default`,
          defaultBid: { amount: avgBid.toFixed(2), currency: 'USD' },
        });
        asaAdGroupId = adg.id;
      } catch (err: any) {
        const raw = err?.message ?? String(err);
        this.log.error(`[asa:createAdGroup] Apple reddetti: ${raw}`);
        throw new BadRequestException(
          `Kampanya oluştu ama ad group eklenemedi: ${raw.slice(0, 300)}. Kampanya Apple'da kayıtlı — "Sync" basıp listede gör.`,
        );
      }

      const dbAdGroup = await this.prisma.asaAdGroup.create({
        data: {
          campaignId: dbCampaign.id,
          asaAdGroupId,
          name: `${campaignName} — default`,
          defaultBidAmount: avgBid,
          status: 'ENABLED',
          targetingType: 'EXACT',
        },
      });

      // Keyword'leri ekle
      const apiKeywords = keywords.map((k) => ({
        text: k.text,
        matchType: k.matchType ?? ('EXACT' as const),
        bid: { amount: k.bidUsd.toFixed(2), currency: 'USD' },
      }));
      let kwRes: Awaited<ReturnType<AsaAdsClient['addTargetingKeywords']>>;
      try {
        kwRes = await client.addTargetingKeywords(asaCampaignId, asaAdGroupId, apiKeywords);
      } catch (err: any) {
        const raw = err?.message ?? String(err);
        this.log.error(`[asa:addTargetingKeywords] Apple reddetti: ${raw}`);
        throw new BadRequestException(
          `Kampanya + ad group oluştu ama keyword'ler eklenemedi: ${raw.slice(0, 300)}. Apple Search Ads panelinden manuel ekleyebilirsin.`,
        );
      }

      const bidByText = new Map(apiKeywords.map((k) => [k.text.toLowerCase(), parseFloat(k.bid.amount)]));
      for (const kw of kwRes.created) {
        await this.prisma.asaKeywordBid.create({
          data: {
            adGroupId: dbAdGroup.id,
            asaKeywordId: kw.id,
            keyword: kw.text,
            bidAmount: kw.bid ?? bidByText.get(kw.text.toLowerCase()) ?? avgBid,
            matchType: kw.matchType,
            status: kw.status,
          },
        });
      }
      for (const f of kwRes.failed) warnings.push(`"${f.text}" eklenemedi: ${f.reason}`);

      // 3) Platform'da ad group'un yayina girmesi icin varsayilan urun sayfasi reklami gerekir
      try {
        await client.prepareAdGroupForServing(asaCampaignId, asaAdGroupId, String(args.appleAppId));
      } catch (err: any) {
        const raw = err?.message ?? String(err);
        this.log.error(`[asa:prepareAdGroupForServing] ${raw}`);
        warnings.push(
          `Varsayılan ürün sayfası reklamı oluşturulamadı: ${raw.slice(0, 200)}. Apple Ads panelinde bu ad group’ta etkin bir reklam olduğunu kontrol edin.`,
        );
      }
    }

    return { campaignId: dbCampaign.id, asaCampaignId, ...(warnings.length > 0 ? { warnings } : {}) };
  }

  // ─── Auto-Pilot (Seviye 2) ──────────────────────────

  async setAutoPilot(accountId: string, args: { enabled: boolean; budgetCapUsd?: number | null }, user: RequestingUser) {
    const acc = await this.prisma.asaAccount.findUnique({ where: { id: accountId } });
    if (!acc) throw new NotFoundException('Hesap bulunamadı');
    await this.assertSiteOwner(acc.siteId, user);
    return this.prisma.asaAccount.update({
      where: { id: accountId },
      data: {
        autoPilotEnabled: args.enabled,
        autoPilotBudgetCap: args.budgetCapUsd ?? acc.autoPilotBudgetCap,
      },
      omit: ASA_ACCOUNT_SECRET_FIELDS,
    });
  }

  /**
   * Auto-Pilot run — bir hesap için çalışır. Logic:
   *  1. Mevcut kampanyaların son 7g performance'ını al
   *  2. Aylık bütçe cap aşıldıysa hiçbir yeni harcama yapma
   *  3. KELIME duzeyinde son 7g: 20+ dokunma ve 0 yukleme olanlari PAUSE et
   *  4. AI önerisinden mevcut kampanyalarda olmayan TOP 5 keyword'ü mevcut adgroup'a ekle
   */
  async runAutoPilot(accountId: string, user?: RequestingUser) {
    const acc = await this.prisma.asaAccount.findUnique({ where: { id: accountId } });
    if (!acc) throw new NotFoundException('Hesap bulunamadı');
    if (user) await this.assertSiteOwner(acc.siteId, user);
    if (!acc.autoPilotEnabled) throw new BadRequestException('Auto-Pilot kapalı');

    const result = { added: [] as string[], paused: [] as string[], skipped: [] as string[], reason: '' };
    const client = await this.getClient(accountId);

    // 1) Performance fetch — son 7g (hata olsa da devam; butce kontrolu DB'den)
    await this.fetchPerformance(accountId, 7).catch(() => null);

    // 2) Bütçe cap kontrolü — ay başından bu yana harcama topla
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const perfAgg = await this.prisma.asaPerformanceDaily.aggregate({
      where: { campaign: { accountId }, date: { gte: monthStart } },
      _sum: { spendUsd: true },
    });
    const monthSpend = perfAgg._sum?.spendUsd ?? 0;
    // null = sinir yok. 0 GECERLI bir sinirdir (DTO @Min(0)) ve "otopilot hic
    // degisiklik yapmasin" demektir: eskiden dogruluk kontrolu (cap && ...) 0'i
    // "sinir yok" sayiyordu; panel "aylik harcama siniri 0" gosterirken otopilot
    // kelime ekleyip duraklatmaya devam ediyordu.
    const cap = acc.autoPilotBudgetCap;
    if (cap !== null && cap !== undefined && monthSpend >= cap) {
      // spendUsd ve sinir HESABIN para birimindedir; '$' yalniz USD hesapta dogruydu
      result.reason = cap <= 0
        ? 'Aylık harcama sınırı 0 olarak ayarlı; otopilot değişiklik yapmadı.'
        : budgetCapReason(monthSpend, cap, await this.accountCurrency(acc.siteId, accountId));
      result.skipped.push('budget-cap-reached');
      await this.prisma.asaAccount.update({
        where: { id: accountId },
        data: { autoPilotLastRunAt: new Date(), autoPilotLastResult: JSON.stringify(result) },
      });
      return result;
    }

    // 3) Düşük performans keyword'leri pause et — kelime raporu kampanya basina bir cagri.
    //    Rapor alinamazsa o kampanyada hicbir kelime durdurulmaz (veri yoksa karar yok).
    const activeBids = await this.prisma.asaKeywordBid.findMany({
      where: { adGroup: { campaign: { accountId, status: { not: 'DELETED' } } }, status: 'ACTIVE' },
      include: { adGroup: { include: { campaign: true } } },
    });
    const byCampaign = new Map<string, typeof activeBids>();
    for (const kb of activeBids) {
      const key = kb.adGroup.campaign.asaCampaignId;
      byCampaign.set(key, [...(byCampaign.get(key) ?? []), kb]);
    }
    const range = lastNDaysRange(7);
    for (const [asaCampaignId, bids] of byCampaign) {
      let stats: Map<string, AsaKeywordReportRow>;
      try {
        const rows = await client.getKeywordReport(asaCampaignId, range);
        stats = new Map(rows.map((r) => [r.keywordId, r]));
      } catch (err: any) {
        this.log.warn(`[auto-pilot:${accountId}] kelime raporu alınamadı (${asaCampaignId}): ${err?.message}`);
        result.skipped.push(`keyword-report-failed:${asaCampaignId}`);
        continue;
      }
      for (const kb of bids) {
        if (!shouldPauseKeyword(stats.get(kb.asaKeywordId))) continue;
        try {
          await client.updateTargetingKeyword(asaCampaignId, kb.adGroup.asaAdGroupId, kb.asaKeywordId, { status: 'PAUSED' });
          await this.prisma.asaKeywordBid.update({ where: { id: kb.id }, data: { status: 'PAUSED', lastOptimizedAt: new Date() } });
          result.paused.push(kb.keyword);
        } catch {
          result.skipped.push(`pause-failed:${kb.keyword}`);
        }
      }
    }

    // 4) AI önerisinden yeni keyword'ler ekle (mevcut adgroup'a)
    try {
      const suggestion = await this.suggestCampaign(acc.siteId, { id: 'system', role: 'ADMIN' });
      const existing = await this.prisma.asaKeywordBid.findMany({
        where: { adGroup: { campaign: { accountId } } },
        select: { keyword: true },
      });
      const existingKwSet = new Set(existing.map((k) => k.keyword.toLowerCase()));
      const newKws = suggestion.keywords.filter((k) => !existingKwSet.has(k.toLowerCase())).slice(0, 5);

      if (newKws.length > 0) {
        // Mevcut bir adgroup bul (ilk kampanyanın ilk adgroup'u)
        const adg = await this.prisma.asaAdGroup.findFirst({
          where: { campaign: { accountId, status: 'ENABLED' } },
          include: { campaign: true },
        });
        if (adg) {
          const apiKeywords = newKws.map((text) => ({
            text,
            matchType: 'EXACT' as const,
            bid: { amount: suggestion.bidUsd.toFixed(2), currency: 'USD' },
          }));
          try {
            const kwRes = await client.addTargetingKeywords(adg.campaign.asaCampaignId, adg.asaAdGroupId, apiKeywords);
            for (const kw of kwRes.created) {
              await this.prisma.asaKeywordBid.create({
                data: {
                  adGroupId: adg.id,
                  asaKeywordId: kw.id,
                  keyword: kw.text,
                  bidAmount: kw.bid ?? suggestion.bidUsd,
                  matchType: kw.matchType,
                  status: kw.status,
                },
              });
              result.added.push(kw.text);
            }
            for (const f of kwRes.failed) result.skipped.push(`add-failed:${f.text}`);
          } catch (err: any) {
            result.skipped.push(`add-failed:${err.message?.slice(0, 80)}`);
          }
        } else {
          result.skipped.push('no-active-campaign-to-add-to');
        }
      }
    } catch (err: any) {
      result.skipped.push(`suggest-failed:${err.message?.slice(0, 80)}`);
    }

    await this.prisma.asaAccount.update({
      where: { id: accountId },
      data: { autoPilotLastRunAt: new Date(), autoPilotLastResult: JSON.stringify(result) },
    });
    this.log.log(`[auto-pilot:${accountId}] added=${result.added.length} paused=${result.paused.length} skipped=${result.skipped.length}`);
    return result;
  }

  /** Cron: tüm enabled hesaplar için auto-pilot çalıştır */
  async runAllAutoPilots() {
    const accounts = await this.prisma.asaAccount.findMany({
      where: { autoPilotEnabled: true, isActive: true },
    });
    this.log.log(`[auto-pilot] ${accounts.length} aktif hesap için run başlıyor`);
    for (const acc of accounts) {
      try {
        await this.runAutoPilot(acc.id);
      } catch (err: any) {
        this.log.error(`[auto-pilot:${acc.id}] hata: ${err.message}`);
      }
    }
  }

  // ─── Keyword bid management ──────────────────────────

  async updateKeywordBid(keywordBidId: string, bidUsd: number, user: RequestingUser) {
    const kb = await this.prisma.asaKeywordBid.findUnique({
      where: { id: keywordBidId },
      include: { adGroup: { include: { campaign: { include: { account: true } } } } },
    });
    if (!kb) throw new NotFoundException('Bid bulunamadı');
    await this.assertSiteOwner(kb.adGroup.campaign.account.siteId, user);
    if (!Number.isFinite(bidUsd) || bidUsd <= 0) {
      throw new BadRequestException('Teklif pozitif bir sayı olmalı.');
    }

    const client = await this.getClient(kb.adGroup.campaign.accountId);
    try {
      await client.updateTargetingKeyword(
        kb.adGroup.campaign.asaCampaignId,
        kb.adGroup.asaAdGroupId,
        kb.asaKeywordId,
        { bid: { amount: bidUsd.toFixed(2), currency: 'USD' } },
      );
    } catch (err: any) {
      if (isAsaApiError(err) && err.kind === 'rate_limited') {
        throw new BadRequestException(`Apple Ads istek sınırına ulaşıldı; ${err.retryAfterSeconds ?? 60} sn sonra tekrar dene.`);
      }
      throw new BadRequestException(`Apple teklif güncellemesini reddetti: ${String(err?.message ?? err).slice(0, 300)}`);
    }

    return this.prisma.asaKeywordBid.update({
      where: { id: keywordBidId },
      data: { bidAmount: bidUsd, lastOptimizedAt: new Date() },
    });
  }

  // ─── Performance ─────────────────────────────────────

  /** Son N gün performance'ını Apple'dan çek + DB'ye yaz. Cron'dan günlük çağrılır. */
  async fetchPerformance(accountId: string, daysBack = 7) {
    const client = await this.getClient(accountId);
    const rows = await client.getCampaignDailyReport(lastNDaysRange(daysBack));

    const dbIdByAsaId = new Map<string, string | null>();
    const currencies = new Set<string>();
    let saved = 0;
    for (const r of rows) {
      if (r.currency) currencies.add(r.currency);
      let dbId = dbIdByAsaId.get(r.campaignId);
      if (dbId === undefined) {
        const dbCampaign = await this.prisma.asaCampaign.findUnique({ where: { asaCampaignId: r.campaignId } });
        // Baska hesabin kampanyasina yazma
        dbId = dbCampaign && dbCampaign.accountId === accountId ? dbCampaign.id : null;
        dbIdByAsaId.set(r.campaignId, dbId);
      }
      if (!dbId) continue;

      const date = new Date(`${r.date}T00:00:00.000Z`);
      const metrics = {
        impressions: r.impressions,
        taps: r.taps,
        // API 5'ten beri "tapInstalls"; eski "installs" okununca hep 0 yaziliyordu
        installs: r.installs,
        spendUsd: r.spend,
        avgCpt: r.avgCpt,
        avgCpa: r.avgCpa,
        ttr: r.ttr,
        conversionRate: r.conversionRate,
      };
      await this.prisma.asaPerformanceDaily.upsert({
        where: { campaignId_date: { campaignId: dbId, date } },
        create: { campaignId: dbId, date, ...metrics },
        update: metrics,
      });
      saved++;
    }
    const nonUsd = [...currencies].filter((c) => c !== 'USD');
    if (nonUsd.length > 0) {
      // spendUsd sutunu USD varsayiyor; hesap baska para biriminde ise operator bilsin
      this.log.warn(`[asa:${accountId}] rapor para birimi ${nonUsd.join(',')} — spendUsd sütununa hesap para birimiyle yazıldı`);
    }
    // Panelin tutarlari dogru birimle gostermesi icin hesabin para birimi kv'ye
    // (asa-currency.ts). Satirda birim yoksa onceki bilinen deger korunur.
    const currencyValue = reportCurrencyValue(currencies);
    if (currencyValue) {
      try {
        const owner = await this.prisma.asaAccount.findUnique({ where: { id: accountId }, select: { siteId: true } });
        if (owner?.siteId) await this.writeKv(asaCurrencyKey(owner.siteId, accountId), currencyValue);
      } catch (err: any) {
        this.log.warn(`[asa:${accountId}] para birimi kaydedilemedi: ${err?.message ?? err}`);
      }
    }
    this.log.log(`[asa:${accountId}] ${saved} günlük performance row yazıldı`);
    return { saved };
  }

  /**
   * Cron icin: yukleme duzeltmesinden sonra hesap basina BIR KEZ 85 gun geriye
   * doldur (gecmis satirlarda yukleme 0 yazilmisti), sonra her gun son 7 gun.
   */
  async fetchPerformanceScheduled(accountId: string) {
    const key = asaKvKeys.perfBackfill(accountId);
    const done = await this.readKv(key);
    const res = await this.fetchPerformance(accountId, done ? 7 : ASA_PERF_BACKFILL_DAYS);
    if (!done) await this.writeKv(key, new Date().toISOString()).catch(() => undefined);
    return { ...res, backfill: !done };
  }

  async getPerformanceSummary(siteId: string, user: RequestingUser, daysBack = 30) {
    await this.assertSiteOwner(siteId, user);
    const days = Number.isFinite(daysBack) && daysBack > 0 ? Math.min(Math.floor(daysBack), 365) : 30;
    const since = new Date();
    since.setDate(since.getDate() - days);

    const rows = await this.prisma.asaPerformanceDaily.findMany({
      where: {
        campaign: { account: { siteId } },
        date: { gte: since },
      },
      include: { campaign: { select: { name: true, asaCampaignId: true } } },
      orderBy: { date: 'asc' },
    });

    // Aggregate
    const totals = rows.reduce(
      (acc, r) => ({
        impressions: acc.impressions + r.impressions,
        taps: acc.taps + r.taps,
        installs: acc.installs + r.installs,
        spendUsd: acc.spendUsd + r.spendUsd,
      }),
      { impressions: 0, taps: 0, installs: 0, spendUsd: 0 },
    );

    // Ek alan (geriye uyumlu): tutarlarin para birimi. Sitenin TUM hesaplari
    // ayni bilinen birimdeyse o kod; biri bilinmiyor ya da birimler farkliysa
    // null (panel "hesap para birimi" der). spendUsd adi tarihsel — USD degildir.
    const accounts = await this.prisma.asaAccount.findMany({ where: { siteId }, select: { id: true } });
    const currency = combineAsaCurrencies(await Promise.all(accounts.map((a) => this.accountCurrency(siteId, a.id))));

    return {
      daysBack: days,
      currency,
      totals: {
        ...totals,
        avgCpt: totals.taps > 0 ? totals.spendUsd / totals.taps : 0,
        avgCpa: totals.installs > 0 ? totals.spendUsd / totals.installs : 0,
        ttr: totals.impressions > 0 ? totals.taps / totals.impressions : 0,
        conversionRate: totals.taps > 0 ? totals.installs / totals.taps : 0,
      },
      dailyRows: rows,
    };
  }

  // ─── Insights (Platform API) — göreli skorlar ────────

  private async insightsClient(siteId: string, user: RequestingUser) {
    await this.assertSiteOwner(siteId, user);
    const acc = await this.prisma.asaAccount.findFirst({
      where: { siteId, isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!acc) throw new BadRequestException('Bu siteye bağlı Apple Ads hesabı yok.');
    return { acc, client: await this.getClient(acc.id) };
  }

  private insightsError(err: any): never {
    if (isAsaApiError(err) && err.kind === 'rate_limited') {
      throw new BadRequestException(`Apple Ads istek sınırına ulaşıldı; ${err.retryAfterSeconds ?? 60} sn sonra tekrar dene.`);
    }
    throw new BadRequestException(`Apple Ads verisi alınamadı: ${String(err?.message ?? err).slice(0, 300)}`);
  }

  /**
   * Apple Ads arama terimi populerligi — GORELI skor (1-100 / 1-5), arama hacmi degil.
   * Yalnizca Platform API'de var; v5'te available:false doner.
   */
  async getSearchTermPopularity(siteId: string, user: RequestingUser, q: { terms?: string[]; country?: string; genre?: string }) {
    const { client } = await this.insightsClient(siteId, user);
    if (!client.getSearchTermPopularity) return insightsUnavailable(client.version);

    const country = await this.resolveCountry(siteId, q.country);
    const genre = q.genre ? q.genre.trim().toUpperCase() : null;
    if (genre && !(ASA_POPULARITY_GENRES as readonly string[]).includes(genre)) {
      throw new BadRequestException(`Geçersiz tür. Geçerli değerler: ${ASA_POPULARITY_GENRES.join(', ')}`);
    }
    const lower = (s: string) => (country === 'TR' ? s.toLocaleLowerCase('tr-TR') : s.toLowerCase());
    const terms = [...new Set((q.terms ?? []).map((t) => lower(String(t).trim())).filter((t) => t.length > 0 && t.length <= 100))];
    if (terms.length > 50) throw new BadRequestException('En fazla 50 terim sorgulanabilir.');

    const window = popularityWindow();
    try {
      const rows = await client.getSearchTermPopularity({
        countryOrRegion: country,
        genre: genre ?? undefined,
        searchTerms: terms.length > 0 ? terms : undefined,
        ...window,
      });
      return buildPopularityResponse(rows, { country, genre, window, requestedTerms: terms });
    } catch (err) {
      this.insightsError(err);
    }
  }

  /** Apple Ads gosterim payi — GORELI pay (%), arama hacmi degil. Yalnizca Platform API. */
  async getImpressionShare(siteId: string, user: RequestingUser, q: { days?: number; country?: string }) {
    const { acc, client } = await this.insightsClient(siteId, user);
    if (!client.getImpressionShare) return insightsUnavailable(client.version);

    const campaign = await this.prisma.asaCampaign.findFirst({
      where: { accountId: acc.id, appAdamId: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { appAdamId: true },
    });
    const trackedApp = campaign?.appAdamId
      ? null
      : await this.prisma.trackedApp.findFirst({ where: { siteId, appStoreId: { not: null }, isActive: true } });
    const adamId = campaign?.appAdamId ?? trackedApp?.appStoreId ?? null;
    if (!adamId) throw new BadRequestException('Bu site için App Store ID bulunamadı.');

    const country = q.country ? await this.resolveCountry(siteId, q.country) : null;
    const window = impressionShareWindow(q.days ?? 7);
    try {
      const rows = await client.getImpressionShare({ adamId, countryOrRegion: country ?? undefined, ...window });
      return buildImpressionShareResponse(rows, { country, adamId, window });
    } catch (err) {
      this.insightsError(err);
    }
  }

  /** Ulke: istekten (ISO alpha-2) ya da sitenin iOS app ulkesinden; yoksa TR. */
  private async resolveCountry(siteId: string, raw?: string): Promise<string> {
    if (raw) {
      const c = raw.trim().toUpperCase();
      if (!/^[A-Z]{2}$/.test(c)) throw new BadRequestException('Ülke kodu iki harfli ISO kodu olmalı (ör. TR).');
      return c;
    }
    const app = await this.prisma.trackedApp.findFirst({
      where: { siteId, appStoreId: { not: null }, isActive: true },
      orderBy: { lastFetchedAt: 'desc' },
    });
    const c = app?.country?.trim().toUpperCase();
    return c && /^[A-Z]{2}$/.test(c) ? c : 'TR';
  }
}
