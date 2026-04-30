import { spawn } from 'node:child_process';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { VideoBrief, VideoGenerationResult, VideoProvider, VideoProviderInfo } from './types.js';

/**
 * Slideshow provider — sunucuda ücretsiz çalışır.
 *
 * Akış:
 *   1) Senaryoyu N parçaya böl (her parça ~10-15sn)
 *   2) Her parça için bir görsel + TTS audio üret
 *      - Görsel: brief.imageUrls (varsa) veya Pexels API'den (PEXELS_API_KEY ile)
 *      - Audio: OpenAI TTS (OPENAI_API_KEY) veya ElevenLabs (ELEVENLABS_API_KEY)
 *   3) ffmpeg ile parçaları birleştir + ses overlay
 *   4) MP4 dosyasını /var/www/luviai/apps/api/public/videos/<id>.mp4 olarak kaydet
 *   5) /videos/<id>.mp4 URL'ini dön
 *
 * Bağımlılık: ffmpeg sunucuda kurulu olmalı (apt-get install ffmpeg)
 */

const FFMPEG_BIN = process.env.FFMPEG_BIN ?? 'ffmpeg';
const OUTPUT_DIR =
  process.env.VIDEO_OUTPUT_DIR ?? '/var/www/luviai/apps/api/public/videos';
const PUBLIC_BASE = process.env.VIDEO_PUBLIC_BASE ?? 'https://ai.luvihost.com/videos';

export class SlideshowVideoProvider implements VideoProvider {
  key = 'SLIDESHOW' as const;

  info(): VideoProviderInfo {
    const ttsReady = !!(process.env.OPENAI_API_KEY || process.env.ELEVENLABS_API_KEY);
    const ffmpegReady = true; // Sunucuda kurulu varsayımı; runtime kontrol başka yerde
    const imgReady = !!process.env.PEXELS_API_KEY || true; // Görsel olmadan da text-only fallback var
    return {
      key: 'SLIDESHOW',
      label: 'Slideshow + Seslendirme (Ücretsiz)',
      description:
        'Stok görseller + AI seslendirme (TTS) + ffmpeg compose. Sunucuda çalışır. AI üretimi yok ama hızlı, ücretsiz ve sınırsız.',
      estTime: '30–60 sn',
      costBand: 'Ücretsiz (TTS varsa düşük cost)',
      quality: 2,
      requiredEnvKeys: ['OPENAI_API_KEY veya ELEVENLABS_API_KEY (TTS)', 'PEXELS_API_KEY (opsiyonel, stok görseller)'],
      ready: ttsReady && ffmpegReady,
      note: ttsReady
        ? 'ffmpeg + TTS hazır. Pexels key opsiyonel — varsa görseller otomatik çekilir.'
        : 'TTS için OPENAI_API_KEY veya ELEVENLABS_API_KEY gerekli.',
      bestFor: ['Hızlı haber/duyuru', 'Makale özeti', 'Düşük bütçe', 'Sınırsız üretim'],
    };
  }

  async generate(brief: VideoBrief): Promise<VideoGenerationResult> {
    if (!existsSync(OUTPUT_DIR)) await mkdir(OUTPUT_DIR, { recursive: true });

    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const workDir = path.join('/tmp/videos-work', id);
    await mkdir(workDir, { recursive: true });

    try {
      // 1) Senaryoyu cümlelere böl
      const sentences = this.splitIntoBeats(brief.scriptText, brief.durationSec);
      const beatCount = sentences.length;
      const beatDuration = brief.durationSec / beatCount;

      // 2) Her beat için TTS audio
      const audioPath = path.join(workDir, 'narration.mp3');
      await this.generateTTS(brief.scriptText, audioPath, brief.voiceId, brief.language);

      // 3) Görselleri hazırla — verilen imageUrls veya Pexels'ten çek
      const imageUrls = brief.imageUrls?.length
        ? brief.imageUrls
        : await this.fetchStockImages(brief.title, beatCount);

      // 4) Görselleri indir
      const localImages: string[] = [];
      for (let i = 0; i < beatCount; i++) {
        const imgUrl = imageUrls[i % imageUrls.length];
        const localPath = path.join(workDir, `img-${i}.jpg`);
        await this.downloadFile(imgUrl, localPath);
        localImages.push(localPath);
      }

      // 5) ffmpeg ile slideshow + ses
      const outputPath = path.join(OUTPUT_DIR, `${id}.mp4`);
      await this.composeSlideshow(localImages, audioPath, brief.aspectRatio, beatDuration, outputPath);

      // 6) Public URL
      const videoUrl = `${PUBLIC_BASE}/${id}.mp4`;
      const fileSize = await this.statSize(outputPath);

      return {
        videoUrl,
        durationSec: brief.durationSec,
        fileSize,
        costUsd: 0, // TTS hariç
      };
    } finally {
      // workDir'i sil (best-effort)
      try {
        const { rm } = await import('node:fs/promises');
        await rm(workDir, { recursive: true, force: true });
      } catch (_e) { /* noop */ }
    }
  }

