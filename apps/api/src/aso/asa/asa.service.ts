import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { encrypt, decrypt } from '@luviai/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AsaApiClient, type AsaCredentials } from './asa-api.client.js';

interface RequestingUser {
  id: string;
  role: 'USER' | 'ADMIN' | 'AGENCY_OWNER';
}

@Injectable()
export class AsaService {
  private readonly log = new Logger(AsaService.name);
  // API client cache — aynı account için tekrar tekrar instance açma
  private readonly clientCache = new Map<string, { client: AsaApiClient; cachedAt: number }>();

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
   * Kullanıcı App Store Connect → Users and Access → Keys → Search Ads API'den
   * Org ID + Key ID + .p8 dosyası alır.
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

    // Validation: gerçek API'ye dene
    const tempClient = new AsaApiClient({
      orgId: args.orgId,
      keyId: args.keyId,
      privateKeyPem: args.privateKeyPem,
      teamId: args.teamId,
    });
    try {
      await tempClient.getAccessToken();
    } catch (err: any) {
      throw new BadRequestException(`Apple Search Ads auth başarısız: ${err.message}`);
    }

    // Aynı orgId siteye zaten bağlıysa update et
    const existing = await this.prisma.asaAccount.findFirst({
      where: { siteId: args.siteId, orgId: args.orgId },
    });
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
      return { id: updated.id, orgId: updated.orgId, status: 'updated' };
    }

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
    return { id: created.id, orgId: created.orgId, status: 'created' };
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
    return rows;
  }

  async disconnectAccount(accountId: string, user: RequestingUser) {
    const acc = await this.prisma.asaAccount.findUnique({ where: { id: accountId } });
    if (!acc) throw new NotFoundException('Hesap bulunamadı');
    await this.assertSiteOwner(acc.siteId, user);
    await this.prisma.asaAccount.delete({ where: { id: accountId } });
    this.clientCache.delete(accountId);
    return { ok: true };
  }

  /** Cached API client (5 dk TTL). */
  private async getClient(accountId: string): Promise<AsaApiClient> {
    const cached = this.clientCache.get(accountId);
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
    const client = new AsaApiClient(creds);
    this.clientCache.set(accountId, { client, cachedAt: Date.now() });
    return client;
  }

  // ─── Campaign management ─────────────────────────────

  /** Apple'dan kampanyaları sync et + DB'ye yaz */
  async syncCampaigns(accountId: string, user: RequestingUser) {
    const acc = await this.prisma.asaAccount.findUnique({ where: { id: accountId } });
    if (!acc) throw new NotFoundException('Hesap bulunamadı');
    await this.assertSiteOwner(acc.siteId, user);

    const client = await this.getClient(accountId);
    try {
      const { data: campaigns } = await client.listCampaigns({ limit: 100 });
      let synced = 0;
      const appleIds = new Set<string>();
      for (const c of campaigns ?? []) {
        appleIds.add(String(c.id));
        await this.prisma.asaCampaign.upsert({
          where: { asaCampaignId: String(c.id) },
          create: {
            accountId,
            asaCampaignId: String(c.id),
            name: c.name,
            budget: parseFloat(c.budgetAmount?.amount ?? '0'),
            totalBudget: c.totalBudgetAmount?.amount ? parseFloat(c.totalBudgetAmount.amount) : null,
            status: c.status,
            countriesOrRegions: c.countriesOrRegions ?? [],
            supplySources: c.supplySources ?? [],
            appAdamId: c.adamId ? String(c.adamId) : null,
          },
          update: {
            name: c.name,
            budget: parseFloat(c.budgetAmount?.amount ?? '0'),
            status: c.status,
          },
        });
        synced++;
      }

      // Apple'dan silinmiş olanları DB'den de sil (cascade adgroup + keywords)
      const dbCampaigns = await this.prisma.asaCampaign.findMany({
        where: { accountId },
        select: { id: true, asaCampaignId: true },
      });
      const orphans = dbCampaigns.filter((c) => !appleIds.has(c.asaCampaignId));
      let removed = 0;
      if (orphans.length > 0) {
        await this.prisma.asaCampaign.deleteMany({
          where: { id: { in: orphans.map((o) => o.id) } },
        });
        removed = orphans.length;
        this.log.log(`[asa:${accountId}] ${removed} silinmiş kampanya DB'den temizlendi`);
      }

      await this.prisma.asaAccount.update({
        where: { id: accountId },
        data: { lastSyncAt: new Date(), lastError: null },
      });
      this.log.log(`[asa:${accountId}] ${synced} kampanya sync, ${removed} silindi`);
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
      where: { account: { siteId } },
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

    const client = await this.getClient(args.accountId);

    // 1) Campaign create
    let camp: { data: any };
    try {
      camp = await client.createCampaign({
        name: args.name,
        budgetAmount: { amount: String(args.dailyBudgetUsd * 30), currency: 'USD' }, // toplam = 30 günlük tahmini
        dailyBudgetAmount: { amount: String(args.dailyBudgetUsd), currency: 'USD' },
        countriesOrRegions: args.countries,
        adamId: args.appleAppId,
        supplySources: ['APPSTORE_SEARCH_RESULTS'],
        paymentModel: 'PAYG',
      });
    } catch (err: any) {
      const raw = err?.message ?? String(err);
      this.log.error(`[asa:createCampaign] Apple reddetti: ${raw}`);
      // Apple'ın spesifik hata kodları — sadece kesin payment hatasını yakala
      if (/no.*payment.*method|payment.*required|payment.*not.*found|MISSING_PAYMENT|invalid.*payment/i.test(raw)) {
        throw new BadRequestException('Apple ödeme yöntemi yok. Apple Search Ads → Account Settings → Billing → Add Payment Method ekledikten sonra tekrar dene.');
      }
      if (/ADAMID|adamId|app.*not.*found/i.test(raw)) {
        throw new BadRequestException(`Apple App ID (${args.appleAppId}) bu hesaba bağlı değil. App'in Apple Developer hesabınla aynı org'da olduğundan emin ol.`);
      }
      if (/DUPLICATE_CAMPAIGN_NAME|not unique/i.test(raw)) {
        // Otomatik retry: timestamp suffix ekle
        const retryName = `${args.name} #${Date.now().toString().slice(-5)}`;
        try {
          this.log.warn(`[asa:createCampaign] DUPLICATE → otomatik retry: ${retryName}`);
          camp = await client.createCampaign({
            name: retryName,
            budgetAmount: { amount: String(args.dailyBudgetUsd * 30), currency: 'USD' },
            dailyBudgetAmount: { amount: String(args.dailyBudgetUsd), currency: 'USD' },
            countriesOrRegions: args.countries,
            adamId: args.appleAppId,
            supplySources: ['APPSTORE_SEARCH_RESULTS'],
            paymentModel: 'PAYG',
          });
        } catch (err2: any) {
          throw new BadRequestException(`Apple aynı isimde kampanya var ve otomatik retry de başarısız: ${err2.message?.slice(0, 200)}. Önce "Sync" basıp mevcut kampanyaları çek, sonra farklı isimle dene.`);
        }
        // DB'ye yazılacak ismi de güncelle
        (args as any).name = retryName;
      } else {
        throw new BadRequestException(`Apple kampanya oluşturmayı reddetti: ${raw.slice(0, 300)}`);
      }
    }
    if (!camp!) throw new BadRequestException('Kampanya oluşturulamadı');
    const asaCampaignId = String(camp!.data.id);

    // DB'ye yaz
    const dbCampaign = await this.prisma.asaCampaign.create({
      data: {
        accountId: args.accountId,
        asaCampaignId,
        name: args.name,
        budget: args.dailyBudgetUsd,
        status: 'ENABLED',
        countriesOrRegions: args.countries,
        supplySources: ['APPSTORE_SEARCH_RESULTS'],
        appAdamId: String(args.appleAppId),
      },
    });

    // 2) Default adgroup + keyword'ler — kampanya zaten Apple'da yaratıldı,
    //    burada hata olsa bile kampanyayı silmiyoruz; kullanıcıya net mesaj ver.
    if (args.keywords && args.keywords.length > 0) {
      const avgBid = args.keywords.reduce((s, k) => s + k.bidUsd, 0) / args.keywords.length;
      let adg: { data: any };
      try {
        adg = await client.createAdGroup(asaCampaignId, {
          name: `${args.name} — default`,
          defaultBidAmount: { amount: avgBid.toFixed(2), currency: 'USD' },
          startTime: new Date().toISOString(),
        });
      } catch (err: any) {
        const raw = err?.message ?? String(err);
        this.log.error(`[asa:createAdGroup] Apple reddetti: ${raw}`);
        throw new BadRequestException(
          `Kampanya oluştu ama ad group eklenemedi: ${raw.slice(0, 300)}. Kampanya Apple'da kayıtlı — "Sync" basıp listede gör.`,
        );
      }
      const asaAdGroupId = String(adg.data.id);

      const dbAdGroup = await this.prisma.asaAdGroup.create({
        data: {
          campaignId: dbCampaign.id,
          asaAdGroupId,
          name: `${args.name} — default`,
          defaultBidAmount: avgBid,
          status: 'ENABLED',
          targetingType: 'EXACT',
        },
      });

      // Keyword'leri ekle
      const apiKeywords = args.keywords.map((k) => ({
        text: k.text,
        matchType: k.matchType ?? 'EXACT' as const,
        bidAmount: { amount: k.bidUsd.toFixed(2), currency: 'USD' },
      }));
      let kwRes: { data: any[] };
      try {
        kwRes = await client.addTargetingKeywords(asaCampaignId, asaAdGroupId, apiKeywords);
      } catch (err: any) {
        const raw = err?.message ?? String(err);
        this.log.error(`[asa:addTargetingKeywords] Apple reddetti: ${raw}`);
        throw new BadRequestException(
          `Kampanya + ad group oluştu ama keyword'ler eklenemedi: ${raw.slice(0, 300)}. Apple Search Ads panelinden manuel ekleyebilirsin.`,
        );
      }

      for (const apiKw of kwRes.data ?? []) {
        await this.prisma.asaKeywordBid.create({
          data: {
            adGroupId: dbAdGroup.id,
            asaKeywordId: String(apiKw.id),
            keyword: apiKw.text,
            bidAmount: parseFloat(apiKw.bidAmount?.amount ?? '0'),
            matchType: apiKw.matchType,
            status: apiKw.status ?? 'ACTIVE',
          },
        });
      }
    }

    return { campaignId: dbCampaign.id, asaCampaignId };
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
    });
  }

  /**
   * Auto-Pilot run — bir hesap için çalışır. Logic:
   *  1. Mevcut kampanyaların son 7g performance'ını al
   *  2. Yüksek CPI / 0 install olan keyword'leri PAUSE et
   *  3. AI önerisinden mevcut kampanyalarda olmayan TOP 5 keyword'ü mevcut adgroup'a ekle
   *  4. Aylık bütçe cap aşıldıysa hiçbir yeni harcama yapma
   */
  async runAutoPilot(accountId: string, user?: RequestingUser) {
    const acc = await this.prisma.asaAccount.findUnique({ where: { id: accountId } });
    if (!acc) throw new NotFoundException('Hesap bulunamadı');
    if (user) await this.assertSiteOwner(acc.siteId, user);
    if (!acc.autoPilotEnabled) throw new BadRequestException('Auto-Pilot kapalı');

    const result = { added: [] as string[], paused: [] as string[], skipped: [] as string[], reason: '' };
    const client = await this.getClient(accountId);

    // 1) Performance fetch — son 7g
    try {
      await this.fetchPerformance(accountId, 7).catch(() => null);
    } catch {
      // sessiz geç
    }

    // 2) Bütçe cap kontrolü — ay başından bu yana harcama topla
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const perfAgg = await this.prisma.asaPerformanceDaily.aggregate({
      where: { campaign: { accountId }, date: { gte: monthStart } },
      _sum: { spendUsd: true },
    });
    const monthSpend = perfAgg._sum?.spendUsd ?? 0;
    if (acc.autoPilotBudgetCap && monthSpend >= acc.autoPilotBudgetCap) {
      result.reason = `Aylık bütçe cap'ı aşıldı: $${monthSpend.toFixed(2)} / $${acc.autoPilotBudgetCap}`;
      result.skipped.push('budget-cap-reached');
      await this.prisma.asaAccount.update({
        where: { id: accountId },
        data: { autoPilotLastRunAt: new Date(), autoPilotLastResult: JSON.stringify(result) },
      });
      return result;
    }

    // 3) Düşük performans keyword'leri pause et
    //    Kriter: son 7g — clicks > 20 AND installs = 0 (boşa harcama)
    const losing = await this.prisma.asaKeywordBid.findMany({
      where: { adGroup: { campaign: { accountId } }, status: 'ACTIVE' },
      include: { adGroup: { include: { campaign: true } } },
    });

    const last7 = new Date();
    last7.setDate(last7.getDate() - 7);
    for (const kb of losing) {
      const stats = await this.prisma.asaPerformanceDaily.aggregate({
        where: { campaignId: kb.adGroup.campaignId, date: { gte: last7 } },
        _sum: { taps: true, installs: true, spendUsd: true },
      });
      const taps = stats._sum?.taps ?? 0;
      const installs = stats._sum?.installs ?? 0;
      if (taps >= 20 && installs === 0) {
        try {
          await client.updateTargetingKeyword(
            kb.adGroup.campaign.asaCampaignId,
            kb.adGroup.asaAdGroupId,
            kb.asaKeywordId,
            { bidAmount: { amount: kb.bidAmount.toFixed(2), currency: 'USD' }, status: 'PAUSED' },
          );
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
      const existingKwSet = new Set(losing.map((k) => k.keyword.toLowerCase()));
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
            bidAmount: { amount: suggestion.bidUsd.toFixed(2), currency: 'USD' },
          }));
          try {
            const kwRes = await client.addTargetingKeywords(adg.campaign.asaCampaignId, adg.asaAdGroupId, apiKeywords);
            for (const apiKw of kwRes.data ?? []) {
              await this.prisma.asaKeywordBid.create({
                data: {
                  adGroupId: adg.id,
                  asaKeywordId: String(apiKw.id),
                  keyword: apiKw.text,
                  bidAmount: parseFloat(apiKw.bidAmount?.amount ?? '0'),
                  matchType: apiKw.matchType,
                  status: 'ACTIVE',
                },
              });
              result.added.push(apiKw.text);
            }
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

    const client = await this.getClient(kb.adGroup.campaign.accountId);
    await client.updateTargetingKeyword(
      kb.adGroup.campaign.asaCampaignId,
      kb.adGroup.asaAdGroupId,
      kb.asaKeywordId,
      { bidAmount: { amount: bidUsd.toFixed(2), currency: 'USD' } },
    );

    return this.prisma.asaKeywordBid.update({
      where: { id: keywordBidId },
      data: { bidAmount: bidUsd, lastOptimizedAt: new Date() },
    });
  }

  // ─── Performance ─────────────────────────────────────

  /** Son N gün performance'ını Apple'dan çek + DB'ye yaz. Cron'dan günlük çağrılır. */
  async fetchPerformance(accountId: string, daysBack = 7) {
    const client = await this.getClient(accountId);
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);

    const report = await client.getCampaignReport({
      startTime: fmt(startDate),
      endTime: fmt(endDate),
      granularity: 'DAILY',
      timeZone: 'UTC',
      returnRowTotals: false,
      returnRecordsWithNoMetrics: false,
    });

    const rows = report.data?.reportingDataResponse?.row ?? [];
    let saved = 0;
    for (const r of rows) {
      const campaignId = String(r.metadata?.campaignId ?? '');
      const dbCampaign = await this.prisma.asaCampaign.findUnique({ where: { asaCampaignId: campaignId } });
      if (!dbCampaign) continue;

      for (const g of r.granularity ?? []) {
        const date = new Date(g.date);
        await this.prisma.asaPerformanceDaily.upsert({
          where: { campaignId_date: { campaignId: dbCampaign.id, date } },
          create: {
            campaignId: dbCampaign.id,
            date,
            impressions: g.impressions ?? 0,
            taps: g.taps ?? 0,
            installs: g.installs ?? 0,
            reattributions: g.reattributions ?? 0,
            spendUsd: parseFloat(g.localSpend?.amount ?? '0'),
            avgCpt: g.avgCPT?.amount ? parseFloat(g.avgCPT.amount) : null,
            avgCpa: g.avgCPA?.amount ? parseFloat(g.avgCPA.amount) : null,
            ttr: g.ttr ?? null,
            conversionRate: g.conversionRate ?? null,
          },
          update: {
            impressions: g.impressions ?? 0,
            taps: g.taps ?? 0,
            installs: g.installs ?? 0,
            spendUsd: parseFloat(g.localSpend?.amount ?? '0'),
            avgCpt: g.avgCPT?.amount ? parseFloat(g.avgCPT.amount) : null,
            avgCpa: g.avgCPA?.amount ? parseFloat(g.avgCPA.amount) : null,
            ttr: g.ttr ?? null,
            conversionRate: g.conversionRate ?? null,
          },
        });
        saved++;
      }
    }
    this.log.log(`[asa:${accountId}] ${saved} günlük performance row yazıldı`);
    return { saved };
  }

  async getPerformanceSummary(siteId: string, user: RequestingUser, daysBack = 30) {
    await this.assertSiteOwner(siteId, user);
    const since = new Date();
    since.setDate(since.getDate() - daysBack);

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

    return {
      daysBack,
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
}
