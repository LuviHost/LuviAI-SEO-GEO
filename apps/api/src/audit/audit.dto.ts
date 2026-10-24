import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString,
  Matches, Max, MaxLength, Min, ValidateBy, ValidateNested, type ValidationOptions,
} from 'class-validator';
import type { Provider } from './ai-citation.service.js';
import type { FanoutKind } from './fanout.service.js';
import { COMMUNITY_MAX_LIMIT, GEO_HEATMAP_MAX_QUERIES } from './audit-limits.js';

/*
 * NEDEN SINIF DTO: audit.controller.ts'teki govdeler satir ici tipliydi
 * ({ status: string } gibi). Global ValidationPipe (whitelist +
 * forbidNonWhitelisted) tasarim tipi Object olan govdeyi HIC denetlemez:
 *  - dize beklenen yere nesne/dizi giriyor, Prisma hatasi 500 donuyordu;
 *  - fazladan alanlar servise aynen yayiliyordu — or. prompts/:id/run
 *    govdesindeki trigger:'system' aylik citation kotasini atlatiyordu,
 *    prompts govdesindeki source:'local' yerel soru dogrulamasini atliyordu;
 *  - sayilar sinirsizdi (heatmap / topluluk taramasi model cagrisi sayisi).
 * Sinirlar servislerin kendi tavanlariyla ayni ya da biraz gevsek tutuldu:
 * servisin Turkce hata mesaji (or. "Soru 500 karakteri asamaz") korunur,
 * DTO yalnizca tipi ve kaba boyutu dayatir. Alan adlari web panelinin
 * gonderdigi govdelerle (apps/web/src/lib/api.ts) birebir ayni.
 *
 * HER DOGRULAYICININ TURKCE `message`'I VAR: mesajsiz dekorator
 * class-validator'in Ingilizce varsayilan metnini ("fix must be shorter than
 * or equal to 100 characters", "nested property options must be either object
 * or array") 400 govdesinde API anahtarli istemciye aynen gonderiyordu. Mesaj
 * alan adini da tasir: istemci hangi alanin reddedildigini anlar ve Nest ic
 * ice hatalarda yalniz yol onekini ("history.0.") ekler.
 * audit-dto-messages.spec.ts dosyadaki her dogrulayiciyi metadata uzerinden
 * tarar; mesajsiz yeni dekorator testi kirar.
 */

// ──────────────────────────────────────────────────────────────
//  Ortak listeler
// ──────────────────────────────────────────────────────────────

/**
 * Olcum saglayicilari. Record<Provider, true> ile yazildi: Provider tipine
 * yeni bir saglayici eklenip burasi unutulursa derleme hatasi verir.
 */
const PROVIDER_SET: Record<Provider, true> = {
  anthropic: true, gemini: true, openai: true, perplexity: true, xai: true, deepseek: true, meta: true,
};
export const CITATION_PROVIDERS = Object.keys(PROVIDER_SET) as Provider[];

/** fanout.service KIND_SET ile ayni; bilinmeyen tur eskiden sessizce 'reviews' oluyordu */
const FANOUT_KIND_SET: Record<FanoutKind, true> = {
  reviews: true, trust: true, comparison: true, pricing: true, alternatives: true,
  howto: true, local: true, spec: true, category: true,
};
export const FANOUT_KINDS = Object.keys(FANOUT_KIND_SET) as FanoutKind[];

/** content-opportunity.service updateStatus izin listesi */
export const OPPORTUNITY_USER_STATUSES = ['OPEN', 'PLANNED', 'DISMISSED'] as const;
/** community-agent.service update izin listesi */
export const COMMUNITY_STATUSES = ['NEW', 'DRAFTED', 'APPROVED', 'POSTED', 'IGNORED'] as const;

/**
 * Topluluk taramasi ve GEO heatmap tavanlari audit-limits.ts'te: servisler de
 * ayni degerle sikistirir (dogrudan cagiran yollar DTO'dan gecmez).
 */
export { COMMUNITY_MAX_LIMIT, GEO_HEATMAP_MAX_QUERIES };
/** Cross-link: oneri basina bir model cagrisi (cross-linking.service aiRefine) */
export const CROSS_LINK_MAX_LIMIT = 10;
/** Toplu takili sayfa onarimi: istek basina en fazla bu kadar sayfa islenir */
export const STUCK_BATCH_MAX = 50;