  // ── helpers ──────────────────────────────────────────────────

  private splitIntoBeats(text: string, durationSec: number): string[] {
    const sentences = text
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const targetBeats = Math.max(3, Math.min(12, Math.ceil(durationSec / 8)));
    if (sentences.length <= targetBeats) return sentences;
    // Eşit bölümle
    const out: string[] = [];
    const chunkSize = Math.ceil(sentences.length / targetBeats);
    for (let i = 0; i < sentences.length; i += chunkSize) {
      out.push(sentences.slice(i, i + chunkSize).join(' '));
    }
    return out;
  }

  private async generateTTS(text: string, outputPath: string, voiceId: string | undefined, language: string): Promise<void> {
    if (process.env.ELEVENLABS_API_KEY) {
      await this.elevenLabsTTS(text, outputPath, voiceId);
      return;
    }
    if (process.env.OPENAI_API_KEY) {
      await this.openaiTTS(text, outputPath, voiceId);
      return;
    }
    throw new Error('TTS için OPENAI_API_KEY veya ELEVENLABS_API_KEY .env\'de tanımlı olmalı');
  }

  private async openaiTTS(text: string, outputPath: string, voice = 'alloy'): Promise<void> {
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: 'tts-1', voice, input: text, speed: 1.0 }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`OpenAI TTS failed: ${res.status} ${body}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(outputPath, buf);
  }

  private async elevenLabsTTS(text: string, outputPath: string, voiceId = '21m00Tcm4TlvDq8ikWAM'): Promise<void> {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY ?? '',
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`ElevenLabs TTS failed: ${res.status} ${body}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(outputPath, buf);
  }

  private async fetchStockImages(query: string, count: number): Promise<string[]> {
    const key = process.env.PEXELS_API_KEY;
    if (!key) {
      // Fallback: Unsplash source URL'leri (random görsel)
      return Array.from({ length: count }, (_, i) =>
        `https://source.unsplash.com/1080x1920/?${encodeURIComponent(query)}&sig=${i}`,
      );
    }
    const res = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${count}&orientation=portrait`,
      { headers: { Authorization: key } },
    );
    if (!res.ok) {
      // Fallback
      return Array.from({ length: count }, (_, i) =>
        `https://source.unsplash.com/1080x1920/?${encodeURIComponent(query)}&sig=${i}`,
      );
    }
    const data = (await res.json()) as { photos?: Array<{ src: { large2x?: string; portrait?: string; original?: string } }> };
    const photos = data.photos ?? [];
    return photos.map((p) => p.src.portrait ?? p.src.large2x ?? p.src.original ?? '').filter(Boolean);
  }

  private async downloadFile(url: string, localPath: string): Promise<void> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Image fetch failed: ${res.status} ${url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(localPath, buf);
  }

  private async composeSlideshow(
    images: string[],
    audioPath: string,
    aspectRatio: string,
    perImageDuration: number,
    outputPath: string,
  ): Promise<void> {
    // Aspect → width x height
    const dims = aspectRatio === '9:16' ? '1080:1920' : aspectRatio === '1:1' ? '1080:1080' : '1920:1080';

    // ffmpeg concat demuxer için bir input list dosyası yaz
    const listPath = path.join(path.dirname(audioPath), 'inputs.txt');
    const lines = images.flatMap((img) => [`file '${img}'`, `duration ${perImageDuration.toFixed(2)}`]);
    // Son resmi tekrar yaz (concat demuxer'in son frame için kuralı)
    lines.push(`file '${images[images.length - 1]}'`);
    await writeFile(listPath, lines.join('\n'));

    // ffmpeg komutu: slayt -> ses -> mp4
    const args = [
      '-y',
      '-f', 'concat', '-safe', '0',
      '-i', listPath,
      '-i', audioPath,
      '-vf', `scale=${dims}:force_original_aspect_ratio=increase,crop=${dims},setsar=1,fps=30`,
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-shortest',
      '-movflags', '+faststart',
      outputPath,
    ];

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(FFMPEG_BIN, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.on('error', reject);
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-1000)}`));
      });
    });
  }

  private async statSize(filePath: string): Promise<number> {
    const { stat } = await import('node:fs/promises');
    const s = await stat(filePath);
    return s.size;
  }
}
