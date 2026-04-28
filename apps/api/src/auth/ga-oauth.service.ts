import { Injectable, Logger } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import { google } from 'googleapis';
import { PrismaService } from '../prisma/prisma.service.js';
import { encrypt, decrypt } from '@luviai/shared';

/**
 * Multi-tenant Google Analytics 4 OAuth (GSC pattern'iyle ayni).
 *
 * GSC ile ayni Google project'inde calisir, ayri scope ister
 * (analytics.readonly). Kullanici site bazli ayri OAuth akisindan gecer.
 *
 * Akis:
 *   1) /api/auth/ga/start?siteId=xxx -> Google consent URL
 *   2) Kullanici izin -> /api/auth/ga/callback?code&state
 *   3) refresh_token sifrelenip Site.gaRefreshToken'a yazilir
 *   4) Property listesinden ilki Site.gaPropertyId'a yazilir
 */
@Injectable()
export class GaOAuthService {
  private readonly log = new Logger(GaOAuthService.name);

  constructor(private readonly prisma: PrismaService) {}

  private getClient(): OAuth2Client {
    // GA OAuth ayni Google client'i (GSC ile birlikte) kullanabilir;
    // GA_CLIENT_ID/GA_CLIENT_SECRET ayri verildiyse onu kullan, yoksa
    // GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET fallback.
    return new google.auth.OAuth2(
      process.env.GA_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID,
      process.env.GA_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET,
      `${process.env.API_BASE_URL}/api/auth/ga/callback`,
    );
  }

  async buildAuthorizationUrl(siteId: string): Promise<string> {
    const client = this.getClient();
    return client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: process.env.GA_SCOPES?.split(',') ?? ['https://www.googleapis.com/auth/analytics.readonly'],
      state: siteId,
    });
  }

  async handleCallback(code: string, state: string) {
    const client = this.getClient();
    const { tokens } = await client.getToken(code);

    if (!tokens.refresh_token) {
      throw new Error('refresh_token gelmedi — Google hesabinin GA izinlerini sifirlayip tekrar dene');
    }

    client.setCredentials(tokens);

    // Kullanicinin erisebildigi GA4 property'leri listele
    let firstPropertyId: string | null = null;
    try {
      const admin = google.analyticsadmin({ version: 'v1beta', auth: client as any });
      const accounts = await admin.accountSummaries.list({ pageSize: 50 });
      const summaries = accounts.data.accountSummaries ?? [];
      // accountSummaries[].propertySummaries[].property = "properties/123456"
      for (const a of summaries) {
        for (const p of a.propertySummaries ?? []) {
          if (p.property) {
            firstPropertyId = p.property.replace(/^properties\//, '');
            break;
          }
        }
        if (firstPropertyId) break;
      }
    } catch (err: any) {
      this.log.warn(`GA accountSummaries list failed: ${err.message}`);
    }

    const encrypted = encrypt(tokens.refresh_token);
    await this.prisma.site.update({
      where: { id: state },
      data: {
        gaRefreshToken: encrypted,
        gaConnectedAt: new Date(),
        gaPropertyId: firstPropertyId,
      },
    });

    return { siteId: state, propertyId: firstPropertyId };
  }

  async getAuthenticatedClient(siteId: string): Promise<OAuth2Client | null> {
    const site = await this.prisma.site.findUnique({ where: { id: siteId } });
    if (!site?.gaRefreshToken) return null;

    const client = this.getClient();
    const refreshToken = decrypt(site.gaRefreshToken);
    client.setCredentials({ refresh_token: refreshToken });
    return client;
  }

  async disconnect(siteId: string) {
    await this.prisma.site.update({
      where: { id: siteId },
      data: {
        gaRefreshToken: null,
        gaConnectedAt: null,
        gaPropertyId: null,
      },
    });
    return { ok: true };
  }
}
