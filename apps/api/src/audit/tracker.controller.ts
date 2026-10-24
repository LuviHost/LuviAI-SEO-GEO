import { Body, Controller, Get, Header, Headers, Post, Query, Req, Res } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AiReferrerService } from './ai-referrer.service.js';
import { PersonaChatService } from './persona-chat.service.js';
import { LiveCrawlerService, type IngestEvent } from './live-crawler.service.js';
import { Public } from '../auth/public.decorator.js';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { INGEST_SIGNATURE_HEADER, INGEST_TIMESTAMP_HEADER } from './ingest-auth.js';
import { trackerFilterData } from './ai-source.js';

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

/**
 * Sorgu parametresi yalniz duz metin olarak kabul edilir. Express'in qs
 * ayristiricisi `?site=a&site=b` girdisini diziye, `?site[x]=y` girdisini
 * nesneye cevirir; sunulan betige ya da kayda dize disi deger gitmesin.
 */
function queryText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * tracker.js govdesi. `site` istekten gelir ve sunulan betigin ICINE yazilir:
 * eskiden ham haliyle (`site=${siteId}`) tek tirnakli JS dizesine konuyordu;
 * `'` ya da satir sonu iceren bir deger dizeden cikip betige kod ekleyebilirdi
 * (yansitilan girdi). Simdi once encodeURIComponent (URL bileseni), sonra
 * JSON.stringify (gecerli JS dize sabiti) — deger her zaman veri kalir.
 */
/**
 * Betigi calistiran AI botu kullanici ajanlari. Google-Extended desende YOK: ayri bir HTTP
 * kullanici ajani yok, yalniz robots.txt belirteci
 * (https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers).
 * Beacon ucu da bunu kullanir: bot ziyareti AI'dan gelen insan ziyareti sayilmaz.
 */
export const TRACKER_BOT_PATTERN = /GPTBot|OAI-SearchBot|ChatGPT-User|ClaudeBot|Claude-Web|PerplexityBot|Bytespider|Amazonbot|CCBot|YouBot|cohere-ai|DuckAssistBot|Meta-ExternalAgent|Mistral|DeepSeek/i;

export function buildTrackerJs(siteId: string, apiBase: string): string {
  const beaconBase = `${apiBase}/api/tracker/beacon?site=${encodeURIComponent(siteId)}`;
  // AI kaynagi on suzgeci ai-source.ts'ten (sunucudaki siniflandirmayla ayni liste).
  // Eskiden referer METNINDE regex araniyordu (/you\.com/ "playyou.com"u da tutuyordu) ve
  // utm_source=chatgpt.com ile gelen, referer'siz ziyaretler hic beacon atmiyordu.
  return `
(function(){
  var ua = navigator.userAgent || '';
  var botPatterns = ${TRACKER_BOT_PATTERN.toString()};
  var AI = ${JSON.stringify(trackerFilterData())};

  var ref = document.referrer || '';
  var href = location.href || '';
  function parse(u) { try { return new URL(u); } catch (e) { return null; } }
  // Host tam eslesir ya da listedeki alan adinin alt alan adidir
  function aiRef(r) {
    var u = parse(r);
    if (!u) return false;
    var h = u.hostname.toLowerCase();
    for (var i = 0; i < AI.hosts.length; i++) {
      var d = AI.hosts[i][0], p = AI.hosts[i][1];
      if (h !== d && h.slice(-d.length - 1) !== '.' + d) continue;
      if (p && !new RegExp(p, 'i').test(u.pathname + u.search)) continue;
      return true;
    }
    return false;
  }
  // utm_source tam esitlikle (utm_source=chatgpt.com)
  function aiUtm(l) {
    var u = parse(l);
    if (!u) return false;
    var v = (u.searchParams.get('utm_source') || '').toLowerCase().replace(/^www\\./, '');
    return v !== '' && AI.utm.indexOf(v) !== -1;
  }
  var isBot = botPatterns.test(ua);
  var isAiReferrer = aiRef(ref) || aiUtm(href);

  // Bot zaten gelmiş ya da AI'den yönlendirilmis kullanici — track et
  if (!isBot && !isAiReferrer) return;

  // Ayni sekme oturumunda AI ziyareti BIR KEZ sayilir: utm etiketli inis sayfasi yenilenince
  // ya da geri donulunce yeniden sayilmasin. Depolama yoksa ya da firlatirsa (gizli mod,
  // engelli cerez) yine sayilir — eksik saymaktansa nadir cift sayim.
  if (!isBot) {
    try {
      if (sessionStorage.getItem('ranksup_ai_visit')) return;
      sessionStorage.setItem('ranksup_ai_visit', '1');
    } catch (e) {}
  }

  var img = new Image(1, 1);
  img.src = ${JSON.stringify(beaconBase)} +
    '&url=' + encodeURIComponent(location.href) +
    '&ref=' + encodeURIComponent(ref) +
    '&t=' + Date.now();
})();
    `.trim();
}

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
  widgetScript(@Query('site') rawSite: unknown, @Res() res: Response) {
    const siteId = queryText(rawSite);
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
  trackerScript(@Query('site') rawSite: unknown, @Res() res: Response) {
    const siteId = queryText(rawSite);
    if (!siteId) {
      res.send('// RanksUp tracker — site param missing');
      return;
    }
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'https://ranksup.ai';
    res.send(buildTrackerJs(siteId, apiBase));
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
    @Query('site') rawSite: unknown,
    @Query('url') rawUrl: unknown,
    @Query('ref') rawRef: unknown,
    @Res() res: Response,
    @Headers('user-agent') userAgent?: string,
  ) {
    const siteId = queryText(rawSite);
    const ref = queryText(rawRef);
    const url = queryText(rawUrl);
    // AI kaynagi (referer host'u ya da inis URL'inin utm_source'u) match ediyorsa kaydet.
    // Referer bos olabilir (ChatGPT uygulamasi + utm_source=chatgpt.com). Botun kendi
    // ziyareti insan trafigi sayilmaz — bot sayaci crawler-tracking.middleware'de.
    if (siteId && (ref || url) && !TRACKER_BOT_PATTERN.test(userAgent ?? '')) {
      this.aiReferrer.record(siteId, ref, url).catch(() => {});
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
