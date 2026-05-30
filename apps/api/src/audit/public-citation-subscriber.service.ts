import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { EmailService } from '../email/email.service.js';
import { PublicCitationService } from './public-citation.service.js';

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
 *   6. Kullanici LuviAI'a kayit olursa OAuth callback'ten linkSignup() cagrilir,
 *      status: SIGNED_UP, retest durur
 */

// Retest schedule: ilk welcome'dan sonra bu intervallerde retest gonder
const RETEST_INTERVALS_DAYS = [15, 15, 30, 30]; // 15, 30, 60, 90 (cumulative)

export interface SubscribeInput {
  email: string;
  domain: string;
  brand: string;
  niche?: string;
  customNiche?: string;
  locale?: string;
}

@Injectable()
export class PublicCitationSubscriberService {
  private readonly log = new Logger(PublicCitationSubscriberService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly citation: PublicCitationService,
  ) {}

  /** Yeni abonelik baslat — double-opt-in welcome email gonder */
  async subscribe(input: SubscribeInput): Promise<{ ok: true; status: string; alreadyActive: boolean }> {
    const email = (input.email || '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('Gecerli bir email girin');
    }
    const domain = (input.domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    if (!domain || !domain.includes('.')) throw new BadRequestException('Gecersiz domain');
    if (!input.brand || input.brand.length < 2) throw new BadRequestException('Brand bilgisi eksik');

    const existing = await this.prisma.publicCitationSubscriber.findUnique({
      where: { email_domain: { email, domain } },
    });

    // Daha onceden aktif → tekrar welcome gonderme
    if (existing && existing.status === 'ACTIVE') {
      return { ok: true, status: 'ACTIVE', alreadyActive: true };
    }

    const confirmToken = randomBytes(24).toString('hex');
    const unsubscribeToken = existing?.unsubscribeToken ?? randomBytes(24).toString('hex');
    const locale = (input.locale === 'en' ? 'en' : 'tr');

    const sub = await this.prisma.publicCitationSubscriber.upsert({
      where: { email_domain: { email, domain } },
      create: {
        email, domain,
        brand: input.brand,
        niche: input.niche,
        customNiche: input.customNiche,
        status: 'PENDING_OPTIN',
        confirmToken,
        unsubscribeToken,
        consentAt: new Date(),
        locale,
      },
      update: {
        brand: input.brand,
        niche: input.niche,
        customNiche: input.customNiche,
        confirmToken,
        consentAt: new Date(),
        status: 'PENDING_OPTIN',
        locale,
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
   * Her birine fresh test yap + branded email at + sonraki retest zamani planla.
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
        // 1) Fresh retest (system-source, cache bypass)
        await this.citation.check(sub.domain, '', 'retest_cron');

        // 2) Delta hesapla (test sonrasi snapshot ile en eski snapshot karsilastirilir)
        const daysSinceFirst = Math.round((Date.now() - sub.createdAt.getTime()) / (24 * 60 * 60 * 1000));
        const cmp = await this.citation.compareWithPast(sub.domain, daysSinceFirst);

        // 3) Email gonder
        const intervalLabel = this.getIntervalLabel(sub.retestsSent);
        await this.sendRetestEmail(sub, intervalLabel, cmp);

        // 4) Subscriber state update
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

  /** Bir kullanicinin signup oncesi yapmis oldugu testlerin journey'sini don */
  async getJourneyForUser(userId: string): Promise<Array<{
    domain: string;
    brand: string;
    history: Array<{ createdAt: Date; totalCited: number; total: number }>;
    delta?: { before: number; after: number; total: number };
  }>> {
    const subs = await this.prisma.publicCitationSubscriber.findMany({
      where: { signupUserId: userId },
    });
    const out: Array<{
      domain: string;
      brand: string;
      history: Array<{ createdAt: Date; totalCited: number; total: number }>;
      delta?: { before: number; after: number; total: number };
    }> = [];
    for (const s of subs) {
      const history = await this.citation.getHistory(s.domain, 50);
      const reversed = history.slice().reverse();
      const cmp = history.length >= 2
        ? { before: history[history.length - 1].totalCitedScore, after: history[0].totalCitedScore, total: history[0].totalProviders }
        : undefined;
      out.push({
        domain: s.domain,
        brand: s.brand,
        history: reversed.map((h) => ({ createdAt: h.createdAt, totalCited: h.totalCitedScore, total: h.totalProviders })),
        delta: cmp,
      });
    }
    return out;
  }

  // ──────────────────────────────────────────────
  //  EMAIL HELPERS
  // ──────────────────────────────────────────────
  private async sendWelcomeEmail(sub: { id: string; email: string; domain: string; brand: string; confirmToken: string | null; unsubscribeToken: string; locale: string }) {
    const baseUrl = process.env.WEB_URL ?? 'https://ai.luvihost.com';
    const confirmUrl = `${baseUrl}/api/public/citation-check/confirm?token=${sub.confirmToken}`;
    const unsubscribeUrl = `${baseUrl}/api/public/citation-check/unsubscribe?token=${sub.unsubscribeToken}`;

    const tr = sub.locale === 'tr';
    const subject = tr
      ? `${sub.brand} icin AI Visibility takibiniz baslamak uzere`
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
    cmp: {
      current?: { totalCited: number; total: number; createdAt: Date };
      past?: { totalCited: number; total: number; createdAt: Date };
      delta: number;
      deltaPct: number;
    },
  ) {
    const baseUrl = process.env.WEB_URL ?? 'https://ai.luvihost.com';
    const unsubscribeUrl = `${baseUrl}/api/public/citation-check/unsubscribe?token=${sub.unsubscribeToken}`;
    const signupUrl = `${baseUrl}/signin?signup=1&utm_source=citation_retest&utm_campaign=${intervalLabel}`;
    const tr = sub.locale === 'tr';

    const direction = cmp.delta > 0 ? '📈' : cmp.delta < 0 ? '📉' : '⏸️';
    const subject = tr
      ? `${direction} ${sub.brand} ${intervalLabel} AI Visibility raporu`
      : `${direction} ${sub.brand} ${intervalLabel} AI Visibility report`;

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
        delta: cmp as any,
      },
    });
  }

  private getIntervalLabel(retestsSent: number): string {
    const cumulative = [15, 30, 60, 90];
    return `${cumulative[retestsSent] ?? '?'}d`;
  }

  private welcomeEmailHtml(p: { brand: string; domain: string; confirmUrl: string; unsubscribeUrl: string; locale: string }): string {
    const tr = p.locale === 'tr';
    return `<!doctype html>
<html><head><meta charset="utf-8"><title>${tr ? 'Aboneliginizi onaylayin' : 'Confirm your subscription'}</title></head>
<body style="margin:0;padding:0;background:#fafafa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1a1a1a;line-height:1.5">
<div style="max-width:600px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06)">
  <div style="background:linear-gradient(135deg,#f97316,#ea580c);padding:32px;text-align:center;color:#fff">
    <div style="font-size:32px;margin-bottom:8px">✨</div>
    <h1 style="margin:0;font-size:24px;font-weight:800">LuviAI</h1>
    <p style="margin:8px 0 0;opacity:0.9;font-size:14px">${tr ? 'AI Visibility Tracker' : 'AI Visibility Tracker'}</p>
  </div>
  <div style="padding:32px">
    <h2 style="margin:0 0 16px;font-size:20px;font-weight:700">${tr ? `${p.brand} icin takibi onaylayin` : `Confirm tracking for ${p.brand}`}</h2>
    <p style="margin:0 0 16px;color:#4a4a4a">
      ${tr
        ? `<strong>${p.domain}</strong> domain'inin 15, 30, 60 ve 90 gun sonra 7 AI motorda (ChatGPT, Claude, Gemini, Perplexity, Grok, DeepSeek, Meta AI) gorunurlugunu otomatik test edip her seferinde size rapor gonderecegiz.`
        : `We'll automatically retest <strong>${p.domain}</strong> on 7 AI engines (ChatGPT, Claude, Gemini, Perplexity, Grok, DeepSeek, Meta AI) at 15, 30, 60 and 90 days, and email you each report.`}
    </p>
    <p style="margin:0 0 24px;color:#4a4a4a">${tr ? 'Baslamak icin asagidaki butona tiklayin:' : 'Click the button below to confirm:'}</p>
    <div style="text-align:center;margin:32px 0">
      <a href="${p.confirmUrl}" style="display:inline-block;background:linear-gradient(135deg,#f97316,#ea580c);color:#fff;text-decoration:none;font-weight:700;padding:14px 28px;border-radius:10px;font-size:15px">${tr ? 'Aboneligi Onayla' : 'Confirm Subscription'}</a>
    </div>
    <p style="margin:24px 0 0;font-size:12px;color:#888;border-top:1px solid #eee;padding-top:16px">
      ${tr ? 'Eger bu emaili bekleyemiyorsaniz gormezden gelin.' : 'If you did not expect this email, you can safely ignore it.'}
      <br><a href="${p.unsubscribeUrl}" style="color:#888;text-decoration:underline">${tr ? 'Aboneligi iptal et' : 'Unsubscribe'}</a>
    </p>
  </div>
  <div style="background:#fafafa;padding:16px;text-align:center;font-size:11px;color:#999;border-top:1px solid #eee">
    LuviAI · ${tr ? 'AI cagini icin pazarlama otomasyonu' : 'Marketing automation for the AI era'}
  </div>
</div>
</body></html>`;
  }

  private retestEmailHtml(p: {
    brand: string;
    domain: string;
    intervalLabel: string;
    cmp: {
      current?: { totalCited: number; total: number; createdAt: Date };
      past?: { totalCited: number; total: number; createdAt: Date };
      delta: number;
      deltaPct: number;
    };
    signupUrl: string;
    unsubscribeUrl: string;
    locale: string;
  }): string {
    const tr = p.locale === 'tr';
    const { current, past, delta, deltaPct } = p.cmp;
    const direction = delta > 0 ? '📈' : delta < 0 ? '📉' : '⏸️';
    const directionColor = delta > 0 ? '#10b981' : delta < 0 ? '#ef4444' : '#6b7280';
    const directionText = tr
      ? (delta > 0 ? `+${delta} motor (${deltaPct > 0 ? '+' : ''}${deltaPct}%)` : delta < 0 ? `${delta} motor` : 'Degisim yok')
      : (delta > 0 ? `+${delta} engines (${deltaPct > 0 ? '+' : ''}${deltaPct}%)` : delta < 0 ? `${delta} engines` : 'No change');

    return `<!doctype html>
<html><head><meta charset="utf-8"><title>${p.brand} ${p.intervalLabel} ${tr ? 'rapor' : 'report'}</title></head>
<body style="margin:0;padding:0;background:#fafafa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1a1a1a;line-height:1.5">
<div style="max-width:600px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06)">
  <div style="background:linear-gradient(135deg,#f97316,#ea580c);padding:32px;text-align:center;color:#fff">
    <div style="font-size:48px;margin-bottom:8px">${direction}</div>
    <h1 style="margin:0;font-size:24px;font-weight:800">${p.brand}</h1>
    <p style="margin:8px 0 0;opacity:0.9;font-size:14px">${p.domain} · ${p.intervalLabel} ${tr ? 'rapor' : 'report'}</p>
  </div>
  <div style="padding:32px">
    <h2 style="margin:0 0 24px;font-size:18px;font-weight:700;text-align:center;color:${directionColor}">${directionText}</h2>

    <table cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 0 24px">
      <tr>
        <td style="width:50%;padding:16px;background:#f9fafb;border-radius:12px;text-align:center;vertical-align:top">
          <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">${tr ? 'Onceki' : 'Before'}</div>
          <div style="font-size:32px;font-weight:800;color:#4a4a4a">${past?.totalCited ?? 0}<span style="color:#bbb;font-weight:600;font-size:20px"> / ${past?.total ?? 7}</span></div>
          <div style="font-size:11px;color:#888;margin-top:4px">${past?.createdAt ? new Date(past.createdAt).toLocaleDateString(tr ? 'tr-TR' : 'en-US') : ''}</div>
        </td>
        <td style="width:24px"></td>
        <td style="width:50%;padding:16px;background:linear-gradient(135deg,#fff7ed,#ffedd5);border-radius:12px;text-align:center;vertical-align:top;border:1px solid #fdba74">
          <div style="font-size:11px;color:#9a3412;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">${tr ? 'Bugun' : 'Today'}</div>
          <div style="font-size:32px;font-weight:800;color:#ea580c">${current?.totalCited ?? 0}<span style="color:#fdba74;font-weight:600;font-size:20px"> / ${current?.total ?? 7}</span></div>
          <div style="font-size:11px;color:#9a3412;margin-top:4px">${current?.createdAt ? new Date(current.createdAt).toLocaleDateString(tr ? 'tr-TR' : 'en-US') : ''}</div>
        </td>
      </tr>
    </table>

    <p style="margin:0 0 16px;color:#4a4a4a">
      ${tr
        ? (delta > 0
          ? `Bu donemde markaniz ${delta} ek AI motorunda gorunmeye basladi. AI search algoritmalari sizi yavas yavas kesfediyor. Ama bu surec yillarca alabilir.`
          : delta < 0
            ? `Bu donemde markaniz ${Math.abs(delta)} AI motorunda gorunmemeye basladi. AI'lar yeni icerikler ekledikçe rakipleriniz one cikiyor.`
            : `Bu donemde AI motorlarinda goz onunde olusunuzda anlamli bir degisim olmadi. AI'lar sizi henuz aktif olarak referans almiyor.`)
        : (delta > 0
          ? `In this period your brand started appearing in ${delta} additional AI engines. AI search algorithms are slowly discovering you. But this process can take years organically.`
          : delta < 0
            ? `Your brand dropped from ${Math.abs(delta)} AI engines this period. As AIs ingest new content, competitors are taking your spot.`
            : `There was no meaningful change in your visibility on AI engines this period. AIs are not actively referencing you yet.`)}
    </p>

    <p style="margin:0 0 24px;color:#4a4a4a;font-weight:600">
      ${tr ? 'LuviAI ile 90 gunde ortalama +4 motor artisi:' : 'With LuviAI, average +4 engines in 90 days:'}
    </p>

    <ul style="margin:0 0 24px;padding-left:20px;color:#4a4a4a">
      <li>${tr ? 'Otomatik llms.txt + structured data uretimi' : 'Auto llms.txt + structured data generation'}</li>
      <li>${tr ? 'Niş bazli AI-optimize icerik (haftada 2-5 makale)' : 'Niche-optimized AI-ready content (2-5 articles/week)'}</li>
      <li>${tr ? 'Gunluk citation takip + drop alarmi' : 'Daily citation tracking + drop alerts'}</li>
      <li>${tr ? 'GEO Score Card (6 pillar) + auto-fix' : 'GEO Score Card (6 pillar) + auto-fix'}</li>
    </ul>

    <div style="text-align:center;margin:32px 0">
      <a href="${p.signupUrl}" style="display:inline-block;background:linear-gradient(135deg,#f97316,#ea580c);color:#fff;text-decoration:none;font-weight:700;padding:14px 28px;border-radius:10px;font-size:15px">${tr ? '2 Makale Ucretsiz Dene' : 'Try 2 Articles Free'}</a>
    </div>

    <p style="margin:24px 0 0;font-size:12px;color:#888;border-top:1px solid #eee;padding-top:16px;text-align:center">
      <a href="${p.unsubscribeUrl}" style="color:#888;text-decoration:underline">${tr ? 'Aboneligi iptal et' : 'Unsubscribe'}</a>
    </p>
  </div>
  <div style="background:#fafafa;padding:16px;text-align:center;font-size:11px;color:#999;border-top:1px solid #eee">
    LuviAI · ${tr ? 'AI cagini icin pazarlama otomasyonu' : 'Marketing automation for the AI era'}
  </div>
</div>
</body></html>`;
  }
}
