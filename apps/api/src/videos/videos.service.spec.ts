import { describe, expect, it, vi } from 'vitest';
import { ConflictException, ForbiddenException, NotFoundException, ServiceUnavailableException, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { QuotaService } from '../billing/quota.service.js';
import { PlanFeatureGuard } from '../billing/plan-feature.guard.js';
import { VideosService } from './videos.service.js';
import { VideosController } from './videos.controller.js';
import { RequestVideoDto } from './videos.dto.js';
import { ARTICLE_SHORT_ENGINE } from './article-video.config.js';
import { QueueTimeoutError, VideoRenderQueue } from './video-render.queue.js';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * RanksUp Video istek / silme (API sureci). Gercek QuotaService (kosullu UPDATE) + bellek ici
 * sahte tablo. Kapilar: plan (istek sahibi + site sahibi), makale yayinda, ayni makale icin
 * suren video yok, aylik hak; kuyruk hatasi -> FAILED + iade. Deneme / Buyume'de hicbir sey
 * kuyruga girmez ve sayac degismez.
 */

const SITE = 'cmsite000000000000000001';
const ART = 'cmart0000000000000000001';

function world(opts: { plan?: string; role?: string; used?: number; articleStatus?: string; queueFails?: boolean } = {}) {
  const user: any = { id: 'u1', plan: opts.plan ?? 'PRO', role: opts.role ?? 'USER', videosUsedThisMonth: opts.used ?? 0, articlesUsedThisMonth: 0, articlesQuotaResetAt: new Date(), aiCostThisMonthUsd: 0 };
  const videos: any[] = [];
  const kv = new Map<string, { expiresAt: Date | null }>();
  let n = 0;
  const prisma: any = {
    user: {
      findUniqueOrThrow: vi.fn(async () => ({ ...user })),
      update: vi.fn(async ({ data }: any) => Object.assign(user, data)),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const c = where.videosUsedThisMonth ?? {};
        if (c.lt !== undefined && !(user.videosUsedThisMonth < c.lt)) return { count: 0 };
        if (c.gt !== undefined && !(user.videosUsedThisMonth > c.gt)) return { count: 0 };
        const d = data.videosUsedThisMonth;
        user.videosUsedThisMonth += typeof d?.increment === 'number' ? d.increment : -(d?.decrement ?? 0);
        return { count: 1 };
      }),
    },
    site: { findUnique: vi.fn(async () => ({ id: SITE, url: 'https://ornek.com', name: 'Örnek', userId: 'u1', user: { id: 'u1', plan: user.plan, role: user.role } })) },
    article: { findFirst: vi.fn(async ({ where }: any) => (where.id === ART && where.siteId === SITE ? { id: ART, title: 'Makale', status: opts.articleStatus ?? 'PUBLISHED', language: 'tr' } : null)) },
    kvStore: {
      create: vi.fn(async ({ data }: any) => {
        if (kv.has(data.key)) throw new Error('Unique constraint failed');
        kv.set(data.key, { expiresAt: data.expiresAt });
        return data;
      }),
      deleteMany: vi.fn(async ({ where }: any) => {
        const e = kv.get(where.key);
        if (!e) return { count: 0 };
        if (where.expiresAt?.lt && !(e.expiresAt && e.expiresAt < where.expiresAt.lt)) return { count: 0 };
        kv.delete(where.key);
        return { count: 1 };
      }),
    },
    video: {
      findFirst: vi.fn(async ({ where }: any) => videos.find((v) => (!where.id || v.id === where.id) && (!where.articleId || v.articleId === where.articleId) && (!where.status?.in || where.status.in.includes(v.status)) && (!where.siteId || v.siteId === where.siteId)) ?? null),
      findMany: vi.fn(async ({ where }: any) => videos.filter((v) => v.siteId === where.siteId && v.providerRaw?.engine === where.providerRaw?.equals)),
      create: vi.fn(async ({ data }: any) => {
        const v = { id: `cmvideo00000000000000000${++n}`, createdAt: new Date(), updatedAt: new Date(), durationSec: null, videoUrl: null, thumbnailUrl: null, fileSize: null, errorMsg: null, completedAt: null, ...data };
        videos.push(v);
        return { ...v };
      }),
      update: vi.fn(async ({ where, data }: any) => Object.assign(videos.find((v) => v.id === where.id), data)),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const v = videos.find((x) => x.id === where.id && (!where.status || x.status === where.status));
        if (!v) return { count: 0 };
        Object.assign(v, data);
        return { count: 1 };
      }),
      deleteMany: vi.fn(async ({ where }: any) => {
        const i = videos.findIndex((x) => x.id === where.id && (!where.status || x.status === where.status));
        if (i < 0) return { count: 0 };
        videos.splice(i, 1);
        return { count: 1 };
      }),
    },
  };
  const quota = new QuotaService(prisma);
  const queue = {
    add: vi.fn(async (id: string) => {
      if (opts.queueFails) throw new Error('Redis yok');
      return id;
    }),
    remove: vi.fn(async () => true),
    state: vi.fn(async () => 'waiting'),
  };
  const svc = new VideosService(prisma, quota, queue as any);
  return { svc, prisma, user, videos, queue, kv };
}

