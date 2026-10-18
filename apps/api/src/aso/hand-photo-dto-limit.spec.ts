import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Body, Controller, HttpCode, Post, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { HAND_PHOTO_MAX_BASE64_CHARS, HandPhotoDto } from './aso.dto.js';
import { JSON_BODY_LIMIT_BYTES } from '../request-body.js';

/**
 * HandPhotoDto.screenshotBase64 tavani JSON govde sinirinin ALTINDA olmali.
 *
 * NEDEN VAR: DTO 20.000.000 karaktere izin veriyordu ama main.ts JSON govdesini
 * 2 MiB'de kesiyor (request-body.ts) ve sinir ustu govde DTO'ya varmadan 413
 * aliyor. Tavan hic calismiyor, Turkce DTO mesaji hic gorunmuyor, belge
 * yanlis sinir soyluyordu. Burada GERCEK zincir kurulur: Nest/Express, main.ts
 * ile ayni useBodyParser('json', { limit }) ve ayni ValidationPipe ayarlari.
 *
 * Vitest dekorator metadata'si uretmez: govde tipi elle yazilir
 * (main-body-limit.spec.ts ile ayni yontem).
 */

@Controller('el-fotografi')
class HandPhotoTestController {
  @Post()
  @HttpCode(200)
  run(@Body() body: HandPhotoDto) {
    return { uzunluk: body.screenshotBase64.length, width: body.width ?? null };
  }
}
Reflect.defineMetadata('design:paramtypes', [HandPhotoDto], HandPhotoTestController.prototype, 'run');

let app: NestExpressApplication;
beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ controllers: [HandPhotoTestController] }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT_BYTES });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  await app.init();
});
afterAll(async () => { await app?.close(); });

/** n karakterlik gercek base64 (rastgele gorsel baytlari; n 4'un kati) */
const base64Of = (n: number) => randomBytes((n / 4) * 3).toString('base64');
const post = (body: unknown) => request(app.getHttpServer()).post('/el-fotografi').set('Content-Type', 'application/json').send(JSON.stringify(body));

describe('HandPhotoDto — govde siniriyla uyumlu tavan', () => {
  it('tavandaki ekran goruntusu (2.000.000 karakter) govde sinirinden ve DTO\'dan gecer', async () => {
    const shot = base64Of(HAND_PHOTO_MAX_BASE64_CHARS);
    expect(shot).toHaveLength(2_000_000);
    const r = await post({ screenshotBase64: shot, brandColor: '#FF6A00', width: 4096, height: 4096 });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ uzunluk: 2_000_000, width: 4096 });
  });

  it('tavanin bir fazlasi govde sinirina takilmaz; DTO Turkce mesajla 400 doner', async () => {
    const r = await post({ screenshotBase64: `${base64Of(2_000_000)}A` });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body.message)).toContain('Ekran görüntüsü çok büyük: base64 metni en fazla 2.000.000 karakter olabilir');
  });

  it('govde siniri ustu yine 413 (DTO\'ya varmaz)', async () => {
    const r = await post({ screenshotBase64: base64Of(2_200_000) });
    expect(r.status).toBe(413);
  });

  it('sozlesme: en uzun govde, \'/\' karakterini \'\\/\' yazan istemcide bile sinirin altinda', () => {
    const shot = base64Of(HAND_PHOTO_MAX_BASE64_CHARS);
    const body = JSON.stringify({ screenshotBase64: shot, brandColor: '#FF6A00', width: 4096, height: 4096 });
    expect(Buffer.byteLength(body)).toBeLessThan(JSON_BODY_LIMIT_BYTES);
    // PHP json_encode varsayilani gibi '/' kacislayan istemci (rastgele veride ~1/64)
    expect(Buffer.byteLength(body.replace(/\//g, '\\/'))).toBeLessThan(JSON_BODY_LIMIT_BYTES);
  });
});
