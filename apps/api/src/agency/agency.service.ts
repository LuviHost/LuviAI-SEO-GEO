import { Injectable, Logger, ForbiddenException, ConflictException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

const NOT_AGENCY = 'Bu işlem yalnızca ajans hesapları için.';

/**
 * Whitelabel guncelleme cevabi: yalniz markali panel alanlari. Eskiden tum
 * User satiri donuyordu — paytrUtoken gibi "istemciye ASLA donmez" alanlar dahil.
 */
const WHITELABEL_SELECT = {
  id: true,
  whitelabelEnabled: true,
  whitelabelBrandName: true,
  whitelabelLogoUrl: true,
  whitelabelPrimaryColor: true,
  whitelabelDomain: true,
  whitelabelEmailFrom: true,
} satisfies Prisma.UserSelect;

/** '' / bosluk → null (temizle); dize degilse dokunma (undefined) */
function cleanText(v: unknown, max: number): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== 'string') return undefined;
  const t = v.trim().slice(0, max);
  return t || null;
}

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
      throw new ForbiddenException(NOT_AGENCY);
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
  async inviteClient(agencyOwnerId: string, clientEmail: string): Promise<{ inviteUrl: string }> {
    const owner: any = await this.prisma.user.findUniqueOrThrow({ where: { id: agencyOwnerId } });
    if (owner.role !== 'AGENCY_OWNER' && owner.role !== 'ADMIN') {
      throw new ForbiddenException(NOT_AGENCY);
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
      : (process.env.NEXT_PUBLIC_BASE_URL ?? 'https://ranksup.ai');
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
    // Rol kapisi overview/invite ile ayni. Eskiden YOKTU: her kullanici kendi
    // kaydina markali panel alan adi yazabiliyordu — baska bir ajansin alan
    // adini da (resolve-domain ilk eslesen kaydi dondurur).
    const owner = await this.prisma.user.findUniqueOrThrow({ where: { id: agencyOwnerId }, select: { role: true } });
    if (owner.role !== 'AGENCY_OWNER' && owner.role !== 'ADMIN') {
      throw new ForbiddenException(NOT_AGENCY);
    }

    const data: Prisma.UserUpdateInput = {};
    if (typeof settings.enabled === 'boolean') data.whitelabelEnabled = settings.enabled;
    const brandName = cleanText(settings.brandName, 80);
    if (brandName !== undefined) data.whitelabelBrandName = brandName;
    const logoUrl = cleanText(settings.logoUrl, 191);
    if (logoUrl !== undefined) data.whitelabelLogoUrl = logoUrl;
    const primaryColor = cleanText(settings.primaryColor, 7);
    if (primaryColor !== undefined) data.whitelabelPrimaryColor = primaryColor;
    const emailFrom = cleanText(settings.emailFrom, 191);
    if (emailFrom !== undefined) data.whitelabelEmailFrom = emailFrom;

    // Alan adi kucuk harfe indirilir ve tek sahipli olmali (semada unique yok)
    const domain = cleanText(settings.domain, 191);
    if (domain !== undefined) {
      const normalized = domain ? domain.toLowerCase() : null;
      if (normalized) {
        // Duzeltme oncesi rol denetimi yoktu; ajans olmayan eski kayitlar
        // alan adini bloklamasin (onlar resolveDomain'de de yok sayilir)
        const taken = await this.prisma.user.findFirst({
          where: { whitelabelDomain: normalized, NOT: { id: agencyOwnerId }, role: { in: ['AGENCY_OWNER', 'ADMIN'] } },
          select: { id: true },
        });
        if (taken) throw new ConflictException('Bu alan adı başka bir hesapta kayıtlı.');
      }
      data.whitelabelDomain = normalized;
    }

    return this.prisma.user.update({
      where: { id: agencyOwnerId },
      data,
      select: WHITELABEL_SELECT,
    });
  }

  /**
   * Custom domain'den gelen request: domain hangi agency'e ait, whitelabel
   * ayarlarini geri don. Frontend bu data ile sayfayi rebrand eder.
   */
  async resolveDomain(domain: string) {
    // Herkese acik uc: ?host[not]=x sorgu ayristiricida nesneye donusur ve
    // Prisma'da filtre olur (herhangi bir ajansin markasi donerdi). Yalniz dize.
    if (typeof domain !== 'string' || !domain.trim()) return null;
    const agency: any = await this.prisma.user.findFirst({
      // Yalniz ajans/yonetici kayitlari: rol kapisi gelmeden once herhangi bir
      // kullanicinin yazdigi alan adi kaydi markayi ele gecirmesin
      where: { whitelabelDomain: domain.trim().toLowerCase(), whitelabelEnabled: true, role: { in: ['AGENCY_OWNER', 'ADMIN'] } },
      orderBy: { createdAt: 'asc' },
      select: {
        whitelabelBrandName: true,
        whitelabelLogoUrl: true,
        whitelabelPrimaryColor: true,
        whitelabelEmailFrom: true,
      },
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
