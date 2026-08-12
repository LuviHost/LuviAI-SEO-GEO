import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { WebhookNotifierService } from './webhook-notifier.service.js';
import { acquireCronLock } from '../common/cron-lock.js';

/**
 * Live Crawler — istek bazli, gercek zamanli AI bot ziyaret hatti.
 *
 * Mevcut uc toplama yolunun (API middleware / JS beacon / manuel log) hicbiri
 * musterinin SITESINE gelen botlari canli goremiyordu: middleware yalnizca
 * RanksUp API'sini gorur, JS beacon'i botlar calistirmaz (GPTBot/ClaudeBot
 * JS yurutmez), log yapistirmak manueldir. Bu servis edge'den beslenir:
 *
 *   Cloudflare Worker / WordPress eklentisi / nginx ajani
 *     → POST /api/tracker/events (batch)
 *     → CrawlerHitEvent (ham satir, 60 gun) + AiCrawlerHit (gunluk toplam)
 *
 * CITE SINYALI: ChatGPT-User / Perplexity-User / Claude-User gibi on-demand
 * fetcher UA'lari, GERCEK bir kullanicinin AI sohbeti sirasinda sayfanin
 * canli cekildigini gosterir — "su anda bir cevapta kullanildin". Bunlar
 * isCiteFetch=true isaretlenir, gunun ilkinde bildirim + webhook atilir.
 */

/** UA deseni → kanonik bot adi. Middleware'dekiyle ayni cekirdek + on-demand UA'lar. */
export const LIVE_BOT_REGISTRY: Array<{ name: string; re: RegExp }> = [
  // On-demand fetcher'lar ONCE — "ChatGPT-User" UA'si "GPTBot" desenine de uyabilir
  { name: 'ChatGPT-User', re: /ChatGPT-User/i },
  { name: 'OAI-SearchBot', re: /OAI-SearchBot/i },
  { name: 'Perplexity-User', re: /Perplexity-User/i },
  { name: 'Claude-User', re: /Claude-User/i },
  { name: 'Claude-SearchBot', re: /Claude-SearchBot/i },
  { name: 'Claude-Web', re: /Claude-Web/i },
  { name: 'Meta-ExternalFetcher', re: /Meta-ExternalFetcher/i },
  { name: 'MistralAI-User', re: /MistralAI-User/i },
  // Crawler'lar
  { name: 'GPTBot', re: /GPTBot/i },
  { name: 'ClaudeBot', re: /ClaudeBot/i },
  { name: 'PerplexityBot', re: /PerplexityBot/i },
  { name: 'Google-Extended', re: /Google-Extended/i },
  { name: 'GoogleOther', re: /GoogleOther/i },
  { name: 'Googlebot', re: /Googlebot/i },
  { name: 'Bingbot', re: /bingbot/i },
  { name: 'Applebot-Extended', re: /Applebot-Extended/i },
  { name: 'Applebot', re: /Applebot/i },
  { name: 'Bytespider', re: /Bytespider/i },
  { name: 'Amazonbot', re: /Amazonbot/i },
  { name: 'CCBot', re: /CCBot/i },
  { name: 'YouBot', re: /YouBot/i },
  { name: 'cohere-ai', re: /cohere-ai/i },
  { name: 'DuckAssistBot', re: /DuckAssistBot/i },
  { name: 'Meta-ExternalAgent', re: /Meta-ExternalAgent/i },
  { name: 'Diffbot', re: /Diffbot/i },
  { name: 'AI2Bot', re: /AI2Bot/i },
  { name: 'Mistral', re: /Mistral/i },
  { name: 'DeepSeek', re: /DeepSeek/i },
  // SEO araclari — musteri gorumek isteyebilir (GPTtimize Ahrefs'i de gosteriyor)
  { name: 'AhrefsBot', re: /AhrefsBot/i },
  { name: 'SemrushBot', re: /SemrushBot/i },
];

/** On-demand fetcher = canli cite sinyali */
const CITE_FETCH_BOTS = new Set([
  'ChatGPT-User', 'OAI-SearchBot', 'Perplexity-User',
  'Claude-User', 'Claude-Web', 'Meta-ExternalFetcher', 'MistralAI-User',
]);

const MAX_BATCH = 500;
const DAILY_EVENT_CAP = 50_000; // site basina/gun — kacak worker DB'yi doldurmasin
const RETENTION_DAYS = 60;

export interface IngestEvent {
  ua?: string;
  bot?: string;
  path?: string;
  status?: number;
  ts?: string | number;
}

