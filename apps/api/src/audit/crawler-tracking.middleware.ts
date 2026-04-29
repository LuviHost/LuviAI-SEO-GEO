import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { PrismaService } from '../prisma/prisma.service.js';

const BOT_REGISTRY: Record<string, RegExp> = {
  'GPTBot': /GPTBot/i,
  'OAI-SearchBot': /OAI-SearchBot/i,
  'ChatGPT-User': /ChatGPT-User/i,
  'ClaudeBot': /ClaudeBot/i,
  'Claude-Web': /Claude-Web/i,
  'PerplexityBot': /PerplexityBot/i,
  'Perplexity-User': /Perplexity-User/i,
  'Google-Extended': /Google-Extended/i,
  'Googlebot': /Googlebot[^-]/i,
  'Bingbot': /Bingbot/i,
  'Applebot': /Applebot[^-]/i,
  'Applebot-Extended': /Applebot-Extended/i,
  'Bytespider': /Bytespider/i,
  'Amazonbot': /Amazonbot/i,
  'CCBot': /CCBot/i,
  'YouBot': /YouBot/i,
  'cohere-ai': /cohere-ai/i,
  'DuckAssistBot': /DuckAssistBot/i,
  'Meta-ExternalAgent': /Meta-ExternalAgent/i,
  'Mistral': /Mistral/i,
  'DeepSeek': /DeepSeek/i,
};

interface BufferedHit {
  siteId: string;
  bot: string;
  url: string;
  status: number;
  bytes: number;
  timestamp: Date;
}

/**
 * Crawler Tracking Middleware — her API request'te User-Agent'a bakar,
 * AI bot ise hafizada buffer'a yazar. Her 60 saniyede bir DB'ye flush eder.
 *
 * Public site requestleri icin kullanim: reverse proxy (nginx) tarafindan
 * gelen request'leri gormek istersek site sahibinin proxy log'unu da
 * relay edebiliriz. MVP: API endpoint'i sahip oldugunda direkt yazar.
 *
 * Pratik: kullanicinin sitesinin onunde LuviAI proxy ya da CDN servisi
 * yoksa middleware sadece dashboard request'lerini gorur. Real-time icin
 * site sahibinin <script src="/luviai-tracker.js"> embed etmesi gerekir.
 */
@Injectable()
export class CrawlerTrackingMiddleware implements NestMiddleware {
  private static buffer: BufferedHit[] = [];
  private static flushTimer: NodeJS.Timeout | null = null;
  private readonly log = new Logger(CrawlerTrackingMiddleware.name);

  constructor(private readonly prisma: PrismaService) {
    if (!CrawlerTrackingMiddleware.flushTimer) {
      CrawlerTrackingMiddleware.flushTimer = setInterval(() => this.flush(), 60_000);
    }
  }

  use(req: Request, res: Response, next: NextFunction) {
    const ua = (req.headers['user-agent'] ?? '') as string;
    const matchedBot = this.detectBot(ua);

    if (matchedBot) {
      // Tracker beacon endpoint'inden gelen request mi?
      const siteId = (req.query.site as string) ?? (req.params.siteId as string);
      if (siteId) {
        const url = (req.query.url as string) ?? req.originalUrl;
        const status = parseInt((req.query.status as string) ?? '200', 10);
        const bytes = parseInt((req.query.bytes as string) ?? '0', 10);

        CrawlerTrackingMiddleware.buffer.push({
          siteId,
          bot: matchedBot,
          url: url.slice(0, 500),
          status,
          bytes,
          timestamp: new Date(),
        });

        // Buffer sismasin
        if (CrawlerTrackingMiddleware.buffer.length > 1000) {
          this.flush().catch(() => {});
        }
      }
    }

    next();
  }

  private detectBot(ua: string): string | null {
    for (const [name, re] of Object.entries(BOT_REGISTRY)) {
      if (re.test(ua)) return name;
    }
    return null;
  }

  private async flush(): Promise<void> {
    if (CrawlerTrackingMiddleware.buffer.length === 0) return;

    const items = CrawlerTrackingMiddleware.buffer.splice(0);
    // Group by siteId × date × bot
    const grouped = new Map<string, BufferedHit[]>();
    for (const h of items) {
      const date = new Date(h.timestamp);
      date.setHours(0, 0, 0, 0);
      const key = `${h.siteId}|${date.toISOString()}|${h.bot}`;
      const list = grouped.get(key) ?? [];
      list.push(h);
      grouped.set(key, list);
    }

    for (const [key, group] of grouped) {
      const [siteId, dateStr, bot] = key.split('|');
      const date = new Date(dateStr);

      const hits = group.length;
      const uniqueUrls = new Set(group.map((g) => g.url)).size;
      const status2xx = group.filter((g) => g.status >= 200 && g.status < 300).length;
      const status4xx = group.filter((g) => g.status >= 400 && g.status < 500).length;
      const status5xx = group.filter((g) => g.status >= 500).length;
      const bytesServed = group.reduce((a, g) => a + g.bytes, 0);

      const urlCounts = new Map<string, number>();
      for (const g of group) urlCounts.set(g.url, (urlCounts.get(g.url) ?? 0) + 1);
      const topUrls = [...urlCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([url, count]) => ({ url, count }));

      try {
        await this.prisma.aiCrawlerHit.upsert({
          where: { siteId_date_bot: { siteId, date, bot } },
          update: {
            hits: { increment: hits } as any,
            uniqueUrls,
            topUrls: topUrls as any,
            status2xx: { increment: status2xx } as any,
            status4xx: { increment: status4xx } as any,
            status5xx: { increment: status5xx } as any,
            bytesServed: { increment: bytesServed } as any,
          },
          create: {
            siteId, date, bot,
            hits, uniqueUrls,
            topUrls: topUrls as any,
            status2xx, status4xx, status5xx, bytesServed,
          },
        });
      } catch (err: any) {
        this.log.warn(`Flush fail ${key}: ${err.message}`);
      }
    }

    this.log.log(`Crawler buffer flush: ${items.length} hit -> ${grouped.size} group`);
  }
}
