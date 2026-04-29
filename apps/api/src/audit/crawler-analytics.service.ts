import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export interface CrawlerLogEntry {
  ip: string;
  userAgent: string;
  url: string;
  status: number;
  bytes: number;
  timestamp: Date;
}

export interface CrawlerSummary {
  bot: string;
  category: 'ai-search' | 'training' | 'classic-search' | 'social' | 'unknown';
  hits: number;
  uniqueUrls: number;
  topUrls: Array<{ url: string; count: number }>;
  status2xx: number;
  status4xx: number;
  status5xx: number;
  bytesServed: number;
}

const BOT_REGISTRY: Record<string, { match: RegExp; category: CrawlerSummary['category']; label: string }> = {
  'GPTBot': { match: /GPTBot/i, category: 'training', label: 'OpenAI GPTBot' },
  'OAI-SearchBot': { match: /OAI-SearchBot/i, category: 'ai-search', label: 'ChatGPT Search' },
  'ChatGPT-User': { match: /ChatGPT-User/i, category: 'ai-search', label: 'ChatGPT (user link)' },
  'ClaudeBot': { match: /ClaudeBot/i, category: 'training', label: 'Anthropic ClaudeBot' },
  'Claude-Web': { match: /Claude-Web/i, category: 'ai-search', label: 'Claude.ai' },
  'PerplexityBot': { match: /PerplexityBot/i, category: 'ai-search', label: 'Perplexity' },
  'Perplexity-User': { match: /Perplexity-User/i, category: 'ai-search', label: 'Perplexity (user)' },
  'Google-Extended': { match: /Google-Extended/i, category: 'training', label: 'Google Gemini training' },
  'Googlebot': { match: /Googlebot[^-]/i, category: 'classic-search', label: 'Googlebot' },
  'Bingbot': { match: /Bingbot/i, category: 'classic-search', label: 'Bingbot (Copilot)' },
  'Applebot': { match: /Applebot[^-]/i, category: 'classic-search', label: 'Applebot' },
  'Applebot-Extended': { match: /Applebot-Extended/i, category: 'training', label: 'Apple Intelligence training' },
  'Bytespider': { match: /Bytespider/i, category: 'ai-search', label: 'TikTok ByteDance' },
  'Amazonbot': { match: /Amazonbot/i, category: 'ai-search', label: 'Amazon Alexa+/Rufus' },
  'CCBot': { match: /CCBot/i, category: 'training', label: 'Common Crawl' },
  'YouBot': { match: /YouBot/i, category: 'ai-search', label: 'You.com' },
  'cohere-ai': { match: /cohere-ai/i, category: 'training', label: 'Cohere' },
  'DuckAssistBot': { match: /DuckAssistBot/i, category: 'ai-search', label: 'DuckDuckGo AI' },
  'Meta-ExternalAgent': { match: /Meta-ExternalAgent/i, category: 'ai-search', label: 'Meta AI' },
  'Mistral': { match: /Mistral/i, category: 'ai-search', label: 'Mistral Le Chat' },
  'DeepSeek': { match: /DeepSeek/i, category: 'training', label: 'DeepSeek' },
  'FacebookBot': { match: /FacebookBot|facebookexternalhit/i, category: 'social', label: 'Meta Link Preview' },
  'Twitterbot': { match: /Twitterbot/i, category: 'social', label: 'X/Twitter' },
  'LinkedInBot': { match: /LinkedInBot/i, category: 'social', label: 'LinkedIn' },
};

/**
 * Crawler Analytics — sunucu log dosyasini parse edip AI bot trafigini olcer.
 * Apache combined log format veya nginx default format'i destekler.
 *
 * Sunucu tarafinda:
 *   - Apache: /var/log/apache2/access.log
 *   - Nginx: /var/log/nginx/access.log
 *   - cPanel: /home/<user>/access-logs/<domain>
 *
 * MVP: Kullanici log dosyasinin son 1000 satirini upload eder, parse ederiz,
 * gunluk DB snapshot kaydederiz. Frontend trend grafigi cizer.
 */
