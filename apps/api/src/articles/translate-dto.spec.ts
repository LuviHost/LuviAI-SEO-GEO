import { describe, it, expect } from 'vitest';
import { ValidationPipe, BadRequestException } from '@nestjs/common';
import { TranslateArticleDto, TranslateBulkDto } from './articles.dto.js';

const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const asBody = (metatype: any) => ({ type: 'body' as const, metatype, data: '' });

describe('ceviri dil kodu — dar desen (SDK uyumu + istem enjeksiyonu yok)', () => {
  it('ISO kodlari gecer', async () => {
    for (const toLanguage of ['en', 'pt', 'it', 'pt-BR', 'en-US']) {
      await expect(pipe.transform({ toLanguage }, asBody(TranslateArticleDto)), toLanguage).resolves.toBeDefined();
    }
    await expect(pipe.transform({ languages: ['en', 'pt'] }, asBody(TranslateBulkDto))).resolves.toBeDefined();
  });
  it('serbest metin ve bicimsiz kodlar 400', async () => {
    for (const toLanguage of ['english', 'EN', 'en; ignore previous', 'e', 'en-us', '']) {
      await expect(pipe.transform({ toLanguage }, asBody(TranslateArticleDto)), toLanguage).rejects.toBeInstanceOf(BadRequestException);
    }
    await expect(pipe.transform({ languages: ['en', 'en'] }, asBody(TranslateBulkDto))).rejects.toBeInstanceOf(BadRequestException);
  });
});
