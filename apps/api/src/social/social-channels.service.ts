import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { encrypt, decrypt } from '@luviai/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { getAdapter, listSupportedTypes } from './adapters/registry.js';
import { LinkedInAdapter } from './adapters/linkedin.adapter.js';
import { SocialAutoDraftService } from './social-auto-draft.service.js';

type RequestingUser = { id: string; role: 'USER' | 'ADMIN' | 'AGENCY_OWNER' };

@Injectable()
export class SocialChannelsService {
  private readonly log = new Logger(SocialChannelsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly autoDraft: SocialAutoDraftService,
  ) {}

  // ─── Site ownership helper ─────────────────────────────────

  private async assertSiteOwner(siteId: string, user: RequestingUser) {
    const site = await this.prisma.site.findUnique({
      where: { id: siteId },
      select: { id: true, userId: true },
    });
    if (!site) throw new NotFoundException('Site bulunamadi');
    if (user.role !== 'ADMIN' && site.userId !== user.id) {
      throw new ForbiddenException('Bu site sana ait degil');
    }
    return site;
  }

  private async assertChannelOwner(channelId: string, user: RequestingUser) {
    const channel = await this.prisma.socialChannel.findUnique({
      where: { id: channelId },
      include: { site: { select: { userId: true } } },
    });
    if (!channel) throw new NotFoundException('Kanal bulunamadi');
    if (user.role !== 'ADMIN' && channel.site.userId !== user.id) {
      throw new ForbiddenException('Bu kanal sana ait degil');
    }
    return channel;
  }

  // ─── CRUD ──────────────────────────────────────────────────

  static getCatalog() {
    return listSupportedTypes();
  }

