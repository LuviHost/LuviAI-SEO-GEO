import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';

export interface AgencyOverview {
  agencyId: string;
  agencyName: string;
  whitelabel: {
    enabled: boolean;
    brandName?: string;
    logoUrl?: string;
    primaryColor?: string;
    domain?: string;
    emailFrom?: string;
  };
  clients: Array<{
    userId: string;
    email: string;
    name: string | null;
    sitesCount: number;
    sitesActive: number;
    createdAt: Date;
    plan: string;
    geoScoreAvg: number | null;
    issuesCount: number;
  }>;
  totals: {
    clients: number;
    sites: number;
    articlesPublished30d: number;
    monthlyRevenueTRY: number;
  };
}

@Injectable()
export class AgencyService {
  private readonly log = new Logger(AgencyService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getOverview(agencyOwnerId: string): Promise<AgencyOverview> {
    const owner: any = await this.prisma.user.findUniqueOrThrow({ where: { id: agencyOwnerId } });
    if (owner.role !== 'AGENCY_OWNER' && owner.role !== 'ADMIN') {
      throw new ForbiddenException('Agency owner degilsiniz');
    }

    const clients = await this.prisma.user.findMany({
      where: { parentAgencyId: agencyOwnerId } as any,
      include: { sites: { include: { audits: { orderBy: { ranAt: 'desc' }, take: 1 } } } },
    });

    const PLAN_PRICES: Record<string, number> = {
      TRIAL: 0, STARTER: 3080, PRO: 6980, AGENCY: 13610, ENTERPRISE: 0,
    };

    const last30d = new Date(Date.now() - 30 * 86400000);

    const clientsData = await Promise.all(
      clients.map(async (c: any) => {
        const articlesPub = await this.prisma.article.count({
          where: { siteId: { in: c.sites.map((s: any) => s.id) }, status: 'PUBLISHED', publishedAt: { gte: last30d } } as any,
        });
        const sitesActive = c.sites.filter((s: any) => s.status === 'ACTIVE' || s.status === 'AUDIT_COMPLETE').length;

        // GEO score avg from audits
        const allAudits = c.sites.flatMap((s: any) => s.audits);
        const geoScores = allAudits.map((a: any) => a.geoScore).filter((s: number | null) => s !== null) as number[];
        const geoScoreAvg = geoScores.length > 0 ? Math.round(geoScores.reduce((a, b) => a + b, 0) / geoScores.length) : null;

        const issuesCount = allAudits.reduce((acc: number, a: any) => {
          return acc + (Array.isArray(a.issues) ? (a.issues as any[]).length : 0);
        }, 0);

        return {
          userId: c.id,
          email: c.email,
          name: c.name,
          sitesCount: c.sites.length,
          sitesActive,
          createdAt: c.createdAt,
          plan: c.plan,
          geoScoreAvg,
          issuesCount,
          articlesPub,
        };
      })
    );

    const totalSites = clientsData.reduce((a, c) => a + c.sitesCount, 0);
    const totalArticles = clientsData.reduce((a, c) => a + c.articlesPub, 0);
    const totalRevenue = clientsData.reduce((a, c) => a + (PLAN_PRICES[c.plan] ?? 0), 0);

    return {
      agencyId: owner.id,
      agencyName: owner.name ?? owner.email,
      whitelabel: {
        enabled: owner.whitelabelEnabled,
        brandName: owner.whitelabelBrandName ?? undefined,
        logoUrl: owner.whitelabelLogoUrl ?? undefined,
        primaryColor: owner.whitelabelPrimaryColor ?? undefined,
        domain: owner.whitelabelDomain ?? undefined,
        emailFrom: owner.whitelabelEmailFrom ?? undefined,
      },
      clients: clientsData.map((c) => ({
        userId: c.userId,
        email: c.email,
        name: c.name,
        sitesCount: c.sitesCount,
        sitesActive: c.sitesActive,
        createdAt: c.createdAt,
        plan: c.plan,
        geoScoreAvg: c.geoScoreAvg,
        issuesCount: c.issuesCount,
      })),
      totals: {
        clients: clients.length,
        sites: totalSites,
        articlesPublished30d: totalArticles,
        monthlyRevenueTRY: totalRevenue,
      },
    };
  }

  /**
   * Agency owner yeni client davet eder. Email gonderiminde ozel
   * onboarding linki olusturulur, signup sonrasi parentAgencyId set edilir.
   */
  async inviteClient(agencyOwnerId: string, clientEmail: string, clientName?: string): Promise<{ inviteUrl: string }> {
    const owner: any = await this.prisma.user.findUniqueOrThrow({ where: { id: agencyOwnerId } });
    if (owner.role !== 'AGENCY_OWNER' && owner.role !== 'ADMIN') {
      throw new ForbiddenException('Agency owner degilsiniz');
    }

    const token = randomBytes(20).toString('hex');
    // Verification token table'a yaz (NextAuth uyumlu)
    await this.prisma.verificationToken.create({
      data: {
        identifier: `agency-invite:${agencyOwnerId}:${clientEmail}`,
        token,
        expires: new Date(Date.now() + 14 * 86400000),
      },
    });

    const baseUrl = owner.whitelabelDomain
      ? `https://${owner.whitelabelDomain}`
      : (process.env.NEXT_PUBLIC_BASE_URL ?? 'https://ai.luvihost.com');
    const inviteUrl = `${baseUrl}/agency/accept?token=${token}&email=${encodeURIComponent(clientEmail)}`;

    this.log.log(`[${agencyOwnerId}] Client invite uretildi: ${clientEmail}`);
    return { inviteUrl };
  }

  /**
   * Whitelabel ayarlarini guncelle.
   */
  async updateWhitelabel(agencyOwnerId: string, settings: {
    enabled?: boolean;
    brandName?: string;
    logoUrl?: string;
    primaryColor?: string;
    domain?: string;
    emailFrom?: string;
  }) {
    return this.prisma.user.update({
      where: { id: agencyOwnerId },
      data: {
        whitelabelEnabled: settings.enabled,
        whitelabelBrandName: settings.brandName,
        whitelabelLogoUrl: settings.logoUrl,
        whitelabelPrimaryColor: settings.primaryColor,
        whitelabelDomain: settings.domain,
        whitelabelEmailFrom: settings.emailFrom,
      } as any,
    });
  }

  /**
   * Custom domain'den gelen request: domain hangi agency'e ait, whitelabel
   * ayarlarini geri don. Frontend bu data ile sayfayi rebrand eder.
   */
  async resolveDomain(domain: string) {
    const agency: any = await this.prisma.user.findFirst({
      where: { whitelabelDomain: domain, whitelabelEnabled: true } as any,
    });
    if (!agency) return null;
    return {
      brandName: agency.whitelabelBrandName,
      logoUrl: agency.whitelabelLogoUrl,
      primaryColor: agency.whitelabelPrimaryColor,
      emailFrom: agency.whitelabelEmailFrom,
    };
  }
}
