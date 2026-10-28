import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { PaytrService } from '../billing/paytr.service.js';
import { EmailService } from '../email/email.service.js';
import { ApiKeysService } from '../api-keys/api-keys.service.js';
import { JobQueueService } from '../jobs/job-queue.service.js';
import { AppleSiwaService, type AppleRevokeOutcome } from '../auth/apple-siwa.service.js';
import {
  ACCOUNT_PURGE_AFTER_DAYS,
  DELETE_ACCOUNT_CONFIRMATION,
  deletionBlockers,
  deletionSummary,
  formatTrDate,
  maskEmail,
  purgeAfter,
  shouldCancelSubscription,
} from './account-deletion.policy.js';
import { deletionRequestedEmail } from './account-deletion.emails.js';

export interface DeletionRequestResult {
  ok: true;
  /** Es zamanli ikinci istek (cift tiklama) — ilk talebin sonucu doner */
  alreadyRequested: boolean;
  deletionRequestedAt: string;
  purgeAfter: string;
  purgeAfterDays: number;
  /** Apple ile Giris token iptali sonucu; ikinci istekte null */
  apple: AppleRevokeOutcome | null;
}

/**
 * Talep aninda hesabi dondurur: otomasyon durur, ucuncu taraf baglanti bilgileri
 * silinir, icerik 30 gun sonra kalici silinene kadar dokunulmadan bekler.
 *
 * NEDEN DONDURMA SART: "erisim hemen kapanir" demek yetmez — arka plan isleri
 * (zamanlanmis makale yayini, sosyal paylasim, Google/Meta reklam otopilotu,
 * ASA teklif otopilotu, haftalik e-postalar) 30 gun boyunca hesabi kapatmis
 * birinin sitesine ve butcesine dokunmaya devam ederdi. Cron'larin cogu site
 * durumuna (ACTIVE/AUDIT_COMPLETE) ve otopilot bayraklarina bakar; e-posta
 * cron'lari emailVerified dolu kullaniciyi secer. Baglanti bilgisi olmadan da
 * hicbir dis yazma yapilamaz. Gizlilik metni sosyal kanal token'larinin
 * "30 gun icinde" silinecegini taahhut ediyor; burada hemen silinir.
 */
export async function freezeAccountData(db: Prisma.TransactionClient, userId: string) {
  const ofUser = { site: { userId } };
  const sites = await db.site.updateMany({
    where: { userId },
    data: {
      status: 'PAUSED',
      autopilot: false,
      autoGenerationEnabled: false,
      adsAutopilot: false,
      publishApprovalMode: 'manual_approve',
      notifyWebhookUrl: null,
      notifyWebhookKind: null,
      ingestSecret: null,
      gscRefreshToken: null,
      gaRefreshToken: null,
      googleAdsRefreshToken: null,
      metaAdsAccessToken: null,
    },
  });
  // Zamanlanmis makaleler (PROCESS_SCHEDULED site durumuna bakmaz) taslaga doner
  const articles = await db.article.updateMany({ where: { ...ofUser, status: 'SCHEDULED' }, data: { status: 'DRAFT' } });
  // Yayin hedefi kaydi = musteri sitesinin sifreli giris bilgisi; baska tablo ona bagli degil
  const publishTargets = await db.publishTarget.deleteMany({ where: ofUser });
  const aiKeys = await db.siteAiProviderKey.deleteMany({ where: ofUser });
  // Google Isletme Profili OAuth anahtari (business.manage): Kosullar baglanti bilgilerinin
  // silme talebinde hemen kaldirilacagini soyluyor. gbp.service baglantiKes ile ayni alanlar;
  // placeId (Places kimligi, giris bilgisi degil) kalici silmeye kadar kalir.
  await db.siteGbp.updateMany({
    where: ofUser,
    data: { refreshToken: null, hesap: null, konum: null, konumAdi: null, oauthAt: null },
  });
  const channels = await db.socialChannel.updateMany({
    where: ofUser,
    data: { isActive: false, credentials: '', externalName: null, externalAvatar: null },
  });
  await db.socialRecurringSlot.updateMany({ where: { channel: ofUser }, data: { isActive: false } });
  const posts = await db.socialPost.updateMany({
    where: { channel: ofUser, status: { in: ['NEEDS_APPROVAL', 'APPROVED', 'QUEUED'] } },
    data: { status: 'CANCELED' },
  });
  await db.asaAccount.updateMany({
    where: ofUser,
    data: { isActive: false, autoPilotEnabled: false, encryptedKey: '', tokenCacheValue: null, tokenCacheExpAt: null },
  });
  await db.ascAccount.updateMany({
    where: ofUser,
    data: { isActive: false, encryptedKey: '', tokenCacheValue: null, tokenCacheExpAt: null },
  });
  await db.sdkAppConfig.updateMany({ where: ofUser, data: { isActive: false } });
  // Gunluk siralama taramasi (aso tracker) site durumuna degil uygulamanin isActive'ine bakar
  await db.trackedApp.updateMany({ where: ofUser, data: { isActive: false } });
  // Kuyruktaki isler: DB'de iptal; BullMQ karsiliklari commit sonrasi kuyruktan silinir
  const queued = await db.job.findMany({ where: { userId, status: 'QUEUED', bullJobId: { not: null } }, select: { bullJobId: true } });
  const jobs = await db.job.updateMany({ where: { userId, status: 'QUEUED' }, data: { status: 'CANCELED' } });
  return {
    queuedBullJobIds: queued.map((j) => j.bullJobId).filter((id): id is string => !!id),
    sites: sites.count,
    scheduledArticles: articles.count,
    publishTargets: publishTargets.count,
    aiKeys: aiKeys.count,
    socialChannels: channels.count,
    canceledPosts: posts.count,
    canceledJobs: jobs.count,
  };
}

