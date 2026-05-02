import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import { SettingsService } from '../settings/settings.service.js';

export interface ImageRequest {
  prompt: string;
  outputPath: string;
  width: number;
  height: number;
  type: 'hero' | 'inline';
}

export interface ImageResult {
  ok: boolean;
  outputPath?: string;
  size?: number;
  costUsd: number;
  error?: string;
}

const PRICING: Record<string, number> = {
  'gemini-2.5-flash-image': 0.030,
  'gemini-3-pro-image': 0.039,
};

const BRAND_SUFFIX = `
Style: clean modern flat illustration with subtle 3D depth, geometric shapes, vector art aesthetic.
Composition: centered focal element, balanced negative space, professional and trustworthy mood.
Strict requirements: NO text, NO words, NO letters, NO logos, NO watermarks, NO photorealistic human faces, NO Adobe Stock cliches.
Mood: technical, contemporary, premium brand.`;

/**
 * Gemini görsel üretici (LuviHost'taki generate-image.js'in NestJS karşılığı).
 * Multi-tenant — her tenant kendi GOOGLE_AI_API_KEY veya .env default'unu kullanır.
 */
@Injectable()
export class ImageGeneratorService {
  private readonly log = new Logger(ImageGeneratorService.name);

  constructor(private readonly settings: SettingsService) {}

  async generate(req: ImageRequest, opts: { provider?: string; brandColor?: string } = {}): Promise<ImageResult> {
    await this.settings.assertAiEnabled('image generation');
    const provider = opts.provider ?? process.env.IMAGE_PROVIDER ?? 'gemini-flash';
    const model = provider === 'gemini-flash' ? 'gemini-2.5-flash-image' : 'gemini-3-pro-image';

    if (!process.env.GOOGLE_AI_API_KEY) {
      return { ok: false, costUsd: 0, error: 'GOOGLE_AI_API_KEY .env\'de tanımlı değil' };
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY });

    const colorClause = opts.brandColor
      ? `Color palette: ${opts.brandColor} gradient, white background with subtle glow.`
      : 'Color palette: deep purple (#6c5ce7) gradient to light lilac (#a29bfe), white background with subtle purple glow.';

    const fullPrompt = `${req.prompt.trim()}\n${colorClause}\n${BRAND_SUFFIX}`;

    try {
      const response = await ai.models.generateContent({
        model,
        contents: fullPrompt,
        config: {
          responseModalities: ['IMAGE'],
          imageConfig: { aspectRatio: '16:9' },
        } as any,
      });

      let buffer: Buffer | null = null;
      for (const part of response.candidates?.[0]?.content?.parts ?? []) {
        if (part.inlineData?.data) {
          buffer = Buffer.from(part.inlineData.data, 'base64');
          break;
        }
      }

      if (!buffer) {
        return { ok: false, costUsd: 0, error: 'Gemini yanıtında görsel bulunamadı' };
      }

      // Sharp ile resize + WebP optimize
      await fs.mkdir(path.dirname(req.outputPath), { recursive: true });
      const webp = await sharp(buffer)
        .resize(req.width, req.height, { fit: 'cover', position: 'center' })
        .webp({ quality: 85 })
        .toBuffer();
      await fs.writeFile(req.outputPath, webp);

      // Hero için JPG fallback (OG image)
      if (req.type === 'hero') {
        const jpgPath = req.outputPath.replace(/\.webp$/, '.jpg');
        const jpg = await sharp(buffer)
          .resize(req.width, req.height, { fit: 'cover' })
          .jpeg({ quality: 85 })
          .toBuffer();
        await fs.writeFile(jpgPath, jpg);
      }

      const cost = PRICING[model] ?? 0.030;
      this.log.log(`[image] ${req.type} → ${(webp.length / 1024).toFixed(0)}KB, $${cost.toFixed(3)}`);

      return {
        ok: true,
        outputPath: req.outputPath,
        size: webp.length,
        costUsd: cost,
      };
    } catch (err: any) {
      this.log.error(`[image] ${err.message}`);
      return { ok: false, costUsd: 0, error: err.message };
    }
  }
}
