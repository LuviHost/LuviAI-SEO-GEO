import { Body, Controller, Get, HttpException, HttpStatus, Logger, Post, Query, Req, Res } from '@nestjs/common';
import { MeasurementAllowanceService } from '../billing/measurement-allowance.service.js';
import type { Request, Response } from 'express';
import { Public } from '../auth/public.decorator.js';
import { PublicCitationService, type PublicCheckResult } from './public-citation.service.js';
import { PublicCitationSubscriberService } from './public-citation-subscriber.service.js';
import { QuotaService } from '../billing/quota.service.js';
import { clientIp } from '../common/client-ip.js';
import {
  AttemptWindow,
  isMobileAppClient,
  SUBSCRIBE_IP_LIMIT,
  SUBSCRIBE_IP_LIMIT_MESSAGE,
  SUBSCRIBE_IP_LIMIT_STRICT,
  SUBSCRIBE_WELCOME_PER_EMAIL,
  SUBSCRIBE_WELCOME_PER_EMAIL_STRICT,
} from './public-subscribe-limits.js';

interface PublicCheckBody {
  domain: string;
  /**
   * Cloudflare Turnstile token (env-gated — TURNSTILE_SECRET set ise zorunlu;
   * mobil uygulama istisnasi siki sinirla: check() notu)
   */
  turnstileToken?: string;
}

interface SubscribeBody {
  email: string;
  domain: string;
  /**
   * Istemcinin gordugu marka — en fazla 80 karakter. Kayda ve e-postaya
   * YAZILMAZ: marka alan adinin son kontrol kaydindan okunur (servis).
   */
  brand?: string;
  niche?: string;
  customNiche?: string;
  locale?: string;
  consent: boolean;
  /**
   * Cloudflare Turnstile token — TURNSTILE_SECRET tanimliysa zorunlu (mobil
   * uygulama istisnasi: subscribe() notu). Token tek kullanimliktir; check()
   * icin alinan token burada yeniden kullanilamaz.
   */
  turnstileToken?: string;
}

/** Turnstile dogrulamasi tutmadiginda istemciye giden metin (check ve subscribe). */
export const TURNSTILE_FAILED_MESSAGE = 'İnsan doğrulaması başarısız. Sayfayı yenileyip tekrar deneyin.';

/**
 * E-postadaki onay / abonelikten cikma linki basarisiz olunca web adresine
 * giden SABIT kod. Eskiden err.message URL'e yaziliyordu: servisin Turkce
 * metni, beklenmedik hatada Prisma/ag ayrintisi tarayici gecmisine, referer
 * basliklarina ve analitige sizabiliyordu. Gercek hata yalniz loglanir.
 *
 *   invalid_token — link gecersiz ya da kullanilmis (servis 404)
 *   inactive      — abonelik artik aktif degil (onay: iptal/bounce, servis 400)
 *   unknown       — beklenmedik hata
 *
 * Tokenlar suresiz (public-citation-subscriber.service.ts); "expired" diye bir
 * durum olmadigi icin kod da yok.
 */
export type SubscriptionLinkErrorCode = 'invalid_token' | 'inactive' | 'unknown';

export function subscriptionLinkErrorCode(err: unknown): SubscriptionLinkErrorCode {
  const status = Number((err as { status?: unknown } | null)?.status);
  if (status === 404) return 'invalid_token';
  if (status === 400) return 'inactive';
  return 'unknown';
}

/**
 * Beklenmedik (status'suz) hatada istemciye giden SABIT metin. Ic hata metni
 * (Prisma, saglayici govdesi, ag/IP ayrintisi) cevaba yazilmaz, yalniz loglanir.
 */
export const PUBLIC_CHECK_FAILED_MESSAGE = 'Kontrol şu an tamamlanamadı, lütfen biraz sonra tekrar deneyin.';

/**
 * Turnstile token'i olmadan gelen MOBIL UYGULAMA kontrolunun IP basina 7
 * gunluk farkli alan adi siniri (normal kademe PUBLIC_CITATION_IP_WEEKLY_LIMIT,
 * varsayilan 1; genel sinir 2'nin altindayken o gecerlidir). Urun parametresi — olculmus bir esik degil: mesru kullanici
 * kendi sitesini ve bir rakibini dener; taklitci daha az hak alir. Genel sinir
 * daha dusuk ayarlanirsa o gecerlidir (public-citation.service.ts effectiveIpLimit).
 */
export const PUBLIC_CHECK_IP_LIMIT_STRICT = 2;

