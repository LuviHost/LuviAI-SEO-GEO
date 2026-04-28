import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  formatSlotLabel,
  getPlanSocialConfig,
  PLAN_SOCIAL_LIMITS,
  WeeklySlot,
} from './plan-tiers.js';

type RequestingUser = { id: string; role: 'USER' | 'ADMIN' | 'AGENCY_OWNER' };

@Injectable()
export class SocialSlotsService {
  private readonly log = new Logger(SocialSlotsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Ownership helpers ─────────────────────────────────────

  private async assertSiteOwner(siteId: string, user: RequestingUser) {
    const site = await this.prisma.site.findUnique({
      where: { id: siteId },
      include: { user: { select: { plan: true } } },
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

  private async assertSlotOwner(slotId: string, user: RequestingUser) {
    const slot = await this.prisma.socialRecurringSlot.findUnique({
      where: { id: slotId },
      include: { channel: { include: { site: { select: { userId: true } } } } },
    });
    if (!slot) throw new NotFoundException('Slot bulunamadi');
    if (user.role !== 'ADMIN' && slot.channel.site.userId !== user.id) {
      throw new ForbiddenException('Bu slot sana ait degil');
    }
    return slot;
  }

  // ─── Plan info ─────────────────────────────────────────────

  async getSitePlanInfo(siteId: string, user: RequestingUser) {
    const site = await this.assertSiteOwner(siteId, user);
    const config = getPlanSocialConfig(site.user.plan);
    return {
      plan: site.user.plan,
      postsPerWeek: config.postsPerWeek,
      timezone: config.timezone,
      defaultSlots: config.slots.map((s) => ({ ...s, label: formatSlotLabel(s) })),
      // UI'ya gostermek icin tum planlarin ozetini de don
      tiers: Object.entries(PLAN_SOCIAL_LIMITS).map(([plan, c]) => ({
        plan,
        postsPerWeek: c.postsPerWeek,
      })),
    };
  }

  // ─── Slot CRUD ─────────────────────────────────────────────

  async listSlots(siteId: string, user: RequestingUser) {
    await this.assertSiteOwner(siteId, user);
    const slots = await this.prisma.socialRecurringSlot.findMany({
      where: { channel: { siteId } },
      include: {
        channel: {
          select: { id: true, type: true, name: true, isActive: true, isDefault: true, externalName: true },
        },
      },
      orderBy: [{ dayOfWeek: 'asc' }, { hour: 'asc' }, { minute: 'asc' }],
    });
    return slots.map((s) => ({
      id: s.id,
      channelId: s.channelId,
      dayOfWeek: s.dayOfWeek,
      hour: s.hour,
      minute: s.minute,
      timezone: s.timezone,
      source: s.source,
      isActive: s.isActive,
      label: formatSlotLabel({ dayOfWeek: s.dayOfWeek, hour: s.hour, minute: s.minute }),
      channel: s.channel,
    }));
  }

  async createSlot(
    channelId: string,
    dto: { dayOfWeek: number; hour: number; minute: number; source?: 'QUEUE' | 'AUTO'; isActive?: boolean },
    user: RequestingUser,
  ) {
    const channel = await this.assertChannelOwner(channelId, user);
    this.assertValidSlot(dto);
    await this.assertWithinPlanLimit(channel.siteId, /* extraSlotForChannelId */ channelId);
    return this.prisma.socialRecurringSlot.create({
      data: {
        channelId,
        dayOfWeek: dto.dayOfWeek,
        hour: dto.hour,
        minute: dto.minute,
        timezone: 'Europe/Istanbul',
        source: dto.source ?? 'QUEUE',
        isActive: dto.isActive ?? true,
      },
    });
  }

  async updateSlot(
    slotId: string,
    dto: { dayOfWeek?: number; hour?: number; minute?: number; source?: 'QUEUE' | 'AUTO'; isActive?: boolean },
    user: RequestingUser,
  ) {
    await this.assertSlotOwner(slotId, user);
    if (dto.dayOfWeek !== undefined || dto.hour !== undefined || dto.minute !== undefined) {
      this.assertValidSlot({
        dayOfWeek: dto.dayOfWeek ?? 0,
        hour: dto.hour ?? 0,
        minute: dto.minute ?? 0,
      });
    }
    return this.prisma.socialRecurringSlot.update({
      where: { id: slotId },
      data: dto,
    });
  }

  async deleteSlot(slotId: string, user: RequestingUser) {
    await this.assertSlotOwner(slotId, user);
    await this.prisma.socialRecurringSlot.delete({ where: { id: slotId } });
    return { ok: true };
  }

  // ─── Defaults bootstrap ────────────────────────────────────

  /**
   * Site icin plan-bazli default slot'lari kurar. Mevcut slot'lar varsa
   * (`replace=false`) yenisi eklenmez. `replace=true` ise tum slot'lari siler ve
   * plan default'unu yazar.
   *
   * Default kanal: site'in `isDefault=true, isActive=true` X_TWITTER kanali.
   * Yoksa ilk aktif X kanali; o da yoksa ilk aktif kanal.
   */
  async seedDefaults(siteId: string, opts: { replace?: boolean } = {}, user: RequestingUser) {
    const site = await this.assertSiteOwner(siteId, user);
    const channel = await this.pickPrimaryChannel(siteId);
    if (!channel) {
      throw new BadRequestException(
        'Otomatik takvim icin once en az bir aktif sosyal kanal baglamalisin.',
      );
    }

    const config = getPlanSocialConfig(site.user.plan);

    if (opts.replace) {
      await this.prisma.socialRecurringSlot.deleteMany({
        where: { channel: { siteId } },
      });
    }

    const existing = await this.prisma.socialRecurringSlot.findMany({
      where: { channelId: channel.id },
    });

    if (existing.length >= config.postsPerWeek && !opts.replace) {
      // Zaten yeterli slot var.
      return { created: 0, channelId: channel.id, total: existing.length };
    }

    const created: WeeklySlot[] = [];
    for (const slot of config.slots) {
      const dup = existing.find(
        (e) => e.dayOfWeek === slot.dayOfWeek && e.hour === slot.hour && e.minute === slot.minute,
      );
      if (dup) continue;
      await this.prisma.socialRecurringSlot.create({
        data: {
          channelId: channel.id,
          dayOfWeek: slot.dayOfWeek,
          hour: slot.hour,
          minute: slot.minute,
          timezone: config.timezone,
          source: 'QUEUE',
          isActive: true,
        },
      });
      created.push(slot);
    }
    this.log.log(
      `[${siteId}] seedDefaults plan=${site.user.plan} channel=${channel.id} created=${created.length}`,
    );
    return { created: created.length, channelId: channel.id, total: existing.length + created.length };
  }

  /**
   * Site'in birincil kanalini sec: default & aktif > aktif > ilk.
   * Tercihen X_TWITTER kanali (auto-publish ilk olarak X icin kuruldu).
   */
  private async pickPrimaryChannel(siteId: string) {
    const channels = await this.prisma.socialChannel.findMany({
      where: { siteId },
      orderBy: [{ isDefault: 'desc' }, { isActive: 'desc' }, { createdAt: 'asc' }],
    });
    if (channels.length === 0) return null;
    const x = channels.find((c) => c.type === 'X_TWITTER' && c.isActive);
    if (x) return x;
    const active = channels.find((c) => c.isActive);
    return active ?? channels[0];
  }

  private assertValidSlot(slot: { dayOfWeek: number; hour: number; minute: number }) {
    if (slot.dayOfWeek < 0 || slot.dayOfWeek > 6) throw new BadRequestException('dayOfWeek 0-6 olmali');
    if (slot.hour < 0 || slot.hour > 23) throw new BadRequestException('hour 0-23 olmali');
    if (slot.minute < 0 || slot.minute > 59) throw new BadRequestException('minute 0-59 olmali');
  }

  private async assertWithinPlanLimit(siteId: string, extraSlotForChannelId?: string) {
    const site = await this.prisma.site.findUniqueOrThrow({
      where: { id: siteId },
      include: { user: { select: { plan: true } } },
    });
    const config = getPlanSocialConfig(site.user.plan);
    const current = await this.prisma.socialRecurringSlot.count({
      where: { channel: { siteId }, isActive: true },
    });
    // extraSlotForChannelId verildiyse "yeni slot eklenecek" sayilir
    const projected = current + (extraSlotForChannelId ? 1 : 0);
    if (projected > config.postsPerWeek) {
      throw new BadRequestException(
        `${site.user.plan} plani haftada ${config.postsPerWeek} post hakki veriyor. Daha fazlasi icin plan yukselt.`,
      );
    }
  }
}
