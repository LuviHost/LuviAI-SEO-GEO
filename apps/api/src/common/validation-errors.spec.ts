import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { BadRequestException, ValidationPipe, type ArgumentMetadata } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsString, ValidateNested, ValidationError, validate } from 'class-validator';
import {
  VALIDATION_MESSAGE_LIMIT,
  VALIDATION_MESSAGE_MAX_CHARS,
  VALIDATION_MORE_ERRORS_MESSAGE,
  VALIDATION_UNKNOWN_VALUE_MESSAGE,
  createGlobalValidationPipe,
  validationExceptionFactory,
} from './validation-errors.js';
import { PersonaChatDto, SnippetOptimizeApplyDto } from '../audit/audit.dto.js';
import { CreateAsaCampaignDto } from '../aso/asa/asa.dto.js';

/**
 * validation-errors.ts — global ValidationPipe'in 400 cevabi.
 *
 * NEDEN VAR: (1) inceleme R1 — Nest'in varsayilan fabrikasi hata agacinin
 * tamamini duzlestiriyordu; 2 MiB'lik persona govdesi 2 milyon mesajlik,
 * 108 MB'lik bir 400 uretiyordu. (2) K8 — forbidNonWhitelisted'in "property X
 * should not exist" ve class-validator'in diger Ingilizce metinleri panelde
 * oldugu gibi gorunuyordu. Mesajlarin geri kalani, sirasi ve cevap bicimi
 * Nest'in varsayilaniyla BIREBIR kalmali (DTO mesajlarina dayanan istemciler
 * ve specler kirilmasin): her karsilastirma Nest'in kendi fabrikasiyla yapilir.
 */

/** main.ts'in eski ayari: Nest'in varsayilan exceptionFactory'si */
const nestPipe = () => new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });

async function hata(pipe: ValidationPipe, metatype: ArgumentMetadata['metatype'], value: unknown) {
  try {
    await pipe.transform(value, { type: 'body', metatype, data: '' });
    return null;
  } catch (e) {
    const err = e as BadRequestException;
    return { status: err.getStatus(), body: err.getResponse() as { statusCode: number; message: string[]; error: string } };
  }
}

class Cocuk {
  @IsString({ message: 'ad metin olmalı' })
  ad!: string;
}

/** Mesajsiz @ValidateNested: class-validator'in Ingilizce varsayilani */
class MesajsizIcIce {
  @ValidateNested()
  @Type(() => Cocuk)
  cocuk!: Cocuk;

  @ValidateNested({ each: true })
  @Type(() => Cocuk)
  liste!: Cocuk[];
}

function hataAgaci(property: string, constraints?: Record<string, string>, children: ValidationError[] = []): ValidationError {
  return Object.assign(new ValidationError(), { property, constraints, children });
}

describe('validationExceptionFactory — Nest varsayilaniyla ayni bicim ve sira', () => {
  const durumlar: Array<[string, ArgumentMetadata['metatype'], unknown]> = [
    ['persona: history eksik', PersonaChatDto, {}],
    ['persona: history dize', PersonaChatDto, { history: 'x' }],
    ['persona: karisik gecersiz ogeler', PersonaChatDto, { history: [{ role: 'x', content: 5 }, 'dize', { role: 'user', content: 'a'.repeat(20_001) }] }],
    ['persona: 101 gecerli mesaj (ArrayMaxSize)', PersonaChatDto, { history: Array.from({ length: 101 }, () => ({ role: 'user', content: 'x' })) }],
    ['snippet: ic ice nesne', SnippetOptimizeApplyDto, { articleId: 5, optimized: { metaTitle: 1, questionVariants: ['a', 2] } }],
    ['asa: dizi ogelerinde ic ice hata', CreateAsaCampaignDto, {
      accountId: 'acc', name: 'K', dailyBudgetUsd: 10, countries: ['TR', 'tr'], appleAppId: 1,
      keywords: [{ text: 1, bidUsd: -1 }, { text: 'ok', bidUsd: 1, matchType: 'X' }],
    }],
  ];

  it.each(durumlar)('%s: cevap birebir ayni (20 mesajin altinda, Ingilizce metin yok)', async (_ad, metatype, value) => {
    const eski = await hata(nestPipe(), metatype, value);
    const yeni = await hata(createGlobalValidationPipe(), metatype, value);
    expect(eski).not.toBeNull();
    expect(eski!.body.message.length).toBeLessThanOrEqual(VALIDATION_MESSAGE_LIMIT);
    expect(yeni).toEqual(eski);
    expect(yeni!.body).toMatchObject({ statusCode: 400, error: 'Bad Request' });
  });

  it('gecerli govde ayni sekilde gecer (fabrika yalniz hata yolunda)', async () => {
    const value = { history: [{ role: 'user', content: 'Merhaba' }] };
    const r = await createGlobalValidationPipe().transform(value, { type: 'body', metatype: PersonaChatDto, data: '' });
    expect(r).toBeInstanceOf(PersonaChatDto);
    expect(r.history).toEqual([{ role: 'user', content: 'Merhaba' }]);
  });
});

