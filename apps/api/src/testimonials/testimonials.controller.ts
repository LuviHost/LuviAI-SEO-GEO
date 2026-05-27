import { Body, Controller, Delete, ForbiddenException, Get, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator.js';
import { TestimonialsService } from './testimonials.service.js';

@Controller('testimonials')
export class TestimonialsController {
  constructor(private readonly svc: TestimonialsService) {}

  /** POST /api/testimonials — user yorum bırakır (auth gerek) */
  @Post()
  submit(@Req() req: Request, @Body() body: {
    siteId?: string;
    rating: number;
    body: string;
    role?: string;
    company?: string;
    metric?: string;
  }) {
    const user = (req as any).user;
    if (!user?.id) throw new ForbiddenException('Giriş gerekli');
    return this.svc.submit({ ...body, userId: user.id });
  }

  /** GET /api/testimonials/public — landing için (public, kimlik gerektirmez) */
  @Public()
  @Get('public')
  listPublic(@Query('limit') limit?: string) {
    return this.svc.listPublic(limit ? parseInt(limit, 10) : 6);
  }

  /** GET /api/testimonials/admin?filter=pending|approved|rejected|all */
  @Get('admin')
  listAdmin(@Req() req: Request, @Query('filter') filter?: any) {
    const user = (req as any).user;
    if (!user || user.role !== 'ADMIN') throw new ForbiddenException('Sadece admin');
    return this.svc.listAdmin(filter ?? 'pending');
  }

  /** POST /api/testimonials/:id/moderate — admin */
  @Post(':id/moderate')
  moderate(@Req() req: Request, @Param('id') id: string, @Body() body: { action: 'approve' | 'reject' | 'feature' | 'unfeature' }) {
    const user = (req as any).user;
    if (!user || user.role !== 'ADMIN') throw new ForbiddenException('Sadece admin');
    return this.svc.moderate(id, body.action, user.id);
  }

  /** DELETE /api/testimonials/:id — admin */
  @Delete(':id')
  delete(@Req() req: Request, @Param('id') id: string) {
    const user = (req as any).user;
    if (!user || user.role !== 'ADMIN') throw new ForbiddenException('Sadece admin');
    return this.svc.delete(id);
  }
}