@Injectable()
export class CrawlerAnalyticsService {
  private readonly log = new Logger(CrawlerAnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Apache combined log format parser:
   *   IP - - [date] "GET /url HTTP/1.1" status bytes "ref" "ua"
   */
  parseApacheLog(logContent: string): CrawlerLogEntry[] {
    const lines = logContent.split('\n').filter(l => l.trim().length > 0);
    const re = /^(\S+)\s+\S+\s+\S+\s+\[([^\]]+)\]\s+"(\S+)\s+(\S+)\s+\S+"\s+(\d+)\s+(\d+|-)\s+"[^"]*"\s+"([^"]*)"/;
    const entries: CrawlerLogEntry[] = [];

    for (const line of lines) {
      const m = line.match(re);
      if (!m) continue;
      const [, ip, dateStr, , url, status, bytes, ua] = m;
      try {
        entries.push({
          ip,
          userAgent: ua,
          url,
          status: parseInt(status, 10),
          bytes: bytes === '-' ? 0 : parseInt(bytes, 10),
          timestamp: new Date(dateStr.replace(':', ' ').replace(' +', '+')),
        });
      } catch {
        // skip malformed
      }
    }
    return entries;
  }

  /**
   * Log entries'i bot bazinda gruplayip ozet cikarir.
   */
  summarize(entries: CrawlerLogEntry[]): Map<string, CrawlerSummary> {
    const summary = new Map<string, CrawlerSummary>();

    for (const entry of entries) {
      const ua = entry.userAgent;
      let matchedBot: string | null = null;
      let category: CrawlerSummary['category'] = 'unknown';

      for (const [name, info] of Object.entries(BOT_REGISTRY)) {
        if (info.match.test(ua)) {
          matchedBot = name;
          category = info.category;
          break;
        }
      }
      if (!matchedBot) continue; // sadece bot trafigi

      let s = summary.get(matchedBot);
      if (!s) {
        s = {
          bot: matchedBot,
          category,
          hits: 0,
          uniqueUrls: 0,
          topUrls: [],
          status2xx: 0,
          status4xx: 0,
          status5xx: 0,
          bytesServed: 0,
        };
        summary.set(matchedBot, s);
      }

      s.hits++;
      s.bytesServed += entry.bytes;
      if (entry.status >= 200 && entry.status < 300) s.status2xx++;
      else if (entry.status >= 400 && entry.status < 500) s.status4xx++;
      else if (entry.status >= 500) s.status5xx++;
    }

    // Top URLs hesapla
    const urlCounts = new Map<string, Map<string, number>>();
    for (const entry of entries) {
      let bot: string | null = null;
      for (const [name, info] of Object.entries(BOT_REGISTRY)) {
        if (info.match.test(entry.userAgent)) { bot = name; break; }
      }
      if (!bot) continue;
      let urls = urlCounts.get(bot);
      if (!urls) { urls = new Map(); urlCounts.set(bot, urls); }
      urls.set(entry.url, (urls.get(entry.url) ?? 0) + 1);
    }
    for (const [bot, urls] of urlCounts) {
      const s = summary.get(bot);
      if (!s) continue;
      s.uniqueUrls = urls.size;
      s.topUrls = [...urls.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([url, count]) => ({ url, count }));
    }

    return summary;
  }

  /**
   * Site icin log content'i parse et + DB'ye yaz.
   */
  async ingestLog(siteId: string, logContent: string): Promise<{ entries: number; bots: number; saved: number }> {
    const entries = this.parseApacheLog(logContent);
    if (entries.length === 0) return { entries: 0, bots: 0, saved: 0 };

    // Tarih bazli grupla
    const byDate = new Map<string, CrawlerLogEntry[]>();
    for (const e of entries) {
      const d = e.timestamp.toISOString().slice(0, 10);
      const list = byDate.get(d) ?? [];
      list.push(e);
      byDate.set(d, list);
    }

    let saved = 0;
    let totalBots = 0;
    for (const [dateStr, dayEntries] of byDate) {
      const summary = this.summarize(dayEntries);
      totalBots = Math.max(totalBots, summary.size);
      const date = new Date(dateStr);

      for (const [bot, s] of summary) {
        try {
          await this.prisma.aiCrawlerHit.upsert({
            where: { siteId_date_bot: { siteId, date, bot } },
            update: {
              hits: s.hits,
              uniqueUrls: s.uniqueUrls,
              topUrls: s.topUrls as any,
              status2xx: s.status2xx,
              status4xx: s.status4xx,
              status5xx: s.status5xx,
              bytesServed: s.bytesServed,
            },
            create: {
              siteId,
              date,
              bot,
              hits: s.hits,
              uniqueUrls: s.uniqueUrls,
              topUrls: s.topUrls as any,
              status2xx: s.status2xx,
              status4xx: s.status4xx,
              status5xx: s.status5xx,
              bytesServed: s.bytesServed,
            },
          });
          saved++;
        } catch (err: any) {
          this.log.warn(`[${siteId}] Crawler hit kaydedilemedi: ${err.message}`);
        }
      }
    }

    this.log.log(`[${siteId}] Crawler log ingest: ${entries.length} satir, ${totalBots} bot, ${saved} snapshot`);
    return { entries: entries.length, bots: totalBots, saved };
  }

  /**
   * Frontend icin: son N gun crawler trafigi.
   */
  async getHistory(siteId: string, days = 30) {
    const since = new Date(Date.now() - days * 86400000);
    since.setHours(0, 0, 0, 0);

    const hits = await this.prisma.aiCrawlerHit.findMany({
      where: { siteId, date: { gte: since } },
      orderBy: { date: 'asc' },
    });

    // Kategoriye gore grupla
    const byCategory: Record<string, number> = {
      'ai-search': 0,
      'training': 0,
      'classic-search': 0,
      'social': 0,
    };
    const byBot: Record<string, number> = {};
    const byDate: Record<string, Record<string, number>> = {};

    for (const h of hits) {
      const info = BOT_REGISTRY[h.bot];
      if (info) byCategory[info.category] = (byCategory[info.category] ?? 0) + h.hits;
      byBot[h.bot] = (byBot[h.bot] ?? 0) + h.hits;
      const d = h.date.toISOString().slice(0, 10);
      byDate[d] = byDate[d] ?? {};
      byDate[d][h.bot] = (byDate[d][h.bot] ?? 0) + h.hits;
    }

    return {
      days,
      since: since.toISOString(),
      totalHits: hits.reduce((a, h) => a + h.hits, 0),
      byCategory,
      byBot,
      byDate,
      registry: Object.fromEntries(Object.entries(BOT_REGISTRY).map(([k, v]) => [k, { label: v.label, category: v.category }])),
    };
  }
}