describe('validationExceptionFactory — kisa cevap (inceleme R1)', () => {
  it('100 bos oge (300 mesaj): ilk 20 mesaj Nest\'inkiyle ayni + tek ozet satiri', async () => {
    const value = { history: Array.from({ length: 100 }, () => ({})) };
    const eski = await hata(nestPipe(), PersonaChatDto, value);
    const yeni = await hata(createGlobalValidationPipe(), PersonaChatDto, value);
    expect(eski!.body.message).toHaveLength(300);
    expect(yeni!.body.message).toEqual([...eski!.body.message.slice(0, VALIDATION_MESSAGE_LIMIT), VALIDATION_MORE_ERRORS_MESSAGE]);
    expect(VALIDATION_MORE_ERRORS_MESSAGE).toBe('Daha fazla hata var; yalnız ilk 20 hata gösterildi.');
  });

  it('tam 20 mesajda ozet satiri yok, 21. mesajda var', () => {
    const errs = (n: number) => Array.from({ length: n }, (_, i) => hataAgaci(`a${i}`, { isString: `a${i} metin olmalı` }));
    expect(validationExceptionFactory(errs(20)).getResponse()).toMatchObject({ message: errs(20).map((e) => e.constraints!.isString) });
    const r = validationExceptionFactory(errs(21)).getResponse() as { message: string[] };
    expect(r.message).toHaveLength(21);
    expect(r.message[20]).toBe(VALIDATION_MORE_ERRORS_MESSAGE);
  });

  it('tembel: 1 milyon cocuklu hata agaci hizla kesilir (Nest butun agaci duzlestiriyordu)', () => {
    const cocuklar = Array.from({ length: 1_000_000 }, (_, i) =>
      hataAgaci(String(i), undefined, [hataAgaci('role', { isIn: 'role gecersiz' }), hataAgaci('content', { isString: 'content metin olmalı' })]));
    const kok = hataAgaci('history', undefined, cocuklar);
    const t0 = performance.now();
    const r = validationExceptionFactory([kok]).getResponse() as { message: string[] };
    expect(performance.now() - t0).toBeLessThan(50);
    expect(r.message).toHaveLength(VALIDATION_MESSAGE_LIMIT + 1);
    expect(r.message[0]).toBe('history.0.role gecersiz');
  });

  it('tek mesaj da sinirli: istemcinin yolladigi 10.000 karakterlik alan adi cevabi buyutemez', async () => {
    const uzun = 'k'.repeat(10_000);
    const yeni = await hata(createGlobalValidationPipe(), PersonaChatDto, { history: [{ role: 'user', content: 'a' }], [uzun]: 1 });
    expect(yeni!.body.message).toHaveLength(1);
    expect(yeni!.body.message[0].length).toBe(VALIDATION_MESSAGE_MAX_CHARS);
    expect(yeni!.body.message[0].endsWith('…')).toBe(true);
  });
});

describe('validationExceptionFactory — Turkce pipe metinleri (K8)', () => {
  it('forbidNonWhitelisted: ust duzey ve ic ice alan Turkce, yol cumlenin basinda', async () => {
    const value = { history: [{ role: 'user', content: 'a', ekstra: 1 }], fazla: true };
    const eski = await hata(nestPipe(), PersonaChatDto, value);
    const yeni = await hata(createGlobalValidationPipe(), PersonaChatDto, value);
    expect(eski!.body.message).toEqual(['property fazla should not exist', 'history.0.property ekstra should not exist']);
    expect(yeni!.body).toEqual({
      statusCode: 400,
      error: 'Bad Request',
      message: ['fazla alanı kabul edilmiyor.', 'history.0.ekstra alanı kabul edilmiyor.'],
    });
  });

  it('forbidUnknownValues: "an unknown value was passed..." Turkce (kok ve ic ice)', async () => {
    class Bos {}
    const kokHatalari = await validate(new Bos(), { forbidUnknownValues: true });
    expect(kokHatalari[0].constraints).toEqual({ unknownValue: 'an unknown value was passed to the validate function' });
    expect((validationExceptionFactory(kokHatalari).getResponse() as any).message).toEqual([VALIDATION_UNKNOWN_VALUE_MESSAGE]);

    const icIce = hataAgaci('meta', undefined, [
      Object.assign(new ValidationError(), { property: undefined, constraints: { unknownValue: 'an unknown value was passed to the validate function' }, children: [] }),
    ]);
    expect((validationExceptionFactory([icIce]).getResponse() as any).message).toEqual(['meta beklenen biçimde değil.']);
  });

  it('mesajsiz @ValidateNested: "nested property X must be either object or array" Turkce (tekil ve each)', async () => {
    const value = { cocuk: 'dize', liste: ['x', { ad: 'tamam' }] };
    const eski = await hata(nestPipe(), MesajsizIcIce, value);
    // Nest oge hatasina yalniz ust yolu ekler (oge sirasi '0' metinde yok)
    expect(eski!.body.message).toEqual([
      'nested property cocuk must be either object or array',
      'liste.each value in nested property liste must be either object or array',
    ]);
    const yeni = await hata(createGlobalValidationPipe(), MesajsizIcIce, value);
    expect(yeni!.body.message).toEqual(['cocuk bir nesne ya da liste olmalı.', 'liste.0 bir nesne ya da liste olmalı.']);
  });

  it('yalniz BIREBIR Ingilizce metin cevrilir: DTO\'nun kendi mesaji (ayni kisit adiyla bile) aynen kalir', () => {
    const errs = [
      hataAgaci('a', { whitelistValidation: 'a alanı burada olmamalı' }),
      hataAgaci('b', { isString: 'property b should not exist' }),
      hataAgaci('c', { nestedValidation: 'Her mesaj { role, content } biçiminde bir nesne olmalı' }),
    ];
    expect((validationExceptionFactory(errs).getResponse() as any).message).toEqual([
      'a alanı burada olmamalı',
      'property b should not exist',
      'Her mesaj { role, content } biçiminde bir nesne olmalı',
    ]);
  });
});
