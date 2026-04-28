import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthGuard } from './auth.guard.js';
import { SiteAccessGuard } from './site-access.guard.js';
import { GscOAuthService } from './gsc-oauth.service.js';
import { GaOAuthService } from './ga-oauth.service.js';

/**
 * Auth modülü:
 *  - NextAuth.js session validation (web frontend → API arası)
 *  - JWT issuer (mobile/CLI için Faz 3)
 *  - GSC OAuth multi-tenant (her site kendi GSC token'ı verir)
 */
@Module({
  imports: [
    JwtModule.register({
      secret: process.env.NEXTAUTH_SECRET,
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthGuard, SiteAccessGuard, GscOAuthService, GaOAuthService],
  exports: [AuthService, AuthGuard, SiteAccessGuard, GscOAuthService, GaOAuthService],
})
export class AuthModule {}
