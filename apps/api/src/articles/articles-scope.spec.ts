import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, NotFoundException, ValidationPipe } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants.js';
import { ArticlesController } from './articles.controller.js';
import { TranslateArticleDto, TranslateBulkDto } from './articles.dto.js';

/**
 * Makale uclari — siteler arasi IDOR ve RanksUp kaynaklarini kotuye kullanan
 * uclar. SiteAccessGuard yalniz :siteId'yi dogrular; reschedule / unschedule /
 * translate servisleri makaleyi yalniz id ile okuyordu.
 */
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const asBody = (metatype: any) => ({ type: 'body' as const, metatype, data: '' });

const OWN = 'art-own';
const FOREIGN = 'art-baska-sitenin';

function controller() {
  const articles = {
    findOne: vi.fn(async (id: string, siteId?: string) => (id === OWN && siteId === 's1' ? { id: OWN, siteId: 's1' } : null)),
  };
  const scheduler = {
    rescheduleArticle: vi.fn(async (id: string) => ({ id })),
    unscheduleArticle: vi.fn(async () => ({ ok: true })),
  };
  const translator = { translate: vi.fn(async () => ({ ok: true })), bulkTranslateSite: vi.fn(async () => ({ scheduled: 0, results: [] })) };
  const ctl = new ArticlesController(articles as any, scheduler as any, {} as any, translator as any, {} as any);
  return { ctl, articles, scheduler, translator };
}

describe('makale kimligi :siteId ile sinirli', () => {
  it('reschedule: baska sitenin makalesi 404, servis cagrilmaz; kendi makalesi tasinir', async () => {
    const { ctl, scheduler, articles } = controller();
    await expect(ctl.reschedule('s1', FOREIGN, { scheduledAt: '2026-11-01T09:00:00.000Z' })).rejects.toBeInstanceOf(NotFoundException);
    expect(scheduler.rescheduleArticle).not.toHaveBeenCalled();
    await ctl.reschedule('s1', OWN, { scheduledAt: '2026-11-01T09:00:00.000Z' });
    expect(scheduler.rescheduleArticle).toHaveBeenCalledWith(OWN, '2026-11-01T09:00:00.000Z');
    expect(articles.findOne).toHaveBeenCalledWith(OWN, 's1');
  });

  it('unschedule: baska sitenin takvimdeki makalesi silinemez', async () => {
    const { ctl, scheduler } = controller();
    await expect(ctl.unschedule('s1', FOREIGN)).rejects.toBeInstanceOf(NotFoundException);
    expect(scheduler.unscheduleArticle).not.toHaveBeenCalled();
    await ctl.unschedule('s1', OWN);
    expect(scheduler.unscheduleArticle).toHaveBeenCalledWith(OWN);
  });

  it('translate: baska sitenin makalesi cevrilmez (LLM cagrisi yok)', async () => {
    const { ctl, translator } = controller();
    await expect(ctl.translate('s1', FOREIGN, { toLanguage: 'en' })).rejects.toBeInstanceOf(NotFoundException);
    expect(translator.translate).not.toHaveBeenCalled();
    await ctl.translate('s1', OWN, { toLanguage: 'en' });
    expect(translator.translate).toHaveBeenCalledWith(OWN, 'en');
  });

  it('bos siteId site filtresini dusurmez (findOne siteId yoksa filtresiz arardi)', async () => {
    const { ctl, articles, scheduler } = controller();
    await expect(ctl.unschedule('', OWN)).rejects.toBeInstanceOf(NotFoundException);
    expect(articles.findOne).not.toHaveBeenCalled();
    expect(scheduler.unscheduleArticle).not.toHaveBeenCalled();
  });
});

describe('ceviri govdesi — dil listesi', () => {
  it('bilinmeyen dil, sinirsiz/tekrarli liste ve fazla alan 400', async () => {
    await expect(pipe.transform({ toLanguage: 'klingon; yeni talimat' }, asBody(TranslateArticleDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ toLanguage: 'en', siteId: 'baska' }, asBody(TranslateArticleDto))).rejects.toBeInstanceOf(BadRequestException);
    const many = Array.from({ length: 100 }, (_, i) => `x${i}`);
    await expect(pipe.transform({ languages: many }, asBody(TranslateBulkDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ languages: ['en', 'en'] }, asBody(TranslateBulkDto))).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ languages: 'en' }, asBody(TranslateBulkDto))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('tanidik diller gecer', async () => {
    await expect(pipe.transform({ toLanguage: 'de' }, asBody(TranslateArticleDto))).resolves.toBeDefined();
    await expect(pipe.transform({ languages: ['en', 'de'] }, asBody(TranslateBulkDto))).resolves.toBeDefined();
    await expect(pipe.transform({}, asBody(TranslateBulkDto))).resolves.toBeDefined();
  });
});

describe('kaldirilan uclar', () => {
  const proto = ArticlesController.prototype as any;
  const routePaths = Object.getOwnPropertyNames(proto)
    .filter((k) => k !== 'constructor' && typeof proto[k] === 'function')
    .map((k) => Reflect.getMetadata(PATH_METADATA, proto[k]))
    .filter((p): p is string => typeof p === 'string');

  it('schedule-batch (kotasiz uretim), TikTok (dosya okuma) ve Instagram (RanksUp hesabi) rotasi yok', () => {
    expect(routePaths).toContain(':id/translate'); // olcum dogru calisiyor mu
    expect(routePaths).not.toContain('schedule-batch');
    expect(routePaths).not.toContain(':id/video/tiktok');
    expect(routePaths).not.toContain(':id/video/instagram');
    expect(proto.scheduleBatch).toBeUndefined();
    expect(proto.uploadTikTok).toBeUndefined();
    expect(proto.uploadInstagram).toBeUndefined();
  });
});
