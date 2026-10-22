import { Controller, Delete, Get, Param, Patch, Post, Query, Req, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { NotificationsService } from './notifications.service.js';
import { TrialReadOnlyExempt } from '../billing/trial-read-only.decorator.js';

function ensureUser(req: Request) {
  const user = (req as any).user;
  if (!user) throw new UnauthorizedException();
  return user as { id: string; role: 'USER' | 'ADMIN' | 'AGENCY_OWNER' };
}

// Suresi dolan deneme (salt okunur, TrialExpiryGuard): okundu isareti yapay zeka eylemi degil; salt okunur hesapta da calisir
@TrialReadOnlyExempt()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@Req() req: Request, @Query('unread') unread?: string, @Query('type') type?: string, @Query('limit') limit?: string, @Query('cursor') cursor?: string) {
    // Sorgu ayristirici ?type[not]=x'i nesneye cevirir; Prisma'ya yalniz dize gitsin
    const n = limit ? parseInt(limit, 10) : NaN;
    return this.notifications.list(ensureUser(req), {
      unreadOnly: unread === '1' || unread === 'true',
      type: typeof type === 'string' && type ? type : undefined,
      limit: Number.isFinite(n) ? n : undefined,
      cursor: typeof cursor === 'string' && cursor ? cursor : undefined,
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
