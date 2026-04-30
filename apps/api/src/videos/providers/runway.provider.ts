import type { VideoBrief, VideoGenerationResult, VideoProvider, VideoProviderInfo } from './types.js';

/**
 * Runway Gen-3 / Gen-4 — runwayml.com API.
 *
 * Endpoint: https://api.dev.runwayml.com/v1/image_to_video (Gen-3 Alpha Turbo)
 *           https://api.dev.runwayml.com/v1/text_to_video (Gen-4)
 *
 * Auth: Authorization: Bearer <RUNWAY_API_KEY>
 *
 * Akış:
 *   1) POST /v1/<endpoint> → task.id
 *   2) GET /v1/tasks/<id> poll → status: SUCCEEDED, output[0]
 */

const RUNWAY_API = 'https://api.dev.runwayml.com/v1';

export class RunwayVideoProvider implements VideoProvider {
  key = 'RUNWAY' as const;

  info(): VideoProviderInfo {
    const ready = !!process.env.RUNWAY_API_KEY;
    return {
      key: 'RUNWAY',
      label: 'Runway Gen-4 / Gen-3',
      description:
        'Runway\'in son nesil video AI\'si. 5–10sn klipler, image-to-video / text-to-video. Geniş stil yelpazesi.',
      estTime: '1–3 dk',
      costBand: '$0.05–0.15 / saniye (Gen-4 Turbo: $0.05/sn)',
      quality: 5,
      requiredEnvKeys: ['RUNWAY_API_KEY'],
      ready,
      note: ready
        ? 'Runway API key tanımlı. Gen-4 Turbo en hızlı + uygun fiyatlı. dev.runwayml.com\'da kalan kredinizi kontrol edin.'
        : 'RUNWAY_API_KEY .env\'de tanımlı olmalı (https://dev.runwayml.com\'dan al).',
      bestFor: ['Yaratıcı stilize video', 'Mevcut görselden hareket', 'Reklam sahneleri'],
    };
  }

  async generate(brief: VideoBrief): Promise<VideoGenerationResult> {
    if (!process.env.RUNWAY_API_KEY) throw new Error('RUNWAY_API_KEY .env\'de yok');

    const promptText = this.buildPrompt(brief);
    const ratio = brief.aspectRatio === '9:16' ? '720:1280' : brief.aspectRatio === '1:1' ? '720:720' : '1280:720';
    const duration = Math.min(10, Math.max(5, brief.durationSec));

    // Gen-4 text-to-video
    const initRes = await fetch(`${RUNWAY_API}/text_to_video`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RUNWAY_API_KEY}`,
        'Content-Type': 'application/json',
        'X-Runway-Version': '2024-11-06',
      },
      body: JSON.stringify({
        promptText,
        model: 'gen4_turbo',
        ratio,
        duration,
      }),
    });
    if (!initRes.ok) {
      const body = await initRes.text();
      throw new Error(`Runway init failed: ${initRes.status} ${body}`);
    }
    const initData = (await initRes.json()) as { id: string };
    const taskId = initData.id;

    // Poll
    const startTs = Date.now();
    const maxMs = 5 * 60 * 1000;
    while (Date.now() - startTs < maxMs) {
      await new Promise((r) => setTimeout(r, 8000));
      const statusRes = await fetch(`${RUNWAY_API}/tasks/${taskId}`, {
        headers: {
          Authorization: `Bearer ${process.env.RUNWAY_API_KEY}`,
          'X-Runway-Version': '2024-11-06',
        },
      });
      if (!statusRes.ok) continue;
      const statusData = (await statusRes.json()) as {
        status: string;
        output?: string[];
      };
      if (statusData.status === 'SUCCEEDED' && statusData.output?.[0]) {
        return {
          videoUrl: statusData.output[0],
          durationSec: duration,
          providerJobId: taskId,
          costUsd: duration * 0.05,
          raw: statusData,
        };
      }
      if (statusData.status === 'FAILED') {
        throw new Error(`Runway task FAILED: ${JSON.stringify(statusData)}`);
      }
    }
    throw new Error(`Runway task timeout (${taskId})`);
  }

  private buildPrompt(brief: VideoBrief): string {
    const style = brief.style ?? 'cinematic, high quality, 4k';
    return `${brief.title}. ${brief.scriptText.slice(0, 500)}. Style: ${style}.`;
  }
}
