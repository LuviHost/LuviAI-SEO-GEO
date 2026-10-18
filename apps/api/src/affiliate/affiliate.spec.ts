import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, ForbiddenException, ValidationPipe } from '@nestjs/common';
import { AttributeAffiliateDto, EnrollAffiliateDto } from './affiliate.dto.js';
import { AffiliateController } from './affiliate.controller.js';

const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const asBody = (metatype: any) => ({ type: 'body' as const, metatype, data: '' });

describe('ortaklik govdeleri', () => {
  it('nesne kimlik (Prisma filtresi) ve bilinmeyen alan 400', async () => {
    await expect(pipe.transform({ userId: { not: '' } }, asBody(EnrollAffiliateDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ userId: 'u1', commissionPct: 90 }, asBody(EnrollAffiliateDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ userId: 'u1', refCode: { not: '' } }, asBody(AttributeAffiliateDto))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('panel ve NextAuth govdeleri gecer', async () => {
    await expect(pipe.transform({ userId: 'u1' }, asBody(EnrollAffiliateDto))).resolves.toBeDefined();
    await expect(pipe.transform({ userId: 'u1', refCode: 'ayse-k1x2' }, asBody(AttributeAffiliateDto))).resolves.toBeDefined();
  });

  it('enroll: govdesiz istek oturum sahibini kaydeder, baskasi adina kayit 403', async () => {
    const enroll = vi.fn(async () => ({ refCode: 'r' }));
    const ctl = new AffiliateController({ enroll } as any);
    await ctl.enroll({ user: { id: 'u1', role: 'USER' } } as any, {});
    expect(enroll).toHaveBeenCalledWith('u1');
    expect(() => ctl.enroll({ user: { id: 'u1', role: 'USER' } } as any, { userId: 'u2' })).toThrow(ForbiddenException);
  });
});
