import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PrismaService } from '../prisma/prisma.service.js';
import { LLMProviderService } from '../llm/llm-provider.service.js';

/**
 * Screenshot Studio service:
 * - AI background generation (Gemini Imagen)
 * - AI caption text generation (Claude Haiku)
 * - PNG storage / serving
 */
@Injectable()
export class AsoScreenshotService {
  private readonly log = new Logger(AsoScreenshotService.name);
  private readonly STORAGE_DIR = path.resolve(process.cwd(), 'public', 'screenshots');

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LLMProviderService,
  ) {
    fs.mkdir(this.STORAGE_DIR, { recursive: true }).catch(() => {});
  }

  /**
   * Background üret — Gemini Imagen 3 ile.
   * App açıklaması + brand color + style preset → 1290×2796 (iOS 6.7") veya 1080×1920 (Android).
   */
  async generateBackground(opts: {
    trackedAppId: string;
    style?: 'minimalist' | 'bold' | 'illustrative' | 'gradient' | 'mesh' | 'hand-photo';
    brandColor?: string;
    customPrompt?: string;
    width?: number;
    height?: number;
  }) {
    const app = await this.prisma.trackedApp.findUniqueOrThrow({
      where: { id: opts.trackedAppId },
    });

    if (!process.env.GOOGLE_AI_API_KEY) {
      throw new BadRequestException('GOOGLE_AI_API_KEY .env\'de tanımlı değil');
    }

    const meta: any = app.metadata ?? {};
    const description = (meta.ios?.description ?? meta.android?.description ?? '').slice(0, 300);
    const category = app.category ?? 'app';
    const style = opts.style ?? 'gradient';

    const stylePrompts: Record<string, string> = {
      minimalist: 'clean minimalist abstract background, lots of white space, single accent gradient, professional Apple-style aesthetic',
      bold: 'bold vibrant gradient background with geometric shapes, dynamic composition, eye-catching modern design',
      illustrative: 'soft illustrative background with subtle vector shapes, friendly approachable mood, slight 3D depth',
      gradient: 'smooth multi-color gradient mesh background, premium feel, blended pastel-to-saturated colors',
      mesh: 'colorful mesh gradient background, abstract organic shapes, modern dribbble-style aesthetic',
      'hand-photo': 'photorealistic photograph of a person\'s hand holding a modern smartphone vertically, the phone screen is BLANK black or white (will be replaced), professional studio lighting, soft natural shadow, vivid colorful blurred bokeh background, premium app store screenshot aesthetic',
    };

    const isHandPhoto = style === 'hand-photo';

    const prompt = opts.customPrompt ?? (isHandPhoto
      ? `Photorealistic professional product photograph for App Store screenshot.
Subject: A person's hand holding a modern smartphone vertically in portrait orientation.
The phone is the visual focus, centered with proper breathing room.
The phone screen MUST be a plain solid color (black or pure white) - it will be replaced with app UI later.
Lighting: soft studio lighting, professional, premium feel.
Background: vivid colorful gradient bokeh (suggest ${opts.brandColor ? opts.brandColor : 'modern color'}), out of focus, premium look.
Hand: natural human hand, ${app.country === 'tr' ? 'mediterranean' : 'diverse'} skin tone, well-manicured, holding phone naturally.
Style: high-end commercial photography, 8k, professional, no overlay text.
STRICT: NO text on screen, NO logos, NO watermarks, blank phone screen, vertical 9:19.5 aspect ratio.`
      : `App store screenshot background for "${app.name}" — ${category} category app.
App context: ${description}
Style: ${stylePrompts[style]}.
Color palette: ${opts.brandColor ? `${opts.brandColor} as accent color` : 'cohesive harmonious palette'}.
Composition: vertical 9:19.5 aspect ratio (mobile), centered with breathing room for phone mockup overlay.
Strict: NO text, NO words, NO letters, NO logos, NO photorealistic faces. Pure abstract design background.`);

    const width = opts.width ?? 1290;
    const height = opts.height ?? 2796;
    const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY });

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: [{ parts: [{ text: prompt }] }],
      } as any);

      const parts = (response as any)?.candidates?.[0]?.content?.parts ?? [];
      const imagePart = parts.find((p: any) => p.inlineData);
      if (!imagePart?.inlineData?.data) {
        throw new Error('Gemini response\'unda image data yok');
      }

      const buffer = Buffer.from(imagePart.inlineData.data, 'base64');
      // Resize to exact dimensions
      const resized = await sharp(buffer).resize(width, height, { fit: 'cover' }).png().toBuffer();

      // Storage
      const filename = `bg-${opts.trackedAppId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
      const filepath = path.join(this.STORAGE_DIR, filename);
      await fs.writeFile(filepath, resized);

      const url = `/screenshots/${filename}`;
      const costUsd = 0.030;

      this.log.log(`[${opts.trackedAppId}] background generated: ${url} ($${costUsd})`);
      return { url, width, height, costUsd, style };
    } catch (err: any) {
      this.log.error(`Background generation failed: ${err.message}`);
      throw new BadRequestException(`Gemini Imagen hatası: ${err.message}`);
    }
  }

  /**
   * Caption text önerileri üret (Claude Haiku ile).
   * 10 slot için hook + alt başlık.
   */
  async generateCaptions(opts: {
    trackedAppId: string;
    targetKeywords?: string[];
    locale?: 'tr' | 'en';
    slotCount?: number;
  }) {
    const app = await this.prisma.trackedApp.findUniqueOrThrow({
      where: { id: opts.trackedAppId },
    });
    const meta: any = app.metadata ?? {};
    const description = (meta.ios?.description ?? meta.android?.description ?? '').slice(0, 500);
    const slotCount = opts.slotCount ?? 10;
    const locale = opts.locale ?? 'tr';

    const prompt = `Sen bir ASO uzmanısın. App store screenshot'ları için ${slotCount} slot caption text üret.

