import { describe, it, expect, vi } from 'vitest';
import {
  annotateRankedTopics,
  explicitContentPlan,
  findRankerTopicHint,
  rankerPlanFromTopic,
  readStoredContentPlan,
  withContentPlan,
} from './content-plan.js';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { GenerateArticleDto, ScheduleTopicDto } from './articles.dto.js';

describe('content-plan — kayittaki icerik tipi karari', () => {
  it('yalniz explicit ve ranker kaynakli karar okunur', () => {
    expect(readStoredContentPlan({ contentPlan: { type: 'pricing', source: 'explicit' } })).toEqual({ type: 'pricing', source: 'explicit' });
    expect(readStoredContentPlan({ contentPlan: { type: 'howto', source: 'ranker' } })).toEqual({ type: 'howto', source: 'ranker' });
    // siniflandirici / varsayilan karari her uretimde yeniden verilir
    expect(readStoredContentPlan({ contentPlan: { type: 'comparison', source: 'classifier' } })).toBeNull();
    expect(readStoredContentPlan({ contentPlan: { type: 'guide', source: 'default' } })).toBeNull();
    expect(readStoredContentPlan({ contentPlan: { type: 'roman', source: 'explicit' } })).toBeNull();
    expect(readStoredContentPlan(null)).toBeNull();
    expect(readStoredContentPlan({ writer: {} })).toBeNull();
  });

  it('withContentPlan diger anahtarlari korur; karar yoksa girdi aynen doner', () => {
    const base = { allowanceCharge: { at: 'x', source: 'user_start' } };
    expect(withContentPlan(base, explicitContentPlan('comparison'))).toEqual({
      allowanceCharge: { at: 'x', source: 'user_start' },
      contentPlan: { type: 'comparison', source: 'explicit' },
    });
    expect(withContentPlan(base, null)).toEqual(base);
    expect(withContentPlan(null, null)).toBeNull();
    expect(withContentPlan(null, explicitContentPlan('howto'))).toEqual({ contentPlan: { type: 'howto', source: 'explicit' } });
  });

  it('explicitContentPlan gecersiz tipte null', () => {
    expect(explicitContentPlan(undefined)).toBeNull();
    expect(explicitContentPlan('review')).toBeNull();
    expect(explicitContentPlan('best_for')).toEqual({ type: 'best_for', source: 'explicit' });
  });

  const V = { content_type_v: 1 };
  it('rankerPlanFromTopic: yalniz bu surumun kuyruk kaydi (content_type_v); content_type ya da Article disi schema_type', () => {
    expect(rankerPlanFromTopic({ ...V, topic: 'X', content_type: 'alternatives', content_type_source: 'ranker' })).toEqual({ type: 'alternatives', source: 'ranker' });
    expect(rankerPlanFromTopic({ ...V, topic: 'X', content_type: 'howto', content_type_source: 'ranker', schema_type: 'HowTo' })).toEqual({ type: 'howto', source: 'ranker' });
    expect(rankerPlanFromTopic({ ...V, topic: 'X', content_type: 'guide', content_type_source: 'default', schema_type: 'Article' })).toBeNull();
    // annotate'in siniflandirici tahmini siralayici karari sayilmaz
    expect(rankerPlanFromTopic({ ...V, topic: 'X vs Y', content_type: 'comparison', content_type_source: 'classifier' })).toBeNull();
    expect(rankerPlanFromTopic(null)).toBeNull();
  });

  it('yayin gunu: bu surumden ONCEKI kuyruk kaydinin schema_type / content_type alani sablon acmaz', () => {
    expect(rankerPlanFromTopic({ topic: 'X', schema_type: 'HowTo' })).toBeNull();
    expect(rankerPlanFromTopic({ topic: 'X', schema_type: 'Comparison' })).toBeNull();
    expect(rankerPlanFromTopic({ topic: 'X', content_type: 'pricing' })).toBeNull();
  });
});

