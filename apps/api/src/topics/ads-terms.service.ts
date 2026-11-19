import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { GoogleAdsClientService } from '../ads/google-ads-client.service.js';
import { ADS_TERMS_GAQL, parseAdsTermRows, selectContentTerms, type AdsContentTerm } from './ads-terms.js';

/**
 * Konu motoru icin Google Ads arama terimleri (ads-terms.ts). Hesap bagli degilse, yetki ya da
 * API hatasinda bos liste: konu motoru reklam verisi olmadan eskisi gibi calisir.
 */
@Injectable()
export class AdsTermsService {
  private readonly log = new Logger(AdsTermsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly google: GoogleAdsClientService,
  ) {}

  async fetchContentTerms(siteId: string): Promise<AdsContentTerm[]> {
    try {
      const site = await this.prisma.site.findUnique({ where: { id: siteId }, select: { name: true, url: true } });
      if (!site) return [];
      const rows = await this.google.query(siteId, ADS_TERMS_GAQL);
      let host: string | null = null;
      try { host = new URL(site.url).hostname; } catch { host = null; }
      return selectContentTerms(parseAdsTermRows(rows), site.name ?? '', host);
    } catch (err: any) {
      // Baglanti yok / yetki yok: sessiz (cogu sitede reklam hesabi bagli degil)
      this.log.debug?.(`[${siteId}] Reklam terimleri alinamadi: ${err?.message ?? err}`);
      return [];
    }
  }
}