/**
 * Yerel soru etiketleri (local-prompts.ts localTags / readLocalTags):
 * 'yerel' etiketi bir soruyu yerel sayar (isLocalPrompt). Bu etiketler yalniz
 * POST prompts/local akisiyla (il/ilce dogrulamasi + taslak yeniden uretimi)
 * yazilmali; elle etiketle gelen soru o dogrulamayi atliyordu.
 */
const RESERVED_PROMPT_TAG = /^(?!yerel$)(?!il:)(?!ilce:)(?!hizmet:)/i;

/** "string ya da string[]" — yerel soru formu ilce/hizmet listesini iki bicimde de gonderebilir */
function IsTextOrTextList(
  limits: { maxItems: number; maxItemLength: number; maxTextLength: number },
  options?: ValidationOptions,
) {
  return ValidateBy(
    {
      name: 'isTextOrTextList',
      constraints: [limits],
      validator: {
        validate: (value: unknown) => {
          if (typeof value === 'string') return value.length <= limits.maxTextLength;
          return Array.isArray(value)
            && value.length <= limits.maxItems
            && value.every((v) => typeof v === 'string' && v.length <= limits.maxItemLength);
        },
      },
    },
    options,
  );
}

// ──────────────────────────────────────────────────────────────
//  Icerik firsatlari + topluluk
// ──────────────────────────────────────────────────────────────

export class UpdateOpportunityDto {
  @IsIn(OPPORTUNITY_USER_STATUSES, { message: `Durum yalnızca ${OPPORTUNITY_USER_STATUSES.join('/')} olabilir` })
  status!: (typeof OPPORTUNITY_USER_STATUSES)[number];
}

/** POST community/scan ve community/find */
export class CommunityLimitDto {
  @IsOptional()
  @IsInt({ message: 'limit tam sayı olmalı' })
  @Min(1, { message: 'limit en az 1 olmalı' })
  @Max(COMMUNITY_MAX_LIMIT, { message: `limit en fazla ${COMMUNITY_MAX_LIMIT} olabilir` })
  limit?: number;
}

export class UpdateCommunityDto {
  @IsOptional()
  @IsIn(COMMUNITY_STATUSES, { message: `Durum yalnızca ${COMMUNITY_STATUSES.join('/')} olabilir` })
  status?: (typeof COMMUNITY_STATUSES)[number];

  // Servis 10.000 karakterde kesiyordu; sessiz kesme yerine acik hata
  @IsOptional()
  @IsString({ message: 'Yanıt taslağı metin olmalı' })
  @MaxLength(10_000, { message: 'Yanıt taslağı en fazla 10.000 karakter olabilir' })
  draftReply?: string;
}

// ──────────────────────────────────────────────────────────────
//  Otomatik duzeltme
// ──────────────────────────────────────────────────────────────

/** Sorun anahtarlari (fix-routes.ts partitionFixes desteklenmeyenleri ayrica doner) */
export class AutoFixApplyDto {
  @IsArray({ message: 'fixes bir liste olmalı' })
  @ArrayMaxSize(100, { message: 'fixes en fazla 100 düzeltme anahtarı içerebilir' })
  @IsString({ each: true, message: 'Her düzeltme anahtarı metin olmalı' })
  @MaxLength(100, { each: true, message: 'Her düzeltme anahtarı (fixes) en fazla 100 karakter olabilir' })
  fixes!: string[];
}

export class AutoFixNowDto extends AutoFixApplyDto {
  /** { [fix]: previewToken } — robots.txt onizleme onayi */
  @IsOptional()
  @IsObject({ message: 'confirm bir nesne olmalı' })
  confirm?: Record<string, string>;
}

export class AutoFixPreviewOptionsDto {
  @IsOptional()
  @IsIn(['yes', 'no'], { message: "aiTrain yalnızca 'yes' ya da 'no' olabilir" })
  aiTrain?: 'yes' | 'no';
}

export class AutoFixPreviewDto {
  @IsString({ message: 'Düzeltme anahtarı (fix) gerekli.' })
  @MaxLength(100, { message: 'Düzeltme anahtarı (fix) en fazla 100 karakter olabilir' })
  fix!: string;

  @IsOptional()
  @IsObject({ message: 'options bir nesne olmalı' })
  // Yalniz nesne/dizi olmayan degerde IsObject ile BIRLIKTE doner: ayni cumle
  // iki kez yazilmasin diye beklenen bicimi soyler
  @ValidateNested({ message: "options { aiTrain: 'yes' | 'no' } biçiminde olmalı" })
  @Type(() => AutoFixPreviewOptionsDto)
  options?: AutoFixPreviewOptionsDto;
}

