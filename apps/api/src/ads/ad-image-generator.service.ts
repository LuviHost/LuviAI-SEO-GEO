import { Injectable, Logger } from '@nestjs/common';
import fs from 'node:fs/promises';
import path from 'node:path';
import { SettingsService } from '../settings/settings.service.js';
import { ImageGeneratorService } from '../articles/image-generator.service.js';

export interface AdImage {
  format: 'square' | 'portrait' | 'landscape';
  publicUrl: string;
  bytes: number;
  costUsd: number;
}

/**
 * AdImageGenerator — reklam gorseli. Artik birlesik ImageGeneratorService uzerinden
 * uretiyor (IMAGE_PROVIDER = gpt-image-1 / vb. "max" model). Format -> boyut esleme:
 *   - square   1024x1024 (Feed, IG)
 *   - portrait 1024x1536 (IG Vertical)
 *   - landscape 1536x1024 (Google Display, Meta)
 */
@Injectable()
export class AdImageGeneratorService {
  private readonly log = new Logger(AdImageGeneratorService.name);

  constructor(
    private readonly settings: SettingsService,
    private readonly imageGen: ImageGeneratorService,
  ) {}

  async generateSet(opts: {
    prompt: string;
    siteSlug: string;
    formats?: Array<'square' | 'portrait' | 'landscape'>;
    brandColor?: string;
  }): Promise<AdImage[]> {
    await this.settings.assertAiEnabled('ad image generation');

    const formats = opts.formats ?? ['square', 'portrait', 'landscape'];
    const sizeMap: Record<string, { w: number; h: number }> = {
      square: { w: 1024, h: 1024 },
      portrait: { w: 1024, h: 1536 },
      landscape: { w: 1536, h: 1024 },
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
        const { w, h } = sizeMap[format];
        const filename = `${format}-${Date.now().toString(36)}.png`;
        const outPath = path.join(outDir, filename);
        const result = await this.imageGen.generate(
          { prompt: enrichedPrompt, outputPath: outPath, width: w, height: h, type: 'inline' },
          { provider: process.env.IMAGE_PROVIDER, brandColor },
        );
        if (!result.ok) {
          this.log.warn(`Ad image ${format} fail: ${result.error}`);
          continue;
        }
        results.push({
          format,
          publicUrl: `/ads/${opts.siteSlug}/${filename}`,
          bytes: result.size ?? 0,
          costUsd: result.costUsd ?? 0,
        });
      } catch (err: any) {
        this.log.warn(`Ad image ${format} fail: ${err.message}`);
      }
    }

    return results;
  }
}
