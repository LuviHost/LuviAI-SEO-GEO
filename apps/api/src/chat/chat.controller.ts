import { Body, Controller, Delete, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ChatService } from './chat.service.js';
import { SendChatMessageDto } from './chat.dto.js';
import { SessionOnly } from '../auth/session-only.decorator.js';

/**
 * Panel sohbeti — YALNIZ panel oturumuyla (@SessionOnly, sinif duzeyinde:
 * AuthGuard getAllAndOverride ile handler ve sinifi birlikte okur).
 *
 * NEDEN: 'chat' scope haritasinda yok (api-keys.service ROUTE_RESOURCE);
 * AuthGuard bilinmeyen kaynakta mutasyon icin HERHANGI bir ':write' anahtarini
 * yeterli sayiyor, GET'i ise hic denetlemiyordu. POST .../chat/messages
 * modelin MCP araclarini (run_audit, run_prompt, create_article,
 * generate_article_from_opportunity...) kullanicinin adina kaynak scope'u
 * denetlenmeden calistirmasina yol aciyordu: yalniz 'social:write' tasiyan bir
 * anahtar denetim baslatip makale kotasi ve olcum hakki harcayabiliyordu (MCP
 * ucunda ayni arac audit:write / articles:write ister — inceleme R21). Sohbeti
 * yalniz web paneli kullanir (apps/web/src/lib/api.ts); SDK, mobil uygulama ve
 * MCP bu uclari cagirmiyor. Gecmis okuma ve silme de anahtara acik kalmasin
 * diye kural tum denetleyiciye uygulanir.
 */
@SessionOnly()
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
    @Body() body: SendChatMessageDto,
  ) {
    const user = (req as any).user;
    return this.chat.sendMessage(siteId, { id: user.id, role: user.role, plan: user.plan }, {
      conversationId: body.conversationId,
      message: body.message,
      skill: body.skill,
    });
  }
}