// ──────────────────────────────────────────────────────────────
//  Takili sayfalar
// ──────────────────────────────────────────────────────────────

export class RecoverStuckBatchDto {
  // Panel gorunen listeyi (en fazla 100 satir) topluca secebilir; istek
  // basina STUCK_BATCH_MAX islenir, fazlasi sonucta acikca "islenmedi" doner.
  @IsArray({ message: 'stuckPageIds bir liste olmalı' })
  @ArrayMaxSize(100, { message: 'Tek istekte en fazla 100 sayfa seçilebilir' })
  @IsString({ each: true, message: 'Her sayfa kimliği (stuckPageIds) metin olmalı' })
  @MaxLength(64, { each: true, message: 'Her sayfa kimliği (stuckPageIds) en fazla 64 karakter olabilir' })
  stuckPageIds!: string[];

  // triggeredBy ALANI YOK: denetim kaydindaki kisi yalnizca oturumdan alinir.
  // Panel artik gondermiyor (apps/web/src/lib/api.ts recoverStuckPagesBatch);
  // gelirse forbidNonWhitelisted 400 doner.
}

// ──────────────────────────────────────────────────────────────
//  Prompt Lab
// ──────────────────────────────────────────────────────────────

class PromptTagsField {
  @IsOptional()
  @IsArray({ message: 'tags bir liste olmalı' })
  @ArrayMaxSize(10, { message: 'En fazla 10 etiket eklenebilir' })
  @IsString({ each: true, message: 'Her etiket metin olmalı' })
  @MaxLength(40, { each: true, message: 'Etiket en fazla 40 karakter olabilir' })
  @Matches(RESERVED_PROMPT_TAG, {
    each: true,
    message: 'Yerel soru etiketleri (yerel, il:, ilce:, hizmet:) yalnızca yerel soru akışıyla eklenebilir.',
  })
  tags?: string[];
}

/**
 * POST prompts. source ALANI YOK: kaynak sunucuda 'manual' yazilir; 'local'
 * yalniz POST prompts/local, 'brain' yalniz import-brain uretir.
 */
export class CreatePromptDto extends PromptTagsField {
  // Uzunluk (5-500) servisin validateText'inde, Turkce mesajla
  @IsString({ message: 'Soru metni (text) gerekli.' })
  @MaxLength(2000, { message: 'Soru en fazla 500 karakter olabilir' })
  text!: string;

  @IsOptional()
  @IsString({ message: 'intent metin olmalı' })
  @MaxLength(40, { message: 'intent en fazla 40 karakter olabilir' })
  intent?: string;

  @IsOptional()
  @IsIn(['tr', 'en'], { message: "locale yalnızca 'tr' ya da 'en' olabilir" })
  locale?: 'tr' | 'en';
}

export class UpdatePromptDto extends PromptTagsField {
  @IsOptional()
  @IsString({ message: 'Soru metni metin olmalı' })
  @MaxLength(2000, { message: 'Soru en fazla 500 karakter olabilir' })
  text?: string;

  @IsOptional()
  @IsString({ message: 'intent metin olmalı' })
  @MaxLength(40, { message: 'intent en fazla 40 karakter olabilir' })
  intent?: string;

  @IsOptional()
  @IsBoolean({ message: 'isActive true ya da false olmalı' })
  isActive?: boolean;
}

/**
 * POST prompts/:id/run. trigger ALANI BILEREK YOK: 'system' tetigi aylik
 * citation kotasini atlar (ai-citation.service runQueries) ve yalniz
 * platformun kendi otomasyonuna aittir (content-opportunity remeasure).
 */
export class RunPromptDto {
  @IsOptional()
  @IsBoolean({ message: 'withFanout true ya da false olmalı' })
  withFanout?: boolean;

  @IsOptional()
  @IsArray({ message: 'providers bir liste olmalı' })
  @ArrayMaxSize(CITATION_PROVIDERS.length, { message: `providers en fazla ${CITATION_PROVIDERS.length} sağlayıcı içerebilir` })
  @ArrayUnique({ message: 'Aynı sağlayıcı iki kez seçilemez' })
  @IsIn(CITATION_PROVIDERS, { each: true, message: `providers yalnızca şunları içerebilir: ${CITATION_PROVIDERS.join(', ')}` })
  providers?: Provider[];

