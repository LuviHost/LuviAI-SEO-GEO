import { Injectable, Logger, BadRequestException, NotFoundException, HttpException, HttpStatus } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { EmailService } from '../email/email.service.js';
import { kacisla } from '../email/email-layout.js';
import { PublicCitationService, baselineQuestionSet, type RetestComparison } from './public-citation.service.js';
import { normalizePublicDomainInput } from '../sites/site-url-policy.js';
import {
  SUBSCRIBE_CHECK_MAX_AGE_MS,
  SUBSCRIBE_EMAIL_LIMIT_MESSAGE,
  SUBSCRIBE_WELCOME_PER_EMAIL,
} from './public-subscribe-limits.js';

/** Marka alani tavani — public kontrolun marka cikarimiyla ayni (extractBrandFromHtml: 80). */
export const SUBSCRIBE_BRAND_MAX_LEN = 80;

/**
 * Abone e-postasi bicim denetimi: tek @, bosluksuz, alan adinda nokta;
 * baslik/HTML'e karisabilecek karakterler (<>()[]\,;:") reddedilir. RFC 5321
 * tavanlari: adres 254, yerel kisim 64 karakter.
 */
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:".]{2,}$/;

export function normalizeSubscriberEmail(raw: unknown): string | null {
  const email = (typeof raw === 'string' ? raw : '').trim().toLowerCase();
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) return null;
  if (email.indexOf('@') > 64) return null;
  return email;
}

/**
 * Public AI Citation Subscriber — email-based retest abonelik
 *
 * Akis:
 *   1. Ziyaretci test sonucu modal'inda email birakir → subscribe()
 *   2. Welcome email gonderilir, double-opt-in confirmToken iceren link
 *   3. Confirm linkine tiklarsa status: ACTIVE + ilk retest +15 gun zamanlanir
 *   4. Cron her gun 09:00 UTC: ACTIVE + nextRetestAt <= now subscribers'i bulur,
 *      retest yapar, branded email gonderir, sonraki retest'i zamanlar
 *   5. 4 retest sonra (15/30/60/90g) cycle biter, status: COMPLETED
 *   6. Kullanici RanksUp'a kayit olursa OAuth callback'ten linkSignup() cagrilir,
 *      status: SIGNED_UP, retest durur
 */

// Retest schedule: ilk welcome'dan sonra bu intervallerde retest gonder
const RETEST_INTERVALS_DAYS = [15, 15, 30, 30]; // 15, 30, 60, 90 (cumulative)

export interface SubscribeInput {
  email: string;
  domain: string;
  /**
   * Istemcinin gordugu marka — yalniz uzunluk denetlenir. Kayda ve e-postaya
   * alan adinin son kontrol kaydindaki marka yazilir (subscribe notu).
   */
  brand?: string;
  /** Geriye uyumluluk icin alinir ama kullanilmaz: nis de kontrol kaydindan okunur. */
  niche?: string;
  customNiche?: string;
  locale?: string;
}

export interface SubscribeLimits {
  /** Ayni adrese 24 saatte en fazla kac onay e-postasi (tum alan adlari toplami). */
  welcomePerEmail: number;
}

@Injectable()
export class PublicCitationSubscriberService {
  private readonly log = new Logger(PublicCitationSubscriberService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly citation: PublicCitationService,
  ) {}