/** Ayni IP'den token'siz mobil kontrol zaten surerken gelen ikinci istege giden metin (429). */
export const PUBLIC_CHECK_IN_FLIGHT_MESSAGE = 'Bu ağdan başlatılan bir kontrol hâlâ sürüyor. Bitmesini bekleyip tekrar deneyin.';

/**
 * Landing page — anonim AI citation checker
 *
 *   POST /api/v1/public/citation-check
 *   Body: { domain: "kobipratik.com", turnstileToken?: "..." }
 *
 * Abuse koruma katmanlari:
 *   1. UA bot blok (curl, python-requests, scrapy, bot/spider)
 *   2. Cloudflare Turnstile verify (env'de TURNSTILE_SECRET varsa) — mobil
 *      uygulama istisnasi ve siki sinir: check() notu
 *   3. PublicCitationService icindeki IP rate limit + 24h cache
 */
@Controller('public')
export class PublicCitationController {
  private readonly log = new Logger(PublicCitationController.name);
  /** Abonelik denemeleri — IP basina 24 saatlik kayan pencere (public-subscribe-limits.ts) */
  private readonly subscribeAttempts = new AttemptWindow(24 * 60 * 60 * 1000);
  /**
   * Token'siz mobil kontrolu suren IP'ler (surec belleginde). IP siniri
   * veritabanindaki kayitlardan sayilir ve kayit olcum BITINCE yazilir; ayni
   * IP'den paralel gonderilen istekler hepsi "henuz 0 alan adi" gorup sinirdan
   * gecerdi. Token'li istekte her istek ayri, tek kullanimlik Turnstile cozumu
   * ister; token'siz yolda bu kilit ayni IP'yi bir anda tek kontrole indirir.
   */
  private readonly mobileChecksInFlight = new Set<string>();

  constructor(
    private readonly citation: PublicCitationService,
    private readonly subscribers: PublicCitationSubscriberService,
    private readonly quota: QuotaService,
    private readonly measurement: MeasurementAllowanceService,
  ) {}

  /**
   * MOBIL UYGULAMA YOLU (subscribe() ile ayni kural): TURNSTILE_SECRET
   * tanimliyken token'siz istek 403 alir; uygulama Turnstile'i ancak bir
   * WebView ile calistirabilir — Cloudflare: "For native mobile applications,
   * Turnstile does not run natively. Instead, you use a WebView" (18.10.2026'da
   * dogrulandi: https://developers.cloudflare.com/turnstile/get-started/mobile-implementation/).
   * Bu yuzden User-Agent'inda `RanksUp-iOS/<rakam>` ya da `RanksUp-Android/<rakam>`
   * olan ve token GONDERMEYEN istek kabul edilir AMA siki kademeyle: IP basina
   * 7 gunde PUBLIC_CHECK_IP_LIMIT_STRICT farkli alan adi; genel sinir (varsayilan 1) daha dar.
   *
   * DIKKAT — User-Agent istemcinin kendi yazdigi basliktir, TAKLIT EDILEBILIR.
   * Bu bir kimlik dogrulamasi ya da guvenlik siniri DEGIL; Turnstile
   * calistiramayan uygulama icin hiz sinirli bir geri dusus. UA'yi taklit eden
   * Turnstile'i atlar ama daha az hak alir (sayim veritabanindan, onbellekten
   * donus sayilmaz). Ayni IP'den token'siz kontrol bir anda tek: paralel
   * istekle sinir yarisi kazanilamaz (mobileChecksInFlight). Kalan risk: cok
   * sayida IP'den dagitik kullanim — her IP siki kademeyle sinirli. Token
   * gonderen her istemci (mobil dahil) dogrulanir ve normal kademeye girer;
   * gecersiz token 403'tur.
   */
  @Public()
  @Post('citation-check')
  async check(@Req() req: Request, @Body() body: PublicCheckBody): Promise<PublicCheckResult> {
    // 1) Bot UA blok
    const uaRaw = (req.headers['user-agent'] ?? '').toString();
    if (this.isObviousBot(uaRaw.toLowerCase())) {
      throw new HttpException('Bot tespit edildi', HttpStatus.FORBIDDEN);
    }

    // 2) Turnstile (env-gated); token'siz mobil uygulama siki kademeyle gecer
    const ip = clientIp(req);
    const token = typeof body?.turnstileToken === 'string' && body.turnstileToken.trim() ? body.turnstileToken : undefined;
    const turnstileSecret = process.env.TURNSTILE_SECRET;
    const mobileWithoutToken = !!turnstileSecret && !token && isMobileAppClient(uaRaw);
    if (turnstileSecret && !mobileWithoutToken) {
      const ok = await this.verifyTurnstile(token, ip, turnstileSecret);
      if (!ok) throw new HttpException(TURNSTILE_FAILED_MESSAGE, HttpStatus.FORBIDDEN);
    }

    // 3) Domain validate (servis kendi normalize eder)
    if (!body?.domain || typeof body.domain !== 'string') {
      throw new HttpException('domain alani gerekli', HttpStatus.BAD_REQUEST);
    }

    const inFlightKey = ip || 'unknown';
    if (mobileWithoutToken) {
      if (this.mobileChecksInFlight.has(inFlightKey)) {
        throw new HttpException(PUBLIC_CHECK_IN_FLIGHT_MESSAGE, HttpStatus.TOO_MANY_REQUESTS);
      }
      this.mobileChecksInFlight.add(inFlightKey);
    }
    try {
      return await this.citation.check(
        body.domain,
        ip,
        'manual',
        mobileWithoutToken ? { ipDailyLimit: PUBLIC_CHECK_IP_LIMIT_STRICT } : {},
      );
    } catch (err: any) {
      // Alan adi hatalari (IP, port, ic ag, cozulemeyen ad) servisten Turkce
      // 400 olarak gelir ve oldugu gibi iletilir.
      if (err.status) throw err;
      // Kimlik dogrulamasiz uc: ic hata metni (Prisma, saglayici, ag) istemciye
      // SIZMAZ — yalnizca loglanir.
      this.log.warn(`Public check fail (${String(body.domain).slice(0, 200)}): ${err.message}`);
      throw new HttpException(PUBLIC_CHECK_FAILED_MESSAGE, HttpStatus.INTERNAL_SERVER_ERROR);
    } finally {
      if (mobileWithoutToken) this.mobileChecksInFlight.delete(inFlightKey);
    }
  }

