import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { AttemptWindow } from './public-subscribe-limits.js';
import {
  ATTEMPT_EMAIL_DAILY_CAP, ATTEMPT_GLOBAL_DAILY_CAP, ATTEMPT_INAPP_DAILY_CAP, ATTEMPT_IP_DAILY_CAP, ATTEMPT_NOTIFY_WINDOW_MS,
  attemptNotification, emailPolicy, isCappedOutcome, notifyKey,
  type AttemptOutcome, type AttemptSummary,
} from './public-check-attempt.js';
import { attemptEmailHtml, type AttemptReport } from './public-check-report-email.js';

const GUN_MS = 24 * 60 * 60 * 1000;
/** Bildirimin panelde actigi sayfa (e-postadaki "Panelde aç" da buraya gider) */
const PANEL_LINK = '/admin/leads';

export interface AttemptInput {
  /** Normalize host (attemptHost) — ham girdi buraya GELMEZ */
  domain: string;
  outcome: AttemptOutcome;
  /** PublicCitationService.ipHash — ham IP buraya GELMEZ */
  ipHash: string;
  checkId?: string | null;
  detail?: string | null;
  summary?: AttemptSummary;
  /**
   * Ziyaretcinin gordugu sonucun e-posta raporu (public-check-report-email.ts reportOfResult).
   * Yalniz bildirim e-postasinda kullanilir; VERITABANINA YAZILMAZ (kayit: alan adi, sonuc
   * turu, IP ozeti — public-check-attempt.ts).
   */
  report?: AttemptReport | null;
  /** Kilitli sonucun anahtari (public-check-gate.ts); e-posta sonradan bu kayda yazilir */
  anahtar?: string | null;
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
          anahtar: input.anahtar ?? null,
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

  /**
   * Ziyaretci sonucu acmak icin e-postasini yazdi: deneme kaydina yazilir, yoneticiye haber
   * verilir (panel + e-posta; gunluk tavanli). Deneme kaydi tavana takilip yazilmadiysa yeni
   * kayit acilir — e-posta birakan kisi kaybolmaz. Hata yutulur: sonucu acmayi bozmaz.
   */
  async epostaYaz(g: { anahtar: string; domain: string; ipHash: string; outcome: AttemptOutcome; email: string; pazarlamaIzni: boolean }): Promise<void> {
    try {
      const simdi = new Date();
      const veri = { email: g.email, emailAt: simdi, pazarlamaIzni: g.pazarlamaIzni };
      const guncel = await this.prisma.publicCheckAttempt.updateMany({ where: { anahtar: g.anahtar }, data: veri });
      let id: string | null = null;
      if (guncel.count === 0) {
        const row = await this.prisma.publicCheckAttempt.create({
          data: { domain: g.domain, outcome: g.outcome, ip: g.ipHash || null, anahtar: g.anahtar, ...veri },
          select: { id: true },
        });
        id = row.id;
      } else {
        const row = await this.prisma.publicCheckAttempt.findUnique({ where: { anahtar: g.anahtar }, select: { id: true } });
        id = row?.id ?? null;
      }
      // Ayni adres + alan adi icin tek bildirim; gunde en fazla 50
      if (!this.perDomainNotify.take(`eposta:${g.domain}:${g.email}`, 1) || !this.global.take('eposta-birakan', 50)) return;
      const admin = await this.prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' }, select: { id: true } });
      if (!admin) return;
      await this.notifications.create({
        userId: admin.id,
        type: 'SYSTEM',
        title: `Ücretsiz test: ${g.domain} e-posta bıraktı`,
        body: `${g.domain} testinin sonucunu ${g.email} adresiyle açtı${g.pazarlamaIzni ? ' (ticari ileti onayı var)' : ''}. Ayrıntı: /admin/leads.`,
        link: PANEL_LINK,
        refKind: 'public_check_attempt',
        refId: id ?? undefined,
        channels: ['inapp', 'email'],
      });
    } catch (err: any) {
      this.log.warn(`Deneme e-postasi yazilamadi (${g.domain}): ${err?.message ?? err}`);
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

  /** Bildirim e-postasinin govdesi; hata yutulur (undefined → NotificationsService genel kalibi) */
  private emailHtml(n: { title: string; note: string }, input: AttemptInput): string | undefined {
    try {
      const base = process.env.WEB_BASE_URL ?? 'https://ranksup.ai';
      return attemptEmailHtml({
        title: n.title,
        domain: input.domain,
        outcome: input.outcome,
        note: n.note,
        summary: input.summary,
        report: input.report ?? null,
        panelUrl: `${base}${PANEL_LINK}`,
        baseUrl: base,
      });
    } catch (err: any) {
      this.log.warn(`Deneme e-postasi govdesi kurulamadi (${input.domain}): ${err?.message ?? err}`);
      return undefined;
    }
  }

  /** Panel (+ e-posta); alici ilk ADMIN hesap (LinkedIn bildirimleriyle ayni kural) */
  private async notify(attemptId: string, input: AttemptInput): Promise<void> {
    try {
      const admin = await this.prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' }, select: { id: true } });
      if (!admin) { this.log.warn('Deneme bildirimi icin ADMIN kullanici yok'); return; }
      const n = attemptNotification(input);
      const eposta = this.emailAllowed(input.outcome, input.domain);
      await this.notifications.create({
        userId: admin.id,
        type: 'SYSTEM',
        title: n.title,
        body: n.body,
        link: PANEL_LINK,
        refKind: 'public_check_attempt',
        refId: attemptId,
        channels: eposta ? ['inapp', 'email'] : ['inapp'],
        // E-posta site diliyle ve RAPORLA gider (sahip istegi 15.11.2026); panel bildirimi
        // ayni kisa metin. Govde kurulamazsa bildirim dusmez: genel kaliba doner.
        emailHtml: eposta ? this.emailHtml(n, input) : undefined,
      });
      await this.prisma.publicCheckAttempt.update({ where: { id: attemptId }, data: { notifiedAt: new Date() } });
    } catch (err: any) {
      this.log.warn(`Deneme bildirimi yazilamadi (${input.domain}): ${err?.message ?? err}`);
    }
  }
}
