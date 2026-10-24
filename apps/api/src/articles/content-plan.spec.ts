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

  it('rankerPlanFromTopic: content_type ya da Article disi schema_type; aksi halde null', () => {
    expect(rankerPlanFromTopic({ topic: 'X', content_type: 'alternatives' })).toEqual({ type: 'alternatives', source: 'ranker' });
    expect(rankerPlanFromTopic({ topic: 'X', schema_type: 'HowTo' })).toEqual({ type: 'howto', source: 'ranker' });
    expect(rankerPlanFromTopic({ topic: 'X', schema_type: 'Article' })).toBeNull();
    // annotate'in siniflandirici tahmini siralayici karari sayilmaz
    expect(rankerPlanFromTopic({ topic: 'X vs Y', content_type: 'comparison', content_type_source: 'classifier' })).toBeNull();
    expect(rankerPlanFromTopic(null)).toBeNull();
  });
});

describe('findRankerTopicHint — son konu kuyrugu', () => {
  const queue = {
    tier1Topics: [{ topic: 'Shopify Alternatifleri', content_type: 'alternatives' }],
    tier2Topics: [{ topic: 'KDV  nasıl hesaplanır?', schema_type: 'HowTo' }],
    tier3Topics: [{ topic: 'X vs Y', content_type: 'comparison', content_type_source: 'classifier', schema_type: 'Article' }],
  };
  const prisma = { topicQueue: { findFirst: vi.fn(async () => queue) } };

  it('baslik (buyuk/kucuk harf, bosluk farki yok sayilarak) eslesir', async () => {
    expect(await findRankerTopicHint(prisma, 's1', 'shopify alternatifleri')).toEqual({ contentType: 'alternatives', schemaType: null });
    expect(await findRankerTopicHint(prisma, 's1', 'KDV nasıl hesaplanır?')).toEqual({ contentType: null, schemaType: 'HowTo' });
    expect(prisma.topicQueue.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { siteId: 's1' }, orderBy: { generatedAt: 'desc' } }));
  });

  it('siniflandirici kaynakli content_type siralayici ipucu sayilmaz', async () => {
    expect(await findRankerTopicHint(prisma, 's1', 'X vs Y')).toEqual({ contentType: null, schemaType: 'Article' });
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
      { topic: 'A', content_type: 'best_for', content_type_source: 'ranker', score: 90 },
      { topic: 'Shopify vs WooCommerce', content_type: 'comparison', content_type_source: 'classifier', schema_type: 'Article' },
      { topic: 'Kurulum', content_type: 'howto', content_type_source: 'ranker', schema_type: 'HowTo' },
      { topic: 'E-Fatura nedir?', content_type: 'guide', content_type_source: 'default' },
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
