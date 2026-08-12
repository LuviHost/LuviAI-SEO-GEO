import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller.js';
import { ChatService } from './chat.service.js';
import { McpModule } from '../mcp/mcp.module.js';

/**
 * RanksUp Chat — panel ici asistan + skill katalogu.
 * Tool seti McpModule'den gelir (MCP server ile tek kaynak).
 */
@Module({
  imports: [McpModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
