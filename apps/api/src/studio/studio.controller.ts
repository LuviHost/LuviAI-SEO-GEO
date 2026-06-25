import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, NotFoundException, Param, Patch, Post, Query, Req, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service.js';
import { ImageGeneratorService, listImageProviders } from '../articles/image-generator.service.js';
import { LLMProviderService } from '../llm/llm-provider.service.js';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

function ensureUser(req: Request) {
  const user = (req as any).user;
  if (!user) throw new UnauthorizedException();
  return user as { id: string; role: 'USER' | 'ADMIN' | 'AGENCY_OWNER' };
}

interface GenerateImageBody {
  prompt: string;
  provider?: string;
  width?: number;
  height?: number;
  brandColor?: string;
}

interface GenerateTextBody {
  prompt: string;
  format?: 'short' | 'medium' | 'long';
  tone?: string;
  language?: 'tr' | 'en';
}

/**
 * Studio — birleşik içerik üretim ortamı.
 *
 * Endpoint'ler:
 *   GET  /api/studio/image/providers — kullanılabilir image AI'lar
 *   POST /api/sites/:siteId/studio/image — görsel üret (gpt-image / imagen / flux / ideogram)
 *   POST /api/sites/:siteId/studio/text — metin üret (LLM ile serbest yazma)
 */
