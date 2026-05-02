import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';
import fs from 'node:fs/promises';
import path from 'node:path';
import { SettingsService } from '../settings/settings.service.js';

export interface AdImage {
  format: 'square' | 'portrait' | 'landscape';
  publicUrl: string;
  bytes: number;
  costUsd: number;
}

/**
 * AdImageGenerator — Gemini 2.5 Flash Image ile reklam gorseli.
 *
 * 3 format Meta + Google placement uyumlu:
 *   - square 1080x1080 (Feed, IG)
 *   - portrait 1080x1350 (IG Feed Vertical)
 *   - landscape 1200x628 (Google Display, Meta Audience Network)
 *
 * Otomatik brand color overlay + minimal text (eger gerekirse Sharp ile).
 */
@Injectable()
export class AdImageGeneratorService {
  private readonly log = new Logger(AdImageGeneratorService.name);

  constructor(private readonly settings: SettingsService) {}

  async generateSet(opts: {
    prompt: string;
    siteSlug: string;
    formats?: Array<'square' | 'portrait' | 'landscape'>;
    brandColor?: string;
  }): Promise<AdImage[]> {
    await this.settings.assertAiEnabled('ad image generation');
    if (!process.env.GOOGLE_AI_API_KEY) {
      throw new Error('GOOGLE_AI_API_KEY yok');
    }
    const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY });
    const formats = opts.formats ?? ['square', 'portrait', 'landscape'];
    const aspectMap: Record<string, string> = {
      square: '1:1',
      portrait: '4:5',
      landscape: '16:9',
    };

    const outDir = path.join(process.cwd(), 'public', 'ads', opts.siteSlug);
    await fs.mkdir(outDir, { recursive: true });

    const brandColor = opts.brandColor ?? '#6c5ce7';
    const enrichedPrompt = `${opts.prompt}

Style: clean modern flat illustration, vector art, premium feel.
Composition: centered focal element, balanced negative space.
Color: ${brandColor} accent, white background with subtle gradient glow.
NO text, NO logos, NO watermarks, NO photorealistic faces.`;

    const results: AdImage[] = [];
    for (const format of formats) {
      try {
        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash-image',
          contents: enrichedPrompt,
          config: {
            responseModalities: ['IMAGE'],
            imageConfig: { aspectRatio: aspectMap[format] },
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
          this.log.warn(`Ad image ${format} bos cevap`);
          continue;
        }

        const filename = `${format}-${Date.now().toString(36)}.png`;
        const outPath = path.join(outDir, filename);
        await fs.writeFile(outPath, buffer);

        results.push({
          format,
          publicUrl: `/ads/${opts.siteSlug}/${filename}`,
          bytes: buffer.length,
          costUsd: 0.030,
        });
      } catch (err: any) {
        this.log.warn(`Ad image ${format} fail: ${err.message}`);
      }
    }

    return results;
  }
}