@Injectable()
export class LiveCrawlerService {
  private readonly log = new Logger(LiveCrawlerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly webhook: WebhookNotifierService,
  ) {}

  // ────────────────────────────────────────────────────────────
  //  INGEST — edge kaynaklarindan batch event
  // ────────────────────────────────────────────────────────────

  resolveBot(ua: string): string | null {
    if (!ua) return null;
    for (const { name, re } of LIVE_BOT_REGISTRY) {
      if (re.test(ua)) return name;
    }
    return null;
  }

  async ingest(siteId: string, events: IngestEvent[], source = 'worker'): Promise<{ accepted: number; skipped: number }> {
    if (!siteId || !Array.isArray(events) || events.length === 0) {
      throw new BadRequestException('site + events zorunlu');
    }
    const site = await this.prisma.site.findUnique({
      where: { id: siteId },
      select: { id: true, userId: true, name: true },
    });
    if (!site) throw new NotFoundException('Site bulunamadi');

    // Gunluk tavan — kacak/dongusel worker koruması
    const dayStart = new Date(new Date().toISOString().slice(0, 10));
    const todayCount = await this.prisma.crawlerHitEvent.count({
      where: { siteId, ts: { gte: dayStart } },
    });
    if (todayCount >= DAILY_EVENT_CAP) {
      return { accepted: 0, skipped: events.length };
    }

    const now = Date.now();
    const cleanSource = ['worker', 'wp', 'log', 'beacon'].includes(source) ? source : 'worker';
    const rows: Array<{
      siteId: string; ts: Date; bot: string; path: string;
      status: number; isCiteFetch: boolean; source: string;
    }> = [];

    for (const ev of events.slice(0, MAX_BATCH)) {
      const bot = (typeof ev.bot === 'string' && ev.bot.trim())
        ? this.normalizeBotName(ev.bot.trim())
        : this.resolveBot(String(ev.ua ?? ''));
      if (!bot) continue; // AI botu degil — kaydetme

      // Istemci ts'i yalnizca makul pencerede kabul et (saat kaymasi/injection)
      let ts = new Date();
      const raw = typeof ev.ts === 'number' ? ev.ts : Date.parse(String(ev.ts ?? ''));
      if (Number.isFinite(raw) && Math.abs(now - raw) < 10 * 60_000) ts = new Date(raw);

      const status = Number.isFinite(Number(ev.status)) ? Math.trunc(Number(ev.status)) : 200;
      rows.push({
        siteId,
        ts,
        bot,
        path: String(ev.path ?? '/').slice(0, 1000),
        status: Math.min(Math.max(status, 100), 599),
        isCiteFetch: CITE_FETCH_BOTS.has(bot),
        source: cleanSource,
      });
    }

    if (rows.length === 0) return { accepted: 0, skipped: events.length };

    const room = DAILY_EVENT_CAP - todayCount;
    const toInsert = rows.slice(0, Math.max(0, room));
    await this.prisma.crawlerHitEvent.createMany({ data: toInsert });

    // Gunluk AiCrawlerHit toplamlarini guncelle — mevcut grafikler/KPI bozulmasin
    this.updateDailyAggregates(siteId, toInsert).catch((err) =>
      this.log.warn(`[${siteId}] Gunluk aggregate guncellenemedi: ${err.message}`),
    );

    // Cite sinyali bildirimi (gunde 1, fire-and-forget)
    const cites = toInsert.filter((r) => r.isCiteFetch);
    if (cites.length > 0) {
      this.notifyCiteFetch(site, cites).catch((err) =>
        this.log.warn(`[${siteId}] Cite bildirimi gonderilemedi: ${err.message}`),
      );
    }

    return { accepted: toInsert.length, skipped: events.length - toInsert.length };
  }

  // ────────────────────────────────────────────────────────────
  //  CANLI AKIS — UI 5 sn'de bir ceker
  // ────────────────────────────────────────────────────────────