  @IsOptional()
  @IsArray({ message: 'fanoutProviders bir liste olmalı' })
  @ArrayMaxSize(CITATION_PROVIDERS.length, { message: `fanoutProviders en fazla ${CITATION_PROVIDERS.length} sağlayıcı içerebilir` })
  @ArrayUnique({ message: 'Aynı sağlayıcı iki kez seçilemez' })
  @IsIn(CITATION_PROVIDERS, { each: true, message: `fanoutProviders yalnızca şunları içerebilir: ${CITATION_PROVIDERS.join(', ')}` })
  fanoutProviders?: Provider[];
}

export class RunAllPromptsDto {
  @IsOptional()
  @IsBoolean({ message: 'withFanout true ya da false olmalı' })
  withFanout?: boolean;

  // prompt-lab.service MAX_RUN_ALL
  @IsOptional()
  @IsInt({ message: 'limit tam sayı olmalı' })
  @Min(1, { message: 'limit en az 1 olmalı' })
  @Max(50, { message: 'limit en fazla 50 olabilir' })
  limit?: number;

  @IsOptional()
  @IsIn(['all', 'local'], { message: "scope yalnızca 'all' ya da 'local' olabilir" })
  scope?: 'all' | 'local';
}

/**
 * POST prompts/local/preview. Asil dogrulama (81 il, en fazla 5 ilce / 5
 * hizmet, 30 taslak) local-prompts.ts parseLocalPromptSpec'te, Turkce
 * mesajla; burada yalniz tip ve kaba boyut.
 */
export class LocalPromptSpecDto {
  @IsOptional()
  @IsString({ message: 'İl adı metin olmalı' })
  @MaxLength(60, { message: 'İl adı en fazla 60 karakter olabilir' })
  il?: string;

  @IsOptional()
  @IsTextOrTextList({ maxItems: 50, maxItemLength: 120, maxTextLength: 2000 }, { message: 'İlçeler metin ya da metin listesi olmalı' })
  ilceler?: string[] | string;

  @IsOptional()
  @IsTextOrTextList({ maxItems: 50, maxItemLength: 120, maxTextLength: 2000 }, { message: 'Hizmetler metin ya da metin listesi olmalı' })
  hizmetler?: string[] | string;
}

export class CreateLocalPromptsDto extends LocalPromptSpecDto {
  /** Onizlemeden secilen metinler — yalniz secim icin; metinler sunucuda yeniden uretilir */
  @IsOptional()
  @IsArray({ message: 'texts bir liste olmalı' })
  @ArrayMaxSize(100, { message: 'texts en fazla 100 soru içerebilir' })
  @IsString({ each: true, message: 'Her soru metni (texts) metin olmalı' })
  @MaxLength(600, { each: true, message: 'Her soru metni (texts) en fazla 600 karakter olabilir' })
  texts?: string[];
}

// ──────────────────────────────────────────────────────────────
//  Fan-out
// ──────────────────────────────────────────────────────────────

export class GenerateFanoutDto {
  // fanout.service generateForPrompt 1-16 araligina sikistirir
  @IsOptional()
  @IsInt({ message: 'max tam sayı olmalı' })
  @Min(1, { message: 'max en az 1 olmalı' })
  @Max(16, { message: 'max en fazla 16 olabilir' })
  max?: number;
}

export class AddFanoutDto {
  // Uzunluk (5-300) fanout.service addManual'da, Turkce mesajla
  @IsString({ message: 'Dal metni (text) gerekli.' })
  @MaxLength(1000, { message: 'Dal metni 300 karakteri aşamaz' })
  text!: string;

  @IsOptional()
  @IsIn(FANOUT_KINDS, { message: `kind yalnızca şunlardan biri olabilir: ${FANOUT_KINDS.join(', ')}` })
  kind?: FanoutKind;
}

export class ToggleFanoutDto {
  @IsBoolean({ message: 'isActive true ya da false olmalı' })
  isActive!: boolean;
}

// ──────────────────────────────────────────────────────────────
//  GEO Lab araclari
// ──────────────────────────────────────────────────────────────


export class GeoHeatmapDto {
  @IsOptional()
  @IsInt({ message: 'maxQueries tam sayı olmalı' })
  @Min(1, { message: 'maxQueries en az 1 olmalı' })
  @Max(GEO_HEATMAP_MAX_QUERIES, { message: `maxQueries en fazla ${GEO_HEATMAP_MAX_QUERIES} olabilir` })
  maxQueries?: number;
}

export class SubmitKnowledgeDto {
  @IsIn(['wikidata', 'wikipedia'], { message: "target yalnızca 'wikidata' ya da 'wikipedia' olabilir" })
  target!: 'wikidata' | 'wikipedia';

