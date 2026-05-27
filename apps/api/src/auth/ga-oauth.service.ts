import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import { google } from 'googleapis';
import { PrismaService } from '../prisma/prisma.service.js';
import { encrypt, decrypt } from '@luviai/shared';
import * as https from 'node:https';
import { URLSearchParams } from 'node:url';

// Native https.request — googleapis gaxios IPv6 ETIMEDOUT bypass icin (GSC ile ayni pattern)
function nativeHttpsJson(opts: {
  method: 'GET' | 'POST';
  hostname: string;
  path: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: opts.method,
        hostname: opts.hostname,
        port: 443,
        path: opts.path,
        family: 4,
        timeout: opts.timeoutMs ?? 15_000,
        headers: opts.headers ?? {},
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          let body: any = text;
          try { body = JSON.parse(text); } catch { /* keep text */ }
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    req.on('timeout', () => { req.destroy(new Error(`request timeout (${opts.timeoutMs ?? 15_000}ms)`)); });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

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
    // ─── Token exchange — native https.request (gaxios bypass) ───
    const clientId = process.env.GA_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID ?? '';
    const clientSecret = process.env.GA_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET ?? '';
    const redirectUri = `${process.env.API_BASE_URL}/api/auth/ga/callback`;

    const tokenBody = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }).toString();

    const tokenRes = await nativeHttpsJson({
      method: 'POST',
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(tokenBody).toString(),
      },
      body: tokenBody,
      timeoutMs: 15_000,
    });

    if (tokenRes.status >= 400) {
      const detail = tokenRes.body?.error_description ?? tokenRes.body?.error ?? `HTTP ${tokenRes.status}`;
      throw new BadRequestException(`Google token exchange failed: ${detail}`);
    }

    const tokens = tokenRes.body as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
      token_type?: string;
    };

    if (!tokens.refresh_token) {
      throw new Error('refresh_token gelmedi — Google hesabinin GA izinlerini sifirlayip tekrar dene');
    }

    // ─── GA accountSummaries — native https.request ───
    let firstPropertyId: string | null = null;
    if (tokens.access_token) {
      try {
        const sumRes = await nativeHttpsJson({
          method: 'GET',
          hostname: 'analyticsadmin.googleapis.com',
          path: '/v1beta/accountSummaries?pageSize=50',
          headers: {
            Authorization: `Bearer ${tokens.access_token}`,
            Accept: 'application/json',
          },
          timeoutMs: 15_000,
        });
        if (sumRes.status < 400) {
          const summaries = sumRes.body?.accountSummaries ?? [];
          for (const a of summaries) {
            for (const p of (a.propertySummaries ?? [])) {
              if (p.property) {
                firstPropertyId = String(p.property).replace(/^properties\//, '');
                break;
              }
            }
            if (firstPropertyId) break;
          }
        }
      } catch (err: any) {
        this.log.warn(`GA accountSummaries list failed: ${err.message}`);
      }
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

  /**
   * Kullanicinin baglandigi Google hesabinda erisilebilen tum GA4
   * property'leri (account + property hierarchy ile).
   */
  async listProperties(siteId: string): Promise<Array<{
    propertyId: string;
    displayName: string;
    accountName: string;
  }>> {
    const client = await this.getAuthenticatedClient(siteId);
    if (!client) throw new BadRequestException('GA bagli degil');

    const admin = google.analyticsadmin({ version: 'v1beta', auth: client as any });
    try {
      const accounts = await admin.accountSummaries.list({ pageSize: 200 });
      const out: Array<{ propertyId: string; displayName: string; accountName: string }> = [];
      for (const a of accounts.data.accountSummaries ?? []) {
        const accountName = a.displayName ?? a.account ?? '?';
        for (const p of a.propertySummaries ?? []) {
          if (!p.property) continue;
          out.push({
            propertyId: p.property.replace(/^properties\//, ''),
            displayName: p.displayName ?? p.property,
            accountName,
          });
        }
      }
      return out;
    } catch (err: any) {
      const msg = String(err?.message ?? '');
      if (/has not been used|is disabled|SERVICE_DISABLED|analyticsadmin\.googleapis\.com/i.test(msg)) {
        const projectMatch = msg.match(/project (\d+)/);
        const project = projectMatch ? projectMatch[1] : null;
        const link = project
          ? `https://console.developers.google.com/apis/api/analyticsadmin.googleapis.com/overview?project=${project}`
          : 'https://console.developers.google.com/apis/library/analyticsadmin.googleapis.com';
        throw new BadRequestException(
          `Google Analytics Admin API etkin degil. Sunucudaki Google Cloud projesinde su sayfadan API'yi etkinlestir: ${link} (etkinlestirdikten 1-2 dk sonra "Listeyi Yenile" butonuna bas).`,
        );
      }
      if (err?.code === 401 || /invalid_grant|unauthorized/i.test(msg)) {
        throw new BadRequestException('GA OAuth token gecerli degil. "Baglantiyi Kes" yapip yeniden bagla.');
      }
      this.log.error(`GA listProperties error: ${msg}`);
      throw new BadRequestException(`Google Analytics property listesi alinamadi: ${msg}`);
    }
  }

  async setProperty(siteId: string, propertyId: string) {
    if (!propertyId) throw new BadRequestException('propertyId zorunlu');
    const properties = await this.listProperties(siteId);
    const found = properties.find((p) => p.propertyId === propertyId);
    if (!found) {
      throw new BadRequestException('Bu property bagli Google hesabinda bulunamadi');
    }
    await this.prisma.site.update({
      where: { id: siteId },
      data: { gaPropertyId: propertyId },
    });
    return found;
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