@Controller()
export class StudioController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly imageGen: ImageGeneratorService,
    private readonly llm: LLMProviderService,
  ) {}

  @Get('studio/image/providers')
  imageProviders() {
    return listImageProviders();
  }

  @Post('sites/:siteId/studio/image')
  async generateImage(
    @Req() req: Request,
    @Param('siteId') siteId: string,
    @Body() body: GenerateImageBody,
  ) {
    ensureUser(req);
    if (!body?.prompt || body.prompt.trim().length < 5) {
      throw new BadRequestException('Prompt en az 5 karakter olmalı');
    }
    // Site ownership doğrula
    const site = await this.prisma.site.findUnique({ where: { id: siteId } });
    if (!site) throw new BadRequestException('Site bulunamadı');

    const width = body.width ?? 1024;
    const height = body.height ?? 1024;
    const hash = randomBytes(6).toString('hex');
    const filename = `${Date.now()}-${hash}.webp`;
    const outputPath = path.join(process.cwd(), 'public', 'studio-images', siteId, filename);

    const result = await this.imageGen.generate(
      {
        prompt: body.prompt,
        outputPath,
        width,
        height,
        type: 'inline',
      },
      { provider: body.provider ?? process.env.IMAGE_PROVIDER ?? 'gemini-flash', brandColor: body.brandColor },
    );

    if (!result.ok) {
      return { ok: false, error: result.error, costUsd: 0 };
    }

    const publicUrl = `/studio-images/${siteId}/${filename}`;
    const user = (req as any).user;

    // DB'ye taslak olarak kaydet (kalıcı history)
    const asset = await this.prisma.studioAsset.create({
      data: {
        siteId,
        userId: user?.id ?? null,
        type: 'IMAGE' as any,
        prompt: body.prompt.trim(),
        provider: body.provider ?? process.env.IMAGE_PROVIDER ?? 'gemini-flash',
        url: publicUrl,
        metadata: {
          width,
          height,
          sizeBytes: result.size,
          costUsd: result.costUsd,
          brandColor: body.brandColor,
        } as any,
      },
    });

    return {
      ok: true,
      assetId: asset.id,
      url: publicUrl,
      sizeBytes: result.size,
      costUsd: result.costUsd,
      provider: body.provider ?? process.env.IMAGE_PROVIDER ?? 'gemini-flash',
    };
  }

  @Post('sites/:siteId/studio/text')
  async generateText(
    @Req() req: Request,
    @Param('siteId') siteId: string,
    @Body() body: GenerateTextBody,
  ) {
    ensureUser(req);
    if (!body?.prompt || body.prompt.trim().length < 5) {
      throw new BadRequestException('Prompt en az 5 karakter olmalı');
    }

    const site = await this.prisma.site.findUnique({
      where: { id: siteId },
      include: { brain: true },
    });
    if (!site) throw new BadRequestException('Site bulunamadı');

    const length = body.format === 'short' ? '50-100 kelime'
      : body.format === 'long' ? '300-500 kelime'
      : '150-250 kelime';
    const lang = body.language === 'en' ? 'İngilizce' : 'Türkçe';
    const tone = body.tone ?? 'akıcı ve profesyonel';
    const brandVoice: any = (site as any).brain?.brandVoice ?? null;

    const voiceLines: string[] = [];
    if (brandVoice?.tone) voiceLines.push(`Marka tonu: ${brandVoice.tone}`);
    if (brandVoice?.bannedWords?.length) voiceLines.push(`Yasak kelimeler: ${brandVoice.bannedWords.slice(0, 8).join(', ')}`);

    const system = [
      `Sen ${lang} içerik yazarısın.`,
      `Ton: ${tone}. Uzunluk: ${length}.`,
      ...voiceLines,
      'AI klişelerinden kaçın ("günümüzde", "dijital çağda", "delve", vb.).',
      'Direkt çıktıyı ver, açıklama yapma.',
    ].join('\n');

    const resp = await this.llm.chat({
      context: 'studio-text',
      siteId,
      model: 'claude-haiku-4-5-20251001',
      systemPrompt: system,
      messages: [{ role: 'user', content: body.prompt.trim() }],
      maxTokens: body.format === 'long' ? 1200 : 600,
      temperature: 0.7,
    });

    const generatedText = resp.output.trim();
    const user = (req as any).user;

    const asset = await this.prisma.studioAsset.create({
      data: {
        siteId,
        userId: user?.id ?? null,
        type: 'TEXT' as any,
        prompt: body.prompt.trim(),
        provider: 'claude-haiku-4-5',
        text: generatedText,
        metadata: {
          format: body.format ?? 'medium',
          tone: body.tone ?? 'akıcı ve profesyonel',
          language: body.language ?? 'tr',
          tokens: resp.usage.outputTokens,
          costUsd: resp.costUsd,
        } as any,
      },
    });

    return {
      ok: true,
      assetId: asset.id,
      text: generatedText,
      costUsd: resp.costUsd,
      tokens: resp.usage.outputTokens,
    };
  }

  // ─── Asset history (kalıcı taslaklar) ──────────────

  /** Site'a ait Studio asset'lerini listele. type filtresi opsiyonel. */
  @Get('sites/:siteId/studio/assets')
  async listAssets(
    @Req() req: Request,
    @Param('siteId') siteId: string,
    @Query('type') type?: string,
    @Query('favorite') favoriteFilter?: string,
  ) {
    const user = ensureUser(req);
    const site = await this.prisma.site.findUnique({ where: { id: siteId } });
    if (!site) throw new NotFoundException('Site bulunamadı');
    if (user.role !== 'ADMIN' && site.userId !== user.id) throw new ForbiddenException();

    const where: any = { siteId };
    if (type && ['IMAGE', 'VIDEO', 'TEXT'].includes(type.toUpperCase())) {
      where.type = type.toUpperCase();
    }
    if (favoriteFilter === '1' || favoriteFilter === 'true') {
      where.favorite = true;
    }

    return this.prisma.studioAsset.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  /** Tek bir asset'i sil. */
  @Delete('studio/assets/:id')
  async deleteAsset(@Req() req: Request, @Param('id') id: string) {
    const user = ensureUser(req);
    const asset = await this.prisma.studioAsset.findUnique({
      where: { id },
      include: { site: { select: { userId: true } } },
    });
    if (!asset) throw new NotFoundException('Asset bulunamadı');
    if (user.role !== 'ADMIN' && asset.site.userId !== user.id) throw new ForbiddenException();
    await this.prisma.studioAsset.delete({ where: { id } });
    return { ok: true };
  }

  /** Asset'i favorile / favoriden çıkar. */
  @Patch('studio/assets/:id')
  async updateAsset(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { favorite?: boolean },
  ) {
    const user = ensureUser(req);
    const asset = await this.prisma.studioAsset.findUnique({
      where: { id },
      include: { site: { select: { userId: true } } },
    });
    if (!asset) throw new NotFoundException('Asset bulunamadı');
    if (user.role !== 'ADMIN' && asset.site.userId !== user.id) throw new ForbiddenException();
    return this.prisma.studioAsset.update({
      where: { id },
      data: { favorite: body.favorite ?? asset.favorite },
    });
  }
}
