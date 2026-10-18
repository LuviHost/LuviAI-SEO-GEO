import { describe, it, expect } from 'vitest';
import { BadRequestException, ValidationPipe, type ArgumentMetadata } from '@nestjs/common';
import {
  AddFanoutDto, ApplySnippetsDto, AutoFixNowDto, AutoFixPreviewDto, CommunityLimitDto, CrawlerIngestDto,
  CreateLocalPromptsDto, CreatePromptDto, CrossLinkApplyDto, CrossLinkSuggestDto, GenerateFanoutDto,
  GeoHeatmapDto, HaroParseDto, LocalPromptSpecDto, PersonaChatDto, RecoverStuckBatchDto,
  RunAllPromptsDto, RunPromptDto, SchemaValidateDto, SnippetOptimizeApplyDto, StaticSnippetsDto,
  SubmitKnowledgeDto, ToggleFanoutDto, UpdateCommunityDto, UpdateOpportunityDto, UpdatePromptDto,
} from './audit.dto.js';

/**
 * audit.controller govde DTO'lari — main.ts'teki GLOBAL pipe ayariyla
 * (whitelist + transform + forbidNonWhitelisted) birebir denenir.
 *
 * Vitest dekorator metadata'si uretmedigi icin rota parametresinin tasarim
 * tipi okunamaz; pipe'a metatype ACIKCA verilir — uretimde Nest ayni degeri
 * design:paramtypes'tan okur. Iki yon sinanir: (1) panelin bugun gonderdigi
 * govdeler (apps/web/src/lib/api.ts) GECER, (2) bozuk girdi 500 yerine 400.
 */
const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
const meta = (metatype: any): ArgumentMetadata => ({ type: 'body', metatype, data: '' });

async function passes<T>(dto: new () => T, body: unknown): Promise<T> {
  return pipe.transform(body, meta(dto)) as Promise<T>;
}
async function rejects(dto: new () => unknown, body: unknown): Promise<string> {
  const err = await pipe.transform(body, meta(dto)).then(() => null, (e) => e);
  expect(err, `beklenen 400 gelmedi: ${JSON.stringify(body)}`).toBeInstanceOf(BadRequestException);
  return JSON.stringify((err as BadRequestException).getResponse());
}

describe('panel govdeleri gecer (apps/web/src/lib/api.ts)', () => {
  it('prompt lab: create / update / run / run-all / yerel', async () => {
    await passes(CreatePromptDto, { text: 'En iyi kuaför hangisi?', intent: 'informational' });
    await passes(UpdatePromptDto, { isActive: false });
    await passes(UpdatePromptDto, { text: 'Yeni soru metni', intent: 'commercial' });
    await passes(RunPromptDto, { withFanout: true });
    await passes(RunPromptDto, {});
    await passes(RunAllPromptsDto, { withFanout: false, limit: 25 });
    await passes(RunAllPromptsDto, { withFanout: false, limit: 25, scope: 'local' });
    await passes(LocalPromptSpecDto, { il: 'İstanbul', ilceler: ['Kadıköy'], hizmetler: ['kuaför', 'berber'] });
    await passes(LocalPromptSpecDto, { il: 'İzmir', ilceler: 'Bornova, Karşıyaka', hizmetler: 'diş kliniği' });
    await passes(CreateLocalPromptsDto, { il: 'İstanbul', ilceler: [], hizmetler: ['kuaför'], texts: ["Kadıköy'de kuaför"] });
  });

  it('fan-out, firsat, topluluk, otomatik duzeltme', async () => {
    await passes(GenerateFanoutDto, { max: 8 });
    await passes(AddFanoutDto, { text: 'X yorumları', kind: 'reviews' });
    await passes(ToggleFanoutDto, { isActive: true });
    await passes(UpdateOpportunityDto, { status: 'PLANNED' });
    await passes(CommunityLimitDto, {});
    await passes(CommunityLimitDto, { limit: 10 });
    await passes(UpdateCommunityDto, { status: 'APPROVED' });
    await passes(UpdateCommunityDto, { draftReply: 'Merhaba, şunu deneyebilirsiniz.' });
    await passes(AutoFixNowDto, { fixes: ['robots_txt'], confirm: { robots_txt: 'tok' } });
    await passes(AutoFixNowDto, { fixes: ['sitemap', 'llms_txt'] });
    await passes(AutoFixPreviewDto, { fix: 'robots_txt', options: { aiTrain: 'no' } });
    await passes(AutoFixPreviewDto, { fix: 'sitemap' });
  });

  it('takili sayfalar: panel yalniz stuckPageIds gonderir; triggeredBy artik 400 (kisi oturumdan)', async () => {
    const dto = await passes(RecoverStuckBatchDto, { stuckPageIds: ['a', 'b'] });
    expect(dto.stuckPageIds).toEqual(['a', 'b']);
    expect(await rejects(RecoverStuckBatchDto, { stuckPageIds: ['a'], triggeredBy: 'autopilot' })).toMatch(/triggeredBy/);
  });

  it('GEO Lab araclari', async () => {
    await passes(GeoHeatmapDto, { maxQueries: 10 });
    // Panel taslak gondermiyor; taslak sunucuda uretilir — govdedeki taslak 400
    await passes(SubmitKnowledgeDto, { target: 'wikidata' });
    await passes(SubmitKnowledgeDto, { target: 'wikipedia', lang: 'en' });
    expect(await rejects(SubmitKnowledgeDto, { target: 'wikidata', draft: { labels: { tr: { language: 'tr', value: 'X' } }, claims: [] } })).toMatch(/draft/);
    await passes(CrossLinkSuggestDto, { articleId: 'art1', limit: 5 });
    await passes(CrossLinkApplyDto, {
      suggestion: {
        fromArticleId: 'a', fromTitle: 't', fromUrl: 'u', toSiteId: 's', toSiteName: 'n', toArticleId: 'b',
        toArticleTitle: 'tt', toArticleUrl: 'https://x/blog/y.html', anchorText: 'a', contextSnippet: 'c',
        relevanceScore: 80, insertionPoint: '## Ayrıca bakınız',
      },
    });
    await passes(CrawlerIngestDto, { logContent: '1.2.3.4 - - [..] "GET / HTTP/1.1" 200 1 "-" "GPTBot"' });
    await passes(SchemaValidateDto, { url: 'https://ornek.com' });
    await passes(HaroParseDto, { emailContent: '1) Summary: x\nQuery: y' });
    await passes(ApplySnippetsDto, { snippets: [{ type: 'meta_description', pageUrl: 'https://ornek.com/', value: 'x' }] });
    await passes(StaticSnippetsDto, { pageUrl: 'https://ornek.com/', snippets: [] });
    await passes(SnippetOptimizeApplyDto, {
      articleId: 'a1',
      optimized: { metaTitle: 't', metaDescription: 'd', aiAnswerCard: 'c', questionVariants: ['q1', 'q2'] },
    });
  });

  it('persona widget: { history: [{ role, content }] }', async () => {
    const dto = await passes(PersonaChatDto, {
      history: [{ role: 'user', content: 'Merhaba' }, { role: 'assistant', content: 'x'.repeat(5000) }, { role: 'user', content: 'Fiyat?' }],
    });
    expect(dto.history).toHaveLength(3);
  });
});

