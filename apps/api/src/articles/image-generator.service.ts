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
  'gpt-image-1': 0.040,
  'gpt-image-1-mini': 0.020,
  'flux-pro-1.1-ultra': 0.060,
  'ideogram-v3': 0.020,
};

export interface ImageProviderInfo {
  key: string;
  label: string;
  description: string;
  costPerImage: number;
  bestFor: string[];
  ready: boolean;
  requiredEnvKeys: string[];
}

export function listImageProviders(): ImageProviderInfo[] {
  return [
    {
      key: 'gemini-flash',
      label: 'Google Imagen 4 (Flash)',
      description: 'Foto-gerçekçi, hızlı, ucuz. Genel kullanım için varsayılan.',
      costPerImage: 0.030,
      bestFor: ['Makale hero', 'Sosyal post arka planı', 'Genel illüstrasyon'],
      ready: !!process.env.GOOGLE_AI_API_KEY,
      requiredEnvKeys: ['GOOGLE_AI_API_KEY'],
    },
    {
      key: 'gpt-image-1',
      label: 'OpenAI gpt-image-1',
      description: 'Text-in-image şampiyonu. Türkçe/İngilizce metin içeren grafikler için ideal.',
      costPerImage: 0.040,
      bestFor: ['Slogan içeren post', 'İnfografik', 'Kapak görseli'],
      ready: !!process.env.OPENAI_API_KEY,
      requiredEnvKeys: ['OPENAI_API_KEY'],
    },
    {
      key: 'flux-pro',
      label: 'Flux 1.1 Pro Ultra (BFL)',
      description: 'En foto-gerçekçi açık model. Ürün shot, insan portresi.',
      costPerImage: 0.060,
      bestFor: ['Ürün fotoğrafı', 'Portre', 'Yüksek detay sahne'],
      ready: !!process.env.BFL_API_KEY,
      requiredEnvKeys: ['BFL_API_KEY'],
    },
    {
      key: 'ideogram-v3',
      label: 'Ideogram v3',
      description: 'Ucuz, Türkçe text rendering iyi. gpt-image-1 alternatifi.',
      costPerImage: 0.020,
      bestFor: ['Bütçe dostu metin grafik', 'Tipografi'],
      ready: !!process.env.IDEOGRAM_API_KEY,
      requiredEnvKeys: ['IDEOGRAM_API_KEY'],
    },
    // Not: Runway gen4_image text-to-image değil, image-to-image (referans görsel ZORUNLU).
    // Studio Görsel akışı saf prompt-based olduğu için Runway image listede yok.
    // Video tarafında Runway gen4_turbo zaten kullanılıyor (text-to-video).
  ];
}

const BRAND_SUFFIX = `
Style: clean modern flat illustration with subtle 3D depth, geometric shapes, vector art aesthetic.
Composition: centered focal element, balanced negative space, professional and trustworthy mood.
Strict requirements: NO logos, NO watermarks, NO photorealistic human faces, NO Adobe Stock cliches.
Mood: technical, contemporary, premium brand.`;

/**
 * Türkçe text rendering için kritik talimat — Imagen, gpt-image, Flux, Ideogram
 * Türkçe karakterleri (ç, ğ, ı, ö, ş, ü) zaman zaman yanlış basıyor. Bu suffix
 * prompt'ta açıkça Türkçe karakterlerin korunmasını istiyor.
 *
 * Sadece "Türkçe metin" içeren prompt'larda eklenir (auto-detect).
 */
const TURKISH_TEXT_GUARD = `
CRITICAL TEXT RENDERING RULES:
- If text appears in the image, it MUST be in Turkish with PERFECT spelling.
- Preserve Turkish characters EXACTLY: ç Ç ğ Ğ ı I i İ ö Ö ş Ş ü Ü
- Do NOT invent fake Turkish-looking words. Do NOT misspell.
- If you cannot render the exact Turkish phrase requested, use NO TEXT at all (rely on visual symbols only).
- Common errors to AVOID: "Karşılaştmma", "Krredisi", "Iletme" — these are misspellings.
- Correct examples: "Karşılaştırma", "Kredisi", "İşletme".`;