const me = { id: 'u1', role: 'USER' };

describe('VideosService.request', () => {
  it('Profesyonel: hak duser, Video satiri PENDING + engine, is kuyruga girer (is kimligi = video)', async () => {
    const w = world({ used: 3 });
    const r = await w.svc.request(SITE, me, { articleId: ART, primaryColor: '#1D4ED8', useLogo: false, brandName: ' Örnek  Klinik ' });
    expect(r).toMatchObject({ remaining: 16, limit: 20, video: { status: 'queued', videoUrl: null } });
    expect(w.user.videosUsedThisMonth).toBe(4);
    expect(w.videos[0]).toMatchObject({ status: 'PENDING', provider: 'SLIDESHOW', aspectRatio: '9:16', articleId: ART, jobId: w.videos[0].id });
    expect(w.videos[0].providerRaw).toMatchObject({ engine: ARTICLE_SHORT_ENGINE, charged: true, chargedUserId: 'u1', request: { primaryColor: '#1d4ed8', useLogo: false, brandName: 'Örnek Klinik' } });
    expect(w.queue.add).toHaveBeenCalledWith(w.videos[0].id);
    expect(w.kv.size).toBe(0); // istek kilidi birakildi
  });

  it.each(['TRIAL', 'STARTER'])('%s: 403 kilit; hak dusmez, satir acilmaz, kuyruga hicbir sey girmez', async (plan) => {
    const w = world({ plan });
    await expect(w.svc.request(SITE, me, { articleId: ART })).rejects.toThrow(/RanksUp Video Profesyonel planına dahildir/);
    expect(w.user.videosUsedThisMonth).toBe(0);
    expect(w.videos).toHaveLength(0);
    expect(w.queue.add).not.toHaveBeenCalled();
    // Marka onizlemesi de (dis indirme) kilitli
    await expect(w.svc.brandPreview(SITE)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('yayinda olmayan makale 409; baska sitenin makalesi 404 — hak dusmez', async () => {
    const w = world({ articleStatus: 'READY_TO_PUBLISH' });
    await expect(w.svc.request(SITE, me, { articleId: ART })).rejects.toBeInstanceOf(ConflictException);
    await expect(w.svc.request(SITE, me, { articleId: 'cmbaskasitenin0000000001' })).rejects.toBeInstanceOf(NotFoundException);
    expect(w.user.videosUsedThisMonth).toBe(0);
  });

  it('ayni makale icin suren video varken ikinci istek 409, ikinci kez hak dusmez', async () => {
    const w = world();
    await w.svc.request(SITE, me, { articleId: ART });
    await expect(w.svc.request(SITE, me, { articleId: ART })).rejects.toThrow(/zaten hazırlanıyor/);
    expect(w.user.videosUsedThisMonth).toBe(1);
    expect(w.videos).toHaveLength(1);
  });

  it('es zamanli cift tiklama: tek video, tek hak (istek kilidi)', async () => {
    const w = world();
    const rs = await Promise.allSettled([w.svc.request(SITE, me, { articleId: ART }), w.svc.request(SITE, me, { articleId: ART })]);
    expect(rs.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(w.videos).toHaveLength(1);
    expect(w.user.videosUsedThisMonth).toBe(1);
  });

  it('hak doluysa 403 ve satir acilmaz', async () => {
    const w = world({ used: 20 });
    await expect(w.svc.request(SITE, me, { articleId: ART })).rejects.toThrow(/Bu ayki 20 video hakkını kullandın/);
    expect(w.videos).toHaveLength(0);
  });

  it('kuyruga eklenemezse: satir FAILED, hak iade, 503 Turkce mesaj', async () => {
    const w = world({ queueFails: true, used: 5 });
    await expect(w.svc.request(SITE, me, { articleId: ART })).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(w.videos[0]).toMatchObject({ status: 'FAILED', errorMsg: 'Video sıraya alınamadı; hakkın iade edildi. Biraz sonra tekrar dene.' });
    expect(w.user.videosUsedThisMonth).toBe(5);
    expect(w.kv.size).toBe(0);
  });

  it('ADMIN sahibi: sayac artmaz (charged=false)', async () => {
    const w = world({ plan: 'TRIAL', role: 'ADMIN' });
    await w.svc.request(SITE, { id: 'u1', role: 'ADMIN' }, { articleId: ART });
    expect(w.user.videosUsedThisMonth).toBe(0);
    expect(w.videos[0].providerRaw.charged).toBe(false);
  });
});

describe('VideosService.remove', () => {
  it('kuyruktaki video silinince is iptal edilir ve hak iade edilir', async () => {
    const w = world({ used: 2 });
    const { video } = await w.svc.request(SITE, me, { articleId: ART });
    expect(w.user.videosUsedThisMonth).toBe(3);
    await expect(w.svc.remove(SITE, video.id)).resolves.toEqual({ ok: true, refunded: true });
    expect(w.queue.remove).toHaveBeenCalledWith(video.id);
    expect(w.user.videosUsedThisMonth).toBe(2);
    expect(w.videos).toHaveLength(0);
  });

  it('uretimdeki video silinemez (409); hazir video silinir, hak iade edilmez', async () => {
    const w = world({ used: 1 });
    const { video } = await w.svc.request(SITE, me, { articleId: ART });
    w.videos[0].status = 'GENERATING';
    await expect(w.svc.remove(SITE, video.id)).rejects.toBeInstanceOf(ConflictException);
    w.videos[0].status = 'READY';
    await expect(w.svc.remove(SITE, video.id)).resolves.toEqual({ ok: true, refunded: false });
    expect(w.user.videosUsedThisMonth).toBe(2);
  });

  it('liste yalniz bu ozelligin satirlarini doner (eski Video Factory satirlari degil)', async () => {
    const w = world();
    w.videos.push({ id: 'eski', siteId: SITE, providerRaw: { foo: 1 }, status: 'READY', createdAt: new Date() });
    await w.svc.request(SITE, me, { articleId: ART });
    const list = await w.svc.list(SITE);
    expect(list.map((v) => v.id)).toEqual([w.videos[1].id]);
    expect(w.prisma.video.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { siteId: SITE, providerRaw: { path: '$.engine', equals: ARTICLE_SHORT_ENGINE } } }));
  });
});

describe('controller kapilari', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const body = (v: unknown) => pipe.transform(v, { type: 'body', metatype: RequestVideoDto, data: '' });

  it('POST ve marka onizlemesi plana bagli (articleVideo); liste / kota acik', () => {
    const r = new Reflector();
    const meta = (k: keyof VideosController) => r.get('planFeature', VideosController.prototype[k] as any);
    expect(meta('request')).toBe('articleVideo');
    expect(meta('brand')).toBe('articleVideo');
    expect(meta('list')).toBeUndefined();
    expect(meta('quota')).toBeUndefined();
    expect(meta('remove')).toBeUndefined();
  });

  it('PlanFeatureGuard: Buyume istegi 403, Profesyonel gecer', () => {
    const quota = new QuotaService({} as any);
    const guard = new PlanFeatureGuard(new Reflector(), quota);
    const ctx = (plan: string) => ({
      getHandler: () => VideosController.prototype.request,
      getClass: () => VideosController,
      switchToHttp: () => ({ getRequest: () => ({ user: { id: 'u1', plan, role: 'USER' } }) }),
    }) as any;
    expect(() => guard.canActivate(ctx('STARTER'))).toThrow(ForbiddenException);
    expect(guard.canActivate(ctx('PRO'))).toBe(true);
  });

  it('govde: gecersiz renk / kimlik / bilinmeyen alan 400', async () => {
    await expect(body({ articleId: ART, primaryColor: 'red' })).rejects.toBeTruthy();
    await expect(body({ articleId: 'ABC DEF' })).rejects.toBeTruthy();
    await expect(body({ articleId: ART, yetki: 'admin' })).rejects.toBeTruthy();
    await expect(body({ articleId: ART, primaryColor: null, useLogo: false })).resolves.toMatchObject({ primaryColor: null, useLogo: false });
  });
});

/**
 * Tempo (21.10.2026): yeni istekte varsayilan 'normal'; secilen tempo providerRaw.tempo'da durur;
 * her tempo tek video hakki; gecersiz tempo 400. Liste tempoyu ve gercek sureyi doner; tempo alani
 * olmayan eski satir 'fast' (eski 15 sn izgarayla uretildi).
 */
describe('tempo', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const body = (v: unknown) => pipe.transform(v, { type: 'body', metatype: RequestVideoDto, data: '' });

  it('verilmezse normal; secilen tempo kayitta; her tempo TEK hak', async () => {
    const w = world({ used: 0 });
    const a = await w.svc.request(SITE, me, { articleId: ART });
    expect(w.videos[0].providerRaw.tempo).toBe('normal');
    expect(a.video.tempo).toBe('normal');
    expect(w.user.videosUsedThisMonth).toBe(1);
    const s = await w.svc.request(SITE, me, { type: 'site', format: 'horizontal', tempo: 'slow' });
    expect(w.videos[1].providerRaw).toMatchObject({ videoType: 'site', format: 'horizontal', tempo: 'slow' });
    expect(s.video.tempo).toBe('slow');
    expect(w.user.videosUsedThisMonth).toBe(2);
    await w.svc.request(SITE, me, { type: 'site', format: 'vertical', tempo: 'fast' });
    expect(w.videos[2].providerRaw.tempo).toBe('fast');
    expect(w.user.videosUsedThisMonth).toBe(3);
  });

  it('gecersiz tempo: DTO 400; servis dogrudan cagrilsa da 400 ve hak dusmez', async () => {
    await expect(body({ articleId: ART, tempo: 'turbo' })).rejects.toBeTruthy();
    await expect(body({ type: 'site', tempo: 'SLOW' })).rejects.toBeTruthy();
    await expect(body({ articleId: ART, tempo: 'slow' })).resolves.toMatchObject({ tempo: 'slow' });
    await expect(body({ type: 'product', pageUrl: 'https://ornek.com/u', tempo: 'fast' })).resolves.toMatchObject({ tempo: 'fast' });
    const w = world();
    await expect(w.svc.request(SITE, me, { articleId: ART, tempo: 'turbo' as any })).rejects.toThrow(/tempo 'fast', 'normal' ya da 'slow'/);
    expect(w.user.videosUsedThisMonth).toBe(0);
    expect(w.videos).toHaveLength(0);
  });

  it('liste tempoyu ve gercek sureyi doner; tempo alani olmayan eski satir fast', async () => {
    const w = world();
    w.videos.push({ id: 'cmeski00000000000000001', siteId: SITE, articleId: ART, title: 'Eski', status: 'READY', durationSec: 15, providerRaw: { engine: ARTICLE_SHORT_ENGINE }, createdAt: new Date(), completedAt: new Date() });
    w.videos.push({ id: 'cmyeni00000000000000001', siteId: SITE, articleId: ART, title: 'Yeni', status: 'READY', durationSec: 38, providerRaw: { engine: ARTICLE_SHORT_ENGINE, tempo: 'slow' }, createdAt: new Date(), completedAt: new Date() });
    const list = await w.svc.list(SITE);
    expect(list.map((v) => [v.title, v.tempo, v.durationSec])).toEqual([['Eski', 'fast', 15], ['Yeni', 'slow', 38]]);
  });
});