  async recent(siteId: string, opts: { minutes?: number; limit?: number } = {}) {
    const minutes = Math.min(Math.max(opts.minutes ?? 10, 1), 120);
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const since = new Date(Date.now() - minutes * 60_000);

    const [events, lastEvent, citeLast24h] = await Promise.all([
      this.prisma.crawlerHitEvent.findMany({
        where: { siteId, ts: { gte: since } },
        orderBy: { ts: 'desc' },
        take: limit,
        select: { id: true, ts: true, bot: true, path: true, status: true, isCiteFetch: true, source: true },
      }),
      this.prisma.crawlerHitEvent.findFirst({
        where: { siteId },
        orderBy: { ts: 'desc' },
        select: { ts: true, source: true },
      }),
      this.prisma.crawlerHitEvent.findMany({
        where: { siteId, isCiteFetch: true, ts: { gte: new Date(Date.now() - 24 * 3600_000) } },
        orderBy: { ts: 'desc' },
        take: 10,
        select: { ts: true, bot: true, path: true },
      }),
    ]);

    // Pencere icindeki bot sayaclari (limit'ten bagimsiz gercek toplam)
    const counts = await this.prisma.crawlerHitEvent.groupBy({
      by: ['bot'],
      where: { siteId, ts: { gte: since } },
      _count: { bot: true },
    });
    const byBot = counts
      .map((c) => ({ bot: c.bot, hits: c._count.bot }))
      .sort((a, b) => b.hits - a.hits);
    const total = byBot.reduce((a, b) => a + b.hits, 0);

    // "Worker Connected": son 10 dk icinde herhangi bir event
    const workerConnected = !!lastEvent && Date.now() - lastEvent.ts.getTime() < 10 * 60_000;

    return {
      windowMinutes: minutes,
      workerConnected,
      lastEventAt: lastEvent?.ts ?? null,
      lastEventSource: lastEvent?.source ?? null,
      total,
      byBot,
      events,
      citeFetches24h: citeLast24h,
    };
  }

  // ────────────────────────────────────────────────────────────
  //  KURULUM SNIPPET'LERI — Worker / WP / nginx
  // ────────────────────────────────────────────────────────────

  snippets(siteId: string) {
    const apiBase = (process.env.NEXT_PUBLIC_API_URL ?? 'https://ranksup.ai').replace(/\/+$/, '');
    const ingest = `${apiBase}/api/tracker/events`;
    const uaPattern = LIVE_BOT_REGISTRY.map((b) => b.re.source).join('|');

    const cloudflareWorker = `// RanksUp Live Crawler — Cloudflare Worker
// Kurulum: Cloudflare Dashboard → Workers & Pages → Create Worker →
// bu kodu yapistir → Deploy → siteni Worker Route ile bagla (ör. example.com/*)
const RANKSUP_INGEST = '${ingest}';
const SITE_ID = '${siteId}';
const AI_BOT = /${uaPattern}/i;

export default {
  async fetch(request, env, ctx) {
    const response = await fetch(request); // istegi normal isle — sifir gecikme
    const ua = request.headers.get('user-agent') || '';
    if (AI_BOT.test(ua)) {
      ctx.waitUntil(fetch(RANKSUP_INGEST, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          site: SITE_ID,
          source: 'worker',
          events: [{
            ua,
            path: new URL(request.url).pathname,
            status: response.status,
            ts: Date.now(),
          }],
        }),
      }).catch(() => {}));
    }
    return response;
  },
};`;

    const wordpress = `<?php
/**
 * Plugin Name: RanksUp Live Crawler
 * Description: AI bot ziyaretlerini (GPTBot, ClaudeBot, ChatGPT-User...) RanksUp'a anlik bildirir.
 * Version: 1.0
 */
add_action('template_redirect', function () {
  $ua = isset($_SERVER['HTTP_USER_AGENT']) ? $_SERVER['HTTP_USER_AGENT'] : '';
  if (!$ua || !preg_match('/${uaPattern.replace(/\//g, '\\/')}/i', $ua)) return;
  wp_remote_post('${ingest}', array(
    'timeout'  => 2,
    'blocking' => false, // ziyaretciyi bekletme
    'headers'  => array('Content-Type' => 'application/json'),
    'body'     => wp_json_encode(array(
      'site'   => '${siteId}',
      'source' => 'wp',
      'events' => array(array(
        'ua'     => $ua,
        'path'   => isset($_SERVER['REQUEST_URI']) ? strtok($_SERVER['REQUEST_URI'], '?') : '/',
        'status' => 200,
        'ts'     => round(microtime(true) * 1000),
      )),
    )),
  ));
});`;

    const nginx = `#!/usr/bin/env bash
# RanksUp Live Crawler — nginx access log ajani
# Kurulum: sunucuda calistir (systemd service veya screen/tmux icinde)
# Log formati: varsayilan "combined" beklenir.
INGEST='${ingest}'
SITE='${siteId}'
tail -F /var/log/nginx/access.log | while read -r line; do
  ua=$(echo "$line" | grep -oE '"[^"]*"$' | tr -d '"')
  echo "$ua" | grep -qiE '${uaPattern}' || continue
  path=$(echo "$line" | awk '{print $7}')
  status=$(echo "$line" | awk '{print $9}')
  curl -s -m 2 -X POST "$INGEST" -H 'Content-Type: application/json' \\
    -d "{\\"site\\":\\"$SITE\\",\\"source\\":\\"log\\",\\"events\\":[{\\"ua\\":\\"$ua\\",\\"path\\":\\"$path\\",\\"status\\":$status}]}" \\
    > /dev/null 2>&1 &
done`;

    return { ingestUrl: ingest, cloudflareWorker, wordpress, nginx };
  }

