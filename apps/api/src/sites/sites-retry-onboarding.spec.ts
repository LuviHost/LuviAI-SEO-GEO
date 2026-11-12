import { describe, expect, it, vi } from 'vitest';
import { ONBOARDING_RETRY_DAILY_LIMIT, ONBOARDING_RUNNING_WINDOW_MS, SitesService } from './sites.service.js';

/**
 * Kurulum ekranindaki "Tekrar dene" kurulum zincirini GERCEKTEN yeniden baslatir.
 *
 * NEDEN VAR: dugme eskiden complete-onboarding'i cagiriyordu. O uc yalniz siteyi
 * ACTIVE yapar; hicbir seyi yeniden calistirmaz. Tarayicimiz siteyi okuyamadigi
 * icin kurulumu duran kullanici (labenko.com, 12.11.2026) sorunu giderip dugmeye
 * bastiginda "yeniden basladi" yazisini goruyor, taranmamis bir siteyle panele
 * dusuyordu.
 */
const user = { id: 'u1', role: 'USER' as const };

function service(opts: { site?: Record<string, unknown>; running?: boolean; recent?: number } = {}) {
  const prisma = {
    site: { findUnique: vi.fn(async () => ({ id: 's1', userId: 'u1', status: 'ONBOARDING', onboardingCompletedAt: null, ...opts.site })) },
    job: {
      findFirst: vi.fn(async () => (opts.running ? { id: 'j1' } : null)),
      count: vi.fn(async () => opts.recent ?? 1),
    },
  };
  const jobQueue = { enqueue: vi.fn(async () => ({ dbJobId: 'j2', bullJobId: 'b2' })) };
  return { svc: new SitesService(prisma as any, jobQueue as any, {} as any), prisma, jobQueue };
}

describe('retryOnboarding', () => {
  it('kurulum zincirini yeniden kuyruga alir', async () => {
    const { svc, jobQueue } = service();
    expect(await svc.retryOnboarding('s1', user)).toEqual({ queued: true });
    expect(jobQueue.enqueue).toHaveBeenCalledTimes(1);
    expect(jobQueue.enqueue).toHaveBeenCalledWith(expect.objectContaining({ type: 'ONBOARDING_CHAIN', siteId: 's1', userId: 'u1', payload: { siteId: 's1' } }));
  });

  it('zincir zaten kuyrukta ya da calisiyorsa ikincisini eklemez', async () => {
    const { svc, jobQueue, prisma } = service({ running: true });
    expect(await svc.retryOnboarding('s1', user)).toEqual({ queued: false, reason: 'running' });
    expect(jobQueue.enqueue).not.toHaveBeenCalled();
    const where = (prisma.job.findFirst.mock.calls[0] as any[])[0].where;
    expect(where).toMatchObject({ siteId: 's1', type: 'ONBOARDING_CHAIN', status: { in: ['QUEUED', 'PROCESSING'] } });
    // Takili kalmis eski bir is sonsuza kadar engel olmasin: yalniz yeni isler sayilir
    expect(where.queuedAt.gt).toBeInstanceOf(Date);
  });

  it('"calisiyor" penceresi saglikli bir zincirden ve ekranin cikis esiginden (12 dk) uzun', async () => {
    // Site taramasi AI olcumunu de bekler; zincir birkac dakika surer. Pencere 6 dakikayken
    // 8. dakikada cikan "Kurulumu yeniden başlat" hala calisan zincirin yanina ikincisini ekliyordu.
    expect(ONBOARDING_RUNNING_WINDOW_MS).toBe(15 * 60_000);
    expect(ONBOARDING_RUNNING_WINDOW_MS).toBeGreaterThan(12 * 60_000);
    const { svc, prisma } = service({ running: true });
    const once = Date.now();
    await svc.retryOnboarding('s1', user);
    const sinir: Date = (prisma.job.findFirst.mock.calls[0] as any[])[0].where.queuedAt.gt;
    // 13 dakika once kuyruga girmis bir zincir hala "calisiyor" sayilir
    expect(sinir.getTime()).toBeLessThan(once - 13 * 60_000);
    expect(sinir.getTime()).toBeGreaterThanOrEqual(once - ONBOARDING_RUNNING_WINDOW_MS - 1000);
  });

  it.each([
    ['kurulumu tamamlanmis site', { onboardingCompletedAt: new Date() }],
    ['ACTIVE site', { status: 'ACTIVE' }],
    ['duraklatilmis site', { status: 'PAUSED' }],
  ])('%s yeniden baslatilamaz', async (_ad, site) => {
    const { svc, jobQueue } = service({ site });
    await expect(svc.retryOnboarding('s1', user)).rejects.toMatchObject({ status: 400 });
    expect(jobQueue.enqueue).not.toHaveBeenCalled();
  });

  it('site basina gunluk deneme siniri: sinir dolunca 429, kuyruga eklenmez', async () => {
    const dolu = service({ recent: ONBOARDING_RETRY_DAILY_LIMIT });
    await expect(dolu.svc.retryOnboarding('s1', user)).rejects.toMatchObject({ status: 429 });
    expect(dolu.jobQueue.enqueue).not.toHaveBeenCalled();
    const altinda = service({ recent: ONBOARDING_RETRY_DAILY_LIMIT - 1 });
    expect(await altinda.svc.retryOnboarding('s1', user)).toEqual({ queued: true });
  });

  it('baskasinin sitesinde calismaz', async () => {
    const { svc, jobQueue } = service({ site: { userId: 'baska-kullanici' } });
    await expect(svc.retryOnboarding('s1', user)).rejects.toBeDefined();
    expect(jobQueue.enqueue).not.toHaveBeenCalled();
  });
});
