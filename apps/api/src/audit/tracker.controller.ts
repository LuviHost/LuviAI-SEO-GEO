import { Controller, Get, Header, Param, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CrawlerTrackingMiddleware } from './crawler-tracking.middleware.js';
import { AiReferrerService } from './ai-referrer.service.js';
import { PersonaChatService } from './persona-chat.service.js';
import { Public } from '../auth/public.decorator.js';

/**
 * Public tracker beacon — site sahibinin html'ine eklediği <script>
 * tag'i bu endpoint'e ping atar. User-Agent'a bakip AI bot tracking yapariz.
 *
 * Kullanim:
 *   <script async src="https://ai.luvihost.com/api/tracker.js?site=cmoj14...">
 *   </script>
 *
 * tracker.js icindeki kod:
 *   if (navigator.userAgent matches AI bot) -> beacon.gif?site=...&url=...
 *
 * Ya da daha pratik: nginx/Apache log'u her gece otomatik upload et
 * (cron job ile rsync / SCP), middleware o log'u parse etsin.
 */
@Controller()
export class TrackerController {
  constructor(
    private readonly aiReferrer: AiReferrerService,
    private readonly personaChat: PersonaChatService,
  ) {}

  @Public()
  @Get('widget.js')
  @Header('Content-Type', 'application/javascript; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=3600')
  widgetScript(@Query('site') siteId: string, @Res() res: Response) {
    if (!siteId) {
      res.send('// LuviAI widget — site param missing');
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
      res.send('// LuviAI tracker — site param missing');
      return;
    }
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'https://ai.luvihost.com';
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
