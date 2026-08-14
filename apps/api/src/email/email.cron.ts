import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { EmailService } from './email.service.js';

/**
 * Email otomasyon cron'ları:
 *  - Welcome series (gün 1, 3, 7)
 *  - Trial expiry warnings (gün 11, 13)
 *  - Weekly reports (Pazartesi 09:00)
 */
@Injectable()
export class EmailCron {
  private readonly log = new Logger(EmailCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  /** Her gün 09:00 — welcome series + trial warnings */
  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async dailyEmails() {
    const now = Date.now();
    const day = 86400000;

    const users = await this.prisma.user.findMany({
      where: {
        plan: 'TRIAL',
        emailVerified: { not: null },
      },
    });

    let sent = 0;
    for (const u of users) {
      const ageMs = now - u.createdAt.getTime();
      const ageDays = Math.floor(ageMs / day);

      try {
        if (ageDays === 1) {
          await this.email.send({ userId: u.id, to: u.email, template: 'welcome_day1', data: { name: u.name } });
          sent++;
        } else if (ageDays === 3) {
          await this.email.send({ userId: u.id, to: u.email, template: 'welcome_day3', data: { name: u.name } });
          sent++;
        } else if (ageDays === 7) {
          await this.email.send({ userId: u.id, to: u.email, template: 'welcome_day7', data: { name: u.name } });
          sent++;
        }

        // Trial expiry
        if (u.trialEndsAt) {
          const daysLeft = Math.ceil((u.trialEndsAt.getTime() - now) / day);
          if (daysLeft === 3) {
            await this.email.send({ userId: u.id, to: u.email, template: 'trial_expiry_d11', data: { name: u.name } });
            sent++;
          } else if (daysLeft === 1) {
            await this.email.send({ userId: u.id, to: u.email, template: 'trial_expiry_d13', data: { name: u.name } });
            sent++;
          }
        }
      } catch (err: any) {
        this.log.error(`Email gönderilemedi (${u.id}): ${err.message}`);
      }
    }

    if (sent > 0) this.log.log(`${sent} daily email gönderildi`);
  }

  /** Pazartesi 09:00 — haftalık rapor */
  @Cron('0 9 * * 1')
  async weeklyReports() {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
    // Rapor mailindeki karsilastirma ve gunluk grafik icin 14 gun cekiliyor:
    // ilk 7 gun onceki hafta (referans), son 7 gun bu hafta.
    const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000);

    const users = await this.prisma.user.findMany({
      where: {
        subscriptionStatus: { in: ['ACTIVE', 'TRIAL'] },
        sites: { some: { status: 'ACTIVE' } },
      },
      include: {
        sites: {
          where: { status: 'ACTIVE' },
          include: {
            articles: { where: { publishedAt: { gte: sevenDaysAgo } } },
            analyticsSnapshots: {
              where: { date: { gte: fourteenDaysAgo } },
              orderBy: { date: 'asc' },
            },
          },
        },
      },
    });

    let sent = 0;
    for (const u of users) {
      try {
        let totalClicks = 0;
        let totalImpressions = 0;
        let articlesPublished = 0;
        let positionSum = 0;
        let positionCount = 0;
        let topArticle: any = null;

        // Gunluk tiklama serisi — mailde sutun grafik olarak ciziliyor.
        // Tarih -> toplam; birden fazla site varsa gunler toplaniyor.
        const gunlukTiklama = new Map<string, number>();
        let oncekiHaftaTiklama = 0;
        let oncekiOlcumVar = false;

        for (const site of u.sites) {
          articlesPublished += site.articles.length;
          for (const snap of site.analyticsSnapshots) {
            const buHafta = snap.date >= sevenDaysAgo;
            if (buHafta) {
              totalClicks += snap.totalClicks;
              totalImpressions += snap.totalImpressions;
              positionSum += snap.avgPosition;
              positionCount++;
              const gun = snap.date.toISOString().slice(0, 10);
              gunlukTiklama.set(gun, (gunlukTiklama.get(gun) ?? 0) + snap.totalClicks);
            } else {
              oncekiHaftaTiklama += snap.totalClicks;
              oncekiOlcumVar = true;
            }
          }
          for (const a of site.articles) {
            const m = (a.performanceMetrics as any) ?? {};
            if (!topArticle || (m.clicks ?? 0) > (topArticle.clicks ?? 0)) {
              topArticle = { title: a.title, clicks: m.clicks ?? 0 };
            }
          }
        }

        // Aktivite yoksa email atma
        if (totalImpressions === 0 && articlesPublished === 0) continue;

        await this.email.send({
          userId: u.id,
          to: u.email,
          template: 'weekly_report',
          data: {
            name: u.name,
            articlesPublished,
            totalClicks,
            totalImpressions,
            avgPosition: positionCount > 0 ? (positionSum / positionCount).toFixed(1) : null,
            topArticle,
            // Onceki hafta HIC olculmediyse prevClicks GONDERILMEZ; sablon o
            // zaman fark yerine "gecen hafta olcum yok" yaziyor. 0 gondermek
            // "sifirdan buraya geldik" yalanini uretirdi.
            ...(oncekiOlcumVar ? { prevClicks: oncekiHaftaTiklama } : {}),
            clicksSeries: [...gunlukTiklama.entries()]
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([, n]) => n),
          },
        });
        sent++;
      } catch (err: any) {
        this.log.error(`Weekly report ${u.id}: ${err.message}`);
      }
    }

