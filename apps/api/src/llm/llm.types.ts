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
  temperature?: number;

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
  /** Model adının bu provider'a ait olup olmadığını kontrol eder */
  supportsModel(model: string): boolean;
  /** Pricing tablosundan model fiyatını döndürür (USD per 1M token) */
  getPricing(model: string): ModelPricing | null;
  /** Senkron/non-stream chat — usage_metadata + cost ile döner */
  chat(req: ChatRequest): Promise<ChatResponse>;
}
