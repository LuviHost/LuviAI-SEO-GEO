import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsOptional, Matches } from 'class-validator';

/*
 * NEDEN SINIF DTO: ceviri govdeleri satir ici tipliydi; global ValidationPipe
 * (whitelist + forbidNonWhitelisted) tasarim tipi Object olan govdeyi HIC
 * denetlemez. Dil kodu dogrudan istem metnine giriyor, translate-bulk'ta da
 * dil listesi sinirsizdi: her dil x en fazla 20 makale = ayri bir ucretli
 * model cagrisi (RanksUp anahtariyla, kota yok).
 */

/** translator.service'in adini bildigi diller; digerleri ISO koduyla cevrilir */
export const TRANSLATION_LANGUAGES = ['en', 'de', 'fr', 'ar', 'es', 'ru', 'tr'] as const;

/**
 * Dil kodu istem metnine girdigi icin serbest metin kabul edilmez; ama SDK ve
 * REST musterileri 'it', 'pt', 'en-US' gibi kodlar gonderebiliyordu ve servis
 * bunlari ISO koduyla ceviriyor. Bu yuzden liste degil, dar bir desen.
 */
const LANG_CODE = /^[a-z]{2}(-[A-Z]{2})?$/;
const LANG_MSG = 'Dil kodu ISO 639-1 biçiminde olmalı (ör. en, de, pt-BR)';

export class TranslateArticleDto {
  @Matches(LANG_CODE, { message: LANG_MSG })
  toLanguage!: string;
}

export class TranslateBulkDto {
  // Her dil x en fazla 20 makale = ayri bir LLM cagrisi; liste sinirli ve tekil
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(TRANSLATION_LANGUAGES.length)
  @ArrayUnique()
  @Matches(LANG_CODE, { each: true, message: LANG_MSG })
  languages?: string[];
}
