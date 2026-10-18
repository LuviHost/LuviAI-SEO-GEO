import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, NotFoundException, ValidationPipe } from '@nestjs/common';
import { SESSION_ONLY_KEY } from '../auth/session-only.decorator.js';
import { CreateApiKeyDto } from './api-keys.dto.js';
import { ApiKeysController } from './api-keys.controller.js';
import { ApiKeysService, DEFAULT_RATE_LIMIT } from './api-keys.service.js';

const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const asBody = (metatype: any) => ({ type: 'body' as const, metatype, data: '' });

function svcWith(captured: { data?: any }) {
  return new ApiKeysService({
    apiKey: {
      create: async ({ data }: any) => {
        captured.data = data;
        return { ...data, id: 'k1', createdAt: new Date() };
      },
    },
  } as never);
}

describe('API anahtari uretimi — yetki yukseltme ve govde', () => {
  it('anahtar uretme ve iptal yalniz panel oturumuyla (API anahtari 403 alir)', () => {
    expect(Reflect.getMetadata(SESSION_ONLY_KEY, ApiKeysController.prototype.create)).toBe(true);
    expect(Reflect.getMetadata(SESSION_ONLY_KEY, ApiKeysController.prototype.revoke)).toBe(true);
    // listeleme anahtarla da okunabilir
    expect(Reflect.getMetadata(SESSION_ONLY_KEY, ApiKeysController.prototype.list)).toBeUndefined();
  });

  it('bilinmeyen alan (userId/keyHash), yanlis tip, gecmis tarih ve gevsek tavan 400', async () => {
    await expect(pipe.transform({ name: 'x', userId: 'baskasi' }, asBody(CreateApiKeyDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ name: 'x', keyHash: 'h' }, asBody(CreateApiKeyDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ name: { set: 'x' } }, asBody(CreateApiKeyDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ name: 'x', expiresInDays: -5 }, asBody(CreateApiKeyDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ name: 'x', expiresInDays: 1e12 }, asBody(CreateApiKeyDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ name: 'x', rateLimit: 1_000_000 }, asBody(CreateApiKeyDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ name: 'x', scopes: 'sites:write' }, asBody(CreateApiKeyDto))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('panel govdesi gecer', async () => {
    await expect(pipe.transform({ name: 'Zapier', scopes: ['sites:read', 'articles:write'] }, asBody(CreateApiKeyDto))).resolves.toBeDefined();
  });

  it('servis son kapi: tavan varsayilanin ustune cikmaz, gecersiz sure reddedilir', async () => {
    const cap: { data?: any } = {};
    await svcWith(cap).create('u1', { name: ' Zapier ', rateLimit: 1_000_000 });
    expect(cap.data.rateLimit).toBe(DEFAULT_RATE_LIMIT);
    expect(cap.data.name).toBe('Zapier');
    await svcWith(cap).create('u1', { name: 'x', rateLimit: 10 });
    expect(cap.data.rateLimit).toBe(10);
    await expect(svcWith(cap).create('u1', { name: 'x', expiresInDays: -1 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svcWith(cap).create('u1', { name: '   ' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('controller govdeyi yaymaz', async () => {
    const create = vi.fn(async () => ({}));
    const ctl = new ApiKeysController({ create } as any, { enforcePlanFeature: vi.fn(async () => undefined) } as any);
    await ctl.create({ user: { id: 'u1' } } as any, { name: 'x', userId: 'baskasi' } as any);
    expect((create.mock.calls[0] as any)[0]).toBe('u1');
    expect((create.mock.calls[0] as any)[1]).not.toHaveProperty('userId');
  });
});

describe('API anahtari iptali', () => {
  it('baskasinin anahtari 404; cevapta keyHash/userId yok', async () => {
    const update = vi.fn(async (args: any) => ({ id: 'k1', revokedAt: new Date(), __select: args.select }));
    const svc = new ApiKeysService({
      apiKey: {
        findUnique: vi.fn(async ({ where }: any) => (where.id === 'k1' ? { id: 'k1', userId: 'u1' } : null)),
        update,
      },
    } as never);
    await expect(svc.revoke('u2', 'k1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.revoke('u1', 'yok')).rejects.toBeInstanceOf(NotFoundException);
    expect(update).not.toHaveBeenCalled();
    await svc.revoke('u1', 'k1');
    const select = (update.mock.calls[0] as any)[0].select;
    expect(select.keyHash).toBeUndefined();
    expect(select.userId).toBeUndefined();
    expect(select.revokedAt).toBe(true);
  });
});
