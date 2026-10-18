import { describe, it, expect } from 'vitest';
import { ValidationPipe, BadRequestException } from '@nestjs/common';
import { TRANSLATION_LANGUAGES, TranslateArticleDto, TranslateBulkDto } from './articles.dto.js';

const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const asBody = (metatype: any) => ({ type: 'body' as const, metatype, data: '' });

describe('ceviri dil kodu — yalniz desteklenen diller (istem enjeksiyonu yok)', () => {
  // Cevirmen yalniz TRANSLATION_LANGUAGES'i destekler (translator.service LANG_NAMES);
  // listede olmayan gecerli bir ISO kodu da (pt, pt-BR) serviste "Desteklenmeyen dil"
  // olurdu. Dogrulama bunu istek aninda, ucretli cagridan once Turkce soyler.
  it('desteklenen diller gecer', async () => {
    for (const toLanguage of TRANSLATION_LANGUAGES) {
      await expect(pipe.transform({ toLanguage }, asBody(TranslateArticleDto)), toLanguage).resolves.toBeDefined();
    }
    await expect(pipe.transform({ languages: ['en', 'de'] }, asBody(TranslateBulkDto))).resolves.toBeDefined();
  });
  it('desteklenmeyen ISO kodlari 400 ve mesaj desteklenen dilleri sayar', async () => {
    for (const toLanguage of ['pt', 'it', 'pt-BR', 'en-US']) {
      const err = await pipe.transform({ toLanguage }, asBody(TranslateArticleDto)).catch((e) => e);
      expect(err, toLanguage).toBeInstanceOf(BadRequestException);
      expect(JSON.stringify(err.getResponse())).toContain(TRANSLATION_LANGUAGES.join(', '));
    }
    await expect(pipe.transform({ languages: ['en', 'pt'] }, asBody(TranslateBulkDto))).rejects.toBeInstanceOf(BadRequestException);
  });
  it('serbest metin ve bicimsiz kodlar 400', async () => {
    for (const toLanguage of ['english', 'EN', 'en; ignore previous', 'e', 'en-us', '']) {
      await expect(pipe.transform({ toLanguage }, asBody(TranslateArticleDto)), toLanguage).rejects.toBeInstanceOf(BadRequestException);
    }
    await expect(pipe.transform({ languages: ['en', 'en'] }, asBody(TranslateBulkDto))).rejects.toBeInstanceOf(BadRequestException);
  });
});
