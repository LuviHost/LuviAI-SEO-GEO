import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { ChatController } from './chat.controller.js';
import { ASSISTANT_OPEN_TO_CUSTOMERS, assistantOpenFor } from './chat-access.js';

describe('Asistan erisimi (18.11.2026: musteriye kapali)', () => {
  it('yalniz yonetici kullanir', () => {
    expect(ASSISTANT_OPEN_TO_CUSTOMERS).toBe(false);
    expect(assistantOpenFor('ADMIN')).toBe(true);
    expect(assistantOpenFor('USER')).toBe(false);
    expect(assistantOpenFor('AGENCY_OWNER')).toBe(false);
    expect(assistantOpenFor(undefined)).toBe(false);
  });

  it('musterinin mesaji model cagrilmadan reddedilir', async () => {
    const chat = { sendMessage: vi.fn(async () => ({ ok: true })) };
    const ctrl = new ChatController(chat as any);
    const req = (role: string) => ({ user: { id: 'u1', role, plan: 'PRO' } }) as any;
    expect(() => ctrl.send('s1', req('USER'), { message: 'merhaba' } as any)).toThrow(ForbiddenException);
    expect(chat.sendMessage).not.toHaveBeenCalled();
    await ctrl.send('s1', req('ADMIN'), { message: 'merhaba' } as any);
    expect(chat.sendMessage).toHaveBeenCalledTimes(1);
  });
});
