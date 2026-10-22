import { Injectable, Logger, BadRequestException, ForbiddenException, Optional } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AffiliateService } from '../affiliate/affiliate.service.js';
import { EmailService } from '../email/email.service.js';
import { FxService } from './fx.service.js';
import { JobQueueService } from '../jobs/job-queue.service.js';
import { kickScheduledAfterUpgrade } from '../articles/scheduled-kick.js';
import { findPlan, PURCHASABLE_PLAN_IDS } from './plans.js';
import { cycleFromDescription, periodEndFromInvoice } from './subscription-period.js';
import { RENEWAL_MAX_ATTEMPTS } from './renewal-policy.js';
import { checkoutTestModeOn } from './checkout-mode.js';
import { capInvoiceDescription, failedInvoiceDescription } from './invoice-description.js';
import { hasEverPaid } from './ever-paid.js';
import { TRIAL_CANCEL_NOT_ALLOWED_MESSAGE } from './trial-policy.js';

/**
 * PayTR TEST MODU — satin alma yalniz yoneticiye acik.
 *
 * NEDEN: uretim PAYTR_TEST_MODE=1 ile calisiyordu. Test modunda PayTR odeme
 * sayfasi herkesce bilinen test kartini kendisi doldurur ve basarili bildirim
 * gonderir; markInvoicePaid de plani aciyordu. Yani deneme kullanicisi tek
 * kurus odemeden ucretli plan alabiliyordu. Dogrulanan PayTR davranisi
 * (dev.paytr.com, 18.10.2026):
 *  - iframe-api/iframe-api-1-adim: test_mode "Mağaza canlı modda iken test
 *    işlem yapmak için 1 olarak gönderilebilir" (0 veya 1).
 *  - direkt-api/test-kart-bilgileri: "iFrame API ödeme yönteminde test kart
 *    bilgileri otomatik olarak gelmektedir"; Direkt API icin test kartlari
 *    (4355 0843 5508 4358 vb.) sayfada acikca yayinli.
 *  - home/iframe-api-entegrasyon-sureci: iFrame test odemesinde "test kart
 *    bilgisinin tarafınızdan değiştirilmesine veya girilmesine ihtiyaç
 *    bulunmamaktadır" — yalniz "Ödeme Yap" ve 3D test sayfasinda "Gönder".
 *  - home/iframe-api-entegrasyon-sureci ve home/direkt-api-entegrasyon-sureci:
 *    gercek tahsilat ancak PayTR canli moda gecis talebini onaylayip SMS +
 *    e-postayla bildirdikten sonra baslar ("Alacağınız bildirimin ardından
 *    gerçek ödeme tahsilatına başlayabilirsiniz"). Test islemi para toplamaz.
 *  - iframe-api/iframe-api-2-adim: bildirimdeki test_mode "Mağazanız test
 *    modunda iken veya canlı modda yapılan test işlemlerde 1 olarak gönderilir".
 *    Yani PAYTR_TEST_MODE=0 olsa bile magaza henuz canliya alinmadiysa islem
 *    yine testtir; bildirim bunu kendisi soyler.
 *
 * Yonetici satin alabilir: PayTR canliya gecis icin basarili bir test odemesi
 * ister (ayni entegrasyon sureci sayfalari) — akisi uctan uca deneyen odur.
 */
export const CHECKOUT_TEST_MODE_MESSAGE =
  'Ödeme altyapısı şu an test modunda; satın alma henüz açık değil. Bilgi için bizimle iletişime geç.';
/** Fiyat sayfasinin Ingilizce surumu icin ayni metin */
export const CHECKOUT_TEST_MODE_MESSAGE_EN =
  'Our payment system is in test mode right now, so purchases are not open yet. Contact us for details.';
/** Reddedilen test odemesinin fatura aciklamasina eklenen neden (musteri fatura listesinde gorur) */
export const TEST_PAYMENT_FAILURE_CODE = 'TEST_MODE';
export const TEST_PAYMENT_FAILURE_REASON = 'Test modunda yapılan ödeme gerçek tahsilat değil; plan açılmadı';

/**
 * Satin alma durumu — GET /billing/plans (hesaptan bagimsiz) ve
 * GET /billing/users/:id/current (o hesaba gore) `checkout` alani. Gizli bilgi
 * tasimaz: yalniz acik/kapali, test modu bayragi ve gosterilecek metin.
 */
export interface CheckoutStatus {
  /** Bu hesap (ya da anonim ziyaretci) odeme baslatabilir mi */
  open: boolean;
  /** PayTR test modunda mi — odemeler gercek tahsilat degil */
  testMode: boolean;
  /** Kapaliyken gosterilecek metin (403 ile ayni); acikken null */
  message: string | null;
}

/**
 * PayTR iframe API + bildirim (webhook) entegrasyonu.
 * Docs: https://dev.paytr.com/iframe-api
 *
 * Akis:
 *  1. Kullanici plan secer → POST /api/billing/subscribe → createPaymentToken (test
 *     modunda yalniz yonetici; digerleri 403, assertCheckoutOpen)
 *  2. Frontend iframe adresiyle PayTR odeme sayfasini acar (otomatik yenileme acikken
 *     yerine Direkt API formu dogrudan PayTR'ye gider: createDirectCheckout)
 *  3. Kullanici odeme yapar; PayTR onu merchant_ok_url / merchant_fail_url'e yonlendirir
 *  4. PayTR → POST /api/billing/webhooks/paytr (billing.controller webhook → handleWebhook)
 *  5. Bildirimde fatura ve abonelik guncellenir (markInvoicePaid / markInvoiceFailed)
 *
 * Bildirim adresi PayTR'ye istekle GITMEZ: token isteginin parametreleri arasinda yok
 * (dev.paytr.com/iframe-api/iframe-api-1-adim); PayTR onu Magaza Paneli > Destek & Kurulum >
 * Ayarlar > Bildirim URL Ayarlari'ndan alir (iframe-api-2-adim; ikisi 2026-10-18'de okundu;
 * ayni yol bagimsiz bir PayTR modul kilavuzunda da yaziyor: docs.wisecp.com paytr-module,
 * 2026-10-19). Panelde tanimli olmasi gereken adres
 * https://api.ranksup.ai/api/billing/webhooks/paytr (@Controller('billing') +
 * @Post('webhooks/paytr'), main.ts 'api' oneki). Kod bildirim adresini hicbir PayTR istegine
 * koymaz ve PAYTR_NOTIFICATION_URL degiskenini okumaz: hic okunmayan notifyUrl alani
 * kaldirildi (sunucu .env'lerinde kalan eski deger zararsiz). Bu aciklamanin eskiden
 * yazdigi '/webhooks/paytr/notification' yolu hic var olmadi: uc ilk committen (8e31269)
 * beri billing denetleyicisinde 'webhooks/paytr'.
 */
@Injectable()
export class PaytrService {
  private readonly log = new Logger(PaytrService.name);

  private readonly merchantId = process.env.PAYTR_MERCHANT_ID ?? '';
  private readonly merchantKey = process.env.PAYTR_MERCHANT_KEY ?? '';
  private readonly merchantSalt = process.env.PAYTR_MERCHANT_SALT ?? '';
  private readonly testMode = process.env.PAYTR_TEST_MODE ?? '1';

