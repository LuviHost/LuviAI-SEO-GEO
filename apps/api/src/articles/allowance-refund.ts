import { Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { QuotaService } from '../billing/quota.service.js';
import { ALLOWANCE_CHARGE_KEY, readAllowanceCharge, withAllowanceRefund } from './article-scheduler.service.js';

/**
 * BASARISIZ URETIMIN MAKALE HAKKI IADESI (sahip karari 20.10.2026).
 *
 * Her yazi makale hakkindan uretime alinirken TAM BIR KEZ duser (article-scheduler.service
 * MAKALE HAKKI MUHASEBESI). Uretim makale cikmadan biterse (son denemede hata, takili
 * uretim supurucusunun son karari, baslatilamayan uretim) dusulen hak geri verilir:
 * musteri ortaya cikmayan bir yazi icin hak kaybetmez; deneme hesabinin 2 makalelik
 * hakki da basarisiz bir denemeye gitmez.
 *
 * Iade EDILMEYENLER ve nedenleri:
 *  - REVIZE_NEEDED / READY_TO_PUBLISH: hat bir makale uretti (kalite sonucu ne olursa
 *    olsun LLM harcandi, metin panelde). Basari agentOutputs'u yeniden yazar, hak isareti
 *    kendiliginden silinir; iade edilecek isaret kalmaz.
 *  - Takvime geri konan yazi (supurucu, ARTICLE_GENERATION_DISABLED): isaret yazida kalir,
 *    yeniden uretilirken ikinci kez dusmez. Iade yalniz son karar FAILED oldugunda.
 *  - Kullanici iptalleri (takvimden kaldirma, site / hesap silme): kullanicinin kendi
 *    karari; isaretli bir yazi daha once en az bir kez uretime alinmistir (LLM harcanmis
 *    olabilir) ve "uret → iptal et → iade al" dongusu acilmasin. Kuyrukta bekleyen
 *    uretimi panelden iptal eden bir dugme yok; iptal edilen is (CANCELED) yazisini
 *    GENERATING birakir ve supurucu onu FAILED yapip iade eder: o is hic calismadigi
 *    icin LLM harcanmadi, iade dogru.
 *  - Ucretli planda onboarding'in ucretsiz ilk yazisi ('onboarding_free'): hak dusmedi.
 *  - Hak doneminin disina tasan iade: dusus bu donemde (sayac son sifirlamadan sonra ve,
 *    ucretli planda, ayni takvim ayinda) olmali. Ay donduyse ya da plan degisip sayac
 *    sifirlandiysa yeni donemin sayaci azaltilmaz (bedava hak olurdu).
 *
 * KOTUYE KULLANIM KORUMASI: iade yalniz o denemenin GERCEK dususunun izinden yapilir —
 * tasiyicidaki (yazinin agentOutputs'u ya da kapali dongu guncellemesinde is verisi)
 * allowanceCharge isareti. Isareti yalniz sunucu, hakki dusurdugu anda yazar. Iade
 * isareti siler ve yerine allowanceRefund izini yazar; ayni dusus ikinci kez iade
 * edilemez. Yeniden deneme ("Simdi uret") hakki yeniden dusurur ve yeni isaret yazar.
 *
 * ATOMIKLIK: tasiyicinin guncellemesi "isaretin at degeri hala okunan deger" kosuluna
 * baglidir (MySQL JSON yolu; generating-sweeper'daki is verisi sorgusuyla ayni kalip) ve
 * sayacin azaltilmasi AYNI etkilesimli islemde (transaction) calisir. Es zamanli ya da
 * tekrarlanan iki basarisizlik olayindan (worker'in son denemesi + supurucu, ya da ayni
 * olayin iki kez gelmesi) yalniz biri isareti eslestirir; digeri count 0 alir. Sayac
 * azaltilamazsa (0'da ya da arada sifirlandi) islem geri alinir, isaret yerinde kalir.
 */

const log = new Logger('AllowanceRefund');

/** Isaretin JSON yolu (MySQL): `$.allowanceCharge.at` */
const CHARGE_AT_PATH = `$.${ALLOWANCE_CHARGE_KEY}.at`;

export type AllowanceRefundSkip =
  /** Tasiyicida hak isareti yok (hic dusmedi ya da zaten iade edildi) */
  | 'not_charged'
  /** Ucretli planda onboarding'in ucretsiz ilk yazisi */
  | 'free'
  /** Dusus onceki hak doneminde kaldi (ay dondu ya da sayac plan degisiminde sifirlandi) */
  | 'period_rolled'
  /** Sayac 0'da ya da islem sirasinda sifirlandi: azaltilacak bir sey yok */
  | 'counter_empty'
  /** Tasiyici okuma ile yazma arasinda degisti (baska bir olay iade etti ya da yazi bitti) */
  | 'raced'
  /** Veritabani hatasi: iade yapilmadi (hak kullanicida kalmaz, sayac bir fazla kalir) */
  | 'error';

export type AllowanceRefundDecision =
  | { refund: true; chargeAt: string }
  | { refund: false; reason: AllowanceRefundSkip };

const validDate = (v: unknown): Date | null => {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isFinite(d.getTime()) ? d : null;
};

/**
 * Saf karar: bu tasiyicinin dususu simdi iade edilebilir mi. Ay tanimi QuotaService
 * maybeResetMonthlyQuota ile ayni (sunucu saati, yil + ay); deneme hesabinda (TRIAL)
 * sayac hic sifirlanmadigi icin ay kosulu yok, yalniz "son sifirlamadan sonra dustu".
 */
export function allowanceRefundDecision(input: {
  carrier: unknown;
  plan: string | null | undefined;
  quotaResetAt: Date | string | null | undefined;
  now: Date;
}): AllowanceRefundDecision {
  const charge = readAllowanceCharge(input.carrier);
  if (!charge) return { refund: false, reason: 'not_charged' };
  if (charge.source === 'onboarding_free') return { refund: false, reason: 'free' };
  const chargedAt = validDate(charge.at);
  if (!chargedAt) return { refund: false, reason: 'not_charged' };
  const resetAt = validDate(input.quotaResetAt);
  if (resetAt && chargedAt.getTime() < resetAt.getTime()) return { refund: false, reason: 'period_rolled' };
  if (input.plan !== 'TRIAL') {
    const sameMonth = chargedAt.getFullYear() === input.now.getFullYear() && chargedAt.getMonth() === input.now.getMonth();
    if (!sameMonth) return { refund: false, reason: 'period_rolled' };
  }
  return { refund: true, chargeAt: charge.at };
}

/** Sayac azaltilamadi: etkilesimli islem geri alinsin (tasiyicinin isareti yerinde kalir) */
class CounterNotDecremented extends Error {
  constructor() {
    super('allowance counter not decremented');
  }
}

type RefundDb = Pick<PrismaService, 'article' | 'user' | 'job' | '$transaction'>;
type Tx = Prisma.TransactionClient;

/**
 * Islem icinde sayaci azaltir. Kosullar ATOMIK: sayac 0'in altina inmez ve sayac
 * dususten sonra sifirlandiysa (articlesQuotaResetAt > dusus) azaltilmaz — ay basi
 * sifirlamasi ya da plan degisimi kararla yazma arasinda olsa da yeni donem korunur.
 */
async function decrementInTx(tx: Tx, userId: string, chargeAt: string): Promise<void> {
  const dec = await tx.user.updateMany({
    where: { id: userId, articlesUsedThisMonth: { gt: 0 }, articlesQuotaResetAt: { lte: new Date(chargeAt) } },
    data: { articlesUsedThisMonth: { decrement: 1 } },
  });
  if (dec.count !== 1) throw new CounterNotDecremented();
}

export interface FailGenerationResult {
  /** Yazi bu cagride FAILED oldu */
  failed: boolean;
  /** Dusulen hak bu cagride iade edildi */
  refunded: boolean;
  /** Iade edilmediyse nedeni */
  reason?: AllowanceRefundSkip;
}

/**
 * Uretimi basarisiz biten yaziyi FAILED yapar ve o denemenin hakkini (varsa) iade eder.
 * `where` cagiranin FAILED kosuludur ({ id, status: ... } ve gerekirse fazlasi); iade
 * yolunda bu kosula "hak isareti hala okunan dusus" eklenir. Iade yapilamazsa yazi yine
 * ayni kosulla FAILED yapilir (eski davranis): basarisizlik kaydi iadeye bagli degil.
 */
export async function failGenerationWithRefund(
  prisma: RefundDb,
  args: { articleId: string; where: Prisma.ArticleWhereInput; now?: Date },
): Promise<FailGenerationResult> {
  const now = args.now ?? new Date();
  let reason: AllowanceRefundSkip | undefined;
  try {
    const row = await prisma.article.findUnique({
      where: { id: args.articleId },
      select: { agentOutputs: true, site: { select: { userId: true, user: { select: { plan: true, articlesQuotaResetAt: true } } } } },
    });
    const userId = row?.site?.userId;
    const decision = row && userId
      ? allowanceRefundDecision({ carrier: row.agentOutputs, plan: row.site?.user?.plan, quotaResetAt: row.site?.user?.articlesQuotaResetAt, now })
      : { refund: false as const, reason: 'not_charged' as const };
    if (decision.refund && row && userId) {
      const outcome = await prisma.$transaction(async (tx) => {
        const moved = await tx.article.updateMany({
          where: { ...args.where, agentOutputs: { path: CHARGE_AT_PATH, equals: decision.chargeAt } },
          data: { status: 'FAILED' as any, agentOutputs: withAllowanceRefund(row.agentOutputs, now) as any },
        });
        if (moved.count !== 1) return 'raced' as const;
        await decrementInTx(tx, userId, decision.chargeAt);
        return 'refunded' as const;
      });
      if (outcome === 'refunded') {
        log.log(`[${args.articleId}] Basarisiz uretimin makale hakki iade edildi (${userId}, dusus ${decision.chargeAt})`);
        return { failed: true, refunded: true };
      }
      reason = 'raced';
    } else if (!decision.refund) {
      reason = decision.reason;
    }
  } catch (err: any) {
    if (err instanceof CounterNotDecremented) reason = 'counter_empty';
    else {
      reason = 'error';
      log.warn(`[${args.articleId}] Basarisiz uretimin makale hakki iade edilemedi: ${err?.message ?? err}`);
    }
  }
  // Iade yok (ya da yarista kaybetti): yazi eski kuralla FAILED olur. Yarista kaybettiyse
  // yazi zaten FAILED / bitmis: kosul tutmaz, hicbir sey yazilmaz.
  const moved = await prisma.article.updateMany({ where: args.where, data: { status: 'FAILED' as any } });
  return { failed: moved.count === 1, refunded: false, reason };
}

/**
 * Kapali dongu guncellemesinin (yayindaki yaziyi kullanicinin baslattigi yeniden yazim)
 * hakki: yazi GENERATING olmaz ve basarisizlikta FAILED yapilmaz (eski hali yayinda kalir),
 * bu yuzden dusus izi is verisindedir (Job.payload.allowanceCharge). Son denemede hata
 * veren isin hakki ayni kurallarla, is satirinin is verisi tasiyici olarak iade edilir.
 */
export async function refundJobAllowanceCharge(
  prisma: RefundDb,
  args: { bullJobId: string; now?: Date },
): Promise<{ refunded: boolean; reason?: AllowanceRefundSkip }> {
  const now = args.now ?? new Date();
  try {
    const row = await prisma.job.findUnique({
      where: { bullJobId: args.bullJobId },
      select: { id: true, userId: true, payload: true, user: { select: { plan: true, articlesQuotaResetAt: true } } },
    });
    if (!row) return { refunded: false, reason: 'not_charged' };
    const decision = allowanceRefundDecision({ carrier: row.payload, plan: row.user?.plan, quotaResetAt: row.user?.articlesQuotaResetAt, now });
    if (!decision.refund) return { refunded: false, reason: decision.reason };
    const outcome = await prisma.$transaction(async (tx) => {
      const moved = await tx.job.updateMany({
        where: { id: row.id, payload: { path: CHARGE_AT_PATH, equals: decision.chargeAt } },
        data: { payload: withAllowanceRefund(row.payload, now) as any },
      });
      if (moved.count !== 1) return 'raced' as const;
      await decrementInTx(tx, row.userId, decision.chargeAt);
      return 'refunded' as const;
    });
    if (outcome === 'raced') return { refunded: false, reason: 'raced' };
    log.log(`[job ${args.bullJobId}] Basarisiz kapali dongu guncellemesinin makale hakki iade edildi (${row.userId})`);
    return { refunded: true };
  } catch (err: any) {
    if (err instanceof CounterNotDecremented) return { refunded: false, reason: 'counter_empty' };
    log.warn(`[job ${args.bullJobId}] Basarisiz guncellemenin makale hakki iade edilemedi: ${err?.message ?? err}`);
    return { refunded: false, reason: 'error' };
  }
}

/**
 * Kullanicinin baslattigi uretim BASLATILAMADI (kayit acilamadi ya da is kuyruga
 * girmedi): dusulen hak geri verilir. Yer tutucu acildiysa (hak isaretiyle) iade onun
 * isareti uzerinden yapilir ve yer tutucu FAILED olur. NEDEN: isaretli yer tutucu
 * GENERATING kalirsa takili uretim supurucusu onu sonra FAILED yapip AYNI hakki bir kez
 * daha iade ederdi.
 *  - Isaretli iade veritabani hatasiyla yapilamadi ama yer tutucu FAILED oldu: supurucu
 *    FAILED yaziya dokunmaz, duz iade guvenli (tek iade).
 *  - Yer tutucu FAILED de yapilamadi (veritabani yok): GENERATING kalir ve supurucu onu
 *    isaretiyle iade eder; burada sayac azaltilmaz (cift iade olmasin).
 * Yer tutucu hic acilmadiysa duz iade (QuotaService.refundArticleAllowance).
 */
export async function settleUnstartedGeneration(
  prisma: RefundDb,
  quota: Pick<QuotaService, 'refundArticleAllowance'>,
  args: { userId: string; articleId?: string | null },
): Promise<void> {
  if (!args.articleId) {
    await quota.refundArticleAllowance(args.userId);
    return;
  }
  let r: FailGenerationResult;
  try {
    r = await failGenerationWithRefund(prisma, { articleId: args.articleId, where: { id: args.articleId, status: 'GENERATING' as any } });
  } catch (err: any) {
    log.warn(`[${args.articleId}] Baslatilamayan uretimin yer tutucusu kapatilamadi; takili uretim supurucusu iade eder: ${err?.message ?? err}`);
    return;
  }
  if (!r.refunded && r.failed && r.reason === 'error') await quota.refundArticleAllowance(args.userId);
}
