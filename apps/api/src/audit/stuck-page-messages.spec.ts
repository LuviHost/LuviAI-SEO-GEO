import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { NotFoundException } from '@nestjs/common';
import { STUCK_PAGE_NOT_FOUND, STUCK_RECOVERY_NOT_FOUND } from './stuck-page-messages.js';
import { StuckPageDetectorService } from './stuck-page-detector.service.js';
import { StuckPageRecoveryService } from './stuck-page-recovery.service.js';
import { StuckPageExternalRecoveryService } from './stuck-page-external-recovery.service.js';
import { StuckPagePerformanceCheckService } from './stuck-page-performance-check.service.js';

/**
 * Takili sayfa "bulunamadi" metinleri — tekil uc, toplu onarim satiri,
 * dedektor ve kurtarma servisi AYNI Turkce metni doner.
 *
 * NEDEN VAR: dort yer 'Stuck page bulunamadi' diyordu (yarisi Ingilizce,
 * Turkce karaktersiz); toplu sonuc satirindaki error panelde ve API anahtarli
 * istemcide aynen gorunur. Geri almada 'Recovery bulunamadi' ayni sinif.
 *
 * Denetleyicinin kurucusu onlarca bagimlilik aliyor ve vitest dekorator
 * metadata'si uretmiyor: nesne prototipten kurulur (audit-controller-*.spec ile ayni).
 */
const { AuditController } = await import('./audit.controller.js');

async function notFoundMessage(p: Promise<unknown>): Promise<unknown> {
  const err = await p.then(() => null, (e) => e);
  expect(err).toBeInstanceOf(NotFoundException);
  return (err as NotFoundException).getResponse() as { message?: unknown };
}

describe('takili sayfa bulunamadi metni', () => {
  it('metin Turkce ve tek', () => {
    expect(STUCK_PAGE_NOT_FOUND).toBe('Takılı sayfa bulunamadı.');
    expect(STUCK_RECOVERY_NOT_FOUND).toBe('Düzeltme kaydı bulunamadı.');
  });

  it('tekil uclar (detay + onar) ve toplu onarim satiri', async () => {
    const ctl = Object.create(AuditController.prototype) as any;
    ctl.stuckDetector = { getDetail: vi.fn(async () => null) };
    // Toplu onarim gercek kuyruga alma servisiyle: sayfa bu sitede yok
    const prisma = { site: { findUnique: vi.fn(async () => ({ userId: 'u1' })) }, stuckPage: { findMany: vi.fn(async () => []) } };
    const jobs = { enqueue: vi.fn() };
    ctl.stuckRecovery = new StuckPageRecoveryService(prisma as never, {} as never, jobs as never, {} as never);
    ctl.stuckExternalRecovery = { recover: vi.fn() };
    expect(await notFoundMessage(ctl.stuckPageDetail('s1', 'yok'))).toMatchObject({ message: 'Takılı sayfa bulunamadı.' });
    expect(await notFoundMessage(ctl.recoverStuckPage('s1', 'yok', { user: { id: 'u1' } }))).toMatchObject({ message: 'Takılı sayfa bulunamadı.' });
    const batch = await ctl.recoverBatch('s1', { stuckPageIds: ['yok'] }, { user: { id: 'u1' } });
    expect(batch.results).toEqual([{ stuckPageId: 'yok', id: 'yok', queued: false, error: 'Takılı sayfa bulunamadı.' }]);
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });

  it('dedektor: yok say (ignore) baska sitenin ya da olmayan kaydi icin', async () => {
    const prisma = { stuckPage: { findFirst: vi.fn(async () => null), update: vi.fn() } };
    const detector = new StuckPageDetectorService(prisma as never, {} as never);
    expect(await notFoundMessage(detector.ignore('s1', 'yok'))).toMatchObject({ message: 'Takılı sayfa bulunamadı.' });
    expect(prisma.stuckPage.update).not.toHaveBeenCalled();
  });

  it('kurtarma servisi: onarim (kayit silinmis) ve geri alma (duzeltme kaydi yok)', async () => {
    const prisma = {
      stuckPage: { findUnique: vi.fn(async () => null) },
      stuckPageRecovery: { findFirst: vi.fn(async () => null) },
    };
    const svc = new StuckPageRecoveryService(prisma as never, {} as never, {} as never, {} as never);
    expect(await notFoundMessage(svc.recover('yok', { triggeredBy: 'u1' }))).toMatchObject({ message: 'Takılı sayfa bulunamadı.' });
    expect(await notFoundMessage(svc.revert('s1', 'yok', 'u1'))).toMatchObject({ message: 'Düzeltme kaydı bulunamadı.' });
  });

  it('dis sayfa onarimi ve 30 gunluk olcum de ayni sabitleri kullanir', async () => {
    const external = new StuckPageExternalRecoveryService({ stuckPage: { findUnique: vi.fn(async () => null) } } as never, {} as never, {} as never, {} as never);
    expect(await notFoundMessage(external.recover('yok', { triggeredBy: 'u1' }))).toMatchObject({ message: 'Takılı sayfa bulunamadı.' });
    const perf = new StuckPagePerformanceCheckService({ stuckPageRecovery: { findUnique: vi.fn(async () => null) } } as never, {} as never, {} as never);
    expect(await notFoundMessage(perf.check('yok'))).toMatchObject({ message: 'Düzeltme kaydı bulunamadı.' });
  });

  it('eski karisik / Ingilizce metinler kaynak dosyalarda kalmadi (K7)', () => {
    for (const f of [
      './audit.controller.ts', './stuck-page-detector.service.ts', './stuck-page-recovery.service.ts',
      './stuck-page-external-recovery.service.ts', './stuck-page-performance-check.service.ts',
    ]) {
      const src = readFileSync(new URL(f, import.meta.url), 'utf8');
      expect(src, f).not.toMatch(/Stuck page bulunamadi|Recovery bulunamadi|Takılı sayfa bulunamadı'/);
      expect(src, f).not.toMatch(/zaten geri alindi|Article kaydi yok|ANTHROPIC_API_KEY eksik|Article body bos|external page recovery henuz|External sayfa duzeltildi|Recovery basarili|Recovery beklenenden zayif|LLM hallucination|LLM analizi bos sonuc/);
    }
  });
});
