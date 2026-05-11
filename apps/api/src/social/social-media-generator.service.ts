import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import path from 'node:path';
import fs from 'node:fs/promises';
import type { SocialChannelType } from '@prisma/client';
import { ImageGeneratorService } from '../articles/image-generator.service.js';
import { VideoGeneratorService } from '../articles/video-generator.service.js';
import { MediaGeneratorService } from '../articles/media-generator.service.js';
import {
  isMediaTypeAllowed,
  mediaDefaultFor,
  videoFormatFor,
  type MediaType,
} from './social-media-policy.js';

/**
 * Sosyal kanal tipine göre optimal görsel boyutu.
 *   IG square 1080x1080, IG story 1080x1920, X 1200x675, FB 1200x630,
 *   LinkedIn 1200x627, Pinterest 1000x1500, GMB 1200x900
 */
function imageSizeFor(channelType: SocialChannelType): { width: number; height: number } {
  switch (channelType) {
    case 'INSTAGRAM_BUSINESS': return { width: 1080, height: 1080 };
    case 'PINTEREST':          return { width: 1000, height: 1500 };
    case 'X_TWITTER':          return { width: 1200, height: 675  };
    case 'FACEBOOK_PAGE':      return { width: 1200, height: 630  };
    case 'LINKEDIN_PERSONAL':  return { width: 1200, height: 627  };
    case 'LINKEDIN_COMPANY':   return { width: 1200, height: 627  };
    case 'GMB':                return { width: 1200, height: 900  };
    case 'THREADS':
    case 'BLUESKY':
    case 'MASTODON':           return { width: 1080, height: 1080 };
    default:                   return { width: 1200, height: 675  };
  }
}

/**
 * Bir SocialPost için medya (image/video) üretir ve mediaUrls JSON'unu günceller.
 *
 * Akış:
 *   1. Post + article + channel yüklenir
 *   2. mediaType validate edilir (kanal'a izin verilen mi?)
 *   3. switch on mediaType:
 *        text  → mediaUrls = [] (sadece metin yayını)
 *        image → ImageGenerator.generate(article) → URL kaydet
 *        video → VideoGenerator.generate(article, format) → URL kaydet
 *   4. mediaUrls + metadata.mediaType + metadata.mediaGenStatus update
 *
 * Maliyet:
 *   - text: $0
 *   - image: ~$0.03 (Gemini Imagen)
 *   - video: TTS audio (~$0.001) + FFmpeg slideshow ($0)
 */
@Injectable()
export class SocialMediaGeneratorService {
  private readonly log = new Logger(SocialMediaGeneratorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly imageGen: ImageGeneratorService,
    private readonly videoGen: VideoGeneratorService,
    private readonly mediaGen: MediaGeneratorService,
  ) {}

  /**
   * Bir post için medya üretir. mediaType verilmezse mevcut olan (metadata'dan)
   * veya kanal default'u kullanılır.
   */
  async generateForPost(postId: string, requestedMediaType?: MediaType): Promise<{
    ok: boolean;
    mediaType: MediaType;
    mediaUrls: Array<{ url: string; type: 'image' | 'video'; altText?: string }>;
    error?: string;
  }> {
    const post = await this.prisma.socialPost.findUnique({
      where: { id: postId },
      include: { channel: true, article: true },
    });
    if (!post) throw new NotFoundException('Post bulunamadı');
    if (!post.article) {
      throw new BadRequestException('Bağımsız post (article yok) için otomatik medya üretilemez');
    }
    if (!post.channel.isActive) {
      throw new BadRequestException('Kanal aktif değil');
    }

    // mediaType resolve: requested > metadata > default
    const currentMeta = (post.metadata as any) ?? {};
    const mediaType: MediaType = requestedMediaType
      ?? currentMeta.mediaType
      ?? mediaDefaultFor(post.channel.type);

    if (!isMediaTypeAllowed(post.channel.type, mediaType)) {
      throw new BadRequestException(`${post.channel.type} kanalı için ${mediaType} medya tipi izinli değil`);
    }

    // Status: generating
    await this.prisma.socialPost.update({
      where: { id: postId },
      data: {
        metadata: { ...currentMeta, mediaType, mediaGenStatus: 'generating', mediaGenError: null },
      },
    });

    try {
      let mediaUrls: Array<{ url: string; type: 'image' | 'video'; altText?: string }> = [];

      if (mediaType === 'text') {
        // Sadece metin — eski medya'yı temizle
        mediaUrls = [];
      } else if (mediaType === 'image') {
        const url = await this.generateImageFor(post.article.id, post.channel.type);
        mediaUrls = [{ url, type: 'image', altText: post.article.title }];
      } else if (mediaType === 'video') {
        const url = await this.generateVideoFor(post.article.id, post.channel.type);
        mediaUrls = [{ url, type: 'video', altText: post.article.title }];
      }

      await this.prisma.socialPost.update({
        where: { id: postId },
        data: {
          mediaUrls: mediaUrls as any,
          metadata: { ...currentMeta, mediaType, mediaGenStatus: 'ready', mediaGenError: null, mediaGeneratedAt: new Date().toISOString() },
        },
      });

      this.log.log(`Post ${postId} medya üretildi: ${mediaType} (${mediaUrls.length} item)`);
      return { ok: true, mediaType, mediaUrls };
    } catch (err: any) {
      this.log.error(`Post ${postId} medya üretim hatası: ${err.message}`);
      await this.prisma.socialPost.update({
        where: { id: postId },
        data: {
          metadata: { ...currentMeta, mediaType, mediaGenStatus: 'error', mediaGenError: err.message },
        },
      });
      return { ok: false, mediaType, mediaUrls: [], error: err.message };
    }
  }

