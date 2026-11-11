import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller.js';
import { ChatService } from './chat.service.js';
import { WeeklyPlanCron } from './weekly-plan.cron.js';
import { McpModule } from '../mcp/mcp.module.js';
import { ActionPlansModule } from '../action-plans/action-plans.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { LLMModule } from '../llm/llm.module.js';

/**
 * RanksUp Chat — panel ici asistan + skill katalogu.
 * Tool seti McpModule'den gelir (MCP server ile tek kaynak).
 *
 * WeeklyPlanCron "Bu haftanin plani" skill'ini Pazartesi sabahi kendisi
 * calistirip Aksiyon Plani + bildirim + e-posta olarak teslim eder;
 * bu yuzden ActionPlans ve Notifications modulleri de buraya baglandi
 * (EmailModule global oldugu icin ayrica import edilmiyor).
 *
 * LLMModule: sohbetin harcamasi ortak deftere ve butce sayacina LLMProviderService
 * uzerinden yazilir (recordDirectUsage). QuotaService (mesaj hakki, AI butcesi) global
 * BillingModule'den gelir.
 */
@Module({
  imports: [McpModule, ActionPlansModule, NotificationsModule, LLMModule],
  controllers: [ChatController],
  providers: [ChatService, WeeklyPlanCron],
})
export class ChatModule {}
