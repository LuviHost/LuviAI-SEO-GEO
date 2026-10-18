import { Module } from '@nestjs/common';
import { OAuthController } from './oauth.controller.js';
import { OAuthService } from './oauth.service.js';

/**
 * Faz 11.5 — OAuth popup baglama akisi
 *   - Google Ads: refresh token + customer ID picker
 *   - Meta Ads: long-lived token + ad account + Page + IG Actor picker
 *
 * Env gerekli:
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET   (NextAuth ile paylasimli)
 *   (Google Ads developer token 9 Eylul 2026'da kaldirildi; erisim seviyesi
 *    GOOGLE_CLIENT_ID'nin Cloud projesinden gelir — ads/google-ads-api.ts)
 *   META_APP_ID, META_APP_SECRET
 *   API_BASE_URL, WEB_BASE_URL
 */
@Module({
  controllers: [OAuthController],
  providers: [OAuthService],
  exports: [OAuthService],
})
export class OAuthModule {}
