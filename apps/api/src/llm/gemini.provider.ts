import { Injectable, Logger } from '@nestjs/common';
import type { ChatRequest, ChatResponse, ILLMProvider, ModelPricing, ProviderName } from './llm.types.js';

// '@google/generative-ai' paketi opsiyonel — runtime'da yoksa açıklayıcı hata fırlatır.

const PRICING: Record<string, ModelPricing> = {
  'gemini-2.5-pro':    { input: 1.25, output: 10,   cacheRead: 0.31 },
  'gemini-2.5-flash':  { input: 0.075, output: 0.3, cacheRead: 0.019 },
  'gemini-1.5-pro':    { input: 1.25, output: 5,    cacheRead: 0.31 },
  'gemini-1.5-flash':  { input: 0.075, output: 0.3, cacheRead: 0.019 },
};

@Injectable()
export class GeminiProvider implements ILLMProvider {
  readonly name: ProviderName = 'gemini';
  private readonly log = new Logger(GeminiProvider.name);
  private client: any = null;

  private async getClient(): Promise<any> {
    if (this.client) return this.client;
    const mod: any = await (Function('m', 'return import(m)') as any)('@google/generative-ai').catch(() => null);
    if (!mod) throw new Error('@google/generative-ai paketi kurulu değil — `pnpm add @google/generative-ai` ile ekle');
    const key = process.env.GOOGLE_GENAI_API_KEY ?? process.env.GEMINI_API_KEY ?? '';
    this.client = new mod.GoogleGenerativeAI(key);
    return this.client;
  }

  supportsModel(model: string): boolean {
    return model.startsWith('gemini');
  }

  getPricing(model: string): ModelPricing | null {
    if (PRICING[model]) return PRICING[model];
    for (const [key, pricing] of Object.entries(PRICING)) {
      if (model.startsWith(key)) return pricing;
    }
    return null;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const t0 = Date.now();
    const client = await this.getClient();
    const m = client.getGenerativeModel({
      model: req.model,
      systemInstruction: req.systemPrompt,
    });

    const history = req.messages.slice(0, -1).map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    }));
    const last = req.messages[req.messages.length - 1];

    const chat = m.startChat({
      history,
      generationConfig: {
        maxOutputTokens: req.maxTokens ?? 1024,
        temperature: req.temperature,
      },
    });

    const result = await chat.sendMessage(last?.content ?? '');
    const text = result.response.text();
    const usageMeta = (result.response as any).usageMetadata ?? {};

    const usage = {
      inputTokens: usageMeta.promptTokenCount ?? 0,
      outputTokens: usageMeta.candidatesTokenCount ?? 0,
      cacheReadTokens: usageMeta.cachedContentTokenCount ?? 0,
      cacheWriteTokens: 0,
    };

    const pricing = this.getPricing(req.model);
    const costUsd = pricing ? (
      ((usage.inputTokens - usage.cacheReadTokens) / 1_000_000) * pricing.input +
      (usage.cacheReadTokens / 1_000_000) * (pricing.cacheRead ?? pricing.input * 0.25) +
      (usage.outputTokens / 1_000_000) * pricing.output
    ) : 0;

    this.log.debug(`[${req.context}] ${req.model} ${((Date.now() - t0) / 1000).toFixed(1)}s $${costUsd.toFixed(4)}`);
    return { output: text, model: req.model, provider: this.name, usage, costUsd };
  }
}
