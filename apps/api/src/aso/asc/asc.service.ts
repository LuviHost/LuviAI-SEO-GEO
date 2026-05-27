import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { encrypt, decrypt } from '@luviai/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AscApiClient, type AscCredentials } from './asc-api.client.js';

interface RequestingUser {
  id: string;
  role: 'USER' | 'ADMIN' | 'AGENCY_OWNER';
}

@Injectable()
export class AscService {
  private readonly log = new Logger(AscService.name);
  private readonly clientCache = new Map<string, { client: AscApiClient; cachedAt: number }>();

  constructor(private readonly prisma: PrismaService) {}

  private async assertSiteOwner(siteId: string, user: RequestingUser) {
    const site = await this.prisma.site.findUnique({ where: { id: siteId } });
    if (!site) throw new NotFoundException('Site bulunamadı');
    if (user.role !== 'ADMIN' && site.userId !== user.id) {
      throw new ForbiddenException('Bu site sana ait değil');
    }
    return site;
  }

  /** ASC bağla — issuer ID + key ID + .p8 */
  async connectAccount(args: {
    siteId: string;
    issuerId: string;
    keyId: string;
    privateKeyPem: string;
  }, user: RequestingUser) {
    await this.assertSiteOwner(args.siteId, user);
    if (!args.privateKeyPem.includes('PRIVATE KEY')) {
      throw new BadRequestException('Geçersiz .p8 — BEGIN PRIVATE KEY bulunamadı');
    }

    // Validate: gerçek API ile test
    const tempClient = new AscApiClient({
      issuerId: args.issuerId,
      keyId: args.keyId,
      privateKeyPem: args.privateKeyPem,
    });
    try {
      await tempClient.listApps(1);
    } catch (err: any) {
      throw new BadRequestException(`Apple ASC reddetti: ${err.message?.slice(0, 200)}`);
    }

    const encryptedKey = encrypt(args.privateKeyPem);

    // Upsert (1 site = 1 ASC account)
    const existing = await this.prisma.ascAccount.findFirst({ where: { siteId: args.siteId } });
    if (existing) {
      const updated = await this.prisma.ascAccount.update({
        where: { id: existing.id },
        data: {
          issuerId: args.issuerId,
          keyId: args.keyId,
          encryptedKey,
          isActive: true,
          lastError: null,
        },
      });
      this.clientCache.delete(updated.id);
      return updated;
    }
    return this.prisma.ascAccount.create({
      data: {
        siteId: args.siteId,
        issuerId: args.issuerId,
        keyId: args.keyId,
        encryptedKey,
      },
    });
  }

  async listAccounts(siteId: string, user: RequestingUser) {
    await this.assertSiteOwner(siteId, user);
    return this.prisma.ascAccount.findMany({
      where: { siteId },
      select: {
        id: true, issuerId: true, keyId: true,
        isActive: true, lastSyncAt: true, lastError: true, createdAt: true,
        apps: {
          select: {
            id: true, appleAppId: true, bundleId: true, name: true,
            latestVersion: true, latestReleaseAt: true,
          },
        },
      },
    });
  }

  async disconnectAccount(accountId: string, user: RequestingUser) {
    const acc = await this.prisma.ascAccount.findUnique({ where: { id: accountId } });
    if (!acc) throw new NotFoundException('Hesap bulunamadı');
    await this.assertSiteOwner(acc.siteId, user);
    await this.prisma.ascAccount.delete({ where: { id: accountId } });
    this.clientCache.delete(accountId);
    return { ok: true };
  }

  private async getClient(accountId: string): Promise<AscApiClient> {
    const cached = this.clientCache.get(accountId);
    if (cached && Date.now() - cached.cachedAt < 5 * 60_000) return cached.client;
    const acc = await this.prisma.ascAccount.findUnique({ where: { id: accountId } });
    if (!acc) throw new NotFoundException('Hesap bulunamadı');
    const creds: AscCredentials = {
      issuerId: acc.issuerId,
      keyId: acc.keyId,
      privateKeyPem: decrypt(acc.encryptedKey),
    };
    const client = new AscApiClient(creds);
    this.clientCache.set(accountId, { client, cachedAt: Date.now() });
    return client;
  }

  /** Apple'dan app'leri çek + DB'ye yaz */
  async syncApps(accountId: string, user?: RequestingUser) {
    const acc = await this.prisma.ascAccount.findUnique({ where: { id: accountId } });
    if (!acc) throw new NotFoundException('Hesap bulunamadı');
    if (user) await this.assertSiteOwner(acc.siteId, user);

    const client = await this.getClient(accountId);
    try {
      const { data: apps } = await client.listApps(100);
      let synced = 0;
      for (const a of apps ?? []) {
        const appleAppId = String(a.id);
        const attrs = a.attributes ?? {};
        await this.prisma.ascApp.upsert({
          where: { appleAppId },
          create: {
            accountId,
            appleAppId,
            bundleId: attrs.bundleId ?? '',
            name: attrs.name ?? 'Unknown App',
            primaryLocale: attrs.primaryLocale,
          },
          update: {
            name: attrs.name ?? 'Unknown App',
            bundleId: attrs.bundleId ?? '',
          },
        });
        synced++;
      }
      await this.prisma.ascAccount.update({
        where: { id: accountId },
        data: { lastSyncAt: new Date(), lastError: null },
      });
      this.log.log(`[asc:${accountId}] ${synced} app sync edildi`);
      return { synced };
    } catch (err: any) {
      await this.prisma.ascAccount.update({
        where: { id: accountId },
        data: { lastError: err.message },
      });
      throw err;
    }
  }