@Injectable()
export class AccountDeletionService {
  private readonly log = new Logger(AccountDeletionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paytr: PaytrService,
    private readonly email: EmailService,
    private readonly apiKeys: ApiKeysService,
    private readonly apple: AppleSiwaService,
    private readonly queue: JobQueueService,
  ) {}

  /** Silme ekraninin ihtiyac duydugu bilgi: hangi hesap, engel var mi, abonelik, Apple baglantisi */
  async status(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true, plan: true, subscriptionStatus: true },
    });
    if (!user) throw new NotFoundException('Hesap bulunamadı');
    const [clientCount, accounts, siteCount] = await Promise.all([
      this.prisma.user.count({ where: { parentAgencyId: userId } }),
      this.prisma.account.findMany({ where: { userId }, select: { provider: true, refresh_token: true } }),
      this.prisma.site.count({ where: { userId } }),
    ]);
    const apple = accounts.filter((a) => a.provider === 'apple');
    return {
      // Silinecek hesabin kimligi: yanlis hesapla girip bos bir hesabi silmeyi
      // onlemek icin ekran "a***@gmail.com · 3 site" gosterir (bkz. maskEmail)
      maskedEmail: maskEmail(user.email),
      siteCount,
      purgeAfterDays: ACCOUNT_PURGE_AFTER_DAYS,
      confirmation: DELETE_ACCOUNT_CONFIRMATION,
      blockers: deletionBlockers({ role: user.role, clientCount }),
      subscriptionActive: shouldCancelSubscription(user.subscriptionStatus),
      plan: user.plan,
      signInProviders: [...new Set(accounts.map((a) => a.provider))],
      apple: {
        linked: apple.length > 0,
        // Sunucu iptal edebilir mi; edemiyorsa uygulama silme aninda taze yetki kodu ister
        configured: this.apple.configured,
        tokenStored: apple.some((a) => !!a.refresh_token),
      },
    };
  }

  /**
   * Ajans sahibinin musteri hesaplarini ajanstan ayirir (silme oncesi). Musteri
   * hesaplari, siteleri ve verileri SILINMEZ; yalniz parentAgencyId kalkar.
   */
  async detachAgencyClients(userId: string, confirm: unknown): Promise<{ detached: number }> {
    if (confirm !== true) throw new BadRequestException('Onay eksik.');
    const res = await this.prisma.user.updateMany({ where: { parentAgencyId: userId }, data: { parentAgencyId: null } });
    this.log.log(`[${userId}] ${res.count} müşteri hesabı ajanstan ayrıldı (silme öncesi)`);
    return { detached: res.count };
  }

  async requestDeletion(
    userId: string,
    input: { confirm?: unknown; appleAuthorizationCode?: unknown },
  ): Promise<DeletionRequestResult> {
    if (input?.confirm !== DELETE_ACCOUNT_CONFIRMATION) {
      throw new BadRequestException('Silme onayı eksik.');
    }
    const code = typeof input.appleAuthorizationCode === 'string' && input.appleAuthorizationCode.trim()
      ? input.appleAuthorizationCode.trim().slice(0, 1024)
      : null;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, role: true, plan: true, subscriptionStatus: true, deletionRequestedAt: true },
    });
    if (!user) throw new NotFoundException('Hesap bulunamadı');
    if (user.deletionRequestedAt) {
      return { ok: true, alreadyRequested: true, ...deletionSummary(user.deletionRequestedAt), apple: null };
    }

    const clientCount = await this.prisma.user.count({ where: { parentAgencyId: userId } });
    const blockers = deletionBlockers({ role: user.role, clientCount });
    if (blockers.length > 0) {
      throw new ConflictException({ statusCode: 409, message: blockers[0].message, code: blockers[0].code, blockers });
    }

    const now = new Date();
    const committed = await this.prisma.$transaction(async (tx) => {
      // Kosullu yazim: es zamanli iki istekten yalniz biri talebi "sahiplenir"
      const claimed = await tx.user.updateMany({
        where: { id: userId, deletionRequestedAt: null },
        data: {
          deletionRequestedAt: now,
          autoRenew: false,
          // PayTR kart-saklama anahtari: onsuz kayitli karttan cekim yapilamaz
          paytrUtoken: null,
          // E-posta cron'lari (karsilama, deneme bitisi, fiyat bildirimi) emailVerified dolu kullaniciyi secer
          emailVerified: null,
        },
      });
      if (claimed.count === 0) return null;

      // Plan TRIAL'da iptal edilecek ucretli abonelik yok (cancelSubscription 400 atar ve
      // transaction'i dusururdu; tutarsiz eski satir: plan TRIAL + durum ACTIVE/PAST_DUE)
      const subscriptionCanceled = shouldCancelSubscription(user.subscriptionStatus) && user.plan !== 'TRIAL';
      if (subscriptionCanceled) {
        // Tek iptal tanimi billing'de; "donem sonuna kadar acik" e-postasi silmede yanlis olurdu
        await this.paytr.cancelSubscription(userId, { notify: false, db: tx });
      }
      // Apple iptali icin saklanan token, hesap token'lari temizlenmeden ONCE okunur
      const appleAccounts = await tx.account.findMany({
        where: { userId, provider: 'apple' },
        select: { providerAccountId: true, refresh_token: true },
      });
      const revokedKeys = await this.apiKeys.revokeAllForUser(userId, tx, now);
      await tx.session.deleteMany({ where: { userId } });
      // OAuth hesap satiri kalir (silinene kadar tekrar giris denemesini tanimak icin), token'lar gider
      await tx.account.updateMany({ where: { userId }, data: { access_token: null, refresh_token: null, id_token: null } });
      const frozen = await freezeAccountData(tx, userId);
      return { appleAccounts, revokedKeys, frozen, subscriptionCanceled };
    }, { maxWait: 10_000, timeout: 30_000 });

    if (!committed) {
      const fresh = await this.prisma.user.findUnique({ where: { id: userId }, select: { deletionRequestedAt: true } });
      return { ok: true, alreadyRequested: true, ...deletionSummary(fresh?.deletionRequestedAt ?? now), apple: null };
    }

    // Bekleyen/ertelenmis kuyruk isleri (zamanlanmis makale uretimi vb.) calismasin — en iyi caba
    for (const id of committed.frozen.queuedBullJobIds) {
      await this.queue.removeJob(id).catch(() => false);
    }

    const apple = await this.apple.revokeForDeletion({
      appleSubs: committed.appleAccounts.map((a) => a.providerAccountId),
      storedTokens: committed.appleAccounts.map((a) => a.refresh_token).filter((t): t is string => !!t),
      code,
    });

    this.log.log(
      `Hesap silme talebi: ${userId} — ${committed.revokedKeys} API anahtarı iptal, ${committed.frozen.sites} site donduruldu, ` +
        `${committed.frozen.publishTargets} yayın hedefi silindi, Apple: ${apple}`,
    );
    await this.sendRequestedEmail(user, now, committed.subscriptionCanceled);
    return { ok: true, alreadyRequested: false, ...deletionSummary(now), apple };
  }

  private async sendRequestedEmail(
    user: { id: string; email: string; name: string | null },
    requestedAt: Date,
    subscriptionCanceled: boolean,
  ) {
    try {
      const { subject, html } = deletionRequestedEmail({
        name: user.name,
        email: user.email,
        purgeAfterText: formatTrDate(purgeAfter(requestedAt)),
        subscriptionCanceled,
        baseUrl: process.env.WEB_BASE_URL,
      });
      await this.email.sendRaw({ userId: user.id, to: user.email, subject, html });
    } catch (err: any) {
      this.log.warn(`Silme talebi e-postası gönderilemedi (${user.id}): ${String(err?.message ?? err).slice(0, 160)}`);
    }
  }
}
