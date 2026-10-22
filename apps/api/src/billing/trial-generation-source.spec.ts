import { describe, it, expect, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { QuotaService } from './quota.service.js';
import { ArticlesService } from '../articles/articles.service.js';
import { TRIAL_SOURCE_REQUIRED_CODE, TRIAL_SOURCE_REQUIRED_MESSAGE } from './trial-policy.js';

/**
 * Denemede "Uret" yalniz sitede yayin hedefi bagliyken (sahip karari 21.10.2026).
 * Asil kapi QuotaService.consumeArticleAllowance(userId, siteId): kullanicinin
 * baslattigi her uretim yolu (Uret, run-now, Simdi uret, MCP create_article, icerik
 * firsati) bu kapidan gecer; siteId zorunlu parametre.
 */
function db(user: { plan: string; articlesUsedThisMonth: number }, targets: Array<{ type: string; isActive: boolean }>) {
  const row = { id: 'u1', articlesQuotaResetAt: new Date(), aiCitationQuotaResetAt: new Date(), ...user };
  return {
    row,
    publishTarget: {
      findMany: vi.fn(async ({ where }: any) => targets.filter((t) => where.isActive === undefined || t.isActive === where.isActive)),
    },
    user: {
      findUniqueOrThrow: vi.fn(async () => ({ ...row })),
      update: vi.fn(async ({ data }: any) => Object.assign(row, data)),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const c = where.articlesUsedThisMonth ?? {};
        if (c.lt !== undefined && !(row.articlesUsedThisMonth < c.lt)) return { count: 0 };
        if (c.gt !== undefined && !(row.articlesUsedThisMonth > c.gt)) return { count: 0 };
        row.articlesUsedThisMonth += data.articlesUsedThisMonth.increment ?? -data.articlesUsedThisMonth.decrement;
        return { count: 1 };
      }),
    },
  };
}

const code = async (p: Promise<unknown>) => {
  try { await p; return 'ok'; } catch (e: any) {
    expect(e).toBeInstanceOf(ForbiddenException);
    return (e.getResponse() as any)?.code ?? e.message;
  }
};

describe('QuotaService.consumeArticleAllowance — denemede yayin hedefi sarti', () => {
  it('deneme + yayin hedefi YOK: 403 TRIAL_SOURCE_REQUIRED, hak dusmez', async () => {
    const prisma: any = db({ plan: 'TRIAL', articlesUsedThisMonth: 0 }, []);
    const q = new QuotaService(prisma);
    await expect(q.consumeArticleAllowance('u1', 's1')).rejects.toThrow(TRIAL_SOURCE_REQUIRED_MESSAGE);
    expect(await code(q.consumeArticleAllowance('u1', 's1'))).toBe(TRIAL_SOURCE_REQUIRED_CODE);
    expect(prisma.row.articlesUsedThisMonth).toBe(0);
    expect(prisma.publishTarget.findMany).toHaveBeenCalledWith({ where: { siteId: 's1', isActive: true }, select: { type: true, isActive: true } });
  });

  it('deneme + yalniz PASIF hedef: yine 403', async () => {
    const q = new QuotaService(db({ plan: 'TRIAL', articlesUsedThisMonth: 0 }, [{ type: 'WORDPRESS_REST', isActive: false }]) as any);
    expect(await code(q.consumeArticleAllowance('u1', 's1'))).toBe(TRIAL_SOURCE_REQUIRED_CODE);
  });

  it('deneme + aktif hedef: izin, hak duser (toplam 2 kurali aynen)', async () => {
    const prisma: any = db({ plan: 'TRIAL', articlesUsedThisMonth: 0 }, [{ type: 'WORDPRESS_REST', isActive: true }]);
    const q = new QuotaService(prisma);
    await expect(q.consumeArticleAllowance('u1', 's1')).resolves.toEqual({ remaining: 1 });
    await expect(q.consumeArticleAllowance('u1', 's1')).resolves.toEqual({ remaining: 0 });
    await expect(q.consumeArticleAllowance('u1', 's1')).rejects.toThrow('Deneme hesabındaki 2 ücretsiz makale hakkını kullandın.');
    expect(prisma.row.articlesUsedThisMonth).toBe(2);
  });

  it('hak bitmis deneme + hedef yok: once hak metni (hedef baglamak bitmis hakki geri getirmez)', async () => {
    const q = new QuotaService(db({ plan: 'TRIAL', articlesUsedThisMonth: 2 }, []) as any);
    await expect(q.consumeArticleAllowance('u1', 's1')).rejects.toThrow('Deneme hesabındaki 2 ücretsiz makale hakkını kullandın.');
  });

  it('ucretli plan: hedefsiz de uretir, hedef sorgusu yapilmaz (davranis degismedi)', async () => {
    const prisma: any = db({ plan: 'STARTER', articlesUsedThisMonth: 0 }, []);
    const q = new QuotaService(prisma);
    await expect(q.consumeArticleAllowance('u1', 's1')).resolves.toEqual({ remaining: 14 });
    expect(prisma.publishTarget.findMany).not.toHaveBeenCalled();
  });

  it('generationReadiness: panel ayni karari okur', async () => {
    expect(await new QuotaService(db({ plan: 'TRIAL', articlesUsedThisMonth: 0 }, []) as any).generationReadiness('u1', 's1'))
      .toEqual({ requiresSource: true, ready: false, message: TRIAL_SOURCE_REQUIRED_MESSAGE });
    expect(await new QuotaService(db({ plan: 'TRIAL', articlesUsedThisMonth: 0 }, [{ type: 'FTP', isActive: true }]) as any).generationReadiness('u1', 's1'))
      .toEqual({ requiresSource: true, ready: true, message: null });
    expect(await new QuotaService(db({ plan: 'PRO', articlesUsedThisMonth: 0 }, []) as any).generationReadiness('u1', 's1'))
      .toEqual({ requiresSource: false, ready: true, message: null });
  });
});

describe('Uret (ArticlesService.queueGeneration) — gercek QuotaService ile', () => {
  function articles(targets: Array<{ type: string; isActive: boolean }>) {
    const prisma: any = db({ plan: 'TRIAL', articlesUsedThisMonth: 0 }, targets);
    prisma.site = { findUniqueOrThrow: vi.fn(async () => ({ id: 's1', userId: 'u1', language: 'tr' })) };
    prisma.article = { create: vi.fn(async ({ data }: any) => ({ id: 'a-new', ...data })) };
    const jobQueue = { enqueue: vi.fn(async () => ({ dbJobId: 'j1', bullJobId: '1' })), removeJob: vi.fn() };
    const svc = new ArticlesService(prisma, jobQueue as any, new QuotaService(prisma), {} as any);
    return { svc, prisma, jobQueue };
  }

  it('yayin hedefi yokken: yer tutucu acilmaz, is kuyruga girmez (LLM harcanmaz)', async () => {
    const { svc, prisma, jobQueue } = articles([]);
    await expect(svc.queueGeneration('s1', 'Konu')).rejects.toThrow(TRIAL_SOURCE_REQUIRED_MESSAGE);
    expect(prisma.article.create).not.toHaveBeenCalled();
    expect(jobQueue.enqueue).not.toHaveBeenCalled();
  });

  it('yayin hedefi bagliyken: uretim kuyruga girer', async () => {
    const { svc, jobQueue } = articles([{ type: 'WORDPRESS_REST', isActive: true }]);
    await expect(svc.queueGeneration('s1', 'Konu')).resolves.toMatchObject({ articleId: 'a-new' });
    expect(jobQueue.enqueue).toHaveBeenCalledTimes(1);
  });
});
