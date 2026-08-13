import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { AffiliateService } from '../affiliate/affiliate.service.js';
import { EmailService } from '../email/email.service.js';
import { FxService } from './fx.service.js';
import { findPlan } from './plans.js';

/**
 * PayTR iframe API + webhook entegrasyonu.
 * Docs: https://dev.paytr.com/iframe-api
 *
 * Akış:
 *  1. Kullanıcı plan seçer → POST /billing/subscribe → token üret
 *  2. Frontend iframe URL'iyle PayTR ödeme sayfasını açar
 *  3. Kullanıcı ödeme yapar
 *  4. PayTR → POST /webhooks/paytr/notification (status callback)
 *  5. Webhook'ta subscription state güncellenir
 */
@Injectable()
export class PaytrService {
  private readonly log = new Logger(PaytrService.name);

  private readonly merchantId = process.env.PAYTR_MERCHANT_ID ?? '';
  private readonly merchantKey = process.env.PAYTR_MERCHANT_KEY ?? '';
  private readonly merchantSalt = process.env.PAYTR_MERCHANT_SALT ?? '';
  private readonly testMode = process.env.PAYTR_TEST_MODE ?? '1';

  private readonly notifyUrl = process.env.PAYTR_NOTIFICATION_URL
    ?? 'https://api.ranksup.ai/api/billing/webhooks/paytr';
  private readonly okUrl = process.env.PAYTR_OK_URL
    ?? 'https://ranksup.ai/billing/success';
  private readonly failUrl = process.env.PAYTR_FAIL_URL
    ?? 'https://ranksup.ai/billing/failure';

  constructor(
    private readonly prisma: PrismaService,
    private readonly affiliate: AffiliateService,
    private readonly email: EmailService,
    private readonly fx: FxService,
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
  }): Promise<{ token: string; iframeUrl: string; merchantOid: string }> {
    if (!this.merchantId) {
      throw new BadRequestException('PayTR Merchant credentials .env\'de tanımlı değil');
    }

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
        description: `RanksUp ${plan.name} — ${opts.cycle} ($${plan.priceUsd} @ ${plan.fxRate})`,
      },
    });

    return {
      token: data.token,
      iframeUrl: `https://www.paytr.com/odeme/guvenli/${data.token}`,
      merchantOid,
    };
  }

  /**
   * DEV / TEST mode kisayolu: PayTR webhook gelmeden invoice'i PAID yap +
   * plani aktive et. Sadece testMode=1 iken calisir.
   */
  async devConfirmPayment(userId: string, merchantOid: string) {
    if (this.testMode !== '1') {
      throw new BadRequestException('Bu endpoint sadece test modunda kullanilabilir');
    }
    const invoice = await this.prisma.invoice.findUnique({
      where: { paytrTransactionId: merchantOid },
    });
    if (!invoice) throw new BadRequestException('Invoice bulunamadi');
    if (invoice.userId !== userId) throw new BadRequestException('Bu fatura sana ait degil');
    if (invoice.status === 'PAID') return { ok: true, message: 'Zaten odenmis' };

    const parsed = this.parseOrderId(merchantOid);
    if (!parsed) throw new BadRequestException('Gecersiz merchantOid');

    await this.activateSubscription(invoice.userId, parsed.planId, merchantOid);
    await this.prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: 'PAID', paidAt: new Date() },
    });

    // Affiliate komisyonu — gerçek webhook akışıyla aynı behavior (test mode parity)
    try {
      await this.affiliate.recordCommission(invoice.userId, Number(invoice.amount));
    } catch (err: any) {
      this.log.warn(`[${merchantOid}] dev-confirm affiliate commission fail: ${err.message}`);
    }

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

    const parsed = this.parseOrderId(merchant_oid);
    if (!parsed) return 'OK';

    if (status === 'success') {
      await this.activateSubscription(invoice.userId, parsed.planId, merchant_oid);
      await this.prisma.invoice.update({
        where: { id: invoice.id },
        data: { status: 'PAID', paidAt: new Date() },
      });

      // Affiliate komisyon
      await this.affiliate.recordCommission(invoice.userId, Number(invoice.amount));

      // Welcome email
      const user = await this.prisma.user.findUnique({ where: { id: invoice.userId } });
      if (user) {
        await this.email.send({
          userId: user.id,
          to: user.email,
          template: 'plan_upgraded',
          data: {
            name: user.name ?? 'kullanıcı',
            planName: parsed.planId.toUpperCase(),
            articleQuota: parsed.planId === 'starter' ? 10 : parsed.planId === 'pro' ? 50 : 250,
            siteQuota: parsed.planId === 'starter' ? 1 : parsed.planId === 'pro' ? 3 : 10,
          },
        });
      }

      this.log.log(`[${merchant_oid}] ✅ Ödeme başarılı: ${invoice.userId} → ${parsed.planId}`);
    } else {
      await this.prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          status: 'FAILED',
          failedAt: new Date(),
          description: `${invoice.description} — ${failed_reason_code}: ${failed_reason_msg}`,
        },
      });

      // Payment failed mail (fire-and-forget; webhook'u blok etme)
      const failedUser = await this.prisma.user.findUnique({ where: { id: invoice.userId } });
      if (failedUser?.email) {
        this.email.send({
          userId: failedUser.id,
          to: failedUser.email,
          template: 'payment_failed',
          data: {
            name: failedUser.name ?? 'kullanıcı',
            reasonMsg: failed_reason_msg,
            reasonCode: failed_reason_code,
          },
        }).catch((err) => this.log.warn(`payment_failed mail: ${err.message}`));
      }

      this.log.warn(`[${merchant_oid}] ❌ Ödeme başarısız: ${failed_reason_msg}`);
    }

    return 'OK';
  }

  /** Subscription iptal — kullanıcı tarafından çağrılır */
  async cancelSubscription(userId: string) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        subscriptionStatus: 'CANCELED',
      },
    });
    if (user?.email) {
      this.email.send({
        userId: user.id,
        to: user.email,
        template: 'plan_canceled',
        data: {
          name: user.name ?? 'kullanıcı',
          planName: user.plan,
        },
      }).catch((err) => this.log.warn(`plan_canceled mail: ${err.message}`));
    }
    return user;
  }

  private async activateSubscription(
    userId: string,
    planId: 'starter' | 'pro' | 'agency',
    subscriptionId: string,
  ) {
    const planMap = {
      starter: 'STARTER',
      pro: 'PRO',
      agency: 'AGENCY',
    } as const;

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        plan: planMap[planId],
        subscriptionStatus: 'ACTIVE',
        subscriptionId,
        articlesUsedThisMonth: 0,
        articlesQuotaResetAt: new Date(),
      },
    });
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