  /**
   * Yeni abonelik baslat — double-opt-in welcome email gonder.
   *
   * MARKA VE NIS ISTEMCIDEN ALINMAZ: eskiden formdan gelen serbest metin
   * (uzunluk siniri yok) e-posta konusuna ve govdesine yaziliyordu — bizim
   * gondericimizden istenen adrese istenen metin. Artik alan adinin son 7
   * gundeki kontrol kaydindaki marka (extractBrandFromHtml, en fazla 80
   * karakter) kullanilir; kayit yoksa abonelik baslamaz. Mesru akista kayit
   * hep vardir: form yalniz sonuc ekraninda cikar ve sonuc ya yeni yazilmis
   * ya da en fazla 24 saatlik onbellek kaydidir. Bu kayit retest'in tabanidir
   * (PublicCitationService.findRetestBaseline).
   *
   * Adres basina 24 saatte en fazla `limits.welcomePerEmail` onay e-postasi
   * (PublicCitationEmailLog'dan, tum alan adlari toplami): IP degistirerek
   * ayni adrese e-posta yagdirilamaz.
   */
  async subscribe(
    input: SubscribeInput,
    limits: SubscribeLimits = { welcomePerEmail: SUBSCRIBE_WELCOME_PER_EMAIL },
  ): Promise<{ ok: true; status: string; alreadyActive: boolean }> {
    const email = normalizeSubscriberEmail(input.email);
    if (!email) throw new BadRequestException('Geçerli bir e-posta adresi girin.');
    // check() ile ayni alan adi kurali (IP, port, tek etiketli ad reddedilir;
    // Turkce 400 mesaji) — kayit anahtari kontrol kayitlariyla birebir eslesir.
    const { host: domain } = normalizePublicDomainInput(input.domain);
    if (typeof input.brand === 'string' && input.brand.length > SUBSCRIBE_BRAND_MAX_LEN) {
      throw new BadRequestException(`Marka adı en fazla ${SUBSCRIBE_BRAND_MAX_LEN} karakter olabilir.`);
    }

    const lastCheck = await this.prisma.publicCitationCheck.findFirst({
      where: { domain, createdAt: { gte: new Date(Date.now() - SUBSCRIBE_CHECK_MAX_AGE_MS) } },
      orderBy: { createdAt: 'desc' },
      select: { brand: true, niche: true, customNiche: true },
    });
    const brand = (lastCheck?.brand ?? '').trim().slice(0, SUBSCRIBE_BRAND_MAX_LEN);
    if (!lastCheck || brand.length < 2) {
      throw new BadRequestException('Takibi başlatmak için önce bu alan adı için ücretsiz testi çalıştırın.');
    }

    const existing = await this.prisma.publicCitationSubscriber.findUnique({
      where: { email_domain: { email, domain } },
    });

    // Daha onceden aktif → tekrar welcome gonderme
    if (existing && existing.status === 'ACTIVE') {
      return { ok: true, status: 'ACTIVE', alreadyActive: true };
    }

    const sentRecently = await this.prisma.publicCitationEmailLog.count({
      where: {
        type: 'welcome',
        sentAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        subscriber: { is: { email } },
      },
    });
    if (sentRecently >= limits.welcomePerEmail) {
      throw new HttpException(SUBSCRIBE_EMAIL_LIMIT_MESSAGE, HttpStatus.TOO_MANY_REQUESTS);
    }

    const confirmToken = randomBytes(24).toString('hex');
    const unsubscribeToken = existing?.unsubscribeToken ?? randomBytes(24).toString('hex');
    const locale = (input.locale === 'en' ? 'en' : 'tr');
    const niche = lastCheck.niche ?? undefined;
    const customNiche = lastCheck.customNiche ?? undefined;

    const sub = await this.prisma.publicCitationSubscriber.upsert({
      where: { email_domain: { email, domain } },
      create: {
        email, domain,
        brand,
        niche,
        customNiche,
        status: 'PENDING_OPTIN',
        confirmToken,
        unsubscribeToken,
        consentAt: new Date(),
        locale,
      },
      update: {
        brand,
        niche,
        customNiche,
        confirmToken,
        consentAt: new Date(),
        status: 'PENDING_OPTIN',
        locale,
        // YENI abonelik = yeni 15/30/60/90 gun dongusu (hos geldin e-postasi
        // bunu vaat eder). Sayac sifirlanmasaydi biten ya da yarida birakilan
        // aboneligi yeniden onaylayan kisi hic rapor almazdi (cron
        // retestsSent < 4 arar). Zamanlama onayda (confirm) kurulur.
        retestsSent: 0,
        nextRetestAt: null,
      },
    });

    // Welcome email + double-opt-in link
    await this.sendWelcomeEmail(sub).catch((err) => {
      this.log.warn(`Welcome email fail (${email}): ${err.message}`);
    });

    return { ok: true, status: sub.status, alreadyActive: false };
  }

