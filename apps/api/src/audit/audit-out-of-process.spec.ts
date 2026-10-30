import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { AuditService } from './audit.service.js';
import { AuditCron } from './audit.cron.js';

/**
 * Site taramasi API prosesinde KOSMAZ — HTTP ve cron yalniz kuyruga atar.
 *
 * NEDEN VAR: POST /audit/run-now ve AuditCron.weeklyAudit runAudit'i API
 * prosesinde cagiriyordu. Uretimde 100 sayfalik bir tarama ~930 MB'a cikti,
 * API'nin pm2 bellek siniri (800 MB) asildi, pm2 API'yi yeniden baslatti ve
 * tum istekler 502 dondu.
 */

function fakeQueue() {
  const calls: any[] = [];
  return { calls, enqueue: async (opts: any) => { calls.push(opts); return { dbJobId: `job_${calls.length}`, bullJobId: calls.length }; } };
}

function service(queue: any): AuditService {
  const prisma = { site: { findUniqueOrThrow: async ({ where }: any) => ({ id: where.id, userId: 'user_1', url: 'https://ornek.com' }) } } as never;
  const n = null as never;
  return new AuditService(prisma, n, n, n, n, n, queue);
}

describe('run-now ucu', () => {
  it('runAudit cagirmaz, queueAudit ile kuyruga atar (rota uyumluluk icin duruyor)', () => {
    const src = readFileSync(new URL('./audit.controller.ts', import.meta.url), 'utf8');
    const govde = src.slice(src.indexOf("@Post('run-now')"), src.indexOf("@Post('run')"));
    expect(govde).toContain('this.audit.queueAudit(siteId)');
    expect(govde).not.toMatch(/runAudit\(/);
  });

  it('kontrolcude hic senkron runAudit kalmadi', () => {
    const src = readFileSync(new URL('./audit.controller.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/this\.audit\.runAudit\(/);
  });
});

describe('queueAudit — sistem taramasi', () => {
  it('varsayilan: kullanici taramasi, is verisinde trigger yok, oncelik 5', async () => {
    const q = fakeQueue();
    await service(q).queueAudit('s1');
    expect(q.calls[0].payload).toEqual({ siteId: 's1', url: 'https://ornek.com' });
    expect(q.calls[0].priority).toBe(5);
    expect(q.calls[0].delay).toBeUndefined();
  });

  it("trigger 'system' is verisine yazilir; oncelik ve gecikme gecer", async () => {
    const q = fakeQueue();
    await service(q).queueAudit('s1', { trigger: 'system', priority: 50, delay: 60_000 });
    expect(q.calls[0].payload).toMatchObject({ siteId: 's1', trigger: 'system' });
    expect(q.calls[0].priority).toBe(50);
    expect(q.calls[0].delay).toBe(60_000);
  });

  it("worker SITE_AUDIT is verisindeki trigger'i runAudit'e gecirir", () => {
    const src = readFileSync(new URL('../../../worker/src/index.ts', import.meta.url), 'utf8');
    const handler = src.slice(src.indexOf('SITE_AUDIT: async'), src.indexOf('AUTO_FIX: async'));
    expect(handler).toMatch(/SITE_AUDIT: async \(\{ siteId, trigger \}\)/);
    expect(handler).toMatch(/runAudit\(siteId, \{ trigger: kaynak \}\)/);
    // Bilinmeyen deger kullanici taramasi sayilir (kota dayatilir)
    expect(handler).toMatch(/: 'user'/);
  });
});

describe('AuditCron.weeklyAudit', () => {
  const eski = process.env.AUDIT_CRON;
  afterEach(() => { if (eski === undefined) delete process.env.AUDIT_CRON; else process.env.AUDIT_CRON = eski; });

  it("siteleri kuyruga atar (trigger 'system', dusuk oncelik, kademeli), runAudit cagirmaz", async () => {
    process.env.AUDIT_CRON = 'true';
    const prisma = {
      kvStore: { create: vi.fn(async () => ({})) },
      site: { findMany: vi.fn(async () => [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]) },
    };
    const audit = { runAudit: vi.fn(), queueAudit: vi.fn(async () => ({ id: 'j', status: 'QUEUED', bullJobId: '1' })) };
    const r = await new AuditCron(prisma as never, audit as never).weeklyAudit();
    expect(audit.runAudit).not.toHaveBeenCalled();
    expect(audit.queueAudit).toHaveBeenCalledTimes(2);
    const [a, b] = audit.queueAudit.mock.calls as any[];
    expect(a[0]).toBe('a');
    expect(a[1]).toMatchObject({ trigger: 'system', delay: 0 });
    expect(b[1].delay).toBeGreaterThan(0);
    expect(a[1].priority).toBeGreaterThan(10); // kullanici (5) ve kurulum (10) taramalarinin arkasinda
    expect(r).toEqual({ kuyrukta: 2, hatali: 0, atlanan: 0 });
  });

  it('kuyruga atma hatasi digerlerini durdurmaz', async () => {
    process.env.AUDIT_CRON = 'true';
    const prisma = {
      kvStore: { create: vi.fn(async () => ({})) },
      site: { findMany: vi.fn(async () => [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]) },
    };
    const audit = {
      queueAudit: vi.fn()
        .mockRejectedValueOnce(new Error('Connection is closed.'))
        .mockResolvedValueOnce({ id: 'j', status: 'QUEUED', bullJobId: '1' }),
    };
    const r = await new AuditCron(prisma as never, audit as never).weeklyAudit();
    expect(r).toEqual({ kuyrukta: 1, hatali: 1, atlanan: 0 });
  });
});
