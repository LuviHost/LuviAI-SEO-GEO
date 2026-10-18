import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { BadRequestException, ValidationPipe, type ArgumentMetadata } from '@nestjs/common';
import { getMetadataStorage } from 'class-validator';
import * as auditDto from './audit.dto.js';
import {
  ApplySnippetsDto, AutoFixNowDto, AutoFixPreviewDto, CreateLocalPromptsDto, CrossLinkSuggestDto, GenerateFanoutDto,
  GeoHeatmapDto, PersonaChatDto, RecoverStuckBatchDto, RunAllPromptsDto, RunPromptDto, SchemaValidateDto,
  SnippetOptimizeApplyDto, StaticSnippetsDto,
} from './audit.dto.js';

/**
 * audit.dto.ts — her dogrulayici TURKCE mesaj doner.
 *
 * NEDEN VAR: @MaxLength / @IsString / @ArrayMaxSize / @Min / @ValidateNested
 * dekoratorlerinin bir kismi mesajsizdi; class-validator'in Ingilizce
 * varsayilan metni ("url must be shorter than or equal to 2048 characters",
 * "nested property options must be either object or array") 400 govdesinde
 * API anahtarli istemciye aynen gidiyordu. Panel bu sinirlara nadiren
 * takildigi icin hatayi cogunlukla API istemcileri goruyordu.
 *
 * Iki katman: (1) metadata taramasi — dosyadaki HER dogrulayicinin Turkce
 * mesaji var, mesajsiz yeni dekorator testi kirar; (2) main.ts ile ayni pipe
 * ayariyla tavan asimi gercekten Turkce mesaj uretir.
 */
const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
const meta = (metatype: unknown): ArgumentMetadata => ({ type: 'body', metatype: metatype as never, data: '' });

async function messages(dto: unknown, body: unknown): Promise<string[]> {
  const err = await pipe.transform(body, meta(dto)).then(() => null, (e) => e);
  expect(err, `beklenen 400 gelmedi: ${JSON.stringify(body).slice(0, 120)}`).toBeInstanceOf(BadRequestException);
  return ((err as BadRequestException).getResponse() as { message: string[] }).message;
}

/** class-validator varsayilan metinlerinin parcalari (forbidNonWhitelisted metni haric: o dekorator degil) */
const INGILIZCE_VARSAYILAN = /\b(must|nested property|each value in|shorter than|longer than|elements|should not be empty)\b/i;

describe('metadata taramasi — mesajsiz dogrulayici yok', () => {
  const siniflar = Object.entries(auditDto).filter(([, v]) => typeof v === 'function') as Array<[string, new () => unknown]>;

  it('tarama bos gecmiyor: dosyadaki DTO siniflari ve dogrulayicilari bulundu', () => {
    const toplam = siniflar.reduce((n, [, c]) => n + getMetadataStorage().getTargetValidationMetadatas(c, '', true, false).length, 0);
    expect(siniflar.length).toBeGreaterThanOrEqual(30);
    expect(toplam).toBeGreaterThan(100);
  });

  it('her dogrulayicinin Turkce mesaji var (IsOptional disinda)', () => {
    const eksik: string[] = [];
    for (const [ad, sinif] of siniflar) {
      for (const m of getMetadataStorage().getTargetValidationMetadatas(sinif, '', true, false)) {
        // IsOptional (conditionalValidation) hata uretmez
        if (m.type === 'conditionalValidation') continue;
        const mesaj = typeof m.message === 'function' ? m.message({} as never) : m.message;
        if (typeof mesaj !== 'string' || !mesaj.trim() || INGILIZCE_VARSAYILAN.test(mesaj)) {
          eksik.push(`${ad}.${m.propertyName} (${m.name ?? m.type}): ${String(mesaj)}`);
        }
      }
    }
    expect(eksik).toEqual([]);
  });
});