  /** Double-opt-in confirm — tokenli link'e tiklayinca calisir */
  async confirm(confirmToken: string): Promise<{ ok: true; domain: string }> {
    const sub = await this.prisma.publicCitationSubscriber.findUnique({
      where: { confirmToken },
    });
    if (!sub) throw new NotFoundException('Gecersiz veya kullanilmis confirm linki');
    if (sub.status === 'UNSUBSCRIBED' || sub.status === 'BOUNCED') {
      throw new BadRequestException('Bu abonelik artik aktif degil');
    }

    const nextRetest = new Date(Date.now() + RETEST_INTERVALS_DAYS[0] * 24 * 60 * 60 * 1000);
    await this.prisma.publicCitationSubscriber.update({
      where: { id: sub.id },
      data: {
        status: 'ACTIVE',
        confirmedAt: new Date(),
        confirmToken: null,
        nextRetestAt: nextRetest,
      },
    });
    return { ok: true, domain: sub.domain };
  }

  /** Aboneliği iptal — token'li link'e tiklayinca calisir */
  async unsubscribe(unsubscribeToken: string): Promise<{ ok: true; domain: string }> {
    const sub = await this.prisma.publicCitationSubscriber.findUnique({
      where: { unsubscribeToken },
    });
    if (!sub) throw new NotFoundException('Gecersiz unsubscribe linki');
    await this.prisma.publicCitationSubscriber.update({
      where: { id: sub.id },
      data: { status: 'UNSUBSCRIBED', nextRetestAt: null },
    });
    return { ok: true, domain: sub.domain };
  }

  /**
   * Cron: nextRetestAt <= now olan tum ACTIVE subscriber'lari isle.
   * Her birine taze olcum yap + branded email at + sonraki retest zamani planla.
   *
   * AYNI SORULAR: retest, abonelik tabaninin (abonelik anina en yakin anonim
   * kayit) soru listesini, markasini ve nisini aynen yeniden sorar ve yalniz
   * o tabanla kiyaslar. Eskiden her retest nis tespitini yeniden calistirip
   * yeni sorular uretiyor, sonra alan adinin en yeni kaydini zaman penceresinden
   * secilen BASKA bir kayitla (farkli sorular, belki farkli kademe) kiyasliyordu.
   * Soru seti, kademe ya da yontem farkliysa kiyas yapilmaz (compareRetest).
   */
  async runScheduledRetests(): Promise<{ processed: number; sent: number; failed: number }> {
    const now = new Date();
    const due = await this.prisma.publicCitationSubscriber.findMany({
      where: {
        status: 'ACTIVE',
        nextRetestAt: { lte: now },
        retestsSent: { lt: RETEST_INTERVALS_DAYS.length },
      },
      take: 100, // batch limit
    });

    let sent = 0;
    let failed = 0;
    for (const sub of due) {
      try {
        // 1) Taban: abonenin gordugu sonuc (abonelik anina en yakin anonim kayit).
        // consentAt her abone olusta yenilenir; yoksa ilk kayit ani.
        const subscribedAt = sub.consentAt ?? sub.createdAt;
        const baseline = await this.citation.findRetestBaseline(sub.domain, subscribedAt);
        const fixed = baseline ? baselineQuestionSet(baseline) : null;

        // 2) Taze olcum (system-source, cache bypass) — tabanin soru setiyle
        const fresh = await this.citation.check(sub.domain, '', 'retest_cron', fixed ? { fixed } : {});

        // 3) Kiyas: ayni soru seti + ayni kademe + ayni yontem surumu sarti.
        // Tutmazsa cmp.methodChanged=true ve delta yoktur: e-posta yon/fark
        // yerine notr not tasir (sahte dusus/artis yok).
        const cmp = this.citation.compareWithBaseline(
          { createdAt: new Date(), brand: fresh.brand, result: fresh },
          baseline,
        );

        // 4) Email gonder
        const intervalLabel = this.getIntervalLabel(sub.retestsSent);
        await this.sendRetestEmail(sub, intervalLabel, cmp, fresh.checkId);

        // 5) Subscriber state update
        const nextIdx = sub.retestsSent + 1;
        const isLast = nextIdx >= RETEST_INTERVALS_DAYS.length;
        const nextRetest = isLast ? null : new Date(Date.now() + RETEST_INTERVALS_DAYS[nextIdx] * 24 * 60 * 60 * 1000);
        await this.prisma.publicCitationSubscriber.update({
          where: { id: sub.id },
          data: {
            retestsSent: nextIdx,
            nextRetestAt: nextRetest,
            status: isLast ? 'COMPLETED' : 'ACTIVE',
          },
        });
        sent++;
      } catch (err: any) {
        this.log.warn(`Retest fail (${sub.id}/${sub.email}/${sub.domain}): ${err.message}`);
        failed++;
      }
    }

    return { processed: due.length, sent, failed };
  }

