import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { WebhookNotifierService } from './webhook-notifier.service.js';
import { findCrawlerErrorTriggers } from './crawler-error-rate.js';

/**
 * Bot hata-orani alarmi — 6 saatte bir (worker CRAWLER_ERROR_ALARM).
 *
 * Son 2 gunun AiCrawlerHit satirlarindan "bu bot hata aliyor ama digerleri
 * 2xx aliyor" durumunu bulur; gunde bot basina TEK bildirim (kvStore kilidi,
 * live-crawler notifyCiteFetch deseni). Veri zaten toplaniyordu, uyari yoktu.
 * Vaka: IRS.gov, Ağu 2026 — insanlara acik site, botlara kapali; bir ayda
 * tum siralamalar gitti.
 */
@Injectable()
export class CrawlerErrorAlarmService {
  private readonly log = new Logger(CrawlerErrorAlarmService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly webhook: WebhookNotifierService,
  ) {}

  async scanAndAlert(): Promise<{ sites: number; alerts: number }> {
    const since = new Date(Date.now() - 2 * 86_400_000);
    since.setUTCHours(0, 0, 0, 0);
    const sites = await this.prisma.site.findMany({
      where: { status: { in: ['ACTIVE', 'AUDIT_COMPLETE'] as any[] } },
      select: { id: true, userId: true, name: true },
    });

    let alerts = 0;
    for (const site of sites) {
      try {
        const rows = await this.prisma.aiCrawlerHit.findMany({
          where: { siteId: site.id, date: { gte: since } },
          select: { bot: true, date: true, hits: true, status2xx: true, status4xx: true, status5xx: true },
        });
        if (rows.length === 0) continue;
        const triggers = findCrawlerErrorTriggers(
          rows.map((r) => ({ ...r, date: r.date.toISOString().slice(0, 10) })),
        );
        for (const t of triggers) {
          if (await this.alreadyNotified(site.id, t.bot)) continue;
          const pct = Math.round(t.errorRate * 100);
          const title = `⚠️ ${t.bot} sitene ulaşamıyor (%${pct} hata)`;
          const body =
            `${site.name}: son 48 saatte ${t.bot} ${t.hits} istekte ${t.errors} ${t.kind === 'server_error' ? '5xx' : '4xx'} aldı; ` +
            `${t.healthyBots.join(', ')} ise 2xx alıyor — yani site ayakta ama bu bota özel bir engel/katman var ` +
            `(WAF, bot koruması, UA kuralı). Google/AI görünürlüğü bu sürerken erir; Cloudflare/WAF kurallarını ve robots.txt'i kontrol et.`;
          await this.notifications.create({
            userId: site.userId,
            type: 'SYSTEM',
            title,
            body,
            link: `/sites/${site.id}/crawler-live`,
          });
          this.webhook.notify({
            siteId: site.id,
            siteName: site.name,
            event: 'crawler_error_spike',
            title,
            message: body,
            url: `/sites/${site.id}/crawler-live`,
          } as any).catch?.(() => undefined);
          alerts++;
        }
      } catch (err: any) {
        this.log.warn(`[${site.id}] crawler error alarm fail: ${err.message}`);
      }
    }
    if (alerts > 0) this.log.log(`Crawler hata alarmi: ${sites.length} site, ${alerts} bildirim`);
    return { sites: sites.length, alerts };
  }

  /** Gunde bot basina tek bildirim — kvStore unique key kilidi */
  private async alreadyNotified(siteId: string, bot: string): Promise<boolean> {
    const stamp = new Date().toISOString().slice(0, 10);
    try {
      await this.prisma.kvStore.create({
        data: { key: `crawler-err:${siteId}:${bot}:${stamp}`, value: '1', expiresAt: new Date(Date.now() + 3 * 86_400_000) },
      });
      return false;
    } catch {
      return true;
    }
  }
}
