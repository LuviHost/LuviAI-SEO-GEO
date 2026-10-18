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
    if (typeof args.body !== 'string' || args.body.trim().length < 10) throw new BadRequestException('Yorum en az 10 karakter olmalı');
    if (args.body.length > 500) throw new BadRequestException('Yorum 500 karakteri geçemez');
    if (!Number.isInteger(args.rating) || args.rating < 1 || args.rating > 5) throw new BadRequestException('Puan 1-5 arası olmalı');

    // siteId govdeden gelir: baska kullanicinin sitesine yorum baglanmasin.
    // Siteye ait degilse kayit reddedilir (sessizce dusurmek yorumu yanlis
    // siteyle ya da sitesiz yayinlardi).
    let siteId: string | undefined;
    if (args.siteId !== undefined && args.siteId !== null && args.siteId !== '') {
      const own = typeof args.siteId === 'string'
        ? await this.prisma.site.findFirst({ where: { id: args.siteId, userId: args.userId }, select: { id: true } })
        : null;
      if (!own) throw new ForbiddenException('Bu site sana ait değil');
      siteId = own.id;
    }

    // Aynı user'ın son 24 saat içinde 3'ten fazla yorum atmasını engelle (spam)
    const recent = await this.prisma.testimonial.count({
      where: { userId: args.userId, createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } },
    });
    if (recent >= 3) throw new BadRequestException('Çok fazla yorum gönderdin, yarın tekrar dene');

    return this.prisma.testimonial.create({
      data: {
        userId: args.userId,
        siteId,
        rating: args.rating,
        body: args.body.trim(),
        role: typeof args.role === 'string' ? args.role.trim().slice(0, 80) : undefined,
        company: typeof args.company === 'string' ? args.company.trim().slice(0, 120) : undefined,
        metric: typeof args.metric === 'string' ? args.metric.trim().slice(0, 120) : undefined,
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
    // user info için ek query — yalnızca panel kullanıcısına bağlı kayıtlar için
    const userIds = [...new Set(rows.map((r) => r.userId).filter((id): id is string => !!id))];
    const users = userIds.length > 0 ? await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, email: true },
    }) : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    return rows.map((r) => {
      const u = r.userId ? userMap.get(r.userId) : undefined;
      // authorName doluysa (dışarıdan alınan referans) kısaltma UYGULANMAZ:
      // kişi adının tam haliyle yayınlanmasına zaten onay vermiş demektir.
      const displayName = r.authorName
        ? r.authorName
        : (r.role && r.company ? makeAnonName(u?.name ?? u?.email ?? '') : (u?.name ?? 'Kullanıcı'));
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
    const userIds = [...new Set(rows.map((r) => r.userId).filter((id): id is string => !!id))];
    const users = userIds.length > 0 ? await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, email: true },
    }) : [];
    const userMap = new Map(users.map((u) => [u.id, u]));
    return rows.map((r) => ({
      ...r,
      user: r.userId ? (userMap.get(r.userId) ?? null) : null,
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