  /** OAuth signup callback'ten cagrilir — eger ziyaretci ayni email ile kayit olduysa subscriber'i isaretle */
  async linkSignup(userId: string, email: string): Promise<{ linked: number }> {
    const normalized = email.trim().toLowerCase();
    const subs = await this.prisma.publicCitationSubscriber.findMany({
      where: { email: normalized, status: { in: ['ACTIVE', 'PENDING_OPTIN', 'COMPLETED'] } },
    });
    let linked = 0;
    for (const s of subs) {
      await this.prisma.publicCitationSubscriber.update({
        where: { id: s.id },
        data: {
          status: 'SIGNED_UP',
          signupUserId: userId,
          signupAt: new Date(),
          nextRetestAt: null, // retest cron'u durdur
        },
      });
      linked++;
    }
    return { linked };
  }

  /**
   * Bir kullanicinin signup oncesi yapmis oldugu testlerin journey'sini don.
   *
   * delta yalniz ilk ve son kayit AYNI olcum yontemiyle olculduyse doner;
   * aksi halde methodChanged=true ve delta yok (fark yontemden gelebilir,
   * bkz. PublicCitationService.compareWithPast).
   */
  async getJourneyForUser(userId: string): Promise<Array<{
    domain: string;
    brand: string;
    history: Array<{ createdAt: Date; totalCited: number; total: number; matchVersion: number }>;
    delta?: { before: number; after: number; total: number };
    methodChanged: boolean;
  }>> {
    const subs = await this.prisma.publicCitationSubscriber.findMany({
      where: { signupUserId: userId },
    });
    const out: Array<{
      domain: string;
      brand: string;
      history: Array<{ createdAt: Date; totalCited: number; total: number; matchVersion: number }>;
      delta?: { before: number; after: number; total: number };
      methodChanged: boolean;
    }> = [];
    for (const s of subs) {
      const history = await this.citation.getHistory(s.domain, 50);
      const reversed = history.slice().reverse();
      const first = history[history.length - 1];
      const last = history[0];
      const methodChanged = history.length >= 2 && first.matchVersion !== last.matchVersion;
      const cmp = history.length >= 2 && !methodChanged
        ? { before: first.totalCitedScore, after: last.totalCitedScore, total: last.totalProviders }
        : undefined;
      out.push({
        domain: s.domain,
        brand: s.brand,
        history: reversed.map((h) => ({ createdAt: h.createdAt, totalCited: h.totalCitedScore, total: h.totalProviders, matchVersion: h.matchVersion })),
        delta: cmp,
        methodChanged,
      });
    }
    return out;
  }

  // ──────────────────────────────────────────────
  //  EMAIL HELPERS
  // ──────────────────────────────────────────────
  private async sendWelcomeEmail(sub: { id: string; email: string; domain: string; brand: string; confirmToken: string | null; unsubscribeToken: string; locale: string }) {
    const baseUrl = process.env.WEB_URL ?? 'https://ranksup.ai';
    const confirmUrl = `${baseUrl}/api/public/citation-check/confirm?token=${sub.confirmToken}`;
    const unsubscribeUrl = `${baseUrl}/api/public/citation-check/unsubscribe?token=${sub.unsubscribeToken}`;

    const tr = sub.locale === 'tr';
    const subject = tr
      ? `${sub.brand} için AI Visibility takibiniz başlamak üzere`
      : `Confirm your ${sub.brand} AI Visibility tracking`;

    const html = this.welcomeEmailHtml({ brand: sub.brand, domain: sub.domain, confirmUrl, unsubscribeUrl, locale: sub.locale });

    await this.email.sendRaw({
      to: sub.email,
      subject,
      html,
    });

    await this.prisma.publicCitationEmailLog.create({
      data: { subscriberId: sub.id, type: 'welcome' },
    });
  }

