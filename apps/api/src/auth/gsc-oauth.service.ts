import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import { google } from 'googleapis';
import { PrismaService } from '../prisma/prisma.service.js';
import { encrypt, decrypt } from '@luviai/shared';

/**
 * Multi-tenant GSC OAuth.
 *
 * Akış:
 *  1) Kullanıcı dashboard'da "GSC bağla" butonuna basar
 *  2) /api/auth/gsc/start?siteId=xxx → Google consent URL döner
 *  3) Kullanıcı izin verir, Google /api/auth/gsc/callback?code=...&state=... gelir
 *  4) Code → access_token + refresh_token swap edilir
 *  5) refresh_token şifrelenip Site.gscRefreshToken'a kaydedilir
 *  6) Sonradan her GSC çağrısında refresh_token ile yeni access_token alınır
 */
@Injectable()
export class GscOAuthService {
  constructor(private readonly prisma: PrismaService) {}

  private getClient(): OAuth2Client {
    return new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      `${process.env.API_BASE_URL}/api/auth/gsc/callback`,
    );
  }

  /** Site sahibinin GSC izinlemek için tıklayacağı URL */
  async buildAuthorizationUrl(siteId: string): Promise<string> {
    const client = this.getClient();
    return client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: process.env.GSC_SCOPES?.split(',') ?? ['https://www.googleapis.com/auth/webmasters.readonly'],
      state: siteId,
    });
  }

  /** Callback: code → token, encrypted refresh_token DB'ye yaz */
  async handleCallback(code: string, state: string) {
    const client = this.getClient();
    const { tokens } = await client.getToken(code);

    if (!tokens.refresh_token) {
      throw new Error('refresh_token gelmedi — kullanıcı önce revoke etmeli');
    }

    // Hangi GSC property'lerine erişimi var?
    client.setCredentials(tokens);
    const webmasters = google.webmasters({ version: 'v3', auth: client });
    const list = await webmasters.sites.list();
    const properties = list.data.siteEntry?.map(s => s.siteUrl) ?? [];

    // Şifreleyip kaydet
    const encrypted = encrypt(tokens.refresh_token);
    await this.prisma.site.update({
      where: { id: state },
      data: {
        gscRefreshToken: encrypted,
        gscConnectedAt: new Date(),
        gscPropertyUrl: properties[0] ?? null, // ilk property — kullanıcı sonra değiştirebilir
      },
    });

    return { siteId: state, properties };
  }

  /** GSC API çağrısı için authenticated client al */
  async getAuthenticatedClient(siteId: string): Promise<OAuth2Client | null> {
    const site = await this.prisma.site.findUnique({ where: { id: siteId } });
    if (!site?.gscRefreshToken) return null;

    const client = this.getClient();
    const refreshToken = decrypt(site.gscRefreshToken);
    client.setCredentials({ refresh_token: refreshToken });
    return client;
  }

  /** Kullanicinin baglandigi Google hesabinda erisilebilen tum GSC property'leri */
  async listProperties(siteId: string): Promise<Array<{ siteUrl: string; permissionLevel: string | null }>> {
    const client = await this.getAuthenticatedClient(siteId);
    if (!client) throw new BadRequestException('GSC bagli degil');

    const webmasters = google.webmasters({ version: 'v3', auth: client as any });
    const list = await webmasters.sites.list();
    return (list.data.siteEntry ?? [])
      .filter((s) => !!s.siteUrl)
      .map((s) => ({
        siteUrl: s.siteUrl as string,
        permissionLevel: (s as any).permissionLevel ?? null,
      }));
  }

  /** Aktif property'i degistir (kullanici dropdown'dan secer) */
  async setProperty(siteId: string, propertyUrl: string) {
    if (!propertyUrl) throw new BadRequestException('propertyUrl zorunlu');
    // Kullanicinin gercekten o property'e erisimi var mi kontrol et
    const properties = await this.listProperties(siteId);
    const found = properties.find((p) => p.siteUrl === propertyUrl);
    if (!found) {
      throw new BadRequestException('Bu property bagli Google hesabinda bulunamadi');
    }
    await this.prisma.site.update({
      where: { id: siteId },
      data: { gscPropertyUrl: propertyUrl },
    });
    return { siteUrl: propertyUrl };
  }

  async disconnect(siteId: string) {
    await this.prisma.site.update({
      where: { id: siteId },
      data: {
        gscRefreshToken: null,
        gscConnectedAt: null,
        gscPropertyUrl: null,
      },
    });
    return { ok: true };
  }
}
