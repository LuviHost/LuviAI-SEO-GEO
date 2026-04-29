import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import { encrypt, decrypt } from '@luviai/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { QuotaService } from '../billing/quota.service.js';

export type Provider = 'anthropic' | 'gemini' | 'openai' | 'perplexity' | 'xai' | 'deepseek';

const VALID_PROVIDERS: Provider[] = ['anthropic', 'gemini', 'openai', 'perplexity', 'xai', 'deepseek'];

const PROVIDER_LABELS: Record<Provider, string> = {
  anthropic:  'Anthropic Claude',
  gemini:     'Google Gemini',
  openai:     'OpenAI ChatGPT',
  perplexity: 'Perplexity',
  xai:        'xAI Grok',
  deepseek:   'DeepSeek',
};

const POOL_ENV_KEY: Record<Provider, string> = {
  anthropic:  'ANTHROPIC_API_KEY',
  gemini:     'GOOGLE_AI_API_KEY',
  openai:     'OPENAI_API_KEY',
  perplexity: 'PERPLEXITY_API_KEY',
  xai:        'XAI_API_KEY',
  deepseek:   'DEEPSEEK_API_KEY',
};

@Injectable()
export class SiteAiKeysService {
  private readonly log = new Logger(SiteAiKeysService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly quota: QuotaService,
  ) {}

  /** Plan + BYOK durumu (UI tablosu) */
  async getStatus(siteId: string) {
    const site = await this.prisma.site.findUnique({
      where: { id: siteId },
      select: { id: true, userId: true, user: { select: { plan: true } } },
    });
    if (!site) throw new NotFoundException('Site bulunamadi');

    const plan = site.user.plan;
    const pool = this.quota.getPlanPool(plan);
    const quotaInfo = await this.quota.checkCitationQuota(site.userId);

    const byokRows = await this.prisma.siteAiProviderKey.findMany({ where: { siteId } });
    const byokMap = new Map(byokRows.map(r => [r.provider, r]));

    const providers = VALID_PROVIDERS.map((provider) => {
      const byok = byokMap.get(provider);
      const inPool = pool.includes(provider);
      const poolKeyAvailable = inPool && !!process.env[POOL_ENV_KEY[provider]];
      const effectiveSource: 'byok' | 'pool' | 'none' =
        byok ? 'byok' : (poolKeyAvailable ? 'pool' : 'none');

      return {
        provider,
        label: PROVIDER_LABELS[provider],
        inPool,
        poolKeyAvailable,
        hasByok: !!byok,
        byokVerified: byok?.verified ?? false,
        byokPrefix: byok?.prefix,
        byokError: byok?.lastError ?? undefined,
        effectiveSource,
      };
    });

    return {
      plan,
      pool,
      quota: { limit: quotaInfo.limit, used: quotaInfo.used, remaining: quotaInfo.remaining },
      providers,
    };
  }

  /** Yeni BYOK ekle/guncelle. Once test eder, basariliysa kaydeder. */
  async upsertKey(siteId: string, provider: string, rawKey: string) {
    if (!VALID_PROVIDERS.includes(provider as Provider)) {
      throw new BadRequestException(`Gecersiz saglayici: ${provider}`);
    }
    if (!rawKey || rawKey.trim().length < 10) {
      throw new BadRequestException('API anahtari cok kisa');
    }

    const site = await this.prisma.site.findUnique({ where: { id: siteId }, select: { id: true } });
    if (!site) throw new NotFoundException('Site bulunamadi');

    const trimmed = rawKey.trim();
    const prefix = trimmed.slice(0, 8);

    const testResult = await this.testKey(provider as Provider, trimmed);

    const enc = encrypt(trimmed);
    const baseData = { siteId, provider, enc, prefix };

    if (!testResult.ok) {
      // Yine kaydet ama verified:false + lastError olarak (kullanici tekrar deneyebilsin)
      const existing = await this.prisma.siteAiProviderKey.findUnique({
        where: { siteId_provider: { siteId, provider } },
      });
      const data = {
        ...baseData,
        verified: false,
        verifiedAt: null,
        lastError: testResult.error?.slice(0, 500) ?? 'Test basarisiz',
      };
      if (existing) {
        await this.prisma.siteAiProviderKey.update({ where: { id: existing.id }, data });
      } else {
        await this.prisma.siteAiProviderKey.create({ data });
      }
      throw new BadRequestException(`Anahtar dogrulanamadi: ${testResult.error}`);
    }

    // Test basarili
    const data = {
      ...baseData,
      verified: true,
      verifiedAt: new Date(),
      lastError: null,
    };
    const existing = await this.prisma.siteAiProviderKey.findUnique({
      where: { siteId_provider: { siteId, provider } },
    });
    const saved = existing
      ? await this.prisma.siteAiProviderKey.update({ where: { id: existing.id }, data })
      : await this.prisma.siteAiProviderKey.create({ data });

    this.log.log(`BYOK kaydedildi: ${siteId}/${provider} (${prefix}***)`);
    return {
      provider,
      label: PROVIDER_LABELS[provider as Provider],
      prefix: saved.prefix,
      verified: saved.verified,
      verifiedAt: saved.verifiedAt,
    };
  }