  // draft ALANI YOK: taslak sunucuda sitenin kendi verisinden uretilir
  // (audit.controller submitKnowledge). Panel artik gondermiyor
  // (apps/web/src/lib/api.ts submitKnowledge); gelirse forbidNonWhitelisted 400 doner.

  @IsOptional()
  @IsIn(['tr', 'en'], { message: "lang yalnızca 'tr' ya da 'en' olabilir" })
  lang?: 'tr' | 'en';
}

export class ArticleRefDto {
  @IsString({ message: 'Makale kimliği (articleId) gerekli.' })
  @MaxLength(64, { message: 'Makale kimliği (articleId) en fazla 64 karakter olabilir' })
  articleId!: string;
}

export class CrossLinkSuggestDto extends ArticleRefDto {
  @IsOptional()
  @IsInt({ message: 'limit tam sayı olmalı' })
  @Min(1, { message: 'limit en az 1 olmalı' })
  @Max(CROSS_LINK_MAX_LIMIT, { message: `limit en fazla ${CROSS_LINK_MAX_LIMIT} olabilir` })
  limit?: number;
}

/**
 * Oneri nesnesi beyaz listelenmez: panel suggest cevabini oldugu gibi geri
 * gonderir (12 alan; sekil buyurse uygulama bozulmasin). Kullanilan alanlar
 * (fromArticleId, toArticleId, anchorText, contextSnippet) servis tarafinda
 * tek tek dogrulanir; hedef adres istemciden degil kayitli makaleden kurulur.
 */
export class CrossLinkApplyDto {
  @IsObject({ message: 'Uygulanacak öneri (suggestion) gerekli.' })
  suggestion!: Record<string, unknown>;
}

export class CrawlerIngestDto {
  @IsString({ message: 'Log içeriği (logContent) gerekli.' })
  // Mesaj Turkce: varsayilan metin ("logContent must be shorter than or equal
  // to 1000000 characters") API anahtariyla yukleyen istemciye aynen gidiyordu.
  // Panel bu siniri yuklemeden once kendisi uyguluyor (crawler-hits-panel.tsx).
  @MaxLength(1_000_000, { message: 'Log içeriği en fazla 1.000.000 karakter olabilir; daha kısa bir döneme ait log gönder.' })
  logContent!: string;
}

export class SchemaValidateDto {
  @IsString({ message: 'Adres (url) gerekli.' })
  @MaxLength(2048, { message: 'Adres (url) en fazla 2.048 karakter olabilir' })
  url!: string;
}

/**
 * Sitenin gercek yazari (author-profile.service SiteAuthor). Adres dogrulamasi
 * (yalniz http/https) ve kirpma serviste de yapilir; burada tip ve uzunluk.
 */
export class SiteAuthorDto {
  @IsString({ message: 'Yazar adı (name) gerekli.' })
  @MaxLength(120, { message: 'Yazar adı en fazla 120 karakter olabilir' })
  name!: string;

  @IsOptional()
  @IsString({ message: 'Yazar sayfası (url) metin olmalı' })
  @MaxLength(300, { message: 'Yazar sayfası (url) en fazla 300 karakter olabilir' })
  url?: string;

  @IsOptional()
  @IsArray({ message: 'sameAs bir adres listesi olmalı' })
  @ArrayMaxSize(10, { message: 'En fazla 10 profil adresi verilebilir' })
  @IsString({ each: true, message: 'sameAs adresleri metin olmalı' })
  @MaxLength(300, { each: true, message: 'Profil adresi en fazla 300 karakter olabilir' })
  sameAs?: string[];

  @IsOptional()
  @IsString({ message: 'Unvan (jobTitle) metin olmalı' })
  @MaxLength(120, { message: 'Unvan en fazla 120 karakter olabilir' })
  jobTitle?: string;
}

export class HaroParseDto {
  @IsString({ message: 'E-posta içeriği (emailContent) gerekli.' })
  @MaxLength(100_000, { message: 'E-posta içeriği en fazla 100.000 karakter olabilir' })
  emailContent!: string;
}

/** optimize cevabindaki `optimized` nesnesi (snippet-optimizer.service SnippetOptimization) */
export class SnippetOptimizedDto {
  @IsString({ message: 'Meta başlık (metaTitle) metin olmalı' })
  @MaxLength(300, { message: 'Meta başlık (metaTitle) en fazla 300 karakter olabilir' })
  metaTitle!: string;