  /**
   * Otomatik yenileme (Direkt API + kart saklama + tekrarlayan odeme).
   * PayTR magaza hesabinda Direkt API, Non3D ve tekrarlayan odeme yetkisi
   * ACILMADAN '1' yapilmamali — kapaliyken eski iFrame akisi aynen calisir.
   */
  get recurringEnabled(): boolean {
    return process.env.PAYTR_RECURRING_ENABLED === '1';
  }

  /**
   * Satin alma kapisi icin test modu. PayTR test_mode yalniz "0 veya 1" alir
   * (iframe-api-1-adim); '0' DISINDAKI her deger test sayilir: bos dize,
   * satir ici yorumlu "1  # 1=test" (.env.example ustundeki uyari) vb.
   * Belirsiz ayarda ucretli plan dagitmaktansa satin almayi kapatmak daha
   * ucuz hata (kapali basarisizlik). PayTR'ye giden deger DEGISMEZ (ham hali).
   */
  get testModeOn(): boolean {
    return checkoutTestModeOn(this.testMode);
  }

  /** Hesap yonetici mi — yalniz test modu kararlarinda okunur (canli modda ek sorgu yok) */
  private async isAdminUser(userId: string | null | undefined): Promise<boolean> {
    if (!userId) return false;
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    return u?.role === 'ADMIN';
  }

  /** Hesabin en az bir PAID faturasi var mi (deneme kilidi yalniz hic odememis hesaba: ever-paid.ts) */
  hasEverPaid(userId: string): Promise<boolean> {
    return hasEverPaid(this.prisma, userId);
  }

  /**
   * Satin alma acik mi? userId verilirse o hesaba gore (test modunda yalniz
   * ADMIN acik); null = anonim ziyaretci (herkese acik fiyat sayfasi).
   * Canli modda (PAYTR_TEST_MODE=0) her zaman acik ve veritabanina gitmez.
   */
  async checkoutStatus(userId: string | null, locale: 'tr' | 'en' = 'tr'): Promise<CheckoutStatus> {
    if (!this.testModeOn) return { open: true, testMode: false, message: null };
    if (await this.isAdminUser(userId)) return { open: true, testMode: true, message: null };
    return { open: false, testMode: true, message: locale === 'en' ? CHECKOUT_TEST_MODE_MESSAGE_EN : CHECKOUT_TEST_MODE_MESSAGE };
  }

  /**
   * Odeme baslatma kapisi (iFrame jetonu, Direkt API formu, test onayi).
   * Kontrol FATURA SAHIBINE (userId) yapilir: ensureSelf admin olmayanin
   * yalniz kendi hesabiyla odeme baslatmasina izin verir, yani sahip admin
   * ise baslatan da admindir. Admin'in bir musteri adina baslattigi test
   * odemesi de reddedilir — o fatura zaten plan acamazdi (markInvoicePaid).
   * 403: rol kaynakli bir ret; metin panelde aynen gosterilir.
   */
  async assertCheckoutOpen(userId: string): Promise<void> {
    const status = await this.checkoutStatus(userId);
    if (status.open) return;
    this.log.warn(`[checkout] PayTR test modunda: ${userId} yönetici değil, ödeme başlatılmadı`);
    throw new ForbiddenException({ statusCode: 403, message: CHECKOUT_TEST_MODE_MESSAGE, code: 'PAYTR_TEST_MODE' });
  }

  /**
   * Basarili bildirim bir TEST odemesi mi ve sahibi yonetici degil mi?
   * Test sayilir: bizim test bayragimiz acik ya da PayTR bildirimde
   * test_mode=1 gondermis (magaza henuz canliya alinmamis olabilir).
   * Ikisi de yoksa (canli odeme) veritabanina gitmeden false.
   */
  private async isRefusedTestPayment(invoice: { userId: string | null }, providerTestMode: boolean): Promise<boolean> {
    if (!this.testModeOn && !providerTestMode) return false;
    return !(await this.isAdminUser(invoice.userId));
  }

  /**
   * Reddedilen test odemesi: fatura PENDING → FAILED (atomik), neden aciklamada.
   *
   * NEDEN FAILED (PENDING ya da PAID degil):
   *  - PAID yalan olurdu: test islemi para toplamaz (gercek tahsilat canliya
   *    gecis onayindan sonra baslar — dev.paytr.com entegrasyon sureci).
   *  - PENDING "odeme bekleniyor" demek ve fatura ACIK kalir: markInvoicePaid'in
   *    PENDING → PAID gecisi onu sonradan kabul edebilirdi. PayTR ayni bildirimi
   *    birden fazla gonderebilir ("aynı ödeme işlemi için birden fazla bildirim
   *    ulaşabilir", iframe-api-2-adim; direkt-api-2-adim: OK alamazsa islem
   *    "Devam Ediyor" kalir). Ortam canliya cevrildikten sonra gelen gecikmis
   *    bir tekrar, test odemesini ucretli plana cevirebilirdi. FAILED kalicidir.
   *  - E-posta yok, yenileme sayaci artmaz: musterinin karti reddedilmedi, bu
   *    bizim yapilandirmamiz. Operator log'da gorur.
   */
  private async failTestPayment(invoice: { id: string; userId: string | null; paytrTransactionId: string | null; description: string | null }): Promise<void> {
    const moved = await this.prisma.invoice.updateMany({
      where: { id: invoice.id, status: 'PENDING' },
      data: {
        status: 'FAILED',
        failedAt: new Date(),
        description: failedInvoiceDescription(invoice.description, TEST_PAYMENT_FAILURE_CODE, TEST_PAYMENT_FAILURE_REASON),
      },
    });
    if (moved.count > 0) {
      this.log.error(`[${invoice.paytrTransactionId}] Test modunda ödeme bildirimi: hesap yönetici değil (${invoice.userId ?? 'silinmiş hesap'}) — plan AÇILMADI, fatura FAILED (gerçek tahsilat yok)`);
    }
  }

  // Yalniz musterinin tarayicisinin donecegi sayfalar; bildirim (webhook) adresi PayTR
  // panelinde tanimli (sinif aciklamasi), hicbir istekte gonderilmez
  private readonly okUrl = process.env.PAYTR_OK_URL
    ?? 'https://ranksup.ai/billing/success';
  private readonly failUrl = process.env.PAYTR_FAIL_URL
    ?? 'https://ranksup.ai/billing/failure';

  constructor(
    private readonly prisma: PrismaService,
    private readonly affiliate: AffiliateService,
    private readonly email: EmailService,
    private readonly fx: FxService,
    // Plan yukseltme sonrasi takvim taramasi (scheduled-kick.ts). Opsiyonel: kuyruk
    // olmadan da plan acilir (saatlik tarama bekleyen yazilari yine alir)
    @Optional() private readonly jobs?: JobQueueService,
  ) {}