describe('findRankerTopicHint — son konu kuyrugu', () => {
  const queue = {
    tier1Topics: [{ topic: 'Shopify Alternatifleri', content_type: 'alternatives', content_type_source: 'ranker', content_type_v: 1 }],
    tier2Topics: [{ topic: 'KDV  nasıl hesaplanır?', content_type: 'howto', content_type_source: 'ranker', schema_type: 'HowTo', content_type_v: 1 }],
    tier3Topics: [
      { topic: 'X vs Y', content_type: 'comparison', content_type_source: 'classifier', schema_type: 'Article', content_type_v: 1 },
      // bu surumden onceki kuyruk kaydi (isaretsiz)
      { topic: 'Eski konu', schema_type: 'HowTo' },
    ],
  };
  const prisma = { topicQueue: { findFirst: vi.fn(async () => queue) } };

  it('baslik (buyuk/kucuk harf, bosluk farki yok sayilarak) eslesir', async () => {
    expect(await findRankerTopicHint(prisma, 's1', 'shopify alternatifleri')).toEqual({ contentType: 'alternatives', schemaType: null });
    expect(await findRankerTopicHint(prisma, 's1', 'KDV nasıl hesaplanır?')).toEqual({ contentType: 'howto', schemaType: 'HowTo' });
    expect(prisma.topicQueue.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { siteId: 's1' }, orderBy: { generatedAt: 'desc' } }));
  });

  it('siniflandirici kaynakli content_type siralayici ipucu sayilmaz', async () => {
    expect(await findRankerTopicHint(prisma, 's1', 'X vs Y')).toEqual({ contentType: null, schemaType: 'Article' });
  });

  it('isaretsiz (eski) kuyruk kaydi ipucu vermez', async () => {
    expect(await findRankerTopicHint(prisma, 's1', 'Eski konu')).toEqual({ contentType: null, schemaType: null });
  });

  it('konu yok / kuyruk yok / okuma hatasi → null (uretim durmaz)', async () => {
    expect(await findRankerTopicHint(prisma, 's1', 'Başka konu')).toBeNull();
    expect(await findRankerTopicHint({ topicQueue: { findFirst: vi.fn(async () => null) } }, 's1', 'X')).toBeNull();
    expect(await findRankerTopicHint({ topicQueue: { findFirst: vi.fn(async () => { throw new Error('db'); }) } }, 's1', 'X')).toBeNull();
    expect(await findRankerTopicHint({}, 's1', 'X')).toBeNull();
    expect(await findRankerTopicHint(prisma, 's1', '  ')).toBeNull();
  });
});

describe('annotateRankedTopics — siralayici ciktisi', () => {
  it('gecerli content_type korunur, gecersizse schema_type / baslik siniflandiricisi', () => {
    const out = annotateRankedTopics([
      { topic: 'A', content_type: 'Best For', score: 90 },
      { topic: 'Shopify vs WooCommerce', content_type: 'review', schema_type: 'Article' },
      { topic: 'Kurulum', schema_type: 'HowTo' },
      { topic: 'E-Fatura nedir?' },
      'bozuk',
      null,
    ]);
    expect(out).toEqual([
      { topic: 'A', content_type: 'best_for', content_type_source: 'ranker', score: 90, content_type_v: 1 },
      { topic: 'Shopify vs WooCommerce', content_type: 'comparison', content_type_source: 'classifier', schema_type: 'Article', content_type_v: 1 },
      { topic: 'Kurulum', content_type: 'howto', content_type_source: 'ranker', schema_type: 'HowTo', content_type_v: 1 },
      { topic: 'E-Fatura nedir?', content_type: 'guide', content_type_source: 'default', content_type_v: 1 },
    ]);
  });
  it('dizi degilse bos dizi', () => {
    expect(annotateRankedTopics(undefined)).toEqual([]);
    expect(annotateRankedTopics({})).toEqual([]);
  });
});

describe('DTO — acik contentType', () => {
  it('GenerateArticleDto: gecerli tip kabul, bilinmeyen tip 400 mesajli', async () => {
    expect(await validate(plainToInstance(GenerateArticleDto, { topic: 'X', contentType: 'pricing' }))).toEqual([]);
    expect(await validate(plainToInstance(GenerateArticleDto, { topic: 'X' }))).toEqual([]);
    const errs = await validate(plainToInstance(GenerateArticleDto, { topic: 'X', contentType: 'review' }));
    expect(errs[0]?.property).toBe('contentType');
    expect(Object.values(errs[0]?.constraints ?? {})[0]).toMatch(/contentType şunlardan biri olmalı/);
  });
  it('ScheduleTopicDto: contentType istege bagli ve dogrulanir', async () => {
    const base = { topic: 'X', scheduledAt: '2026-11-01T09:00:00.000Z' };
    expect(await validate(plainToInstance(ScheduleTopicDto, { ...base, contentType: 'comparison' }))).toEqual([]);
    expect((await validate(plainToInstance(ScheduleTopicDto, { ...base, contentType: 5 })))[0]?.property).toBe('contentType');
  });
});
