import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, ForbiddenException, ValidationPipe } from '@nestjs/common';
import { ModerateTestimonialDto, SubmitTestimonialDto } from './testimonials.dto.js';
import { TestimonialsController } from './testimonials.controller.js';
import { TestimonialsService } from './testimonials.service.js';

// main.ts ile ayni ayarlar
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const asBody = (metatype: any) => ({ type: 'body' as const, metatype, data: '' });
const reqAs = (user: any) => ({ user }) as any;
const valid = { rating: 5, body: 'RanksUp ile AI görünürlüğümüzü ölçtük.' };

function fakePrisma(opts: { ownSites?: string[] } = {}) {
  const create = vi.fn(async ({ data }: any) => ({ id: 't1', ...data }));
  return {
    create,
    prisma: {
      site: {
        findFirst: vi.fn(async ({ where }: any) => ((opts.ownSites ?? []).includes(where.id) && where.userId === 'u1' ? { id: where.id } : null)),
      },
      testimonial: { count: vi.fn(async () => 0), create },
    } as any,
  };
}

describe('testimonial govdesi — sinif DTO', () => {
  it('bilinmeyen alan (userId/approved), yanlis tip ve aralik disi puan 400', async () => {
    await expect(pipe.transform({ ...valid, userId: 'baskasi' }, asBody(SubmitTestimonialDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ ...valid, approved: true, featured: true }, asBody(SubmitTestimonialDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ ...valid, rating: '5' }, asBody(SubmitTestimonialDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ ...valid, rating: 9 }, asBody(SubmitTestimonialDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ ...valid, body: ['a'.repeat(20)] }, asBody(SubmitTestimonialDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ action: 'delete' }, asBody(ModerateTestimonialDto))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('panel widget govdesi gecer', async () => {
    await expect(pipe.transform({ siteId: 's1', ...valid, role: 'Kurucu', company: 'Örnek', metric: 'x' }, asBody(SubmitTestimonialDto))).resolves.toBeDefined();
    await expect(pipe.transform({ action: 'approve' }, asBody(ModerateTestimonialDto))).resolves.toBeDefined();
  });

  it('controller alanlari tek tek gecirir: govdedeki userId oturumu ezemez', async () => {
    const submit = vi.fn(async (a: any) => a);
    const ctl = new TestimonialsController({ submit } as any);
    await ctl.submit(reqAs({ id: 'u1' }), { ...valid, userId: 'baskasi', approved: true } as any);
    const arg = submit.mock.calls[0][0];
    expect(arg.userId).toBe('u1');
    expect(arg).not.toHaveProperty('approved');
  });

  it('public liste: bozuk ?limit= 500 vermez, ust sinir uygulanir', async () => {
    const listPublic = vi.fn(async () => []);
    const ctl = new TestimonialsController({ listPublic } as any);
    await ctl.listPublic('abc');
    await ctl.listPublic('100000');
    expect(listPublic.mock.calls.map((c: any[]) => c[0])).toEqual([6, 24]);
  });
});

describe('testimonial servisi — siteId sahipligi', () => {
  it('baska kullanicinin sitesine yorum baglanamaz', async () => {
    const { prisma, create } = fakePrisma({ ownSites: ['s1'] });
    const svc = new TestimonialsService(prisma);
    await expect(svc.submit({ userId: 'u1', siteId: 's-baskasi', ...valid })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.submit({ userId: 'u1', siteId: { not: '' } as any, ...valid })).rejects.toBeInstanceOf(ForbiddenException);
    expect(create).not.toHaveBeenCalled();
  });

  it('kendi sitesi ya da sitesiz yorum kaydedilir', async () => {
    const { prisma, create } = fakePrisma({ ownSites: ['s1'] });
    const svc = new TestimonialsService(prisma);
    await svc.submit({ userId: 'u1', siteId: 's1', ...valid });
    await svc.submit({ userId: 'u1', ...valid });
    expect(create.mock.calls[0][0].data.siteId).toBe('s1');
    expect(create.mock.calls[1][0].data.siteId).toBeUndefined();
  });
});
