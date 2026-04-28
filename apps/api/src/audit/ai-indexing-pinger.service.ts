import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * AI Indexing Pinger — yeni makale yayinlandiginda anlik bildirim gonderir:
 *  - IndexNow (Bing/Yandex/Seznam/Naver)
 *  - Google Indexing API (env'de service account varsa)
 *  - Sitemap ping
 *
 * AI sistemleri (OpenAI Atlas, Anthropic crawler, Perplexity) henuz public
 * indexing endpoint sunmuyor; ama IndexNow + Bing kanali (which feeds ChatGPT)
 * dolayli olarak AI search'a yansiyor.
 */
@Injectable()
export class AiIndexingPingerService {
  private readonly log = new Logger(AiIndexingPingerService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Bir URL icin tum kanallari ping at. Hatalar yutulur — best-effort.
   */
  async pingUrl(siteId: string, url: string): Promise<{ indexnow: boolean; google: boolean; bing: boolean }> {
    const result = { indexnow: false, google: false, bing: false };

    await Promise.all([
      this.pingIndexNow(url).then((ok) => (result.indexnow = ok)).catch(() => {}),
      this.pingGoogleIndexing(url).then((ok) => (result.google = ok)).catch(() => {}),
      this.pingBing(siteId, url).then((ok) => (result.bing = ok)).catch(() => {}),
    ]);

    this.log.log(`[${siteId}] Index ping ${url}: indexnow=${result.indexnow}, google=${result.google}, bing=${result.bing}`);
    return result;
  }

  /**
   * IndexNow — Bing, Yandex, Seznam, Naver tek API'den.
   * Bing kanalindan ChatGPT Search'e yansir.
   */
  private async pingIndexNow(url: string): Promise<boolean> {
    const key = process.env.INDEXNOW_KEY;
    if (!key) return false;
    try {
      const host = new URL(url).hostname;
      const res = await fetch('https://api.indexnow.org/IndexNow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          key,
          urlList: [url],
        }),
        signal: AbortSignal.timeout(10000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Google Indexing API — JWT service account ile.
   * Env: GOOGLE_INDEXING_SA_JSON (base64 encoded service account)
   */
  private async pingGoogleIndexing(url: string): Promise<boolean> {
    const saJson = process.env.GOOGLE_INDEXING_SA_JSON;
    if (!saJson) return false;
    try {
      // Lazy: GoogleAuth ile JWT olustur
      const { GoogleAuth } = await import('google-auth-library').catch(() => ({} as any));
      if (!GoogleAuth) return false;

      const credentials = JSON.parse(Buffer.from(saJson, 'base64').toString('utf8'));
      const auth = new GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/indexing'],
      });
      const client = await auth.getClient();
      const tokenResp = await client.getAccessToken();
      const token = typeof tokenResp === 'string' ? tokenResp : tokenResp.token;
      if (!token) return false;

      const res = await fetch('https://indexing.googleapis.com/v3/urlNotifications:publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          url,
          type: 'URL_UPDATED',
        }),
        signal: AbortSignal.timeout(10000),
      });
      return res.ok;
    } catch (err: any) {
      this.log.warn(`Google Indexing ping fail: ${err.message}`);
      return false;
    }
  }

  /**
   * Bing webmaster ping (klasik sitemap endpoint).
   */
  private async pingBing(siteId: string, url: string): Promise<boolean> {
    try {
      const sitemapUrl = `${new URL(url).origin}/sitemap.xml`;
      const res = await fetch(`https://www.bing.com/ping?sitemap=${encodeURIComponent(sitemapUrl)}`, {
        signal: AbortSignal.timeout(8000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