/**
 * Gorsel stil (23.10.2026): yeni istekte varsayilan 'classic' (bugunku tasarim); secilen stil
 * providerRaw.style'da durur; her stil tek video hakki; liste disi stil 400 (DTO ve servis). Liste stili
 * doner; stil alani olmayan eski satir 'classic'.
 */
describe('stil', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const body = (v: unknown) => pipe.transform(v, { type: 'body', metatype: RequestVideoDto, data: '' });

  it('verilmezse classic; secilen stil kayitta ve gorunumde; her stil TEK hak; tempoyla birlikte', async () => {
    const w = world({ used: 0 });
    const a = await w.svc.request(SITE, me, { articleId: ART });
    expect(w.videos[0].providerRaw).toMatchObject({ style: 'classic', tempo: 'normal' });
    expect(a.video.style).toBe('classic');
    const s = await w.svc.request(SITE, me, { type: 'site', format: 'horizontal', tempo: 'slow', style: 'footage' });
    expect(w.videos[1].providerRaw).toMatchObject({ videoType: 'site', format: 'horizontal', tempo: 'slow', style: 'footage' });
    expect(s.video).toMatchObject({ style: 'footage', tempo: 'slow' });
    await w.svc.request(SITE, me, { type: 'product', pageUrl: 'https://ornek.com/urun/termos', style: 'paper' });
    expect(w.videos[2].providerRaw.style).toBe('paper');
    expect(w.user.videosUsedThisMonth).toBe(3);
  });

  it('DTO: yedi stil kabul, liste disi / buyuk harf / yol 400 (Turkce mesaj); servis dogrudan cagrilsa da 400 ve hak dusmez', async () => {
    for (const style of ['classic', 'panel', 'paper', 'swiss', 'chat', 'diagram', 'footage']) {
      await expect(body({ articleId: ART, style })).resolves.toMatchObject({ style });
    }
    for (const style of ['Panel', 'neon', '../footage', '', 3]) {
      await expect(body({ articleId: ART, style })).rejects.toMatchObject({ response: { message: [expect.stringMatching(/^style 'classic', 'panel', .* ya da 'footage' olmalı\.$/)] } });
    }
    const w = world();
    await expect(w.svc.request(SITE, me, { articleId: ART, style: 'neon' as any })).rejects.toThrow(/style 'classic'.* ya da 'footage' olmalı/);
    expect(w.user.videosUsedThisMonth).toBe(0);
    expect(w.videos).toHaveLength(0);
  });

  it('liste stili doner; stil alani olmayan eski satir ve bozuk deger classic', async () => {
    const w = world();
    w.videos.push({ id: 'cmeski00000000000000002', siteId: SITE, articleId: ART, title: 'Eski', status: 'READY', durationSec: 15, providerRaw: { engine: ARTICLE_SHORT_ENGINE }, createdAt: new Date(), completedAt: new Date() });
    w.videos.push({ id: 'cmyeni00000000000000002', siteId: SITE, articleId: ART, title: 'Yeni', status: 'READY', durationSec: 30, providerRaw: { engine: ARTICLE_SHORT_ENGINE, style: 'chat' }, createdAt: new Date(), completedAt: new Date() });
    w.videos.push({ id: 'cmbozuk0000000000000002', siteId: SITE, articleId: ART, title: 'Bozuk', status: 'READY', durationSec: 30, providerRaw: { engine: ARTICLE_SHORT_ENGINE, style: '../x' }, createdAt: new Date(), completedAt: new Date() });
    const list = await w.svc.list(SITE);
    expect(list.map((v) => [v.title, v.style])).toEqual([['Eski', 'classic'], ['Yeni', 'chat'], ['Bozuk', 'classic']]);
  });
});

