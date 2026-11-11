import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { BadRequestException, ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ARTICLE_PLAN_NAME, ArticleSchedulerService, DEMO_SITE_URL, DUE_SCAN_LIMITS, GENERATION_CLAIM_SKIP_REASON, SCHEDULED_GENERATION_JOB_PREFIX, isScheduledGenerationJobId, scheduleQuotaFullMessage, scheduledGenerationJobId,
} from './article-scheduler.service.js';
import { findPlan } from '../billing/plans.js';
import { QuotaService } from '../billing/quota.service.js';
import { statusAfterRetirement } from './republish-policy.js';
import { ArticlesService } from './articles.service.js';
import { sayacAnahtari, tavanAcikMi, trGunAnahtari } from './site-yayin-tavani.js';

/**
 * Takvim — yayin onayi modu, akis durdurma ve kiraci izolasyonu.
 * Vitest dekorator metadatasi uretmez: servis elle kurulur.
 */

vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

type SiteRow = { id: string; userId: string; language?: string; autopilot: boolean; publishApprovalMode: string; publishTargets: Array<{ id: string }> };

const SITE = (over: Partial<SiteRow> = {}): SiteRow => ({
  id: 's1', userId: 'u1', language: 'tr', autopilot: true, publishApprovalMode: 'manual_approve', publishTargets: [{ id: 't1' }], ...over,
});

/**
 * Saatlik taramanin sorgusunu bellek ici tabloda GERCEK anlamiyla calistirir:
 * durum + vade + site kosulu (otopilot, demo, engelli kullanicilar), anahtar
 * kumesi imleci (OR: scheduledAt > x | scheduledAt = x ve id > y), siralama ve
 * take. orderBy verilmezse ekleme sirasi (eski sirasiz sorgunun MySQL'de
 * dondurdugu "en eski satirlar" penceresi). scheduledAt'i olmayan eski test
 * satirlari vadesi gecmis sayilir.
 */
function queryDue(rows: any[], args: any): any[] {
  const where = args?.where ?? {};
  // Taninmayan suzgec sessizce yok sayilip sahte sonuc uretmesin
  for (const k of Object.keys(where)) {
    if (!['status', 'scheduledAt', 'site', 'OR', 'publishedAt', 'siteId'].includes(k)) throw new Error(`queryDue: desteklenmeyen kosul ${k}`);
  }
  if (where.publishedAt !== undefined && where.publishedAt !== null) throw new Error('queryDue: publishedAt yalniz null desteklenir');
  const at = (r: any) => (r.scheduledAt instanceof Date ? r.scheduledAt.getTime() : 0);
  const userOf = (r: any) => r.site?.userId ?? r.site?.user?.id;
  const keyset = (r: any, c: any) => {
    if (c.scheduledAt instanceof Date && at(r) !== c.scheduledAt.getTime()) return false;
    if (c.scheduledAt?.gt instanceof Date && !(at(r) > c.scheduledAt.gt.getTime())) return false;
    if (c.id?.gt !== undefined && !(String(r.id) > String(c.id.gt))) return false;
    return true;
  };
  const s = where.site ?? {};
  for (const k of Object.keys(s)) {
    if (!['autopilot', 'url', 'userId', 'user'].includes(k)) throw new Error(`queryDue: desteklenmeyen site kosulu ${k}`);
  }
  // Plan suzgeci (site.user.plan.notIn — deneme + makale uretimi olmayan planlar; 11.11.2026'ya
  // kadar yalniz `not: 'TRIAL'` idi): satirin planinin kaynagi site.user.plan
  if (s.user !== undefined && (Object.keys(s.user).join() !== 'plan' || !['not', 'notIn'].includes(Object.keys(s.user.plan ?? {}).join()))) {
    throw new Error(`queryDue: desteklenmeyen kullanici kosulu ${JSON.stringify(s.user)}`);
  }
  const planNot = s.user?.plan?.not;
  const planNotIn: string[] | null = Array.isArray(s.user?.plan?.notIn) ? s.user.plan.notIn : null;
  const notIn = Array.isArray(s.userId?.notIn) ? new Set(s.userId.notIn) : null;
  let out = rows.filter((r) => {
    if (typeof where.status === 'string' && r.status !== where.status) return false;
    if (Array.isArray(where.status?.in) && !where.status.in.includes(r.status)) return false;
    if (where.status !== undefined && typeof where.status !== 'string' && !Array.isArray(where.status?.in)) throw new Error('queryDue: desteklenmeyen durum kosulu');
    if (where.siteId !== undefined && r.siteId !== where.siteId) return false;
    if (where.publishedAt === null && (r.publishedAt ?? null) !== null) return false;
    if (where.scheduledAt?.lte instanceof Date && !(at(r) <= where.scheduledAt.lte.getTime())) return false;
    if (s.autopilot !== undefined && r.site?.autopilot !== s.autopilot) return false;
    if (s.url?.not !== undefined && r.site?.url === s.url.not) return false;
    if (typeof s.userId === 'string' && userOf(r) !== s.userId) return false;
    if (notIn && notIn.has(userOf(r))) return false;
    if (planNot !== undefined && r.site?.user?.plan === planNot) return false;
    if (planNotIn && planNotIn.includes(r.site?.user?.plan)) return false;
    if (Array.isArray(where.OR) && !where.OR.some((c: any) => keyset(r, c))) return false;
    return true;
  });
  if (Array.isArray(args?.orderBy)) {
    out = [...out].sort((x, y) => at(x) - at(y) || (String(x.id) < String(y.id) ? -1 : String(x.id) > String(y.id) ? 1 : 0));
  }
  return typeof args?.take === 'number' ? out.slice(0, args.take) : out;
}

type Counter = { articlesUsedThisMonth: number; [k: string]: unknown };

/**
 * Kullanici sayaci tablosu: makale hakkinin TEK kosullu UPDATE'i (chargeArticle /
 * refundArticle) GERCEK anlamiyla calisir — `articlesUsedThisMonth < tavan` tutmazsa
 * count 0. Tablo verilmezse bilinmeyen kullanici 0'dan baslar (varsayilan sahte hak
 * okumasi tavani 15). realQuota ile ayni nesne verilince QuotaService de ayni sayaci okur.
 */
function userTable(given?: Record<string, Counter>) {
  const table: Record<string, Counter> = given ?? {};
  const rowOf = (id: string) => {
    if (!table[id] && !given) table[id] = { articlesUsedThisMonth: 0 };
    return table[id];
  };
  const updateMany = vi.fn(async ({ where, data }: any) => {
    for (const k of Object.keys(where)) {
      if (!['id', 'articlesUsedThisMonth'].includes(k)) throw new Error(`user.updateMany: desteklenmeyen kosul ${k}`);
    }
    const row = rowOf(where.id);
    if (!row) return { count: 0 };
    const c = where.articlesUsedThisMonth ?? {};
    if (c.lt !== undefined && !(row.articlesUsedThisMonth < c.lt)) return { count: 0 };
    if (c.gt !== undefined && !(row.articlesUsedThisMonth > c.gt)) return { count: 0 };
    const d = data?.articlesUsedThisMonth;
    if (typeof d?.increment === 'number') row.articlesUsedThisMonth += d.increment;
    else if (typeof d?.decrement === 'number') row.articlesUsedThisMonth -= d.decrement;
    else throw new Error(`user.updateMany: desteklenmeyen veri ${JSON.stringify(data)}`);
    return { count: 1 };
  });
  return { table, updateMany };
}

/** claimAndQueue'nun sahiplenmede yazdigi hak isareti (agentOutputs.allowanceCharge) */
const CALENDAR_MARK = { allowanceCharge: { at: expect.any(String), source: 'calendar' } };

function build(opts: { site?: SiteRow; articles?: any[]; due?: any[]; quota?: any; users?: Record<string, Counter> } = {}) {
  const site = opts.site ?? SITE();
  // Saatlik taramanin buldugu yazilar da ayni "tabloda": kosullu guncelleme onlari gorur
  const articles = [...(opts.articles ?? []), ...(opts.due ?? [])];
  const users = userTable(opts.users);
  const prisma = {
    user: { updateMany: users.updateMany },
    // Site basina otomatik uretim tavani sayaci (site-yayin-tavani.ts): bu testlerde hep bos (tavan acik)
    kvStore: { findMany: vi.fn(async () => []) },
    $executeRawUnsafe: vi.fn(async () => 1),
    site: { findUniqueOrThrow: vi.fn(async () => site) },
    article: {
      create: vi.fn(async ({ data }: any) => ({ id: 'a-new', ...data })),
      count: vi.fn(async () => 0),
      findMany: vi.fn<(args: any) => Promise<any[]>>(async (args: any) => queryDue(articles, args)),
      findFirst: vi.fn(async ({ where }: any) => articles.find((a) => a.id === where.id && a.siteId === where.siteId) ?? null),
      findUnique: vi.fn<(args: any) => Promise<any>>(async ({ where }: any) => articles.find((a) => a.id === where.id) ?? null),
      update: vi.fn(async ({ where, data }: any) => ({ ...articles.find((a) => a.id === where.id), ...data })),
      // Kosullu guncelleme: yalniz where.status hala gecerliyse yazar (tek SQL UPDATE gibi).
      // Prisma.DbNull veritabaninda NULL olur; satirda da null tutulur.
      updateMany: vi.fn<(args: any) => Promise<{ count: number }>>(async ({ where, data }: any) => {
        const row = articles.find((a) => a.id === where.id && (where.status === undefined || a.status === where.status));
        if (!row) return { count: 0 };
        Object.assign(row, data, data?.agentOutputs === Prisma.DbNull ? { agentOutputs: null } : {});
        return { count: 1 };
      }),
      deleteMany: vi.fn(async ({ where }: any) => ({ count: articles.some((a) => a.id === where.id && a.siteId === where.siteId && a.status === where.status) ? 1 : 0 })),
    },
  };
  const jobQueue = {
    enqueue: vi.fn<(opts: any) => Promise<unknown>>(async () => ({ dbJobId: 'j1', bullJobId: 'b1' })),
    removeJob: vi.fn<(id: string) => Promise<boolean>>(async () => true),
  };
  const quota = opts.quota ?? { checkArticleQuota: vi.fn(async () => ({ allowed: true, remaining: 10, limit: 15 })), aiBudgetBlock: vi.fn(async () => null) };
  const svc = new ArticleSchedulerService(prisma as any, jobQueue as any, quota as any);
  return { svc, prisma, jobQueue, quota, users: users.table, articles };
}

type UserRow = { plan: string; articlesUsedThisMonth: number; articlesQuotaResetAt: Date };

/**
 * GERCEK QuotaService (ay basi sifirlamasi dahil) + bellek ici kullanici
 * tablosu. Okuma kopya doner: servis, gercek Prisma'daki gibi okudugu eski
 * satiri elinde tutar (sifirlamadan sonra yeniden okumaz).
 */
function realQuota(users: Record<string, UserRow>, opts: { targets?: Array<{ type: string; isActive: boolean }> } = {}) {
  const prisma = {
    // Deneme: uretim icin sitede aktif yayin hedefi sarti (QuotaService generationReadiness)
    publishTarget: { findMany: vi.fn(async () => opts.targets ?? [{ type: 'WORDPRESS_REST', isActive: true }]) },
    user: {
      findUniqueOrThrow: vi.fn(async ({ where }: any) => {
        const row = users[where.id];
        if (!row) throw new Error('No User found');
        return { id: where.id, ...row };
      }),
      update: vi.fn(async ({ where, data }: any) => {
        // { increment: 1 } bicimi de desteklenir; digerleri duz deger
        for (const [k, v] of Object.entries(data ?? {})) {
          const row = users[where.id] as any;
          row[k] = v && typeof v === 'object' && 'increment' in (v as any) ? (row[k] ?? 0) + (v as any).increment : v;
        }
        return { id: where.id, ...users[where.id] };
      }),
      // consumeArticleAllowance / refundArticleAllowance: ayni tablonun kosullu UPDATE'i
      updateMany: userTable(users as any).updateMany,
    },
  };
  const quota = new QuotaService(prisma as any);
  const check = vi.spyOn(quota, 'checkArticleQuota');
  return { quota, check, prisma, users };
}

const NOW = new Date();
const LAST_MONTH = new Date(NOW.getFullYear(), NOW.getMonth() - 1, 15, 12);
const LAST_YEAR = new Date(NOW.getFullYear() - 1, NOW.getMonth(), 15, 12);

const AT = new Date(Date.now() + 3 * 86400000).toISOString();

describe('takvim isi — yayin onayi modu (scheduleTopic → gecikmeli GENERATE_ARTICLE)', () => {
  it('Yari otomatik (varsayilan): varsayilan hedef olsa bile autoPublish false', async () => {
    const { svc, jobQueue } = build({ site: SITE({ publishApprovalMode: 'manual_approve' }) });
    await svc.scheduleTopic('s1', { topic: 'Konu', scheduledAt: AT });
    const job = jobQueue.enqueue.mock.calls[0][0] as any;
    expect(job).toMatchObject({ type: 'GENERATE_ARTICLE', jobId: 'gen:article:a-new' });
    expect(job.payload).toMatchObject({ autoPublish: false, targetIds: ['t1'] });
    expect(job.delay).toBeGreaterThan(0);
  });

  it('Tam otomatik + akis acik + hedef: autoPublish true', async () => {
    const { svc, jobQueue } = build({ site: SITE({ publishApprovalMode: 'auto_publish' }) });
    await svc.scheduleTopic('s1', { topic: 'Konu', scheduledAt: AT });
    expect((jobQueue.enqueue.mock.calls[0][0] as any).payload).toMatchObject({ autoPublish: true, targetIds: ['t1'] });
  });

  it('Tam otomatik ama akis durdurulmus ya da hedef yok: autoPublish false', async () => {
    for (const site of [SITE({ publishApprovalMode: 'auto_publish', autopilot: false }), SITE({ publishApprovalMode: 'auto_publish', publishTargets: [] })]) {
      const { svc, jobQueue } = build({ site });
      await svc.scheduleTopic('s1', { topic: 'Konu', scheduledAt: AT });
      expect((jobQueue.enqueue.mock.calls[0][0] as any).payload.autoPublish).toBe(false);
    }
  });
});

