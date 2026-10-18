import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { BadRequestException, ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import {
  ArticleSchedulerService, DEMO_SITE_URL, DUE_SCAN_LIMITS, SCHEDULED_GENERATION_JOB_PREFIX, isScheduledGenerationJobId, scheduledGenerationJobId,
} from './article-scheduler.service.js';
import { findPlan } from '../billing/plans.js';
import { QuotaService } from '../billing/quota.service.js';

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
  const at = (r: any) => (r.scheduledAt instanceof Date ? r.scheduledAt.getTime() : 0);
  const userOf = (r: any) => r.site?.userId ?? r.site?.user?.id;
  const keyset = (r: any, c: any) => {
    if (c.scheduledAt instanceof Date && at(r) !== c.scheduledAt.getTime()) return false;
    if (c.scheduledAt?.gt instanceof Date && !(at(r) > c.scheduledAt.gt.getTime())) return false;
    if (c.id?.gt !== undefined && !(String(r.id) > String(c.id.gt))) return false;
    return true;
  };
  const s = where.site ?? {};
  const notIn = Array.isArray(s.userId?.notIn) ? new Set(s.userId.notIn) : null;
  let out = rows.filter((r) => {
    if (where.status !== undefined && r.status !== where.status) return false;
    if (where.scheduledAt?.lte instanceof Date && !(at(r) <= where.scheduledAt.lte.getTime())) return false;
    if (s.autopilot !== undefined && r.site?.autopilot !== s.autopilot) return false;
    if (s.url?.not !== undefined && r.site?.url === s.url.not) return false;
    if (notIn && notIn.has(userOf(r))) return false;
    if (Array.isArray(where.OR) && !where.OR.some((c: any) => keyset(r, c))) return false;
    return true;
  });
  if (Array.isArray(args?.orderBy)) {
    out = [...out].sort((x, y) => at(x) - at(y) || (String(x.id) < String(y.id) ? -1 : String(x.id) > String(y.id) ? 1 : 0));
  }
  return typeof args?.take === 'number' ? out.slice(0, args.take) : out;
}

function build(opts: { site?: SiteRow; articles?: any[]; due?: any[]; quota?: any } = {}) {
  const site = opts.site ?? SITE();
  // Saatlik taramanin buldugu yazilar da ayni "tabloda": kosullu guncelleme onlari gorur
  const articles = [...(opts.articles ?? []), ...(opts.due ?? [])];
  const prisma = {
    site: { findUniqueOrThrow: vi.fn(async () => site) },
    article: {
      create: vi.fn(async ({ data }: any) => ({ id: 'a-new', ...data })),
      count: vi.fn(async () => 0),
      findMany: vi.fn<(args: any) => Promise<any[]>>(async (args: any) => queryDue(articles, args)),
      findFirst: vi.fn(async ({ where }: any) => articles.find((a) => a.id === where.id && a.siteId === where.siteId) ?? null),
      findUnique: vi.fn<(args: any) => Promise<any>>(async ({ where }: any) => articles.find((a) => a.id === where.id) ?? null),
      update: vi.fn(async ({ where, data }: any) => ({ ...articles.find((a) => a.id === where.id), ...data })),
      // Kosullu guncelleme: yalniz where.status hala gecerliyse yazar (tek SQL UPDATE gibi)
      updateMany: vi.fn<(args: any) => Promise<{ count: number }>>(async ({ where, data }: any) => {
        const row = articles.find((a) => a.id === where.id && (where.status === undefined || a.status === where.status));
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }),
      deleteMany: vi.fn(async ({ where }: any) => ({ count: articles.some((a) => a.id === where.id && a.siteId === where.siteId && a.status === where.status) ? 1 : 0 })),
    },
  };
  const jobQueue = {
    enqueue: vi.fn<(opts: any) => Promise<unknown>>(async () => ({ dbJobId: 'j1', bullJobId: 'b1' })),
    removeJob: vi.fn<(id: string) => Promise<boolean>>(async () => true),
  };
  const quota = opts.quota ?? { checkArticleQuota: vi.fn(async () => ({ allowed: true, remaining: 10, limit: 15 })) };
  const svc = new ArticleSchedulerService(prisma as any, jobQueue as any, quota as any);
  return { svc, prisma, jobQueue, quota };
}

