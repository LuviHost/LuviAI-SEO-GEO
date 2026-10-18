import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateActionPlanDto, UpdateActionPlanDto } from './action-plans.dto.js';
import { ActionPlansController } from './action-plans.controller.js';
import { ActionPlansService } from './action-plans.service.js';

const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const asBody = (metatype: any) => ({ type: 'body' as const, metatype, data: '' });

function fakePrisma() {
  const create = vi.fn(async ({ data }: any) => ({ id: 'a1', ...data }));
  const findFirst = vi.fn(async () => null);
  return { create, findFirst, prisma: { actionPlanItem: { create, findFirst } } as any };
}

describe('aksiyon plani govdeleri — sinif DTO', () => {
  it('siteId gibi bilinmeyen alan, nesne sourceRef (Prisma filtresi) ve bozuk tarih 400', async () => {
    await expect(pipe.transform({ title: 'Robots düzelt', siteId: 's-baskasi' }, asBody(CreateActionPlanDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ title: 'Robots düzelt', sourceRef: { not: null } }, asBody(CreateActionPlanDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ title: 'Robots düzelt', dueAt: 'yarin' }, asBody(CreateActionPlanDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ title: 'x', meta: ['a'] }, asBody(CreateActionPlanDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ status: 'done', doneAt: '2020-01-01' }, asBody(UpdateActionPlanDto))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('panelin gonderdigi govdeler gecer (description null, dueAt bos)', async () => {
    await expect(pipe.transform({ title: 'Yeni madde', source: 'manual' }, asBody(CreateActionPlanDto))).resolves.toBeDefined();
    await expect(pipe.transform({ title: 'llms.txt', description: null, source: 'agent_readiness', sourceRef: 'llms-txt', impact: 'low' }, asBody(CreateActionPlanDto))).resolves.toBeDefined();
    await expect(pipe.transform({ status: 'in_progress' }, asBody(UpdateActionPlanDto))).resolves.toBeDefined();
    await expect(pipe.transform({ dueAt: null }, asBody(UpdateActionPlanDto))).resolves.toBeDefined();
    await expect(pipe.transform({ dueAt: '' }, asBody(UpdateActionPlanDto))).resolves.toBeDefined();
  });

  it('controller alanlari tek tek gecirir; siteId yalniz yoldan', async () => {
    const create = vi.fn(async () => ({}));
    const ctl = new ActionPlansController({ create } as any);
    await ctl.create('s1', { title: 'Madde', siteId: 's-baskasi', status: 'done' } as any);
    expect((create.mock.calls[0] as any)[0]).toBe('s1');
    expect((create.mock.calls[0] as any)[1]).not.toHaveProperty('siteId');
    expect((create.mock.calls[0] as any)[1]).not.toHaveProperty('status');
  });
});

describe('aksiyon plani servisi — pipe atlansa da', () => {
  it('nesne sourceRef where filtresine gitmez, dize olmayan aciklama kaydedilmez', async () => {
    const { prisma, create, findFirst } = fakePrisma();
    await new ActionPlansService(prisma).create('s1', { title: 'Madde başlığı', sourceRef: { not: null } as any, description: ['x'] as any });
    expect(findFirst).not.toHaveBeenCalled();
    expect(create.mock.calls[0][0].data.sourceRef).toBeNull();
    expect(create.mock.calls[0][0].data.description).toBeNull();
  });

  it('bozuk tarih 400 (Prisma 500 yerine), buyuk meta 400', async () => {
    const { prisma } = fakePrisma();
    const svc = new ActionPlansService(prisma);
    await expect(svc.create('s1', { title: 'Madde başlığı', dueAt: 'yarin' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.create('s1', { title: 'Madde başlığı', meta: { blob: 'x'.repeat(20_000) } })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('ic cagiranlarin meta nesnesi korunur (haftalik plan, istihbarat)', async () => {
    const { prisma, create } = fakePrisma();
    await new ActionPlansService(prisma).create('s1', { title: 'Haftalık plan', source: 'chat', sourceRef: 'weekly-plan:2026-W42:1', meta: { skill: 'weekly-plan', week: '2026-W42' } });
    expect(create.mock.calls[0][0].data.meta).toEqual({ skill: 'weekly-plan', week: '2026-W42' });
  });
});

describe('aksiyon plani — VARCHAR(191) kolonlari', () => {
  it('191 karakteri asan baslik 500 yerine kisaltilarak kaydedilir; sourceRef de sinirli', async () => {
    const { prisma, create } = fakePrisma();
    await new ActionPlansService(prisma).create('s1', { title: 'B'.repeat(250), sourceRef: 'r'.repeat(300) });
    const data = create.mock.calls[0][0].data;
    expect(data.title.length).toBe(191);
    expect(data.title.endsWith('…')).toBe(true);
    expect(data.sourceRef.length).toBe(191);
  });
});

describe('aksiyon plani listesi — suzgec', () => {
  it('nesne suzgec (?status[not]=x, MCP argumani) Prisma where\'ine gitmez', async () => {
    const findMany = vi.fn(async () => []);
    const svc = new ActionPlansService({ actionPlanItem: { findMany } } as any);
    await svc.list('s1', { status: { not: 'x' } as any, source: ['a'] as any });
    expect((findMany.mock.calls[0] as any)[0].where).toEqual({ siteId: 's1' });
    await svc.list('s1', { status: 'todo', source: 'audit' });
    expect((findMany.mock.calls[1] as any)[0].where).toEqual({ siteId: 's1', status: 'todo', source: 'audit' });
  });
});
