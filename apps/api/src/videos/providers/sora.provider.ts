import type { VideoBrief, VideoGenerationResult, VideoProvider, VideoProviderInfo } from './types.js';

/**
 * OpenAI Sora — text-to-video.
 *
 * Endpoint: https://api.openai.com/v1/videos (Sora 2)
 * Auth: Bearer OPENAI_API_KEY
 *
 * NOT: 2026 itibariyle Sora API'si Tier 5 hesaplara açık (yüksek kullanım gerekli).
 * Sandbox ChatGPT plus ile bireysel; geliştirici API'si beta. Endpoint isimleri
 * değişebilir — bu adapter güncel spec'e göre yazıldı, env key olunca aktif olur.
 */

export class SoraVideoProvider implements VideoProvider {
  key = 'SORA' as const;

  info(): VideoProviderInfo {
    const ready = !!process.env.OPENAI_API_KEY && process.env.SORA_ENABLED === '1';
    return {
      key: 'SORA',
      label: 'OpenAI Sora 2',
      description:
        'OpenAI\'ın foto-gerçekçi video AI\'si. Uzun klipler, karmaşık sahneler, tutarlı karakterler. Tier 5 erişim gerek.',
      estTime: '3–8 dk',
      costBand: '$0.30–1.00 / klip (Tier 5)',
      quality: 5,
      requiredEnvKeys: ['OPENAI_API_KEY', 'SORA_ENABLED=1 (manuel açma)'],
      ready,
      note: ready
        ? 'Sora API key tanımlı + SORA_ENABLED=1 olduğunda kullanılabilir.'
        : 'OPENAI_API_KEY .env\'de tanımlı olmalı + Tier 5 hesap. Erişim aldıktan sonra SORA_ENABLED=1 set et.',
      bestFor: ['Yüksek kalite kısa film', 'Karmaşık sahneler', 'Karakter tutarlılığı'],
    };
  }

  async generate(brief: VideoBrief): Promise<VideoGenerationResult> {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY .env\'de yok');
    if (process.env.SORA_ENABLED !== '1') {
      throw new Error('SORA_ENABLED=1 set edilmeli (Tier 5 hesap onayından sonra)');
    }

    const promptText = `${brief.title}. ${brief.scriptText.slice(0, 800)}. Style: ${brief.style ?? 'photorealistic, cinematic'}`;
    const size = brief.aspectRatio === '9:16' ? '720x1280' : brief.aspectRatio === '1:1' ? '720x720' : '1280x720';
    // Sora 2 API sadece '4', '8' veya '12' kabul ediyor — string olarak. En yakın değere yuvarla.
    const reqSec = brief.durationSec || 8;
    const secondsStr: '4' | '8' | '12' = reqSec <= 6 ? '4' : reqSec <= 10 ? '8' : '12';
    const seconds = parseInt(secondsStr, 10);

    const initRes = await fetch('https://api.openai.com/v1/videos', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'sora-2',
        prompt: promptText,
        size,
        seconds: secondsStr,
      }),
    });
    if (!initRes.ok) {
      const body = await initRes.text();
      throw new Error(`Sora init failed: ${initRes.status} ${body}`);
    }
    const initData = (await initRes.json()) as { id: string };
    const videoId = initData.id;

    // Poll — status endpoint
    const startTs = Date.now();
    const maxMs = 10 * 60 * 1000;
    let lastStatus = 'queued';
    while (Date.now() - startTs < maxMs) {
      await new Promise((r) => setTimeout(r, 12_000));
      const statusRes = await fetch(`https://api.openai.com/v1/videos/${videoId}`, {
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      });
      if (!statusRes.ok) {
        const errBody = await statusRes.text().catch(() => '');
        throw new Error(`Sora status check ${statusRes.status}: ${errBody.slice(0, 200)}`);
      }
      const statusData = (await statusRes.json()) as {
        status: string;
        progress?: number;
        error?: any;
      };
      lastStatus = statusData.status;
      if (statusData.status === 'completed') {
        // İçeriği ayrı endpoint'ten indir → binary mp4
        const contentRes = await fetch(`https://api.openai.com/v1/videos/${videoId}/content`, {
          headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        });
        if (!contentRes.ok) {
          const errBody = await contentRes.text().catch(() => '');
          throw new Error(`Sora content fetch failed: ${contentRes.status} ${errBody.slice(0, 200)}`);
        }
        const buf = Buffer.from(await contentRes.arrayBuffer());

        // Sunucuda apps/api/public/videos altına kaydet — nginx /videos/* oradan serve ediyor
        // (Slideshow ile aynı dizin; Next.js'in standalone public klasörü değil!)
        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        const filename = `sora-${videoId.slice(6, 24)}.mp4`;
        const publicDir = path.resolve(process.cwd(), 'public', 'videos');
        await fs.mkdir(publicDir, { recursive: true }).catch(() => {});
        await fs.writeFile(path.join(publicDir, filename), buf);

        const webBase = process.env.WEB_BASE_URL ?? 'https://ai.luvihost.com';
        const videoUrl = `${webBase}/videos/${filename}`;

        return {
          videoUrl,
          thumbnailUrl: undefined,
          durationSec: seconds,
          providerJobId: videoId,
          costUsd: seconds * 0.05,
          raw: statusData,
        };
      }
      if (statusData.status === 'failed') {
        throw new Error(`Sora video failed: ${JSON.stringify(statusData.error ?? statusData)}`);
      }
    }
    throw new Error(`Sora video timeout (${videoId}) — son durum: ${lastStatus}`);
  }
}