describe('processDueArticles — saatlik tarama', () => {
  const due = (over: { id?: string; userId?: string; mode?: string; autopilot?: boolean; targets?: Array<{ id: string }> } = {}) => ({
    id: over.id ?? 'a1', siteId: 's1', topic: 'Konu', status: 'SCHEDULED',
    site: {
      id: 's1', autopilot: over.autopilot ?? true, publishApprovalMode: over.mode ?? 'manual_approve',
      user: { id: over.userId ?? 'u1' },
      publishTargets: over.targets ?? [{ id: 't1' }],
    },
  });

  it('durdurulmus akisin yazilari secilmez (panel: "Yeni yazı üretilmiyor")', async () => {
    const { svc, prisma } = build({ due: [] });
    await svc.processDueArticles();
    const where = (prisma.article.findMany.mock.calls[0][0] as any).where;
    expect(where).toMatchObject({ status: 'SCHEDULED', site: { autopilot: true } });
  });

  it('demo sitesinin gostermelik takvim yazilari gercekten uretilmez (akisi acik kurulur)', async () => {
    const { svc, prisma } = build({ due: [] });
    await svc.processDueArticles();
    const where = (prisma.article.findMany.mock.calls[0][0] as any).where;
    // Deneme + makale uretimi olmayan plan (Baslangic) SQL'de elenir (plans.ts NO_AUTO_ARTICLE_PLANS)
    expect(where.site).toEqual({ autopilot: true, url: { not: DEMO_SITE_URL }, user: { plan: { notIn: ['TRIAL', 'STARTER'] } } });
    // Tek kaynak: demo kurucusu ayni adresi yaziyor
    const seeder = readFileSync(new URL('../sites/demo-seeder.service.ts', import.meta.url), 'utf8');
    expect(seeder).toContain(`url: '${DEMO_SITE_URL}'`);
    expect(seeder).toMatch(/autopilot: true/);
  });

  it('Yari otomatikte uretilir ama yayinlanmaz; Tam otomatikte varsayilan hedefe yayin istenir', async () => {
    const manual = build({ due: [due({ mode: 'manual_approve' })] });
    await manual.svc.processDueArticles();
    expect((manual.jobQueue.enqueue.mock.calls[0][0] as any).payload).toMatchObject({ articleId: 'a1', autoPublish: false, targetIds: ['t1'] });
    // Sahiplenme KOSULLU: yalniz hala SCHEDULED ise (eskiden kosulsuz update); hak isareti ayni UPDATE'te
    expect(manual.prisma.article.updateMany).toHaveBeenCalledWith({ where: { id: 'a1', status: 'SCHEDULED' }, data: { status: 'GENERATING', agentOutputs: CALENDAR_MARK } });
    expect(manual.prisma.article.update).not.toHaveBeenCalled();

    const auto = build({ due: [due({ mode: 'auto_publish' })] });
    await auto.svc.processDueArticles();
    expect((auto.jobQueue.enqueue.mock.calls[0][0] as any).payload).toMatchObject({ autoPublish: true, targetIds: ['t1'] });
  });

  describe('makale hakki — QuotaService (ay basi sifirlamasi dahil)', () => {
    it('YENI AY: gecen ay sinira dayanmis ucretli musterinin takvim yazisi uretilir (eskiden "kota dolu" diye atlaniyordu)', async () => {
      const users = { u1: { plan: 'PRO', articlesUsedThisMonth: 40, articlesQuotaResetAt: LAST_MONTH } };
      const { quota, check } = realQuota(users);
      const ctx = build({ due: [due()], quota, users });
      expect(await ctx.svc.processDueArticles()).toEqual({ processed: 1, skippedQuota: 0, skippedBudget: 0, alreadyClaimed: 0, failed: 0 });
      expect(ctx.jobQueue.enqueue).toHaveBeenCalledTimes(1);
      // Sayac ay basi sifirlandi ve yazi yeni ayin ilk hakkini kullandi...
      expect(users.u1.articlesUsedThisMonth).toBe(1);
      expect(users.u1.articlesQuotaResetAt.getMonth()).toBe(NOW.getMonth());
      // ...ve checkArticleQuota sifirlamadan sonra satiri yeniden okudugu icin tek soru yetti
      expect(check).toHaveBeenCalledTimes(1);
      expect(check).toHaveBeenNthCalledWith(1, 'u1');
    });

    it('AYNI AY: hak doluysa yazi bekler (SCHEDULED kalir, kuyruga girmez)', async () => {
      const users = { u1: { plan: 'PRO', articlesUsedThisMonth: 40, articlesQuotaResetAt: new Date() } };
      const { quota } = realQuota(users);
      const ctx = build({ due: [due()], quota, users });
      expect(await ctx.svc.processDueArticles()).toEqual({ processed: 0, skippedQuota: 1, skippedBudget: 0, alreadyClaimed: 0, failed: 0 });
      expect(ctx.jobQueue.enqueue).not.toHaveBeenCalled();
      expect(ctx.prisma.article.updateMany).not.toHaveBeenCalled();
      expect(users.u1.articlesUsedThisMonth).toBe(40);
    });

    it('deneme hesabi: hak ay basi sifirlanmaz (omur boyu 2); hakki kalan deneme hesabinin yazisi uretilir ve son hakki kullanir', async () => {
      const full = { u1: { plan: 'TRIAL', articlesUsedThisMonth: 2, articlesQuotaResetAt: LAST_YEAR } };
      const a = build({ due: [due()], quota: realQuota(full).quota, users: full });
      expect(await a.svc.processDueArticles()).toEqual({ processed: 0, skippedQuota: 1, skippedBudget: 0, alreadyClaimed: 0, failed: 0 });
      expect(full.u1.articlesUsedThisMonth).toBe(2);

      const left = { u1: { plan: 'TRIAL', articlesUsedThisMonth: 1, articlesQuotaResetAt: LAST_YEAR } };
      const b = build({ due: [due()], quota: realQuota(left).quota, users: left });
      expect(await b.svc.processDueArticles()).toEqual({ processed: 1, skippedQuota: 0, skippedBudget: 0, alreadyClaimed: 0, failed: 0 });
      expect(left.u1.articlesUsedThisMonth).toBe(2);
    });

    // 11.11.2026 (uc paket): eskiden Buyume (STARTER) 15 ile sinaniyordu. Baslangic'ta artik makale
    // uretimi yok (0); makale hakki olan en dusuk ucretli plan Profesyonel (40). Ikisi de sinanir.
    it('hak tablosu elle uretimi kesen kuralla ayni: Profesyonel (PRO) 40 (plans.ts = QuotaService.LIMITS)', async () => {
      const pro = findPlan('pro')!.articlesPerMonth;
      expect(pro).toBe(40);
      const underUsers = { u1: { plan: 'PRO', articlesUsedThisMonth: pro - 1, articlesQuotaResetAt: new Date() } };
      const under = build({ due: [due()], quota: realQuota(underUsers).quota, users: underUsers });
      expect((await under.svc.processDueArticles()).processed).toBe(1);
      expect(underUsers.u1.articlesUsedThisMonth).toBe(pro);
      const fullUsers = { u1: { plan: 'PRO', articlesUsedThisMonth: pro, articlesQuotaResetAt: new Date() } };
      const full = build({ due: [due()], quota: realQuota(fullUsers).quota, users: fullUsers });
      expect((await full.svc.processDueArticles()).skippedQuota).toBe(1);
    });

    it('Baslangic (STARTER): makale uretimi yok (plans.ts 0 = QuotaService.LIMITS) — takvim yazisi hicbir ay uretime alinmaz, hak dusmez', async () => {
      const starter = findPlan('starter')!.articlesPerMonth;
      expect(starter).toBe(0);
      // Sayac 0'da da, yeni ayin ilk taramasinda da (sifirlama sonrasi) uretim yok
      for (const resetAt of [new Date(), LAST_MONTH]) {
        const users = { u1: { plan: 'STARTER', articlesUsedThisMonth: 0, articlesQuotaResetAt: resetAt } };
        const ctx = build({ due: [due()], quota: realQuota(users).quota, users });
        expect(await ctx.svc.processDueArticles()).toEqual({ processed: 0, skippedQuota: 1, skippedBudget: 0, alreadyClaimed: 0, failed: 0 });
        expect(ctx.jobQueue.enqueue).not.toHaveBeenCalled();
        expect(ctx.prisma.article.updateMany).not.toHaveBeenCalled();
        expect(users.u1.articlesUsedThisMonth).toBe(0);
      }
    });

    it('takvim yazisi uretime alinirken haktan BIR KEZ duser (eskiden hic dusmuyordu); hak kullanici basina bir kez okunur', async () => {
      const users = { u1: { plan: 'PRO', articlesUsedThisMonth: 3, articlesQuotaResetAt: new Date() } };
      const { quota, check } = realQuota(users);
      const ctx = build({ due: [due({ id: 'a1' }), due({ id: 'a2' }), due({ id: 'a3' })], quota, users });
      expect(await ctx.svc.processDueArticles()).toEqual({ processed: 3, skippedQuota: 0, skippedBudget: 0, alreadyClaimed: 0, failed: 0 });
      expect(check).toHaveBeenCalledTimes(1);
      expect(users.u1.articlesUsedThisMonth).toBe(6);
    });

    it('hak okunamazsa yazi SCHEDULED kalir (failed); diger kullanicilarin yazilari islenir', async () => {
      const users = { u2: { plan: 'PRO', articlesUsedThisMonth: 0, articlesQuotaResetAt: new Date() } };
      const { quota } = realQuota(users); // u1 tabloda yok → findUniqueOrThrow hata
      const ctx = build({ due: [due({ id: 'a1', userId: 'u1' }), due({ id: 'a2', userId: 'u2' })], quota, users: users as any });
      expect(await ctx.svc.processDueArticles()).toEqual({ processed: 1, skippedQuota: 0, skippedBudget: 0, alreadyClaimed: 0, failed: 1 });
      expect(ctx.jobQueue.enqueue).toHaveBeenCalledTimes(1);
      expect((ctx.jobQueue.enqueue.mock.calls[0][0] as any).payload.articleId).toBe('a2');
      expect(users.u2.articlesUsedThisMonth).toBe(1);
    });

    it('bilinmeyen plan: sessizce sinirsiz olmaz (uretilmez)', async () => {
      const ctx = build({ due: [due()], quota: realQuota({ u1: { plan: 'GOLD', articlesUsedThisMonth: 0, articlesQuotaResetAt: new Date() } }).quota });
      const r = await ctx.svc.processDueArticles();
      expect(r.processed).toBe(0);
      expect(ctx.jobQueue.enqueue).not.toHaveBeenCalled();
    });
  });

  it('yaziyi gecikmeli takvim isi ya da "Simdi uret" once aldiysa (count 0) ikinci kez kuyruga atilmaz; dusulen hak geri verilir', async () => {
    const ctx = build({ due: [due()] });
    ctx.prisma.article.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await ctx.svc.processDueArticles()).toEqual({ processed: 0, skippedQuota: 0, skippedBudget: 0, alreadyClaimed: 1, failed: 0 });
    expect(ctx.jobQueue.enqueue).not.toHaveBeenCalled();
    // Yarisi kaybeden hakki geri verdi: ayni yazi iki kez dusmez
    expect(ctx.users.u1.articlesUsedThisMonth).toBe(0);
  });

  it('kuyruga atilamazsa sahiplik birakilir (SCHEDULED), hak geri verilir ve diger yazilar islenmeye devam eder', async () => {
    const first = due();
    const second = { ...due(), id: 'a2' };
    const ctx = build({ due: [first, second] });
    ctx.jobQueue.enqueue.mockRejectedValueOnce(new Error('redis yok'));
    const r = await ctx.svc.processDueArticles();
    expect(r).toEqual({ processed: 1, skippedQuota: 0, skippedBudget: 0, alreadyClaimed: 0, failed: 1 });
    // Eskiden yazi kalici olarak GENERATING'de ("Uretiliyor") kaliyordu; hak isareti de silinir
    expect(ctx.prisma.article.updateMany).toHaveBeenCalledWith({ where: { id: 'a1', status: 'GENERATING' }, data: { status: 'SCHEDULED', agentOutputs: Prisma.DbNull } });
    expect(first).toMatchObject({ status: 'SCHEDULED', agentOutputs: null });
    expect(ctx.jobQueue.enqueue).toHaveBeenCalledTimes(2);
    expect((ctx.jobQueue.enqueue.mock.calls[1][0] as any).payload.articleId).toBe('a2');
    // Yalniz uretime alinan a2 haktan dustu
    expect(ctx.users.u1.articlesUsedThisMonth).toBe(1);
  });

  /**
   * G12 — kalici takilma: sirasiz sabit 50 satirlik pencere, hakki dolu
   * kullanicilarin SCHEDULED kalan satirlariyla her saat yeniden doluyordu.
   */
  describe('engelli satirlar pencereyi tikayamaz (sayfali tarama)', () => {
    const DAY = 86_400_000;
    const BASE = Date.now() - 30 * DAY;
    /** Vadesi gecmis takvim yazisi; kucuk sira = eski scheduledAt ve kucuk id */
    const row = (n: number, userId: string, over: { siteId?: string; at?: number } = {}) => ({
      id: `a${String(n).padStart(4, '0')}`, siteId: over.siteId ?? `s-${userId}`, topic: `Konu ${n}`, status: 'SCHEDULED',
      scheduledAt: new Date(over.at ?? BASE + n * 60_000),
      site: {
        id: over.siteId ?? `s-${userId}`, userId, autopilot: true, publishApprovalMode: 'manual_approve',
        user: { id: userId }, publishTargets: [{ id: 't1' }],
      },
    });
    /** Deneme hakkini bitirmis 8 hesap (omur boyu 2, sifirlanmaz) x 7 onboarding yazisi = 56 satir */
    const blockedUsers = Array.from({ length: 8 }, (_, i) => `trial${i}`);
    const trialRows = () => blockedUsers.flatMap((u, i) => Array.from({ length: 7 }, (_, k) => row(i * 7 + k, u)));
    const quotaFor = (allowedUsers: string[]) => ({
      checkArticleQuota: vi.fn(async (userId: string) => (allowedUsers.includes(userId)
        ? { allowed: true, remaining: 10, limit: 15 }
        : { allowed: false, remaining: 0, limit: 2 })),
      aiBudgetBlock: vi.fn(async () => null),
    });

    it('50+ engelli satir (daha kucuk id, daha eski vade) + izinli bir satir: izinli satir TEK turda alinir', async () => {
      const paying = row(900, 'payer', { at: Date.now() - DAY });
      const trial = trialRows();
      expect(trial.length).toBeGreaterThan(DUE_SCAN_LIMITS.batchSize);
      const quota = quotaFor(['payer']);
      const ctx = build({ due: [...trial, paying], quota });
      const r = await ctx.svc.processDueArticles();
      expect(r.processed).toBe(1);
      expect(ctx.jobQueue.enqueue).toHaveBeenCalledTimes(1);
      expect((ctx.jobQueue.enqueue.mock.calls[0][0] as any).payload.articleId).toBe(paying.id);
      expect(paying.status).toBe('GENERATING');
      // Engelli kullanicilarin satirlari SCHEDULED kalir (hak yenilenince alinir)...
      expect(trial.every((x) => x.status === 'SCHEDULED')).toBe(true);
      // ...ve her kullanicinin hakki turda bir kez sorulur
      expect(quota.checkArticleQuota).toHaveBeenCalledTimes(9);
      // Ikinci sorgu ilk sayfada engellenen kullanicilari hic getirmez, sirali ve imlecli
      const second = ctx.prisma.article.findMany.mock.calls[1][0] as any;
      expect(second.orderBy).toEqual([{ scheduledAt: 'asc' }, { id: 'asc' }]);
      expect(second.take).toBe(DUE_SCAN_LIMITS.batchSize);
      expect(second.where.site.userId.notIn).toEqual(expect.arrayContaining(blockedUsers.slice(0, 7)));
      expect(second.where.site).toMatchObject({ autopilot: true, url: { not: DEMO_SITE_URL } });
      expect(second.where.OR).toEqual([
        { scheduledAt: { gt: expect.any(Date) } },
        { scheduledAt: expect.any(Date), id: { gt: expect.any(String) } },
      ]);
    });

    it('ayni scheduledAt\'e dusen satirlar (ortak onboarding slotu) id ile sayfalanir: sayfa sinirindaki satirlar atlanmaz', async () => {
      // 60 satir ayni anda: ilk 55'i hakki dolu 11 hesabin, son 5'i (en buyuk id) odeyen hesaplarin.
      // Imlec yalniz scheduledAt'e baksaydi ikinci sayfa bos donerdi.
      const SLOT = Date.now() - 2 * DAY;
      const rows = Array.from({ length: 60 }, (_, i) => row(i, i < 55 ? `b${Math.floor(i / 5)}` : `ok${i}`, { at: SLOT }));
      const allowed = rows.slice(55).map((x) => x.site.userId);
      const ctx = build({ due: rows, quota: quotaFor(allowed) });
      const r = await ctx.svc.processDueArticles();
      expect(r).toEqual({ processed: 5, skippedQuota: 55, skippedBudget: 0, alreadyClaimed: 0, failed: 0 });
      const claimed = ctx.jobQueue.enqueue.mock.calls.map((c: any[]) => c[0].payload.articleId);
      expect(claimed).toEqual(rows.slice(55).map((x) => x.id));
    });

    it('kuyruga atilamayan satir ayni turda yeniden okunmaz (sonsuz dongu yok); sonraki saatte alinir', async () => {
      // Ayni slot: imlec scheduledAt esitliginde id'ye bakmazsa ilk sayfa tekrar tekrar okunurdu
      const SLOT = Date.now() - 3 * DAY;
      const rows = Array.from({ length: 60 }, (_, i) => row(i, `u${i}`, { at: SLOT }));
      const ctx = build({ due: rows, quota: quotaFor(rows.map((x) => x.site.userId)) });
      ctx.jobQueue.enqueue.mockRejectedValue(new Error('redis yok'));
      const r = await ctx.svc.processDueArticles();
      expect(r).toEqual({ processed: 0, skippedQuota: 0, skippedBudget: 0, alreadyClaimed: 0, failed: 60 });
      expect(ctx.jobQueue.enqueue).toHaveBeenCalledTimes(60);
      expect(ctx.prisma.article.findMany).toHaveBeenCalledTimes(2);
      expect(rows.every((x) => x.status === 'SCHEDULED')).toBe(true);
      // Hicbiri uretime alinmadi: hicbir kullanicinin hakki dusmus kalmadi
      expect(Object.values(ctx.users).every((u) => u.articlesUsedThisMonth === 0)).toBe(true);
    });

    it('hakki okunamayan kullanicinin hakki turda bir kez sorulur; diger yazilari da bekler', async () => {
      const rows = [row(1, 'flaky'), row(2, 'flaky'), row(3, 'flaky'), row(4, 'ok')];
      const quota = {
        checkArticleQuota: vi.fn(async (userId: string) => {
          if (userId === 'flaky') throw new Error('db zaman asimi');
          return { allowed: true, remaining: 10, limit: 15 };
        }),
        aiBudgetBlock: vi.fn(async () => null),
      };
      const ctx = build({ due: rows, quota });
      expect(await ctx.svc.processDueArticles()).toEqual({ processed: 1, skippedQuota: 0, skippedBudget: 0, alreadyClaimed: 0, failed: 3 });
      expect(quota.checkArticleQuota.mock.calls.filter((c: any[]) => c[0] === 'flaky')).toHaveLength(1);
    });

    it('tur basina uretime alma tavani: fazlasi SCHEDULED kalir, sonraki taramada alinir', async () => {
      const total = DUE_SCAN_LIMITS.maxClaims + 30;
      const rows = Array.from({ length: total }, (_, i) => row(i, `u${i % 40}`));
      const ctx = build({ due: rows, quota: quotaFor(rows.map((x) => x.site.userId)) });
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const r = await ctx.svc.processDueArticles();
      expect(r.processed).toBe(DUE_SCAN_LIMITS.maxClaims);
      expect(rows.filter((x) => x.status === 'SCHEDULED')).toHaveLength(30);
      // En eski vadeliler once alindi
      expect(rows.slice(0, DUE_SCAN_LIMITS.maxClaims).every((x) => x.status === 'GENERATING')).toBe(true);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('Tarama tavani doldu'));
      warn.mockRestore();
    });

    it('sorgu tavani: dongu sinirli kalir (emniyet), uyari loglanir', async () => {
      // Her sayfa yalniz yeni engelli kullanicilarla dolu: sayfa basina 50 farkli hesap
      const pages = DUE_SCAN_LIMITS.maxBatches + 2;
      const rows = Array.from({ length: pages * DUE_SCAN_LIMITS.batchSize }, (_, i) => row(i, `t${i}`));
      const ctx = build({ due: rows, quota: quotaFor([]) });
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const r = await ctx.svc.processDueArticles();
      expect(ctx.prisma.article.findMany).toHaveBeenCalledTimes(DUE_SCAN_LIMITS.maxBatches);
      expect(r.skippedQuota).toBe(DUE_SCAN_LIMITS.maxBatches * DUE_SCAN_LIMITS.batchSize);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('Tarama tavani doldu'));
      warn.mockRestore();
    });

    it('vadeli satir yoksa tek sorgu, hicbir sey yazilmaz', async () => {
      const ctx = build({ due: [] });
      expect(await ctx.svc.processDueArticles()).toEqual({ processed: 0, skippedQuota: 0, skippedBudget: 0, alreadyClaimed: 0, failed: 0 });
      expect(ctx.prisma.article.findMany).toHaveBeenCalledTimes(1);
      expect(ctx.prisma.article.updateMany).not.toHaveBeenCalled();
    });
  });
});