  async deleteKey(siteId: string, provider: string) {
    if (!VALID_PROVIDERS.includes(provider as Provider)) {
      throw new BadRequestException(`Gecersiz saglayici: ${provider}`);
    }
    const existing = await this.prisma.siteAiProviderKey.findUnique({
      where: { siteId_provider: { siteId, provider } },
    });
    if (!existing) throw new NotFoundException('Bu provider icin BYOK kaydi yok');
    await this.prisma.siteAiProviderKey.delete({ where: { id: existing.id } });
    return { ok: true };
  }

  async retestKey(siteId: string, provider: string) {
    if (!VALID_PROVIDERS.includes(provider as Provider)) {
      throw new BadRequestException(`Gecersiz saglayici: ${provider}`);
    }
    const existing = await this.prisma.siteAiProviderKey.findUnique({
      where: { siteId_provider: { siteId, provider } },
    });
    if (!existing) throw new NotFoundException('Bu provider icin BYOK kaydi yok');

    const rawKey = decrypt(existing.enc);
    if (!rawKey) throw new BadRequestException('Anahtar cozulemedi (sifreleme key degismis olabilir)');

    const result = await this.testKey(provider as Provider, rawKey);
    await this.prisma.siteAiProviderKey.update({
      where: { id: existing.id },
      data: {
        verified: result.ok,
        verifiedAt: result.ok ? new Date() : existing.verifiedAt,
        lastError: result.ok ? null : (result.error?.slice(0, 500) ?? 'Test basarisiz'),
      },
    });
    if (result.ok) return { ok: true, error: null };
    return { ok: false, error: result.error };
  }

  // ────────────────────────────────────────────────────────────
  //  Anahtar dogrulayici
  // ────────────────────────────────────────────────────────────
  private async testKey(provider: Provider, key: string): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      switch (provider) {
        case 'anthropic': {
          const c = new Anthropic({ apiKey: key });
          const r = await c.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 5,
            messages: [{ role: 'user', content: 'ping' }],
          });
          if (!r.id) throw new Error('Bos cevap');
          return { ok: true };
        }
        case 'gemini': {
          const c = new GoogleGenAI({ apiKey: key });
          const r = await c.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: 'ping',
            config: { maxOutputTokens: 5 } as any,
          });
          if (typeof r.text !== 'string') throw new Error('Bos cevap');
          return { ok: true };
        }
        case 'openai':
          return this.pingOpenAICompatible('https://api.openai.com/v1/chat/completions', key, 'gpt-4o-mini');
        case 'perplexity':
          return this.pingOpenAICompatible('https://api.perplexity.ai/chat/completions', key, 'sonar');
        case 'xai':
          return this.pingOpenAICompatible('https://api.x.ai/v1/chat/completions', key, 'grok-4-fast-non-reasoning');
        case 'deepseek':
          return this.pingOpenAICompatible('https://api.deepseek.com/chat/completions', key, 'deepseek-chat');
      }
    } catch (err: any) {
      return { ok: false, error: String(err?.message ?? err).slice(0, 300) };
    }
  }

  private async pingOpenAICompatible(url: string, key: string, model: string): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          max_tokens: 5,
          messages: [{ role: 'user', content: 'ping' }],
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        return { ok: false, error: `HTTP ${res.status}: ${body.slice(0, 200)}` };
      }
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: String(err?.message ?? err).slice(0, 300) };
    }
  }
}
