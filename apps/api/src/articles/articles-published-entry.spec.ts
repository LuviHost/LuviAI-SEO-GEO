import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException, RequestMethod, ValidationPipe } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { PublishedEntryParamsDto } from './articles.dto.js';
import { ArticlesController } from './articles.controller.js';
import { ArticlesService, PUBLISHED_ENTRY_CONFLICT, PUBLISHED_ENTRY_NOT_FOUND } from './articles.service.js';
import { articleContentHash, liveEntryRef, type LiveEntry } from './republish-policy.js';
// Takili sayfa otopilotunun plani (S2 yan etkisi: geri alma isareti)
import { planStuckRepublish } from '../audit/stuck-page-autopilot.js';
// Yerinde guncellemenin GERCEK cakisma kurali (REST ve XML-RPC adaptorlerinin ikisi de bunu cagirir)
import { WP_CLOCK_SKEW_TOLERANCE_MS, wordPressEditedSince } from '@luviai/adapters';

/**
 * T-A madde 4 — yayin kaydi uclari (paylasilan sozlesme):
 *  POST /api/sites/:siteId/articles/:articleId/published-to/:targetId/mark-updated
 *    musteri canli kopyayi kendi panelinden guncelledi → isaret kalkar (kayit yoksa 404)
 *  POST .../forget
 *    musteri o hedefteki yaziyi sildi → kayit kaldirilir; canli kayit kalmazsa
 *    yazi READY_TO_PUBLISH (yeniden yayinlanabilir)
 * Donus { ok: true, status, publishedTo }. Sahiplik: SiteAccessGuard (:siteId) +
 * makale bu siteye ait + kanonik kimlik (DTO, common/site-id.ts).
 * Vitest dekorator metadatasi uretmez: pipe metatype'i elle verilir, servis elle kurulur.
 */

const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
const asParams = { type: 'param' as const, metatype: PublishedEntryParamsDto, data: undefined };
const S = 'cmsq25bko005farswo54hf856';
const A = 'cmarticle0001abcdefghijk';
const T = 'cmtarget00001abcdefghijk';

async function paramErrors(value: Record<string, unknown>): Promise<string[]> {
  const err: any = await pipe.transform(value, asParams).catch((e) => e);
  expect(err).toBeInstanceOf(BadRequestException);
  return err.getResponse().message as string[];
}

describe('PublishedEntryParamsDto — kanonik kimlik', () => {
  it('cuid kimlikler gecer', async () => {
    const dto = await pipe.transform({ siteId: S, articleId: A, targetId: T }, asParams);
    expect(dto).toBeInstanceOf(PublishedEntryParamsDto);
    expect(dto).toMatchObject({ siteId: S, articleId: A, targetId: T });
  });

  it('buyuk harf, bosluk, sifir genislikli karakter, asiri uzun: 400 ve Turkce mesaj (harmanlama ayni satiri bulurdu)', async () => {
    expect(await paramErrors({ siteId: S, articleId: A.toUpperCase(), targetId: T })).toEqual(['Geçersiz makale kimliği.']);
    expect(await paramErrors({ siteId: S, articleId: A, targetId: `${T} ` })).toEqual(['Geçersiz yayın hedefi kimliği.']);
    expect(await paramErrors({ siteId: S + '\u200b', articleId: A, targetId: T })).toEqual(['Geçersiz site kimliği.']);
    expect(await paramErrors({ siteId: S, articleId: 'a'.repeat(65), targetId: T })).toEqual(['Geçersiz makale kimliği.']);
  });

  it('rotada olmayan parametre reddedilir (forbidNonWhitelisted)', async () => {
    const m = await paramErrors({ siteId: S, articleId: A, targetId: T, id: 'x' });
    expect(m.join(' ')).toContain('id');
  });
});

