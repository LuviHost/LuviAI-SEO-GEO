import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { GscOAuthService } from './gsc-oauth.service.js';

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
  providers: [AuthService, GscOAuthService],
  exports: [AuthService, GscOAuthService],
})
export class AuthModule {}
