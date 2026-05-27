import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { google } from 'googleapis';
import { PrismaService } from '../prisma/prisma.service.js';
import { GscOAuthService } from '../auth/gsc-oauth.service.js';
import { WebhookNotifierService } from './webhook-notifier.service.js';

/**
 * ENH#4 — Performance Feedback Loop.
 *
 * Bir recovery uygulandiktan 30 gun sonra:
 *   1. Recovery'nin URL'i icin GSC son 30 gun verisini cek
 *   2. positionBefore vs simdiki position karsilastir
 *   3. ctrBefore vs simdiki ctr karsilastir
 *   4. effectivenessScore hesapla (0-100):
 *      - position iyileme: +50 puan
 *      - ctr artisi: +30 puan
 *      - clicks artisi: +20 puan
 *   5. Recovery kaydina yaz, webhook notify et
 *
 * Bu data zamanla "hangi tarz edit'ler iyi calisiyor" verisi olusturur —
 * gelecekte LLM prompt'una "geri besleme" olarak ekleyebiliriz.
 */
@Injectable()
export class StuckPagePerformanceCheckService {
  private readonly log = new Logger(StuckPagePerformanceCheckService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gscOAuth: GscOAuthService,
    private readonly webhook: WebhookNotifierService,
  ) {}

  async check(recoveryId: string): Promise<{
    ok: boolean;
    effectivenessScore?: number;
    positionImprovement?: number;
    reason?: string;
  }> {
    const recovery = await this.prisma.stuckPageRecovery.findUnique({
      where: { id: recoveryId },
      include: { stuckPage: true },
    });
    if (!recovery) throw new NotFoundException('Recovery bulunamadi');
    if (recovery.revertedAt) {
      return { ok: false, reason: 'Recovery geri alinmis — olcum yapilmaz' };
    }
    if (recovery.effectivenessCheckAt) {
      this.log.log(`[${recoveryId}] Zaten olculmus, atlandi`);
      return { ok: true, effectivenessScore: recovery.effectivenessScore ?? undefined };
    }

    const stuckPage = recovery.stuckPage;
    const site = await this.prisma.site.findUnique({
      where: { id: stuckPage.siteId },
      select: { id: true, name: true, userId: true, gscPropertyUrl: true, gscRefreshToken: true },
    });
    if (!site?.gscPropertyUrl || !site.gscRefreshToken) {
      return { ok: false, reason: 'GSC bagli degil' };
    }

    // Bu URL icin son 30 gun GSC verisini cek
    const client = await this.gscOAuth.getAuthenticatedClient(stuckPage.siteId);
    if (!client) return { ok: false, reason: 'GSC auth failed' };

    const webmasters = google.webmasters({ version: 'v3', auth: client as any });
    const endDate = new Date().toISOString().slice(0, 10);
    const startDate = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

    let position: number | null = null;
    let ctr: number | null = null;
    let clicks: number | null = null;
    try {
      const res = await webmasters.searchanalytics.query({
        siteUrl: site.gscPropertyUrl,
        requestBody: {
          startDate,
          endDate,
          dimensions: ['page'],
          dimensionFilterGroups: [{
            filters: [{ dimension: 'page', operator: 'equals', expression: stuckPage.url }],
          }],
          rowLimit: 1,
        },
      });
      const row = res.data.rows?.[0];
      if (row) {
        position = row.position ?? null;
        ctr = row.ctr ?? null;
        clicks = row.clicks ?? null;
      }
    } catch (err: any) {
      this.log.warn(`[${recoveryId}] GSC fetch hata: ${err.message}`);
      return { ok: false, reason: `GSC: ${err.message}` };
    }

    if (position === null) {
      this.log.log(`[${recoveryId}] URL'e ait GSC verisi yok (henuz indexlenmemis olabilir)`);
      // Yine kayit at — re-check icin 30 gun daha ekleyebiliriz ileride
      await this.prisma.stuckPageRecovery.update({
        where: { id: recoveryId },
        data: {
          effectivenessCheckAt: new Date(),
          effectivenessScore: 0,
        },
      });
      return { ok: true, effectivenessScore: 0, reason: 'GSC verisi henuz yok' };
    }

    const positionBefore = recovery.positionBefore ?? stuckPage.position;
    const ctrBefore = recovery.ctrBefore ?? stuckPage.ctr;

    // Position improvement: pozitif = iyilesti (sira ne kadar azaldiysa)
    const positionImprovement = positionBefore - position;
    const ctrChange = ctr !== null ? ctr - ctrBefore : 0;
    const clicksBefore = stuckPage.clicks;
    const clicksChange = clicks !== null ? clicks - clicksBefore : 0;

    // Effectiveness score (0-100)
    let score = 0;
    if (positionImprovement >= 3) score += 50;       // 3+ sira yukseldi = mukemmel
    else if (positionImprovement >= 1) score += 30;  // 1-3 sira = iyi
    else if (positionImprovement >= 0) score += 10;  // hareket yok = notr
    else score += 0;                                  // dustu = kotu

    if (ctrChange > 0.01) score += 30;
    else if (ctrChange > 0) score += 15;

    if (clicksChange > 5) score += 20;
    else if (clicksChange > 0) score += 10;

    score = Math.min(100, score);

    await this.prisma.stuckPageRecovery.update({
      where: { id: recoveryId },
      data: {
        effectivenessCheckAt: new Date(),
        positionAfter: position,
        positionImprovement,
        ctrAfter: ctr,
        effectivenessScore: score,
      } as any,
    });

    this.log.log(
      `[${recoveryId}] Performance check: pos ${positionBefore.toFixed(1)}->${position.toFixed(1)} (${positionImprovement >= 0 ? '+' : ''}${positionImprovement.toFixed(1)}), ctr ${(ctrBefore * 100).toFixed(2)}%->${(ctr ?? 0 * 100).toFixed(2)}%, score=${score}`,
    );

    // Webhook bildirim — sadece anlamli sonuc varsa
    if (site.userId && (score >= 60 || score < 20)) {
      const positive = score >= 60;
      await this.webhook.notify({
        siteId: stuckPage.siteId,
        siteName: site.name,
        event: positive ? 'stuck_page_recovered' : 'ai_citation_drop',
        title: positive
          ? `Recovery basarili: ${stuckPage.title ?? stuckPage.url}`
          : `Recovery beklenenden zayif: ${stuckPage.title ?? stuckPage.url}`,
        message: positive
          ? `30 gun sonra: pozisyon #${positionBefore.toFixed(1)}'den #${position.toFixed(1)}'e cikti. CTR ${(ctrBefore * 100).toFixed(2)}% -> ${(ctr! * 100).toFixed(2)}%. Etki skoru: ${score}/100`
          : `30 gun sonra: pozisyon ${positionImprovement >= 0 ? 'sadece' : 'geri'} ${Math.abs(positionImprovement).toFixed(1)} sira degisti. Etki skoru: ${score}/100. Yeniden recover veya manuel inceleme onerilir.`,
        url: stuckPage.url,
        meta: { recoveryId, score, positionImprovement, ctrChange, clicksChange },
      }).catch(() => null);
    }

    return { ok: true, effectivenessScore: score, positionImprovement };
  }
}
