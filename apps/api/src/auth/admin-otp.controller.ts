import { BadRequestException, Body, Controller, ForbiddenException, Headers, Post } from '@nestjs/common';
import { Public } from './public.decorator.js';
import { bodyText } from './auth.controller.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { EmailService } from '../email/email.service.js';
import { ADMIN_OTP_KONU, adminOtpHtml, gecerliOtpKodu } from './admin-otp-mail.js';

/**
 * POST /api/internal/admin-otp-mail
 * Web admin girisi (/admin-unlock) 6 haneli kodu uretir; e-postayi buradan gonderir
 * (bkz. admin-otp-mail.ts). Internal-key ile auth.
 *
 * NEDEN /api/auth altinda DEGIL: nginx /api/auth/* yolunu (gsc, ga, welcome-hook, mobile
 * disinda) web'in NextAuth'una yonlendiriyor; ilk surum /api/auth/admin-otp-mail'deydi ve
 * istek API'ye hic ulasmadi (NextAuth "UnknownAction" → 400, 23.11). /api/* geri kalani API'ye gider.
 * Acik posta rolesi olmasin diye yalniz rolu ADMIN olan, silme talebi olmayan hesaba gider.
 */
@Controller('internal')
export class AdminOtpController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  @Public()
  @Post('admin-otp-mail')
  async adminOtpMail(
    @Headers('x-internal-key') headerKey: string | undefined,
    @Body() body: { email?: string; code?: string },
  ) {
    const expected = process.env.INTERNAL_API_KEY ?? process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? '';
    if (!expected || !headerKey || headerKey !== expected) {
      throw new ForbiddenException('Internal key gecersiz');
    }
    const email = bodyText(body?.email).toLowerCase();
    const code = bodyText(body?.code);
    if (!email || !gecerliOtpKodu(code)) throw new BadRequestException('email ve 6 haneli kod gerekli');

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, role: true, deletionRequestedAt: true },
    });
    if (!user || user.role !== 'ADMIN' || user.deletionRequestedAt) {
      throw new ForbiddenException('Yonetici hesabi degil');
    }
    const r = await this.email.sendRaw({ userId: user.id, to: email, subject: ADMIN_OTP_KONU, html: adminOtpHtml(code) });
    return { ok: r.ok };
  }
}
