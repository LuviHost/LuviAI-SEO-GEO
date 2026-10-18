import { Injectable, Logger } from '@nestjs/common';
import { Agent, request } from 'undici';
import { PrismaService } from '../prisma/prisma.service.js';
import { assertPublicUrl, guardedConnectOptions, isBlockedAddress, RANKSUP_BOT_UA } from '../common/safe-fetch.js';

/**
 * Webhook adresini kullanici yazar. Korumasiz fetch ile
 * http://169.254.169.254/... ya da http://localhost:3001/... girilirse sunucu
 * ic aga POST atiyor, test ucu da yanitin ilk 100 karakterini kullaniciya
 * geri donduruyordu (SSRF). safeFetchText yalniz GET/HEAD bildigi icin ayni
 * korumanin yapi taslari burada: http/https + 80/443 + yazili ozel IP yok
 * (assertPublicUrl), alan adi BAGLANTI ANINDA cozulup denetlenir (DNS
 * rebinding acigi yok), yonlendirme izlenmez — Slack/Discord webhook'lari
 * yonlendirmez; izlenseydi genel bir adres ic aga yonlendirebilirdi.
 *
 * Bu ajan main.ts'in genel (IPv4'e sabit) dagiticisini kullanmaz; IPv4
 * sabitlemesi guardedConnectOptions ile burada da uygulanir (SAFE_FETCH_IPV4_ONLY).
 */
const WEBHOOK_TIMEOUT_MS = 8_000;
const webhookAgent = new Agent({
  connect: guardedConnectOptions(isBlockedAddress, { timeoutMs: WEBHOOK_TIMEOUT_MS }),
  headersTimeout: WEBHOOK_TIMEOUT_MS,
  bodyTimeout: WEBHOOK_TIMEOUT_MS,
});

/** Hata govdesinin basi — kullaniciya 100 karakter gosteriliyor, tamamini indirmeye gerek yok */
async function readHead(body: AsyncIterable<unknown>, maxBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of body) {
      const buf = Buffer.from(chunk as Uint8Array);
      chunks.push(buf);
      size += buf.length;
      if (size >= maxBytes) break;
    }
  } catch { /* govde okunamadi — durum kodu yeter */ }
  return Buffer.concat(chunks).subarray(0, maxBytes).toString('utf8');
}

function isBlockedAddressError(err: any): boolean {
  return err?.code === 'EBLOCKEDADDR' || err?.cause?.code === 'EBLOCKEDADDR' || /ENGELLI_ADRES/.test(String(err?.message));
}

export type NotifyEvent =
  | 'article_published'
  | 'ai_citation_drop'
  | 'ai_citation_rise'
  | 'crawler_first_visit'   // GPTBot/ClaudeBot ilk kez geldi
  | 'ai_referrer_first'     // ChatGPT/Perplexity'den ilk tıklama
  | 'cite_fetch'            // ChatGPT-User canli sayfa cekti — cevapta kullanildin
  | 'autopilot_summary'
  | 'stuck_page_detected'
  | 'stuck_page_recovered'
  | 'crawler_error_spike';  // bir bot 4xx/5xx alirken digerleri 2xx — bot-ozel engel

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
    let target: URL;
    try {
      target = assertPublicUrl(site.notifyWebhookUrl);
    } catch {
      return { ok: false, error: 'Webhook adresi geçersiz ya da iç ağa çıkıyor; yalnızca herkese açık http/https adresleri (80/443) kullanılabilir.' };
    }
    try {
      const body = kind === 'discord'
        ? this.buildDiscord(payload)
        : this.buildSlack(payload);

      const res = await request(target, {
        method: 'POST',
        dispatcher: webhookAgent,
        maxRedirections: 0,
        headers: { 'content-type': 'application/json', 'user-agent': RANKSUP_BOT_UA },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      });

      if (res.statusCode < 200 || res.statusCode >= 300) {
        const text = await readHead(res.body, 1024);
        return { ok: false, error: `${res.statusCode}: ${text.slice(0, 100)}` };
      }
      await res.body.dump().catch(() => {});
      this.log.log(`[${payload.siteId}] Webhook ${kind} OK: ${payload.event}`);
      return { ok: true };
    } catch (err: any) {
      const error = isBlockedAddressError(err)
        ? 'Webhook adresi iç ağa ya da özel bir IP adresine çözülüyor; güvenlik nedeniyle gönderilmedi.'
        : err.message;
      this.log.warn(`Webhook fail: ${error}`);
      return { ok: false, error };
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
      title: '✅ RanksUp Webhook Test',
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
      crawler_error_spike: '⚠️',
    } as any)[p.event] ?? 'ℹ';

    return {
      text: `${emoji} *${p.title}*\n${p.message}${p.url ? `\n<${p.url}|Detay →>` : ''}`,
      attachments: [{
        color: p.event === 'ai_citation_drop' ? 'danger' : p.event === 'crawler_error_spike' ? 'warning' : p.event === 'ai_citation_rise' ? 'good' : '#6c5ce7',
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
      crawler_error_spike: 0xf59e0b,
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
