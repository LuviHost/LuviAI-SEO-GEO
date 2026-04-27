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
            analyticsSnapshots: { where: { date: { gte: sevenDaysAgo } } },
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

        for (const site of u.sites) {
          articlesPublished += site.articles.length;
          for (const snap of site.analyticsSnapshots) {
            totalClicks += snap.totalClicks;
            totalImpressions += snap.totalImpressions;
            positionSum += snap.avgPosition;
            positionCount++;
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
            avgPosition: positionCount > 0 ? (positionSum / positionCount).toFixed(1) : '-',
            topArticle,
          },
        });
        sent++;
      } catch (err: any) {
        this.log.error(`Weekly report ${u.id}: ${err.message}`);
      }
    }

    this.log.log(`${sent} haftalık rapor gönderildi`);
  }
}