  @Public()
  @Post('citation-check/rate-limit')
  async rateLimit(@Req() req: Request): Promise<{ ok: boolean; remaining: number; resetIn?: string }> {
    // Kalan hak, check()'in uygulayacagi kademeyle ayni olsun: Turnstile
    // tanimliyken mobil uygulama (token gondermiyor) siki kademededir.
    const ua = (req.headers['user-agent'] ?? '').toString();
    const strict = !!process.env.TURNSTILE_SECRET && isMobileAppClient(ua);
    return this.citation.checkRateLimit(clientIp(req), strict ? PUBLIC_CHECK_IP_LIMIT_STRICT : undefined);
  }

  /**
   * POST /api/v1/public/citation-check/unlock — teaser kilidini acar.
   *
   * @Public DEGIL: giris yapmis kullanici gerekir. Landing'deki teaser 10
   * sorudan yalnizca 2'sini olcer; burasi kalan sorulari da olcer (uye
   * kademesi → Opus 5) ve tam raporu doner.
   *
   * Kotaya tabidir (plan basina aylik citationTests): aksi halde tek hesapla
   * sinirsiz domain acilabilirdi.
   */
  @Post('citation-check/unlock')
  async unlock(@Req() req: Request, @Body() body: { domain?: string }): Promise<PublicCheckResult> {
    const user = (req as any).user as
      | { id: string; role?: string; subscriptionStatus?: string; plan?: string }
      | undefined;
    if (!user?.id) throw new HttpException('Giris gerekli', HttpStatus.UNAUTHORIZED);
    if (!body?.domain || typeof body.domain !== 'string') {
      throw new HttpException('domain alani gerekli', HttpStatus.BAD_REQUEST);
    }

    // ODEME KAPISI — kilit "giris yapmis olmakla" degil SATIN ALMAYLA acilir.
    // Yalnizca giris sarti olsaydi teaser'in satisa itme islevi kalmazdi:
    // herkes ucretsiz hesap acip tam raporu alirdi. subscriptionStatus'un
    // ACTIVE olmasi = PayTR odemesi tamamlanmis demek; TRIAL (kayit olmus
    // ama odememis) BURADA GECMEZ.
    const isAdmin = user.role === 'ADMIN';
    const hasPaid = user.subscriptionStatus === 'ACTIVE';
    if (!isAdmin && !hasPaid) {
      throw new HttpException(
        {
          statusCode: HttpStatus.PAYMENT_REQUIRED,
          code: 'PAYMENT_REQUIRED',
          message: 'Tam raporu acmak icin bir plan satin almalisin.',
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

    await this.quota.enforceCitationQuota(user.id);
    try {
      // Haftalik AI olcum hakki — odeme kapisindan SONRA: odememis kullanici
      // 402 (satin al) gormeli, 429 degil. Onbellekten donus olcum sayilmaz.
      const domain = body.domain;
      const result = await this.measurement.run(user, () => this.citation.check(domain, clientIp(req), 'signup_baseline'));
      // Cache'ten donduyse yeni olcum YAPILMADI — kota dusulmez. Aksi halde
      // sayfayi yenilemek her seferinde hak yakardi.
      if (!result.fromCache) await this.quota.incrementCitationUsage(user.id);
      return result;
    } catch (err: any) {
      // Alan adi (400) ve haftalik olcum hakki (429) hatalari status'lu — oldugu gibi iletilir
      if (err?.status) throw err;
      // check() ile ayni kural: giris yapmis kullaniciya da ic hata metni
      // (Prisma, saglayici, ag) gitmez — gercek hata yalniz loglanir.
      this.log.warn(`Unlock fail (${String(body.domain).slice(0, 200)}): ${err?.message ?? err}`);
      throw new HttpException(PUBLIC_CHECK_FAILED_MESSAGE, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /** Domain icin son N snapshot — dashboard delta gosterimi icin */
  @Public()
  @Get('citation-check/history')
  async history(@Query('domain') domain: string, @Query('limit') limit?: string) {
    if (!domain) throw new HttpException('domain query param gerekli', HttpStatus.BAD_REQUEST);
    // Gecersiz limit (NaN) Prisma'ya take: NaN gidip 500 uretiyordu
    const n = parseInt(limit ?? '', 10);
    return this.citation.getHistory(domain, Number.isFinite(n) && n > 0 ? Math.min(50, n) : 12);
  }

  /**
   * Email-based retest abonelik baslat (double-opt-in).
   *
   * KIMLIK DOGRULAMASIZ UC — eskiden herkes herhangi bir adrese bizim
   * gondericimizden hos geldin e-postasi tetikleyebiliyordu. Katmanlar:
   *   1. Bariz bot User-Agent'i reddedilir (check() ile ayni).
   *   2. IP basina 24 saatte SUBSCRIBE_IP_LIMIT deneme (common/client-ip.ts IP'si).
   *   3. Turnstile: TURNSTILE_SECRET tanimliysa token zorunlu, check() ile ayni
   *      dogrulama. MOBIL ISTISNA: User-Agent'inda `RanksUp-iOS/` ya da
   *      `RanksUp-Android/` olan ve token GONDERMEYEN istek kabul edilir ama
   *      siki sinirla (IP basina 24 saatte SUBSCRIBE_IP_LIMIT_STRICT deneme,
   *      adres basina 24 saatte SUBSCRIBE_WELCOME_PER_EMAIL_STRICT onay
   *      e-postasi). Token gonderen her istemci (mobil dahil) dogrulanir.
   *   4. Servis: e-posta bicimi, alan adi kurali, son 7 gunde o alan adi icin
   *      kontrol kaydi sarti (marka/nis istemciden degil kayittan), adres basina
   *      24 saatlik onay e-postasi siniri, cift onay (confirm) akisi.
   */
  @Public()
  @Post('citation-check/subscribe')
  async subscribe(@Req() req: Request, @Body() body: SubscribeBody): Promise<{ ok: true; status: string; alreadyActive: boolean }> {
    const ua = (req.headers['user-agent'] ?? '').toString();
    if (this.isObviousBot(ua.toLowerCase())) {
      throw new HttpException('Bot tespit edildi', HttpStatus.FORBIDDEN);
    }
    if (!body?.consent) {
      throw new HttpException('Aboneligi onaylamak icin checkbox tikli olmali', HttpStatus.BAD_REQUEST);
    }

    const ip = clientIp(req);
    const token = typeof body.turnstileToken === 'string' && body.turnstileToken.trim() ? body.turnstileToken : undefined;
    const turnstileSecret = process.env.TURNSTILE_SECRET;
    const mobileWithoutToken = !!turnstileSecret && !token && isMobileAppClient(ua);

    if (!this.subscribeAttempts.take(ip || 'unknown', mobileWithoutToken ? SUBSCRIBE_IP_LIMIT_STRICT : SUBSCRIBE_IP_LIMIT)) {
      throw new HttpException(SUBSCRIBE_IP_LIMIT_MESSAGE, HttpStatus.TOO_MANY_REQUESTS);
    }
    if (turnstileSecret && !mobileWithoutToken) {
      const ok = await this.verifyTurnstile(token, ip, turnstileSecret);
      if (!ok) throw new HttpException(TURNSTILE_FAILED_MESSAGE, HttpStatus.FORBIDDEN);
    }

    return this.subscribers.subscribe(
      {
        email: body.email,
        domain: body.domain,
        brand: body.brand,
        locale: body.locale,
      },
      { welcomePerEmail: mobileWithoutToken ? SUBSCRIBE_WELCOME_PER_EMAIL_STRICT : SUBSCRIBE_WELCOME_PER_EMAIL },
    );
  }

  /** Double-opt-in confirm — welcome email'deki linkten gelir */
  @Public()
  @Get('citation-check/confirm')
  async confirm(@Query('token') token: string, @Res() res: Response) {
    if (!token) throw new HttpException('token gerekli', HttpStatus.BAD_REQUEST);
    try {
      const r = await this.subscribers.confirm(token);
      const webUrl = process.env.WEB_URL ?? 'https://ranksup.ai';
      return res.redirect(`${webUrl}/?citation_confirmed=${encodeURIComponent(r.domain)}`);
    } catch (err: any) {
      const webUrl = process.env.WEB_URL ?? 'https://ranksup.ai';
      const code = subscriptionLinkErrorCode(err);
      // Token loglanmaz (abonelik anahtari); yalniz kod + gercek hata metni
      this.log.warn(`Abonelik onayi basarisiz (${code}): ${String(err?.message ?? err).slice(0, 300)}`);
      return res.redirect(`${webUrl}/?citation_confirm_error=${code}`);
    }
  }

  /** Internal: OAuth signup callback'ten cagrilir, ziyaretci -> user attribution kur */
  @Public()
  @Post('citation-check/link-signup')
  async linkSignup(@Req() req: Request, @Body() body: { userId: string; email: string }) {
    const internalKey = req.headers['x-internal-key'];
    const expected = process.env.INTERNAL_API_KEY ?? process.env.NEXTAUTH_SECRET;
    if (!expected || internalKey !== expected) {
      throw new HttpException('forbidden', HttpStatus.FORBIDDEN);
    }
    if (!body?.userId || !body?.email) {
      throw new HttpException('userId + email gerekli', HttpStatus.BAD_REQUEST);
    }
    return this.subscribers.linkSignup(body.userId, body.email);
  }

  /** Aboneligi iptal — email'deki linkten gelir */
  @Public()
  @Get('citation-check/unsubscribe')
  async unsubscribe(@Query('token') token: string, @Res() res: Response) {
    if (!token) throw new HttpException('token gerekli', HttpStatus.BAD_REQUEST);
    try {
      const r = await this.subscribers.unsubscribe(token);
      const webUrl = process.env.WEB_URL ?? 'https://ranksup.ai';
      return res.redirect(`${webUrl}/?citation_unsubscribed=${encodeURIComponent(r.domain)}`);
    } catch (err: any) {
      const webUrl = process.env.WEB_URL ?? 'https://ranksup.ai';
      const code = subscriptionLinkErrorCode(err);
      this.log.warn(`Abonelikten cikma basarisiz (${code}): ${String(err?.message ?? err).slice(0, 300)}`);
      return res.redirect(`${webUrl}/?citation_unsubscribe_error=${code}`);
    }
  }

  // ──────────────────────────────────────
  //  HELPERS
  // ──────────────────────────────────────
  // Istemci IP'si common/client-ip.ts'ten: eski extractIp X-Forwarded-For'un
  // ILK adresini aliyordu — istemcinin kendi yazdigi deger; her istekte baska
  // bir IP yazilip IP limiti sifirlanabiliyordu.

  private isObviousBot(ua: string): boolean {
    if (!ua || ua.length < 5) return true;
    const botSignals = [
      'curl/', 'wget/', 'python-requests', 'scrapy', 'go-http-client',
      'bot', 'spider', 'crawler', 'gptbot', 'claude-web', 'perplexitybot',
      'lighthouse', 'pagespeed', 'headless',
    ];
    return botSignals.some((s) => ua.includes(s));
  }

  /** Cloudflare Turnstile siteverify endpoint */
  private async verifyTurnstile(token: string | undefined, ip: string, secret: string): Promise<boolean> {
    if (!token) return false;
    try {
      const form = new URLSearchParams();
      form.append('secret', secret);
      form.append('response', token);
      if (ip) form.append('remoteip', ip);
      const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      });
      const data = await res.json() as { success?: boolean };
      return !!data.success;
    } catch (err: any) {
      this.log.warn(`Turnstile verify fail: ${err.message}`);
      return false;
    }
  }
}
