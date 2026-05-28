import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { AffiliateService } from '../affiliate/affiliate.service.js';
import { EmailService } from '../email/email.service.js';

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
    ?? 'https://api.ai.luvihost.com/api/billing/webhooks/paytr';
  private readonly okUrl = process.env.PAYTR_OK_URL
    ?? 'https://ai.luvihost.com/billing/success';
  private readonly failUrl = process.env.PAYTR_FAIL_URL
    ?? 'https://ai.luvihost.com/billing/failure';

  constructor(
    private readonly prisma: PrismaService,
    private readonly affiliate: AffiliateService,
    private readonly email: EmailService,
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

    const plan = this.getPlanDetails(opts.planId, opts.cycle);
    const merchantOid = this.generateOrderId(opts.userId, opts.planId);

    const paymentAmount = Math.round(plan.price * 100);

    const userBasket = Buffer.from(JSON.stringify([
      [`LuviAI ${plan.name} ${opts.cycle === 'annual' ? 'Yıllık' : 'Aylık'}`, plan.price.toFixed(2), 1],
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
        status: 'PENDING',
        description: `LuviAI ${plan.name} — ${opts.cycle}`,
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
  private getPlanDetails(planId: string, cycle: 'monthly' | 'annual') {
    const plans: Record<string, { name: string; monthly: number; annual: number }> = {
      starter:    { name: 'Başlangıç',     monthly: 1499,  annual: 14990 },
      pro:        { name: 'Profesyonel',   monthly: 4999,  annual: 49990 },
      agency:     { name: 'Ajans',         monthly: 14999, annual: 149990 },
      enterprise: { name: 'Kurumsal',      monthly: 34999, annual: 349990 },
    };
    const p = plans[planId];
    if (!p) throw new BadRequestException(`Bilinmeyen plan: ${planId}`);
    return {
      name: p.name,
      price: cycle === 'annual' ? p.annual : p.monthly,
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
  ): Promise<{ name: string; price: number; isGrandfathered: boolean }> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { grandfatheredUntil: true, legacyMonthlyPriceTry: true },
    });

    const now = new Date();
    const isGrandfathered = !!(user.grandfatheredUntil && user.grandfatheredUntil > now);

    if (isGrandfathered && user.legacyMonthlyPriceTry && cycle === 'monthly') {
      return {
        name: this.getPlanDetails(planId, cycle).name,
        price: user.legacyMonthlyPriceTry,
        isGrandfathered: true,
      };
    }
    if (isGrandfathered && user.legacyMonthlyPriceTry && cycle === 'annual') {
      // Annual: aylık fiyat × 10 (2 ay bedava) — eski fiyat üzerinden
      return {
        name: this.getPlanDetails(planId, cycle).name,
        price: user.legacyMonthlyPriceTry * 10,
        isGrandfathered: true,
      };
    }

    // Grandfathering bitmiş veya yok → yeni fiyat
    const fresh = this.getPlanDetails(planId, cycle);
    return { ...fresh, isGrandfathered: false };
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Video Credit Add-on Purchase (2026-05)
  // ──────────────────────────────────────────────────────────────────────
  /** Mevcut credit pack'leri (sabit). */
  static readonly CREDIT_PACKS = {
    '5':  { packSize: 5,  priceTry: 499 },
    '20': { packSize: 20, priceTry: 1799 },
    '50': { packSize: 50, priceTry: 3999 },
  } as const;

  /**
   * Video credit pack satin alma baslangici. PayTR iframe URL'i döner.
   * Webhook PAID olunca creditsTotal aktif olur.
   */
  async startVideoCreditPurchase(input: {
    userId: string;
    packKey: '5' | '20' | '50';
    userEmail: string;
    userName: string;
    userIp?: string;
  }): Promise<{ iframeUrl: string; merchantOid: string }> {
    const pack = PaytrService.CREDIT_PACKS[input.packKey];
    if (!pack) throw new BadRequestException(`Bilinmeyen credit pack: ${input.packKey}`);

    const merchantOid = `LVCR${input.userId.slice(0, 8)}${input.packKey.padStart(2, '0')}${Date.now()}`;
    const amountKurus = pack.priceTry * 100;

    // DB'ye PENDING kayit
    await this.prisma.videoCreditPurchase.create({
      data: {
        userId: input.userId,
        packSize: pack.packSize,
        priceTry: pack.priceTry,
        creditsTotal: pack.packSize,
        creditsUsed: 0,
        merchantOid,
        status: 'PENDING',
      },
    });

    // PayTR iframe oluştur (one-time payment akisi, LVCR prefix webhook handler tarafindan tanir)
    const iframeUrl = await this.createIframeForOneTimePayment({
      merchantOid,
      amount: amountKurus,
      userEmail: input.userEmail,
      userName: input.userName,
      userIp: input.userIp,
      productName: `LuviAI Video Credit Pack — ${pack.packSize} video`,
    });

    return { iframeUrl, merchantOid };
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
