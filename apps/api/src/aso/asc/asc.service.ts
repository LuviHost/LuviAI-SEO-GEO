import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { encrypt, decrypt } from '@luviai/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AscApiClient, type AscCredentials } from './asc-api.client.js';
import { findPlaceholders } from './review-reply.js';

/**
 * Canli surum + gercek yayin tarihi — Apple'in herkese acik iTunes Lookup'i.
 * ASC'nin appStoreVersion kaynaginda yayin tarihi alani YOK (semada
 * releaseDate bulunmuyor); eskiden `attrs.releaseDate` okunuyordu → hep null
 * → "60+ gundur guncelleme yok" uyarisi hic uretilmiyordu.
 * Uygulama TR'de yoksa US vitrini denenir.
 */
async function fetchLiveVersion(appleAppId: string): Promise<{ version: string; releasedAt: Date } | null> {
  for (const country of ['tr', 'us']) {
    try {
      const res = await fetch(`https://itunes.apple.com/lookup?id=${encodeURIComponent(appleAppId)}&country=${country}`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const r = (await res.json())?.results?.[0];
      const releasedAt = r?.currentVersionReleaseDate ? new Date(r.currentVersionReleaseDate) : null;
      if (r?.version && releasedAt && !Number.isNaN(+releasedAt)) return { version: String(r.version), releasedAt };
    } catch {
      /* sonraki vitrin */
    }
  }
  return null;
}

export interface RequestingUser {
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

  /**
   * App'i yükler; `user` verildiyse app'in hesabının sitesi o kullanıcıya ait
   * olmalı. `user`'sız çağrı yalnızca iç kullanım (cron) içindir — controller
   * HER ZAMAN user geçirir (önceden geçirmiyordu: herhangi bir oturum sahibi
   * başkasının app'i için Apple API'sini tetikleyip yorumlarını okuyabiliyordu).
   */
  async loadApp(appId: string, user?: RequestingUser) {
    const app = await this.prisma.ascApp.findUnique({ where: { id: appId }, include: { account: true } });
    if (!app) throw new NotFoundException('App bulunamadı');
    if (user) await this.assertSiteOwner(app.account.siteId, user);
    return app;
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

  async getClient(accountId: string): Promise<AscApiClient> {
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
  async syncReleases(appId: string, user?: RequestingUser) {
    const app = await this.loadApp(appId, user);

    const client = await this.getClient(app.accountId);
    try {
      const { data: versions } = await client.listAppStoreVersions(app.appleAppId, 20);
      const live = await fetchLiveVersion(app.appleAppId);
      let synced = 0;
      const latestReleaseDate: Date | null = live?.releasedAt ?? null;
      const latestVersion: string | null = live?.version ?? null;
      for (const v of versions ?? []) {
        const releaseId = String(v.id);
        const attrs = v.attributes ?? {};
        // appStoreState kullanimdan kalkti (Apple semasi) → appVersionState
        const state = attrs.appVersionState ?? attrs.appStoreState ?? 'UNKNOWN';
        const releaseDate = live && attrs.versionString === live.version ? live.releasedAt : null;
        await this.prisma.ascRelease.upsert({
          where: { appleReleaseId: releaseId },
          create: {
            appId,
            appleReleaseId: releaseId,
            versionString: attrs.versionString ?? '',
            releaseType: attrs.releaseType,
            state,
            releaseDate,
          },
          // Bilinmeyen tarih mevcut degeri SILMEZ
          update: { state, ...(releaseDate ? { releaseDate } : {}) },
        });
        synced++;
      }
      // App'in latest version + release date'ini güncelle
      if (latestReleaseDate) {
        await this.prisma.ascApp.update({
          where: { id: appId },
          data: { latestVersion, latestReleaseAt: latestReleaseDate },
        });
      }

      // Alert: 60+ gündür update yoksa WARN, 120+ gün CRITICAL.
      // Onaylanmamış alert varsa YENİSİ açılmaz, mevcut olan güncellenir —
      // önceden her günlük sync (ve her manuel sync) aynı uyarıyı yeniden
      // oluşturup listeyi kopyalarla dolduruyordu.
      if (latestReleaseDate) {
        const daysSince = Math.floor((Date.now() - latestReleaseDate.getTime()) / 86400_000);
        if (daysSince >= 60) {
          const data = {
            severity: daysSince >= 120 ? 'CRITICAL' : 'WARN',
            message: `${daysSince} gündür yeni bir release yayınlanmamış. App Store algoritması "abandonware" işareti koyabilir.`,
            daysSinceUpdate: daysSince,
          };
          const open = await this.prisma.ascReleaseAlert.findFirst({
            where: { appId, acknowledgedAt: null },
            orderBy: { createdAt: 'desc' },
            select: { id: true },
          });
          if (open) {
            await this.prisma.ascReleaseAlert.update({ where: { id: open.id }, data });
          } else {
            await this.prisma.ascReleaseAlert.create({ data: { appId, ...data } });
          }
        }
      }
      return { synced };
    } catch (err: any) {
      this.log.error(`[asc:syncReleases ${appId}] ${err.message}`);
      throw err;
    }
  }

  /** Müşteri yorumlarını çek */
  async fetchReviews(appId: string, user?: RequestingUser, limit = 50) {
    const app = await this.loadApp(appId, user);

    const client = await this.getClient(app.accountId);
    const { data: reviews, included } = await client.listCustomerReviews(app.appleAppId, { limit, sort: '-createdDate' });
    const responses = new Map((included ?? []).filter((x: any) => x?.type === 'customerReviewResponses').map((x: any) => [x.id, x.attributes ?? {}]));
    return {
      appId,
      appName: app.name,
      reviews: (reviews ?? []).map((r: any) => {
        const resp: any = responses.get(r.relationships?.response?.data?.id);
        return {
          id: r.id,
          rating: r.attributes?.rating ?? 0,
          title: r.attributes?.title ?? '',
          body: r.attributes?.body ?? '',
          reviewerNickname: r.attributes?.reviewerNickname ?? '',
          territory: r.attributes?.territory ?? '',
          createdDate: r.attributes?.createdDate ?? null,
          // Yanit herkese acik; PENDING_PUBLISH = gonderildi, magazada henuz gorunmuyor
          response: resp ? { body: resp.responseBody ?? '', state: resp.state ?? null, lastModifiedDate: resp.lastModifiedDate ?? null } : null,
        };
      }),
      avgRating: (reviews ?? []).length > 0
        ? (reviews.reduce((s: number, r: any) => s + (r.attributes?.rating ?? 0), 0) / reviews.length).toFixed(2)
        : null,
    };
  }

  /** Yoruma cevap ver */
  async replyToReview(appId: string, reviewId: string, body: string, user: RequestingUser) {
    const app = await this.loadApp(appId, user);
    if (!body || body.length < 5 || body.length > 5970) {
      throw new BadRequestException('Yanıt 5-5970 karakter olmalı');
    }
    // Taslaktan kalan yer tutucu herkese acik yanitta yayinlanmasin
    const placeholders = findPlaceholders(body);
    if (placeholders.length) {
      throw new BadRequestException(`Yanıtta doldurulmamış yer tutucu var: ${placeholders.join(', ')}`);
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
