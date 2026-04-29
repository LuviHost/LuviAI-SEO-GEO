import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export interface IgUploadResult {
  ok: boolean;
  mediaId?: string;
  permalink?: string;
  error?: string;
}

/**
 * Instagram Reels — Graph API ile vertical MP4 yayini.
 *
 * Env: INSTAGRAM_ACCESS_TOKEN, INSTAGRAM_BUSINESS_ID
 *
 * Akış:
 *   1. POST /{ig_id}/media (video_url + media_type=REELS) -> creation_id
 *   2. GET /{creation_id}?fields=status_code (FINISHED bekle)
 *   3. POST /{ig_id}/media_publish (creation_id) -> media_id
 *
 * Video URL public erisimli olmali (LuviAI public/blog/<slug>/video-vertical.mp4).
 */
@Injectable()
export class InstagramPublisherService {
  private readonly log = new Logger(InstagramPublisherService.name);
  private readonly accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  private readonly businessId = process.env.INSTAGRAM_BUSINESS_ID;

  constructor(private readonly prisma: PrismaService) {}

  async uploadReel(articleId: string, publicVideoUrl: string, caption?: string): Promise<IgUploadResult> {
    if (!this.accessToken || !this.businessId) {
      return { ok: false, error: 'INSTAGRAM_ACCESS_TOKEN/BUSINESS_ID env yok' };
    }

    try {
      const articleRaw = await this.prisma.article.findUniqueOrThrow({ where: { id: articleId } });
      const article: any = articleRaw;
      const text = caption ?? `${article.title}\n\nDetaylar: ${article.metaDescription ?? ''}\n\n#LuviAI #${(article.category ?? 'icerik').replace(/\s+/g, '')}`;

      // 1) Container
      const initUrl = new URL(`https://graph.facebook.com/v21.0/${this.businessId}/media`);
      initUrl.searchParams.set('media_type', 'REELS');
      initUrl.searchParams.set('video_url', publicVideoUrl);
      initUrl.searchParams.set('caption', text.slice(0, 2200));
      initUrl.searchParams.set('access_token', this.accessToken);

      const initRes = await fetch(initUrl.toString(), { method: 'POST' });
      if (!initRes.ok) throw new Error(`Init ${initRes.status}: ${(await initRes.text()).slice(0, 200)}`);
      const initData = await initRes.json() as any;
      const creationId = initData.id;
      if (!creationId) throw new Error('creation_id yok');

      // 2) Status poll (max 30 saniye)
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const stRes = await fetch(`https://graph.facebook.com/v21.0/${creationId}?fields=status_code&access_token=${this.accessToken}`);
        const st = await stRes.json() as any;
        if (st.status_code === 'FINISHED') break;
        if (st.status_code === 'ERROR') throw new Error('Container processing error');
      }

      // 3) Publish
      const pubRes = await fetch(
        `https://graph.facebook.com/v21.0/${this.businessId}/media_publish?creation_id=${creationId}&access_token=${this.accessToken}`,
        { method: 'POST' }
      );
      if (!pubRes.ok) throw new Error(`Publish ${pubRes.status}: ${(await pubRes.text()).slice(0, 200)}`);
      const pubData = await pubRes.json() as any;
      const mediaId = pubData.id;

      this.log.log(`[${articleId}] Instagram Reel upload OK: ${mediaId}`);
      return {
        ok: true,
        mediaId,
        permalink: `https://instagram.com/reel/${mediaId}`,
      };
    } catch (err: any) {
      this.log.error(`Instagram upload fail: ${err.message}`);
      return { ok: false, error: err.message };
    }
  }
}
