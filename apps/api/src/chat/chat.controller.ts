import { Body, Controller, Delete, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ChatService } from './chat.service.js';

@Controller('sites/:siteId/chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  /** GET /sites/:siteId/chat/skills — hazir gorev katalogu (plana gore suzulur) */
  @Get('skills')
  skills(@Param('siteId') siteId: string, @Req() req: Request) {
    const user = (req as any).user;
    return this.chat.listSkills(siteId, { id: user.id, role: user.role, plan: user.plan });
  }

  /** GET /sites/:siteId/chat/conversations */
  @Get('conversations')
  conversations(@Param('siteId') siteId: string, @Req() req: Request) {
    const user = (req as any).user;
    return this.chat.listConversations(siteId, user.id);
  }

  /** GET /sites/:siteId/chat/conversations/:id — mesaj gecmisi */
  @Get('conversations/:id')
  conversation(@Param('siteId') siteId: string, @Param('id') id: string, @Req() req: Request) {
    const user = (req as any).user;
    return this.chat.getConversation(siteId, user.id, id);
  }

  /** DELETE /sites/:siteId/chat/conversations/:id */
  @Delete('conversations/:id')
  remove(@Param('siteId') siteId: string, @Param('id') id: string, @Req() req: Request) {
    const user = (req as any).user;
    return this.chat.deleteConversation(siteId, user.id, id);
  }

  /** POST /sites/:siteId/chat/messages — mesaj gonder (skill veya serbest) */
  @Post('messages')
  send(
    @Param('siteId') siteId: string,
    @Req() req: Request,
    @Body() body: { conversationId?: string; message?: string; skill?: string },
  ) {
    const user = (req as any).user;
    return this.chat.sendMessage(siteId, { id: user.id, role: user.role, plan: user.plan }, body);
  }
}