/**
 * Redis kesintisi (inceleme bulgusu): baglanti maxRetriesPerRequest:null ile acik; Redis yokken
 * queue.add SONSUZA DEK bekliyordu -> "kuyruga eklenemedi -> FAILED + iade" dali hic calismiyor,
 * istek asili kaliyor, hak dusmus kaliyordu. Artik her kuyruk islemi sure sinirli.
 */
describe('Redis yanit vermiyor — kuyruk islemleri sure sinirli', () => {
  const hangingQueue = () => {
    const q = new VideoRenderQueue();
    q.opTimeoutMs = 50;
    const never = () => new Promise<never>(() => undefined);
    (q as any).queue = { add: vi.fn(never), getJob: vi.fn(never), getJobState: vi.fn(never) };
    return q;
  };

  it('asili add / state / remove sure sonunda QueueTimeoutError ile doner', async () => {
    const q = hangingQueue();
    await expect(q.add('cmvideo0000000000000000x')).rejects.toBeInstanceOf(QueueTimeoutError);
    await expect(q.state('cmvideo0000000000000000x')).rejects.toBeInstanceOf(QueueTimeoutError);
    await expect(q.remove('cmvideo0000000000000000x')).rejects.toBeInstanceOf(QueueTimeoutError);
  });

  it('istek asili kalmaz: satir FAILED, hak iade, 503 (gercek VideoRenderQueue, asili add)', async () => {
    const w = world({ used: 5 });
    const svc = new VideosService(w.prisma, new QuotaService(w.prisma), hangingQueue());
    const t = Date.now();
    await expect(svc.request(SITE, me, { articleId: ART })).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(Date.now() - t).toBeLessThan(2000);
    expect(w.videos[0]).toMatchObject({ status: 'FAILED' });
    expect(w.user.videosUsedThisMonth).toBe(5);
    expect(w.kv.size).toBe(0);
  });
});

