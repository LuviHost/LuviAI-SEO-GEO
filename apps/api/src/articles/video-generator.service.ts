import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PrismaService } from '../prisma/prisma.service.js';

export interface VideoResult {
  ok: boolean;
  videoPath?: string;
  publicUrl?: string;
  format?: 'horizontal' | 'vertical';
  durationSec?: number;
  bytes?: number;
  error?: string;
}

/**
 * VideoGenerator — TTS audio + hero gorseli birlestirip MP4 olusturur.
 *
 * Format'lar:
 *   - horizontal (1920x1080) — YouTube Shorts disi
 *   - vertical (1080x1920) — TikTok, Instagram Reels, YouTube Shorts
 *
 * Bagimliliklar: ffmpeg sistem-level'da yuklu olmali.
 *
 * Yayin:
 *   - YouTube Data API v3 (env: YOUTUBE_REFRESH_TOKEN)
 *   - TikTok Content Posting API (env: TIKTOK_ACCESS_TOKEN)
 *   - Mvp: sadece MP4 olusturur, kullanici manuel yukler
 */
@Injectable()
export class VideoGeneratorService {
  private readonly log = new Logger(VideoGeneratorService.name);

  constructor(private readonly prisma: PrismaService) {}

  async generate(articleId: string, opts: { format?: 'horizontal' | 'vertical' } = {}): Promise<VideoResult> {
    const format = opts.format ?? 'vertical';
    const articleRaw = await this.prisma.article.findUniqueOrThrow({ where: { id: articleId } });
    const article: any = articleRaw;

    // Audio ve hero gerekli
    const fm: any = article.frontmatter ?? {};
    const audioUrl: string | undefined = fm.audio_url;
    const heroImageUrl: string | undefined = article.heroImageUrl ?? fm.hero_image;

    if (!audioUrl) {
      return { ok: false, error: 'Audio yok — once /audio endpoint ile TTS uret' };
    }

    const outDir = path.join(process.cwd(), 'public', 'blog', article.slug);
    await fs.mkdir(outDir, { recursive: true });

    // Audio path resolve (lokal mi, URL mi?)
    let audioPath = audioUrl;
    if (audioUrl.startsWith('/')) {
      audioPath = path.join(process.cwd(), 'public', audioUrl.replace(/^\//, ''));
    } else if (audioUrl.startsWith('http')) {
      // Remote audio — indir
      const tmpAudio = path.join(outDir, 'tts-tmp.mp3');
      try {
        const res = await fetch(audioUrl);
        if (!res.ok) throw new Error(`Audio fetch ${res.status}`);
        await fs.writeFile(tmpAudio, Buffer.from(await res.arrayBuffer()));
        audioPath = tmpAudio;
      } catch (err: any) {
        return { ok: false, error: `Audio fetch fail: ${err.message}` };
      }
    }

    // Hero gorsel path
    let imagePath = heroImageUrl ?? '';
    if (!imagePath) {
      // Fallback: solid renkli arkaplan
      imagePath = await this.generateFallbackImage(outDir, article.title, format);
    } else if (imagePath.startsWith('/')) {
      imagePath = path.join(process.cwd(), 'public', imagePath.replace(/^\//, ''));
    } else if (imagePath.startsWith('http')) {
      const tmpImage = path.join(outDir, 'hero-tmp.png');
      try {
        const res = await fetch(imagePath);
        if (!res.ok) throw new Error(`Image fetch ${res.status}`);
        await fs.writeFile(tmpImage, Buffer.from(await res.arrayBuffer()));
        imagePath = tmpImage;
      } catch (err: any) {
        // Fallback'e duser
        imagePath = await this.generateFallbackImage(outDir, article.title, format);
      }
    }

    // FFmpeg ile birlestir
    const outFile = path.join(outDir, `video-${format}.mp4`);
    const dim = format === 'vertical' ? '1080:1920' : '1920:1080';

    const ffmpegOk = await this.runFfmpeg([
      '-y',                                         // overwrite
      '-loop', '1', '-i', imagePath,                 // gorsel loop
      '-i', audioPath,                               // audio
      '-c:v', 'libx264',                             // h.264 codec
      '-tune', 'stillimage',                         // statik gorsel optimize
      '-c:a', 'aac', '-b:a', '192k',                 // AAC audio
      '-vf', `scale=${dim}:force_original_aspect_ratio=decrease,pad=${dim}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`,
      '-shortest',                                   // audio bitince video bitsin
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',                     // streaming optimize
      outFile,
    ]);

    if (!ffmpegOk) {
      return { ok: false, error: 'ffmpeg uretim basarisiz — sistemde ffmpeg kurulu mu?' };
    }

    const stat = await fs.stat(outFile).catch(() => null);
    if (!stat) return { ok: false, error: 'Video dosyasi bulunamadi' };

    const publicUrl = `/blog/${article.slug}/video-${format}.mp4`;
    const durationSec = Math.round(stat.size / 25_000); // kabaca

    this.log.log(`[${article.id}] Video uretildi: ${(stat.size / 1024 / 1024).toFixed(1)} MB, ${format}, ${publicUrl}`);

    return {
      ok: true,
      videoPath: outFile,
      publicUrl,
      format,
      durationSec,
      bytes: stat.size,
    };
  }

  /**
   * YouTube auto-publish — ffmpeg ile uretilmiş MP4'u YouTube'a yukler.
   * Env: YOUTUBE_REFRESH_TOKEN gerekli.
   */
  async uploadToYouTube(articleId: string, videoPath: string): Promise<{ ok: boolean; videoId?: string; url?: string; error?: string }> {
    const refresh = process.env.YOUTUBE_REFRESH_TOKEN;
    const clientId = process.env.YOUTUBE_CLIENT_ID;
    const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
    if (!refresh || !clientId || !clientSecret) {
      return { ok: false, error: 'YOUTUBE_REFRESH_TOKEN/CLIENT_ID/CLIENT_SECRET env yok' };
    }

    try {
      // 1) Access token al
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refresh,
          grant_type: 'refresh_token',
        }),
      });
      if (!tokenRes.ok) throw new Error(`Token ${tokenRes.status}`);
      const tokenData = await tokenRes.json() as any;
      const accessToken = tokenData.access_token;

      // 2) Article meta
      const articleRaw = await this.prisma.article.findUniqueOrThrow({ where: { id: articleId } });
      const article: any = articleRaw;

      // 3) Resumable upload init
      const meta = {
        snippet: {
          title: article.title.slice(0, 100),
          description: (article.metaDescription ?? '').slice(0, 5000) + `\n\nTam makale: ${article.site?.url ?? ''}/blog/${article.slug}.html`,
          tags: [article.category, 'LuviAI', 'AI içerik'].filter(Boolean),
          categoryId: '22', // People & Blogs
        },
        status: { privacyStatus: 'public', selfDeclaredMadeForKids: false },
      };

      const initRes = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(meta),
      });
      if (!initRes.ok) throw new Error(`Init ${initRes.status}: ${await initRes.text()}`);
      const uploadUrl = initRes.headers.get('Location');
      if (!uploadUrl) throw new Error('Upload URL yok');

