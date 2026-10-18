import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { SendChatMessageDto } from './chat.dto.js';
import { ChatController } from './chat.controller.js';
import { ChatService } from './chat.service.js';

const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const asBody = (metatype: any) => ({ type: 'body' as const, metatype, data: '' });

describe('chat mesaj govdesi', () => {
  it('nesne conversationId (Prisma filtresi) ve bilinmeyen alan 400', async () => {
    await expect(pipe.transform({ conversationId: { not: '' }, message: 'merhaba' }, asBody(SendChatMessageDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ message: 'merhaba', userId: 'baskasi' }, asBody(SendChatMessageDto))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('panel govdesi gecer', async () => {
    await expect(pipe.transform({ conversationId: 'c1', message: 'merhaba' }, asBody(SendChatMessageDto))).resolves.toBeDefined();
    await expect(pipe.transform({ skill: 'weekly-plan' }, asBody(SendChatMessageDto))).resolves.toBeDefined();
  });

  it('controller yalniz uc alani gecirir; kullanici kimligi oturumdan', async () => {
    const sendMessage = vi.fn(async () => ({}));
    const ctl = new ChatController({ sendMessage } as any);
    await ctl.send('s1', { user: { id: 'u1', role: 'USER', plan: 'PRO' } } as any, { message: 'x', userId: 'baskasi', plan: 'ENTERPRISE' } as any);
    const [, user, input] = sendMessage.mock.calls[0] as any;
    expect(user).toEqual({ id: 'u1', role: 'USER', plan: 'PRO' });
    expect(Object.keys(input).sort()).toEqual(['conversationId', 'message', 'skill']);
  });

  it('servis: pipe atlansa da dize olmayan conversationId sorguya gitmez', async () => {
    const findFirst = vi.fn(async () => ({ id: 'c-baska' }));
    const prisma = {
      site: { findUniqueOrThrow: vi.fn(async () => ({ id: 's1', name: 'S', url: 'https://s.com' })) },
      chatConversation: { findFirst },
    } as any;
    const svc = new ChatService(prisma, { getBoolean: vi.fn(async () => false) } as any, { listForUser: () => [] } as any);
    await expect(svc.sendMessage('s1', { id: 'u1', role: 'USER', plan: 'PRO' } as any, { conversationId: { not: '' } as any, message: 'merhaba' }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(findFirst).not.toHaveBeenCalled();
  });
});
