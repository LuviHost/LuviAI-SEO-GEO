import { BadRequestException, ValidationPipe } from '@nestjs/common';
import type { ValidationError } from 'class-validator';

/**
 * Global ValidationPipe'in 400 cevabi: KISA ve TURKCE.
 *
 * NEDEN KISA: Nest'in varsayilan exceptionFactory'si
 * (validation.pipe.js flattenValidationErrors) hata agacinin TAMAMINI tek
 * diziye cevirir. Her gecersiz oge en az bir mesaj uretir; 2 MiB'lik bir
 * persona govdesi 2.097.138 mesajlik, 108 MB'lik bir 400 cevabi uretiyordu
 * (inceleme R1: duzlestirme 1,1 sn + JSON 0,3 sn). Burada mesajlar TEMBEL
 * uretilir ve ilk VALIDATION_MESSAGE_LIMIT kadari alinir; tek bir mesaj da
 * VALIDATION_MESSAGE_MAX_CHARS ile sinirli (izin verilmeyen alanin adi
 * istemciden gelir, istedigi kadar uzun olabilir).
 *
 * NEDEN TURKCE: panel (apps/web lib/api.ts toUserMessage) ve mobil uygulama
 * message dizisini kullaniciya oldugu gibi gosterir. DTO dekoratorlerinin
 * mesajlari zaten Turkce; Ingilizce kalan metinler dekoratorden degil
 * class-validator'in kendisinden geliyordu:
 *  - forbidNonWhitelisted: "property X should not exist"
 *    (ValidationExecutor.whitelist, kisit adi whitelistValidation);
 *  - forbidUnknownValues: "an unknown value was passed to the validate
 *    function" (kisit adi unknownValue);
 *  - mesajsiz @ValidateNested: "nested property X must be either object or
 *    array" (decorator/common/ValidateNested.js varsayilani).
 * Kaynak: class-validator 0.14.4 cjs/validation/ValidationExecutor.js ve
 * cjs/decorator/common/ValidateNested.js (kurulu paket). Yalniz bu BIREBIR
 * metinler cevrilir; DTO'nun kendi mesaji hic degismez.
 *
 * BICIM AYNI: { statusCode: 400, message: string[], error: 'Bad Request' } ve
 * mesaj sirasi/yol oneki ("history.0.content ...") Nest'in
 * mapChildrenToValidationErrors kuraliyla birebir (@nestjs/common 10.4
 * pipes/validation.pipe.js). Nest'in bir ozelligi de korunur: cocuk hatasi
 * olan EN UST hatanin kendi kisitlari listeye girmez. Fabrika Nest'in resmi
 * secenegidir (docs.nestjs.com/techniques/validation: "exceptionFactory ...
 * Takes an array of the validation errors and returns an exception object to
 * be thrown"; pipes/validation.pipe.d.ts `exceptionFactory?: (errors:
 * ValidationError[]) => any`). validation-errors.spec.ts her durumu Nest'in
 * kendi fabrikasiyla karsilastirir.
 */

/** 400 cevabindaki en fazla mesaj sayisi (asilirsa bir ozet satiri eklenir) */
export const VALIDATION_MESSAGE_LIMIT = 20;

/** Tek bir mesajin en fazla karakter sayisi */
export const VALIDATION_MESSAGE_MAX_CHARS = 300;

/** Mesaj sayisi VALIDATION_MESSAGE_LIMIT'i asinca listenin sonuna eklenir */
export const VALIDATION_MORE_ERRORS_MESSAGE =
  `Daha fazla hata var; yalnız ilk ${VALIDATION_MESSAGE_LIMIT} hata gösterildi.`;

/** Kok govde beklenen nesne degilse (forbidUnknownValues) */
export const VALIDATION_UNKNOWN_VALUE_MESSAGE =
  'Gönderilen veri beklenen biçimde değil; alanları içeren bir JSON nesnesi gönder.';

const NESTED_DEFAULT = /^(?:each value in )?nested property (.+) must be either object or array$/;

function truncate(text: string): string {
  return text.length > VALIDATION_MESSAGE_MAX_CHARS
    ? `${text.slice(0, VALIDATION_MESSAGE_MAX_CHARS - 1)}…`
    : text;
}

/** Yol oneki + alan adi: Nest'in `${parentPath}.${...}` birlestirmesiyle ayni */
function joinPath(prefix: string | undefined, property: string | undefined): string {
  const prop = property ?? '';
  return prefix ? `${prefix}.${prop}` : prop;
}

/**
 * Tek bir kisit mesaji -> istemciye giden metin. Ingilizce varsayilan metinler
 * Turkceye cevrilir (yol cumlenin basinda kalir: "history.0.foo alanı ...");
 * digerleri Nest'in bicimiyle (`${prefix}.${mesaj}`) aynen.
 */
function renderConstraint(key: string, message: string, error: ValidationError, prefix?: string): string {
  if (key === 'whitelistValidation' && message === `property ${error.property} should not exist`) {
    return `${joinPath(prefix, error.property)} alanı kabul edilmiyor.`;
  }
  if (key === 'unknownValue' && message === 'an unknown value was passed to the validate function') {
    return prefix ? `${prefix} beklenen biçimde değil.` : VALIDATION_UNKNOWN_VALUE_MESSAGE;
  }
  if (key === 'nestedValidation' && NESTED_DEFAULT.test(message)) {
    return `${joinPath(prefix, error.property)} bir nesne ya da liste olmalı.`;
  }
  return prefix ? `${prefix}.${message}` : message;
}

function* ownMessages(error: ValidationError, prefix?: string): Generator<string> {
  if (!error.constraints) return;
  for (const key of Object.keys(error.constraints)) {
    yield truncate(renderConstraint(key, error.constraints[key], error, prefix));
  }
}

/** Nest mapChildrenToValidationErrors'in ic dongusu: torunlar, sonra cocugun kendisi */
function* childMessages(error: ValidationError, path: string): Generator<string> {
  for (const item of error.children ?? []) {
    if (item.children && item.children.length > 0) {
      yield* childMessages(item, `${path}.${item.property}`);
    }
    yield* ownMessages(item, path);
  }
}

/**
 * Hata agacinin mesajlari, Nest'in varsayilan duzlestirmesiyle AYNI sirada,
 * tembel: cagiran yeterince mesaj alinca agacin geri kalani gezilmez.
 */
export function* validationMessages(errors: ValidationError[]): Generator<string> {
  for (const error of errors) {
    if (!error.children || error.children.length === 0) {
      yield* ownMessages(error);
    } else {
      yield* childMessages(error, error.property);
    }
  }
}

/** ValidationPipe exceptionFactory: en fazla VALIDATION_MESSAGE_LIMIT mesaj + gerekirse ozet satiri */
export function validationExceptionFactory(errors: ValidationError[]): BadRequestException {
  const messages: string[] = [];
  let more = false;
  for (const message of validationMessages(errors)) {
    if (messages.length === VALIDATION_MESSAGE_LIMIT) {
      more = true;
      break;
    }
    messages.push(message);
  }
  if (more) messages.push(VALIDATION_MORE_ERRORS_MESSAGE);
  return new BadRequestException(messages);
}

/**
 * main.ts'in global pipe'i. Ayarlar eskisiyle ayni (whitelist, transform,
 * forbidNonWhitelisted); yalniz hata cevabi bu dosyadaki fabrikayla kurulur.
 */
export function createGlobalValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
    exceptionFactory: validationExceptionFactory,
  });
}
