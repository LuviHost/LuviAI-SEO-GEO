import { Injectable, Logger, BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { McpToolsService, type ToolUser } from '../mcp/mcp-tools.service.js';
import { CHAT_SKILLS } from './chat-skills.js';

/**
 * RanksUp Chat — kullanicinin KENDI VERISI uzerinde konusan asistan.
 *
 * "Bu hafta gorunurlugum neden dustu?" → asistan get_ai_kpis /
 * get_prompt_coverage tool'larini cagirir, gercek sayilarla cevap verir.
 *
 * Tool seti MCP registry'siyle AYNI (tek kaynak) — Claude'a MCP ile baglanan
 * kullanici da, panel ici chat kullanan da ayni yetenekleri gorur.
 *
 * Maliyet korumasi:
 *  - AI_GLOBAL_DISABLED saygisi
 *  - max 6 tool turu / mesaj
 *  - TokenUsageRecord'a 'chat' context'iyle kayit (spend dashboard'da gorunur)
 */

const MODEL = 'claude-sonnet-5';
const MAX_TOOL_ROUNDS = 6;
const MAX_MESSAGE_LEN = 4000;
const HISTORY_LIMIT = 20;

// $/1M — anthropic.provider.ts PRICING ile ayni degerler (sonnet-5)
const PRICE_IN = 3;
const PRICE_OUT = 15;

@Injectable()
export class ChatService {
  private readonly log = new Logger(ChatService.name);
  private readonly anthropic = new Anthropic();

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly tools: McpToolsService,
  ) {}

  // ────────────────────────────────────────────────────────────
  //  KATALOG + GECMIS
  // ────────────────────────────────────────────────────────────

  listSkills() {
    // prompt alani dis dunyaya sizmasin — yalnizca meta doner
    return CHAT_SKILLS.map((s) => ({
      key: s.key,
      name: s.name,
      tag: s.tag,
      description: s.description,
      accesses: s.accesses,
      needsInput: s.needsInput,
      inputPlaceholder: s.inputPlaceholder,
    }));
  }

  async listConversations(siteId: string, userId: string) {
    return this.prisma.chatConversation.findMany({
      where: { siteId, userId },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      select: {
        id: true, title: true, createdAt: true, updatedAt: true,
        _count: { select: { messages: true } },
      },
    });
  }

  async getConversation(siteId: string, userId: string, conversationId: string) {
    const conv = await this.prisma.chatConversation.findFirst({
      where: { id: conversationId, siteId, userId },
      include: {
        messages: { orderBy: { createdAt: 'asc' }, take: 200 },
      },
    });
    if (!conv) throw new NotFoundException('Konusma bulunamadi');
    return conv;
  }

  async deleteConversation(siteId: string, userId: string, conversationId: string) {
    const conv = await this.prisma.chatConversation.findFirst({
      where: { id: conversationId, siteId, userId },
      select: { id: true },
    });
    if (!conv) throw new NotFoundException('Konusma bulunamadi');
    await this.prisma.chatConversation.delete({ where: { id: conv.id } });
    return { ok: true };
  }

  // ────────────────────────────────────────────────────────────
  //  MESAJ AKISI
  // ────────────────────────────────────────────────────────────

  async sendMessage(
    siteId: string,
    user: ToolUser,
    input: { conversationId?: string; message?: string; skill?: string },
  ) {
    const disabled = await this.settings.getBoolean('AI_GLOBAL_DISABLED').catch(() => false);
    if (disabled) {
      throw new ServiceUnavailableException('AI su an bakim modunda (AI_GLOBAL_DISABLED)');
    }

    // ── Girdi: skill preset'i veya serbest mesaj
    const skill = input.skill ? CHAT_SKILLS.find((s) => s.key === input.skill) : undefined;
    if (input.skill && !skill) throw new BadRequestException('Bilinmeyen skill');

    const userText = typeof input.message === 'string' ? input.message.trim() : '';
    if (userText.length > MAX_MESSAGE_LEN) {
      throw new BadRequestException(`Mesaj ${MAX_MESSAGE_LEN} karakteri asamaz`);
    }
    if (!skill && userText.length === 0) {
      throw new BadRequestException('Mesaj bos olamaz');
    }

    const site = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId } });

    // ── Konusma cozumle/olustur
    let conversation = input.conversationId
      ? await this.prisma.chatConversation.findFirst({
          where: { id: input.conversationId, siteId, userId: user.id },
        })
      : null;
    if (input.conversationId && !conversation) throw new NotFoundException('Konusma bulunamadi');
    if (!conversation) {
      conversation = await this.prisma.chatConversation.create({
        data: {
          siteId,
          userId: user.id,
          title: (skill ? skill.name : userText).slice(0, 120),
        },
      });
    }

    // ── Gecmis (son N mesaj)
    const history = await this.prisma.chatMessage.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_LIMIT,
    });
    history.reverse();

    // Skill: gorev talimati + kullanici girdisi tek user mesajinda birlesir
    const effectiveUserText = skill
      ? `${skill.prompt}${userText ? `\n\nKullanici girdisi: ${userText}` : ''}`
      : userText;

    // ── Kullanici mesajini kaydet (UI'da skill adi gorunur, ham prompt degil)
    await this.prisma.chatMessage.create({
      data: {
        conversationId: conversation.id,
        role: 'user',
        content: skill ? (userText || `▶ ${skill.name}`) : userText,
        skill: skill?.key ?? null,
      },
    });

    // ── Anthropic mesaj dizisi
    const messages: Anthropic.MessageParam[] = [
      ...history.map((m) => ({
        role: (m.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
        content: m.content,
      })),
      { role: 'user', content: effectiveUserText },
    ];

    const systemPrompt = this.buildSystemPrompt(site);
    const anthropicTools = this.tools.listForAnthropic() as any;

    // ── Agent dongusu
    let totalIn = 0;
    let totalOut = 0;
    const toolCallLog: Array<{ name: string; input: any; resultSummary: string }> = [];
    let finalText = '';

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const response = await this.anthropic.messages.create({
        model: MODEL,
        max_tokens: 8000,
        system: [{ type: 'text' as const, text: systemPrompt, cache_control: { type: 'ephemeral' as const } }],
        tools: anthropicTools,
        messages,
      } as any);

      totalIn += response.usage.input_tokens ?? 0;
      totalOut += response.usage.output_tokens ?? 0;

      const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      const texts = response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text);

      if (toolUses.length === 0 || round === MAX_TOOL_ROUNDS) {
        finalText = texts.join('\n').trim();
        if (!finalText && toolUses.length > 0) {
          finalText = 'Araç çağrısı limiti doldu — kısmi sonuçlarla cevap veremedim, soruyu daraltır mısın?';
        }
        break;
      }

      // Asistan turunu ekle, tool'lari calistir, sonuclari dondur
      messages.push({ role: 'assistant', content: response.content });
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        const args = { ...(tu.input as Record<string, any>) };
        // Site kapsamli tool'larda site_id verilmediyse aktif siteyi kullan.
        // (Baska site id'si verilirse resolveSite sahiplik dogrular.)
        if (args.site_id === undefined) args.site_id = siteId;
        let resultText: string;
        let isError = false;
        try {
          const result = await this.tools.call(user, tu.name, args);
          resultText = JSON.stringify(result).slice(0, 30_000);
        } catch (err: any) {
          resultText = `Hata: ${err.message ?? 'bilinmeyen'}`;
          isError = true;
        }
        toolCallLog.push({
          name: tu.name,
          input: this.redactArgs(args),
          resultSummary: resultText.slice(0, 300),
        });
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: resultText,
          is_error: isError,
        });
      }
      messages.push({ role: 'user', content: toolResults });
    }

    // ── Maliyet + kayit
    const costUsd = (totalIn / 1_000_000) * PRICE_IN + (totalOut / 1_000_000) * PRICE_OUT;
    this.recordUsage(siteId, user.id, conversation.id, totalIn, totalOut).catch((err) =>
      this.log.warn(`Chat token kaydi basarisiz: ${err.message}`),
    );

    const assistantMsg = await this.prisma.chatMessage.create({
      data: {
        conversationId: conversation.id,
        role: 'assistant',
        content: finalText || 'Cevap üretilemedi.',
        toolCalls: toolCallLog.length ? (toolCallLog as any) : undefined,
        skill: skill?.key ?? null,
        costUsd,
      },
    });

    await this.prisma.chatConversation.update({
      where: { id: conversation.id },
      data: { updatedAt: new Date() },
    });

    return {
      conversationId: conversation.id,
      message: {
        id: assistantMsg.id,
        role: 'assistant',
        content: assistantMsg.content,
        toolCalls: toolCallLog,
        createdAt: assistantMsg.createdAt,
      },
      costUsd: Math.round(costUsd * 10000) / 10000,
    };
  }

  // ────────────────────────────────────────────────────────────

  private buildSystemPrompt(site: any): string {
    return [
      'Sen RanksUp asistanisin — SEO + GEO (AI gorunurluk) + ASO platformunun panel ici uzmani.',
      `Aktif site: "${site.name}" (${site.url})${site.niche ? ` — nis: ${site.niche}` : ''}. Bugun: ${new Date().toISOString().slice(0, 10)}.`,
      '',
      'ILKELER:',
      '- Soruyu cevaplamak icin TOOL kullan — tahmin etme, gercek veriyle konus. site_id vermezsen aktif site kullanilir.',
      '- Sayilari kaynaklariyla ver ("mention rate %25.9, gecen haftaya gore +0.4pp").',
      '- Maliyetli/mutating tool\'lari (run_prompt, create_article, generate_article_from_opportunity, run_audit) kullanici ACIKCA istemeden cagirma; once oner, onay iste.',
      '- Cevaplar Turkce, kisa ve aksiyon odakli. Uzun raporlarda markdown baslik/tablo kullan.',
      '- Veri yoksa "olcum yok" de ve nasil baslatilacagini soyle; uydurma.',
    ].join('\n');
  }

  /** Tool loglarinda buyuk/gereksiz alanlari kirp */
  private redactArgs(args: Record<string, any>): Record<string, any> {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(args)) {
      out[k] = typeof v === 'string' && v.length > 200 ? `${v.slice(0, 200)}…` : v;
    }
    return out;
  }

  private async recordUsage(siteId: string, userId: string, conversationId: string, inputTokens: number, outputTokens: number) {
    const records: any[] = [];
    if (inputTokens > 0) {
      records.push({
        siteId, userId, provider: 'anthropic', model: MODEL, tokenType: 'prompt', context: 'chat',
        inputTokens, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
        rate: PRICE_IN, costUsd: (inputTokens / 1_000_000) * PRICE_IN, conversationId,
      });
    }
    if (outputTokens > 0) {
      records.push({
        siteId, userId, provider: 'anthropic', model: MODEL, tokenType: 'completion', context: 'chat',
        inputTokens: 0, outputTokens, cacheReadTokens: 0, cacheWriteTokens: 0,
        rate: PRICE_OUT, costUsd: (outputTokens / 1_000_000) * PRICE_OUT, conversationId,
      });
    }
    if (records.length) await this.prisma.tokenUsageRecord.createMany({ data: records });
  }
}
