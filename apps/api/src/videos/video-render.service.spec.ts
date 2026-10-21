import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildArticleShortProps, userMessageOf, VideoRenderError, VideoRenderService } from './video-render.service.js';
import { ALLOWED_TRANSITIONS, canTransition, toVideoView } from './article-video-view.js';
import { ARTICLE_SHORT_ENGINE, VIDEO_STUCK_HARD_MS, VIDEO_STUCK_MS, removeSiteVideoFiles, videoFiles } from './article-video.config.js';
import { FIXTURE_ARTICLE_ROW, FIXTURE_SITE } from './article-video.fixture.js';
import type { SiteBrand } from './article-video-brand.js';
import type { RenderKit } from './article-short-kit.js';
import { QueueTimeoutError } from './video-render.queue.js';

/**
 * Worker isleyicisi (VideoRenderService.process) — gercek apps/video modulleri (makale, metin
 * koruyucusu), SAHTE render (Remotion yerine dosya yazar), sahte DB / LLM / marka. Durum yasam
 * dongusu: PENDING -> GENERATING -> READY | FAILED; hata = Turkce mesaj + TEK iade.
 */

const OUT = mkdtempSync(path.join(os.tmpdir(), 'rv-video-'));
process.env.VIDEO_OUTPUT_DIR = OUT;
process.env.VIDEO_PUBLIC_BASE = 'https://ranksup.ai/videos';
afterAll(() => rmSync(OUT, { recursive: true, force: true }));

const VIDEO_ID = 'cmvideo0000000000000001';
const USER_ID = 'cmuser00000000000000001';

function makeDb(over: Partial<any> = {}) {
  const video: any = {
    id: VIDEO_ID,
    siteId: FIXTURE_SITE.id,
    articleId: FIXTURE_ARTICLE_ROW.id,
    title: FIXTURE_ARTICLE_ROW.title,
    status: 'PENDING',
    durationSec: null,
    videoUrl: null,
    thumbnailUrl: null,
    fileSize: null,
    errorMsg: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    startedAt: null,
    completedAt: null,
    providerRaw: { engine: ARTICLE_SHORT_ENGINE, request: { primaryColor: '#1d4ed8', useLogo: false }, charged: true, chargedUserId: USER_ID },
    ...over,
  };
  const article: any = { ...FIXTURE_ARTICLE_ROW };
  const site: any = { ...FIXTURE_SITE, userId: USER_ID, user: { id: USER_ID, deletionRequestedAt: null } };
  const writes: string[] = [];
  const db: any = {
    video,
    article,
    site,
    writes,
    deleted: false,
  };
  db.prisma = {
    video: {
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (db.deleted || where.id !== video.id) return { count: 0 };
        const allowed: string[] = where.status?.in ?? (where.status ? [where.status] : [video.status]);
        if (!allowed.includes(video.status)) return { count: 0 };
        if (data.status && !canTransition(video.status, data.status)) throw new Error(`gecersiz gecis ${video.status} -> ${data.status}`);
        writes.push(`${video.status}->${data.status ?? video.status}`);
        Object.assign(video, data, { updatedAt: new Date() });
        return { count: 1 };
      }),
      findUnique: vi.fn(async ({ include }: any) => {
        if (db.deleted) return null;
        return include ? { ...video, article: db.article, site: db.site } : { ...video };
      }),
      findMany: vi.fn(async () => (db.deleted ? [] : [{ id: video.id, updatedAt: video.updatedAt, status: video.status }])),
    },
  };
  return db;
}

const brand: SiteBrand = { name: 'Örnek Klinik', domain: 'ornekklinik.com', primary: '#2563eb', colorSource: 'meta:theme-color', logoDataUri: 'data:image/png;base64,iVBORw0KGgo=', logoSource: 'https://www.ornekklinik.com/logo.png', notes: [] };

