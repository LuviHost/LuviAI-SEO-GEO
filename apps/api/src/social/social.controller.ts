import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req, Res, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../auth/public.decorator.js';
import { SocialChannelsService } from './social-channels.service.js';
import { SocialPostsService } from './social-posts.service.js';
import { SocialSlotsService } from './social-slots.service.js';
import { SocialCalendarService } from './social-calendar.service.js';
import { SocialMediaGeneratorService } from './social-media-generator.service.js';
import { SocialAutoDraftService } from './social-auto-draft.service.js';
import { MEDIA_POLICY, type MediaType } from './social-media-policy.js';
import { SocialInboxService } from './social-inbox.service.js';
import { SocialMediaLibraryService } from './social-media-library.service.js';
import { SocialIdeaService } from './social-idea.service.js';

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
    private readonly autoDraft: SocialAutoDraftService,
    private readonly inbox: SocialInboxService,
    private readonly mediaLibrary: SocialMediaLibraryService,
    private readonly ideas: SocialIdeaService,
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

  /** DRAFT → QUEUED. scheduledFor body'den (yoksa hemen yayına). NEEDS_APPROVAL flow'unu da kabul eder. */
  @Post('social/posts/:postId/approve')
  async approvePost(
    @Req() req: Request,
    @Param('postId') postId: string,
    @Body() body: { scheduledFor?: string },
  ) {
    return this.posts.approve(postId, ensureUser(req), body?.scheduledFor ? new Date(body.scheduledFor) : undefined);
  }

  /** DRAFT → NEEDS_APPROVAL (takım onayına gönder) */
  @Post('social/posts/:postId/submit-for-approval')
  async submitForApproval(@Req() req: Request, @Param('postId') postId: string) {
    return this.posts.submitForApproval(postId, ensureUser(req));
  }

  /** DRAFT/NEEDS_APPROVAL → REJECTED (sebep opsiyonel) */
  @Post('social/posts/:postId/reject')
  async rejectPost(
    @Req() req: Request,
    @Param('postId') postId: string,
    @Body() body: { reason?: string },
  ) {
    return this.posts.reject(postId, ensureUser(req), body?.reason);
  }

  /**
   * Backfill: son N günde yayınlanmış makaleler için eksik kanallara draft üret.
   * Kanallar sonradan bağlandığında geçmiş makaleler için draft üretmek üzere.
   */
  @Post('sites/:siteId/social/posts/backfill')
  async backfillDrafts(
    @Req() req: Request,
    @Param('siteId') siteId: string,
    @Body() body: { daysAgo?: number },
  ) {
    ensureUser(req);
    return this.autoDraft.backfillForSite(siteId, body?.daysAgo ?? 30);
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

  // ─── Brightbean parity: Inbox (DM/mention/comment) ──────────

  @Get('sites/:siteId/social/inbox')
  inboxList(
    @Req() req: Request,
    @Param('siteId') siteId: string,
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('channelId') channelId?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.inbox.listForSite(siteId, ensureUser(req), {
      status, type, channelId,
      limit: limit ? parseInt(limit, 10) : undefined,
      cursor,
    });
  }

  @Get('sites/:siteId/social/inbox/unread-count')
  inboxUnreadCount(@Req() req: Request, @Param('siteId') siteId: string) {
    return this.inbox.unreadCountForSite(siteId, ensureUser(req));
  }

  @Patch('social/inbox/:messageId/read')
  inboxMarkRead(@Req() req: Request, @Param('messageId') messageId: string) {
    return this.inbox.markAsRead(messageId, ensureUser(req));
  }

  @Post('social/inbox/:messageId/reply')
  inboxReply(@Req() req: Request, @Param('messageId') messageId: string, @Body() body: { reply: string }) {
    return this.inbox.reply(messageId, body.reply, ensureUser(req));
  }

  @Post('social/inbox/:messageId/archive')
  inboxArchive(@Req() req: Request, @Param('messageId') messageId: string) {
    return this.inbox.archive(messageId, ensureUser(req));
  }

  @Post('social/inbox/:messageId/resolve')
  inboxResolve(@Req() req: Request, @Param('messageId') messageId: string) {
    return this.inbox.resolve(messageId, ensureUser(req));
  }

  // ─── Brightbean parity: Media Library ──────────

  @Get('social/media-library')
  mediaList(
    @Req() req: Request,
    @Query('siteId') siteId?: string,
    @Query('folder') folder?: string,
    @Query('source') source?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.mediaLibrary.list(ensureUser(req), {
      siteId, folder, source,
      limit: limit ? parseInt(limit, 10) : undefined,
      cursor,
    });
  }

  @Get('social/media-library/folders')
  mediaFolders(@Req() req: Request, @Query('siteId') siteId?: string) {
    return this.mediaLibrary.folders(ensureUser(req), siteId);
  }

  @Post('social/media-library')
  mediaCreate(@Req() req: Request, @Body() body: any) {
    return this.mediaLibrary.create(ensureUser(req), body);
  }

  @Patch('social/media-library/:assetId')
  mediaUpdate(@Req() req: Request, @Param('assetId') assetId: string, @Body() body: any) {
    return this.mediaLibrary.update(assetId, ensureUser(req), body);
  }

  @Delete('social/media-library/:assetId')
  mediaDelete(@Req() req: Request, @Param('assetId') assetId: string) {
    return this.mediaLibrary.delete(assetId, ensureUser(req));
  }

  // ─── Brightbean parity: Idea Board (kanban) ──────────

  @Get('social/ideas/board')
  ideasBoard(@Req() req: Request, @Query('siteId') siteId?: string) {
    return this.ideas.board(ensureUser(req), siteId);
  }

  @Post('social/ideas')
  ideasCreate(@Req() req: Request, @Body() body: any) {
    return this.ideas.create(ensureUser(req), body);
  }

  @Patch('social/ideas/:ideaId')
  ideasUpdate(@Req() req: Request, @Param('ideaId') ideaId: string, @Body() body: any) {
    return this.ideas.update(ideaId, ensureUser(req), body);
  }

  @Post('social/ideas/:ideaId/move')
  ideasMove(@Req() req: Request, @Param('ideaId') ideaId: string, @Body() body: { column: 'UNASSIGNED' | 'TODO' | 'IN_PROGRESS' | 'DONE'; position: number }) {
    return this.ideas.move(ideaId, ensureUser(req), body);
  }

  @Post('social/ideas/:ideaId/convert')
  ideasConvert(@Req() req: Request, @Param('ideaId') ideaId: string, @Body() body: { channelId: string }) {
    return this.ideas.convertToPost(ideaId, ensureUser(req), body.channelId);
  }

  @Delete('social/ideas/:ideaId')
  ideasDelete(@Req() req: Request, @Param('ideaId') ideaId: string) {
    return this.ideas.delete(ideaId, ensureUser(req));
  }
}
