import { Body, Controller, Get, Header, Headers, Post, Query, Req, Res } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AiReferrerService } from './ai-referrer.service.js';
import { PersonaChatService } from './persona-chat.service.js';
import { LiveCrawlerService, type IngestEvent } from './live-crawler.service.js';
import { Public } from '../auth/public.decorator.js';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { INGEST_SIGNATURE_HEADER, INGEST_TIMESTAMP_HEADER } from './ingest-auth.js';

/**
 * Public tracker beacon — site sahibinin html'ine eklediği <script>
 * tag'i bu endpoint'e ping atar. User-Agent'a bakip AI bot tracking yapariz.
 *
 * Kullanim:
 *   <script async src="https://ranksup.ai/api/tracker.js?site=cmoj14...">
 *   </script>
 *
 * tracker.js icindeki kod:
 *   if (navigator.userAgent matches AI bot) -> beacon.gif?site=...&url=...
 *
 * Ya da daha pratik: nginx/Apache log'u her gece otomatik upload et
 * (cron job ile rsync / SCP), middleware o log'u parse etsin.
 */
/**
 * SkipThrottle: bu controller musteri sitelerine gomulu script'i ve her sayfa
 * goruntulemesinde atilan beacon'i sunar. Global 60 istek/dk limiti burada
 * mesru trafigi keserdi (tek bir yogun musteri sitesi veya proxy arkasindaki
 * ziyaretciler ayni IP'yi paylasir). Abuse korumasi beacon'in kendi
 * dogrulamasiyla yapilmali, genel IP limitiyle degil.
 */
/**
 * Ingest ucunun dakikalik istek tavani.
 *
 * Ortam degiskenine baglandi cunku e2e testi bu limiti GERCEKTEN asarak
 * "@SkipThrottle({default:false}) muafiyeti kaldiriyor mu" sorusunu
 * dogruluyor. 300 sabitken test her kosumda 400 ardisik HTTP istegi atmak
 * zorundaydi; makine mesgulken bu 2 dakikayi asip testi dusuruyordu
 * (iki kez yasandi). Testte limit kucultuluyor, davranis ayni kaliyor.
 *
 * Uretim varsayilani DEGISMEDI: 300/dk. Ingest bir batch ucu (tek istekte
 * 500 event), mesru bir edge kaynagi bu kadarina ihtiyac duymaz.
 */
const INGEST_RATE_LIMIT = Number(process.env.INGEST_RATE_LIMIT) > 0
  ? Number(process.env.INGEST_RATE_LIMIT)
  : 300;

@SkipThrottle()
@Controller()
export class TrackerController {
  constructor(
    private readonly aiReferrer: AiReferrerService,
    private readonly personaChat: PersonaChatService,
    private readonly liveCrawler: LiveCrawlerService,
  ) {}

  /**
   * POST /api/tracker/events — Live Crawler ingest (edge kaynaklari).
   * Cloudflare Worker / WordPress eklentisi / nginx ajani batch event yollar.
   *
   * @Public() KALIYOR: edge kaynagi kullanici oturumu tasiyamaz. Yerine istek
   * site bazli sirla HMAC-SHA256 imzalanir (X-RanksUp-Signature +
   * X-RanksUp-Timestamp) — dogrulama LiveCrawlerService.ingest icinde.
   *
   * SkipThrottle KALDIRILDI: sinif seviyesindeki muafiyet, imzasiz istekleri de
   * sinirsiz birakiyordu; yani gecersiz imzayla bile HMAC + DB sorgusu
   * tetiklenip ucuz bir CPU/DB tuketim vektoru aciliyordu. Ingest bir batch
   * ucudur (tek istekte 500 event), yani mesru bir edge kaynaginin dakikada
   * 300 isteğe ihtiyaci olmaz; bu limit gercek trafigi kesmez.
   */
  @Public()
  @SkipThrottle({ default: false })
  @Throttle({ default: { limit: INGEST_RATE_LIMIT, ttl: 60_000 } })
  @Post('tracker/events')
  async ingestEvents(
    @Body() body: { site?: string; source?: string; events?: IngestEvent[] },
    @Headers() headers: Record<string, string | undefined>,
    @Req() req: RawBodyRequest<Request>,
  ) {
    // Imza HAM govde uzerinden hesaplanir; parse edilmis nesneyi yeniden
    // JSON.stringify etmek (anahtar sirasi/bosluk farki) imzayi bozardi.
    const rawBody = req.rawBody ? req.rawBody.toString('utf8') : '';
    return this.liveCrawler.ingest(
      String(body?.site ?? ''),
      body?.events ?? [],
      body?.source,
      {
        signature: headers[INGEST_SIGNATURE_HEADER],
        timestamp: headers[INGEST_TIMESTAMP_HEADER],
        rawBody,
      },
    );
  }