function looksTurkish(s: string): boolean {
  // Türkçe karakterler veya yaygın Türkçe kelimeler içeriyor mu?
  if (/[çÇğĞıİöÖşŞüÜ]/.test(s)) return true;
  return /\b(ve|ile|için|bir|bu|şu|olan|olmak|var|yok|kredi|hosting|esnaf|işletme|banka|ev|araba|domain|sosyal|medya|takvim)\b/i.test(s);
}

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

    try {
      let buffer: Buffer | null = null;
      let model = '';

      if (provider === 'gemini-flash' || provider === 'gemini-pro') {
        ({ buffer, model } = await this.generateWithGemini(req, opts, provider));
      } else if (provider === 'gpt-image-1' || provider === 'gpt-image-1-mini') {
        ({ buffer, model } = await this.generateWithOpenAI(req, opts, provider));
      } else if (provider === 'flux-pro') {
        ({ buffer, model } = await this.generateWithFlux(req, opts));
      } else if (provider === 'ideogram-v3') {
        ({ buffer, model } = await this.generateWithIdeogram(req, opts));
      } else {
        return { ok: false, costUsd: 0, error: `Bilinmeyen provider: ${provider}` };
      }

      if (!buffer) {
        return { ok: false, costUsd: 0, error: `${provider} yanıtında görsel yok` };
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
      this.log.log(`[image:${provider}] ${req.type} → ${(webp.length / 1024).toFixed(0)}KB, $${cost.toFixed(3)}`);

      return {
        ok: true,
        outputPath: req.outputPath,
        size: webp.length,
        costUsd: cost,
      };
    } catch (err: any) {
      this.log.error(`[image:${provider}] ${err.message}`);
      return { ok: false, costUsd: 0, error: err.message };
    }
  }

  // ─── Provider impl'leri ──────────────────────────────

  private async generateWithGemini(
    req: ImageRequest,
    opts: { brandColor?: string },
    provider: string,
  ): Promise<{ buffer: Buffer | null; model: string }> {
    if (!process.env.GOOGLE_AI_API_KEY) throw new Error('GOOGLE_AI_API_KEY .env\'de tanımlı değil');
    const model = provider === 'gemini-flash' ? 'gemini-2.5-flash-image' : 'gemini-3-pro-image';
    const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY });
    const colorClause = opts.brandColor
      ? `Color palette: ${opts.brandColor} gradient, white background with subtle glow.`
      : 'Color palette: deep purple (#6c5ce7) gradient to light lilac (#a29bfe), white background with subtle purple glow.';
    const trGuard = looksTurkish(req.prompt) ? `\n${TURKISH_TEXT_GUARD}` : '';
    const fullPrompt = `${req.prompt.trim()}\n${colorClause}\n${BRAND_SUFFIX}${trGuard}`;
    const response = await ai.models.generateContent({
      model,
      contents: fullPrompt,
      config: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '16:9' } } as any,
    });
    let buffer: Buffer | null = null;
    for (const part of response.candidates?.[0]?.content?.parts ?? []) {
      if (part.inlineData?.data) {
        buffer = Buffer.from(part.inlineData.data, 'base64');
        break;
      }
    }
    return { buffer, model };
  }

  private async generateWithOpenAI(
    req: ImageRequest,
    opts: { brandColor?: string },
    provider: string,
  ): Promise<{ buffer: Buffer | null; model: string }> {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY .env\'de tanımlı değil');
    const model = provider === 'gpt-image-1-mini' ? 'gpt-image-1-mini' : 'gpt-image-1';
    // gpt-image-1 boyutları: 1024x1024, 1024x1536, 1536x1024, auto
    const size = req.width >= req.height
      ? (req.width / req.height > 1.3 ? '1536x1024' : '1024x1024')
      : '1024x1536';
    const trGuard = looksTurkish(req.prompt) ? `\n${TURKISH_TEXT_GUARD}` : '';
    const fullPrompt = `${req.prompt.trim()}\n${BRAND_SUFFIX}${trGuard}`;

    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model, prompt: fullPrompt, size, n: 1 }),
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`OpenAI image ${res.status}: ${txt.slice(0, 200)}`);
    }
    const data = await res.json() as { data: Array<{ b64_json?: string; url?: string }> };
    const item = data.data?.[0];
    if (!item) return { buffer: null, model };
    let buffer: Buffer | null = null;
    if (item.b64_json) {
      buffer = Buffer.from(item.b64_json, 'base64');
    } else if (item.url) {
      const r = await fetch(item.url);
      buffer = Buffer.from(await r.arrayBuffer());
    }
    return { buffer, model };
  }

  private async generateWithFlux(
    req: ImageRequest,
    _opts: { brandColor?: string },
  ): Promise<{ buffer: Buffer | null; model: string }> {
    const key = process.env.BFL_API_KEY;
    if (!key) throw new Error('BFL_API_KEY .env\'de tanımlı değil');
    const model = 'flux-pro-1.1-ultra';
    const trGuard = looksTurkish(req.prompt) ? `\n${TURKISH_TEXT_GUARD}` : '';
    const initRes = await fetch('https://api.bfl.ai/v1/flux-pro-1.1-ultra', {
      method: 'POST',
      headers: { 'x-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: `${req.prompt.trim()}\n${BRAND_SUFFIX}${trGuard}`,
        aspect_ratio: req.width / req.height > 1.5 ? '16:9' : req.width / req.height > 0.9 ? '1:1' : '9:16',
        output_format: 'png',
        safety_tolerance: 2,
      }),
    });
    if (!initRes.ok) throw new Error(`Flux init ${initRes.status}: ${(await initRes.text()).slice(0, 200)}`);
    const initData = await initRes.json() as { id: string; polling_url: string };

    // Poll
    const startTs = Date.now();
    while (Date.now() - startTs < 60_000) {
      await new Promise(r => setTimeout(r, 1500));
      const pollRes = await fetch(initData.polling_url, { headers: { 'x-key': key } });
      const pollData = await pollRes.json() as { status: string; result?: { sample: string } };
      if (pollData.status === 'Ready' && pollData.result?.sample) {
        const imgRes = await fetch(pollData.result.sample);
        const buffer = Buffer.from(await imgRes.arrayBuffer());
        return { buffer, model };
      }
      if (pollData.status === 'Error' || pollData.status === 'Failed') {
        throw new Error(`Flux ${pollData.status}`);
      }
    }
    throw new Error('Flux timeout');
  }

  private async generateWithIdeogram(
    req: ImageRequest,
    _opts: { brandColor?: string },
  ): Promise<{ buffer: Buffer | null; model: string }> {
    const key = process.env.IDEOGRAM_API_KEY;
    if (!key) throw new Error('IDEOGRAM_API_KEY .env\'de tanımlı değil');
    const model = 'ideogram-v3';
    // Ideogram v3 yeni format: 16x9, 1x1, 9x16 (eski ASPECT_X_Y format'ı kaldırıldı)
    const aspect = req.width / req.height > 1.5 ? '16x9' : req.width / req.height > 0.9 ? '1x1' : '9x16';

    const trGuard = looksTurkish(req.prompt) ? `\n${TURKISH_TEXT_GUARD}` : '';
    const form = new FormData();
    form.append('prompt', `${req.prompt.trim()}\n${BRAND_SUFFIX}${trGuard}`);
    form.append('aspect_ratio', aspect);
    form.append('rendering_speed', 'DEFAULT');

    const res = await fetch('https://api.ideogram.ai/v1/ideogram-v3/generate', {
      method: 'POST',
      headers: { 'Api-Key': key },
      body: form as any,
    });
    if (!res.ok) throw new Error(`Ideogram ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json() as { data: Array<{ url: string }> };
    const url = data.data?.[0]?.url;
    if (!url) return { buffer: null, model };
    const imgRes = await fetch(url);
    const buffer = Buffer.from(await imgRes.arrayBuffer());
    return { buffer, model };
  }

}
