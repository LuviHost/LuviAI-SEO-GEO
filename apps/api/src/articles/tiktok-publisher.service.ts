import { Injectable, Logger } from '@nestjs/common';
import fs from 'node:fs/promises';
import { PrismaService } from '../prisma/prisma.service.js';

export interface TikTokUploadResult {
  ok: boolean;
  publishId?: string;
  shareUrl?: string;
  error?: string;
}

/**
 * TikTok Content Posting API — vertical MP4 upload.
 *
 * Env: TIKTOK_ACCESS_TOKEN (long-lived, 60 gun)
 *
 * 3 adim:
 *   1. Init: POST /v2/post/publish/inbox/video/init
 *   2. Upload: PUT to upload_url (chunked)
 *   3. Status check: GET /v2/post/publish/status/fetch
 */
@Injectable()
export class TiktokPublisherService {
  private readonly log = new Logger(TiktokPublisherService.name);
  private readonly accessToken = process.env.TIKTOK_ACCESS_TOKEN;

  async uploadVideo(articleId: string, videoPath: string): Promise<TikTokUploadResult> {
    if (!this.accessToken) {
      return { ok: false, error: 'TIKTOK_ACCESS_TOKEN env yok' };
    }

    try {
      const buffer = await fs.readFile(videoPath);
      const totalBytes = buffer.length;

      // 1) Upload init
      const initRes = await fetch('https://open.tiktokapis.com/v2/post/publish/inbox/video/init/', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          source_info: {
            source: 'FILE_UPLOAD',
            video_size: totalBytes,
            chunk_size: totalBytes,
            total_chunk_count: 1,
          },
        }),
      });
      if (!initRes.ok) throw new Error(`Init ${initRes.status}: ${(await initRes.text()).slice(0, 200)}`);
      const initData = await initRes.json() as any;
      const uploadUrl = initData?.data?.upload_url;
      const publishId = initData?.data?.publish_id;
      if (!uploadUrl || !publishId) throw new Error('Init response invalid');

      // 2) Upload bytes (single chunk, max ~64MB)
      const uploadRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Range': `bytes 0-${totalBytes - 1}/${totalBytes}`,
          'Content-Length': String(totalBytes),
        },
        body: buffer as any,
      });
      if (!uploadRes.ok) throw new Error(`Upload ${uploadRes.status}`);

      // 3) Status check (best effort)
      await new Promise((r) => setTimeout(r, 3000));
      const statusRes = await fetch('https://open.tiktokapis.com/v2/post/publish/status/fetch/', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ publish_id: publishId }),
      });
      const statusData = statusRes.ok ? await statusRes.json() as any : null;
      const shareUrl = statusData?.data?.share_url;

      this.log.log(`[${articleId}] TikTok upload OK: ${publishId}`);
      return { ok: true, publishId, shareUrl };
    } catch (err: any) {
      this.log.error(`TikTok upload fail: ${err.message}`);
      return { ok: false, error: err.message };
    }
  }
}