describe('tavan asimi Turkce mesaj uretir (main.ts pipe ayari)', () => {
  const uzun = (n: number) => 'x'.repeat(n);
  const durumlar: Array<{ ad: string; dto: unknown; body: unknown; beklenen: string }> = [
    { ad: 'auto-fix fixes[]', dto: AutoFixNowDto, body: { fixes: [uzun(101)] }, beklenen: 'Her düzeltme anahtarı (fixes) en fazla 100 karakter olabilir' },
    { ad: 'auto-fix/preview fix', dto: AutoFixPreviewDto, body: { fix: uzun(101) }, beklenen: 'Düzeltme anahtarı (fix) en fazla 100 karakter olabilir' },
    { ad: 'recover-batch stuckPageIds[]', dto: RecoverStuckBatchDto, body: { stuckPageIds: [uzun(65)] }, beklenen: 'Her sayfa kimliği (stuckPageIds) en fazla 64 karakter olabilir' },
    { ad: 'prompts/local texts[]', dto: CreateLocalPromptsDto, body: { texts: [uzun(601)] }, beklenen: 'Her soru metni (texts) en fazla 600 karakter olabilir' },
    { ad: 'cross-link articleId', dto: CrossLinkSuggestDto, body: { articleId: uzun(65) }, beklenen: 'Makale kimliği (articleId) en fazla 64 karakter olabilir' },
    { ad: 'schema/validate url', dto: SchemaValidateDto, body: { url: uzun(2049) }, beklenen: 'Adres (url) en fazla 2.048 karakter olabilir' },
    { ad: 'snippets/static pageUrl', dto: StaticSnippetsDto, body: { pageUrl: uzun(2049), snippets: [] }, beklenen: 'Sayfa adresi (pageUrl) en fazla 2.048 karakter olabilir' },
    // Ic ice alanlar: Nest yol onekini ekler
    { ad: 'persona history[].content', dto: PersonaChatDto, body: { history: [{ role: 'user', content: uzun(20_001) }] }, beklenen: 'history.0.content en fazla 20.000 karakter olabilir' },
  ];

  for (const d of durumlar) {
    it(`${d.ad}: Turkce mesaj, Ingilizce varsayilan yok`, async () => {
      const m = await messages(d.dto, d.body);
      expect(m).toContain(d.beklenen);
      expect(m.join(' | ')).not.toMatch(INGILIZCE_VARSAYILAN);
    });
  }

  it('snippet optimize: optimized alanlarinin tavanlari (ic ice)', async () => {
    const m = await messages(SnippetOptimizeApplyDto, {
      articleId: 'a1',
      optimized: { metaTitle: uzun(301), metaDescription: uzun(1001), aiAnswerCard: uzun(5001), questionVariants: [uzun(501)] },
    });
    expect(m).toEqual(expect.arrayContaining([
      'optimized.Meta başlık (metaTitle) en fazla 300 karakter olabilir',
      'optimized.Meta açıklama (metaDescription) en fazla 1.000 karakter olabilir',
      'optimized.AI cevap kartı (aiAnswerCard) en fazla 5.000 karakter olabilir',
      'optimized.Her soru varyantı (questionVariants) en fazla 500 karakter olabilir',
    ]));
    expect(m.join(' | ')).not.toMatch(INGILIZCE_VARSAYILAN);
  });

  it('tam sinirdaki deger gecer (mesaj eklemek siniri degistirmedi)', async () => {
    await pipe.transform({ fix: uzun(100) }, meta(AutoFixPreviewDto));
    await pipe.transform({ url: uzun(2048) }, meta(SchemaValidateDto));
    await pipe.transform({ stuckPageIds: [uzun(64)] }, meta(RecoverStuckBatchDto));
    await pipe.transform({ history: [{ role: 'user', content: uzun(20_000) }] }, meta(PersonaChatDto));
  });
});

describe('tavan disi bozuk girdiler de Turkce', () => {
  const durumlar: Array<{ ad: string; dto: unknown; body: unknown; beklenen: string }> = [
    { ad: 'providers dizi degil', dto: RunPromptDto, body: { providers: 'openai' }, beklenen: 'providers bir liste olmalı' },
    { ad: 'providers fazla', dto: RunPromptDto, body: { providers: Array(8).fill('openai') }, beklenen: 'providers en fazla 7 sağlayıcı içerebilir' },
    { ad: 'fanoutProviders dizi degil', dto: RunPromptDto, body: { fanoutProviders: 'openai' }, beklenen: 'fanoutProviders bir liste olmalı' },
    { ad: 'run-all limit 0', dto: RunAllPromptsDto, body: { limit: 0 }, beklenen: 'limit en az 1 olmalı' },
    { ad: 'fan-out max 0', dto: GenerateFanoutDto, body: { max: 0 }, beklenen: 'max en az 1 olmalı' },
    { ad: 'heatmap maxQueries 0', dto: GeoHeatmapDto, body: { maxQueries: 0 }, beklenen: 'maxQueries en az 1 olmalı' },
    { ad: 'cross-link limit 0', dto: CrossLinkSuggestDto, body: { articleId: 'a', limit: 0 }, beklenen: 'limit en az 1 olmalı' },
    { ad: 'auto-fix 101 anahtar', dto: AutoFixNowDto, body: { fixes: Array(101).fill('robots_txt') }, beklenen: 'fixes en fazla 100 düzeltme anahtarı içerebilir' },
    { ad: 'snippets 101 oge', dto: ApplySnippetsDto, body: { snippets: Array(101).fill({}) }, beklenen: 'snippets en fazla 100 öğe içerebilir' },
    { ad: 'persona 101 mesaj', dto: PersonaChatDto, body: { history: Array(101).fill({ role: 'user', content: 'x' }) }, beklenen: 'history en fazla 100 mesaj içerebilir' },
    { ad: 'recover-batch kimlik dize degil', dto: RecoverStuckBatchDto, body: { stuckPageIds: [5] }, beklenen: 'Her sayfa kimliği (stuckPageIds) metin olmalı' },
    { ad: 'auto-fix/preview options dize', dto: AutoFixPreviewDto, body: { fix: 'robots_txt', options: 'x' }, beklenen: "options { aiTrain: 'yes' | 'no' } biçiminde olmalı" },
    { ad: 'snippet optimize optimized dize', dto: SnippetOptimizeApplyDto, body: { articleId: 'a', optimized: 'x' }, beklenen: 'Uygulanacak öneri (optimized) bir nesne olmalı' },
    { ad: 'persona history ogesi nesne degil', dto: PersonaChatDto, body: { history: ['x'] }, beklenen: 'history.Her mesaj { role, content } biçiminde bir nesne olmalı' },
  ];

  for (const d of durumlar) {
    it(`${d.ad}`, async () => {
      const m = await messages(d.dto, d.body);
      expect(m).toContain(d.beklenen);
      expect(m.join(' | ')).not.toMatch(INGILIZCE_VARSAYILAN);
    });
  }

  it('nesne olmayan options icin ayni cumle iki kez yazilmaz', async () => {
    const m = await messages(AutoFixPreviewDto, { fix: 'robots_txt', options: 'x' });
    expect(new Set(m).size).toBe(m.length);
  });
});