  /** Apple'dan release'leri çek + alert üret */
  async syncReleases(appId: string) {
    const app = await this.prisma.ascApp.findUnique({ where: { id: appId } });
    if (!app) throw new NotFoundException('App bulunamadı');

    const client = await this.getClient(app.accountId);
    try {
      const { data: versions } = await client.listAppStoreVersions(app.appleAppId, 20);
      let synced = 0;
      let latestReleaseDate: Date | null = null;
      let latestVersion: string | null = null;
      for (const v of versions ?? []) {
        const releaseId = String(v.id);
        const attrs = v.attributes ?? {};
        const releaseDate = attrs.releaseDate ? new Date(attrs.releaseDate) : null;
        await this.prisma.ascRelease.upsert({
          where: { appleReleaseId: releaseId },
          create: {
            appId,
            appleReleaseId: releaseId,
            versionString: attrs.versionString ?? '',
            releaseType: attrs.releaseType,
            state: attrs.appStoreState ?? 'UNKNOWN',
            releaseDate,
          },
          update: {
            state: attrs.appStoreState ?? 'UNKNOWN',
            releaseDate,
          },
        });
        if (releaseDate && (!latestReleaseDate || releaseDate > latestReleaseDate)) {
          latestReleaseDate = releaseDate;
          latestVersion = attrs.versionString;
        }
        synced++;
      }
      // App'in latest version + release date'ini güncelle
      if (latestReleaseDate) {
        await this.prisma.ascApp.update({
          where: { id: appId },
          data: { latestVersion, latestReleaseAt: latestReleaseDate },
        });
      }

      // Alert: 60+ gündür update yoksa WARN, 120+ gün CRITICAL
      if (latestReleaseDate) {
        const daysSince = Math.floor((Date.now() - latestReleaseDate.getTime()) / 86400_000);
        if (daysSince >= 60) {
          await this.prisma.ascReleaseAlert.create({
            data: {
              appId,
              severity: daysSince >= 120 ? 'CRITICAL' : 'WARN',
              message: `${daysSince} gündür yeni bir release yayınlanmamış. App Store algoritması "abandonware" işareti koyabilir.`,
              daysSinceUpdate: daysSince,
            },
          });
        }
      }
      return { synced };
    } catch (err: any) {
      this.log.error(`[asc:syncReleases ${appId}] ${err.message}`);
      throw err;
    }
  }

  /** Müşteri yorumlarını çek */
  async fetchReviews(appId: string, limit = 50) {
    const app = await this.prisma.ascApp.findUnique({ where: { id: appId } });
    if (!app) throw new NotFoundException('App bulunamadı');

    const client = await this.getClient(app.accountId);
    const { data: reviews } = await client.listCustomerReviews(app.appleAppId, { limit, sort: '-createdDate' });
    return {
      appId,
      appName: app.name,
      reviews: (reviews ?? []).map((r: any) => ({
        id: r.id,
        rating: r.attributes?.rating ?? 0,
        title: r.attributes?.title ?? '',
        body: r.attributes?.body ?? '',
        reviewerNickname: r.attributes?.reviewerNickname ?? '',
        territory: r.attributes?.territory ?? '',
        createdDate: r.attributes?.createdDate ?? null,
      })),
      avgRating: (reviews ?? []).length > 0
        ? (reviews.reduce((s: number, r: any) => s + (r.attributes?.rating ?? 0), 0) / reviews.length).toFixed(2)
        : null,
    };
  }

  /** Yoruma cevap ver */
  async replyToReview(appId: string, reviewId: string, body: string, user: RequestingUser) {
    const app = await this.prisma.ascApp.findUnique({ where: { id: appId }, include: { account: true } });
    if (!app) throw new NotFoundException('App bulunamadı');
    await this.assertSiteOwner(app.account.siteId, user);
    if (!body || body.length < 5 || body.length > 5970) {
      throw new BadRequestException('Yanıt 5-5970 karakter olmalı');
    }
    const client = await this.getClient(app.accountId);
    return client.replyToReview(reviewId, body);
  }

  /** Aktif alert'leri listele */
  async listAlerts(siteId: string, user: RequestingUser) {
    await this.assertSiteOwner(siteId, user);
    return this.prisma.ascReleaseAlert.findMany({
      where: { acknowledgedAt: null, app: { account: { siteId } } },
      include: { app: { select: { name: true, appleAppId: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async acknowledgeAlert(alertId: string, user: RequestingUser) {
    const alert = await this.prisma.ascReleaseAlert.findUnique({
      where: { id: alertId },
      include: { app: { include: { account: true } } },
    });
    if (!alert) throw new NotFoundException('Alert bulunamadı');
    await this.assertSiteOwner(alert.app.account.siteId, user);
    return this.prisma.ascReleaseAlert.update({
      where: { id: alertId },
      data: { acknowledgedAt: new Date(), acknowledgedBy: user.id },
    });
  }

  /** Cron için: tüm aktif hesaplar üzerinden günlük sync */
  async runDailySyncAll() {
    const accounts = await this.prisma.ascAccount.findMany({ where: { isActive: true } });
    this.log.log(`[asc-cron] ${accounts.length} hesap için günlük sync`);
    for (const acc of accounts) {
      try {
        await this.syncApps(acc.id);
        const apps = await this.prisma.ascApp.findMany({ where: { accountId: acc.id } });
        for (const app of apps) {
          try {
            await this.syncReleases(app.id);
          } catch (err: any) {
            this.log.warn(`[asc-cron] release sync fail (${app.appleAppId}): ${err.message}`);
          }
        }
      } catch (err: any) {
        this.log.error(`[asc-cron] account ${acc.id} fail: ${err.message}`);
      }
    }
  }
}