      // 4) Video bytes upload
      const buffer = await fs.readFile(videoPath);
      const uploadRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'video/mp4',
        },
        body: buffer as any,
      });
      if (!uploadRes.ok) throw new Error(`Upload ${uploadRes.status}: ${await uploadRes.text()}`);
      const uploadData = await uploadRes.json() as any;

      const videoId = uploadData.id;
      this.log.log(`[${articleId}] YouTube upload OK: ${videoId}`);
      return { ok: true, videoId, url: `https://youtube.com/watch?v=${videoId}` };
    } catch (err: any) {
      this.log.error(`YouTube upload fail: ${err.message}`);
      return { ok: false, error: err.message };
    }
  }

  // ────────────────────────────────────────────────────────────
  //  Yardimcilar
  // ────────────────────────────────────────────────────────────
  private runFfmpeg(args: string[]): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn('ffmpeg', args, { stdio: 'pipe' });
      let stderr = '';
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.on('close', (code) => {
        if (code !== 0) {
          this.log.warn(`ffmpeg exit ${code}: ${stderr.slice(-500)}`);
          resolve(false);
        } else {
          resolve(true);
        }
      });
      proc.on('error', (err) => {
        this.log.warn(`ffmpeg spawn error: ${err.message}`);
        resolve(false);
      });
    });
  }

  /**
   * Hero gorsel yoksa solid renkli baslikli bir png uret.
   * Sharp ile basit bir text overlay.
   */
  private async generateFallbackImage(outDir: string, title: string, format: 'horizontal' | 'vertical'): Promise<string> {
    const w = format === 'vertical' ? 1080 : 1920;
    const h = format === 'vertical' ? 1920 : 1080;
    const outPath = path.join(outDir, 'fallback-thumb.png');

    try {
      const sharp = await import('sharp');
      const svg = `
<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#6c5ce7"/>
      <stop offset="100%" style="stop-color:#a29bfe"/>
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  <text x="${w / 2}" y="${h / 2}" font-family="Arial, sans-serif" font-size="${Math.floor(w / 25)}" font-weight="bold" fill="white" text-anchor="middle" dominant-baseline="middle">
    ${this.xmlEscape(title.slice(0, 60))}
  </text>
</svg>`;
      await sharp.default(Buffer.from(svg)).png().toFile(outPath);
      return outPath;
    } catch (err: any) {
      this.log.warn(`Fallback image fail: ${err.message}`);
      return '';
    }
  }

  private xmlEscape(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}