describe('takvim isi kimligi (gen:article:<id>)', () => {
  it('gecikmeli is kimligi tek kaynaktan; worker yalniz bu oneki takvim isi sayar', () => {
    expect(SCHEDULED_GENERATION_JOB_PREFIX).toBe('gen:article:');
    expect(scheduledGenerationJobId('a1')).toBe('gen:article:a1');
    expect(isScheduledGenerationJobId('gen:article:a1')).toBe(true);
    // Saatlik tarama / "Simdi uret" / "Uret" isleri BullMQ'nun sayi kimligini alir
    for (const id of ['123', undefined, null, 42, 'gen:article:', 'cron:process-scheduled', 'xgen:article:a1']) {
      expect(isScheduledGenerationJobId(id), String(id)).toBe(false);
    }
  });
});

describe('dispatchScheduledArticle — gecikmeli takvim isi uretmez, sahiplenip kuyruga atar', () => {
  const SCHEDULED = () => ({ id: 'a1', siteId: 's1', topic: 'Konu', status: 'SCHEDULED', site: { ...SITE(), publishTargets: [{ id: 't1' }] } });

  it('yazi SCHEDULED: atomik sahiplenir, normal uretim isi kuyruga girer (gecikmeli kimlik YOK)', async () => {
    const ctx = build({ articles: [SCHEDULED()] });
    const r = await ctx.svc.dispatchScheduledArticle('a1');
    expect(r).toEqual({ dispatched: true, articleId: 'a1', generateJobId: 'j1' });
    expect(ctx.prisma.article.updateMany).toHaveBeenCalledWith({ where: { id: 'a1', status: 'SCHEDULED' }, data: { status: 'GENERATING', agentOutputs: CALENDAR_MARK } });
    // Uretime alirken hak bir kez duser
    expect(ctx.users.u1.articlesUsedThisMonth).toBe(1);
    const job = ctx.jobQueue.enqueue.mock.calls[0][0] as any;
    expect(job).toMatchObject({ type: 'GENERATE_ARTICLE', userId: 'u1', siteId: 's1' });
    expect(job.jobId).toBeUndefined();
    // Yayin alanlari sitenin GUNCEL modundan (Yari otomatik), is verisinden degil
    expect(job.payload).toEqual({ siteId: 's1', topic: 'Konu', articleId: 'a1', skipImages: false, autoPublish: false, targetIds: ['t1'] });
  });

  it('saatlik tarama / "Simdi uret" once aldiysa yazma da kuyruk da yok', async () => {
    for (const status of ['GENERATING', 'EDITING', 'READY_TO_PUBLISH', 'PUBLISHED', 'FAILED']) {
      const ctx = build({ articles: [{ ...SCHEDULED(), status }] });
      expect(await ctx.svc.dispatchScheduledArticle('a1'), status).toEqual({ skipped: true, reason: 'ALREADY_CLAIMED', status });
      expect(ctx.prisma.article.updateMany).not.toHaveBeenCalled();
      expect(ctx.jobQueue.enqueue).not.toHaveBeenCalled();
    }
  });

  it('okuma ile yazma arasinda kaybedilen yaris (count 0): kuyruga atilmaz, hak geri verilir', async () => {
    const ctx = build({ articles: [SCHEDULED()] });
    ctx.prisma.article.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await ctx.svc.dispatchScheduledArticle('a1')).toEqual({ skipped: true, reason: 'ALREADY_CLAIMED' });
    expect(ctx.jobQueue.enqueue).not.toHaveBeenCalled();
    expect(ctx.users.u1.articlesUsedThisMonth).toBe(0);
  });

  it('akis durdurulmus: sahiplenmez, yazi SCHEDULED kalir', async () => {
    const ctx = build({ articles: [{ ...SCHEDULED(), site: { ...SITE({ autopilot: false }), publishTargets: [] } }] });
    expect(await ctx.svc.dispatchScheduledArticle('a1')).toEqual({ skipped: true, reason: 'AUTOPILOT_PAUSED' });
    expect(ctx.prisma.article.updateMany).not.toHaveBeenCalled();
  });

  it('yazi silinmis ya da kimlik yok: DB yazmadan doner', async () => {
    const ctx = build();
    expect(await ctx.svc.dispatchScheduledArticle('yok')).toEqual({ skipped: true, reason: 'ARTICLE_MISSING' });
    expect(await ctx.svc.dispatchScheduledArticle(undefined)).toEqual({ skipped: true, reason: 'ARTICLE_MISSING' });
    expect(ctx.prisma.article.updateMany).not.toHaveBeenCalled();
  });

  it('kuyruga atilamazsa sahiplik birakilir, hak geri verilir ve hata firlar (BullMQ takvim isini yeniden dener)', async () => {
    const row: Record<string, unknown> = SCHEDULED();
    const ctx = build({ articles: [row] });
    ctx.jobQueue.enqueue.mockRejectedValueOnce(new Error('redis yok'));
    await expect(ctx.svc.dispatchScheduledArticle('a1')).rejects.toThrow('redis yok');
    expect(row.status).toBe('SCHEDULED');
    expect(row.agentOutputs).toBeNull();
    expect(ctx.users.u1.articlesUsedThisMonth).toBe(0);
    // Yeniden deneme yeniden sahiplenebilir; hak yalniz bir kez duser
    expect(await ctx.svc.dispatchScheduledArticle('a1')).toMatchObject({ dispatched: true });
    expect(ctx.users.u1.articlesUsedThisMonth).toBe(1);
  });

  it('hak doluysa uretmez: yazi SCHEDULED kalir, kuyruk yok (eskiden gecikmeli is hakka hic bakmiyordu)', async () => {
    const users = { u1: { plan: 'PRO', articlesUsedThisMonth: 40, articlesQuotaResetAt: new Date() } };
    const row: Record<string, unknown> = SCHEDULED();
    const ctx = build({ articles: [row], quota: realQuota(users).quota, users });
    expect(await ctx.svc.dispatchScheduledArticle('a1')).toEqual({ skipped: true, reason: 'QUOTA_EXHAUSTED' });
    expect(row.status).toBe('SCHEDULED');
    expect(ctx.prisma.article.updateMany).not.toHaveBeenCalled();
    expect(ctx.jobQueue.enqueue).not.toHaveBeenCalled();
    expect(users.u1.articlesUsedThisMonth).toBe(40);
  });

  it('Baslangic (makale uretimi yok): gecikmeli takvim isi de uretmez — yazi SCHEDULED kalir, kuyruk yok, sayac 0', async () => {
    const users = { u1: { plan: 'STARTER', articlesUsedThisMonth: 0, articlesQuotaResetAt: new Date() } };
    const row: Record<string, unknown> = SCHEDULED();
    const ctx = build({ articles: [row], quota: realQuota(users).quota, users });
    expect(await ctx.svc.dispatchScheduledArticle('a1')).toEqual({ skipped: true, reason: 'QUOTA_EXHAUSTED' });
    expect(row.status).toBe('SCHEDULED');
    expect(ctx.prisma.article.updateMany).not.toHaveBeenCalled();
    expect(ctx.jobQueue.enqueue).not.toHaveBeenCalled();
    expect(users.u1.articlesUsedThisMonth).toBe(0);
  });
});

describe('cift uretim yarisi — gecikmeli takvim isi + saatlik tarama ayni anda', () => {
  it('ikisi ayni SCHEDULED yaziyi bulur: yalniz BIR uretim isi kuyruga girer', async () => {
    const row = {
      id: 'a1', siteId: 's1', topic: 'Konu', status: 'SCHEDULED',
      site: { ...SITE(), user: { id: 'u1', plan: 'PRO', articlesUsedThisMonth: 0 }, publishTargets: [{ id: 't1' }] },
    };
    const ctx = build({ due: [row] });
    const [dispatch, scan] = await Promise.all([ctx.svc.dispatchScheduledArticle('a1'), ctx.svc.processDueArticles()]);
    // Ikisi de yaziyi SCHEDULED okuyup sahiplenmeyi denedi (eski kod ikisini de uretirdi)...
    expect(ctx.prisma.article.updateMany).toHaveBeenCalledTimes(2);
    // ...ama kosullu guncellemeyi yalniz biri kazandi
    expect(ctx.jobQueue.enqueue).toHaveBeenCalledTimes(1);
    expect(row.status).toBe('GENERATING');
    // Kim kazanirsa kazansin digeri "zaten uretimde" der
    const dispatched = 'dispatched' in dispatch;
    expect(scan.processed + (dispatched ? 1 : 0)).toBe(1);
    expect(scan.alreadyClaimed + (dispatched ? 0 : 1)).toBe(1);
    // Ikisi de hak dustu ama kaybeden geri verdi: yazi haktan bir kez dustu
    expect(ctx.users.u1.articlesUsedThisMonth).toBe(1);
  });

  it('sira tersine: once saatlik tarama aldi, sonra ateslenen gecikmeli is uretmez', async () => {
    const row = {
      id: 'a1', siteId: 's1', topic: 'Konu', status: 'SCHEDULED',
      site: { ...SITE(), user: { id: 'u1', plan: 'PRO', articlesUsedThisMonth: 0 }, publishTargets: [{ id: 't1' }] },
    };
    const ctx = build({ due: [row] });
    expect((await ctx.svc.processDueArticles()).processed).toBe(1);
    expect(await ctx.svc.dispatchScheduledArticle('a1')).toEqual({ skipped: true, reason: 'ALREADY_CLAIMED', status: 'GENERATING' });
    expect(ctx.jobQueue.enqueue).toHaveBeenCalledTimes(1);
  });
});

