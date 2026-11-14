import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { AttemptWindow } from './public-subscribe-limits.js';
import {
  ATTEMPT_EMAIL_DAILY_CAP, ATTEMPT_GLOBAL_DAILY_CAP, ATTEMPT_INAPP_DAILY_CAP, ATTEMPT_IP_DAILY_CAP, ATTEMPT_NOTIFY_WINDOW_MS,
  attemptNotification, emailPolicy, isCappedOutcome, notifyKey,
  type AttemptOutcome, type AttemptSummary,
} from './public-check-attempt.js';

const GUN_MS = 24 * 60 * 60 * 1000;

export interface AttemptInput {
  /** Normalize host (attemptHost) — ham girdi buraya GELMEZ */
  domain: string;
  outcome: AttemptOutcome;
  /** PublicCitationService.ipHash — ham IP buraya GELMEZ */
  ipHash: string;
  checkId?: string | null;
  detail?: string | null;
  summary?: AttemptSummary;
}

/**
 * Ucretsiz testin her denemesini yazar ve yoneticiye haber verir (kurallar: public-check-attempt.ts).
 *
 * TESTI ASLA BOZMAZ: her adim yutulur; kayit ya da bildirim yazilamazsa ziyaretcinin sonucu yine
 * doner. Cagiran beklemez — e-posta gonderimi cevabi geciktirmez.
 *
 * TAVANLAR yalniz olcum YAPILMAYAN denemeler icindir; taze olcum her zaman yazilir ve bildirilir
 * (public-check-attempt.ts: kotuye kullanim). Sayaclar surec belleginde: yeniden baslatmada
 * sifirlanir (AttemptWindow notu) — emniyet siniri, muhasebe degil.
 */
@Injectable()
export class PublicCheckAttemptService {
  private readonly log = new Logger(PublicCheckAttemptService.name);
  /** IP basina 24 saatlik kayit tavani (olcum yapilmayan denemeler) */
  private readonly perIp = new AttemptWindow(GUN_MS);
  /** Butun adreslerden gunluk kayit, panel bildirimi ve e-posta tavanlari */
  private readonly global = new AttemptWindow(GUN_MS);
  /** Ayni alan adi + sonuc icin bildirim araligi: art arda denemede tek bildirim */
  private readonly perDomainNotify = new AttemptWindow(ATTEMPT_NOTIFY_WINDOW_MS);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async record(input: AttemptInput): Promise<void> {
    try {
      const tavanli = isCappedOutcome(input.outcome);
      if (tavanli) {
        if (!this.perIp.take(input.ipHash || 'bilinmiyor', ATTEMPT_IP_DAILY_CAP)) {
          this.log.debug(`IP basina deneme tavani (${ATTEMPT_IP_DAILY_CAP}) doldu; deneme yazilmadi (${input.domain})`);
          return;
        }
        if (!this.global.take('kayit', ATTEMPT_GLOBAL_DAILY_CAP)) {
          this.log.warn(`Gunluk deneme kaydi tavani (${ATTEMPT_GLOBAL_DAILY_CAP}) doldu; deneme yazilmadi (${input.domain})`);
          return;
        }
      }
      const row = await this.prisma.publicCheckAttempt.create({
        data: {
          domain: input.domain,
          outcome: input.outcome,
          checkId: input.checkId ?? null,
          ip: input.ipHash || null,
          detail: input.detail ?? null,
        },
        select: { id: true },
      });
      if (!this.perDomainNotify.take(notifyKey(input.domain, input.outcome), 1)) return;
      if (tavanli && !this.global.take('panel', ATTEMPT_INAPP_DAILY_CAP)) {
        this.log.warn(`Gunluk deneme bildirimi tavani (${ATTEMPT_INAPP_DAILY_CAP}) doldu; kayit yazildi, bildirim yok (${input.domain})`);
        return;
      }
      await this.notify(row.id, input);
    } catch (err: any) {
      this.log.warn(`Deneme kaydi yazilamadi (${input.domain}): ${err?.message ?? err}`);
    }
  }

  /** E-posta: taze olcumde her zaman; ucuz denemelerde gunluk tavana kadar; tamamlanamayanda hic */
  private emailAllowed(outcome: AttemptOutcome, domain: string): boolean {
    const kural = emailPolicy(outcome);
    if (kural === 'always') return true;
    if (kural === 'never') return false;
    const izin = this.global.take('eposta', ATTEMPT_EMAIL_DAILY_CAP);
    if (!izin) this.log.warn(`Gunluk deneme e-postasi tavani (${ATTEMPT_EMAIL_DAILY_CAP}) doldu; bildirim yalniz panelde (${domain})`);
    return izin;
  }

  /** Panel (+ e-posta); alici ilk ADMIN hesap (LinkedIn bildirimleriyle ayni kural) */
  private async notify(attemptId: string, input: AttemptInput): Promise<void> {
    try {
      const admin = await this.prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' }, select: { id: true } });
      if (!admin) { this.log.warn('Deneme bildirimi icin ADMIN kullanici yok'); return; }
      const n = attemptNotification(input);
      await this.notifications.create({
        userId: admin.id,
        type: 'SYSTEM',
        title: n.title,
        body: n.body,
        link: '/admin/leads',
        refKind: 'public_check_attempt',
        refId: attemptId,
        channels: this.emailAllowed(input.outcome, input.domain) ? ['inapp', 'email'] : ['inapp'],
      });
      await this.prisma.publicCheckAttempt.update({ where: { id: attemptId }, data: { notifiedAt: new Date() } });
    } catch (err: any) {
      this.log.warn(`Deneme bildirimi yazilamadi (${input.domain}): ${err?.message ?? err}`);
    }
  }
}
