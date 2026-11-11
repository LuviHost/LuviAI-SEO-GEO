import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { AnthropicProvider } from './anthropic.provider.js';
import { OpenAIProvider } from './openai.provider.js';
import { GeminiProvider } from './gemini.provider.js';
import type { ChatRequest, ChatResponse, ILLMProvider, ModelPricing, ProviderName, UsageMetadata } from './llm.types.js';

/**
 * LLMProviderService — multi-provider router + token usage recorder.
 *
 * Tüm RanksUp servisleri (article writer, snippet optimizer, ads audit judge,
 * citation tracker vb.) bu service'in `chat()` metodunu çağırır. Service:
 *   1. AI_GLOBAL_DISABLED guard kontrolü yapar (admin panel toggle)
 *   2. Model adına göre doğru provider'ı seçer
 *   3. Provider çağrısını yapar
 *   4. Token usage + cost'u TokenUsageRecord tablosuna asenkron yazar
 *   5. ChatResponse'u döndürür
 *
 * Bu sayede:
 *   - Provider değişimi tek noktadan
 *   - Tüm spend tek tabloda — admin spend dashboard
 *   - Site/user bazında quota enforcement mümkün
 *   - LibreChat'in `Transaction + spendTokens` 2-aşamalı yapısının
 *     Prisma karşılığı.
 */
/**
 * Thinking'i VARSAYILAN olarak acik olan modeller (Opus 5, Sonnet 5, Fable 5).
 * Bu modellerde `max_tokens` thinking + cevap metnini BIRLIKTE siniralar:
 * dusuk bir max_tokens butcenin tamamini thinking'e harcayip METIN BOS
 * donmesine yol acar. Haiku'dan Opus 5'e gecerken en buyuk risk buydu —
 * eski cagrilarin cogu 60-500 token ile yaziliydi.
 */
function thinksByDefault(model: string): boolean {
  // Haiku 5.5 de adaptive thinking'i varsayilan acik calistirir (claude-api thinking tablosu)
  return /^claude-(opus-5|sonnet-5|fable-5|mythos-5|haiku-5)/.test(model);
}

/** Thinking'li modellerde guvenli alt sinir — thinking + JSON cikti icin yeterli pay */
const MIN_MAX_TOKENS_THINKING = 4000;

@Injectable()
export class LLMProviderService {
  private readonly log = new Logger(LLMProviderService.name);
  private readonly providers: ILLMProvider[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    anthropic: AnthropicProvider,
    openai: OpenAIProvider,
    gemini: GeminiProvider,
  ) {
    this.providers = [anthropic, openai, gemini];
  }

  /** Model adına göre provider seç */
  private resolveProvider(model: string): ILLMProvider {
    const found = this.providers.find(p => p.supportsModel(model));
    if (!found) throw new Error(`No provider for model "${model}"`);
    return found;
  }

  /** Ana çağrı noktası — kullanıcı/servis bunu çağırır */
  async chat(req: ChatRequest): Promise<ChatResponse> {
    // Global AI guard
    const disabled = await this.settings.getBoolean('AI_GLOBAL_DISABLED').catch(() => false);
    if (disabled) {
      throw new ServiceUnavailableException('AI_GLOBAL_DISABLED — admin panelinden test modu aktif');
    }

    // Auto-cache: Anthropic için system prompt >= 1024 token (~4000 char) ise otomatik
    // cache_control ekle. %90 cost düşüşü sağlar tekrarlayan sistem prompt'larında.
    // NOT: Opus 5'te cache alt siniri 512 token'a dustu (Opus 4.8'de 1024) —
    // esik ~2000 karaktere cekilirse daha cok prompt cache'lenebilir.
    let effectiveReq: ChatRequest = (
      req.cacheSystemPrompt === undefined
      && req.systemPrompt
      && req.systemPrompt.length >= 4000
      && req.model.startsWith('claude')
    ) ? { ...req, cacheSystemPrompt: true } : req;

    // Thinking-varsayilan modellerde max_tokens tabani. Cagiran servis 300 token
    // istese bile thinking o butceyi yiyip cevabi kesebilir; sessiz kirpik cevap
    // yerine tabani yukseltiyoruz.
    //
    // MALIYET NOTU: max_tokens bir TAVANdir, pesin ucret degil — yalnizca
    // uretilen token faturalanir. Ancak adaptive thinking daha genis tavanda
    // BIRAZ daha uzun dusunebilir: prod olcumunde 400 → 4000 tavan degisimi
    // ciktiyi 317 → 400 token yapti (%26 artis, 10x degil). Yani taban
    // maliyeti bir miktar artirir, katlamaz.
    if (thinksByDefault(effectiveReq.model)) {
      const requested = effectiveReq.maxTokens ?? 1024;
      if (requested < MIN_MAX_TOKENS_THINKING) {
        this.log.debug(`[${effectiveReq.context}] max_tokens ${requested} → ${MIN_MAX_TOKENS_THINKING} (thinking payi)`);
        effectiveReq = { ...effectiveReq, maxTokens: MIN_MAX_TOKENS_THINKING };
      }
    }

    const provider = this.resolveProvider(effectiveReq.model);
    // Yapisal cikti yalniz Anthropic saglayicisinda uygulanir; digerinde serbest metin donup
    // cagiranin JSON beklentisini sessizce bozmasin
    if (effectiveReq.outputSchema && provider.name !== 'anthropic') {
      throw new Error(`"${effectiveReq.model}" (${provider.name}) yapisal cikti (outputSchema) desteklemiyor`);
    }
    // Gorsel girdi yalnizca destekleyen saglayiciya — OpenAI/Gemini saglayicilari
    // images alanini tanimiyor; sessizce yok sayilsa model gorseli gormeden
    // "alt metni" uydururdu.
    if (effectiveReq.messages.some((m) => (m.images?.length ?? 0) > 0) && !provider.supportsImages) {
      throw new Error(`"${effectiveReq.model}" (${provider.name}) gorsel girdi desteklemiyor`);
    }
    const response = await provider.chat(effectiveReq);

    // Token usage kaydı (asenkron — başarısızlık ana akışı kırmasın)
    this.recordUsage(req, response).catch(err => {
      this.log.warn(`Token usage kayıt hatası: ${err.message}`);
    });

    return response;
  }