  private async sendRetestEmail(
    sub: { id: string; email: string; domain: string; brand: string; unsubscribeToken: string; locale: string },
    intervalLabel: string,
    cmp: RetestComparison,
    citationCheckId?: string,
  ) {
    const baseUrl = process.env.WEB_URL ?? 'https://ranksup.ai';
    const unsubscribeUrl = `${baseUrl}/api/public/citation-check/unsubscribe?token=${sub.unsubscribeToken}`;
    const signupUrl = `${baseUrl}/signin?signup=1&utm_source=citation_retest&utm_campaign=${intervalLabel}`;
    const tr = sub.locale === 'tr';

    // Yontem degistiyse konu satiri artis/dusus ima etmez — fark hesaplanmadi
    const direction = cmp.methodChanged ? '' : `${cmp.delta > 0 ? '📈' : cmp.delta < 0 ? '📉' : '⏸️'} `;
    const subject = tr
      ? `${direction}${sub.brand} ${intervalLabel} AI Visibility raporu`
      : `${direction}${sub.brand} ${intervalLabel} AI Visibility report`;

    const html = this.retestEmailHtml({ brand: sub.brand, domain: sub.domain, intervalLabel, cmp, signupUrl, unsubscribeUrl, locale: sub.locale });

    await this.email.sendRaw({
      to: sub.email,
      subject,
      html,
    });

    await this.prisma.publicCitationEmailLog.create({
      data: {
        subscriberId: sub.id,
        type: `retest_${intervalLabel}`,
        // Raporun dayandigi olcum kaydi — e-postadaki sayi denetlenebilir kalsin
        citationCheckId: citationCheckId ?? null,
        delta: cmp as any,
      },
    });
  }

  private getIntervalLabel(retestsSent: number): string {
    const cumulative = [15, 30, 60, 90];
    return `${cumulative[retestsSent] ?? '?'}d`;
  }

