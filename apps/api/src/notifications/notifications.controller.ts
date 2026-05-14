import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { NotificationsService } from './notifications.service.js';

function ensureUser(req: Request) {
  const user = (req as any).user;
  if (!user) throw new UnauthorizedException();
  return user as { id: string; role: 'USER' | 'ADMIN' | 'AGENCY_OWNER' };
}

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@Req() req: Request, @Query('unread') unread?: string, @Query('type') type?: string, @Query('limit') limit?: string, @Query('cursor') cursor?: string) {
    return this.notifications.list(ensureUser(req), {
      unreadOnly: unread === '1' || unread === 'true',
      type,
      limit: limit ? parseInt(limit, 10) : undefined,
      cursor,
    });
  }

  @Get('unread-count')
  unread(@Req() req: Request) {
    return this.notifications.unreadCount(ensureUser(req));
  }

  @Patch(':id/read')
  markRead(@Req() req: Request, @Param('id') id: string) {
    return this.notifications.markAsRead(id, ensureUser(req));
  }

  @Post('read-all')
  readAll(@Req() req: Request) {
    return this.notifications.markAllAsRead(ensureUser(req));
  }

  @Delete(':id')
  remove(@Req() req: Request, @Param('id') id: string) {
    return this.notifications.delete(id, ensureUser(req));
  }
}