  /**
   * Iframe ödeme sayfası için token üret.
   * Frontend bu token'ı iframeUrl'de açar.
   */
  async createPaymentToken(opts: {
    userId: string;
    planId: 'starter' | 'pro' | 'agency';
    cycle: 'monthly' | 'annual';
    userIp: string;
    userEmail: string;
    userName: string;
    userPhone?: string;
    userAddress?: string;
  }): Promise<
    | { mode: 'iframe'; token: string; iframeUrl: string; merchantOid: string }
    | DirectCheckout
  > {
    // Test modunda yalniz yonetici (iFrame ve Direkt API ayni kapidan gecer);
    // PayTR'ye istek gitmez, fatura acilmaz.
    await this.assertCheckoutOpen(opts.userId);
    if (!this.merchantId) {
      throw new BadRequestException('PayTR Merchant credentials .env\'de tanımlı değil');
    }
    if (this.recurringEnabled) return this.createDirectCheckout(opts);

    const plan = await this.getPlanDetails(opts.planId, opts.cycle);
    const merchantOid = this.generateOrderId(opts.userId, opts.planId);

    // Kur TCMB'den alinamadiysa tahsilat YAPMA. Bayat kurla islem yapmak
    // ya musteriyi fazla ya bizi eksik yakar; her iki durum da geri donusu
    // zahmetli. Kullanici birkac dakika sonra tekrar denesin.
    if (plan.fxStale) {
      this.log.error(`Kur bayat (${plan.fxSource}) — odeme reddedildi: ${merchantOid}`);
      throw new BadRequestException(
        'Güncel döviz kuru alınamadı, ödeme başlatılamıyor. Lütfen birkaç dakika sonra tekrar deneyin.',
      );
    }

    const paymentAmount = Math.round(plan.price * 100);

    const userBasket = Buffer.from(JSON.stringify([
      [`RanksUp ${plan.name} ${opts.cycle === 'annual' ? 'Yıllık' : 'Aylık'}`, plan.price.toFixed(2), 1],
    ])).toString('base64');

    const noInstallment = '0';
    const maxInstallment = '0';
    const currency = 'TL';

    const hashStr = `${this.merchantId}${opts.userIp}${merchantOid}${opts.userEmail}${paymentAmount}${userBasket}${noInstallment}${maxInstallment}${currency}${this.testMode}${this.merchantSalt}`;
    const paytrToken = createHmac('sha256', this.merchantKey).update(hashStr).digest('base64');

    const formData = new URLSearchParams({
      merchant_id: this.merchantId,
      user_ip: opts.userIp,
      merchant_oid: merchantOid,
      email: opts.userEmail,
      payment_amount: String(paymentAmount),
      paytr_token: paytrToken,
      user_basket: userBasket,
      debug_on: '1',
      no_installment: noInstallment,
      max_installment: maxInstallment,
      user_name: opts.userName,
      user_address: opts.userAddress ?? 'N/A',
      user_phone: opts.userPhone ?? '0000000000',
      merchant_ok_url: this.okUrl,
      merchant_fail_url: this.failUrl,
      timeout_limit: '30',
      currency,
      test_mode: this.testMode,
      lang: 'tr',
    });

    const res = await fetch('https://www.paytr.com/odeme/api/get-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString(),
    });

    const data: any = await res.json();
    if (data.status !== 'success') {
      this.log.error(`PayTR token error: ${data.reason}`);
      throw new BadRequestException(`PayTR: ${data.reason}`);
    }

    await this.prisma.invoice.create({
      data: {
        userId: opts.userId,
        paytrTransactionId: merchantOid,
        amount: plan.price,
        currency: 'TRY',
        // Fiyatin kanonik hali ve kullanilan kur faturaya sabitlenir —
        // "bu TL tutari nereden cikti" sorusu sonradan cevaplanabilsin.
        amountUsd: plan.priceUsd,
        fxRate: plan.fxRate,
        status: 'PENDING',
        description: capInvoiceDescription(`RanksUp ${plan.name} — ${opts.cycle} ($${plan.priceUsd} @ ${plan.fxRate})`),
      },
    });