    this.log.log(`${sent} haftalık rapor gönderildi`);
  }

  /**
   * 2026-05 Premium Pricing — Grandfathering uyari sistemi.
   * Her gün 10:00'da çalışır:
   *  - grandfatheredUntil 30 gün sonra olan: 30 gün uyari email
   *  - grandfatheredUntil bugün geçen: yeni fiyat aktif email + DB temizle
   */
  @Cron('0 10 * * *')
  async grandfatheringNotifications() {
    const now = new Date();
    const in30Days = new Date(now.getTime() + 30 * 86400000);
    const in29Days = new Date(now.getTime() + 29 * 86400000);

    // ─── 30 gün uyari ──────────────────────────────────────────────
    // grandfatheredUntil 29-30 gün aralığında olanlar (cron günde 1 çalışsa da kaçırma)
    const expiringSoon = await this.prisma.user.findMany({
      where: {
        grandfatheredUntil: { gte: in29Days, lte: in30Days } as any,
        emailVerified: { not: null },
      },
    });

    // Yeni fiyatları billing.service'ten almak için sabit map (grandfathered'lar PRO/AGENCY/STARTER/ENTERPRISE)
    const NEW_PRICES: Record<string, number> = {
      STARTER: 1499,
      PRO: 4999,
      AGENCY: 14999,
      ENTERPRISE: 34999,
    };

    let warnSent = 0;
    for (const u of expiringSoon) {
      const newPrice = NEW_PRICES[u.plan] ?? 0;
      const legacyPrice = (u as any).legacyMonthlyPriceTry ?? 0;
      try {
        await this.email.send({
          userId: u.id,
          to: u.email,
          template: 'grandfathering_expiring',
          data: {
            name: u.name,
            expiryDateText: (u as any).grandfatheredUntil?.toLocaleDateString('tr-TR', {
              year: 'numeric', month: 'long', day: 'numeric',
            }) ?? '',
            legacyPriceTry: legacyPrice,
            newPriceTry: newPrice,
          },
        });
        warnSent++;
      } catch (err: any) {
        this.log.error(`grandfathering_expiring ${u.id}: ${err.message}`);
      }
    }

    // ─── Bugün gracefully expired olanlar ──────────────────────────
    // grandfatheredUntil bugün veya geçmişte + henüz "geçti" olarak işaretlenmemiş
    const justExpired = await this.prisma.user.findMany({
      where: {
        grandfatheredUntil: { lte: now, gt: new Date(now.getTime() - 86400000) } as any,
        emailVerified: { not: null },
      },
    });

    let expiredSent = 0;
    for (const u of justExpired) {
      const newPrice = NEW_PRICES[u.plan] ?? 0;
      const legacyPrice = (u as any).legacyMonthlyPriceTry ?? 0;
      try {
        await this.email.send({
          userId: u.id,
          to: u.email,
          template: 'grandfathering_expired',
          data: {
            name: u.name,
            legacyPriceTry: legacyPrice,
            newPriceTry: newPrice,
          },
        });
        // Grandfathering bilgisini temizle — yeni fiyat aktif
        await this.prisma.user.update({
          where: { id: u.id },
          data: { grandfatheredUntil: null, legacyMonthlyPriceTry: null } as any,
        });
        expiredSent++;
      } catch (err: any) {
        this.log.error(`grandfathering_expired ${u.id}: ${err.message}`);
      }
    }

    if (warnSent + expiredSent > 0) {
      this.log.log(`Grandfathering: ${warnSent} uyari + ${expiredSent} expired email gönderildi`);
    }
  }
}