  @IsString({ message: 'Meta açıklama (metaDescription) metin olmalı' })
  @MaxLength(1000, { message: 'Meta açıklama (metaDescription) en fazla 1.000 karakter olabilir' })
  metaDescription!: string;

  @IsString({ message: 'AI cevap kartı (aiAnswerCard) metin olmalı' })
  @MaxLength(5000, { message: 'AI cevap kartı (aiAnswerCard) en fazla 5.000 karakter olabilir' })
  aiAnswerCard!: string;

  @IsArray({ message: 'Soru varyantları (questionVariants) bir liste olmalı' })
  @ArrayMaxSize(20, { message: 'Soru varyantları (questionVariants) en fazla 20 soru içerebilir' })
  @IsString({ each: true, message: 'Her soru varyantı (questionVariants) metin olmalı' })
  @MaxLength(500, { each: true, message: 'Her soru varyantı (questionVariants) en fazla 500 karakter olabilir' })
  questionVariants!: string[];
}

export class SnippetOptimizeApplyDto extends ArticleRefDto {
  @IsObject({ message: 'Uygulanacak öneri (optimized) gerekli.' })
  @ValidateNested({ message: 'Uygulanacak öneri (optimized) bir nesne olmalı' })
  @Type(() => SnippetOptimizedDto)
  optimized!: SnippetOptimizedDto;
}

/** Snippet ogeleri beyaz listelenmez; her ogenin pageUrl'i servis tarafinda site alan adina karsi denetlenir */
export class ApplySnippetsDto {
  @IsArray({ message: 'snippets bir liste olmalı' })
  @ArrayMaxSize(100, { message: 'snippets en fazla 100 öğe içerebilir' })
  @IsObject({ each: true, message: 'Her snippet bir nesne olmalı' })
  snippets!: Array<Record<string, unknown>>;
}

export class StaticSnippetsDto extends ApplySnippetsDto {
  @IsString({ message: 'Sayfa adresi (pageUrl) gerekli.' })
  @MaxLength(2048, { message: 'Sayfa adresi (pageUrl) en fazla 2.048 karakter olabilir' })
  pageUrl!: string;
}

// ──────────────────────────────────────────────────────────────
//  Persona sohbet widget'i (herkese acik)
// ──────────────────────────────────────────────────────────────

/** Ziyaretcinin yazdigi son mesajin tavani (widget girisi de bu kadar) */
export const PERSONA_MESSAGE_MAX = 2000;

export class PersonaChatMessageDto {
  @IsIn(['user', 'assistant'], { message: "role yalnızca 'user' ya da 'assistant' olabilir" })
  role!: 'user' | 'assistant';

  // Govde boyutunu artik bu tavan DEGIL, DTO dogrulamasindan ONCE uygulanan
  // uc siniri belirler: persona sohbeti 64 KB (request-body.ts
  // PERSONA_CHAT_JSON_BODY_LIMIT_BYTES) ve en fazla 1.000 oge / 8 seviye
  // (PERSONA_CHAT_JSON_BODY_BUDGET). Bu tavan eskiden yalniz govdeyi
  // sinirlamak icindi (global 2 MiB sinirda 100 mesaj x 20.000 karakter);
  // simdi tek alan siniri: 64 KB'lik govdede tek bir mesaj yine 20.000
  // karakteri asabilir (ASCII ~65.000) ve Turkce 400 ile reddedilir.
  // Gecmisteki asistan cevaplari uzun olabilir (onbellekteki eski widget tum
  // gecmisi yollar; yenisi en fazla 10 mesaj x PERSONA_MESSAGE_MAX karakter);
  // servis modele giden her mesaji PERSONA_MESSAGE_MAX'ta kirpar, son
  // ziyaretci mesajini bu sinirla reddeder.
  @IsString({ message: 'content metin olmalı' })
  @MaxLength(20_000, { message: 'content en fazla 20.000 karakter olabilir' })
  content!: string;
}

export class PersonaChatDto {
  // Eski widget tum konusmayi yollar; servis yalniz son 10 mesaji kullanir
  @IsArray({ message: 'history bir liste olmalı' })
  @ArrayMaxSize(100, { message: 'history en fazla 100 mesaj içerebilir' })
  // Nest ic ice hatayi 'history.' onekiyle yazar: "history.Her mesaj ..."
  @ValidateNested({ each: true, message: 'Her mesaj { role, content } biçiminde bir nesne olmalı' })
  @Type(() => PersonaChatMessageDto)
  history!: PersonaChatMessageDto[];
}