function makeRenderKit(impl?: (o: any) => Promise<any>): RenderKit & { calls: any[] } {
  const calls: any[] = [];
  return {
    calls,
    renderConcurrency: () => 2,
    renderArticleShort: vi.fn(async (o: any) => {
      calls.push(o);
      if (impl) return impl(o);
      writeFileSync(o.outFile, Buffer.alloc(2048, 1));
      writeFileSync(o.posterFile, Buffer.alloc(256, 2));
      return { durationSec: 15, width: 1080, height: 1920, fps: 30, bytes: 2048, posterBytes: 256, concurrency: o.concurrency, bundle: 'disk', inputLufs: -20, timings: { render: 1 } };
    }) as any,
  };
}

function makeService(db: any, opts: { chat?: any; render?: RenderKit & { calls: any[] }; state?: string } = {}) {
  const quota = {
    refundVideoAllowance: vi.fn(async () => true),
    checkAiCostBudget: vi.fn(async () => ({ hardBlock: false })),
  };
  const llm = { chat: opts.chat ?? vi.fn(async () => { throw new Error('AI kapali'); }) };
  const notifications = { create: vi.fn(async () => ({})) };
  const queue = { state: vi.fn(async () => opts.state ?? 'unknown') };
  const svc = new VideoRenderService(db.prisma, quota as any, llm as any, notifications as any, queue as any);
  const render = opts.render ?? makeRenderKit();
  svc.deps = { renderKit: async () => render, brand: vi.fn(async () => brand) as any };
  return { svc, quota, llm, notifications, queue, render };
}

describe('durum gecisleri', () => {
  it('yalniz ileri gecisler; bitmis video (READY/FAILED) yeniden yazilmaz', () => {
    expect(canTransition('PENDING', 'GENERATING')).toBe(true);
    expect(canTransition('GENERATING', 'READY')).toBe(true);
    expect(canTransition('GENERATING', 'FAILED')).toBe(true);
    expect(canTransition('READY', 'FAILED')).toBe(false);
    expect(canTransition('FAILED', 'GENERATING')).toBe(false);
    expect(ALLOWED_TRANSITIONS.READY).toEqual([]);
  });

  it('panel gorunumu: hazir olmayan videonun adresi gosterilmez; hata yalniz failed', () => {
    const base = { id: 'v', siteId: 's', articleId: 'a', title: 't', durationSec: null, videoUrl: 'u', thumbnailUrl: 'p', fileSize: 1, errorMsg: 'e', createdAt: new Date(), completedAt: null };
    expect(toVideoView({ ...base, status: 'PENDING' })).toMatchObject({ status: 'queued', videoUrl: null, posterUrl: null, error: null });
    expect(toVideoView({ ...base, status: 'GENERATING' })).toMatchObject({ status: 'rendering', videoUrl: null });
    expect(toVideoView({ ...base, status: 'READY' })).toMatchObject({ status: 'ready', videoUrl: 'u', posterUrl: 'p', error: null });
    expect(toVideoView({ ...base, status: 'FAILED' })).toMatchObject({ status: 'failed', videoUrl: null, error: 'e' });
  });
});