  @Public()
  @Get('widget.js')
  @Header('Content-Type', 'application/javascript; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=3600')
  widgetScript(@Query('site') siteId: string, @Res() res: Response) {
    if (!siteId) {
      res.send('// RanksUp widget — site param missing');
      return;
    }
    res.send(this.personaChat.buildWidgetJs(siteId));
  }
  /**
   * GET /api/tracker.js — site sahibinin embed edecegi script
   */
  @Public()
  @Get('tracker.js')
  @Header('Content-Type', 'application/javascript; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=3600')
  trackerScript(@Query('site') siteId: string, @Res() res: Response) {
    if (!siteId) {
      res.send('// RanksUp tracker — site param missing');
      return;
    }
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'https://ranksup.ai';
    const js = `
(function(){
  var ua = navigator.userAgent || '';
  var botPatterns = /GPTBot|OAI-SearchBot|ChatGPT-User|ClaudeBot|Claude-Web|PerplexityBot|Google-Extended|Bytespider|Amazonbot|CCBot|YouBot|cohere-ai|DuckAssistBot|Meta-ExternalAgent|Mistral|DeepSeek/i;
  var aiReferrers = /chat\\.openai\\.com|chatgpt\\.com|perplexity\\.ai|claude\\.ai|gemini\\.google\\.com|bard\\.google\\.com|copilot\\.microsoft\\.com|you\\.com|phind\\.com|poe\\.com/i;

  var ref = document.referrer || '';
  var isBot = botPatterns.test(ua);
  var isAiReferrer = aiReferrers.test(ref);

  // Bot zaten gelmiş ya da AI'den yönlendirilmis kullanici — track et
  if (!isBot && !isAiReferrer) return;

  var img = new Image(1, 1);
  img.src = '${apiBase}/api/tracker/beacon?site=${siteId}&url=' +
    encodeURIComponent(location.href) +
    '&ref=' + encodeURIComponent(ref) +
    '&t=' + Date.now();
})();
    `.trim();
    res.send(js);
  }

  /**
   * GET /api/tracker/beacon — middleware tarafindan yakalanir, buffer'a yazilir.
   * Buradaki gorevi sadece transparent 1x1 GIF dondurmek.
   */
  @Public()
  @Get('tracker/beacon')
  @Header('Content-Type', 'image/gif')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate')
  async beacon(
    @Query('site') siteId: string,
    @Query('url') url: string,
    @Query('ref') ref: string,
    @Res() res: Response,
  ) {
    // AI referrer match ediyorsa kaydet (bot olmayan kullanici)
    if (siteId && ref) {
      this.aiReferrer.record(siteId, ref, url ?? '').catch(() => {});
    }

    // Transparent 1x1 GIF
    const gif = Buffer.from([
      0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00,
      0x01, 0x00, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00,
      0xff, 0xff, 0xff, 0x21, 0xf9, 0x04, 0x01, 0x00,
      0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00,
      0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44,
      0x01, 0x00, 0x3b,
    ]);
    res.send(gif);
  }
}
