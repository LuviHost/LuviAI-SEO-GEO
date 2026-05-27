import type { VideoBrief, VideoGenerationResult, VideoProvider, VideoProviderInfo } from './types.js';

/**
 * Google Veo 3 — Google AI Studio API ile (Gemini Developer API ekosistemi).
 *
 * Vertex AI değil; AI Studio'dan alınan basit API key ile çalışır:
 *   https://aistudio.google.com/apikey
 *
 * Endpoint:
 *   POST https://generativelanguage.googleapis.com/v1beta/models/veo-3.0-generate-001:predictLongRunning?key={KEY}
 *   GET  https://generativelanguage.googleapis.com/v1beta/{operationName}?key={KEY}
 *
 * Tamamlandığında: response.generateVideoResponse.generatedSamples[0].video.uri (signed URL)
 * Video binary'sini fetch et + apps/api/public/videos altına kaydet (Sora/Slideshow pattern'i).
 *
 * Env: GOOGLE_AI_STUDIO_KEY (öncelikli) veya GOOGLE_AI_API_KEY (fallback — Gemini ile aynı key)
 */

const AI_STUDIO_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const MODEL = 'veo-3.0-generate-001';

export class VeoVideoProvider implements VideoProvider {
  key = 'VEO' as const;

  info(): VideoProviderInfo {
    const ready = !!(process.env.GOOGLE_AI_STUDIO_KEY || process.env.GOOGLE_AI_API_KEY);
    return {
      key: 'VEO',
      label: 'Google Veo 3',
      description:
        "Google'ın yeni nesil video AI'si — fotogerçekçi, sinematik. 8sn klipler, ses içerebilir. AI Studio API key yeterli.",
      estTime: '2–5 dk',
      costBand: '$0.50–0.75 / 8sn klip',
      quality: 5,
      requiredEnvKeys: ['GOOGLE_AI_STUDIO_KEY (veya GOOGLE_AI_API_KEY fallback)'],
      ready,
      note: ready
        ? 'Google AI Studio key tanımlı. Veo 3 paid tier gerektirir (free tier desteklenmez).'
        : "aistudio.google.com/apikey adresinden API key al, GOOGLE_AI_STUDIO_KEY env'ine ekle.",
      bestFor: ['Sinematik B-roll', 'Yüksek kalite reklam', 'Fotogerçekçi sahneler'],
    };
  }

  async generate(brief: VideoBrief): Promise<VideoGenerationResult> {
    const apiKey = process.env.GOOGLE_AI_STUDIO_KEY || process.env.GOOGLE_AI_API_KEY;
    if (!apiKey) {
      throw new Error("GOOGLE_AI_STUDIO_KEY .env'de yok (veya GOOGLE_AI_API_KEY fallback).");
    }

    const promptText = `${brief.title}. ${brief.scriptText.slice(0, 800)}. Style: ${brief.style ?? 'photorealistic, cinematic'}`;
    const aspectRatio = brief.aspectRatio === '9:16' ? '9:16' : brief.aspectRatio === '1:1' ? '1:1' : '16:9';
    // Veo 3 sadece 8 saniye destekler (Aralık 2025 itibariyle)
    const durationSeconds = 8;

    // 1) Init — predictLongRunning
    const initRes = await fetch(`${AI_STUDIO_BASE}/models/${MODEL}:predictLongRunning?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{ prompt: promptText }],
        parameters: {
          aspectRatio,
          durationSeconds,
          personGeneration: 'allow_all',
        },
      }),
    });
    if (!initRes.ok) {
      const body = await initRes.text();
      throw new Error(`Veo init ${initRes.status}: ${body.slice(0, 400)}`);
    }
    const initData = (await initRes.json()) as { name: string };
    const operationName = initData.name; // örn. "operations/abc123..."
    if (!operationName) {
      throw new Error('Veo init: operation name dönmedi');
    }

    // 2) Poll — operation status
    const startTs = Date.now();
    const maxMs = 10 * 60 * 1000;
    let lastStatus = 'pending';
    while (Date.now() - startTs < maxMs) {
      await new Promise((r) => setTimeout(r, 10_000));
      const statusRes = await fetch(`${AI_STUDIO_BASE}/${operationName}?key=${apiKey}`);
      if (!statusRes.ok) {
        throw new Error(`Veo status ${statusRes.status}: ${(await statusRes.text()).slice(0, 200)}`);
      }
      const statusData = (await statusRes.json()) as {
        done?: boolean;
        error?: { code: number; message: string };
        response?: {
          generateVideoResponse?: {
            generatedSamples?: Array<{ video?: { uri?: string } }>;
          };
        };
      };
      if (statusData.error) {
        throw new Error(`Veo error: ${statusData.error.message} (${statusData.error.code})`);
      }
      if (statusData.done) {
        const videoUri = statusData.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
        if (!videoUri) {
          throw new Error(`Veo done but no video URI: ${JSON.stringify(statusData).slice(0, 300)}`);
        }

        // 3) Video binary'sini indir — AI Studio'da signed URL'ye ?key=... eklemek gerek
        const downloadUrl = videoUri.includes('?')
          ? `${videoUri}&key=${apiKey}`
          : `${videoUri}?key=${apiKey}`;
        const contentRes = await fetch(downloadUrl);
        if (!contentRes.ok) {
          throw new Error(`Veo content fetch ${contentRes.status}: ${(await contentRes.text()).slice(0, 200)}`);
        }
        const buf = Buffer.from(await contentRes.arrayBuffer());

        // 4) apps/api/public/videos'a kaydet (Sora/Slideshow ile aynı dizin)
        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        const opId = operationName.split('/').pop() ?? Date.now().toString(36);
        const filename = `veo-${opId.slice(0, 18)}.mp4`;
        const publicDir = path.resolve(process.cwd(), 'public', 'videos');
        await fs.mkdir(publicDir, { recursive: true }).catch(() => {});
        await fs.writeFile(path.join(publicDir, filename), buf);

        const webBase = process.env.WEB_BASE_URL ?? 'https://ai.luvihost.com';
        const videoUrl = `${webBase}/videos/${filename}`;

        return {
          videoUrl,
          thumbnailUrl: undefined,
          durationSec: durationSeconds,
          providerJobId: operationName,
          costUsd: 0.75, // Veo 3 standart fiyat (8sn)
          raw: statusData,
        };
      }
      lastStatus = statusData.done ? 'done' : 'in_progress';
    }
    throw new Error(`Veo video timeout (${operationName}) — son durum: ${lastStatus}`);
  }
}