App: ${app.name}
Kategori: ${app.category ?? '-'}
Açıklama: ${description}
${opts.targetKeywords?.length ? `Hedef keyword'ler: ${opts.targetKeywords.join(', ')}` : ''}
Dil: ${locale === 'tr' ? 'Türkçe' : 'English'}

Her slot için:
- "hook" (3-5 kelimelik güçlü başlık, üstte olur, BÜYÜK font)
- "subtitle" (10-15 kelime, altta olur, açıklama)

Slot stratejisi:
- Slot 1: En güçlü USP — ana fayda
- Slot 2: Sosyal kanıt veya hız vurgusu
- Slot 3-5: Özellik vitrini
- Slot 6-7: Kullanım senaryosu (kim/ne zaman/nasıl)
- Slot 8-9: Sosyal/güven sinyali (rating, basın, vb.)
- Slot 10: CTA + indirim/free trial

JSON formatında dön:
[
  { "slot": 1, "hook": "...", "subtitle": "..." },
  ...
]`;

    try {
      const response = await this.llm.chat({
        context: 'aso-screenshot-captions',
        model: 'claude-haiku-4-5-20251001',
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 2500,
      });
      const text = response.output ?? '';
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const captions = JSON.parse(jsonMatch[0]);
        return { captions };
      }
      throw new Error('AI response\'unda JSON bulunamadı');
    } catch (err: any) {
      this.log.error(`Caption generation: ${err.message}`);
      throw new BadRequestException(`AI caption hatası: ${err.message}`);
    }
  }

  /**
   * Final screenshot kaydet (frontend'den export edilen PNG'i sunucuda sakla).
   */
  async saveScreenshot(opts: {
    trackedAppId: string;
    base64Png: string;
    slotIndex: number;
    store: 'IOS' | 'ANDROID';
  }) {
    const buffer = Buffer.from(opts.base64Png.replace(/^data:image\/png;base64,/, ''), 'base64');
    const filename = `final-${opts.trackedAppId}-${opts.store}-slot${opts.slotIndex}-${Date.now()}.png`;
    const filepath = path.join(this.STORAGE_DIR, filename);
    await fs.writeFile(filepath, buffer);
    return { url: `/screenshots/${filename}`, size: buffer.length };
  }
}