describe('VideoRenderService.process — worker isleyicisi', () => {
  beforeEach(() => vi.clearAllMocks());

  it('basari: PENDING -> GENERATING -> READY; mp4 + poster /videos/<siteId>/ altinda, boyut ve sure kayitli', async () => {
    const db = makeDb();
    const { svc, render, notifications, quota } = makeService(db);
    await expect(svc.process(VIDEO_ID)).resolves.toEqual({ status: 'ready' });
    expect(db.writes).toEqual(['PENDING->GENERATING', 'GENERATING->READY']);
    expect(db.video).toMatchObject({
      status: 'READY',
      videoUrl: `https://ranksup.ai/videos/${FIXTURE_SITE.id}/${VIDEO_ID}.mp4`,
      thumbnailUrl: `https://ranksup.ai/videos/${FIXTURE_SITE.id}/${VIDEO_ID}.jpg`,
      fileSize: 2048,
      durationSec: 15,
    });
    expect(existsSync(path.join(OUT, FIXTURE_SITE.id, `${VIDEO_ID}.mp4`))).toBe(true);
    // Kullanicinin duzeltmesi uygulanir: renk degisti, logo kapatildi
    const props = render.calls[0].props;
    expect(props.brand).toEqual({ name: 'Örnek Klinik', domain: 'ornekklinik.com', primary: '#1d4ed8' });
    expect(props.points).toHaveLength(3);
    expect(props.cta.url).toBe('https://www.ornekklinik.com/blog/fatura-finansmani-nedir/');
    expect(props.sourcePath).toBe('ornekklinik.com/blog');
    expect(props.kicker).toBe('Finans Rehberi');
    expect(db.video.providerRaw.copy.strategy).toBe('extractive');
    expect(JSON.parse(db.video.scriptText).points).toHaveLength(3);
    expect(quota.refundVideoAllowance).not.toHaveBeenCalled();
    expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({ userId: USER_ID, title: 'Videon hazır', link: `/sites/${FIXTURE_SITE.id}/videos` }));
  });

  it('render hatasi: FAILED + Turkce mesaj + TEK iade; yarim dosya kalmaz', async () => {
    const db = makeDb();
    const render = makeRenderKit(async (o) => {
      writeFileSync(o.outFile, 'yarim');
      throw new Error('Failed to launch the browser process: libnss3.so: cannot open shared object file');
    });
    const { svc, quota, notifications } = makeService(db, { render });
    const r = await svc.process(VIDEO_ID);
    expect(r.status).toBe('failed');
    expect(db.video.status).toBe('FAILED');
    expect(db.video.errorMsg).toMatch(/tarayıcı başlatılamadı; video hakkın iade edildi/);
    expect(db.video.providerRaw.errorDetail).toMatch(/libnss3/);
    expect(quota.refundVideoAllowance).toHaveBeenCalledTimes(1);
    expect(quota.refundVideoAllowance).toHaveBeenCalledWith(USER_ID, db.video.createdAt);
    expect(existsSync(path.join(OUT, FIXTURE_SITE.id, `${VIDEO_ID}.mp4`))).toBe(false);
    expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({ title: 'Video üretilemedi' }));
    // Worker 'failed' olayi / supurucu ikinci kez cagirsa da iade tekrarlanmaz
    await expect(svc.markFailed(VIDEO_ID, 'x')).resolves.toBe(false);
    expect(quota.refundVideoAllowance).toHaveBeenCalledTimes(1);
  });

  it('hak dusulmemis (ADMIN) video basarisiz olursa iade yapilmaz', async () => {
    const db = makeDb({ providerRaw: { engine: ARTICLE_SHORT_ENGINE, charged: false, chargedUserId: USER_ID } });
    const { svc, quota } = makeService(db, { render: makeRenderKit(async () => { throw new Error('boom'); }) });
    await svc.process(VIDEO_ID);
    expect(db.video.status).toBe('FAILED');
    expect(db.video.errorMsg).toBe('Video oluşturulurken beklenmeyen bir sorun oldu; video hakkın iade edildi. Tekrar deneyebilirsin.');
    expect(quota.refundVideoAllowance).not.toHaveBeenCalled();
  });

  it('makale yayindan kalktiysa render cagrilmaz, acik mesajla FAILED + iade', async () => {
    const db = makeDb();
    db.article = { ...db.article, status: 'READY_TO_PUBLISH' };
    const { svc, render, quota } = makeService(db);
    await svc.process(VIDEO_ID);
    expect(render.renderArticleShort).not.toHaveBeenCalled();
    expect(db.video.errorMsg).toBe('Makale artık yayında değil; video üretilemedi. Video hakkın iade edildi.');
    expect(quota.refundVideoAllowance).toHaveBeenCalledTimes(1);
  });

  it('LLM gecerli metin dondururse strateji llm ve maliyet kayitli', async () => {
    const db = makeDb();
    const chat = vi.fn<(req: any) => Promise<any>>(async () => ({
      output: JSON.stringify({
        hook: 'Fatura finansmanı nedir?',
        points: [
          { title: 'Fatura finansmanı nasıl çalışır?' },
          { title: 'Hangi işletmeler için uygundur?', detail: 'Vadesi 90 gün olan alacakları bulunan işletmeler için uygundur.' },
          { title: 'Maliyeti nasıl hesaplanır?' },
        ],
        cta: { label: 'Tamamını oku', domain: 'ornekklinik.com' },
      }),
      model: 'claude-haiku-5-5', provider: 'anthropic', usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 }, costUsd: 0.0004, stopReason: 'end_turn',
    }));
    const { svc } = makeService(db, { chat });
    await svc.process(VIDEO_ID);
    expect(db.video.status).toBe('READY');
    expect(db.video.providerRaw.copy.strategy).toBe('llm');
    expect(db.video.costUsd).toBeCloseTo(0.0004);
    expect(chat.mock.calls[0][0]).toMatchObject({ model: 'claude-haiku-5-5', userId: USER_ID, siteId: FIXTURE_SITE.id, conversationId: VIDEO_ID });
  });

  it('bitmis ya da silinmis video yeniden islenmez (ayni is iki kez gelirse)', async () => {
    const ready = makeDb({ status: 'READY' });
    const a = makeService(ready);
    await expect(a.svc.process(VIDEO_ID)).resolves.toMatchObject({ status: 'skipped' });
    expect(a.render.renderArticleShort).not.toHaveBeenCalled();
    const gone = makeDb();
    gone.deleted = true;
    const b = makeService(gone);
    await expect(b.svc.process(VIDEO_ID)).resolves.toMatchObject({ status: 'skipped' });
  });

  it('render sirasinda silinen video: dosyalar temizlenir, READY yazilmaz', async () => {
    const db = makeDb();
    const render = makeRenderKit(async (o) => {
      writeFileSync(o.outFile, 'x');
      writeFileSync(o.posterFile, 'y');
      db.deleted = true;
      return { durationSec: 15, width: 1080, height: 1920, fps: 30, bytes: 1, posterBytes: 1, concurrency: 1, bundle: 'disk', inputLufs: null, timings: {} };
    });
    const { svc } = makeService(db, { render });
    await expect(svc.process(VIDEO_ID)).resolves.toMatchObject({ status: 'skipped' });
    expect(existsSync(path.join(OUT, FIXTURE_SITE.id, `${VIDEO_ID}.mp4`))).toBe(false);
  });
});