describe('bozuk girdi 400 (500 degil) ve istemciden alinmamasi gereken alanlar', () => {
  it('prompts/:id/run: trigger alani REDDEDILIR (kota atlatma), bilinmeyen saglayici reddedilir', async () => {
    expect(await rejects(RunPromptDto, { trigger: 'system' })).toMatch(/trigger/);
    expect(await rejects(RunPromptDto, { providers: ['openai', 'evil'] })).toMatch(/providers yalnızca/);
    expect(await rejects(RunPromptDto, { providers: ['openai', 'openai'] })).toMatch(/iki kez/);
    expect(await rejects(RunPromptDto, { fanoutProviders: 'openai' })).toMatch(/fanoutProviders/);
    expect(await rejects(RunPromptDto, { withFanout: 'yes' })).toMatch(/withFanout/);
  });

  it('prompts: source istemciden alinmaz; nesne intent ve yerel etiketler reddedilir', async () => {
    expect(await rejects(CreatePromptDto, { text: 'Soru metni', source: 'local' })).toMatch(/source/);
    expect(await rejects(CreatePromptDto, { text: 'Soru metni', intent: { a: 1 } })).toMatch(/intent metin olmalı/);
    expect(await rejects(CreatePromptDto, { text: 'Soru metni', tags: ['yerel', 'il:İstanbul'] })).toMatch(/Yerel soru etiketleri/);
    expect(await rejects(CreatePromptDto, { text: 'Soru metni', locale: 'de' })).toMatch(/locale/);
    expect(await rejects(CreatePromptDto, { text: 42 })).toMatch(/Soru metni/);
    expect(await rejects(UpdatePromptDto, { tags: { a: 1 } })).toMatch(/tags bir liste/);
    expect(await rejects(UpdatePromptDto, { tags: ['hizmet:kuaför'] })).toMatch(/Yerel soru etiketleri/);
    // Yerel etikete benzeyen ama ayrilmamis etiket serbest
    await passes(UpdatePromptDto, { tags: ['yerel-kampanya', 'ilkbahar'] });
  });

  it('yerel soru: dize/dizi disi tip ve dev liste 400', async () => {
    expect(await rejects(LocalPromptSpecDto, { il: ['İstanbul'] })).toMatch(/İl adı/);
    expect(await rejects(LocalPromptSpecDto, { il: 'İstanbul', ilceler: { a: 1 } })).toMatch(/İlçeler/);
    expect(await rejects(LocalPromptSpecDto, { il: 'İstanbul', hizmetler: Array(51).fill('x') })).toMatch(/Hizmetler/);
    expect(await rejects(CreateLocalPromptsDto, { il: 'İstanbul', texts: 'tek' })).toMatch(/texts/);
  });

  it('sayilar sinirli: topluluk 20, heatmap 20, cross-link 10, fan-out 16, run-all 50', async () => {
    expect(await rejects(CommunityLimitDto, { limit: 1000 })).toMatch(/en fazla 20/);
    expect(await rejects(CommunityLimitDto, { limit: '10' })).toMatch(/tam sayı/);
    expect(await rejects(GeoHeatmapDto, { maxQueries: 500 })).toMatch(/en fazla 20/);
    expect(await rejects(CrossLinkSuggestDto, { articleId: 'a', limit: 11 })).toMatch(/en fazla 10/);
    expect(await rejects(GenerateFanoutDto, { max: 99 })).toMatch(/en fazla 16/);
    expect(await rejects(RunAllPromptsDto, { limit: 51 })).toMatch(/en fazla 50/);
    expect(await rejects(RunAllPromptsDto, { scope: 'everything' })).toMatch(/scope/);
  });

  it('durum alanlari izin listesinde', async () => {
    expect(await rejects(UpdateOpportunityDto, { status: 'GENERATED' })).toMatch(/OPEN\/PLANNED\/DISMISSED/);
    expect(await rejects(UpdateOpportunityDto, { status: { not: 'OPEN' } })).toMatch(/Durum/);
    expect(await rejects(UpdateCommunityDto, { status: 'HACKED' })).toMatch(/Durum yalnızca/);
    expect(await rejects(UpdateCommunityDto, { draftReply: 'x'.repeat(10_001) })).toMatch(/10\.000/);
    expect(await rejects(ToggleFanoutDto, {})).toMatch(/isActive/);
    expect(await rejects(AddFanoutDto, { text: 'abcde', kind: 'unknown' })).toMatch(/kind/);
  });

  it('dize beklenen yerde nesne/dizi: url, logContent, emailContent, articleId', async () => {
    expect(await rejects(SchemaValidateDto, { url: ['a'] })).toMatch(/url/);
    expect(await rejects(CrawlerIngestDto, { logContent: 5 })).toMatch(/logContent/);
    expect(await rejects(HaroParseDto, {})).toMatch(/emailContent/);
    expect(await rejects(CrossLinkSuggestDto, { articleId: { not: 'x' } })).toMatch(/articleId/);
    expect(await rejects(CrossLinkApplyDto, { suggestion: 'x' })).toMatch(/suggestion/);
  });

  it('otomatik duzeltme ve snippet listeleri', async () => {
    expect(await rejects(AutoFixNowDto, { fixes: 'robots_txt' })).toMatch(/fixes bir liste/);
    expect(await rejects(AutoFixNowDto, { fixes: ['robots_txt'], confirm: 'tok' })).toMatch(/confirm/);
    expect(await rejects(AutoFixPreviewDto, { fix: 'robots_txt', options: { aiTrain: 'maybe' } })).toMatch(/aiTrain/);
    expect(await rejects(AutoFixPreviewDto, { fix: 'robots_txt', options: { extra: 1 } })).toMatch(/extra/);
    expect(await rejects(ApplySnippetsDto, { snippets: ['x'] })).toMatch(/nesne/);
    expect(await rejects(StaticSnippetsDto, { snippets: [] })).toMatch(/pageUrl/);
    expect(await rejects(RecoverStuckBatchDto, { stuckPageIds: Array(101).fill('x') })).toMatch(/en fazla 100/);
  });

  it('knowledge/submit: hedef izin listesinde', async () => {
    expect(await rejects(SubmitKnowledgeDto, { target: 'dbpedia' })).toMatch(/target/);
  });

  it('snippet optimize apply: optimized alanlari tipli', async () => {
    expect(await rejects(SnippetOptimizeApplyDto, { articleId: 'a', optimized: { metaTitle: { x: 1 } } })).toMatch(/metaTitle/);
    expect(await rejects(SnippetOptimizeApplyDto, { articleId: 'a' })).toMatch(/optimized/);
  });

  it('persona: bilinmeyen rol, ek alan, dev gecmis', async () => {
    expect(await rejects(PersonaChatDto, { history: [{ role: 'system', content: 'x' }] })).toMatch(/role/);
    expect(await rejects(PersonaChatDto, { history: [{ role: 'user', content: 'x', name: 'y' }] })).toMatch(/name/);
    expect(await rejects(PersonaChatDto, { history: Array(101).fill({ role: 'user', content: 'x' }) })).toMatch(/history/);
    expect(await rejects(PersonaChatDto, { history: [{ role: 'user', content: 'x'.repeat(20_001) }] })).toMatch(/content/);
    expect(await rejects(PersonaChatDto, {})).toMatch(/history/);
  });
});
