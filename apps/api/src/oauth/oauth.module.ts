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
 *   GOOGLE_ADS_DEV_TOKEN                     (Ads API icin)
 *   META_APP_ID, META_APP_SECRET
 *   API_BASE_URL, WEB_BASE_URL
 */
@Module({
  controllers: [OAuthController],
  providers: [OAuthService],
  exports: [OAuthService],
})
export class OAuthModule {}