describe('claimForGeneration — uretim isi baslarken sahiplik', () => {
  it('yer tutucusuz is (pipeline yeni kayit acar): DB okunmaz, surer', async () => {
    const ctx = build();
    expect(await ctx.svc.claimForGeneration(undefined)).toBe('proceed');
    expect(ctx.prisma.article.findUnique).not.toHaveBeenCalled();
  });

  it('kuyruga atan zaten sahiplendi ya da yayindaki yazi yeniden yaziliyor: yazmadan surer', async () => {
    for (const status of ['GENERATING', 'PUBLISHED', 'READY_TO_PUBLISH', 'FAILED']) {
      const ctx = build({ articles: [{ id: 'a1', siteId: 's1', status }] });
      expect(await ctx.svc.claimForGeneration('a1'), status).toBe('proceed');
      expect(ctx.prisma.article.updateMany).not.toHaveBeenCalled();
    }
  });

  it('yazi hala SCHEDULED (sahiplik birakilmis): once sahiplenir ve hak burada duser; baskasi aldiysa uretmez, hak geri', async () => {
    const row: Record<string, unknown> = { id: 'a1', siteId: 's1', status: 'SCHEDULED', site: { userId: 'u1' } };
    const ctx = build({ articles: [row] });
    expect(await ctx.svc.claimForGeneration('a1')).toBe('proceed');
    expect(row.status).toBe('GENERATING');
    expect(row.agentOutputs).toEqual(CALENDAR_MARK);
    expect(ctx.users.u1.articlesUsedThisMonth).toBe(1);
    const lost = build({ articles: [{ id: 'a1', siteId: 's1', status: 'SCHEDULED', site: { userId: 'u1' } }] });
    lost.prisma.article.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await lost.svc.claimForGeneration('a1')).toBe('already_claimed');
    expect(lost.users.u1.articlesUsedThisMonth).toBe(0);
  });

  it('hak doluysa SCHEDULED yaziyi uretmez (quota_exhausted, SCHEDULED kalir); isaretli yazi hak okumadan surer', async () => {
    const users = { u1: { plan: 'TRIAL', articlesUsedThisMonth: 2, articlesQuotaResetAt: LAST_YEAR } };
    const row: Record<string, unknown> = { id: 'a1', siteId: 's1', status: 'SCHEDULED', site: { userId: 'u1' } };
    const ctx = build({ articles: [row], quota: realQuota(users).quota, users });
    expect(await ctx.svc.claimForGeneration('a1')).toBe('quota_exhausted');
    expect(row.status).toBe('SCHEDULED');
    expect(users.u1.articlesUsedThisMonth).toBe(2);
    // Daha once dusulmus (takvime geri donmus) yazi: hak dolu olsa da yeniden dusmeden uretilir
    row.agentOutputs = { allowanceCharge: { at: '2026-10-01T09:00:00.000Z', source: 'calendar' } };
    expect(await ctx.svc.claimForGeneration('a1')).toBe('proceed');
    expect(row.status).toBe('GENERATING');
    expect(users.u1.articlesUsedThisMonth).toBe(2);
  });

  it('silinmis yazi: LLM maliyeti harcanmadan doner', async () => {
    expect(await build().svc.claimForGeneration('yok')).toBe('article_missing');
  });
});

describe('aylik AI butcesi — butcesi dolu sahibin takvim yazisi alinmaz (11.11.2026)', () => {
  // NEDEN: uretim hatti butcesi dolu sahibin yazisini yazmaz (pipeline settleBudgetBlocked: hak
  // iade, yazi takvime doner). Takvim bunu bilmezse ayni yaziyi ay sonuna kadar yeniden alir:
  // hak duser, is acilir, hat reddeder, hak iade edilir — ve her tur sitenin otomatik uretim
  // sayacini (gunde 1, haftada 5) uretilmemis bir yazi icin doldurur.
  const DOLU = 'Aylık AI kullanım bütçen doldu ($120.00 / $120). Bütçe yeni ayın başında sıfırlanır.';
  /** aiBudgetBlock: listedeki sahipler icin musteri metni (dolu), digerleri icin null (acik) */
  const quotaWith = (dolu: string[]) => ({
    checkArticleQuota: vi.fn(async (_userId: string) => ({ allowed: true, remaining: 10, limit: 15 })),
    aiBudgetBlock: vi.fn(async (userId: string) => (dolu.includes(userId) ? DOLU : null)),
  });
  const BASE = Date.now() - 86_400_000;
  const row = (n: number, userId: string, over: Record<string, unknown> = {}) => ({
    id: `a${n}`, siteId: `s-${userId}`, topic: `Konu ${n}`, status: 'SCHEDULED', scheduledAt: new Date(BASE + n * 60_000),
    site: { id: `s-${userId}`, userId, autopilot: true, publishApprovalMode: 'manual_approve', user: { id: userId, plan: 'PRO' }, publishTargets: [{ id: 't1' }] },
    ...over,
  });

  it('saatlik tarama: butcesi dolu sahibin yazilari alinmaz (hak dusmez, is acilmaz, sayac artmaz); digeri uretilir', async () => {
    const rows = [row(1, 'dolu'), row(2, 'dolu'), row(3, 'acik')];
    const quota = quotaWith(['dolu']);
    const ctx = build({ due: rows, quota });
    expect(await ctx.svc.processDueArticles()).toEqual({ processed: 1, skippedQuota: 0, skippedBudget: 2, alreadyClaimed: 0, failed: 0 });
    expect(rows.map((r) => r.status)).toEqual(['SCHEDULED', 'SCHEDULED', 'GENERATING']);
    // Butce sahip basina bir kez okunur; dolu sahibin makale hakki hic okunmaz
    expect(quota.aiBudgetBlock.mock.calls.map((c) => c[0])).toEqual(['dolu', 'acik']);
    expect(quota.checkArticleQuota.mock.calls.map((c) => c[0])).toEqual(['acik']);
    expect(ctx.users.dolu).toBeUndefined();
    expect(ctx.users.acik.articlesUsedThisMonth).toBe(1);
    expect(ctx.jobQueue.enqueue).toHaveBeenCalledTimes(1);
    expect((ctx.jobQueue.enqueue.mock.calls[0][0] as any).payload.articleId).toBe('a3');
    // Otomatik uretim sayaci yalniz gercekten uretime alinan yazi icin artar
    expect(ctx.prisma.$executeRawUnsafe).toHaveBeenCalledTimes(1);
    expect(String((ctx.prisma.$executeRawUnsafe.mock.calls[0] as unknown[])[1])).toContain('s-acik');
  });

  it('saatlik tarama: hakki onceden dusmus (isaretli) yazi da bekler — hat onu da yazmayacak', async () => {
    const rows = [row(1, 'dolu', { agentOutputs: { allowanceCharge: { at: '2026-11-01T09:00:00.000Z', source: 'calendar' } } })];
    const ctx = build({ due: rows, quota: quotaWith(['dolu']) });
    expect(await ctx.svc.processDueArticles()).toEqual({ processed: 0, skippedQuota: 0, skippedBudget: 1, alreadyClaimed: 0, failed: 0 });
    expect(rows[0].status).toBe('SCHEDULED');
    expect(ctx.jobQueue.enqueue).not.toHaveBeenCalled();
  });

  it('saatlik tarama: butcesi dolu sahip sonraki sorgulara girmez; tek kullanicili tarama ilk satirda biter', async () => {
    const ctx = build({ due: [row(1, 'dolu'), row(2, 'acik')], quota: quotaWith(['dolu']) });
    await ctx.svc.processDueArticles({ userId: 'dolu' });
    // Tek sorgu: kullanici engelli gorulunce dongu biter (plan yukseltme sonrasi tarama)
    expect(ctx.prisma.article.findMany).toHaveBeenCalledTimes(1);
    expect(ctx.jobQueue.enqueue).not.toHaveBeenCalled();
  });

  it('GERCEK QuotaService: tavana ulasan Profesyonel durur, bir cent altindaki uretilir; ADMIN muaf', async () => {
    const hesap = (aiCostThisMonthUsd: number, role = 'USER') => ({ plan: 'PRO', role, articlesUsedThisMonth: 0, articlesQuotaResetAt: new Date(), aiCostThisMonthUsd });
    const dolu = { u1: hesap(120) };
    const a = build({ due: [row(1, 'u1')], quota: realQuota(dolu as any).quota, users: dolu });
    expect(await a.svc.processDueArticles()).toEqual({ processed: 0, skippedQuota: 0, skippedBudget: 1, alreadyClaimed: 0, failed: 0 });
    expect(dolu.u1.articlesUsedThisMonth).toBe(0);

    const altinda = { u1: hesap(119.99) };
    const b = build({ due: [row(1, 'u1')], quota: realQuota(altinda as any).quota, users: altinda });
    expect(await b.svc.processDueArticles()).toEqual({ processed: 1, skippedQuota: 0, skippedBudget: 0, alreadyClaimed: 0, failed: 0 });
    expect(altinda.u1.articlesUsedThisMonth).toBe(1);

    const yonetici = { u1: hesap(500, 'ADMIN') };
    const c = build({ due: [row(1, 'u1')], quota: realQuota(yonetici as any).quota, users: yonetici });
    expect(await c.svc.processDueArticles()).toEqual({ processed: 1, skippedQuota: 0, skippedBudget: 0, alreadyClaimed: 0, failed: 0 });
  });

  it('GERCEK QuotaService: butce OKUNAMAZSA takvim durmaz (yazi uretime alinir)', async () => {
    const users = { u1: { plan: 'PRO', articlesUsedThisMonth: 0, articlesQuotaResetAt: new Date(), aiCostThisMonthUsd: 500 } };
    const { quota } = realQuota(users as any);
    vi.spyOn(quota, 'checkAiCostBudget').mockRejectedValue(new Error('db zaman asimi'));
    const ctx = build({ due: [row(1, 'u1')], quota, users });
    expect(await ctx.svc.processDueArticles()).toEqual({ processed: 1, skippedQuota: 0, skippedBudget: 0, alreadyClaimed: 0, failed: 0 });
  });

  it('gecikmeli takvim isi: butce doluysa sahiplenmez (AI_BUDGET_EXHAUSTED), yazi SCHEDULED kalir; aciksa kuyruga atar', async () => {
    const yazi = () => ({ id: 'a1', siteId: 's1', topic: 'Konu', status: 'SCHEDULED', site: { ...SITE(), publishTargets: [{ id: 't1' }], user: { plan: 'PRO' } } });
    const dolu = build({ articles: [yazi()], quota: quotaWith(['u1']) });
    expect(await dolu.svc.dispatchScheduledArticle('a1')).toEqual({ skipped: true, reason: 'AI_BUDGET_EXHAUSTED' });
    expect(dolu.articles[0].status).toBe('SCHEDULED');
    expect(dolu.prisma.article.updateMany).not.toHaveBeenCalled();
    expect(dolu.prisma.user.updateMany).not.toHaveBeenCalled();
    expect(dolu.jobQueue.enqueue).not.toHaveBeenCalled();
    expect(dolu.prisma.$executeRawUnsafe).not.toHaveBeenCalled();

    const acik = build({ articles: [yazi()], quota: quotaWith([]) });
    expect(await acik.svc.dispatchScheduledArticle('a1')).toEqual({ dispatched: true, articleId: 'a1', generateJobId: 'j1' });
  });

  it('gecikmeli takvim isi: akisi durdurulmus sitede butce hic sorulmaz (neden AUTOPILOT_PAUSED kalir)', async () => {
    const quota = quotaWith(['u1']);
    const ctx = build({ articles: [{ id: 'a1', siteId: 's1', topic: 'Konu', status: 'SCHEDULED', site: { ...SITE({ autopilot: false }), publishTargets: [], user: { plan: 'PRO' } } }], quota });
    expect(await ctx.svc.dispatchScheduledArticle('a1')).toEqual({ skipped: true, reason: 'AUTOPILOT_PAUSED' });
    expect(quota.aiBudgetBlock).not.toHaveBeenCalled();
  });

  it('uretim isi (claimForGeneration): SCHEDULED yazi + dolu butce = budget_exhausted, hak dusmez; isaretli yazi da bekler', async () => {
    const yazi: Record<string, unknown> = { id: 'a1', siteId: 's1', status: 'SCHEDULED', site: { userId: 'u1', user: { plan: 'PRO' } } };
    const ctx = build({ articles: [yazi], quota: quotaWith(['u1']) });
    expect(await ctx.svc.claimForGeneration('a1')).toBe('budget_exhausted');
    expect(yazi.status).toBe('SCHEDULED');
    expect(ctx.prisma.user.updateMany).not.toHaveBeenCalled();
    expect(ctx.prisma.article.updateMany).not.toHaveBeenCalled();
    yazi.agentOutputs = { allowanceCharge: { at: '2026-11-01T09:00:00.000Z', source: 'calendar' } };
    expect(await ctx.svc.claimForGeneration('a1')).toBe('budget_exhausted');
    expect(yazi.status).toBe('SCHEDULED');
    // Worker bu karari is sonucuna uretim hattinin atlama koduyla yazar
    expect(GENERATION_CLAIM_SKIP_REASON.budget_exhausted).toBe('AI_BUDGET_EXHAUSTED');
  });

  it('uretim isi (claimForGeneration): kullanicinin baslattigi / yayindaki yazi icin butce burada SORULMAZ (kapi hatta)', async () => {
    for (const status of ['GENERATING', 'PUBLISHED', 'READY_TO_PUBLISH']) {
      const quota = quotaWith(['u1']);
      const ctx = build({ articles: [{ id: 'a1', siteId: 's1', status, site: { userId: 'u1', user: { plan: 'PRO' } } }], quota });
      expect(await ctx.svc.claimForGeneration('a1'), status).toBe('proceed');
      expect(quota.aiBudgetBlock, status).not.toHaveBeenCalled();
    }
  });

  it('uretim isi (claimForGeneration): butce aciksa SCHEDULED yazi her zamanki gibi sahiplenilir', async () => {
    const yazi: Record<string, unknown> = { id: 'a1', siteId: 's1', status: 'SCHEDULED', site: { userId: 'u1', user: { plan: 'PRO' } } };
    const ctx = build({ articles: [yazi], quota: quotaWith([]) });
    expect(await ctx.svc.claimForGeneration('a1')).toBe('proceed');
    expect(yazi.status).toBe('GENERATING');
    expect(ctx.users.u1.articlesUsedThisMonth).toBe(1);
  });
});

