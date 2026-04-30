import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';

import { CrawlerTrackingMiddleware } from './audit/crawler-tracking.middleware.js';
import { AuthModule } from './auth/auth.module.js';
import { AuthGuard } from './auth/auth.guard.js';
import { SiteAccessGuard } from './auth/site-access.guard.js';
import { SitesModule } from './sites/sites.module.js';
import { AuditModule } from './audit/audit.module.js';
import { TopicsModule } from './topics/topics.module.js';
import { ArticlesModule } from './articles/articles.module.js';
import { BillingModule } from './billing/billing.module.js';
import { AdminModule } from './admin/admin.module.js';
import { JobsModule } from './jobs/jobs.module.js';
import { AnalyticsModule } from './analytics/analytics.module.js';
import { EmailModule } from './email/email.module.js';
import { AffiliateModule } from './affiliate/affiliate.module.js';
import { MeModule } from './me/me.module.js';
import { PublishTargetsModule } from './publish-targets/publish-targets.module.js';
import { SocialModule } from './social/social.module.js';
import { AdsModule } from './ads/ads.module.js';
import { AgencyModule } from './agency/agency.module.js';
import { ApiKeysModule } from './api-keys/api-keys.module.js';
import { OAuthModule } from './oauth/oauth.module.js';
import { SettingsModule } from './settings/settings.module.js';
import { VideosModule } from './videos/videos.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{
      ttl: parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? '60000', 10),
      limit: parseInt(process.env.RATE_LIMIT_MAX ?? '60', 10),
    }]),
    PrismaModule,
    AuthModule,
    SitesModule,
    AuditModule,
    TopicsModule,
    ArticlesModule,
    BillingModule,
    AdminModule,
    JobsModule,
    AnalyticsModule,
    EmailModule,
    AffiliateModule,
    MeModule,
    PublishTargetsModule,
    SocialModule,
    AdsModule,
    AgencyModule,
    ApiKeysModule,
    OAuthModule,
    SettingsModule,
    VideosModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: SiteAccessGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Tum API request'lerini AI bot tracking icin gec
    consumer.apply(CrawlerTrackingMiddleware).forRoutes('*');
  }
}
