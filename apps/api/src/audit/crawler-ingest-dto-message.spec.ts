import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CrawlerIngestDto } from './audit.dto.js';

/**
 * POST crawler/ingest — log tavani asilinca istemci TURKCE mesaj alir.
 *
 * NEDEN VAR: @MaxLength(1_000_000) mesajsizdi; class-validator'in varsayilan
 * metni ("logContent must be shorter than or equal to 1000000 characters")
 * API anahtariyla log yukleyen musteriye aynen gidiyordu. Panel bu siniri
 * yuklemeden once uyguladigi icin hatayi yalniz API istemcileri gorur.
 * Pipe main.ts ile ayni ayarlarla kosar.
 */
const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
const asBody = { type: 'body' as const, metatype: CrawlerIngestDto };

async function messages(value: unknown): Promise<string[]> {
  const err: any = await pipe.transform(value, asBody).catch((e) => e);
  expect(err).toBeInstanceOf(BadRequestException);
  return err.getResponse().message as string[];
}

describe('CrawlerIngestDto — Turkce tavan mesaji', () => {
  it('1.000.001 karakter: tek, Turkce mesaj; Ingilizce varsayilan metin yok', async () => {
    const m = await messages({ logContent: 'a'.repeat(1_000_001) });
    expect(m).toEqual(['Log içeriği en fazla 1.000.000 karakter olabilir; daha kısa bir döneme ait log gönder.']);
    expect(m.join(' ')).not.toMatch(/must be shorter/);
  });

  it('tam 1.000.000 karakter gecer', async () => {
    const dto = await pipe.transform({ logContent: 'a'.repeat(1_000_000) }, asBody);
    expect(dto.logContent).toHaveLength(1_000_000);
  });

  it('dize olmayan deger: mesajlarin hepsi Turkce', async () => {
    const m = await messages({ logContent: 5 });
    expect(m).toContain('Log içeriği (logContent) gerekli.');
    expect(m.join(' ')).not.toMatch(/must be/);
  });
});