  /**
   * Hos geldin / cift onay e-postasi.
   *
   * Marka ve alan adi KACISLANIR: alan adi abone formundan, marka kontrol
   * kaydindan (taranan sitenin og:site_name / basligi — yine disaridan gelen
   * metin) gelir; kacislanmasa baskasinin adresine bizim gondericimizden
   * istenen HTML (sahte link) gonderilebilirdi. Asistan listesi plans.ts ile ayni (6; Llama yalniz
   * GROQ_LLAMA_MODEL tanimliyken olculuyor — ai-citation.service.ts).
   */
  private welcomeEmailHtml(p: { brand: string; domain: string; confirmUrl: string; unsubscribeUrl: string; locale: string }): string {
    const tr = p.locale === 'tr';
    const brand = kacisla(p.brand);
    const domain = kacisla(p.domain);
    return `<!doctype html>
<html><head><meta charset="utf-8"><title>${tr ? 'Aboneliğinizi onaylayın' : 'Confirm your subscription'}</title></head>
<body style="margin:0;padding:0;background:#fafafa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1a1a1a;line-height:1.5">
<div style="max-width:600px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06)">
  <div style="background:linear-gradient(135deg,#f97316,#ea580c);padding:32px;text-align:center;color:#fff">
    <div style="font-size:32px;margin-bottom:8px">✨</div>
    <h1 style="margin:0;font-size:24px;font-weight:800">RanksUp</h1>
    <p style="margin:8px 0 0;opacity:0.9;font-size:14px">AI Visibility Tracker</p>
  </div>
  <div style="padding:32px">
    <h2 style="margin:0 0 16px;font-size:20px;font-weight:700">${tr ? `${brand} için takibi onaylayın` : `Confirm tracking for ${brand}`}</h2>
    <p style="margin:0 0 16px;color:#4a4a4a">
      ${tr
        ? `<strong>${domain}</strong> alan adının 6 AI asistanındaki (ChatGPT, Claude, Gemini, Perplexity, Grok, DeepSeek) görünürlüğünü 15, 30, 60 ve 90 gün sonra otomatik olarak yeniden test edip her seferinde size rapor göndereceğiz.`
        : `We'll automatically retest <strong>${domain}</strong> on 6 AI assistants (ChatGPT, Claude, Gemini, Perplexity, Grok, DeepSeek) at 15, 30, 60 and 90 days, and email you each report.`}
    </p>
    <p style="margin:0 0 24px;color:#4a4a4a">${tr ? 'Başlamak için aşağıdaki butona tıklayın:' : 'Click the button below to confirm:'}</p>
    <div style="text-align:center;margin:32px 0">
      <a href="${p.confirmUrl}" style="display:inline-block;background:linear-gradient(135deg,#f97316,#ea580c);color:#fff;text-decoration:none;font-weight:700;padding:14px 28px;border-radius:10px;font-size:15px">${tr ? 'Aboneliği Onayla' : 'Confirm Subscription'}</a>
    </div>
    <p style="margin:24px 0 0;font-size:12px;color:#888;border-top:1px solid #eee;padding-top:16px">
      ${tr ? 'Bu e-postayı beklemiyorsanız görmezden gelebilirsiniz.' : 'If you did not expect this email, you can safely ignore it.'}
      <br><a href="${p.unsubscribeUrl}" style="color:#888;text-decoration:underline">${tr ? 'Aboneliği iptal et' : 'Unsubscribe'}</a>
    </p>
  </div>
  <div style="background:#fafafa;padding:16px;text-align:center;font-size:11px;color:#999;border-top:1px solid #eee">
    RanksUp · ${tr ? 'AI çağı için pazarlama otomasyonu' : 'Marketing automation for the AI era'}
  </div>
</div>
</body></html>`;
  }

  /**
   * Retest raporu.
   *
   * SAYI BIRIMI: totalCited, markanin adinin gecmedigi sorularda markanin
   * anildigi ya da kaynak gosterildigi CEVAP sayisidir (saglayici x soru,
   * getHistory). Eskiden "N motor" ve "/ 7" yaziyordu: birden fazla soru
   * olculdugu icin sayi motor adedi degildi, "8 / 7" gibi imkansiz bir oran
   * cikabiliyordu. Kanitlanmayan "90 gunde ortalama +4 motor" vaadi ve
   * olcumle desteklenmeyen yorum cumleleri de kaldirildi.
   *
   * KIYAS YAPILMADIYSA (cmp.methodChanged): iki sayi yan yana konmaz, yon/fark
   * yazilmaz; yalniz bugunku sonuc ve notr not. Not nedene gore: yontem surumu
   * degistiyse yontem notu; soru seti / kademe / ortak yanit orani tutmadiysa
   * ya da taban bulunamadiysa "ayni kosulda karsilastirilamadi" notu.
   * Kiyas yapildi ama bazi cevaplar bir olcumde eksikse (partialCoverage)
   * sayilarin hangi cevaplar uzerinden oldugu yazilir.
   */
  private retestEmailHtml(p: {
    brand: string;
    domain: string;
    intervalLabel: string;
    cmp: RetestComparison;
    signupUrl: string;
    unsubscribeUrl: string;
    locale: string;
  }): string {
    const tr = p.locale === 'tr';
    const brand = kacisla(p.brand);
    const domain = kacisla(p.domain);
    const { current, past, delta, deltaPct, methodChanged } = p.cmp;
    // Neden kodu yoksa (eski compareWithPast cevabi) yontem notu — eski davranis
    const notSameConditions = methodChanged && !!p.cmp.methodChangeReason && p.cmp.methodChangeReason !== 'match_version';
    const direction = delta > 0 ? '📈' : delta < 0 ? '📉' : '⏸️';
    const directionColor = methodChanged ? '#6b7280' : delta > 0 ? '#10b981' : delta < 0 ? '#ef4444' : '#6b7280';
    const answers = (n: number) => (tr ? `${n} cevap` : `${n} ${Math.abs(n) === 1 ? 'answer' : 'answers'}`);
    // Onceki deger 0 iken yuzde tanimsiz (deltaPct 0 gelir) — "+%0" yazilmaz
    const pct = deltaPct > 0 ? ` (+${deltaPct}%)` : '';
    const headline = methodChanged
      ? (notSameConditions
        ? (tr ? 'Bu dönem karşılaştırma yapılamadı' : 'No comparison this period')
        : (tr ? 'Ölçüm yöntemi güncellendi' : 'Measurement method updated'))
      : delta > 0
        ? `+${answers(delta)}${pct}`
        : delta < 0
          ? answers(delta)
          : (tr ? 'Değişim yok' : 'No change');
    const summary = methodChanged
      ? (notSameConditions
        ? (tr
          ? 'Bugünkü ölçümü önceki ölçümle aynı koşullarda (aynı sorular, aynı AI asistanlarının yanıtları) karşılaştıramadık; bu yüzden aradaki farkı göstermiyoruz. Aşağıda yalnızca bugünkü sonuç yer alıyor.'
          : 'We could not compare today\'s measurement with the previous one under the same conditions (the same questions and answers from the same AI assistants), so we are not showing a difference. Below is today\'s result only.')
        : (tr
          ? 'Ölçüm yöntemimizi güncelledik. Önceki ölçüm eski yöntemle yapıldığı için bugünkü sonucu onunla karşılaştırmıyoruz; aradaki fark görünürlüğünüzdeki bir değişimden değil, yöntem farkından kaynaklanabilir.'
          : 'We have updated our measurement method. Your previous result was measured with the old method, so we are not comparing today\'s result with it; any difference may come from the method change rather than a change in your visibility.'))
      : tr
        ? (delta > 0
          ? `Bu dönemde markanız ${delta} cevapta daha anıldı veya kaynak gösterildi.`
          : delta < 0
            ? `Bu dönemde markanız ${Math.abs(delta)} cevapta daha az anıldı veya kaynak gösterildi.`
            : 'Bu dönemde markanızın anıldığı veya kaynak gösterildiği cevap sayısı değişmedi.')
        : (delta > 0
          ? `This period your brand was mentioned or cited in ${delta} more ${delta === 1 ? 'answer' : 'answers'}.`
          : delta < 0
            ? `This period your brand was mentioned or cited in ${Math.abs(delta)} fewer ${Math.abs(delta) === 1 ? 'answer' : 'answers'}.`
            : 'The number of answers mentioning or citing your brand did not change this period.');
    const unit = tr ? 'markanızın anıldığı cevap' : 'answers mentioning your brand';
    // Iki sayi da yalniz iki olcumde de yanit alinan cevaplardan; eksik varsa soylenir
    const compared = p.cmp.comparedAnswers ?? 0;
    const coverageNote = !methodChanged && p.cmp.partialCoverage && compared > 0
      ? `<p style="margin:0 0 16px;color:#6b7280;font-size:13px">${tr
        ? `Karşılaştırma, iki ölçümde de yanıt alınan ${compared} cevap üzerinden yapıldı; ölçümlerden birinde yanıt alınamayan cevaplar kıyasa girmedi.`
        : `The comparison uses the ${compared} ${compared === 1 ? 'answer' : 'answers'} received in both measurements; answers missing from either measurement were left out.`}</p>`
      : '';
    const fmtDate = (d?: Date) => (d ? new Date(d).toLocaleDateString(tr ? 'tr-TR' : 'en-US') : '');
    const pastCell = methodChanged ? '' : `
        <td style="width:50%;padding:16px;background:#f9fafb;border-radius:12px;text-align:center;vertical-align:top">
          <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">${tr ? 'Önceki' : 'Before'}</div>
          <div style="font-size:32px;font-weight:800;color:#4a4a4a">${past?.totalCited ?? 0}</div>
          <div style="font-size:11px;color:#888;margin-top:4px">${unit}</div>
          <div style="font-size:11px;color:#888;margin-top:4px">${fmtDate(past?.createdAt)}</div>
        </td>
        <td style="width:24px"></td>`;

    return `<!doctype html>
<html><head><meta charset="utf-8"><title>${brand} ${p.intervalLabel} ${tr ? 'rapor' : 'report'}</title></head>
<body style="margin:0;padding:0;background:#fafafa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1a1a1a;line-height:1.5">
<div style="max-width:600px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06)">
  <div style="background:linear-gradient(135deg,#f97316,#ea580c);padding:32px;text-align:center;color:#fff">
    ${methodChanged ? '' : `<div style="font-size:48px;margin-bottom:8px">${direction}</div>`}
    <h1 style="margin:0;font-size:24px;font-weight:800">${brand}</h1>
    <p style="margin:8px 0 0;opacity:0.9;font-size:14px">${domain} · ${p.intervalLabel} ${tr ? 'rapor' : 'report'}</p>
  </div>
  <div style="padding:32px">
    <h2 style="margin:0 0 24px;font-size:18px;font-weight:700;text-align:center;color:${directionColor}">${headline}</h2>

    <table cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 0 24px">
      <tr>${pastCell}
        <td style="width:${methodChanged ? '100' : '50'}%;padding:16px;background:linear-gradient(135deg,#fff7ed,#ffedd5);border-radius:12px;text-align:center;vertical-align:top;border:1px solid #fdba74">
          <div style="font-size:11px;color:#9a3412;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">${tr ? 'Bugün' : 'Today'}</div>
          <div style="font-size:32px;font-weight:800;color:#ea580c">${current?.totalCited ?? 0}</div>
          <div style="font-size:11px;color:#9a3412;margin-top:4px">${unit}</div>
          <div style="font-size:11px;color:#9a3412;margin-top:4px">${fmtDate(current?.createdAt)}</div>
        </td>
      </tr>
    </table>

    <p style="margin:0 0 16px;color:#4a4a4a">${summary}</p>
    ${coverageNote}

    <p style="margin:0 0 24px;color:#4a4a4a;font-weight:600">${tr ? 'RanksUp ile:' : 'With RanksUp:'}</p>

    <ul style="margin:0 0 24px;padding-left:20px;color:#4a4a4a">
      <li>${tr ? 'Otomatik llms.txt ve yapısal veri (schema) üretimi' : 'Automatic llms.txt and structured data (schema) generation'}</li>
      <li>${tr ? 'Sektörünüze göre AI aramaya uygun içerik üretimi' : 'AI-search-ready content for your niche'}</li>
      <li>${tr ? 'AI görünürlük ölçümü ve düşüş alarmı' : 'AI visibility measurement and drop alerts'}</li>
      <li>${tr ? 'GEO Score Card (6 başlık) ve düzeltme önerileri' : 'GEO Score Card (6 pillars) and fix recommendations'}</li>
    </ul>

    <div style="text-align:center;margin:32px 0">
      <a href="${p.signupUrl}" style="display:inline-block;background:linear-gradient(135deg,#f97316,#ea580c);color:#fff;text-decoration:none;font-weight:700;padding:14px 28px;border-radius:10px;font-size:15px">${tr ? '2 Makale Ücretsiz Dene' : 'Try 2 Articles Free'}</a>
    </div>

    <p style="margin:24px 0 0;font-size:12px;color:#888;border-top:1px solid #eee;padding-top:16px;text-align:center">
      <a href="${p.unsubscribeUrl}" style="color:#888;text-decoration:underline">${tr ? 'Aboneliği iptal et' : 'Unsubscribe'}</a>
    </p>
  </div>
  <div style="background:#fafafa;padding:16px;text-align:center;font-size:11px;color:#999;border-top:1px solid #eee">
    RanksUp · ${tr ? 'AI çağı için pazarlama otomasyonu' : 'Marketing automation for the AI era'}
  </div>
</div>
</body></html>`;
  }
}
