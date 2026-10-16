import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Controller, Inject, Injectable, Post, type CanActivate, type ExecutionContext, type INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service.js';
import { MeasurementAllowanceService } from './measurement-allowance.service.js';
import { MeasurementSession, MeasurementSessionInterceptor } from './measurement-session.interceptor.js';
import { currentMeasurementSession, noteMeasured } from './measurement-allowance.js';

/**
 * HTTP UCTAN UCA — interceptor'in AsyncLocalStorage baglamini handler'a ve
 * handler'in async alt cagrilarina tasidigini gercek Nest yiginiyla sinar.
 * Baglam kopsaydi AI servisleri oturum disinda sanip hakki IKINCI kez
 * ayirmaya calisir ve kullanici kendi isteginde 429 alirdi.
 */

function fakePrisma() {
  const rows = new Map<string, any>();
  return {
    rows,
    kvStore: {
      async create({ data }: any) {
        if (rows.has(data.key)) throw Object.assign(new Error('dup'), { code: 'P2002' });
        rows.set(data.key, { ...data });
      },
      async findUnique({ where }: any) { const r = rows.get(where.key); return r ? { ...r } : null; },
      async updateMany({ where, data }: any) {
        const r = rows.get(where.key);
        if (!r) return { count: 0 };
        if (typeof where.value === 'string' && r.value !== where.value) return { count: 0 };
        if (where.value?.lt !== undefined && !(r.value < where.value.lt)) return { count: 0 };
        Object.assign(r, data);
        return { count: 1 };
      },
      async deleteMany({ where }: any) {
        const r = rows.get(where.key);
        if (!r || (where.value !== undefined && r.value !== where.value)) return { count: 0 };
        rows.delete(where.key);
        return { count: 1 };
      },
    },
  };
}

let currentUser: { id: string; role: string } = { id: 'u1', role: 'USER' };

@Injectable()
class FakeAuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    ctx.switchToHttp().getRequest().user = currentUser;
    return true;
  }
}

@Controller('olcum')
class TestController {
  constructor(@Inject(MeasurementAllowanceService) private readonly allowance: MeasurementAllowanceService) {}

  @MeasurementSession()
  @Post('gercek')
  async gercek() {
    await new Promise((r) => setTimeout(r, 5));
    // Servis ici yedek kontrol: oturum gorunuyorsa ikinci kez ayirmaz
    const extra = await this.allowance.reserveOutsideSession(currentUser);
    noteMeasured();
    return { inSession: !!currentMeasurementSession(), extraReservation: extra };
  }

  @MeasurementSession()
  @Post('bos')
  async bos() {
    return { inSession: !!currentMeasurementSession() };
  }
}

describe('MeasurementSession — HTTP uctan uca', () => {
  let app: INestApplication;
  let prisma: ReturnType<typeof fakePrisma>;

  beforeAll(async () => {
    prisma = fakePrisma();
    const mod = await Test.createTestingModule({
      controllers: [TestController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        // vitest decorator metadata uretmez — servisi elle kur
        { provide: MeasurementAllowanceService, useFactory: () => new MeasurementAllowanceService(prisma as any) },
        MeasurementSessionInterceptor,
        { provide: APP_GUARD, useClass: FakeAuthGuard },
      ],
    }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });
  afterAll(async () => app?.close());
  beforeEach(() => { prisma.rows.clear(); currentUser = { id: 'u1', role: 'USER' }; });

  it('baglam handler ve async alt cagrilarinda gorunur; hak bir kez dusulur', async () => {
    const res = await request(app.getHttpServer()).post('/api/olcum/gercek').expect(201);
    expect(res.body).toEqual({ inSession: true, extraReservation: null });
    expect(prisma.rows.has('ai-olcum:u1')).toBe(true);
  });

  it('ikinci olcum 429 + WEEKLY_MEASUREMENT_LIMIT', async () => {
    await request(app.getHttpServer()).post('/api/olcum/gercek').expect(201);
    const res = await request(app.getHttpServer()).post('/api/olcum/gercek').expect(429);
    expect(res.body.code).toBe('WEEKLY_MEASUREMENT_LIMIT');
    expect(typeof res.body.nextAvailableAt).toBe('string');
  });

  it('olcum yapmayan istek hakki iade eder', async () => {
    await request(app.getHttpServer()).post('/api/olcum/bos').expect(201);
    expect(prisma.rows.has('ai-olcum:u1')).toBe(false);
    await request(app.getHttpServer()).post('/api/olcum/gercek').expect(201);
  });

  it('ADMIN sinirsiz', async () => {
    currentUser = { id: 'a1', role: 'ADMIN' };
    await request(app.getHttpServer()).post('/api/olcum/gercek').expect(201);
    await request(app.getHttpServer()).post('/api/olcum/gercek').expect(201);
  });
});