  // ────────────────────────────────────────────────────────────
  //  BAKIM + YARDIMCILAR
  // ────────────────────────────────────────────────────────────

  /** 60 gunden eski ham event'leri temizle — gunluk 03:40 UTC */
  @Cron('40 3 * * *')
  async purgeOld() {
    if (!(await acquireCronLock(this.prisma, 'crawler-event-purge', 'daily'))) return;
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000);
    const res = await this.prisma.crawlerHitEvent.deleteMany({ where: { ts: { lt: cutoff } } });
    if (res.count > 0) this.log.log(`Crawler event purge: ${res.count} satir silindi (<${cutoff.toISOString().slice(0, 10)})`);
  }

  private normalizeBotName(raw: string): string | null {
    // Edge ajani bot adini kendisi cozduyse yine de registry'e esle —
    // serbest metin bot adi enjeksiyonunu engeller
    const hit = LIVE_BOT_REGISTRY.find((b) => b.name.toLowerCase() === raw.toLowerCase() || b.re.test(raw));
    return hit?.name ?? null;
  }

  private async updateDailyAggregates(siteId: string, rows: Array<{ bot: string; ts: Date; status: number; path: string }>) {
    const byDateBot = new Map<string, { date: Date; bot: string; hits: number; s2xx: number; s4xx: number; s5xx: number }>();
    for (const r of rows) {
      const dateKey = r.ts.toISOString().slice(0, 10);
      const key = `${dateKey}|${r.bot}`;
      const cur = byDateBot.get(key) ?? { date: new Date(dateKey), bot: r.bot, hits: 0, s2xx: 0, s4xx: 0, s5xx: 0 };
      cur.hits++;
      if (r.status < 300) cur.s2xx++;
      else if (r.status >= 500) cur.s5xx++;
      else if (r.status >= 400) cur.s4xx++;
      byDateBot.set(key, cur);
    }
    for (const agg of byDateBot.values()) {
      await this.prisma.aiCrawlerHit.upsert({
        where: { siteId_date_bot: { siteId, date: agg.date, bot: agg.bot } },
        create: {
          siteId, date: agg.date, bot: agg.bot,
          hits: agg.hits, uniqueUrls: 0, topUrls: [],
          status2xx: agg.s2xx, status4xx: agg.s4xx, status5xx: agg.s5xx,
        },
        update: {
          hits: { increment: agg.hits },
          status2xx: { increment: agg.s2xx },
          status4xx: { increment: agg.s4xx },
          status5xx: { increment: agg.s5xx },
        },
      });
    }
  }

  /** Gunun ILK cite-fetch'inde bildirim + webhook (spam yok) */
  private async notifyCiteFetch(
    site: { id: string; userId: string; name: string },
    cites: Array<{ bot: string; path: string }>,
  ) {
    const stamp = new Date().toISOString().slice(0, 10);
    const lockKey = `cite-notif:${site.id}:${stamp}`;
    try {
      await this.prisma.kvStore.create({
        data: { key: lockKey, value: '1', expiresAt: new Date(Date.now() + 3 * 86_400_000) },
      });
    } catch {
      return; // bugun zaten bildirildi
    }

    const first = cites[0]!;
    const label = first.bot.replace('-User', '').replace('OAI-SearchBot', 'ChatGPT Search');
    const title = `🔥 ${label} az önce sayfanı bir cevap için okudu`;
    const body = `${site.name}: ${first.bot} → ${first.path}${cites.length > 1 ? ` (+${cites.length - 1} sayfa daha)` : ''}. Bu, gerçek bir kullanıcının AI sohbetinde içeriğinin canlı çekildiği anlamına gelir.`;

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
      event: 'cite_fetch',
      title,
      message: body,
    }).catch(() => { /* webhook opsiyonel */ });
  }
}
