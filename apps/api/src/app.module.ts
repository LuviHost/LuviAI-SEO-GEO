import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';

// Modules (her biri kendi klasöründe — Faz 1'de iskeleti, içerikleri sonra)
import { AuthModule } from './auth/auth.module.js';
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
  ],
})
export class AppModule {}
