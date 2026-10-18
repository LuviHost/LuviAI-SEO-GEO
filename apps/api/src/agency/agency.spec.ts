import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, ConflictException, ForbiddenException, ValidationPipe } from '@nestjs/common';
import { InviteClientDto, WhitelabelDto } from './agency.dto.js';
import { AgencyService } from './agency.service.js';
import { AgencyController } from './agency.controller.js';

const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const asBody = (metatype: any) => ({ type: 'body' as const, metatype, data: '' });

/** Panel formunun gonderdigi govde (bos alanlar '') */
const panelForm = { enabled: false, brandName: '', logoUrl: '', primaryColor: '#6c5ce7', domain: '', emailFrom: '' };

function fakePrisma(role: string, opts: { domainOwner?: string } = {}) {
  const update = vi.fn(async ({ data, select }: any) => ({ id: 'u1', ...data, __select: select }));
  return {
    update,
    prisma: {
      user: {
        findUniqueOrThrow: vi.fn(async () => ({ id: 'u1', role })),
        findFirst: vi.fn(async ({ where }: any) => (opts.domainOwner && where.whitelabelDomain ? { id: opts.domainOwner } : null)),
        update,
      },
    } as any,
  };
}

describe('whitelabel govdesi — sinif DTO', () => {
  it('panel formu (bos alanlarla) gecer', async () => {
    await expect(pipe.transform(panelForm, asBody(WhitelabelDto))).resolves.toBeDefined();
    await expect(pipe.transform({ ...panelForm, enabled: true, brandName: 'Webmasters Ajansı', logoUrl: 'https://ajans.com.tr/logo.png', domain: 'ai.ajans.com.tr', emailFrom: 'noreply@ajans.com.tr' }, asBody(WhitelabelDto))).resolves.toBeDefined();
  });

  it('rol/plan gibi bilinmeyen alan, javascript: logo, bozuk renk ve sema/yol iceren alan adi 400', async () => {
    await expect(pipe.transform({ ...panelForm, role: 'ADMIN' }, asBody(WhitelabelDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ ...panelForm, logoUrl: 'javascript:alert(1)' }, asBody(WhitelabelDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ ...panelForm, logoUrl: 'http://ajans.com.tr/logo.png' }, asBody(WhitelabelDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ ...panelForm, primaryColor: 'red;background:url(x)' }, asBody(WhitelabelDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ ...panelForm, domain: 'https://ajans.com.tr/panel' }, asBody(WhitelabelDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ ...panelForm, enabled: 'true' }, asBody(WhitelabelDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ email: 'x' }, asBody(InviteClientDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ email: 'musteri@ornek.com', parentAgencyId: 'u9' }, asBody(InviteClientDto))).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('whitelabel servisi', () => {
  it('ajans olmayan kullanici yazamaz', async () => {
    const { prisma, update } = fakePrisma('USER');
    await expect(new AgencyService(prisma).updateWhitelabel('u1', { domain: 'ranksup.ai', enabled: true })).rejects.toBeInstanceOf(ForbiddenException);
    expect(update).not.toHaveBeenCalled();
  });

  it('baska hesaptaki alan adi alinamaz', async () => {
    const { prisma, update } = fakePrisma('AGENCY_OWNER', { domainOwner: 'u9' });
    await expect(new AgencyService(prisma).updateWhitelabel('u1', { domain: 'ai.ajans.com.tr' })).rejects.toBeInstanceOf(ConflictException);
    expect(update).not.toHaveBeenCalled();
  });

  it('alanlar tek tek yazilir, bos dize temizler, alan adi kucuk harf; cevap yalniz whitelabel alanlari', async () => {
    const { prisma, update } = fakePrisma('AGENCY_OWNER');
    await new AgencyService(prisma).updateWhitelabel('u1', { ...panelForm, enabled: true, brandName: ' Ajans ', domain: 'AI.Ajans.com.tr', role: 'ADMIN' } as any);
    const args = update.mock.calls[0][0];
    expect(args.data).toEqual({
      whitelabelEnabled: true,
      whitelabelBrandName: 'Ajans',
      whitelabelLogoUrl: null,
      whitelabelPrimaryColor: '#6c5ce7',
      whitelabelEmailFrom: null,
      whitelabelDomain: 'ai.ajans.com.tr',
    });
    expect(args.select.paytrUtoken).toBeUndefined();
    expect(args.select.role).toBeUndefined();
    expect(Object.keys(args.select).every((k) => k === 'id' || k.startsWith('whitelabel'))).toBe(true);
  });

  it('controller govdeyi yaymaz', async () => {
    const updateWhitelabel = vi.fn(async () => ({}));
    const ctl = new AgencyController({ updateWhitelabel } as any);
    await ctl.whitelabel({ user: { id: 'u1' } } as any, { ...panelForm, role: 'ADMIN', plan: 'ENTERPRISE' } as any);
    expect(Object.keys((updateWhitelabel.mock.calls[0] as any)[1]).sort()).toEqual(['brandName', 'domain', 'emailFrom', 'enabled', 'logoUrl', 'primaryColor']);
  });
});

describe('resolve-domain (herkese acik)', () => {
  it('dize olmayan host (?host[not]=x) Prisma filtresine gitmez', async () => {
    const findFirst = vi.fn(async () => ({ whitelabelBrandName: 'X' }));
    const svc = new AgencyService({ user: { findFirst } } as any);
    await expect(svc.resolveDomain({ not: 'x' } as any)).resolves.toBeNull();
    await expect(svc.resolveDomain(['a.com', 'b.com'] as any)).resolves.toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
    await svc.resolveDomain('AI.Ajans.com.tr');
    // Rol kapisindan once herhangi bir kullanicinin yazdigi eski kayit markayi ele gecirmesin
    expect((findFirst.mock.calls[0] as any)[0].where).toEqual({ whitelabelDomain: 'ai.ajans.com.tr', whitelabelEnabled: true, role: { in: ['AGENCY_OWNER', 'ADMIN'] } });
    expect((findFirst.mock.calls[0] as any)[0].orderBy).toEqual({ createdAt: 'asc' });
  });
});
