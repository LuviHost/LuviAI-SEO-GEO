import { Module } from '@nestjs/common';
import { McpController } from './mcp.controller.js';
import { McpWellKnownController } from './mcp-well-known.controller.js';
import { McpToolsService } from './mcp-tools.service.js';
import { AuditModule } from '../audit/audit.module.js';
import { ActionPlansModule } from '../action-plans/action-plans.module.js';

/**
 * RanksUp MCP — kullanicinin kendi AI istemcisinden (bugun ozel baslik
 * gonderebilenler: Claude Code, Cursor; ChatGPT OAuth istedigi icin henuz yok)
 * RanksUp verisini sorgulamasi. Tool registry ChatModule ile paylasilir (tek kaynak).
 *
 * Rakip MCP'lerinden farki: ASO yuzeyi de var (list_tracked_apps,
 * get_app_keywords, get_app_reviews_summary) — web + mobil tek sunucuda.
 */
@Module({
  imports: [AuditModule, ActionPlansModule],
  // McpWellKnownController: RFC 9728 metadatasi kokte (main.ts onek istisnasi)
  controllers: [McpController, McpWellKnownController],
  providers: [McpToolsService],
  exports: [McpToolsService],
})
export class McpModule {}
