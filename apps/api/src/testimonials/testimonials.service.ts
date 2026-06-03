import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class TestimonialsService {
  constructor(private readonly prisma: PrismaService) {}

  /** User dashboard'dan yorum bırakır (admin onayına düşer) */
  async submit(args: {
    userId: string;
    siteId?: string;
    rating: number;
    body: string;
    role?: string;
    company?: string;
    metric?: string;
  }) {
    if (!args.body || args.body.length < 10) throw new BadRequestException('Yorum en az 10 karakter olmalı');
    if (args.body.length > 500) throw new BadRequestException('Yorum 500 karakteri geçemez');
    if (args.rating < 1 || args.rating > 5) throw new BadRequestException('Rating 1-5 arası olmalı');

    // Aynı user'ın son 24 saat içinde 3'ten fazla yorum atmasını engelle (spam)
    const recent = await this.prisma.testimonial.count({
      where: { userId: args.userId, createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } },
    });
    if (recent >= 3) throw new BadRequestException('Çok fazla yorum gönderdin, yarın tekrar dene');

    return this.prisma.testimonial.create({
      data: {
        userId: args.userId,
        siteId: args.siteId,
        rating: args.rating,
        body: args.body.trim(),
        role: args.role?.trim().slice(0, 80),
        company: args.company?.trim().slice(0, 120),
        metric: args.metric?.trim().slice(0, 120),
      },
    });
  }

  /** Public: onaylı + featured testimonial'ları landing için döner (max 6) */
  async listPublic(limit = 6) {
    const rows = await this.prisma.testimonial.findMany({
      where: { approved: true, rejected: false },
      orderBy: [{ featured: 'desc' }, { createdAt: 'desc' }],
      take: limit,
    });
    // user info için ek query
    const userIds = [...new Set(rows.map((r) => r.userId))];
    const users = userIds.length > 0 ? await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, email: true },
    }) : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    return rows.map((r) => {
      const u = userMap.get(r.userId);
      const displayName = r.role && r.company ? makeAnonName(u?.name ?? u?.email ?? '') : (u?.name ?? 'Kullanıcı');
      const initials = (displayName || 'U').trim().split(/\s+/).slice(0, 2).map((s) => s[0]?.toUpperCase() ?? '').join('') || 'U';
      return {
        id: r.id,
        rating: r.rating,
        body: r.body,
        role: r.role,
        company: r.company,
        metric: r.metric,
        displayName,
        initials,
        createdAt: r.createdAt,
      };
    });
  }

  /** Admin: tüm testimonial'ları listele (onaylı/onaysız/reddedilmiş) */
  async listAdmin(filter: 'pending' | 'approved' | 'rejected' | 'all' = 'pending') {
    const where: any = {};
    if (filter === 'pending') { where.approved = false; where.rejected = false; }
    else if (filter === 'approved') { where.approved = true; }
    else if (filter === 'rejected') { where.rejected = true; }

    const rows = await this.prisma.testimonial.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const userIds = [...new Set(rows.map((r) => r.userId))];
    const users = userIds.length > 0 ? await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, email: true },
    }) : [];
    const userMap = new Map(users.map((u) => [u.id, u]));
    return rows.map((r) => ({
      ...r,
      user: userMap.get(r.userId) ?? null,
    }));
  }

  /** Admin: onayla / reddet / featured'a al */
  async moderate(testimonialId: string, action: 'approve' | 'reject' | 'feature' | 'unfeature', adminUserId: string) {
    const t = await this.prisma.testimonial.findUnique({ where: { id: testimonialId } });
    if (!t) throw new NotFoundException('Testimonial bulunamadı');

    if (action === 'approve') {
      return this.prisma.testimonial.update({
        where: { id: testimonialId },
        data: { approved: true, rejected: false, approvedAt: new Date(), approvedBy: adminUserId },
      });
    }
    if (action === 'reject') {
      return this.prisma.testimonial.update({
        where: { id: testimonialId },
        data: { rejected: true, approved: false, approvedAt: null },
      });
    }
    if (action === 'feature') {
      return this.prisma.testimonial.update({
        where: { id: testimonialId },
        data: { featured: true, approved: true, rejected: false, approvedAt: t.approvedAt ?? new Date(), approvedBy: t.approvedBy ?? adminUserId },
      });
    }
    if (action === 'unfeature') {
      return this.prisma.testimonial.update({ where: { id: testimonialId }, data: { featured: false } });
    }
    throw new BadRequestException('Geçersiz action');
  }

  /** Admin: testimonial sil */
  async delete(testimonialId: string) {
    await this.prisma.testimonial.delete({ where: { id: testimonialId } }).catch(() => {
      throw new NotFoundException('Testimonial bulunamadı');
    });
    return { ok: true };
  }
}

function makeAnonName(fullOrEmail: string): string {
  const raw = (fullOrEmail || '').trim();
  if (!raw) return 'Kullanıcı';
  const parts = raw.split(/\s+/);
  if (parts.length === 1) {
    // email ise local-part'ı al
    const local = parts[0].split('@')[0];
    return capitalize(local).slice(0, 12);
  }
  const first = parts[0];
  const lastInit = (parts[parts.length - 1][0] ?? '').toUpperCase();
  return `${capitalize(first)} ${lastInit}.`;
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s;
}