  /** Fiyati bilinmeyen modeller icin uyari bir kez yazilir (her cagrida log dolmasin) */
  private readonly unpricedWarned = new Set<string>();

  private async recordUsage(req: ChatRequest, res: ChatResponse): Promise<void> {
    const pricing = this.providers.find(p => p.name === res.provider)?.getPricing(req.model);
    if (!pricing) {
      // Fiyat tablosunda olmayan model: harcama deftere ve sahibin aylik AI butcesine YAZILAMAZ;
      // butce o model icin kor kalir (ornek: env ile tabloda olmayan bir yazar modeli secilirse).
      // Sessiz kalmasin: tabloya (saglayicinin PRICING'i) eklenmesi gerektigi gorunsun.
      if (!this.unpricedWarned.has(req.model)) {
        this.unpricedWarned.add(req.model);
        this.log.warn(`Fiyatı bilinmeyen model "${req.model}" (${res.provider}, ${req.context}): harcama deftere ve aylık AI bütçesine yazılmadı — fiyat tablosuna ekleyin`);
      }
      return;
    }
    await this.writeUsage(
      { context: req.context, siteId: req.siteId, userId: req.userId, conversationId: req.conversationId },
      res.provider, res.model, res.usage, pricing,
    );
  }

  /**
   * SDK'yi DOGRUDAN cagiran servislerin harcamasi (panel sohbeti: arac dongusu bu servisin
   * chat()'ine sigmiyor; makale cevirisi). chat() ile AYNI defter satirlari ve AYNI sayac
   * (User.aiCostThisMonthUsd): butce kapisi (QuotaService.enforceAiCostBudget) yalniz bu
   * sayaca bakar.
   *
   * NEDEN (11.11.2026, sahip: aylik AI butcesi olcum disindaki her harcamayi kapsar): sohbet
   * deftere kendi sabit fiyatiyla yaziyor ama sayaca hic dokunmuyordu, ceviri ikisine de
   * yazmiyordu; butce en buyuk harcayanlari gormuyordu. `userId` SITE SAHIBI olmali (butce
   * hesabin; yoneticinin musteri sitesindeki islemi musterinin butcesinden duser).
   * chat() uzerinden giden cagri icin CAGRILMAZ (cift sayim).
   */
  async recordDirectUsage(args: {
    context: string;
    siteId?: string;
    userId?: string;
    conversationId?: string;
    provider: ProviderName;
    model: string;
    usage: UsageMetadata;
  }): Promise<void> {
    const pricing = this.providers.find(p => p.name === args.provider)?.getPricing(args.model);
    if (!pricing) {
      this.log.warn(`[${args.context}] "${args.model}" fiyat tablosunda yok; harcama deftere ve butce sayacina yazilmadi`);
      return;
    }
    await this.writeUsage(
      { context: args.context, siteId: args.siteId, userId: args.userId, conversationId: args.conversationId },
      args.provider, args.model, args.usage, pricing,
    );
  }

