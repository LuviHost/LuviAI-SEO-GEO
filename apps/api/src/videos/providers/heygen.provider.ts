import type { VideoBrief, VideoGenerationResult, VideoProvider, VideoProviderInfo } from './types.js';

/**
 * HeyGen — avatar-based video.
 *
 * Endpoint: https://api.heygen.com/v2/video/generate
 * Auth: X-Api-Key
 *
 * Akış:
 *   1) POST /v2/video/generate → video_id
 *   2) GET /v1/video_status.get?video_id=X → status:'completed', video_url
 */

const HEYGEN_API = 'https://api.heygen.com';

export class HeyGenVideoProvider implements VideoProvider {
  key = 'HEYGEN' as const;

  info(): VideoProviderInfo {
    const ready = !!process.env.HEYGEN_API_KEY;
    return {
      key: 'HEYGEN',
      label: 'HeyGen Avatar',
      description:
        'AI avatar konuşturarak video. Gerçekçi insan avatar + kendi sesin (clone) veya hazır TTS sesleri. Eğitim/anlatım için ideal.',
      estTime: '2–5 dk',
      costBand: '$0.30–0.60 / dk (10 video/ay free)',
      quality: 4,
      requiredEnvKeys: ['HEYGEN_API_KEY'],
      ready,
      note: ready
        ? 'HeyGen key tanımlı. Avatar + voice ID için dashboard\'dan seçim yap (config\'e koy).'
        : 'HEYGEN_API_KEY .env\'de tanımlı olmalı (https://app.heygen.com/settings/api).',
      bestFor: ['Eğitim/anlatım', 'Konuşan kafa', 'Üst düzey yapay sunucu', 'Multilingual'],
    };
  }

  async generate(brief: VideoBrief): Promise<VideoGenerationResult> {
    if (!process.env.HEYGEN_API_KEY) throw new Error('HEYGEN_API_KEY .env\'de yok');

    const avatarId = brief.style ?? process.env.HEYGEN_DEFAULT_AVATAR_ID ?? 'Daisy-inskirt-20220818';
    const voiceId = brief.voiceId ?? process.env.HEYGEN_DEFAULT_VOICE_ID ?? '1bd001e7e50f421d891986aad5158bc8';
    const dimension =
      brief.aspectRatio === '9:16' ? { width: 720, height: 1280 } :
      brief.aspectRatio === '1:1'  ? { width: 720, height: 720 } :
                                     { width: 1280, height: 720 };

    const body = {
      video_inputs: [
        {
          character: { type: 'avatar', avatar_id: avatarId, avatar_style: 'normal' },
          voice: { type: 'text', input_text: brief.scriptText.slice(0, 1500), voice_id: voiceId },
        },
      ],
      dimension,
    };

    const initRes = await fetch(`${HEYGEN_API}/v2/video/generate`, {
      method: 'POST',
      headers: {
        'X-Api-Key': process.env.HEYGEN_API_KEY ?? '',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!initRes.ok) {
      const errBody = await initRes.text();
      throw new Error(`HeyGen init failed: ${initRes.status} ${errBody}`);
    }
    const initData = (await initRes.json()) as { data: { video_id: string } };
    const videoId = initData.data.video_id;

    // Poll
    const startTs = Date.now();
    const maxMs = 8 * 60 * 1000;
    while (Date.now() - startTs < maxMs) {
      await new Promise((r) => setTimeout(r, 10_000));
      const statusRes = await fetch(`${HEYGEN_API}/v1/video_status.get?video_id=${videoId}`, {
        headers: { 'X-Api-Key': process.env.HEYGEN_API_KEY ?? '' },
      });
      if (!statusRes.ok) continue;
      const statusData = (await statusRes.json()) as {
        data: { status: string; video_url?: string; thumbnail_url?: string; duration?: number };
      };
      if (statusData.data.status === 'completed' && statusData.data.video_url) {
        return {
          videoUrl: statusData.data.video_url,
          thumbnailUrl: statusData.data.thumbnail_url,
          durationSec: Math.round(statusData.data.duration ?? brief.durationSec),
          providerJobId: videoId,
          costUsd: ((statusData.data.duration ?? brief.durationSec) / 60) * 0.45,
          raw: statusData,
        };
      }
      if (statusData.data.status === 'failed') {
        throw new Error(`HeyGen video failed: ${JSON.stringify(statusData)}`);
      }
    }
    throw new Error(`HeyGen video timeout (${videoId})`);
  }
}