describe('ArticlesController — rotalar', () => {
  const proto = ArticlesController.prototype as any;
  it.each([
    ['markPublishedEntryUpdated', ':articleId/published-to/:targetId/mark-updated'],
    ['forgetPublishedEntry', ':articleId/published-to/:targetId/forget'],
  ])('%s → POST %s', (method, path) => {
    expect(Reflect.getMetadata(PATH_METADATA, proto[method])).toBe(path);
    expect(Reflect.getMetadata(METHOD_METADATA, proto[method])).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(PATH_METADATA, ArticlesController)).toBe('sites/:siteId/articles');
  });

  it('parametreler servise aynen gider', async () => {
    const articles = {
      markPublishedEntryUpdated: vi.fn(async () => ({ ok: true })),
      forgetPublishedEntry: vi.fn(async () => ({ ok: true })),
    };
    const ctl = new ArticlesController(articles as any, {} as any, {} as any, {} as any, {} as any);
    const params = Object.assign(new PublishedEntryParamsDto(), { siteId: S, articleId: A, targetId: T });
    await ctl.markPublishedEntryUpdated(params);
    await ctl.forgetPublishedEntry(params);
    expect(articles.markPublishedEntryUpdated).toHaveBeenCalledWith(S, A, T);
    expect(articles.forgetPublishedEntry).toHaveBeenCalledWith(S, A, T);
  });
});

// ── Servis ─────────────────────────────────────────────────────────────────

const UPDATED_AT = new Date('2026-10-17T08:00:00.000Z');
const ghost = (over: Record<string, unknown> = {}) => ({ targetId: T, targetType: 'GHOST', ok: true, externalId: 'g1', externalUrl: 'https://s.example/yazi', publishedAt: '2026-01-05T10:00:00.000Z', ...over });
const wp = (over: Record<string, unknown> = {}) => ({ targetId: 'cmwptarget0001abcdefghij', targetType: 'WORDPRESS_REST', ok: true, externalId: '41', externalUrl: 'https://s.example/yazi/', ...over });

type Row = Record<string, any>;

/** Bellek ici satir: findFirst (id + siteId; harmanlama gibi harf duyarsiz), kosullu updateMany */
function service(row: Row | null, opts: { enqueueFails?: boolean; caseInsensitive?: boolean } = {}) {
  const db = row ? { ...row } : null;
  const prisma = {
    article: {
      findFirst: vi.fn(async ({ where }: any) => {
        if (!db) return null;
        const eq = (a: string, b: string) => (opts.caseInsensitive ? a.toLowerCase() === b.toLowerCase() : a === b);
        return eq(db.id, where.id) && eq(db.siteId, where.siteId) ? { ...db } : null;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (!db || db.id !== where.id || db.siteId !== where.siteId || db.updatedAt.getTime() !== where.updatedAt.getTime()) return { count: 0 };
        Object.assign(db, data);
        return { count: 1 };
      }),
    },
  };
  const jobQueue = {
    enqueue: vi.fn(async () => {
      if (opts.enqueueFails) throw new Error('redis yok');
      return { dbJobId: 'j1', bullJobId: '1' };
    }),
  };
  const svc = new ArticlesService(prisma as any, jobQueue as any, {} as any, {} as any);
  return { svc, prisma, jobQueue, db: () => db };
}

const articleRow = (over: Row = {}): Row => ({
  id: A, siteId: S, status: 'PUBLISHED', updatedAt: UPDATED_AT,
  title: 'Yazı', metaTitle: null, metaDescription: 'Özet', bodyMd: '# Yazı\n\nGüncel metin.',
  site: { userId: 'u1' },
  publishedTo: [ghost({ manualUpdatePending: true, manualUpdatePendingSince: '2026-10-10T00:00:00.000Z' }), wp()],
  ...over,
});