type UserRow = { plan: string; articlesUsedThisMonth: number; articlesQuotaResetAt: Date };

/**
 * GERCEK QuotaService (ay basi sifirlamasi dahil) + bellek ici kullanici
 * tablosu. Okuma kopya doner: servis, gercek Prisma'daki gibi okudugu eski
 * satiri elinde tutar (sifirlamadan sonra yeniden okumaz).
 */
function realQuota(users: Record<string, UserRow>) {
  const prisma = {
    user: {
      findUniqueOrThrow: vi.fn(async ({ where }: any) => {
        const row = users[where.id];
        if (!row) throw new Error('No User found');
        return { id: where.id, ...row };
      }),
      update: vi.fn(async ({ where, data }: any) => {
        Object.assign(users[where.id], data);
        return { id: where.id, ...users[where.id] };
      }),
    },
  };
  const quota = new QuotaService(prisma as any);
  const check = vi.spyOn(quota, 'checkArticleQuota');
  return { quota, check, prisma };
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
    expect(where.site).toEqual({ autopilot: true, url: { not: DEMO_SITE_URL } });
    // Tek kaynak: demo kurucusu ayni adresi yaziyor
    const seeder = readFileSync(new URL('../sites/demo-seeder.service.ts', import.meta.url), 'utf8');
    expect(seeder).toContain(`url: '${DEMO_SITE_URL}'`);
    expect(seeder).toMatch(/autopilot: true/);
  });

  it('Yari otomatikte uretilir ama yayinlanmaz; Tam otomatikte varsayilan hedefe yayin istenir', async () => {
    const manual = build({ due: [due({ mode: 'manual_approve' })] });
    await manual.svc.processDueArticles();
    expect((manual.jobQueue.enqueue.mock.calls[0][0] as any).payload).toMatchObject({ articleId: 'a1', autoPublish: false, targetIds: ['t1'] });
    // Sahiplenme KOSULLU: yalniz hala SCHEDULED ise (eskiden kosulsuz update)
    expect(manual.prisma.article.updateMany).toHaveBeenCalledWith({ where: { id: 'a1', status: 'SCHEDULED' }, data: { status: 'GENERATING' } });
    expect(manual.prisma.article.update).not.toHaveBeenCalled();

    const auto = build({ due: [due({ mode: 'auto_publish' })] });
    await auto.svc.processDueArticles();
    expect((auto.jobQueue.enqueue.mock.calls[0][0] as any).payload).toMatchObject({ autoPublish: true, targetIds: ['t1'] });
  });

  describe('makale hakki — QuotaService (ay basi sifirlamasi dahil)', () => {
    it('YENI AY: gecen ay sinira dayanmis ucretli musterinin takvim yazisi uretilir (eskiden "kota dolu" diye atlaniyordu)', async () => {
      const users = { u1: { plan: 'PRO', articlesUsedThisMonth: 40, articlesQuotaResetAt: LAST_MONTH } };
      const { quota, check } = realQuota(users);
      const ctx = build({ due: [due()], quota });
      expect(await ctx.svc.processDueArticles()).toEqual({ processed: 1, skippedQuota: 0, alreadyClaimed: 0, failed: 0 });
      expect(ctx.jobQueue.enqueue).toHaveBeenCalledTimes(1);
      // Sayac ay basi sifirlandi...
      expect(users.u1.articlesUsedThisMonth).toBe(0);
      expect(users.u1.articlesQuotaResetAt.getMonth()).toBe(NOW.getMonth());
      // ...ve checkArticleQuota sifirlamadan sonra satiri yeniden okudugu icin tek soru yetti
      expect(check).toHaveBeenCalledTimes(1);
      expect(check).toHaveBeenNthCalledWith(1, 'u1');
    });

    it('AYNI AY: kendi uretimleri hakki doldurduysa yazi bekler (SCHEDULED kalir, kuyruga girmez)', async () => {
      const users = { u1: { plan: 'PRO', articlesUsedThisMonth: 40, articlesQuotaResetAt: new Date() } };
      const { quota } = realQuota(users);
      const ctx = build({ due: [due()], quota });
      expect(await ctx.svc.processDueArticles()).toEqual({ processed: 0, skippedQuota: 1, alreadyClaimed: 0, failed: 0 });
      expect(ctx.jobQueue.enqueue).not.toHaveBeenCalled();
      expect(ctx.prisma.article.updateMany).not.toHaveBeenCalled();
      expect(users.u1.articlesUsedThisMonth).toBe(40);
    });

    it('deneme hesabi: hak ay basi sifirlanmaz (omur boyu 2); hakki kalan deneme hesabinin yazisi uretilir', async () => {
      const full = { u1: { plan: 'TRIAL', articlesUsedThisMonth: 2, articlesQuotaResetAt: LAST_YEAR } };
      const a = build({ due: [due()], quota: realQuota(full).quota });
      expect(await a.svc.processDueArticles()).toEqual({ processed: 0, skippedQuota: 1, alreadyClaimed: 0, failed: 0 });
      expect(full.u1.articlesUsedThisMonth).toBe(2);

      const left = { u1: { plan: 'TRIAL', articlesUsedThisMonth: 1, articlesQuotaResetAt: LAST_YEAR } };
      const b = build({ due: [due()], quota: realQuota(left).quota });
      expect(await b.svc.processDueArticles()).toEqual({ processed: 1, skippedQuota: 0, alreadyClaimed: 0, failed: 0 });
    });

    it('hak tablosu elle uretimi kesen kuralla ayni: Buyume (STARTER) 15 (plans.ts = QuotaService.LIMITS)', async () => {
      const starter = findPlan('starter')!.articlesPerMonth;
      expect(starter).toBe(15);
      const under = build({ due: [due()], quota: realQuota({ u1: { plan: 'STARTER', articlesUsedThisMonth: starter - 1, articlesQuotaResetAt: new Date() } }).quota });
      expect((await under.svc.processDueArticles()).processed).toBe(1);
      const full = build({ due: [due()], quota: realQuota({ u1: { plan: 'STARTER', articlesUsedThisMonth: starter, articlesQuotaResetAt: new Date() } }).quota });
      expect((await full.svc.processDueArticles()).skippedQuota).toBe(1);
    });

    it('takvim uretimi hakka sayilmaz ve hak kullanici basina bir kez sorulur', async () => {
      const users = { u1: { plan: 'PRO', articlesUsedThisMonth: 3, articlesQuotaResetAt: new Date() } };
      const { quota, check } = realQuota(users);
      const ctx = build({ due: [due({ id: 'a1' }), due({ id: 'a2' }), due({ id: 'a3' })], quota });
      expect(await ctx.svc.processDueArticles()).toEqual({ processed: 3, skippedQuota: 0, alreadyClaimed: 0, failed: 0 });
      expect(check).toHaveBeenCalledTimes(1);
      expect(users.u1.articlesUsedThisMonth).toBe(3);
    });

    it('hak okunamazsa yazi SCHEDULED kalir (failed); diger kullanicilarin yazilari islenir', async () => {
      const users = { u2: { plan: 'PRO', articlesUsedThisMonth: 0, articlesQuotaResetAt: new Date() } };
      const { quota } = realQuota(users); // u1 tabloda yok → findUniqueOrThrow hata
      const ctx = build({ due: [due({ id: 'a1', userId: 'u1' }), due({ id: 'a2', userId: 'u2' })], quota });
      expect(await ctx.svc.processDueArticles()).toEqual({ processed: 1, skippedQuota: 0, alreadyClaimed: 0, failed: 1 });
      expect(ctx.jobQueue.enqueue).toHaveBeenCalledTimes(1);
      expect((ctx.jobQueue.enqueue.mock.calls[0][0] as any).payload.articleId).toBe('a2');
    });

    it('bilinmeyen plan: sessizce sinirsiz olmaz (uretilmez)', async () => {
      const ctx = build({ due: [due()], quota: realQuota({ u1: { plan: 'GOLD', articlesUsedThisMonth: 0, articlesQuotaResetAt: new Date() } }).quota });
      const r = await ctx.svc.processDueArticles();
      expect(r.processed).toBe(0);
      expect(ctx.jobQueue.enqueue).not.toHaveBeenCalled();
    });
  });

  it('yaziyi gecikmeli takvim isi ya da "Simdi uret" once aldiysa (count 0) ikinci kez kuyruga atilmaz', async () => {
    const ctx = build({ due: [due()] });
    ctx.prisma.article.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await ctx.svc.processDueArticles()).toEqual({ processed: 0, skippedQuota: 0, alreadyClaimed: 1, failed: 0 });
    expect(ctx.jobQueue.enqueue).not.toHaveBeenCalled();
  });

  it('kuyruga atilamazsa sahiplik birakilir (SCHEDULED) ve diger yazilar islenmeye devam eder', async () => {
    const second = { ...due(), id: 'a2' };
    const ctx = build({ due: [due(), second] });
    ctx.jobQueue.enqueue.mockRejectedValueOnce(new Error('redis yok'));
    const r = await ctx.svc.processDueArticles();
    expect(r).toEqual({ processed: 1, skippedQuota: 0, alreadyClaimed: 0, failed: 1 });
    // Eskiden yazi kalici olarak GENERATING'de ("Uretiliyor") kaliyordu
    expect(ctx.prisma.article.updateMany).toHaveBeenCalledWith({ where: { id: 'a1', status: 'GENERATING' }, data: { status: 'SCHEDULED' } });
    expect(ctx.jobQueue.enqueue).toHaveBeenCalledTimes(2);
    expect((ctx.jobQueue.enqueue.mock.calls[1][0] as any).payload.articleId).toBe('a2');
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
      expect(r).toEqual({ processed: 5, skippedQuota: 55, alreadyClaimed: 0, failed: 0 });
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
      expect(r).toEqual({ processed: 0, skippedQuota: 0, alreadyClaimed: 0, failed: 60 });
      expect(ctx.jobQueue.enqueue).toHaveBeenCalledTimes(60);
      expect(ctx.prisma.article.findMany).toHaveBeenCalledTimes(2);
      expect(rows.every((x) => x.status === 'SCHEDULED')).toBe(true);
    });

    it('hakki okunamayan kullanicinin hakki turda bir kez sorulur; diger yazilari da bekler', async () => {
      const rows = [row(1, 'flaky'), row(2, 'flaky'), row(3, 'flaky'), row(4, 'ok')];
      const quota = {
        checkArticleQuota: vi.fn(async (userId: string) => {
          if (userId === 'flaky') throw new Error('db zaman asimi');
          return { allowed: true, remaining: 10, limit: 15 };
        }),
      };
      const ctx = build({ due: rows, quota });
      expect(await ctx.svc.processDueArticles()).toEqual({ processed: 1, skippedQuota: 0, alreadyClaimed: 0, failed: 3 });
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
      expect(await ctx.svc.processDueArticles()).toEqual({ processed: 0, skippedQuota: 0, alreadyClaimed: 0, failed: 0 });
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
    expect(ctx.prisma.article.updateMany).toHaveBeenCalledWith({ where: { id: 'a1', status: 'SCHEDULED' }, data: { status: 'GENERATING' } });
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

  it('okuma ile yazma arasinda kaybedilen yaris (count 0): kuyruga atilmaz', async () => {
    const ctx = build({ articles: [SCHEDULED()] });
    ctx.prisma.article.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await ctx.svc.dispatchScheduledArticle('a1')).toEqual({ skipped: true, reason: 'ALREADY_CLAIMED' });
    expect(ctx.jobQueue.enqueue).not.toHaveBeenCalled();
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

  it('kuyruga atilamazsa sahiplik birakilir ve hata firlar (BullMQ takvim isini yeniden dener)', async () => {
    const row = SCHEDULED();
    const ctx = build({ articles: [row] });
    ctx.jobQueue.enqueue.mockRejectedValueOnce(new Error('redis yok'));
    await expect(ctx.svc.dispatchScheduledArticle('a1')).rejects.toThrow('redis yok');
    expect(row.status).toBe('SCHEDULED');
    // Yeniden deneme yeniden sahiplenebilir
    expect(await ctx.svc.dispatchScheduledArticle('a1')).toMatchObject({ dispatched: true });
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

  it('yazi hala SCHEDULED (sahiplik birakilmis): once sahiplenir; baskasi aldiysa uretmez', async () => {
    const row = { id: 'a1', siteId: 's1', status: 'SCHEDULED' };
    const ctx = build({ articles: [row] });
    expect(await ctx.svc.claimForGeneration('a1')).toBe('proceed');
    expect(row.status).toBe('GENERATING');
    const lost = build({ articles: [{ id: 'a1', siteId: 's1', status: 'SCHEDULED' }] });
    lost.prisma.article.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await lost.svc.claimForGeneration('a1')).toBe('already_claimed');
  });

  it('silinmis yazi: LLM maliyeti harcanmadan doner', async () => {
    expect(await build().svc.claimForGeneration('yok')).toBe('article_missing');
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
    expect(src).toMatch(/import \{ ArticleSchedulerService, isScheduledGenerationJobId \} from '\.\.\/\.\.\/api\/dist\/articles\/article-scheduler\.service\.js'/);
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

  it('kendi uretimleri hakki doldurduysa 403; metin her planda dogru (deneme hesabinin hakki "aylik" degil)', async () => {
    const quota = { checkArticleQuota: vi.fn(async () => ({ allowed: false, remaining: 0, limit: 2 })) };
    const { svc, prisma } = build({ quota });
    const err = await svc.scheduleTopic('s1', { topic: 'Konu', scheduledAt: AT }).catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.message).toBe('Makale hakkın doldu (2 makale). Yeni yazıyı takvime eklemek için planını yükseltebilirsin.');
    expect(err.message).not.toMatch(/makale\/ay/);
    expect(prisma.article.create).not.toHaveBeenCalled();
  });

  it('kalan hak bekleyen yazilara ayrildiysa 403 ve ne yapilabilecegi', async () => {
    const quota = { checkArticleQuota: vi.fn(async () => ({ allowed: true, remaining: 2, limit: 15 })) };
    const ctx = build({ quota });
    ctx.prisma.article.count.mockResolvedValueOnce(2);
    const err = await ctx.svc.scheduleTopic('s1', { topic: 'Konu', scheduledAt: AT }).catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.message).toBe(
      'Kalan makale hakkın 2; takvimde, üretimde ya da onayda bekleyen 2 yazı var. '
      + 'Yeni yazı eklemek için bekleyen yazıları yayınla ya da takvimden çıkar; daha fazlası için planını yükseltebilirsin.',
    );
    expect(ctx.prisma.article.create).not.toHaveBeenCalled();
  });
});

describe('takvim metinleri — eski "deneme hesabi paket bekler" iddiasi', () => {
  const scheduler = readFileSync(new URL('./article-scheduler.service.ts', import.meta.url), 'utf8');
  const worker = readFileSync(new URL('../../../worker/src/index.ts', import.meta.url), 'utf8');

  it('takvim yazilari "paket bekler" denmez: takvim uretimi hakka sayilmaz, deneme hesabi da yalniz kendi uretimleri hakki doldurursa bekler', () => {
    for (const src of [scheduler, worker]) {
      expect(src).not.toMatch(/paket gerekli|paket bekliyor|paket alinmasini bekler/);
    }
  });

  it('onboarding: ilk makale her planda hemen uretilir ve hakka sayilmaz (sayac artirilmaz)', async () => {
    const site = { ...SITE(), user: { plan: 'TRIAL' } };
    const quota = { checkArticleQuota: vi.fn(), incrementArticleUsage: vi.fn() };
    const ctx = build({ site: site as any, quota });
    (ctx.prisma as any).topicQueue = { findFirst: vi.fn(async () => ({ tier1Topics: [{ topic: 'A' }, { topic: 'B' }, { topic: 'C' }] })) };
    const r = await ctx.svc.scheduleInitialBatch('s1', { count: 3 });
    expect(r).toMatchObject({ scheduled: 3, isTrial: true });
    expect(ctx.jobQueue.enqueue).toHaveBeenCalledTimes(1);
    expect((ctx.jobQueue.enqueue.mock.calls[0][0] as any).payload).toMatchObject({ topic: 'A', autoPublish: false });
    expect(ctx.prisma.article.create.mock.calls.map((c: any) => c[0].data.status)).toEqual(['GENERATING', 'SCHEDULED', 'SCHEDULED']);
    expect(quota.checkArticleQuota).not.toHaveBeenCalled();
    expect(quota.incrementArticleUsage).not.toHaveBeenCalled();
  });
});
