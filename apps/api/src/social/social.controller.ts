import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req, Res, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../auth/public.decorator.js';
import { SocialChannelsService } from './social-channels.service.js';
import { SocialPostsService } from './social-posts.service.js';
import { SocialSlotsService } from './social-slots.service.js';
import { SocialCalendarService } from './social-calendar.service.js';
import { SocialMediaGeneratorService } from './social-media-generator.service.js';
import { MEDIA_POLICY, type MediaType } from './social-media-policy.js';

function ensureUser(req: Request) {
  const user = (req as any).user;
  if (!user) throw new UnauthorizedException();
  return user as { id: string; role: 'USER' | 'ADMIN' | 'AGENCY_OWNER' };
}

@Controller()
export class SocialController {
  constructor(
    private readonly channels: SocialChannelsService,
    private readonly posts: SocialPostsService,
    private readonly slots: SocialSlotsService,
    private readonly calendar: SocialCalendarService,
    private readonly mediaGen: SocialMediaGeneratorService,
  ) {}

  // ─── Catalog ─────────────────────────────────────────

  @Public()
  @Get('social/catalog')
  catalog() {
    return SocialChannelsService.getCatalog();
  }

  // ─── Channels (site bazli) ──────────────────────────

  @Get('sites/:siteId/social/channels')
  list(@Req() req: Request, @Param('siteId') siteId: string) {
    return this.channels.list(siteId, ensureUser(req));
  }

  @Patch('social/channels/:channelId')
  update(
    @Req() req: Request,
    @Param('channelId') channelId: string,
    @Body() body: { name?: string; isActive?: boolean; isDefault?: boolean; config?: any },
  ) {
    return this.channels.update(channelId, body, ensureUser(req));
  }

  @Delete('social/channels/:channelId')
  remove(@Req() req: Request, @Param('channelId') channelId: string) {
    return this.channels.remove(channelId, ensureUser(req));
  }

  // ─── LinkedIn org seçimi (LINKEDIN_COMPANY için) ────

  @Get('social/channels/:channelId/linkedin/pages')
  listLinkedInPages(@Req() req: Request, @Param('channelId') channelId: string) {
    return this.channels.listLinkedInPages(channelId, ensureUser(req));
  }

  @Patch('social/channels/:channelId/linkedin/page')
  setLinkedInPage(
    @Req() req: Request,
    @Param('channelId') channelId: string,
    @Body() body: { organizationUrn: string; organizationName: string },
  ) {
    return this.channels.setLinkedInPage(channelId, body.organizationUrn, body.organizationName, ensureUser(req));
  }

  // ─── OAuth ──────────────────────────────────────────

  @Get('sites/:siteId/social/:type/oauth/start')
  oauthStart(@Req() req: Request, @Param('siteId') siteId: string, @Param('type') type: string) {
    ensureUser(req); // ownership: state'te siteId tasiniyor; UI auth gecerli
    return this.channels.buildAuthUrl(siteId, type);
  }

  @Public()
  @Get('social/oauth/callback')
  async oauthCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    const result = await this.channels.handleCallback(code, state);
    return res.redirect(
      `${process.env.WEB_BASE_URL}/sites/${result.siteId}?step=social&social=connected&channel=${result.channelId}`,
    );
  }

  // ─── Posts ──────────────────────────────────────────

  @Get('sites/:siteId/social/posts')
  listPosts(
    @Req() req: Request,
    @Param('siteId') siteId: string,
    @Query('channelId') channelId?: string,
    @Query('status') status?: string,
  ) {
    return this.posts.list(siteId, { channelId, status }, ensureUser(req));
  }

  @Post('social/posts')
  createPost(
    @Req() req: Request,
    @Body() body: {
      channelId: string;
      text: string;
      mediaUrls?: any[];
      metadata?: any;
      scheduledFor?: string | null;
      articleId?: string;
      status?: 'DRAFT' | 'QUEUED';
    },
  ) {
    return this.posts.create(body, ensureUser(req));
  }

  @Patch('social/posts/:postId')
  updatePost(
    @Req() req: Request,
    @Param('postId') postId: string,
    @Body() body: any,
  ) {
    return this.posts.update(postId, body, ensureUser(req));
  }

  @Delete('social/posts/:postId')
  removePost(@Req() req: Request, @Param('postId') postId: string) {
    return this.posts.remove(postId, ensureUser(req));
  }

  @Post('social/posts/:postId/publish-now')
  publishNow(@Req() req: Request, @Param('postId') postId: string) {
    return this.posts.publishNow(postId, ensureUser(req));
  }

  // ─── Medya politikası + generation ─────────────────

  /** Channel.type için izinli medya tiplerini ve varsayılanı döner. */
  @Get('social/media-policy')
  mediaPolicy() {
    return MEDIA_POLICY;
  }

  /** Bir post için medya (image/video) üretir. mediaType opsiyonel; verilmezse mevcut tip kullanılır. */
  @Post('social/posts/:postId/generate-media')
  async generateMedia(
    @Req() req: Request,
    @Param('postId') postId: string,
    @Body() body: { mediaType?: MediaType },
  ) {
    ensureUser(req);
    return this.mediaGen.generateForPost(postId, body?.mediaType);
  }

  /** DRAFT → QUEUED. scheduledFor body'den (yoksa hemen yayına). */
  @Post('social/posts/:postId/approve')
  async approvePost(
    @Req() req: Request,
    @Param('postId') postId: string,
    @Body() body: { scheduledFor?: string },
  ) {
    return this.posts.approve(postId, ensureUser(req), body?.scheduledFor ? new Date(body.scheduledFor) : undefined);
  }

  // ─── Calendar / scheduling ──────────────────────────

  @Get('sites/:siteId/social/calendar')
  calendarOverview(
    @Req() req: Request,
    @Param('siteId') siteId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.calendar.getOverview(
      siteId,
      {
        from: from ? new Date(from) : undefined,
        to: to ? new Date(to) : undefined,
      },
      ensureUser(req),
    );
  }

  @Get('sites/:siteId/social/plan')
  planInfo(@Req() req: Request, @Param('siteId') siteId: string) {
    return this.slots.getSitePlanInfo(siteId, ensureUser(req));
  }

  @Get('sites/:siteId/social/slots')
  listSlots(@Req() req: Request, @Param('siteId') siteId: string) {
    return this.slots.listSlots(siteId, ensureUser(req));
  }

  @Post('sites/:siteId/social/slots/seed')
  seedSlots(
    @Req() req: Request,
    @Param('siteId') siteId: string,
    @Body() body: { replace?: boolean } = {},
  ) {
    return this.slots.seedDefaults(siteId, { replace: body.replace }, ensureUser(req));
  }

  @Post('social/channels/:channelId/slots')
  createSlot(
    @Req() req: Request,
    @Param('channelId') channelId: string,
    @Body() body: { dayOfWeek: number; hour: number; minute: number; source?: 'QUEUE' | 'AUTO'; isActive?: boolean },
  ) {
    return this.slots.createSlot(channelId, body, ensureUser(req));
  }

  @Put('social/slots/:slotId')
  updateSlot(
    @Req() req: Request,
    @Param('slotId') slotId: string,
    @Body() body: { dayOfWeek?: number; hour?: number; minute?: number; source?: 'QUEUE' | 'AUTO'; isActive?: boolean },
  ) {
    return this.slots.updateSlot(slotId, body, ensureUser(req));
  }

  @Delete('social/slots/:slotId')
  deleteSlot(@Req() req: Request, @Param('slotId') slotId: string) {
    return this.slots.deleteSlot(slotId, ensureUser(req));
  }
}