describe('silme — yarim render dosyalari da gider', () => {
  it('hazir/basarisiz video silinince mp4, poster ve <id>.mp4.part* / <id>.jpg.part* silinir; baska videonun dosyasina dokunulmaz', async () => {
    const out = mkdtempSync(path.join(os.tmpdir(), 'videos-rm-'));
    const prev = process.env.VIDEO_OUTPUT_DIR;
    process.env.VIDEO_OUTPUT_DIR = out;
    try {
      const w = world();
      const { video } = await w.svc.request(SITE, me, { articleId: ART });
      w.videos[0].status = 'FAILED';
      const dir = path.join(out, SITE);
      mkdirSync(dir, { recursive: true });
      const mine = [`${video.id}.mp4`, `${video.id}.jpg`, `${video.id}.mp4.part.mp4`, `${video.id}.mp4.part.ln.mp4`, `${video.id}.jpg.part.jpg`];
      const other = 'cmvideoBASKA0000000000001.mp4.part.mp4'.toLowerCase();
      for (const n of [...mine, other]) writeFileSync(path.join(dir, n), 'x');
      await w.svc.remove(SITE, video.id);
      expect(mine.filter((n) => existsSync(path.join(dir, n)))).toEqual([]);
      expect(existsSync(path.join(dir, other))).toBe(true);
    } finally {
      process.env.VIDEO_OUTPUT_DIR = prev;
      rmSync(out, { recursive: true, force: true });
    }
  });
});