describe('ArticlesService.markPublishedEntryUpdated', () => {
  it('isaret kalkar; kayda o anki metnin izi, manualUpdatedAt ve updatedAt yazilir; diger kayitlar aynen', async () => {
    const { svc, db } = service(articleRow());
    const before = Date.now();
    const r = await svc.markPublishedEntryUpdated(S, A, T);
    expect(r.ok).toBe(true);
    expect(r.status).toBe('PUBLISHED');
    const entry = r.publishedTo[0] as Row;
    expect(entry).not.toHaveProperty('manualUpdatePending');
    expect(entry).not.toHaveProperty('manualUpdatePendingSince');
    expect(entry).toMatchObject({ targetId: T, externalId: 'g1', publishedAt: '2026-01-05T10:00:00.000Z' });
    expect(entry.contentHash).toBe(articleContentHash({ title: 'Yazı', metaTitle: null, metaDescription: 'Özet', bodyMd: '# Yazı\n\nGüncel metin.' }));
    expect(Date.parse(entry.manualUpdatedAt)).toBeGreaterThanOrEqual(before);
    expect(entry.updatedAt).toBe(entry.manualUpdatedAt);
    expect(r.publishedTo[1]).toEqual(wp());
    // DB'ye yazilan ayni liste; durum degismez
    expect(db()!.publishedTo).toEqual(r.publishedTo);
    expect(db()!.status).toBe('PUBLISHED');
  });

  it('M-1: WordPress kaydinin hedef damgasi (remoteModifiedAt) silinir — musterinin yapistirmasi sonraki guncellemeyi "duzenlenmis" saydirmaz', async () => {
    const stamp = '2026-09-01T10:00:00.000Z';
    const pendingWp = wp({
      targetId: T, updatedAt: '2026-09-01T10:00:05.000Z', remoteModifiedAt: stamp,
      manualUpdatePending: true, manualUpdatePendingSince: '2026-10-10T00:00:00.000Z',
    });
    const { svc, db } = service(articleRow({ publishedTo: [pendingWp] }));
    // Musteri isaretlemeden hemen once guncel metni WordPress'e yapistirdi: WordPress damgasi ilerledi
    const pastedAt = new Date(Date.now() - 30_000).toISOString();
    expect(wordPressEditedSince(pastedAt, liveEntryRef(pendingWp))).toBe(true);

    const r = await svc.markPublishedEntryUpdated(S, A, T);
    const entry = r.publishedTo[0] as LiveEntry;
    expect(entry).not.toHaveProperty('remoteModifiedAt');
    expect(entry).not.toHaveProperty('manualUpdatePending');
    expect((db()!.publishedTo as LiveEntry[])[0]).not.toHaveProperty('remoteModifiedAt');
    // Kimlik ve adres korunur (yerinde guncelleme ayni yaziyi bulur)
    expect(entry).toMatchObject({ externalId: '41', externalUrl: 'https://s.example/yazi/' });
    // Kiyas artik isaretleme anina (+ saat payi) bakar: yapistirma bilinen degisiklik...
    expect(wordPressEditedSince(pastedAt, liveEntryRef(entry))).toBe(false);
    // ...isaretlemeden SONRAKI duzenleme yine korunur
    const later = new Date(Date.parse(String(entry.updatedAt)) + WP_CLOCK_SKEW_TOLERANCE_MS + 60_000).toISOString();
    expect(wordPressEditedSince(later, liveEntryRef(entry))).toBe(true);
  });

  it('isaretsiz kayit: degisiklik yok, yazim yok (tekrar istek tarihleri ilerletmez)', async () => {
    const { svc, prisma } = service(articleRow({ publishedTo: [ghost(), wp()] }));
    const r = await svc.markPublishedEntryUpdated(S, A, T);
    expect(r).toEqual({ ok: true, status: 'PUBLISHED', publishedTo: [ghost(), wp()] });
    expect(prisma.article.updateMany).not.toHaveBeenCalled();
  });

  it('bu hedefte canli kayit yok: 404 (Turkce)', async () => {
    const { svc } = service(articleRow({ publishedTo: [wp(), ghost({ targetId: 'cmbaska00001abcdefghijkl', ok: false })] }));
    await expect(svc.markPublishedEntryUpdated(S, A, T)).rejects.toThrow(new NotFoundException(PUBLISHED_ENTRY_NOT_FOUND));
    const none = service(articleRow({ publishedTo: null }));
    await expect(none.svc.markPublishedEntryUpdated(S, A, T)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('baska sitenin makalesi ya da harf varyantli kimlik: 404 — varligi sizmaz', async () => {
    const { svc, prisma } = service(articleRow());
    await expect(svc.markPublishedEntryUpdated('cmbaskasite01abcdefghijk', A, T)).rejects.toThrow('Makale bulunamadı');
    // Harmanlama harf farkini yok sayar; ikinci kapi kimligin birebir ayni olmasini ister
    const ci = service(articleRow(), { caseInsensitive: true });
    await expect(ci.svc.markPublishedEntryUpdated(S, A.toUpperCase(), T)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.article.updateMany).not.toHaveBeenCalled();
    expect(ci.prisma.article.updateMany).not.toHaveBeenCalled();
  });

  it('okuma ile yazma arasinda yazi degisti (yayin bitti): 409, ezilmez', async () => {
    const { svc, prisma } = service(articleRow());
    prisma.article.updateMany.mockImplementationOnce(async () => ({ count: 0 }));
    await expect(svc.markPublishedEntryUpdated(S, A, T)).rejects.toThrow(new ConflictException(PUBLISHED_ENTRY_CONFLICT));
    // Kosul okunan updatedAt; updatedAt acikca ilerletilir
    const where = (prisma.article.updateMany.mock.calls[0] as any)[0].where;
    expect(where).toEqual({ id: A, siteId: S, updatedAt: UPDATED_AT });
    expect((prisma.article.updateMany.mock.calls[0] as any)[0].data.updatedAt).toBeInstanceOf(Date);
  });
});

describe('ArticlesService.forgetPublishedEntry', () => {
  it('kayit kaldirilir; baska canli kayit varsa durum degismez; llms-full yeniden uretilir', async () => {
    const { svc, db, jobQueue } = service(articleRow());
    const r = await svc.forgetPublishedEntry(S, A, T);
    expect(r).toEqual({ ok: true, status: 'PUBLISHED', publishedTo: [wp()] });
    expect(db()!.publishedTo).toEqual([wp()]);
    expect(db()!.status).toBe('PUBLISHED');
    expect(jobQueue.enqueue).toHaveBeenCalledWith({ type: 'LLMS_FULL_BUILD', userId: 'u1', siteId: S, payload: { siteId: S } });
  });

  it('son canli kayit unutulursa yazi READY_TO_PUBLISH (RanksUp\'in bildigi hicbir yerde yayinda degil); ilk yayin tarihi kalir', async () => {
    const { svc, db, prisma } = service(articleRow({ publishedTo: [ghost()], publishedAt: new Date('2026-01-05T10:00:00.000Z') }));
    const r = await svc.forgetPublishedEntry(S, A, T);
    expect(r).toEqual({ ok: true, status: 'READY_TO_PUBLISH', publishedTo: [] });
    expect(db()!.status).toBe('READY_TO_PUBLISH');
    expect((prisma.article.updateMany.mock.calls[0] as any)[0].data).not.toHaveProperty('publishedAt');
  });

  it('kalan kayitlar yalniz basarisiz / bozuksa da canli sayilmaz', async () => {
    const { svc } = service(articleRow({ publishedTo: [ghost(), wp({ ok: false }), null] }));
    expect((await svc.forgetPublishedEntry(S, A, T)).status).toBe('READY_TO_PUBLISH');
  });

  it('kalan tek canli kayit Markdown ZIP disa aktarimiysa yazi READY_TO_PUBLISH: ZIP sitede kopya sayilmaz (yayinci ve canlilik denetimiyle ayni kural, statusAfterRetirement); ZIP kaydi korunur', async () => {
    // Eskiden ZIP canli kopya sayiliyordu: sitedeki son kopyasi unutulan yazi PUBLISHED kaliyordu
    const zip = { targetId: 'cmziptarget001abcdefghij', targetType: 'MARKDOWN_ZIP', ok: true, externalUrl: '/tmp/yazi.zip' };
    const { svc, db } = service(articleRow({ publishedTo: [ghost(), zip] }));
    const r = await svc.forgetPublishedEntry(S, A, T);
    expect(r).toEqual({ ok: true, status: 'READY_TO_PUBLISH', publishedTo: [zip] });
    expect(db()!.status).toBe('READY_TO_PUBLISH');
    // Sitede baska canli kopya kalirsa (ZIP'in yaninda WordPress) durum degismez
    const kept = service(articleRow({ publishedTo: [ghost(), zip, wp()] }));
    expect((await kept.svc.forgetPublishedEntry(S, A, T)).status).toBe('PUBLISHED');
  });

  it('PUBLISHED olmayan yazinin durumu degismez (onaydaki ya da revizyondaki yeniden yazim)', async () => {
    for (const status of ['READY_TO_PUBLISH', 'REVIZE_NEEDED', 'GENERATING']) {
      const { svc, db } = service(articleRow({ status, publishedTo: [ghost()] }));
      expect((await svc.forgetPublishedEntry(S, A, T)).status, status).toBe(status);
      expect(db()!.status, status).toBe(status);
    }
  });

  it('bu hedefte kayit yoksa 404; baska sitenin makalesi 404', async () => {
    const { svc, prisma } = service(articleRow({ publishedTo: [wp()] }));
    await expect(svc.forgetPublishedEntry(S, A, T)).rejects.toThrow(new NotFoundException(PUBLISHED_ENTRY_NOT_FOUND));
    await expect(svc.forgetPublishedEntry('cmbaskasite01abcdefghijk', A, T)).rejects.toThrow('Makale bulunamadı');
    expect(prisma.article.updateMany).not.toHaveBeenCalled();
  });

  it('llms-full kuyruga alinamasa da istek basarili (en iyi caba)', async () => {
    const { svc, db } = service(articleRow(), { enqueueFails: true });
    await expect(svc.forgetPublishedEntry(S, A, T)).resolves.toMatchObject({ ok: true });
    expect(db()!.publishedTo).toEqual([wp()]);
  });

  it('cakisma: 409, llms-full kuyruga alinmaz', async () => {
    const { svc, prisma, jobQueue } = service(articleRow());
    prisma.article.updateMany.mockImplementationOnce(async () => ({ count: 0 }));
    await expect(svc.forgetPublishedEntry(S, A, T)).rejects.toBeInstanceOf(ConflictException);
    expect(jobQueue.enqueue).not.toHaveBeenCalled();
  });
});

describe('S4 — "Elle güncelledim" ve "bu kaydi unut" otomatik yazim engelini (agentOutputs.liveWriteBlocked) kaldirir', () => {
  const blocked = { at: '2026-10-15T00:00:00.000Z', reasons: [{ targetId: T, targetType: 'GHOST', skipped: 'already_live_create_only' }] };
  const outputs = { writer: { output: 'metin' }, liveSnapshot: { title: 'Yazı' }, liveWriteBlocked: blocked };

  it('mark-updated: engel kalkar, diger ajan ciktilari aynen yazilir', async () => {
    const { svc, db, prisma } = service(articleRow({ agentOutputs: outputs }));
    await svc.markPublishedEntryUpdated(S, A, T);
    expect(db()!.agentOutputs).toEqual({ writer: { output: 'metin' }, liveSnapshot: { title: 'Yazı' } });
    expect((prisma.article.findFirst.mock.calls[0] as any)[0].select).toMatchObject({ agentOutputs: true });
  });

  it('forget: engel kalkar', async () => {
    const { svc, db } = service(articleRow({ agentOutputs: outputs }));
    await svc.forgetPublishedEntry(S, A, T);
    expect(db()!.agentOutputs).toEqual({ writer: { output: 'metin' }, liveSnapshot: { title: 'Yazı' } });
  });

  it('engel kaydi yoksa ajan ciktilari hic yazilmaz (agir alan gereksiz yere yeniden yazilmaz)', async () => {
    for (const run of ['mark', 'forget'] as const) {
      const { svc, prisma } = service(articleRow({ agentOutputs: { writer: { output: 'metin' } } }));
      if (run === 'mark') await svc.markPublishedEntryUpdated(S, A, T);
      else await svc.forgetPublishedEntry(S, A, T);
      expect((prisma.article.updateMany.mock.calls[0] as any)[0].data, run).not.toHaveProperty('agentOutputs');
    }
  });
});

describe('S2 yan etkisi — "Elle güncelledim" takili sayfa geri alma isaretini (remoteEditSkip) de kaldirir', () => {
  const STUCK_URL = 'https://s.example/yazi/';
  const plan = (publishedTo: unknown) => planStuckRepublish({
    publishedTo, targets: [{ id: wp().targetId, type: 'WORDPRESS_REST', isActive: true }], slug: 'yazi', url: STUCK_URL,
  });

  it.each([
    ['live_entry_edited', 'live_copy_edited'],
    ['live_entry_mismatch', 'live_copy_mismatch'],
  ])('%s isaretli kopya: musteri guncel metni yapistirip onayladi → isaret ve gorulme ani kalkar; otopilot plani yeniden yerinde yayin', async (skip, block) => {
    // C2 geri almasindan sonra onaylanan yeniden yazim yine atlandi: gercek elle guncelleme isareti
    const entry = wp({
      remoteEditSkip: skip, remoteEditSeenAt: '2026-10-01T00:00:00.000Z',
      manualUpdatePending: true, manualUpdatePendingSince: '2026-10-12T00:00:00.000Z', contentHash: 'eski-metnin-izi',
    });
    // Eskiden: isaret "Elle güncelledim"den sonra da kaliyor, otopilot bu sayfada kapali kaliyordu
    expect(plan([entry])).toMatchObject({ kind: 'proposal', block });
    const { svc, db } = service(articleRow({ publishedTo: [entry] }));
    const r = await svc.markPublishedEntryUpdated(S, A, entry.targetId);
    const after = r.publishedTo[0] as Row;
    expect(after).not.toHaveProperty('remoteEditSkip');
    expect(after).not.toHaveProperty('remoteEditSeenAt');
    expect(after).not.toHaveProperty('manualUpdatePending');
    expect(after).toMatchObject({ externalId: '41', externalUrl: STUCK_URL, contentHash: articleContentHash(articleRow()) });
    expect((db()!.publishedTo as Row[])[0]).not.toHaveProperty('remoteEditSkip');
    expect(plan(r.publishedTo)).toEqual({ kind: 'republish', targetIds: [entry.targetId], targetTypes: ['WORDPRESS_REST'] });
  });

  it('elle guncelleme isareti olmayan kopyada (C2 geri almasindan hemen sonra) istek bos doner, geri alma isareti yerinde kalir', async () => {
    const entry = wp({ remoteEditSkip: 'live_entry_edited', remoteEditSeenAt: '2026-10-01T00:00:00.000Z', contentHash: 'x' });
    const { svc, prisma } = service(articleRow({ publishedTo: [entry] }));
    const r = await svc.markPublishedEntryUpdated(S, A, entry.targetId);
    expect(r.publishedTo[0]).toEqual(entry);
    expect(prisma.article.updateMany).not.toHaveBeenCalled();
    expect(plan(r.publishedTo)).toMatchObject({ kind: 'proposal', block: 'live_copy_edited' });
  });
});
