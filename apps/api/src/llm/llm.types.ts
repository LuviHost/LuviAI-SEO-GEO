/**
 * LLM Provider abstraction — LibreChat (MIT) Endpoints/<provider>/ pattern'inden
 * port edildi, NestJS + native SDK + Prisma ile sade tutuldu.
 *
 * Tüm AI çağrıları (article writer, snippet optimizer, ads audit LLM judge,
 * citation tracker, geo heatmap, persona chat vs.) bu interface'in arkasından
 * geçecek. Tek noktadan provider seçimi + token spend kaydı + cost guard.
 */

export type ProviderName = 'anthropic' | 'openai' | 'gemini';
export type TokenType = 'prompt' | 'completion' | 'cache_read' | 'cache_write';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  /**
   * Gorsel girdi (vision) — yalnizca `supportsImages` saglayicilar (Anthropic).
   * Metinden ONCE yerlestirilir. Desteklemeyen saglayiciya gonderilirse
   * LLMProviderService acik hata verir (sessizce yok sayilmaz).
   */
  images?: ChatImage[];
}

export interface ChatImage {
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  /** base64, satir sonu YOK */
  base64: string;
}

export interface ChatRequest {
  /** İstek context'i — token kaydında sınıflandırma için */
  context: string;          // 'article-writer', 'ads-audit-llm', 'snippet-optimizer' vs.
  siteId?: string;
  userId?: string;
  conversationId?: string;  // article id, audit id

  /** Provider-specific model adı */
  model: string;
  systemPrompt?: string;
  messages: ChatMessage[];
  maxTokens?: number;
  /**
   * Yalnızca kabul eden modellere gönderilir. Claude Opus 4.7+ ve Sonnet 5'te
   * bu parametre kaldırıldı; gönderilirse API 400 döner — Anthropic sağlayıcı
   * bu modellerde alanı otomatik olarak atlar.
   */
  temperature?: number;

  /**
   * Adaptive thinking — model ne kadar düşüneceğine kendi karar verir.
   * Sabit token bütçesi (budget_tokens) yeni modellerde kaldırıldı.
   * Desteklemeyen modellerde sessizce yok sayılır.
   */
  thinking?: boolean;

  /**
   * Düşünme derinliği ve toplam token harcaması.
   * Karmaşık üretim işleri için 'high', ucuz/kısa işler için 'low'.
   */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';

  /** Anthropic için ephemeral cache control desteği */
  cacheSystemPrompt?: boolean;
}

export interface UsageMetadata {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface ChatResponse {
  output: string;
  model: string;
  provider: ProviderName;
  usage: UsageMetadata;
  costUsd: number;
  /** Saglayici bildiriyorsa: end_turn | max_tokens | refusal ... (refusal'da output bos olabilir) */
  stopReason?: string;
}

/** USD per 1M tokens — model bazında pricing matrisi */
export interface ModelPricing {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export interface ILLMProvider {
  readonly name: ProviderName;
  /** ChatMessage.images destekleniyor mu (vision) */
  readonly supportsImages?: boolean;
  /** Model adının bu provider'a ait olup olmadığını kontrol eder */
  supportsModel(model: string): boolean;
  /** Pricing tablosundan model fiyatını döndürür (USD per 1M token) */
  getPricing(model: string): ModelPricing | null;
  /** Senkron/non-stream chat — usage_metadata + cost ile döner */
  chat(req: ChatRequest): Promise<ChatResponse>;
}
