import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { encrypt, decrypt } from '@luviai/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { getAdapter, listSupportedTypes } from './adapters/registry.js';

type RequestingUser = { id: string; role: 'USER' | 'ADMIN' | 'AGENCY_OWNER' };

@Injectable()
export class SocialChannelsService {
  private readonly log = new Logger(SocialChannelsService.name);

  constructor(private readonly prisma: PrismaService) {}

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
    const url = adapter.oauth.buildAuthUrl(state, redirectUri);
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
    const tokens = await adapter.oauth.exchange(code, redirectUri);
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
    return { siteId, channelId: created.id, type };
  }

  // ─── Publish helper (cron + manuel) ───────────────────────

  /** Kanal credentials'ini decrypt edip publish'e hazirla */
  async getDecryptedContext(channelId: string) {
    const channel = await this.prisma.socialChannel.findUniqueOrThrow({ where: { id: channelId } });
    if (!channel.isActive) throw new BadRequestException('Kanal aktif degil');
    let credentials: Record<string, any>;
    try {
      credentials = JSON.parse(decrypt(channel.credentials));
    } catch {
      throw new BadRequestException('Kanal credentials decrypt edilemedi — yeniden bagla');
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
