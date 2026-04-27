import { Global, Module } from '@nestjs/common';
import { EmailService } from './email.service.js';
import { EmailCron } from './email.cron.js';

/**
 * Email outbound — Resend.com ile.
 * Global module — tüm modüllerden EmailService inject edilebilir.
 */
@Global()
@Module({
  providers: [EmailService, EmailCron],
  exports: [EmailService],
})
export class EmailModule {}