    return {
      mode: 'iframe' as const,
      token: data.token,
      iframeUrl: `https://www.paytr.com/odeme/guvenli/${data.token}`,
      merchantOid,
    };
  }

  /**
   * Direkt API odeme formu (otomatik yenileme acikken).
   *
   * Kart alanlari (cc_owner, card_number, expiry_*, cvv) TARAYICIDAN DOGRUDAN
   * PayTR'ye post edilir — sunucumuza ugramaz. Biz yalniz imzali gizli alanlari
   * uretiriz. store_card=1 kullanici otomatik yenileme onay kutusunu isaretlediginde
   * formda gonderilir (imzaya dahil degil); bildirimde gelen utoken kullaniciya yazilir.
   * Docs: dev.paytr.com/direkt-api/direkt-api-1-adim, .../kart-saklama-api/yeni-kart-ekleme
   */
  private async createDirectCheckout(opts: {
    userId: string;
    planId: 'starter' | 'pro' | 'agency';
    cycle: 'monthly' | 'annual';
    userIp: string;
    userEmail: string;
    userName: string;
    userPhone?: string;
    userAddress?: string;
  }): Promise<DirectCheckout> {
    const plan = await this.getPlanPriceForUser(opts.userId, opts.planId, opts.cycle);
    const fx = await this.fx.getRate();
    if (fx.stale) {
      throw new BadRequestException(
        'Güncel döviz kuru alınamadı, ödeme başlatılamıyor. Lütfen birkaç dakika sonra tekrar deneyin.',
      );
    }
    const merchantOid = this.generateOrderId(opts.userId, opts.planId);
    const paymentAmount = plan.price.toFixed(2);
    const fields: Record<string, string> = {
      merchant_id: this.merchantId,
      user_ip: opts.userIp,
      merchant_oid: merchantOid,
      email: opts.userEmail,
      payment_amount: paymentAmount,
      payment_type: 'card',
      installment_count: '0',
      currency: 'TL',
      test_mode: this.testMode,
      non_3d: '0',
      client_lang: 'tr',
      merchant_ok_url: this.okUrl,
      merchant_fail_url: this.failUrl,
      user_name: opts.userName,
      user_address: opts.userAddress ?? 'N/A',
      user_phone: opts.userPhone ?? '0000000000',
      user_basket: JSON.stringify([[`RanksUp ${plan.name} ${opts.cycle === 'annual' ? 'Yıllık' : 'Aylık'}`, paymentAmount, 1]]),
      debug_on: this.testMode === '1' ? '1' : '0',
    };
    fields.paytr_token = this.directToken(fields);

    // Kullanicinin onceki kartlari ayni utoken altinda toplansin (yoksa PayTR yenisini uretir)
    const user = await this.prisma.user.findUnique({ where: { id: opts.userId }, select: { paytrUtoken: true } });

    await this.prisma.invoice.create({
      data: {
        userId: opts.userId,
        paytrTransactionId: merchantOid,
        amount: plan.price,
        currency: 'TRY',
        amountUsd: plan.priceUsd,
        fxRate: plan.fxRate,
        status: 'PENDING',
        // Onay kutusu form tarafinda; kart saklanirsa bildirimde utoken gelir.
        storeCard: true,
        description: capInvoiceDescription(`RanksUp ${plan.name} — ${opts.cycle} ($${plan.priceUsd} @ ${plan.fxRate})`),
      },
    });

    return {
      mode: 'direct',
      action: 'https://www.paytr.com/odeme',
      fields,
      utoken: user?.paytrUtoken ?? null,
      merchantOid,
      amountText: `₺${plan.price.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      planName: plan.name,
      cycle: opts.cycle,
    };
  }

  /** Direkt API paytr_token: merchant_id+user_ip+merchant_oid+email+payment_amount+payment_type+installment_count+currency+test_mode+non_3d + salt */
  private directToken(f: Record<string, string>): string {
    const str = `${f.merchant_id}${f.user_ip}${f.merchant_oid}${f.email}${f.payment_amount}${f.payment_type}${f.installment_count}${f.currency}${f.test_mode}${f.non_3d}${this.merchantSalt}`;
    return createHmac('sha256', this.merchantKey).update(str).digest('base64');
  }

  /**
   * Kayitli kart listesi (CAPI LIST). paytr_token = HMAC(utoken + salt).
   * Docs: dev.paytr.com/direkt-api/kart-saklama-api/kayitli-kart-listesi
   */
  async listStoredCards(utoken: string): Promise<StoredCard[]> {
    const paytrToken = createHmac('sha256', this.merchantKey).update(`${utoken}${this.merchantSalt}`).digest('base64');
    const res = await fetch('https://www.paytr.com/odeme/capi/list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ merchant_id: this.merchantId, utoken, paytr_token: paytrToken }).toString(),
    });
    const data: any = await res.json().catch(() => ({}));
    if (data?.status === 'error') throw new Error(`CAPI LIST: ${data.err_msg ?? 'bilinmeyen hata'}`);
    // Yanit bicimi dokumanda net degil: dizi ya da tek kart nesnesi olabilir
    const rows: any[] = Array.isArray(data) ? data : Array.isArray(data?.cards) ? data.cards : data?.ctoken ? [data] : [];
    return rows
      .filter((c) => c && c.ctoken)
      .map((c) => ({ ctoken: String(c.ctoken), last4: c.last_4 ? String(c.last_4) : null, requireCvv: String(c.require_cvv) === '1' }));
  }

  /**
   * Kayitli karttan yenileme cekimi (tekrarlayan odeme, Non3D, kullanici etkilesimi yok).
   * Docs: dev.paytr.com/direkt-api/kart-saklama-api/kayitli-kart-tekrarlayan-odeme
   *
   * Sonuc: 'success' (fatura PAID + plan uzatildi), 'failed' (fatura FAILED + basarisizlik
   * sayaci), 'pending' (wait_callback — bildirim karar verir), 'skipped' (kur bayat vb.;
   * deneme sayilmaz).
   */
  async chargeStoredCard(userId: string): Promise<{ result: 'success' | 'failed' | 'pending' | 'skipped'; reason?: string }> {
    // Test modunda kayitli karttan cekim de test islemi olur: para toplanmaz
    // ama PayTR "success" doner. Eskiden markInvoicePaid plani bir donem daha
    // uzatiyordu; artik o fatura reddedilir (failTestPayment) ve burada
    // 'success' denirdi. Hic denenmez: 'skipped' deneme sayilmaz, musteriye
    // "odeme alinamadi" e-postasi gitmez; canliya donulunce cron yeniden dener.
    // Yonetici hesaplari zaten yenileme turune girmez (renewal-policy isAdmin).
    if (this.testModeOn) {
      this.log.error(`[yenileme] PayTR test modunda: ${userId} için kayıtlı karttan çekim yapılmadı (gerçek tahsilat olmazdı)`);
      return { result: 'skipped', reason: 'PayTR test modunda; gerçek tahsilat yapılamaz' };
    }
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, email: true, name: true, plan: true, paytrUtoken: true },
    });
    if (!user.paytrUtoken) return { result: 'skipped', reason: 'kayıtlı kart yok' };
    const planId = user.plan.toLowerCase() as 'starter' | 'pro' | 'agency';
    if (!['starter', 'pro', 'agency'].includes(planId)) return { result: 'skipped', reason: `yenilenemez plan: ${user.plan}` };

    const lastPaid = await this.prisma.invoice.findFirst({
      where: { userId, status: 'PAID' },
      orderBy: { paidAt: 'desc' },
      select: { description: true },
    });
    const cycle = cycleFromDescription(lastPaid?.description);

    const fx = await this.fx.getRate();
    if (fx.stale) return { result: 'skipped', reason: 'kur bayat' };
    const plan = await this.getPlanPriceForUser(userId, planId, cycle);

    const merchantOid = this.generateOrderId(userId, planId);
    const paymentAmount = plan.price.toFixed(2);
    const invoice = await this.prisma.invoice.create({
      data: {
        userId,
        paytrTransactionId: merchantOid,
        amount: plan.price,
        currency: 'TRY',
        amountUsd: plan.priceUsd,
        fxRate: plan.fxRate,
        status: 'PENDING',
        isRenewal: true,
        description: capInvoiceDescription(`RanksUp ${plan.name} — ${cycle} yenileme ($${plan.priceUsd} @ ${plan.fxRate})`),
      },
    });

    let cards: StoredCard[] = [];
    try {
      cards = await this.listStoredCards(user.paytrUtoken);
    } catch (err: any) {
      await this.markInvoiceFailed(invoice.id, 'CAPI', err.message);
      return { result: 'failed', reason: err.message };
    }
    const card = cards.find((c) => !c.requireCvv);
    if (!card) {
      const reason = cards.length ? 'Kayıtlı kart güvenlik kodu (CVV) istiyor; otomatik çekim yapılamaz' : 'Kayıtlı kart bulunamadı';
      await this.markInvoiceFailed(invoice.id, 'NOCARD', reason);
      return { result: 'failed', reason };
    }

    const fields: Record<string, string> = {
      merchant_id: this.merchantId,
      user_ip: process.env.PAYTR_SERVER_IP || '127.0.0.1',
      merchant_oid: merchantOid,
      email: user.email,
      payment_amount: paymentAmount,
      payment_type: 'card',
      installment_count: '0',
      currency: 'TL',
      test_mode: this.testMode,
      non_3d: '1',
      client_lang: 'tr',
      merchant_ok_url: this.okUrl,
      merchant_fail_url: this.failUrl,
      user_name: user.name ?? user.email,
      user_address: 'N/A',
      user_phone: '0000000000',
      user_basket: JSON.stringify([[`RanksUp ${plan.name} ${cycle === 'annual' ? 'Yıllık' : 'Aylık'} yenileme`, paymentAmount, 1]]),
      utoken: user.paytrUtoken,
      ctoken: card.ctoken,
      recurring_payment: '1',
    };
    fields.paytr_token = this.directToken(fields);

    let data: any = {};
    try {
      const res = await fetch('https://www.paytr.com/odeme', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields).toString(),
      });
      data = await res.json();
    } catch (err: any) {
      // Ag hatasi: sonucu bilmiyoruz — fatura PENDING kalir, bildirim gelirse o karar verir
      this.log.warn(`[${merchantOid}] yenileme istegi yanitsiz: ${err.message}`);
      return { result: 'pending', reason: 'PayTR yanıt vermedi' };
    }

    if (data.status === 'success') {
      await this.markInvoicePaid(invoice.id);
      return { result: 'success' };
    }
    if (data.status === 'wait_callback') return { result: 'pending' };
    const reason = String(data.msg ?? data.reason ?? 'bilinmeyen hata');
    // try_again=true: islem suruyor — deneme sayilmaz, fatura acik kalir
    if (data.try_again === true || data.try_again === 'true') return { result: 'pending', reason };
    await this.markInvoiceFailed(invoice.id, 'RECUR', reason);
    return { result: 'failed', reason };
  }

  /**
   * DEV / TEST mode kisayolu: PayTR webhook gelmeden invoice'i PAID yap +
   * plani aktive et. Sadece testMode=1 iken calisir.
   *
   * Yalniz YONETICI: bu uc PayTR'ye hic ugramadan faturayi odenmis sayar.
   * Eskiden her hesaba acikti; /billing/subscribe ile acilan PENDING fatura
   * buradan onaylanip (basari sayfasi bunu kendiliginden cagiriyordu) deneme
   * kullanicisina odemesiz ucretli plan veriliyordu. Kontrol markInvoicePaid'de
   * ikinci kez yapilir (isRefusedTestPayment).
   */
  async devConfirmPayment(userId: string, merchantOid: string) {
    if (this.testMode !== '1') {
      throw new BadRequestException('Bu endpoint sadece test modunda kullanilabilir');
    }
    await this.assertCheckoutOpen(userId);
    const invoice = await this.prisma.invoice.findUnique({
      where: { paytrTransactionId: merchantOid },
    });
    if (!invoice) throw new BadRequestException('Invoice bulunamadi');
    if (invoice.userId !== userId) throw new BadRequestException('Bu fatura sana ait degil');
    if (invoice.status === 'PAID') return { ok: true, message: 'Zaten odenmis' };

    const parsed = this.parseOrderId(merchantOid);
    if (!parsed) throw new BadRequestException('Gecersiz merchantOid');

    // Gercek bildirimle ayni yol (test mode parity) — atomik, tekrar guvenli
    await this.markInvoicePaid(invoice.id);

    this.log.log(`[${merchantOid}] DEV-CONFIRM: ${invoice.userId} → ${parsed.planId}`);
    return { ok: true, planId: parsed.planId };
  }

  /**
   * Webhook handler — PayTR ödemeden sonra POST eder.
   */
  async handleWebhook(payload: Record<string, string>): Promise<string> {
    const {
      merchant_oid, status, total_amount, hash,
      failed_reason_code, failed_reason_msg,
    } = payload;

    // KAPALI BASARISIZLIK: anahtar ya da tuz tanimsizsa bildirim ISLENMEZ.
    // Bos anahtarla HMAC herkesce hesaplanabilir; eskiden boyle bir surecte
    // (PAYTR_MERCHANT_KEY/SALT eksik) bu herkese acik uca gelen sahte bir
    // status=success, PENDING faturayi PAID yapip plani acabiliyordu. Kimlik
    // bilgisi yokken gercek bir PayTR odemesi de baslatilamaz (odeme jetonu ve
    // Direkt API formu ayni anahtar + tuzla imzalanir), yani kaybedilecek
    // mesru bildirim yok. 'OK' doner: imza uyusmazligi dalindaki gibi.
    if (!this.merchantKey || !this.merchantSalt) {
      this.log.error(`[${merchant_oid ?? '-'}] PayTR bildirimi işlenmedi: PAYTR_MERCHANT_KEY/PAYTR_MERCHANT_SALT tanımlı değil, imza doğrulanamaz`);
      return 'OK';
    }

    if (!merchant_oid) {
      this.log.warn('Webhook payload eksik');
      return 'OK';
    }

    const hashStr = `${merchant_oid}${this.merchantSalt}${status}${total_amount}`;
    const expected = createHmac('sha256', this.merchantKey).update(hashStr).digest('base64');

    if (hash !== expected) {
      this.log.error(`[${merchant_oid}] Webhook hash mismatch — sahte istek?`);
      return 'OK';
    }

    // ─── Video credit add-on (LVCR prefix) — one-time payment, subscription degil ──
    if (merchant_oid.startsWith('LVCR')) {
      if (status === 'success') {
        await this.confirmVideoCreditPurchase(merchant_oid);
        this.log.log(`[${merchant_oid}] ✅ Video credit pack PAID`);
      } else {
        // Pack PENDING'de bırak, RefundService veya admin manuel iptal eder
        await this.prisma.videoCreditPurchase.updateMany({
          where: { merchantOid: merchant_oid, status: 'PENDING' },
          data: { status: 'EXPIRED' },
        });
        this.log.warn(`[${merchant_oid}] ❌ Video credit purchase failed: ${failed_reason_msg}`);
      }
      return 'OK';
    }

    const invoice = await this.prisma.invoice.findUnique({
      where: { paytrTransactionId: merchant_oid },
    });
    if (!invoice) {
      this.log.warn(`[${merchant_oid}] Invoice bulunamadı`);
      return 'OK';
    }

    // Test odemesi (bizim bayragimiz ya da PayTR'nin test_mode=1 isareti) yonetici
    // olmayan hesapta plan ACMAZ ve kart da SAKLANMAZ: test karti icin gelen
    // utoken ile otomatik yenileme acilmasin. Fatura durumundan bagimsiz kontrol
    // edilir — reddedilmis faturanin tekrar bildirimi de utoken yazdirmasin.
    // test_mode imzaya dahil degil (hash = merchant_oid+tuz+status+total_amount);
    // yalniz daha SIKI karar icin okunur, hicbir seyi acmaz.
    const providerTestMode = String(payload.test_mode ?? '').trim() === '1';
    if (status === 'success' && await this.isRefusedTestPayment(invoice, providerTestMode)) {
      await this.failTestPayment(invoice);
      return 'OK';
    }

    // Kart saklandiysa PayTR kullaniciya ozel utoken'i bildirimde iletir
    // (dev.paytr.com kart-saklama: "post-payment notification"). Onay verilmis
    // odemede kaydedilir; otomatik yenileme bu anahtarla yapilir.
    // Silme talebi olan (ya da silinmis) hesapta otomatik yenileme ASLA yeniden
    // acilmaz — silme aninda kapatilan yenileme gec gelen bildirimle geri gelmesin.
    if (status === 'success' && invoice.storeCard && payload.utoken && invoice.userId) {
      await this.prisma.user.updateMany({
        where: { id: invoice.userId, deletionRequestedAt: null },
        data: { paytrUtoken: String(payload.utoken).slice(0, 255), autoRenew: true },
      });
    }

    if (status === 'success') {
      await this.markInvoicePaid(invoice.id, { providerTestMode });
    } else {
      await this.markInvoiceFailed(invoice.id, failed_reason_code, failed_reason_msg);
    }
    return 'OK';
  }

  /**
   * Fatura PENDING → PAID (tek seferlik, atomik). Yalniz gercek gecis aninda plan
   * etkinlesir, komisyon yazilir ve e-posta gider.
   *
   * NEDEN: PayTR "OK" alamazsa ayni bildirimi yeniden gonderir (dev.paytr.com
   * direkt-api-2-adim). Eskiden her tekrar plani yeniden etkinlestiriyor ve
   * ortaklik komisyonunu bir kez daha yaziyordu.
   *
   * TEST MODU (savunma derinligi): bildirim, test onayi (dev-confirm) ve
   * yenileme cekimi buradan gecer. Test odemesi yonetici olmayan hesapta plani
   * acmaz; fatura FAILED olur (failTestPayment) ve false doner. Canli modda
   * (PAYTR_TEST_MODE=0, bildirimde test_mode=1 yok) ek sorgu yapilmaz.
   */
  async markInvoicePaid(invoiceId: string, opts: { providerTestMode?: boolean } = {}): Promise<boolean> {
    const providerTestMode = opts.providerTestMode === true;
    if (this.testModeOn || providerTestMode) {
      const pending = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
      if (pending?.status === 'PENDING' && await this.isRefusedTestPayment(pending, providerTestMode)) {
        await this.failTestPayment(pending);
        return false;
      }
    }
    const moved = await this.prisma.invoice.updateMany({
      where: { id: invoiceId, status: 'PENDING' },
      data: { status: 'PAID', paidAt: new Date() },
    });
    if (moved.count === 0) return false;
    const invoice = await this.prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    const parsed = invoice.paytrTransactionId ? this.parseOrderId(invoice.paytrTransactionId) : null;
    if (!parsed) return true;

    // Silme talebinden sonra tamamlanan odeme (ornegin silmeden once acilmis odeme
    // sayfasi): para tahsil edildigi icin fatura PAID kalir (muhasebe gercegi), ama
    // abonelik yeniden ACILMAZ, komisyon yazilmaz — iade elle yapilmali.
    const user = invoice.userId ? await this.prisma.user.findUnique({ where: { id: invoice.userId } }) : null;
    if (!user || user.deletionRequestedAt) {
      this.log.error(`[${invoice.paytrTransactionId}] Silinen/silme talebi olan hesaba ödeme geldi — abonelik açılmadı, ELLE İADE GEREKLİ (fatura ${invoice.id})`);
      return true;
    }

    await this.activateSubscription(user, parsed.planId, invoice.paytrTransactionId!);
    try {
      await this.affiliate.recordCommission(user.id, Number(invoice.amount));
    } catch (err: any) {
      this.log.warn(`[${invoice.paytrTransactionId}] komisyon yazilamadi: ${err.message}`);
    }

    if (!invoice.isRenewal) {
      // Kota sayilari plans.ts'ten (tek kaynak; QuotaService.LIMITS ile ayni).
      // Eskiden burada sabit 10/50/250 makale ve 1/3/10 site yaziyordu: Pro
      // musterisine "50 makale, 3 site" deniyordu, gercek kota 40 makale, 5 site.
      const purchased = findPlan(parsed.planId);
      this.email.send({
        userId: user.id,
        to: user.email,
        template: 'plan_upgraded',
        data: {
          name: user.name ?? 'kullanıcı',
          planName: parsed.planId.toUpperCase(),
          articleQuota: purchased?.articlesPerMonth ?? 0,
          siteQuota: purchased?.sites ?? 0,
        },
      }).catch((err) => this.log.warn(`plan_upgraded mail: ${err.message}`));
    }
    this.log.log(`[${invoice.paytrTransactionId}] ✅ Ödeme ${invoice.isRenewal ? '(yenileme) ' : ''}başarılı: ${invoice.userId} → ${parsed.planId}`);
    return true;
  }

  /**
   * Fatura PENDING → FAILED (tek seferlik, atomik). Yenileme faturasiysa basarisizlik
   * sayaci artar; 3. basarisizlikta plan duser.
   */
  async markInvoiceFailed(invoiceId: string, code?: string, msg?: string): Promise<boolean> {
    const invoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) return false;
    const moved = await this.prisma.invoice.updateMany({
      where: { id: invoiceId, status: 'PENDING' },
      data: {
        status: 'FAILED',
        failedAt: new Date(),
        // Sutun VARCHAR(191); eski .slice(0, 500) uzun PayTR mesajinda P2000 -> bildirim 500 -> sonsuz tekrar
        description: failedInvoiceDescription(invoice.description, code, msg),
      },
    });
    if (moved.count === 0) return false;

    // Hesap kalici silinmisse (userId NULL) islenecek kullanici yok — fatura FAILED kalir
    if (!invoice.userId) {
      this.log.warn(`[${invoice.paytrTransactionId}] Silinmiş hesabın ödemesi başarısız: ${msg}`);
      return true;
    }
    if (invoice.isRenewal) {
      await this.recordRenewalFailure(invoice.userId, msg);
    } else {
      const u = await this.prisma.user.findUnique({ where: { id: invoice.userId } });
      // Silme talebi olan hesaba "odeme basarisiz" e-postasi gitmez
      if (u?.email && !u.deletionRequestedAt) {
        this.email.send({
          userId: u.id,
          to: u.email,
          template: 'payment_failed',
          data: { name: u.name ?? 'kullanıcı', reasonMsg: msg, reasonCode: code },
        }).catch((err) => this.log.warn(`payment_failed mail: ${err.message}`));
      }
    }
    this.log.warn(`[${invoice.paytrTransactionId}] ❌ Ödeme başarısız${invoice.isRenewal ? ' (yenileme)' : ''}: ${msg}`);
    return true;
  }

  /** Yenileme cekimi basarisiz: sayac++, durum PAST_DUE, e-posta; sinira ulasinca plan duser. */
  async recordRenewalFailure(userId: string, reason?: string) {
    // Silme talebi sonrasi sonuclanan cekim: iptal edilmis abonelik PAST_DUE'ya
    // geri donmez, e-posta gitmez (yenileme turu PAST_DUE'yu yeniden ele alirdi)
    const current = await this.prisma.user.findUnique({ where: { id: userId }, select: { deletionRequestedAt: true } });
    if (!current || current.deletionRequestedAt) return;
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        renewalFailCount: { increment: 1 },
        renewalLastAttemptAt: new Date(),
        subscriptionStatus: 'PAST_DUE',
      },
      select: { id: true, email: true, name: true, plan: true, renewalFailCount: true },
    });
    const planName = findPlan(user.plan.toLowerCase())?.name_tr ?? user.plan;
    if (user.renewalFailCount >= RENEWAL_MAX_ATTEMPTS) {
      await this.downgradeForNonPayment(userId, reason);
      return;
    }
    if (user.email) {
      this.email.send({
        userId: user.id,
        to: user.email,
        template: 'renewal_failed',
        data: { name: user.name ?? 'kullanıcı', planName, attempt: user.renewalFailCount, maxAttempts: RENEWAL_MAX_ATTEMPTS, reasonMsg: reason },
      }).catch((err) => this.log.warn(`renewal_failed mail: ${err.message}`));
    }
  }

  /** Odeme alinamadi → plan deneme duzeyine, durum EXPIRED, otomatik yenileme kapali. */
  async downgradeForNonPayment(userId: string, reason?: string) {
    const before = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { plan: true, email: true, name: true } });
    if (before.plan === 'TRIAL') return;
    await this.prisma.user.update({
      where: { id: userId },
      data: { plan: 'TRIAL', subscriptionStatus: 'EXPIRED', autoRenew: false },
    });
    this.log.warn(`Odeme alinamadi, plan dustu: ${userId} (${before.plan} → TRIAL)${reason ? ` — ${reason}` : ''}`);
    if (before.email) {
      this.email.send({
        userId,
        to: before.email,
        template: 'subscription_expired',
        data: { name: before.name ?? 'kullanıcı', planName: findPlan(before.plan.toLowerCase())?.name_tr ?? before.plan },
      }).catch((err) => this.log.warn(`subscription_expired mail: ${err.message}`));
    }
  }

  /**
   * Abonelik iptali — kullanici tarafindan cagrilir.
   *
   * Plan HEMEN dusmez: odenen donemin sonuna kadar acik kalir; donem bitince
   * QuotaService.expireCanceledSubscriptions plani TRIAL'a indirir. Yanit yalniz
   * gereken alanlari doner (eskiden User satirinin tamami istemciye gidiyordu).
   *
   * Hesap silme de BU iptali kullanir (tek iptal tanimi): `db` ile silme
   * transaction'i icinde calisir, `notify:false` ile "donem sonuna kadar acik"
   * e-postasi gitmez — silmede erisim hemen kapanir, o metin yanlis olurdu.
   *
   * Plan TRIAL (deneme ya da plani zaten dusmus eski musteri): iptal edilecek abonelik
   * yok → 400. NEDEN: eskiden durum CANCELED yaziliyordu; deneme kurali durumu EXPIRED
   * ya da TRIAL bekledigi icin hesap suresi dolsa da salt okunur olmuyordu ve hicbir
   * gunluk is plan TRIAL + CANCELED satiri yakalamiyordu (inceleme). Yazma da ayni
   * kosulu tasir: okuma ile yazma arasinda gunluk is plani dusurduyse CANCELED yazilmaz
   * (P2025 → 400).
   */
  async cancelSubscription(
    userId: string,
    opts: { notify?: boolean; db?: Prisma.TransactionClient } = {},
  ) {
    const db = opts.db ?? this.prisma;
    const current = await db.user.findUnique({ where: { id: userId }, select: { plan: true } });
    if (!current || current.plan === 'TRIAL') throw new BadRequestException(TRIAL_CANCEL_NOT_ALLOWED_MESSAGE);
    const user = await db.user.update({
      where: { id: userId, plan: { not: 'TRIAL' } },
      // Iptal: otomatik yenileme de kapanir (kart PayTR'de kayitli kalir, cekim yapilmaz)
      data: { subscriptionStatus: 'CANCELED', autoRenew: false },
      select: { id: true, email: true, name: true, plan: true, subscriptionStatus: true },
    }).catch((err: { code?: string }) => {
      // Kosul tutmadi (arada plan dustu): iptal edilecek abonelik kalmadi
      if (err?.code === 'P2025') throw new BadRequestException(TRIAL_CANCEL_NOT_ALLOWED_MESSAGE);
      throw err;
    });
    const lastPaid = await db.invoice.findFirst({
      where: { userId, status: 'PAID' },
      orderBy: { paidAt: 'desc' },
      select: { paidAt: true, createdAt: true, description: true },
    });
    const accessUntil = periodEndFromInvoice(lastPaid);
    if (user.email && opts.notify !== false) {
      this.email.send({
        userId: user.id,
        to: user.email,
        template: 'plan_canceled',
        data: {
          name: user.name ?? 'kullanıcı',
          planName: user.plan,
          accessUntilText: accessUntil
            ? accessUntil.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Istanbul' })
            : null,
        },
      }).catch((err) => this.log.warn(`plan_canceled mail: ${err.message}`));
    }
    return { plan: user.plan, status: user.subscriptionStatus, accessUntil };
  }

  /**
   * Odenen plani etkinlestirir.
   *
   * KOTA SAYACI yalniz GERCEK PLAN DEGISIMINDE sifirlanir: deneme (TRIAL) ya da
   * suresi dolmus (EXPIRED) hesaptan ucretli plana gecis, ya da baska bir
   * plana gecis. Ayni planin yenilemesi (otomatik, isRenewal) ve ayni planin
   * elle yeniden satin alinmasi (otomatik yenileme kapaliyken canli yol budur)
   * sayaca DOKUNMAZ. NEDEN: donem tanimi takvim ayi (QuotaService
   * maybeResetMonthlyQuota; SSS, yardim ve sozluk de sayacin her takvim ayinin
   * basinda sifirlandigini soyluyor). Eskiden her odeme de sifirliyordu: ayin
   * 15'inde yenileyen Baslangic musterisi 1'inde 15, 15'inde 15 daha alip
   * ayda 30 makale uretebiliyordu. invoice.isRenewal tek basina yetmez — elle
   * alinan ayni plan isRenewal=false gelir.
   *
   * Sifirlamada ay isaretcisi (articlesQuotaResetAt) bu aya tasinir. Isaretci
   * onceki bir aydaysa takvim sifirlamasi henuz yapilmamistir; o durumda
   * video ve AI maliyet sayaclari da burada sifirlanir — yoksa isaretci bu aya
   * gectigi icin maybeResetMonthlyQuota bu ay onlari hic sifirlamazdi.
   */
  private async activateSubscription(
    user: { id: string; plan?: string | null; subscriptionStatus?: string | null; articlesQuotaResetAt?: Date | string | null },
    planId: 'starter' | 'pro' | 'agency',
    subscriptionId: string,
  ) {
    const planMap = {
      starter: 'STARTER',
      pro: 'PRO',
      agency: 'AGENCY',
    } as const;
    const nextPlan = planMap[planId];
    const now = new Date();

    // TRIAL -> ucretli gecis plan farkiyla yakalanir (nextPlan hicbir zaman TRIAL degil)
    const planChanged = user.subscriptionStatus === 'EXPIRED' || user.plan !== nextPlan;
    const lastReset = user.articlesQuotaResetAt ? new Date(user.articlesQuotaResetAt) : null;
    // QuotaService ile ayni ay tanimi (sunucu saati, yil + ay)
    const markerInEarlierMonth = !lastReset || Number.isNaN(lastReset.getTime())
      || lastReset.getFullYear() !== now.getFullYear() || lastReset.getMonth() !== now.getMonth();

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        plan: nextPlan,
        subscriptionStatus: 'ACTIVE',
        subscriptionId,
        ...(planChanged
          ? {
            articlesUsedThisMonth: 0,
            articlesQuotaResetAt: now,
            ...(markerInEarlierMonth ? { videosUsedThisMonth: 0, aiCostThisMonthUsd: 0 } : {}),
          }
          : {}),
        // Yeni donem odendi: yenileme sayaclari sifirlanir
        renewalFailCount: 0,
        renewalLastAttemptAt: null,
        renewalNoticeAt: null,
      },
    });

    // Plan degisti, hak yenilendi: deneme hesabinin kilitli takvim yazilari (plan-lock.ts)
    // artik uretilebilir. Vadesi gecmisler icin kullanicinin taramasi hemen kuyruga
    // atilir, digerleri kendi saatinde. Hata plani etkinlestirmeyi bozmaz.
    if (planChanged) await kickScheduledAfterUpgrade(this.jobs, user.id, this.log);
  }

  /**
   * 2026-05 Premium Pricing — fiyatlar billing.service.ts BASE_PLANS ile senkron.
   * Mevcut grandfathered kullanicilar getPlanPriceForUser ile eski fiyati alir.
   */
  /**
   * Plan detayi — fiyat USD kanonik, tahsilat TL.
   *
   * ONEMLI: Fiyat listesi burada TEKRAR TANIMLANMAZ; plans.ts tek kaynaktir.
   * Onceden bu metotta ayri bir TL fiyat sabiti duruyordu ve billing.service
   * icindeki listeyle ayrisma riski vardi — kullaniciya bir fiyat gosterilip
   * kartindan baska tutar cekilebilirdi.
   *
   * TL tutari SIPARIS ANINDAKI kurla hesaplanir ve faturaya yazilir; boylece
   * odeme ile fatura arasinda kur farki olusmaz.
   */
  private async getPlanDetails(planId: string, cycle: 'monthly' | 'annual') {
    const p = findPlan(planId);
    if (!p) throw new BadRequestException(`Bilinmeyen plan: ${planId}`);

    // PURCHASABLE_PLAN_IDS bugune kadar OLU SABITTI: hicbir yerden import
    // edilmiyordu, bu yuzden fiyat karti "Bizimle iletisime gec" dese de
    // Kurumsal plan diger planlarla ayni PayTR kart akisindan satin
    // alinabiliyordu — "sozlesmeli kurulum" vaadinin tersi. Artik dayatiliyor.
    if (!PURCHASABLE_PLAN_IDS.includes(p.id)) {
      throw new BadRequestException(
        `${p.name_tr} plani kart ile satin alinamaz — satis ekibimizle iletisime gecin.`,
      );
    }

    const usd = cycle === 'annual' ? p.annual_usd : p.monthly_usd;
    if (usd <= 0) throw new BadRequestException(`${p.name_tr} plani satin alinamaz`);

    const fx = await this.fx.getRate();
    return {
      name: p.name_tr,
      /** PayTR'ye gidecek TL tutari */
      price: Math.round(usd * fx.rate),
      priceUsd: usd,
      fxRate: fx.rate,
      fxSource: fx.source,
      fxStale: fx.stale,
    };
  }

  /**
   * Kullaniciya ozel plan fiyati — grandfathered ise eski fiyatla doner, aksi takdirde yeni.
   * checkout/renewal sirasinda kullanilir.
   */
  async getPlanPriceForUser(
    userId: string,
    planId: string,
    cycle: 'monthly' | 'annual',
  ): Promise<{ name: string; price: number; priceUsd: number; fxRate: number; isGrandfathered: boolean }> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { grandfatheredUntil: true, legacyMonthlyPriceTry: true },
    });

    const fresh = await this.getPlanDetails(planId, cycle);
    const now = new Date();
    const isGrandfathered = !!(user.grandfatheredUntil && user.grandfatheredUntil > now);

    // KORUNAN FIYAT TL SABITTIR ve kurdan etkilenmez — musteriye "su fiyattan
    // devam edeceksin" sozu TL cinsinden verilmisti. USD karsiligi bilgi
    // amacli, gunun kuruyla geriye dogru hesaplanir.
    if (isGrandfathered && user.legacyMonthlyPriceTry) {
      const priceTry = cycle === 'annual'
        ? user.legacyMonthlyPriceTry * 10   // 2 ay bedava, eski fiyat uzerinden
        : user.legacyMonthlyPriceTry;
      return {
        name: fresh.name,
        price: priceTry,
        priceUsd: Math.round((priceTry / fresh.fxRate) * 100) / 100,
        fxRate: fresh.fxRate,
        isGrandfathered: true,
      };
    }

    // Grandfathering bitmis veya yok -> gunun kuruyla yeni fiyat
    return {
      name: fresh.name,
      price: fresh.price,
      priceUsd: fresh.priceUsd,
      fxRate: fresh.fxRate,
      isGrandfathered: false,
    };
  }

  /** PayTR success callback — credit pack PAID'e çevir, kullanıcıya kullanım hakkı aç. */
  async confirmVideoCreditPurchase(merchantOid: string): Promise<void> {
    const purchase = await this.prisma.videoCreditPurchase.findUnique({
      where: { merchantOid },
    });
    if (!purchase) {
      this.log.warn(`confirmVideoCreditPurchase: merchantOid bulunamadı: ${merchantOid}`);
      return;
    }
    if (purchase.status === 'PAID' || purchase.status === 'CONSUMED') return;

    await this.prisma.videoCreditPurchase.update({
      where: { id: purchase.id },
      data: {
        status: 'PAID',
        paidAt: new Date(),
      },
    });
    this.log.log(`Video credit purchase confirmed: ${merchantOid} (${purchase.packSize} video)`);
  }

  /**
   * Tek seferlik ödeme için PayTR token + iframe URL üretir.
   * createPaymentToken ile aynı PayTR endpoint'ini kullanır ama subscription değil — bir kerelik ödeme.
   * Webhook PAID'e dönünce confirmVideoCreditPurchase tetiklenir (parseOrderId LVCR prefixini tanır).
   */
  private async createIframeForOneTimePayment(input: {
    merchantOid: string;
    amount: number;     // kuruş cinsinden (örn. 49900 = ₺499)
    userEmail: string;
    userName: string;
    userIp?: string;
    productName: string;
  }): Promise<string> {
    if (!this.merchantId) {
      throw new BadRequestException('PayTR Merchant credentials .env\'de tanımlı değil');
    }

    const userIp = input.userIp ?? '127.0.0.1';
    const userBasket = Buffer.from(JSON.stringify([
      [input.productName, (input.amount / 100).toFixed(2), 1],
    ])).toString('base64');

    const noInstallment = '0';
    const maxInstallment = '0';
    const currency = 'TL';

    const hashStr = `${this.merchantId}${userIp}${input.merchantOid}${input.userEmail}${input.amount}${userBasket}${noInstallment}${maxInstallment}${currency}${this.testMode}${this.merchantSalt}`;
    const paytrToken = createHmac('sha256', this.merchantKey).update(hashStr).digest('base64');

    const formData = new URLSearchParams({
      merchant_id: this.merchantId,
      user_ip: userIp,
      merchant_oid: input.merchantOid,
      email: input.userEmail,
      payment_amount: String(input.amount),
      paytr_token: paytrToken,
      user_basket: userBasket,
      debug_on: '1',
      no_installment: noInstallment,
      max_installment: maxInstallment,
      user_name: input.userName,
      user_address: 'N/A',
      user_phone: '0000000000',
      merchant_ok_url: this.okUrl,
      merchant_fail_url: this.failUrl,
      timeout_limit: '30',
      currency,
      test_mode: this.testMode,
      lang: 'tr',
    });

    const res = await fetch('https://www.paytr.com/odeme/api/get-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString(),
    });

    const data: any = await res.json();
    if (data.status !== 'success') {
      this.log.error(`PayTR one-time token error: ${data.reason}`);
      throw new BadRequestException(`PayTR: ${data.reason}`);
    }

    return `https://www.paytr.com/odeme/guvenli/${data.token}`;
  }

  private generateOrderId(userId: string, planId: string): string {
    const ts = Date.now();
    return `LUVI${userId.slice(0, 8)}${planId.slice(0, 3).toUpperCase()}${ts}`;
  }

  private parseOrderId(orderId: string): { planId: 'starter' | 'pro' | 'agency' } | null {
    if (!orderId.startsWith('LUVI')) return null;
    const planPart = orderId.slice(12, 15);
    const planMap: Record<string, 'starter' | 'pro' | 'agency'> = {
      STA: 'starter', PRO: 'pro', AGE: 'agency',
    };
    const planId = planMap[planPart];
    if (!planId) return null;
    return { planId };
  }
}

export interface StoredCard {
  ctoken: string;
  last4: string | null;
  requireCvv: boolean;
}

/** Direkt API odeme formu — kart alanlari tarayicidan dogrudan PayTR'ye post edilir */
export interface DirectCheckout {
  mode: 'direct';
  action: string;
  fields: Record<string, string>;
  /** Kullanicinin mevcut PayTR utoken'i (varsa kart ayni gruba eklenir) */
  utoken: string | null;
  merchantOid: string;
  amountText: string;
  planName: string;
  cycle: 'monthly' | 'annual';
}