  async list(siteId: string, user: RequestingUser) {
    await this.assertSiteOwner(siteId, user);
    const channels = await this.prisma.socialChannel.findMany({
      where: { siteId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
    return channels.map((c) => ({
      id: c.id,
      siteId: c.siteId,
      type: c.type,
      name: c.name,
      isActive: c.isActive,
      isDefault: c.isDefault,
      externalId: c.externalId,
      externalName: c.externalName,
      externalAvatar: c.externalAvatar,
      lastUsedAt: c.lastUsedAt,
      lastError: c.lastError,
      config: c.config,
      createdAt: c.createdAt,
      hasCredentials: true,
    }));
  }

  async update(channelId: string, dto: { name?: string; isActive?: boolean; isDefault?: boolean; config?: any }, user: RequestingUser) {
    const channel = await this.assertChannelOwner(channelId, user);
    if (dto.isDefault) {
      // Ayni site + ayni type icin default'u tek tut
      await this.prisma.socialChannel.updateMany({
        where: { siteId: channel.siteId, type: channel.type, isDefault: true, NOT: { id: channelId } },
        data: { isDefault: false },
      });
    }
    return this.prisma.socialChannel.update({
      where: { id: channelId },
      data: dto,
    });
  }

  async remove(channelId: string, user: RequestingUser) {
    await this.assertChannelOwner(channelId, user);
    await this.prisma.socialChannel.delete({ where: { id: channelId } });
    return { ok: true };
  }

  // ─── OAuth helpers ────────────────────────────────────────

  /**
   * /api/sites/:siteId/social/:type/oauth/start
   * Kullanici tiklar -> consent URL doner.
   * State token: siteId + type'i imzali tasir.
   */
  buildAuthUrl(siteId: string, channelType: string) {
    const adapter = getAdapter(channelType);
    if (!adapter.oauth) throw new BadRequestException(`${channelType} icin OAuth desteklenmiyor`);
    const state = Buffer.from(JSON.stringify({ siteId, type: channelType, n: Date.now() })).toString('base64url');
    const redirectUri = `${process.env.API_BASE_URL}/api/social/oauth/callback`;
    // LinkedIn icin tip-bazli scope (Personal vs Company) — type'i adapter'a aktar
    const url = (adapter.oauth as any).buildAuthUrl.call(adapter.oauth, state, redirectUri, channelType);
    return { url };
  }

  parseState(state: string): { siteId: string; type: string } {
    try {
      const decoded = JSON.parse(Buffer.from(state, 'base64url').toString('utf-8'));
      if (!decoded.siteId || !decoded.type) throw new Error('Eksik alan');
      return decoded;
    } catch {
      throw new BadRequestException('OAuth state gecersiz');
    }
  }

  async handleCallback(code: string, state: string) {
    const { siteId, type } = this.parseState(state);
    const adapter = getAdapter(type);
    if (!adapter.oauth) throw new BadRequestException(`${type} icin OAuth desteklenmiyor`);

    const redirectUri = `${process.env.API_BASE_URL}/api/social/oauth/callback`;
    // PKCE iceren adapter'lar (X) state icindeki code_verifier'i gerek;
    // bu yuzden state'i exchange'e iletiyoruz. LinkedIn icin zararsiz.
    const tokens = await (adapter.oauth as any).exchange(code, redirectUri, state);
    const profile = await adapter.oauth.fetchProfile(tokens.accessToken);

    const credentialsObj = {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt?.toISOString(),
      scope: tokens.extra?.scope,
    };
    const encrypted = encrypt(JSON.stringify(credentialsObj));

    // Upsert: ayni site + type + externalId varsa guncelle
    const existing = await this.prisma.socialChannel.findFirst({
      where: { siteId, type: type as any, externalId: profile.externalId },
    });

    if (existing) {
      await this.prisma.socialChannel.update({
        where: { id: existing.id },
        data: {
          credentials: encrypted,
          externalName: profile.externalName,
          externalAvatar: profile.externalAvatar,
          isActive: true,
          lastError: null,
        },
      });
      this.backfillDraftsForSite(siteId).catch((err) =>
        this.log.warn(`[${siteId}] backfill draft basarisiz: ${err.message}`),
      );
      return { siteId, channelId: existing.id, type };
    }

    const created = await this.prisma.socialChannel.create({
      data: {
        siteId,
        type: type as any,
        name: profile.externalName,
        externalId: profile.externalId,
        externalName: profile.externalName,
        externalAvatar: profile.externalAvatar,
        credentials: encrypted,
        ...(profile.extra ? { config: profile.extra as any } : {}),
        isActive: true,
      },
    });
    this.backfillDraftsForSite(siteId).catch((err) =>
      this.log.warn(`[${siteId}] backfill draft basarisiz: ${err.message}`),
    );
    return { siteId, channelId: created.id, type };
  }

  // ─── Publish helper (cron + manuel) ───────────────────────

  // ─── LinkedIn şirket sayfa seçimi ──────────────────────────

  async listLinkedInPages(channelId: string, user: RequestingUser) {
    const channel = await this.assertChannelOwner(channelId, user);
    if (channel.type !== 'LINKEDIN_PERSONAL' && channel.type !== 'LINKEDIN_COMPANY') {
      throw new BadRequestException('Sadece LinkedIn kanallari icin sayfa secimi yapilir');
    }
    const { ctx } = await this.getDecryptedContext(channelId);
    const accessToken = ctx.credentials?.accessToken;
    if (!accessToken) throw new BadRequestException('Kanal token yok');
    try {
      const orgs = await LinkedInAdapter.listAdminOrgs(accessToken);
      return orgs;
    } catch (err: any) {
      if (err?.message === 'LINKEDIN_NO_MDP_ACCESS') {
        throw new BadRequestException(
          'LinkedIn sirket sayfasi listesi cekilemiyor: bu app icin Community Management API onayi gerekli. ' +
          'LinkedIn Developer Apps -> Products -> Community Management API -> Request access yap. ' +
          'Onaylanma 1-2 hafta surer; bu sirede sadece kisisel LinkedIn profili kullanilabilir. ' +
          'Eski "Marketing Developer Platform" urunu LinkedIn tarafindan yeniden adlandirildi.',
        );
      }
      throw new BadRequestException(`LinkedIn sayfa listesi alinamadi: ${err.message}`);
    }
  }

  async setLinkedInPage(channelId: string, organizationUrn: string, organizationName: string, user: RequestingUser) {
    const channel = await this.assertChannelOwner(channelId, user);
    if (channel.type !== 'LINKEDIN_COMPANY') {
      throw new BadRequestException('Sayfa secimi sadece LinkedIn Sirket kanallari icin');
    }
    if (!organizationUrn?.startsWith('urn:li:organization:')) {
      throw new BadRequestException('organizationUrn formati: urn:li:organization:{id}');
    }
    return this.prisma.socialChannel.update({
      where: { id: channelId },
      data: {
        externalId: organizationUrn,
        externalName: organizationName,
        name: organizationName,
      },
    });
  }

  /**
   * Yeni kanal baglandiginda gecmis PUBLISHED makaleler icin DRAFT yoksa olustur.
   * createDraftsForArticle idempotent — sadece eksik kanallar icin yeni post acar.
   * Son 20 PUBLISHED makale ile sinirli (eski makaleleri sosyalde tekrar dolastirmamak icin).
   */
  private async backfillDraftsForSite(siteId: string): Promise<void> {
    const recent = await this.prisma.article.findMany({
      where: { siteId, status: 'PUBLISHED' as any },
      orderBy: { publishedAt: 'desc' },
      take: 20,
      select: { id: true },
    });
    let total = 0;
    for (const a of recent) {
      const r = await this.autoDraft.createDraftsForArticle(a.id);
      total += r.created;
    }
    if (total > 0) {
      this.log.log(`[${siteId}] backfill: ${total} yeni draft olusturuldu (${recent.length} makale)`);
    }
  }

  /**
   * Kanal credentials'ini decrypt edip publish'e hazirla.
   * Token expire olmus / olmak uzere ise adapter.refreshTokens cagrilir;
   * basarili ise yeni credentials DB'ye yazilir.
   */
  async getDecryptedContext(channelId: string) {
    const channel = await this.prisma.socialChannel.findUniqueOrThrow({ where: { id: channelId } });
    if (!channel.isActive) throw new BadRequestException('Kanal aktif degil');
    let credentials: Record<string, any>;
    try {
      credentials = JSON.parse(decrypt(channel.credentials));
    } catch {
      throw new BadRequestException('Kanal credentials decrypt edilemedi — yeniden bagla');
    }

    // ── Token refresh: adapter destekliyorsa ve token expire olmak uzere ise ──
    const adapter = getAdapter(channel.type);
    const expiresAt = credentials.expiresAt ? new Date(credentials.expiresAt) : null;
    // 60sn buffer: tam o anda gonderirken expire etmesin
    const expiringSoon = expiresAt && expiresAt.getTime() < Date.now() + 60_000;

    if (expiringSoon && typeof adapter.refreshTokens === 'function') {
      try {
        const refreshed = await adapter.refreshTokens({
          credentials,
          config: (channel.config as Record<string, any>) ?? null,
          externalId: channel.externalId,
        });
        if (refreshed) {
          credentials = refreshed;
          const encrypted = encrypt(JSON.stringify(refreshed));
          await this.prisma.socialChannel.update({
            where: { id: channelId },
            data: { credentials: encrypted, lastError: null },
          });
          this.log.log(`[${channel.type}] token refreshed for channel ${channelId}`);
        }
      } catch (err: any) {
        this.log.warn(`[${channel.type}] token refresh failed: ${err.message}`);
        // Refresh basarisiz oldu — kullaniciya net mesaj
        await this.prisma.socialChannel.update({
          where: { id: channelId },
          data: { lastError: `Token refresh failed: ${err.message?.slice(0, 250) ?? 'unknown'}` },
        });
        throw new BadRequestException(
          `${channel.type} token suresi doldu ve yenilenemedi. Sosyal Kanallar → kanali silip yeniden bagla.`,
        );
      }
    }

    return {
      channel,
      ctx: {
        credentials,
        config: (channel.config as Record<string, any>) ?? null,
        externalId: channel.externalId,
      },
    };
  }
}