describe('takili video supurucusu', () => {
  it('kuyrukta canli isi olmayan eski video FAILED + iade; canli is beklenir', async () => {
    const old = new Date(Date.now() - VIDEO_STUCK_MS - 60_000);
    const live = makeDb({ status: 'GENERATING', updatedAt: old });
    const a = makeService(live, { state: 'active' });
    await expect(a.svc.sweepStuck()).resolves.toBe(0);
    expect(live.video.status).toBe('GENERATING');

    const lost = makeDb({ status: 'GENERATING', updatedAt: old });
    const b = makeService(lost, { state: 'unknown' });
    await expect(b.svc.sweepStuck()).resolves.toBe(1);
    expect(lost.video.status).toBe('FAILED');
    expect(lost.video.errorMsg).toMatch(/zamanında üretilemedi; video hakkın iade edildi/);
    expect(b.quota.refundVideoAllowance).toHaveBeenCalledTimes(1);

    const tooLong = makeDb({ status: 'PENDING', updatedAt: new Date(Date.now() - VIDEO_STUCK_HARD_MS - 60_000) });
    const c = makeService(tooLong, { state: 'waiting' });
    await expect(c.svc.sweepStuck()).resolves.toBe(1);
  });
});

describe('dosyalar', () => {
  it('site silinince o sitenin video dizini gider; kimlik disi yol reddedilir', async () => {
    const dir = path.join(OUT, 'cmsilinecek0000000000001');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'x.mp4'), 'x');
    await expect(removeSiteVideoFiles('cmsilinecek0000000000001')).resolves.toBe(true);
    expect(existsSync(dir)).toBe(false);
    mkdirSync(path.join(OUT, 'kalsin'), { recursive: true });
    await expect(removeSiteVideoFiles('../kalsin')).resolves.toBe(false);
    await expect(removeSiteVideoFiles('')).resolves.toBe(false);
    expect(existsSync(path.join(OUT, 'kalsin'))).toBe(true);
  });

  it('yol ve adres yalniz kanonik kimlikten kurulur', () => {
    expect(videoFiles('demo-luvihost', 'cmvideo0000000000000001').videoUrl).toBe('https://ranksup.ai/videos/demo-luvihost/cmvideo0000000000000001.mp4');
    expect(() => videoFiles('../etc', 'cmvideo0000000000000001')).toThrow();
    expect(() => videoFiles('demo-luvihost', '../../x')).toThrow();
  });
});

