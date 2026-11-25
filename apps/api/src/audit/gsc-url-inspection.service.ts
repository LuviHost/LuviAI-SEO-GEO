import { Injectable, Logger } from '@nestjs/common';
import { google } from 'googleapis';
import { PrismaService } from '../prisma/prisma.service.js';
import { GscOAuthService } from '../auth/gsc-oauth.service.js';
import {
  INSPECT_MAX, inspectionTargets, summarizeInspection,
  type IndexInspection, type IndexInspectionRow,
} from './gsc-url-inspection.js';

type InspectablePages = Parameters<typeof inspectionTargets>[0];

/** Ayni anda en fazla bu kadar soru (dakikada 600 sinirinin cok altinda) */
const PARALEL = 4;
const ISTEK_ZAMAN_ASIMI_MS = 15_000;

/**
 * Denetim sirasinda taranan sayfalarin Google dizin durumunu Search Console'a
 * sorar (kural ve kaynaklar: gsc-url-inspection.ts). Search Console bagli
 * degilse null — denetim bu bulguyu yazmaz. HATA ATMAZ: yetki / kota / ag
 * hatasi denetimi dusurmez; yetki ya da kota hatasinda kalan sorular atilmaz.
 */
@Injectable()
export class GscUrlInspectionService {
  private readonly log = new Logger(GscUrlInspectionService.name);

  /** Testte degistirilir */
  protected searchconsole = (auth: unknown) => google.searchconsole({ version: 'v1', auth: auth as any });

  constructor(
    private readonly prisma: PrismaService,
    private readonly gsc: GscOAuthService,
  ) {}

  async inspectForAudit(siteId: string, pages: InspectablePages): Promise<IndexInspection | null> {
    try {
      const site = await this.prisma.site.findUnique({
        where: { id: siteId },
        select: { gscPropertyUrl: true, gscRefreshToken: true },
      });
      if (!site?.gscRefreshToken || !site.gscPropertyUrl) return null;
      const property = site.gscPropertyUrl;
      const targets = inspectionTargets(pages, property, INSPECT_MAX);
      if (targets.length === 0) return null;
      const client = await this.gsc.getAuthenticatedClient(siteId);
      if (!client) return null;
      const sc = this.searchconsole(client);

      const rows: IndexInspectionRow[] = [];
      let failed = 0;
      let dur = false;
      for (let i = 0; i < targets.length && !dur; i += PARALEL) {
        const grup = targets.slice(i, i + PARALEL);
        const sonuc = await Promise.all(grup.map(async (url) => {
          try {
            const res = await sc.urlInspection.index.inspect(
              { requestBody: { inspectionUrl: url, siteUrl: property, languageCode: 'tr-TR' } },
              { timeout: ISTEK_ZAMAN_ASIMI_MS },
            );
            const r = res.data.inspectionResult?.indexStatusResult;
            const verdict = r?.verdict ?? null;
            if (!verdict || verdict === 'VERDICT_UNSPECIFIED') return { hata: false as const, row: null };
            return { hata: false as const, row: { url, verdict, coverageState: r?.coverageState ?? null } };
          } catch (err: any) {
            const status = Number(err?.code ?? err?.response?.status);
            // 401/403: mulk yetkisi yok; 429: kota doldu — kalan sorular da ayni cevabi alir
            return { hata: true as const, durdur: status === 401 || status === 403 || status === 429, mesaj: String(err?.message ?? err) };
          }
        }));
        for (const s of sonuc) {
          if (s.hata) {
            failed++;
            if (s.durdur) dur = true;
            continue;
          }
          if (s.row) rows.push(s.row);
          else failed++;
        }
        const ilkHata = sonuc.find((s) => s.hata) as { mesaj?: string } | undefined;
        if (ilkHata?.mesaj) this.log.warn(`[${siteId}] URL denetimi hatasi: ${ilkHata.mesaj}`);
      }
      // Sorulmayan adresler (erken durma) de cevapsiz sayilir
      const sorulmayan = Math.max(0, targets.length - rows.length - failed);
      if (rows.length === 0) return null;
      return summarizeInspection(property, rows, failed + sorulmayan);
    } catch (err: any) {
      this.log.warn(`[${siteId}] URL denetimi yapilamadi: ${err?.message ?? err}`);
      return null;
    }
  }
}