  /**
   * Article + channel.type için optimal boyutta görsel üretir.
   * Eğer aynı channel.type'a ait önceki post için üretilmiş bir görsel varsa onu reuse eder.
   */
  private async generateImageFor(
    articleId: string,
    channelType: SocialChannelType,
  ): Promise<string> {
    const article = await this.prisma.article.findUniqueOrThrow({ where: { id: articleId } });
    const size = imageSizeFor(channelType);
    const slug = article.slug || article.id;
    const outDir = path.join(process.cwd(), 'public', 'social', slug);
    await fs.mkdir(outDir, { recursive: true });
    const filename = `${channelType.toLowerCase()}-${Date.now()}.png`;
    const outputPath = path.join(outDir, filename);
    const publicUrl = `/social/${slug}/${filename}`;

    const prompt = [
      `Social media graphic for "${article.title}".`,
      article.metaDescription ? `Context: ${article.metaDescription.slice(0, 200)}.` : '',
      `Platform: ${channelType.replace(/_/g, ' ').toLowerCase()}.`,
      'No text, no logos, no people faces. Pure abstract/illustrative design.',
    ].filter(Boolean).join(' ');

    const result = await this.imageGen.generate({
      prompt,
      outputPath,
      width: size.width,
      height: size.height,
      type: 'hero',
    });

    if (!result.ok) {
      throw new Error(result.error ?? 'Image generator hata döndürdü');
    }
    return publicUrl;
  }

  /**
   * Article için FFmpeg slideshow video üretir.
   * TIKTOK/INSTAGRAM/YOUTUBE → vertical 1080x1920, diğerleri horizontal 1920x1080.
   * Audio yoksa otomatik TTS üretir, sonra video oluşturur.
   */
  private async generateVideoFor(
    articleId: string,
    channelType: SocialChannelType,
  ): Promise<string> {
    // 1) Audio kontrol — yoksa TTS üret
    const article = await this.prisma.article.findUniqueOrThrow({ where: { id: articleId } });
    const fm: any = article.frontmatter ?? {};
    if (!fm.audio_url) {
      this.log.log(`Article ${articleId} audio yok, TTS üretiliyor...`);
      const audioResult = await this.mediaGen.generateAudio(articleId);
      if (!audioResult.ok) {
        throw new Error(`TTS audio üretilemedi: ${audioResult.error ?? 'bilinmeyen hata'}`);
      }
      this.log.log(`Article ${articleId} TTS hazır ($${audioResult.costUsd.toFixed(4)})`);
    }

    // 2) Video gen
    const format = videoFormatFor(channelType);
    const result = await this.videoGen.generate(articleId, { format });
    if (!result.ok || !result.publicUrl) {
      throw new Error(result.error ?? 'Video generator URL döndürmedi');
    }
    return result.publicUrl;
  }
}