describe('worker kablolamasi (apps/worker/src/index.ts) — takvim sahiplenmesi', () => {
  // Worker'in test kosucusu yok; kurallar bu servisten gelmeli
  const src = readFileSync(new URL('../../../worker/src/index.ts', import.meta.url), 'utf8');
  const handler = src.slice(src.indexOf('GENERATE_ARTICLE: async'), src.indexOf('PUBLISH_ARTICLE: async'));

  it('isleyici BullMQ isini de alir (takvim kimligi + yeniden deneme hakki)', () => {
    expect(src).toContain('const result = await handler(job.data, job);');
    expect(handler).toMatch(/^GENERATE_ARTICLE: async \(\{[^}]*\}, job\) =>/);
  });

  it('gecikmeli takvim isi uretmeden once sahiplenip kuyruga atar; diger isler SCHEDULED yaziyi sahiplenir', () => {
    expect(src).toMatch(/import \{ ArticleSchedulerService, GENERATION_CLAIM_SKIP_REASON, isScheduledGenerationJobId \} from '\.\.\/\.\.\/api\/dist\/articles\/article-scheduler\.service\.js'/);
    expect(handler).toMatch(/if \(isScheduledGenerationJobId\(job\?\.id\)\) \{[\s\S]*?services\.scheduler\.dispatchScheduledArticle\(articleId\)[\s\S]*?return dispatch;/);
    expect(handler).toContain('services.scheduler.claimForGeneration(articleId)');
    const pipelineAt = handler.indexOf('runPipeline(');
    expect(handler.indexOf('isScheduledGenerationJobId(')).toBeLessThan(pipelineAt);
    expect(handler.indexOf('claimForGeneration(')).toBeLessThan(pipelineAt);
  });

  it('hata: yeniden denenecekse yazi GENERATING kalir; son denemede yalniz uretimdeki yazi FAILED olur', () => {
    expect(handler).toMatch(/const willRetry = !!job && job\.attemptsMade \+ 1 < \(job\.opts\?\.attempts \?\? 1\)/);
    expect(handler).toMatch(/if \(!willRetry\) \{[\s\S]*?status: \{ in: \['GENERATING', 'EDITING'\]/);
    // Eski kosulsuz FAILED / SCHEDULED yazimi geri gelmesin
    expect(handler).not.toMatch(/article\.update\(\{\s*where: \{ id: articleId \},\s*data: \{ status: '(FAILED|SCHEDULED)'/);
  });

  it('son denemede FAILED + makale hakki iadesi tek islemde (allowance-refund); kapali dongu izi is verisinden iade edilir', () => {
    expect(src).toMatch(/import \{ failGenerationWithRefund, refundJobAllowanceCharge \} from '\.\.\/\.\.\/api\/dist\/articles\/allowance-refund\.js'/);
    expect(handler).toMatch(/if \(!willRetry\) \{[\s\S]*?failGenerationWithRefund\(services\.prisma, \{[\s\S]*?where: \{ id: articleId, status: \{ in: \['GENERATING', 'EDITING'\]/);
    expect(handler).toMatch(/if \(!failedNow && job\?\.id && [\s\S]*?allowanceCharge\) \{\s*await refundJobAllowanceCharge\(services\.prisma, \{ bullJobId: String\(job\.id\) \}\)/);
    // FAILED yazimi iadesiz ayri bir updateMany ile yapilmasin (cift yol = cift ya da kayip iade)
    expect(handler).not.toMatch(/data: \{ status: 'FAILED' as any \}/);
  });

  it('sahiplik reddinin nedeni is sonucuna dogru yazilir: hak dolu → QUOTA_EXHAUSTED (eskiden ALREADY_CLAIMED)', () => {
    expect(handler).toContain('return { skipped: true, reason: GENERATION_CLAIM_SKIP_REASON[claim] };');
    expect(handler).not.toMatch(/claim === 'article_missing' \? 'ARTICLE_MISSING' : 'ALREADY_CLAIMED'/);
    expect(GENERATION_CLAIM_SKIP_REASON).toEqual({ article_missing: 'ARTICLE_MISSING', already_claimed: 'ALREADY_CLAIMED', quota_exhausted: 'QUOTA_EXHAUSTED', attempt_refunded: 'ATTEMPT_REFUNDED', trial_manual_only: 'TRIAL_MANUAL_ONLY', site_rate_limited: 'SITE_RATE_LIMITED', budget_exhausted: 'AI_BUDGET_EXHAUSTED' });
  });

  it('PROCESS_SCHEDULED is verisindeki userId ile yalniz o kullaniciyi tarar (plan yukseltme sonrasi)', () => {
    const scan = src.slice(src.indexOf('PROCESS_SCHEDULED: async'), src.indexOf('SWEEP_STUCK_GENERATING: async'));
    expect(scan).toMatch(/^PROCESS_SCHEDULED: async \(data\) =>/);
    expect(scan).toContain('services.scheduler.processDueArticles(userId ? { userId } : {})');
  });

  it('ARTICLE_GENERATION_DISABLED yalniz uretim sahipligini birakir (yayindaki yazi takvime donmez)', () => {
    expect(handler).toMatch(/where: \{ id: articleId, status: 'GENERATING' as any \},\s*data: \{ status: 'SCHEDULED' as any \}/);
  });
});

describe('rescheduleArticle / unscheduleArticle — kiraci izolasyonu (siteId zorunlu)', () => {
  const OWN = { id: 'a1', siteId: 's1', topic: 'Konu', status: 'SCHEDULED' };
  const FOREIGN = { id: 'b1', siteId: 's2', topic: 'Baska', status: 'DRAFT' };

  let ctx: ReturnType<typeof build>;
  beforeEach(() => { ctx = build({ articles: [OWN, FOREIGN] }); });

  it('makale yalniz verilen sitede aranir (findFirst {id, siteId}); baska sitenin makalesi 404', async () => {
    await expect(ctx.svc.rescheduleArticle('s1', 'b1', AT)).rejects.toBeInstanceOf(NotFoundException);
    await expect(ctx.svc.unscheduleArticle('s1', 'b1')).rejects.toBeInstanceOf(NotFoundException);
    expect(ctx.prisma.article.findFirst).toHaveBeenCalledWith({ where: { id: 'b1', siteId: 's1' } });
    expect(ctx.prisma.article.update).not.toHaveBeenCalled();
    expect(ctx.prisma.article.deleteMany).not.toHaveBeenCalled();
    expect(ctx.jobQueue.enqueue).not.toHaveBeenCalled();
    expect(ctx.jobQueue.removeJob).not.toHaveBeenCalled();
  });

  it('siteId bos verilirse DB okunmadan 404 (Prisma undefined filtreyi yok sayardi)', async () => {
    await expect(ctx.svc.rescheduleArticle('', 'a1', AT)).rejects.toBeInstanceOf(NotFoundException);
    await expect(ctx.svc.unscheduleArticle(undefined as any, 'a1')).rejects.toBeInstanceOf(NotFoundException);
    expect(ctx.prisma.article.findFirst).not.toHaveBeenCalled();
  });

  it('kendi makalesi tasinir; gecikmeli is yeni saate ve moda gore yeniden kurulur', async () => {
    const r = await ctx.svc.rescheduleArticle('s1', 'a1', AT);
    expect(r).toMatchObject({ id: 'a1', status: 'SCHEDULED' });
    const job = ctx.jobQueue.enqueue.mock.calls[0][0] as any;
    expect(job).toMatchObject({ jobId: 'gen:article:a1', siteId: 's1' });
    expect(job.payload.autoPublish).toBe(false); // site Yari otomatik
  });

  it('gecersiz tarih ve tasinamaz durum 400 (eskiden duz Error → 500)', async () => {
    await expect(ctx.svc.rescheduleArticle('s1', 'a1', 'yarin')).rejects.toBeInstanceOf(BadRequestException);
    const busy = build({ articles: [{ ...OWN, status: 'GENERATING' }] });
    await expect(busy.svc.rescheduleArticle('s1', 'a1', AT)).rejects.toBeInstanceOf(BadRequestException);
    await expect(busy.svc.unscheduleArticle('s1', 'a1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('kaldirma: gecikmeli is silinir, silme kosullu (siteId + SCHEDULED)', async () => {
    expect(await ctx.svc.unscheduleArticle('s1', 'a1')).toEqual({ ok: true });
    expect(ctx.jobQueue.removeJob).toHaveBeenCalledWith('gen:article:a1');
    expect(ctx.prisma.article.deleteMany).toHaveBeenCalledWith({ where: { id: 'a1', siteId: 's1', status: 'SCHEDULED' } });
  });

  it('kontrol ile silme arasinda uretime alindiysa silinmez, 400', async () => {
    ctx.prisma.article.deleteMany.mockResolvedValueOnce({ count: 0 });
    await expect(ctx.svc.unscheduleArticle('s1', 'a1')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('scheduleTopic — hak mesaji ve tarih dogrulamasi', () => {
  it('gecersiz tarih 400 (eskiden duz Error → 500)', async () => {
    const { svc, prisma } = build();
    await expect(svc.scheduleTopic('s1', { topic: 'Konu', scheduledAt: 'yarin' })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.article.create).not.toHaveBeenCalled();
  });

  it('hak doluysa 403; metin her planda dogru (deneme hesabinin hakki "aylik" degil; makale yalniz Profesyonel ve ustunde)', async () => {
    const refuse = async (plan: string, limit: number) => {
      const quota = { checkArticleQuota: vi.fn(async () => ({ allowed: false, remaining: 0, limit })) };
      const { svc, prisma } = build({ quota, site: { ...SITE(), user: { plan } } as any });
      const err = await svc.scheduleTopic('s1', { topic: 'Konu', scheduledAt: AT }).catch((e) => e);
      expect(err, plan).toBeInstanceOf(ForbiddenException);
      expect(err.message, plan).not.toMatch(/makale\/ay/);
      expect(prisma.article.create, plan).not.toHaveBeenCalled();
      return err.message as string;
    };
    // Soylenen plan plans.ts'ten: makale ureten en dusuk satistaki plan
    expect(ARTICLE_PLAN_NAME).toBe('Profesyonel');
    expect(ARTICLE_PLAN_NAME).toBe(findPlan('pro')!.name_tr);
    expect(findPlan('starter')!.articlesPerMonth).toBe(0);
    // Deneme: "planını yükselt" Baslangic'i da kapsardi (orada makale yok) — Profesyonel soylenir
    const trial = await refuse('TRIAL', 2);
    expect(trial).toBe('Makale hakkın doldu (2 makale). Yeni yazıyı takvime eklemek için Profesyonel plana geçebilirsin.');
    expect(trial).not.toMatch(/planını yükselt/);
    // Baslangic: "hakkın doldu (0 makale)" denmez; QuotaService.articleQuotaError ile ayni cumle
    const starter = await refuse('STARTER', 0);
    expect(starter).toBe('Makale üretimi bu pakette yok. Makale üretmek için Profesyonel plana geç.');
    expect(starter).not.toMatch(/0 makale/);
    // Makalesi olan ucretli plan: eski metin aynen
    expect(await refuse('PRO', 40)).toBe('Makale hakkın doldu (40 makale). Yeni yazıyı takvime eklemek için planını yükseltebilirsin.');
    // Saf fonksiyon ayni metinleri uretir
    expect(scheduleQuotaFullMessage('TRIAL', 2)).toBe(trial);
    expect(scheduleQuotaFullMessage('STARTER', 0)).toBe(starter);
  });

  it('kalan hak takvimde bekleyen yazilara ayrildiysa 403 ve ne yapilabilecegi (yayinlamak yer acmaz)', async () => {
    const quota = { checkArticleQuota: vi.fn(async () => ({ allowed: true, remaining: 2, limit: 15 })) };
    const waiting = (id: string) => ({ id, siteId: 's1', status: 'SCHEDULED', publishedAt: null, agentOutputs: null, site: { userId: 'u1', url: 'https://ornek.com.tr' } });
    const ctx = build({ quota, articles: [waiting('w1'), waiting('w2')] });
    const err = await ctx.svc.scheduleTopic('s1', { topic: 'Konu', scheduledAt: AT }).catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.message).toBe(
      'Kalan makale hakkın 2; hesabındaki tüm sitelerin takviminde üretime alınmayı bekleyen 2 yazı var ve her biri üretime alınırken bu haktan düşecek. '
      + 'Yeni yazı eklemek için takvimden yazı çıkarabilir ya da planını yükseltebilirsin.',
    );
    expect(err.message).not.toMatch(/yayınla/);
    expect(ctx.prisma.article.create).not.toHaveBeenCalled();
  });

  it('inceleme: deneme hesabinda bekleyen konular kalan haktan AYRILMAZ (otomasyon denemede uretmez; onboarding 5-8 konu, hak 2)', async () => {
    const quota = { checkArticleQuota: vi.fn(async () => ({ allowed: true, remaining: 2, limit: 2 })) };
    const waiting = (id: string) => ({ id, siteId: 's1', status: 'SCHEDULED', publishedAt: null, agentOutputs: null, site: { userId: 'u1', url: 'https://ornek.com.tr' } });
    const onboardingTopics = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6'].map(waiting);
    const trial = build({ quota, articles: onboardingTopics, site: { ...SITE(), user: { plan: 'TRIAL' } } as any });
    await expect(trial.svc.scheduleTopic('s1', { topic: 'Konu', scheduledAt: AT })).resolves.toMatchObject({ status: 'SCHEDULED', topic: 'Konu' });
    expect(trial.prisma.article.create).toHaveBeenCalledTimes(1);
    // Ucretli plan ayni durumda ayirmayi korur (otomasyon uretir)
    const paid = build({ quota, articles: onboardingTopics, site: { ...SITE(), user: { plan: 'PRO' } } as any });
    await expect(paid.svc.scheduleTopic('s1', { topic: 'Konu', scheduledAt: AT })).rejects.toBeInstanceOf(ForbiddenException);
    // Hak bittiyse denemede de 403 (panelde tek kilitli dugme)
    const used = build({ quota: { checkArticleQuota: vi.fn(async () => ({ allowed: false, remaining: 0, limit: 2 })) }, site: { ...SITE(), user: { plan: 'TRIAL' } } as any });
    await expect(used.svc.scheduleTopic('s1', { topic: 'Konu', scheduledAt: AT })).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('takvim metinleri — eski "deneme hesabi paket bekler" iddiasi', () => {
  const scheduler = readFileSync(new URL('./article-scheduler.service.ts', import.meta.url), 'utf8');
  const worker = readFileSync(new URL('../../../worker/src/index.ts', import.meta.url), 'utf8');

  it('takvim yazilari "paket bekler" denmez: deneme hesabi da ucretli plan gibi yalniz hakki doluysa bekler', () => {
    for (const src of [scheduler, worker]) {
      expect(src).not.toMatch(/paket gerekli|paket bekliyor|paket alinmasini bekler/);
    }
  });

  const onboarding = (plan: string, users: Record<string, Counter>, limit: number) => {
    const site = { ...SITE(), user: { plan } };
    const quota = { checkArticleQuota: vi.fn(async () => ({ allowed: users.u1.articlesUsedThisMonth < limit, remaining: Math.max(0, limit - users.u1.articlesUsedThisMonth), limit })) };
    const ctx = build({ site: site as any, quota, users });
    (ctx.prisma as any).topicQueue = { findFirst: vi.fn(async () => ({ tier1Topics: [{ topic: 'A' }, { topic: 'B' }, { topic: 'C' }] })) };
    return { ...ctx, quota, created: () => ctx.prisma.article.create.mock.calls.map((c: any) => c[0].data) };
  };

  it('onboarding (ucretli plan): ilk makale hemen ve ucretsiz uretilir (sayac artmaz, isaretli); digerleri isaretsiz bekler', async () => {
    const users = { u1: { articlesUsedThisMonth: 0 } };
    const ctx = onboarding('PRO', users, 40);
    const r = await ctx.svc.scheduleInitialBatch('s1', { count: 3 });
    expect(r).toMatchObject({ scheduled: 3, isTrial: false, immediate: 'a-new' });
    expect(ctx.jobQueue.enqueue).toHaveBeenCalledTimes(1);
    expect((ctx.jobQueue.enqueue.mock.calls[0][0] as any).payload).toMatchObject({ topic: 'A', autoPublish: false });
    const created = ctx.created();
    expect(created.map((d: any) => d.status)).toEqual(['GENERATING', 'SCHEDULED', 'SCHEDULED']);
    // Supurucu ilk yaziyi takvime geri koyarsa tarama onu ucretsiz yazi olarak tanir (yeniden dusmez)
    expect(created[0].agentOutputs).toEqual({ allowanceCharge: { at: expect.any(String), source: 'onboarding_free' } });
    expect(created[1].agentOutputs).toBeUndefined();
    expect(created[2].agentOutputs).toBeUndefined();
    expect(ctx.quota.checkArticleQuota).not.toHaveBeenCalled();
    expect(users.u1.articlesUsedThisMonth).toBe(0);
  });

  it('onboarding (deneme, sahip karari 21.10.2026): HICBIR makale uretilmez — yalniz konu basliklari takvimde; hak dusmez, uretim isi kuyruga girmez', async () => {
    const users = { u1: { articlesUsedThisMonth: 0 } };
    const ctx = onboarding('TRIAL', users, 2);
    const r = await ctx.svc.scheduleInitialBatch('s1', { count: 3 });
    expect(r).toMatchObject({ scheduled: 3, isTrial: true, immediate: null });
    expect(ctx.jobQueue.enqueue).not.toHaveBeenCalled();
    const created = ctx.created();
    expect(created.map((d: any) => d.status)).toEqual(['SCHEDULED', 'SCHEDULED', 'SCHEDULED']);
    expect(created.map((d: any) => d.topic)).toEqual(['A', 'B', 'C']);
    expect(created.every((d: any) => d.agentOutputs === undefined)).toBe(true);
    expect(ctx.quota.checkArticleQuota).not.toHaveBeenCalled();
    expect(users.u1.articlesUsedThisMonth).toBe(0);
  });

  it('onboarding (deneme, hak dolu — siteyi silip yeniden ekleyen hesap): ilk makale de uretilmez, takvimde bekler', async () => {
    const users = { u1: { articlesUsedThisMonth: 2 } };
    const ctx = onboarding('TRIAL', users, 2);
    const r = await ctx.svc.scheduleInitialBatch('s1', { count: 3 });
    expect(r).toMatchObject({ scheduled: 3, isTrial: true, immediate: null });
    expect(ctx.jobQueue.enqueue).not.toHaveBeenCalled();
    const created = ctx.created();
    expect(created.map((d: any) => d.status)).toEqual(['SCHEDULED', 'SCHEDULED', 'SCHEDULED']);
    expect(created.every((d: any) => d.agentOutputs === undefined)).toBe(true);
    expect(users.u1.articlesUsedThisMonth).toBe(2);
  });

  it('onboarding (deneme): yazi acilamazsa da hak degismez, is kuyruga girmez', async () => {
    const users = { u1: { articlesUsedThisMonth: 0 } };
    const ctx = onboarding('TRIAL', users, 2);
    ctx.prisma.article.create.mockRejectedValueOnce(new Error('db yok'));
    await ctx.svc.scheduleInitialBatch('s1', { count: 1 });
    expect(users.u1.articlesUsedThisMonth).toBe(0);
    expect(ctx.jobQueue.enqueue).not.toHaveBeenCalled();
  });
});

/**
 * rv18 F5 — sitedeki son kopyasi kaldirilan yazi (canlilik denetimi, cop kutusu / silinmis
 * kopya, "bu kaydi unut") statusAfterRetirement ile READY_TO_PUBLISH olur, publishedAt'i
 * kalir. Eskiden scheduleTopic her READY_TO_PUBLISH'i "onayda bekleyen" sayip kalan hakla
 * karsilastiriyordu: musterinin kaldirdigi yazilar takvime yeni konu eklemeyi 403'le kesiyor,
 * takvimden de cikarilamiyor (unscheduleArticle yalniz SCHEDULED alir) ve takvim listesinde
 * gorunuyordu. Yayindaki yazinin onay bekleyen yeniden yazimi da yeni yazi degil.
 * Sorgu kosulu bellek ici tabloda GERCEK anlamiyla calistirilir (publishedAt dahil); taninmayan
 * suzgec anahtari hata verir, sessizce yok sayilip sahte sonuc uretmez.
 */
describe('rv18 F5 — daha once yayinlanmis yazi kalan hakki tuketmez ve takvimde listelenmez', () => {
  type Row = { id: string; siteId: string; status: string; publishedAt: Date | null; scheduledAt: Date | null; publishedTo?: unknown; agentOutputs?: unknown };

  // Siteler: s1 ve s3 ayni musterinin (u1), s2 baska musterinin, demo u1'in ornek sitesi
  const SITES: Record<string, { userId: string; url: string }> = {
    s1: { userId: 'u1', url: 'https://isgetkinlikleri.com' },
    s2: { userId: 'u2', url: 'https://baska-musteri.com.tr' },
    s3: { userId: 'u1', url: 'https://ikinci-site.com.tr' },
    demo: { userId: 'u1', url: DEMO_SITE_URL },
  };

  // where degerlendirici: siteId, status (dize ya da { in }), publishedAt (null ya da { not: null }),
  // site ({ userId, url: { not } })
  const matches = (r: Row, where: Record<string, any>): boolean => Object.entries(where).every(([key, cond]) => {
    if (key === 'siteId') return r.siteId === cond;
    if (key === 'status') {
      if (typeof cond === 'string') return r.status === cond;
      if (Array.isArray(cond?.in)) return cond.in.includes(r.status);
    }
    if (key === 'publishedAt') {
      if (cond === null) return r.publishedAt === null;
      if (cond && typeof cond === 'object' && 'not' in cond && cond.not === null) return r.publishedAt !== null;
    }
    if (key === 'site' && cond && typeof cond === 'object') {
      const s = SITES[r.siteId];
      return Object.entries(cond).every(([k, c]: [string, any]) => {
        if (k === 'userId' && typeof c === 'string') return s.userId === c;
        if (k === 'url' && c && typeof c === 'object' && 'not' in c) return s.url !== c.not;
        throw new Error(`testin desteklemedigi site suzgeci: ${k}=${JSON.stringify(c)}`);
      });
    }
    throw new Error(`testin desteklemedigi suzgec: ${key}=${JSON.stringify(cond)}`);
  });

  const kur = (rows: Row[], remaining: number) => {
    const prisma = {
      site: { findUniqueOrThrow: vi.fn(async () => SITE()), findUnique: vi.fn(async () => ({ userId: 'u1' })) },
      // Site basina otomatik uretim tavani sayaci (site-yayin-tavani.ts): bu testlerde hep bos (tavan acik)
      kvStore: { findMany: vi.fn(async () => []) },
      $executeRawUnsafe: vi.fn(async () => 1),
      // Ucretli plan: takvim yazisi plana kilitli degil (plan-lock.ts)
      user: { findUnique: vi.fn(async () => ({ plan: 'PRO', articlesUsedThisMonth: 0 })) },
      article: {
        count: vi.fn(async ({ where }: { where: Record<string, any> }) => rows.filter((r) => matches(r, where)).length),
        findMany: vi.fn(async ({ where, select, take }: { where: Record<string, any>; select?: Record<string, boolean>; take?: number }) => {
          const hit = rows.filter((r) => matches(r, where))
            .sort((a, b) => (a.scheduledAt?.getTime() ?? 0) - (b.scheduledAt?.getTime() ?? 0));
          const picked = select
            ? hit.map((r) => Object.fromEntries(Object.keys(select).filter((k) => select[k]).map((k) => [k, (r as any)[k]])))
            : hit;
          return typeof take === 'number' ? picked.slice(0, take) : picked;
        }),
        create: vi.fn(async ({ data }: any) => ({ id: 'a-new', ...data })),
      },
    };
    const jobQueue = { enqueue: vi.fn(async () => ({ dbJobId: 'j1', bullJobId: 'b1' })), removeJob: vi.fn(async () => true) };
    const quota = { checkArticleQuota: vi.fn(async () => ({ allowed: true, remaining, limit: 15 })), aiBudgetBlock: vi.fn(async () => null) };
    return { svc: new ArticleSchedulerService(prisma as any, jobQueue as any, quota as any), prisma };
  };

  // Canlilik denetiminin emekliye ayirdigi son site kopyasi (paylasilan sozlesme D3: missingAt + missingReason)
  const retired = (n: number): Row => {
    const publishedTo = [{
      targetId: 'wp', targetType: 'WORDPRESS_REST', ok: true, externalId: String(40 + n), externalUrl: `https://isgetkinlikleri.com/yazi-${n}/`,
      publishedAt: '2026-09-01T08:00:00.000Z', updatedAt: '2026-09-01T08:00:00.000Z',
      missingAt: '2026-10-20T02:20:00.000Z', missingReason: 'public_url_gone',
    }];
    // Durum GERCEK kuraldan: yayinci, "bu kaydi unut" ve canlilik denetimi ayni yardimciyi kullanir
    const status = statusAfterRetirement('PUBLISHED', publishedTo, () => 'WORDPRESS_REST');
    return { id: `r${n}`, siteId: 's1', status, publishedAt: new Date('2026-09-01T08:00:00Z'), scheduledAt: null, publishedTo };
  };
  // Yayindaki yazinin onay bekleyen yeniden yazimi: sitede eski metin canli, yeni metin onayda
  const liveRewrite: Row = {
    id: 'lr', siteId: 's1', status: 'READY_TO_PUBLISH', publishedAt: new Date('2026-08-01T08:00:00Z'), scheduledAt: null,
    publishedTo: [{ targetId: 'wp', targetType: 'WORDPRESS_REST', ok: true, externalId: '7', externalUrl: 'https://isgetkinlikleri.com/canli/', updatedAt: '2026-08-01T08:00:00.000Z' }],
  };
  const fresh = (id: string, status: string, day: number, siteId = 's1'): Row => ({
    id, siteId, status, publishedAt: null, scheduledAt: new Date(Date.UTC(2026, 10, day, 10)),
  });

  it('kaldirilan yazilar READY_TO_PUBLISH olur ama "onayda bekleyen" sayilmaz: kalan hakki 5 olan musteri yeni konu ekleyebilir', async () => {
    const rows = [1, 2, 3, 4, 5].map(retired);
    expect(rows.map((r) => r.status)).toEqual(Array(5).fill('READY_TO_PUBLISH'));
    const t = kur(rows, 5);
    await expect(t.svc.scheduleTopic('s1', { topic: 'Yeni konu', scheduledAt: AT }))
      .resolves.toMatchObject({ id: 'a-new', status: 'SCHEDULED', topic: 'Yeni konu' });
    expect(t.prisma.article.create).toHaveBeenCalledTimes(1);
  });

  it('yeniden yazimi onay bekleyen yayindaki yazi da yeni yazi degil: son kalan hak takvime gider', async () => {
    const t = kur([liveRewrite, retired(1)], 1);
    await expect(t.svc.scheduleTopic('s1', { topic: 'Yeni konu', scheduledAt: AT })).resolves.toMatchObject({ id: 'a-new' });
    expect(t.prisma.article.create).toHaveBeenCalledTimes(1);
  });

  it('hakki henuz dusulmemis bekleyenler sayilir: musterinin tum sitelerindeki takvim yazilari; uretimde / onayda bekleyen, baska musterinin ve demo sitesinin yazisi sayilmaz', async () => {
    const rows = [
      ...[1, 2, 3].map(retired), liveRewrite,
      // Uretimde ve onayda bekleyen yazilar uretime alinirken haktan dustu: kalan hak (remaining) onlari zaten iceriyor
      fresh('n1', 'SCHEDULED', 3), fresh('n2', 'GENERATING', 4), fresh('n3', 'EDITING', 5), fresh('n4', 'READY_TO_PUBLISH', 6),
      fresh('x1', 'SCHEDULED', 7, 's2'), fresh('y1', 'SCHEDULED', 8, 's3'), fresh('d1', 'SCHEDULED', 9, 'demo'),
    ];
    const t = kur(rows, 2);
    const err = await t.svc.scheduleTopic('s1', { topic: 'Yeni konu', scheduledAt: AT }).catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.message).toBe(
      'Kalan makale hakkın 2; hesabındaki tüm sitelerin takviminde üretime alınmayı bekleyen 2 yazı var ve her biri üretime alınırken bu haktan düşecek. '
      + 'Yeni yazı eklemek için takvimden yazı çıkarabilir ya da planını yükseltebilirsin.',
    );
    expect(t.prisma.article.create).not.toHaveBeenCalled();
    // Bir hak daha kalsaydi ekleme olurdu (eskiden 4 bekleyen sayilip 403 verilirdi)
    const more = kur(rows, 3);
    await expect(more.svc.scheduleTopic('s1', { topic: 'Yeni konu', scheduledAt: AT })).resolves.toMatchObject({ id: 'a-new' });
  });

  it('takvim listesi kaldirilan yaziyi ve onay bekleyen yeniden yazimi gostermez; hic yayinlanmamislar vade sirasiyla kalir', async () => {
    const rows = [retired(1), liveRewrite, fresh('n2', 'READY_TO_PUBLISH', 9), fresh('n1', 'SCHEDULED', 2), fresh('x1', 'SCHEDULED', 1, 's2')];
    const t = kur(rows, 10);
    const list = await t.svc.listScheduledForSite('s1');
    expect(list.map((a: any) => a.id)).toEqual(['n1', 'n2']);
    expect(list.map((a: any) => a.lockedByPlan)).toEqual([false, false]);
  });
});

/**
 * C2 — MAKALE HAKKI MUHASEBESI: her yazi aylik makale hakkindan TAM BIR KEZ duser ve ayin
 * toplami planin hakkini asamaz (article-scheduler.service.ts dosya basi).
 *
 * Eski kural iki yonde yanlisti: (1) kullanicinin baslattigi ve henuz yayinlanmamis uretim hem
 * sayactan dusuyor hem de scheduleTopic'te bekleyen sayiliyordu (kapasite iki kez kuculuyordu);
 * (2) takvim uretimi haktan hic dusmuyordu, yayinlanan takvim yazisi bekleyenlerden cikinca yeri
 * yeniden doluyordu (yayinla-yeniden doldur, deneme hesabinin 8 onboarding yazisi).
 *
 * Bellek ici defter: GERCEK ArticleSchedulerService + GERCEK ArticlesService.queueGeneration
 * ("Uret") + GERCEK QuotaService ayni yazi ve kullanici tablosunda calisir. Sorgu kosullari
 * gercek anlamiyla degerlendirilir (queryDue: taninmayan kosul hata verir); sayacin kosullu
 * UPDATE'i userTable'da. MCP create_article ve icerik firsatinin yeni yazisi "Uret" ile ayni
 * kalibi izler (consumeArticleAllowance → scheduledAt'siz GENERATING kayit → is; baslamazsa geri ver).
 */
describe('C2 makale hakki muhasebesi — her yazi bir kez duser, ayin toplami hakki asamaz', () => {
  type Art = Record<string, any>;
  const PAST = () => new Date(Date.now() - 60 * 60_000);
  // 11.11.2026 (uc paket): defter eskiden Buyume (STARTER, 15 makale) ile kuruluyordu. Baslangic'ta
  // artik makale uretimi yok; "makale yazabilen ucretli plan" Profesyonel'dir (plans.ts, 40).
  const HAK = findPlan('pro')!.articlesPerMonth;
  expect(HAK).toBe(40);

  function ledger(plan: string, used: number, seed: Art[] = []) {
    const users: Record<string, any> = {
      u1: { plan, articlesUsedThisMonth: used, articlesQuotaResetAt: new Date() },
      u2: { plan: 'PRO', articlesUsedThisMonth: 0, articlesQuotaResetAt: new Date() },
    };
    const siteRow = (id: string, userId: string, url: string) => ({
      id, userId, url, language: 'tr', autopilot: true, publishApprovalMode: 'manual_approve',
      publishTargets: [{ id: `t-${id}` }], user: { id: userId, plan: userId === 'u1' ? plan : 'PRO' },
    });
    const sites: Record<string, any> = {
      s1: siteRow('s1', 'u1', 'https://ornek.com.tr'),
      s2: siteRow('s2', 'u1', 'https://ikinci-site.com.tr'),
      demo: siteRow('demo', 'u1', DEMO_SITE_URL),
      x1: siteRow('x1', 'u2', 'https://baska-musteri.com.tr'),
    };
    const rows: Art[] = seed.map((r) => ({ publishedAt: null, agentOutputs: null, scheduledAt: null, ...r, site: sites[r.siteId] }));
    const { quota } = realQuota(users);
    const counter = userTable(users);
    let seq = 0;
    const prisma: any = {
      kvStore: { findMany: vi.fn(async () => []) },
      $executeRawUnsafe: vi.fn(async () => 1),
      user: {
        updateMany: counter.updateMany,
        // Kilit hesabi (plan-lock.ts) plan ve sayaci okur
        findUnique: vi.fn(async ({ where }: any) => (users[where.id] ? { ...users[where.id] } : null)),
      },
      site: {
        findUniqueOrThrow: vi.fn(async ({ where }: any) => sites[where.id]),
        findUnique: vi.fn(async ({ where }: any) => sites[where.id] ?? null),
      },
      article: {
        create: vi.fn(async ({ data }: any) => {
          const row = { id: `n${String(++seq).padStart(3, '0')}`, publishedAt: null, agentOutputs: null, scheduledAt: null, ...data, site: sites[data.siteId] };
          rows.push(row);
          return row;
        }),
        count: vi.fn(async (args: any) => queryDue(rows, args).length),
        findMany: vi.fn(async (args: any) => queryDue(rows, args)),
        findUnique: vi.fn(async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null),
        findFirst: vi.fn(async ({ where }: any) => rows.find((r) => r.id === where.id && r.siteId === where.siteId) ?? null),
        updateMany: vi.fn(async ({ where, data }: any) => {
          const row = rows.find((r) => r.id === where.id && (where.status === undefined || r.status === where.status));
          if (!row) return { count: 0 };
          Object.assign(row, data, data?.agentOutputs === Prisma.DbNull ? { agentOutputs: null } : {});
          return { count: 1 };
        }),
        deleteMany: vi.fn(async ({ where }: any) => {
          const i = rows.findIndex((r) => r.id === where.id && r.siteId === where.siteId && r.status === where.status);
          if (i < 0) return { count: 0 };
          rows.splice(i, 1);
          return { count: 1 };
        }),
      },
    };
    let jobs = 0;
    const jobQueue = {
      enqueue: vi.fn<(opts: any) => Promise<{ dbJobId: string; bullJobId: string }>>(async () => ({ dbJobId: `j${++jobs}`, bullJobId: String(jobs) })),
      removeJob: vi.fn(async () => true),
    };
    const scheduler = new ArticleSchedulerService(prisma, jobQueue as any, quota);
    const articles = new ArticlesService(prisma, jobQueue as any, quota, {} as any);
    return {
      users, rows, prisma, scheduler, articles,
      /** Takvim konusu ekle: 'ok' ya da istisna */
      schedule: (siteId = 's1') => scheduler.scheduleTopic(siteId, { topic: 'Konu', scheduledAt: AT }).then(() => 'ok' as const, (e: any) => e),
      /** Takvimdeki yazilarin vadesi geldi */
      makeDue: (filter: (r: Art) => boolean = () => true) => { for (const r of rows) if (r.status === 'SCHEDULED' && filter(r)) r.scheduledAt = PAST(); },
      /** Uretim bitti: hat agentOutputs'u yeniden yazar (hak isareti kalkar), yazi onay bekler */
      finishGeneration: () => { for (const r of rows) if (r.status === 'GENERATING' || r.status === 'EDITING') Object.assign(r, { status: 'READY_TO_PUBLISH', agentOutputs: { writer: { output: 'metin' } } }); },
      publishAll: () => { for (const r of rows) if (r.status === 'READY_TO_PUBLISH' && r.publishedAt === null) Object.assign(r, { status: 'PUBLISHED', publishedAt: new Date() }); },
      /** Baslayan uretim isleri (takvimin gecikmeli isleri haric) */
      generationJobs: () => jobQueue.enqueue.mock.calls.filter((c: any[]) => c[0].type === 'GENERATE_ARTICLE' && !c[0].jobId).length,
    };
  }

  /** scheduleTopic eklemeyi kabul ettigi kadar konu ekler; eklenen sayi ve son ret */
  async function fill(w: ReturnType<typeof ledger>, siteId = 's1') {
    let added = 0;
    for (let i = 0; i < 100; i++) {
      const r = await w.schedule(siteId);
      if (r !== 'ok') return { added, refusal: r };
      added++;
    }
    throw new Error('takvim 100 konudan sonra da kabul ediyor');
  }

  const waitingText = (remaining: number, waiting: number) =>
    `Kalan makale hakkın ${remaining}; hesabındaki tüm sitelerin takviminde üretime alınmayı bekleyen ${waiting} yazı var ve her biri üretime alınırken bu haktan düşecek. `
    + 'Yeni yazı eklemek için takvimden yazı çıkarabilir ya da planını yükseltebilirsin.';

  it('kullanicinin baslattigi, henuz yayinlanmamis uretim bir kez sayilir: kapasite = hak - dusulen (eskiden bekleyen de sayilip iki kez kuculuyordu)', async () => {
    // Ay icinde hakkin 15'i kalmis Profesyonel hesabi (takvim listesi 30 satir doner; sayilar onun altinda)
    const w = ledger('PRO', HAK - 15);
    for (let i = 0; i < 3; i++) await w.articles.queueGeneration('s1', `Elle konu ${i}`);
    expect(w.users.u1.articlesUsedThisMonth).toBe(HAK - 12);
    // Biri uretimi bitirip onay bekliyor, biri editorde, biri uretimde; hicbiri yayinlanmadi
    w.rows[0].status = 'READY_TO_PUBLISH';
    w.rows[1].status = 'EDITING';
    const { added, refusal } = await fill(w);
    expect(added).toBe(12);
    expect(refusal).toBeInstanceOf(ForbiddenException);
    expect(refusal.message).toBe(waitingText(12, 12));
    // Takvim listesi tutarli: uretimde / onayda bekleyenler listede kalir (hakki dusulmus olarak)
    expect(await w.scheduler.listScheduledForSite('s1')).toHaveLength(15);
  });

  it('takvim yazisi takvimde bekleyen olarak bir kez, uretime alininca sayacta bir kez sayilir; 403 metnindeki sayi dogru', async () => {
    const w = ledger('PRO', HAK - 5);
    const first = await fill(w);
    expect(first.added).toBe(5);
    expect(first.refusal.message).toBe(waitingText(5, 5));
    // Ikisinin vadesi geldi: tarama uretime alir, her biri haktan bir kez duser
    let n = 0;
    w.makeDue(() => n++ < 2);
    expect(await w.scheduler.processDueArticles()).toEqual({ processed: 2, skippedQuota: 0, skippedBudget: 0, alreadyClaimed: 0, failed: 0 });
    expect(w.users.u1.articlesUsedThisMonth).toBe(HAK - 3);
    expect((await w.schedule()).message).toBe(waitingText(3, 3));
    // Uretim bitti, onay bekliyor: yine bir kez (sayacta)
    w.finishGeneration();
    expect((await w.schedule()).message).toBe(waitingText(3, 3));
    // Yayinlamak yer acmaz; takvimden cikarmak acar
    w.publishAll();
    expect((await w.schedule()).message).toBe(waitingText(3, 3));
    const victim = w.rows.find((r) => r.status === 'SCHEDULED')!;
    await w.scheduler.unscheduleArticle('s1', victim.id);
    expect(await w.schedule()).toBe('ok');
  });

  it('yayinla-yeniden doldur: ayin toplami planin hakkini asamaz (eskiden takvim uretimi haktan dusmuyordu, yayinlanan yazinin yeri yeniden doluyordu)', async () => {
    const w = ledger('PRO', 0);
    for (let round = 0; round < 4; round++) {
      await fill(w);
      w.makeDue();
      await w.scheduler.processDueArticles();
      w.finishGeneration();
      w.publishAll();
    }
    expect(w.generationJobs()).toBe(HAK);
    expect(w.users.u1.articlesUsedThisMonth).toBe(HAK);
    expect(w.rows.filter((r) => r.status === 'PUBLISHED')).toHaveLength(HAK);
    expect((await w.schedule()).message).toBe(`Makale hakkın doldu (${HAK} makale). Yeni yazıyı takvime eklemek için planını yükseltebilirsin.`);
  });

  /** Onboarding: akis acikken 8 konu (worker ONBOARDING_CHAIN) */
  async function onboardTrial(w: ReturnType<typeof ledger>) {
    w.prisma.topicQueue = { findFirst: vi.fn(async () => ({ tier1Topics: Array.from({ length: 8 }, (_, i) => ({ topic: `Konu ${i}` })) })) };
    await w.scheduler.scheduleInitialBatch('s1', { count: 8 });
  }
  const lockedOf = async (w: ReturnType<typeof ledger>) =>
    (await w.scheduler.listScheduledForSite('s1')).filter((a: any) => a.lockedByPlan).map((a: any) => a.id);

  it('deneme hesabi TOPLAM 2 makale ve YALNIZ KULLANICININ TIKLAMASIYLA (sahip karari 21.10.2026): onboarding, tarama, gecikmeli is, sahiplenmemis uretim isi hicbir sey uretmez; Simdi uret 2 kez alir, ucuncusu ve Uret 403', async () => {
    const w = ledger('TRIAL', 0);
    await onboardTrial(w);
    expect(w.generationJobs()).toBe(0);
    expect(w.users.u1.articlesUsedThisMonth).toBe(0);
    for (let week = 0; week < 5; week++) {
      w.makeDue();
      expect(await w.scheduler.processDueArticles()).toEqual({ processed: 0, skippedQuota: 0, skippedBudget: 0, alreadyClaimed: 0, failed: 0 });
      for (const r of w.rows.filter((x) => x.status === 'SCHEDULED')) {
        expect(await w.scheduler.dispatchScheduledArticle(r.id)).toEqual({ skipped: true, reason: 'TRIAL_MANUAL_ONLY' });
        expect(await w.scheduler.claimForGeneration(r.id)).toBe('trial_manual_only');
      }
    }
    // Otomasyon 5 haftada tek makale uretmedi, hak hic dusmedi
    expect(w.generationJobs()).toBe(0);
    expect(w.users.u1.articlesUsedThisMonth).toBe(0);
    expect(w.rows.filter((r) => r.status === 'SCHEDULED')).toHaveLength(8);
    // Kullanici iki konuyu kendisi baslatir
    const [first, second, third] = w.rows.filter((r) => r.status === 'SCHEDULED');
    await w.articles.triggerNow('s1', first.id);
    await w.articles.triggerNow('s1', second.id);
    expect(w.generationJobs()).toBe(2);
    expect(w.users.u1.articlesUsedThisMonth).toBe(2);
    // 11.11.2026: makale uretimi yalniz Profesyonel ve ustunde — "plan seç" Baslangic'i da kapsardi
    const denemeDoldu = 'Deneme hesabındaki 2 ücretsiz makale hakkını kullandın. Makale üretimine devam etmek için Profesyonel plana geç.';
    const ucuncu = await w.articles.triggerNow('s1', third.id).catch((e: any) => e);
    expect(ucuncu).toBeInstanceOf(ForbiddenException);
    expect(ucuncu.message).toBe(denemeDoldu);
    const uret = await w.articles.queueGeneration('s1', 'Bir konu daha').catch((e: any) => e);
    expect(uret).toBeInstanceOf(ForbiddenException);
    expect(uret.message).toBe(denemeDoldu);
    expect(denemeDoldu).not.toMatch(/plan seç/);
    expect(w.generationJobs()).toBe(2);
    expect((await w.schedule()).message).toBe('Makale hakkın doldu (2 makale). Yeni yazıyı takvime eklemek için Profesyonel plana geçebilirsin.');
  });

  it('deneme hesabinin takvime ekledigi konu icin gecikmeli uretim isi kurulmaz (ucretli planda kurulur)', async () => {
    const trial = ledger('TRIAL', 0);
    expect(await trial.schedule()).toBe('ok');
    expect(trial.prisma.article.create).toHaveBeenCalledTimes(1);
    expect(trial.generationJobs()).toBe(0);
    const delayed = (w: ReturnType<typeof ledger>) => (w.scheduler as any).jobQueue.enqueue.mock.calls.filter((c: any[]) => typeof c[0].jobId === 'string');
    expect(delayed(trial)).toHaveLength(0);
    const paid = ledger('PRO', 0);
    expect(await paid.schedule()).toBe('ok');
    expect(delayed(paid)).toHaveLength(1);
  });

  it('kilit (lockedByPlan): onboarding sonrasi 2 hak en erken 2 takvim yazisina; digerleri kilitli. Kullanici birini uretince kalan 7 yazidan 6si kilitli', async () => {
    const w = ledger('TRIAL', 0);
    await onboardTrial(w);
    const scheduled = w.rows.filter((r) => r.status === 'SCHEDULED').sort((a, b) => a.scheduledAt - b.scheduledAt);
    expect(scheduled).toHaveLength(8);
    const locked = await lockedOf(w);
    expect(locked).toHaveLength(6);
    expect(locked).not.toContain(scheduled[0].id);
    expect(locked).not.toContain(scheduled[1].id);
    // Paneldeki liste ve yazi sayfasi da ayni alani tasir (ArticlesService)
    const list = await w.articles.list('s1');
    expect(list.filter((a: any) => a.lockedByPlan).map((a: any) => a.id).sort()).toEqual([...locked].sort());
    expect((await w.articles.findOneForPanel(locked[0], 's1'))!.lockedByPlan).toBe(true);
    await w.articles.triggerNow('s1', scheduled[0].id);
    expect(w.users.u1.articlesUsedThisMonth).toBe(1);
    expect(await lockedOf(w)).toHaveLength(6);
    // Demo sitesinin ornek takvim yazisi ve baska kullanicinin yazisi kilit hesabina girmez
    w.rows.push({ id: 'demo1', siteId: 'demo', status: 'SCHEDULED', publishedAt: null, agentOutputs: null, scheduledAt: new Date(), site: { url: DEMO_SITE_URL, userId: 'u1' } });
    expect(await lockedOf(w)).toHaveLength(6);
  });

  it('ucretli planda takvim yazisi kilitli gorunmez (hak her ay yenilenir)', async () => {
    const seed = Array.from({ length: 3 }, (_, i) => ({ id: `p${i}`, siteId: 's1', topic: `Konu ${i}`, status: 'SCHEDULED', scheduledAt: new Date(Date.now() + (i + 1) * 86400000) }));
    const w = ledger('PRO', HAK, seed);
    expect(await lockedOf(w)).toEqual([]);
  });

  // 11.11.2026 (uc paket): onboarding'in ILK yazisi 'onboarding_free' isaretiyle, hak okunmadan
  // dogrudan uretime girer. Kural "plan TRIAL degil" iken Baslangic hesabi da eklenen her site
  // icin bir makale aliyordu — "makale üretimi yok" denen pakette. Bagimsiz inceleme buldu.
  it('Baslangic: onboarding hicbir yazi uretmez (ilk yazi dahil) — yalniz konu basliklari, hepsi kilitli; Profesyonel\'de ilk yazi hemen uretilir', async () => {
    const w = ledger('STARTER', 0);
    await onboardTrial(w);
    expect(w.generationJobs()).toBe(0);
    expect(w.rows.filter((r) => r.status === 'GENERATING')).toHaveLength(0);
    expect(w.rows.filter((r) => r.status === 'SCHEDULED')).toHaveLength(8);
    expect(w.users.u1.articlesUsedThisMonth).toBe(0);
    expect(await lockedOf(w)).toHaveLength(8);
    // Ayni kurulum makale uretimi olan planda ilk yaziyi hemen uretir (degismedi)
    const pro = ledger('PRO', 0);
    await onboardTrial(pro);
    expect(pro.generationJobs()).toBe(1);
    expect(pro.rows.filter((r) => r.status === 'GENERATING')).toHaveLength(1);
  });

  // 11.11.2026 (uc paket): Baslangic'ta makale uretimi yok (hak 0). Takvimdeki yazilar hicbir ay
  // uretilmez; panel onlari siradan "Takvimde" yazisi gibi gosterirse musteri yazilacagini sanar.
  // Kilit kurali "plan TRIAL ya da makale hakki 0" (articles/plan-lock.ts).
  it('Baslangic (makale hakki 0): takvimdeki butun yazilar kilitli gorunur; Profesyonel\'e gecince kilit kalkar', async () => {
    const seed = Array.from({ length: 3 }, (_, i) => ({ id: `b${i}`, siteId: 's1', topic: `Konu ${i}`, status: 'SCHEDULED', scheduledAt: new Date(Date.now() + (i + 1) * 86400000) }));
    const w = ledger('STARTER', 0, seed);
    expect((await lockedOf(w)).sort()).toEqual(['b0', 'b1', 'b2']);
    const list = await w.articles.list('s1');
    expect(list.filter((a: any) => a.lockedByPlan)).toHaveLength(3);
    expect((await w.articles.findOneForPanel('b0', 's1'))!.lockedByPlan).toBe(true);
    // Sayac ne olursa olsun (gecis: eskiden uretilmis yazilar) hak 0 → kilitli
    w.users.u1.articlesUsedThisMonth = 7;
    expect(await lockedOf(w)).toHaveLength(3);
    // Makale uretimi olan plana gecis: kilit kalkar
    Object.assign(w.users.u1, { plan: 'PRO', articlesUsedThisMonth: 0 });
    expect(await lockedOf(w)).toEqual([]);
  });

  it('plan yukseltme: denemede tarama hicbir sey uretmez; yukseltince kullanicinin taramasi vadesi gecmis yazilari hemen uretir, gelecektekiler bekler; kilit kalkar; baska kullanicinin yazisina dokunulmaz', async () => {
    const w = ledger('TRIAL', 0, [{ id: 'z1', siteId: 'x1', topic: 'Baska', status: 'SCHEDULED', scheduledAt: new Date(Date.now() - 3600_000) }]);
    await onboardTrial(w);
    // Onboarding sonrasi 1 hafta + 1 gun gecti: 3 yazinin vadesi geldi; deneme hesabi oldugu icin uretilmez
    let n = 0;
    w.makeDue((r) => r.siteId === 's1' && n++ < 3);
    expect(await w.scheduler.processDueArticles({ userId: 'u1' })).toEqual({ processed: 0, skippedQuota: 0, skippedBudget: 0, alreadyClaimed: 0, failed: 0 });
    expect(w.users.u1.articlesUsedThisMonth).toBe(0);
    expect(w.generationJobs()).toBe(0);
    expect(await lockedOf(w)).toHaveLength(6);
    // Odeme: paytr activateSubscription plani acar ve sayaci sifirlar
    Object.assign(w.users.u1, { plan: 'PRO', articlesUsedThisMonth: 0 });
    w.prisma.site.findUniqueOrThrow.mockImplementation(async ({ where }: any) => ({ ...(w.rows.find((r) => r.siteId === where.id)?.site ?? {}), user: { id: 'u1', plan: 'PRO' } }));
    for (const r of w.rows) if (r.site?.userId === 'u1') r.site = { ...r.site, user: { id: 'u1', plan: 'PRO' } };
    expect(await lockedOf(w)).toEqual([]);
    const r = await w.scheduler.processDueArticles({ userId: 'u1' });
    // Vadesi gecmis 3 yazi uretime alindi; gelecek 5 yazi saatinde
    expect(r).toEqual({ processed: 3, skippedQuota: 0, skippedBudget: 0, alreadyClaimed: 0, failed: 0 });
    expect(w.users.u1.articlesUsedThisMonth).toBe(3);
    expect(w.rows.filter((x) => x.siteId === 's1' && x.status === 'SCHEDULED')).toHaveLength(5);
    // Kullanici taramasi baska musterinin vadesi gecmis yazisina dokunmaz
    expect(w.rows.find((x) => x.id === 'z1')!.status).toBe('SCHEDULED');
  });

  it('tek turda kullanicinin kalan hakkindan fazla takvim yazisi uretime alinmaz', async () => {
    const seed = Array.from({ length: 5 }, (_, i) => ({ id: `d${i}`, siteId: 's1', topic: `Konu ${i}`, status: 'SCHEDULED', scheduledAt: new Date(Date.now() - (10 - i) * 60_000) }));
    const w = ledger('PRO', 38, seed);
    expect(await w.scheduler.processDueArticles()).toEqual({ processed: 2, skippedQuota: 3, skippedBudget: 0, alreadyClaimed: 0, failed: 0 });
    expect(w.users.u1.articlesUsedThisMonth).toBe(40);
    expect(w.rows.filter((r) => r.status === 'SCHEDULED').map((r) => r.id)).toEqual(['d2', 'd3', 'd4']);
  });

  it('son hak icin gecikmeli takvim isi ile saatlik tarama yarisirsa hak asilmaz', async () => {
    const seed = ['a', 'b'].map((id, i) => ({ id, siteId: 's1', topic: `Konu ${id}`, status: 'SCHEDULED', scheduledAt: new Date(Date.now() - (5 - i) * 60_000) }));
    const w = ledger('PRO', HAK - 1, seed);
    await Promise.all([w.scheduler.dispatchScheduledArticle('b'), w.scheduler.processDueArticles()]);
    expect(w.users.u1.articlesUsedThisMonth).toBe(HAK);
    expect(w.generationJobs()).toBe(1);
    expect(w.rows.filter((r) => r.status === 'SCHEDULED')).toHaveLength(1);
  });

  it('dustukten sonra takvime donen yazi (takili uretim supurucusu) bekleyen sayilmaz ve yeniden uretime alinirken ikinci kez dusmez', async () => {
    const w = ledger('PRO', 0);
    expect(await w.schedule()).toBe('ok');
    w.makeDue();
    await w.scheduler.processDueArticles();
    const row = w.rows[0];
    expect(w.users.u1.articlesUsedThisMonth).toBe(1);
    expect(row.agentOutputs).toEqual(CALENDAR_MARK);
    // Supurucu: yazinin canli isi yok → takvime geri koyar (agentOutputs'a dokunmaz)
    row.status = 'SCHEDULED';
    const { added, refusal } = await fill(w);
    expect(added).toBe(HAK - 1);
    expect(refusal.message).toBe(waitingText(HAK - 1, HAK - 1));
    // Hak simdi tamamen dolu olsa da daha once odenmis yazi uretilir ve yeniden dusmez
    w.users.u1.articlesUsedThisMonth = HAK;
    expect(await w.scheduler.processDueArticles()).toMatchObject({ processed: 1 });
    expect(row.status).toBe('GENERATING');
    expect(w.users.u1.articlesUsedThisMonth).toBe(HAK);
  });

  it('Baslangic (STARTER, 11.11.2026): makale uretimi yok — Uret, Simdi uret ve Takvime 403 "bu pakette yok"; tarama ve takvim isi hicbir sey uretmez, sayac 0', async () => {
    expect(findPlan('starter')!.articlesPerMonth).toBe(0);
    const yok = 'Makale üretimi bu pakette yok. Makale üretmek için Profesyonel plana geç.';
    // Denemeden kalan takvim yazisi (vadesi gecmis) ile baslar
    const seed = [{ id: 'k1', siteId: 's1', topic: 'Denemeden kalan konu', status: 'SCHEDULED', scheduledAt: new Date(Date.now() - 3600_000) }];
    const w = ledger('STARTER', 0, seed);
    for (const cagri of [() => w.articles.queueGeneration('s1', 'Elle konu'), () => w.articles.triggerNow('s1', 'k1')]) {
      const err = await cagri().catch((e: any) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.message).toBe(yok);
    }
    const takvime = await w.schedule();
    expect(takvime).toBeInstanceOf(ForbiddenException);
    expect(takvime.message).toBe(yok);
    // Otomasyon bu planda hic uretmez (trial-policy automaticGenerationAllowed): tarama yaziyi
    // almaz, gecikmeli is hakka bile bakmadan doner — deneme hesabiyla ayni yol
    for (let saat = 0; saat < 3; saat++) {
      expect(await w.scheduler.processDueArticles()).toEqual({ processed: 0, skippedQuota: 0, skippedBudget: 0, alreadyClaimed: 0, failed: 0 });
      expect(await w.scheduler.dispatchScheduledArticle('k1')).toEqual({ skipped: true, reason: 'TRIAL_MANUAL_ONLY' });
    }
    expect(w.generationJobs()).toBe(0);
    expect(w.users.u1.articlesUsedThisMonth).toBe(0);
    expect(w.rows.find((r) => r.id === 'k1')!.status).toBe('SCHEDULED');
    // Profesyonel'e gecince ayni yazi ilk taramada uretime alinir
    Object.assign(w.users.u1, { plan: 'PRO', articlesUsedThisMonth: 0 });
    for (const r of w.rows) if (r.site?.userId === 'u1') r.site = { ...r.site, user: { id: 'u1', plan: 'PRO' } };
    expect(await w.scheduler.processDueArticles()).toEqual({ processed: 1, skippedQuota: 0, skippedBudget: 0, alreadyClaimed: 0, failed: 0 });
    expect(w.users.u1.articlesUsedThisMonth).toBe(1);
  });
});

describe('scheduleTopic — icerik tipi karari kayda yazilir (surukle-birak, toplu planlamayla ayni)', () => {
  const RANKED = { tier1Topics: [{ topic: 'Shopify vs WooCommerce', content_type: 'best_for', content_type_source: 'ranker', content_type_v: 1 }], tier2Topics: [], tier3Topics: [] };

  it('acik contentType siralayiciyi ezer', async () => {
    const ctx = build();
    (ctx.prisma as any).topicQueue = { findFirst: vi.fn(async () => RANKED) };
    await ctx.svc.scheduleTopic('s1', { topic: 'Shopify vs WooCommerce', scheduledAt: AT, contentType: 'pricing' });
    expect((ctx.prisma.article.create.mock.calls[0][0] as any).data.agentOutputs).toEqual({ contentPlan: { type: 'pricing', source: 'explicit' } });
  });

  it('acik secim yoksa son kuyruktaki siralayici karari yazilir', async () => {
    const ctx = build();
    (ctx.prisma as any).topicQueue = { findFirst: vi.fn(async () => RANKED) };
    await ctx.svc.scheduleTopic('s1', { topic: 'Shopify vs WooCommerce', scheduledAt: AT });
    expect((ctx.prisma.article.create.mock.calls[0][0] as any).data.agentOutputs).toEqual({ contentPlan: { type: 'best_for', source: 'ranker' } });
  });

  it('karar yoksa (konu kuyrukta degil / eski kuyruk / kuyruk okunamadi) agentOutputs yazilmaz', async () => {
    for (const findFirst of [
      vi.fn(async () => RANKED),
      vi.fn(async () => ({ tier1Topics: [{ topic: 'Konu', schema_type: 'HowTo' }], tier2Topics: [], tier3Topics: [] })),
      vi.fn(async () => { throw new Error('db'); }),
    ]) {
      const ctx = build();
      (ctx.prisma as any).topicQueue = { findFirst };
      await ctx.svc.scheduleTopic('s1', { topic: 'Konu', scheduledAt: AT });
      expect((ctx.prisma.article.create.mock.calls[0][0] as any).data).not.toHaveProperty('agentOutputs');
    }
  });
});


describe('site basina otomatik uretim tavani (08.11.2026 kanit denetimi)', () => {
  /** Durumlu kv_store taklidi: findMany anahtarlari dondurur, $executeRawUnsafe sayaci artirir */
  const kvTaklit = (baslangic: Record<string, number> = {}) => {
    const kv = new Map(Object.entries(baslangic).map(([k, v]) => [k, String(v)]));
    return {
      kv,
      prisma: {
        kvStore: { findMany: vi.fn(async ({ where }: any) => where.key.in.filter((k: string) => kv.has(k)).map((k: string) => ({ key: k, value: kv.get(k) }))) },
        $executeRawUnsafe: vi.fn(async (_sql: string, key: string) => { kv.set(key, String((Number(kv.get(key)) || 0) + 1)); return 1; }),
      },
    };
  };
  const SIMDI = new Date('2026-11-09T07:00:00Z'); // Pazartesi 10:00 TR

  it('gunde 1: bugun bir otomatik uretim olduysa tavan kapali; ertesi gun acilir', async () => {
    const t = kvTaklit({ [sayacAnahtari('s1', '2026-11-09')]: 1 });
    const svc = new ArticleSchedulerService(t.prisma as any, {} as any, {} as any);
    expect(await svc.otoUretimTavaniAcik('s1', SIMDI)).toBe(false);
    expect(await svc.otoUretimTavaniAcik('s1', new Date('2026-11-10T07:00:00Z'))).toBe(true);
    expect(await svc.otoUretimTavaniAcik('s2', SIMDI)).toBe(true);
  });

  it('haftada 5: son 7 TR gununde 5 uretim varsa bugun bos olsa da kapali; 8. gunde dusen gun hesaptan cikar', async () => {
    const gunler = ['2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07'];
    const t = kvTaklit(Object.fromEntries(gunler.map((g) => [sayacAnahtari('s1', g), 1])));
    const svc = new ArticleSchedulerService(t.prisma as any, {} as any, {} as any);
    expect(await svc.otoUretimTavaniAcik('s1', SIMDI)).toBe(false);
    expect(await svc.otoUretimTavaniAcik('s1', new Date('2026-11-10T07:00:00Z'))).toBe(true);
  });

  it('TR gunu: 23:30 UTC ertesi TR gunune sayilir', () => {
    expect(trGunAnahtari(new Date('2026-11-08T21:30:00Z'))).toBe('2026-11-09');
    expect(trGunAnahtari(new Date('2026-11-08T20:30:00Z'))).toBe('2026-11-08');
    expect(tavanAcikMi({ bugun: 0, hafta: 4 })).toBe(true);
    expect(tavanAcikMi({ bugun: 1, hafta: 1 })).toBe(false);
    expect(tavanAcikMi({ bugun: 0, hafta: 5 })).toBe(false);
  });
});
