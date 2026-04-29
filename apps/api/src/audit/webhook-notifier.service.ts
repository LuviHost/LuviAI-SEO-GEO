import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export type NotifyEvent =
  | 'article_published'
  | 'ai_citation_drop'
  | 'ai_citation_rise'
  | 'crawler_first_visit'   // GPTBot/ClaudeBot ilk kez geldi
  | 'ai_referrer_first'     // ChatGPT/Perplexity'den ilk tıklama
  | 'autopilot_summary';

export interface NotifyPayload {
  siteId: string;
  siteName: string;
  event: NotifyEvent;
  title: string;
  message: string;
  url?: string;
  meta?: Record<string, any>;
}

/**
 * Webhook Notifier — Slack ve Discord incoming webhook'larina mesaj gonderir.
 *
 * Site sahibi panelden webhook URL'i kayitli ise (notifyWebhookUrl + kind),
 * bizim tetikleyici servisler (alarm, publisher, crawler middleware) bu
 * servise event yollar — Slack/Discord'a mesaj atar.
 */
@Injectable()
export class WebhookNotifierService {
  private readonly log = new Logger(WebhookNotifierService.name);

  constructor(private readonly prisma: PrismaService) {}

  async notify(payload: NotifyPayload): Promise<{ ok: boolean; error?: string }> {
    const site: any = await this.prisma.site.findUnique({ where: { id: payload.siteId } });
    if (!site || !site.notifyWebhookUrl) return { ok: false, error: 'Webhook tanımlı değil' };

    const kind = site.notifyWebhookKind ?? this.detectKind(site.notifyWebhookUrl);
    try {
      const body = kind === 'discord'
        ? this.buildDiscord(payload)
        : this.buildSlack(payload);

      const res = await fetch(site.notifyWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { ok: false, error: `${res.status}: ${text.slice(0, 100)}` };
      }
      this.log.log(`[${payload.siteId}] Webhook ${kind} OK: ${payload.event}`);
      return { ok: true };
    } catch (err: any) {
      this.log.warn(`Webhook fail: ${err.message}`);
      return { ok: false, error: err.message };
    }
  }

  /**
   * Test endpoint icin — kullanicinin webhook URL'ini test et.
   */
  async test(siteId: string): Promise<{ ok: boolean; error?: string }> {
    const site: any = await this.prisma.site.findUnique({ where: { id: siteId } });
    return this.notify({
      siteId,
      siteName: site?.name ?? 'Site',
      event: 'autopilot_summary',
      title: '✅ LuviAI Webhook Test',
      message: 'Webhook bağlantısı çalışıyor. AI olayları buraya gelecek.',
    });
  }

  private detectKind(url: string): 'slack' | 'discord' {
    if (/discord\.com\/api\/webhooks/i.test(url)) return 'discord';
    return 'slack';
  }

  private buildSlack(p: NotifyPayload): any {
    const emoji = ({
      article_published: '📝',
      ai_citation_drop: '⚠',
      ai_citation_rise: '🚀',
      crawler_first_visit: '🤖',
      ai_referrer_first: '🎯',
      autopilot_summary: 'ℹ',
    } as any)[p.event] ?? 'ℹ';

    return {
      text: `${emoji} *${p.title}*\n${p.message}${p.url ? `\n<${p.url}|Detay →>` : ''}`,
      attachments: [{
        color: p.event === 'ai_citation_drop' ? 'danger' : p.event === 'ai_citation_rise' ? 'good' : '#6c5ce7',
        fields: [
          { title: 'Site', value: p.siteName, short: true },
          { title: 'Event', value: p.event, short: true },
        ],
      }],
    };
  }

  private buildDiscord(p: NotifyPayload): any {
    const color = ({
      ai_citation_drop: 0xef4444,
      ai_citation_rise: 0x22c55e,
      article_published: 0x6c5ce7,
    } as any)[p.event] ?? 0x6c5ce7;

    return {
      embeds: [{
        title: p.title,
        description: p.message,
        color,
        url: p.url,
        author: { name: p.siteName },
        timestamp: new Date().toISOString(),
        fields: Object.entries(p.meta ?? {}).slice(0, 5).map(([name, value]) => ({
          name, value: String(value), inline: true,
        })),
      }],
    };
  }
}