describe('yardimcilar', () => {
  it('bilinmeyen hatanin ic ayrintisi kullaniciya gosterilmez', () => {
    expect(userMessageOf(new Error('EACCES /var/www/luviai/apps/api/public/videos'))).not.toMatch(/var\/www/);
    expect(userMessageOf(new VideoRenderError('Açık mesaj'))).toBe('Açık mesaj');
    expect(userMessageOf(new Error('ENOSPC: no space left'))).toMatch(/yer kalmadı/);
  });

  it('props: logo data URI ve renk yalniz varsa; filigran acik', () => {
    const copy: any = { script: { hook: 'H', points: [{ title: 'A' }, { title: 'B', detail: 'b' }, { title: 'C' }], cta: { label: 'Tamamını oku', domain: 'ornek.com' } } };
    const p = buildArticleShortProps(copy, { ...brand, primary: null, logoDataUri: null }, { url: 'https://ornek.com/blog/x', domain: 'ornek.com' } as any);
    expect(p.brand).toEqual({ name: 'Örnek Klinik', domain: 'ornekklinik.com' });
    expect(p.watermark).toBe(true);
    // Ust etiket yoksa bos dize: Remotion defaultProps'taki ornek "Örnek içerik" videoya sizmasin
    expect(p.kicker).toBe('');
    expect(p.muted).toBe(false);
  });
});

/**
 * Toplam sure + yarim dosyalar (inceleme bulgulari). Kuyruk eszamanliligi 1: takilan tek is
 * (yavas logo sunuculari, kilitlenen Chrome) herkesi bekletiyordu; cokmus render'in
 * <id>.mp4.part.mp4 / .part.jpg dosyalari herkese acik dizinde kaliyordu.
 */