  private async writeUsage(
    meta: { context: string; siteId?: string; userId?: string; conversationId?: string },
    provider: ProviderName,
    model: string,
    usage: UsageMetadata,
    pricing: ModelPricing,
  ): Promise<void> {
    const records: any[] = [];
    const base = { siteId: meta.siteId, userId: meta.userId, provider, model, context: meta.context, conversationId: meta.conversationId };

    // Cache okumasi CIFT SAYILMASIN.
    // OpenAI (prompt_tokens) ve Gemini (promptTokenCount) alanlari cache'ten
    // okunan token'lari ICERIR — maliyet hesaplari tam bu yuzden
    // (inputTokens - cacheReadTokens) diye cikarir. Anthropic'in input_tokens
    // alani ise cache'i zaten HARIC tutar. Asagida 'prompt' kaydina ham
    // inputTokens yazilip ayrica bir 'cache_read' kaydi daha acilirsa,
    // ilk iki saglayicida ayni token iki kez sayilir ve musteriye gosterilen
    // token toplami sisik cikar. Kayit da maliyet hesabiyla ayni konvansiyonu
    // kullanmali.
    const inputIncludesCacheRead = provider === 'openai' || provider === 'gemini';
    const promptTokens = inputIncludesCacheRead
      ? Math.max(0, usage.inputTokens - usage.cacheReadTokens)
      : usage.inputTokens;

    if (promptTokens > 0) {
      records.push({
        ...base,
        tokenType: 'prompt',
        inputTokens: promptTokens,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        rate: pricing.input,
        // promptTokens ile ayni konvansiyon: cache'ten okunan token burada
        // TAM ucretten sayilmaz, kendi 'cache_read' kaydinda indirimli
        // oraniyla sayilir. Onceden ham inputTokens kullanildigi icin
        // OpenAI/Gemini trafiginde ayni token iki kez faturalaniyordu.
        costUsd: (promptTokens / 1_000_000) * pricing.input,
      });
    }
    if (usage.outputTokens > 0) {
      records.push({
        ...base,
        tokenType: 'completion',
        inputTokens: 0,
        outputTokens: usage.outputTokens,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        rate: pricing.output,
        costUsd: (usage.outputTokens / 1_000_000) * pricing.output,
      });
    }
    if (usage.cacheReadTokens > 0 && pricing.cacheRead) {
      records.push({
        ...base,
        tokenType: 'cache_read',
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: usage.cacheReadTokens,
        cacheWriteTokens: 0,
        rate: pricing.cacheRead,
        costUsd: (usage.cacheReadTokens / 1_000_000) * pricing.cacheRead,
      });
    }
    if (usage.cacheWriteTokens > 0 && pricing.cacheWrite) {
      records.push({
        ...base,
        tokenType: 'cache_write',
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: usage.cacheWriteTokens,
        rate: pricing.cacheWrite,
        costUsd: (usage.cacheWriteTokens / 1_000_000) * pricing.cacheWrite,
      });
    }

    if (records.length === 0) return;

    // Defter yazilamasa da butce sayaci artar: kapi (enforceAiCostBudget) yalniz sayaca
    // bakar. Eskiden sayac defter yaziminin ARKASINDAYDI; defter hata verince harcama
    // butceye hic islemiyordu. Defter hatasi cagirana yine bildirilir (loglanir).
    let ledgerError: unknown = null;
    try {
      await this.prisma.tokenUsageRecord.createMany({ data: records });
    } catch (err) {
      ledgerError = err;
    }

    // Aylık aiCostThisMonthUsd field'ını da güncelle (budget guard için)
    if (meta.userId) {
      const totalCost = records.reduce((s, r) => s + (r.costUsd ?? 0), 0);
      if (totalCost > 0) {
        await this.prisma.user.update({
          where: { id: meta.userId },
          data: { aiCostThisMonthUsd: { increment: totalCost } } as any,
        }).catch(() => { /* user might be deleted, sessiz geç */ });
      }
    }
    if (ledgerError) throw ledgerError;
  }

  /** Site / user / global için aggregated spend bilgisi */
  async getSpendSummary(filter: { siteId?: string; userId?: string; days?: number }): Promise<{
    totalUsd: number;
    byProvider: Record<string, number>;
    byContext: Record<string, number>;
    byDate: Record<string, number>;
    requestCount: number;
    tokens: {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
      total: number;
    };
  }> {
    const days = filter.days ?? 30;
    const since = new Date(Date.now() - days * 86400000);

    const records = await this.prisma.tokenUsageRecord.findMany({
      where: {
        ...(filter.siteId ? { siteId: filter.siteId } : {}),
        ...(filter.userId ? { userId: filter.userId } : {}),
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'asc' },
    });

    const byProvider: Record<string, number> = {};
    const byContext: Record<string, number> = {};
    const byDate: Record<string, number> = {};
    let totalUsd = 0;

    // Token toplamlari: alanlar TokenUsageRecord'da zaten tutuluyordu ama hicbir
    // uca cikmiyordu. Fiyat kartindaki "AI maliyet ve token muhasebesi"
    // maddesinin token yarisinin karsiligi olmasi icin burada toplaniyor.
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let cacheWriteTokens = 0;

    for (const r of records) {
      const cost = Number(r.costUsd);
      totalUsd += cost;
      byProvider[r.provider] = (byProvider[r.provider] ?? 0) + cost;
      if (r.context) byContext[r.context] = (byContext[r.context] ?? 0) + cost;
      const d = r.createdAt.toISOString().slice(0, 10);
      byDate[d] = (byDate[d] ?? 0) + cost;

      inputTokens += r.inputTokens;
      outputTokens += r.outputTokens;
      cacheReadTokens += r.cacheReadTokens;
      cacheWriteTokens += r.cacheWriteTokens;
    }

    return {
      totalUsd,
      byProvider,
      byContext,
      byDate,
      requestCount: records.length,
      tokens: {
        input: inputTokens,
        output: outputTokens,
        cacheRead: cacheReadTokens,
        cacheWrite: cacheWriteTokens,
        total: inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens,
      },
    };
  }
}
