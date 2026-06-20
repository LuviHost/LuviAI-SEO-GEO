import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import { google } from 'googleapis';
import { PrismaService } from '../prisma/prisma.service.js';
import { encrypt, decrypt } from '@luviai/shared';
import * as https from 'node:https';
import { URLSearchParams } from 'node:url';

/**
 * Native https.request ile POST/GET — googleapis library'nin gaxios fetch'i bu sunucuda
 * IPv6 ETIMEDOUT veriyor. dns.setDefaultResultOrder + undici dispatcher gaxios'a etki etmiyor,
 * o yuzden token exchange ve sites list cagrilarini native module ile yapiyoruz.
 */
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
        family: 4, // IPv4 zorla — IPv6 ETIMEDOUT engellendi
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
      // Yazma scope'u (webmasters) — readonly'nin üst kümesi. searchanalytics okumayı
      // da kapsar + sitemaps.submit (sitemap gönderimi) için gereklidir. Eski readonly
      // ile bağlanmış siteler sitemap submit'te 403 alır → yeniden yetkilendirme gerekir.
      scope: process.env.GSC_SCOPES?.split(',') ?? ['https://www.googleapis.com/auth/webmasters'],
      state: siteId,
    });
  }

  /** Callback: code → token, encrypted refresh_token DB'ye yaz */
  async handleCallback(code: string, state: string) {
    const site = await this.prisma.site.findUnique({
      where: { id: state },
      select: { id: true, gscRefreshToken: true, gscPropertyUrl: true },
    });
    if (!site) throw new NotFoundException('Site bulunamadı');

    // ─── Token exchange — native https.request (gaxios bypass) ───
    const tokenBody = new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      redirect_uri: `${process.env.API_BASE_URL}/api/auth/gsc/callback`,
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

    // Google her callback'te refresh_token dönmeyebilir.
    const resolvedRefreshToken =
      tokens.refresh_token ??
      (site.gscRefreshToken ? decrypt(site.gscRefreshToken) : null);

    if (!resolvedRefreshToken) {
      throw new BadRequestException('Google refresh token döndürmedi. Google hesabında erişimi kaldırıp tekrar dene.');
    }

    // ─── GSC sites list — native https.request ───
    let properties: string[] = [];
    if (tokens.access_token) {
      try {
        const sitesRes = await nativeHttpsJson({
          method: 'GET',
          hostname: 'www.googleapis.com',
          path: '/webmasters/v3/sites',
          headers: {
            Authorization: `Bearer ${tokens.access_token}`,
            Accept: 'application/json',
          },
          timeoutMs: 15_000,
        });
        if (sitesRes.status < 400 && Array.isArray(sitesRes.body?.siteEntry)) {
          properties = sitesRes.body.siteEntry
            .map((s: any) => s.siteUrl)
            .filter((v: any): v is string => !!v);
        }
      } catch {
        // Token kaydı başarısız olmasın diye property listesi hatasını yutuyoruz.
        properties = [];
      }
    }

    // Şifreleyip kaydet
    const encrypted = encrypt(resolvedRefreshToken);
    const preferredProperty =
      site.gscPropertyUrl && properties.includes(site.gscPropertyUrl)
        ? site.gscPropertyUrl
        : (properties[0] ?? null);

    await this.prisma.site.update({
      where: { id: state },
      data: {
        gscRefreshToken: encrypted,
        gscConnectedAt: new Date(),
        gscPropertyUrl: preferredProperty, // ilk property — kullanıcı sonra değiştirebilir
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

  /**
   * GSC'ye sitemap gönder (Search Console API `sitemaps.submit`).
   * Best-effort — bağlı değilse / yazma scope'u yoksa hata fırlatmaz, sonucu döner.
   *
   * NOT: `sitemaps.submit` yazma scope'u (`.../auth/webmasters`) ister. readonly ile
   * bağlanmış eski siteler 403 alır → kullanıcı GSC'yi yeniden bağlamalı.
   */
  async submitSitemap(
    siteId: string,
    sitemapUrl: string,
  ): Promise<{ ok: boolean; skipped?: string; error?: string }> {
    const site = await this.prisma.site.findUnique({
      where: { id: siteId },
      select: { gscRefreshToken: true, gscPropertyUrl: true },
    });
    if (!site?.gscRefreshToken) return { ok: false, skipped: 'not_connected' };
    if (!site.gscPropertyUrl) return { ok: false, skipped: 'no_property' };

    const client = await this.getAuthenticatedClient(siteId);
    if (!client) return { ok: false, skipped: 'not_connected' };

    try {
      const webmasters = google.webmasters({ version: 'v3', auth: client as any });
      await webmasters.sitemaps.submit({
        siteUrl: site.gscPropertyUrl,
        feedpath: sitemapUrl,
      });
      return { ok: true };
    } catch (err: any) {
      const status = err?.code ?? err?.response?.status;
      // 403 = readonly scope (yazma yetkisi yok) → yeniden yetkilendirme gerekir.
      const reason = status === 403 ? 'insufficient_scope (reconnect GSC)' : (err?.message ?? 'unknown');
      return { ok: false, error: reason };
    }
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