describe('toplam sure siniri ve yarim dosyalar', () => {
  beforeEach(() => vi.clearAllMocks());
  const dir = () => path.join(OUT, FIXTURE_SITE.id);
  const partNames = [`${VIDEO_ID}.mp4.part.mp4`, `${VIDEO_ID}.mp4.part.ln.mp4`, `${VIDEO_ID}.jpg.part.jpg`];
  const writeParts = () => {
    mkdirSync(dir(), { recursive: true });
    for (const n of partNames) writeFileSync(path.join(dir(), n), 'yarim');
  };
  const leftovers = () => partNames.filter((n) => existsSync(path.join(dir(), n)));

  it('asili render: sure dolunca sinyal kesilir (Chrome/ffmpeg oldurulur), FAILED + TEK iade, yarim dosya kalmaz', async () => {
    const db = makeDb();
    let aborted = false;
    const render = makeRenderKit((o) => new Promise((_, reject) => {
      writeParts();
      // Gercek kit gibi: sinyal gelince alt surecleri oldurur ve hata ile doner
      o.signal.addEventListener('abort', () => {
        aborted = true;
        reject(new Error('renderMedia() got cancelled'));
      });
    }));
    const { svc, quota } = makeService(db, { render });
    svc.timeoutMs = 80;
    const t = Date.now();
    const r = await svc.process(VIDEO_ID);
    expect(Date.now() - t).toBeLessThan(3000);
    expect(r.status).toBe('failed');
    expect(aborted).toBe(true);
    expect(db.video.status).toBe('FAILED');
    expect(db.video.errorMsg).toBe('Video zamanında üretilemedi; video hakkın iade edildi. Tekrar deneyebilirsin.');
    expect(db.video.providerRaw.errorDetail).toMatch(/toplam sure asildi/);
    expect(quota.refundVideoAllowance).toHaveBeenCalledTimes(1);
    expect(leftovers()).toEqual([]);
    expect(existsSync(path.join(dir(), `${VIDEO_ID}.mp4`))).toBe(false);
  });

  it('sinyali dinlemeyen asili adim (marka) da isi takili birakmaz: sure dolunca FAILED + iade, READY yazilmaz', async () => {
    const db = makeDb();
    const { svc, quota, render } = makeService(db);
    svc.deps.brand = vi.fn(() => new Promise<never>(() => undefined)) as any;
    svc.timeoutMs = 80;
    svc.abortGraceMs = 50;
    const r = await svc.process(VIDEO_ID);
    expect(r.status).toBe('failed');
    expect(db.video.status).toBe('FAILED');
    expect(render.renderArticleShort).not.toHaveBeenCalled();
    expect(quota.refundVideoAllowance).toHaveBeenCalledTimes(1);
  });

  it('render tam sure dolarken biterse READY yazilmaz, dosyalar silinir (iade tek)', async () => {
    const db = makeDb();
    const render = makeRenderKit(async (o) => {
      await new Promise((res) => setTimeout(res, 120));
      writeFileSync(o.outFile, Buffer.alloc(10));
      writeFileSync(o.posterFile, Buffer.alloc(10));
      return { durationSec: 15, width: 1080, height: 1920, fps: 30, bytes: 10, posterBytes: 10, concurrency: 1, bundle: 'disk', inputLufs: null, timings: {} };
    });
    const { svc, quota } = makeService(db, { render });
    svc.timeoutMs = 60;
    await expect(svc.process(VIDEO_ID)).resolves.toMatchObject({ status: 'failed' });
    expect(db.writes).not.toContain('GENERATING->READY');
    expect(quota.refundVideoAllowance).toHaveBeenCalledTimes(1);
    expect(existsSync(path.join(dir(), `${VIDEO_ID}.mp4`))).toBe(false);
  });

  it('render sureci coktu (gecici dosyalari silemeden): FAILED yazilirken .part dosyalari silinir', async () => {
    const db = makeDb();
    const render = makeRenderKit(async () => {
      writeParts();
      throw new Error('boom');
    });
    const { svc } = makeService(db, { render });
    await svc.process(VIDEO_ID);
    expect(leftovers()).toEqual([]);
  });

  it('supurucu (worker cokmus, is kayip): FAILED + iade ve onceki render\'in .part dosyalari silinir', async () => {
    writeParts();
    const db = makeDb({ status: 'GENERATING', updatedAt: new Date(Date.now() - VIDEO_STUCK_MS - 60_000) });
    const { svc } = makeService(db, { state: 'unknown' });
    await expect(svc.sweepStuck()).resolves.toBe(1);
    expect(leftovers()).toEqual([]);
  });

  it('Redis yanit vermiyorsa supurucu her satirda 10 sn beklemez: ilk zaman asiminda kalanlar "unknown"', async () => {
    const db = makeDb({ status: 'GENERATING', updatedAt: new Date(Date.now() - VIDEO_STUCK_MS - 60_000) });
    const { svc, queue } = makeService(db);
    db.prisma.video.findMany = vi.fn(async () => ['cmvideo000000000000000a1', 'cmvideo000000000000000a2', VIDEO_ID].map((id) => ({ id, updatedAt: db.video.updatedAt })));
    queue.state = vi.fn(async () => { throw new QueueTimeoutError('is durumu 10000 ms\'de yanit vermedi'); });
    await expect(svc.sweepStuck()).resolves.toBe(1);
    expect(queue.state).toHaveBeenCalledTimes(1);
    expect(db.video.status).toBe('FAILED');
  });
});
