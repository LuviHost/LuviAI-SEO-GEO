import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { EmailService } from '../email/email.service.js';

export interface AlarmTrigger {
  siteId: string;
  siteName: string;
  userId: string;
  userEmail: string;
  type: 'drop-claude' | 'drop-gemini' | 'drop-openai' | 'drop-perplexity' | 'drop-overall' | 'rise';
  message: string;
  delta: number;
  prevAvg: number;
  currentAvg: number;
}

/**
 * AI Mention Alarm — gunluk citation snapshot'lari karsilastirip drop
 * tespit eder. Eger 7 gun ortalamasi onceki 7 gunden %30+ dustuyse
 * site sahibine email gonderir.
 */
/**
 * Yalnizca GERCEKTEN olculmus skorlar.
 *
 * AiCitationSnapshot, saglayici cevap veremediginde `available=false` ve
 * `score=null` satiri yazar. Bu bir olcum degil, olcumun yoklugudur; ortalamaya
 * 0 olarak girerse kota bitmesi ya da anahtar hatasi "gorunurlugun dustu"
 * alarmina donusur ve musteriye sahte e-posta gider.
 */
function olculebilenSkorlar(kayitlar: Array<{ available?: boolean; score?: number | null }>): number[] {
  return kayitlar.filter((r) => r.available !== false && typeof r.score === 'number').map((r) => r.score as number);
}

@Injectable()
export class AiMentionAlarmService {
  private readonly log = new Logger(AiMentionAlarmService.name);
  private readonly DROP_THRESHOLD = 0.3;   // %30 dusus
  private readonly RISE_THRESHOLD = 0.5;   // %50 yukseslis

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  async scanAndAlert(): Promise<{ scanned: number; alerts: AlarmTrigger[] }> {
    const sites = await this.prisma.site.findMany({
      where: { status: { in: ['ACTIVE', 'AUDIT_COMPLETE'] as any[] } },
      include: { user: { select: { id: true, email: true } } },
    });

    const alerts: AlarmTrigger[] = [];

    for (const site of sites) {
      try {
        const triggers = await this.checkSite(site);
        alerts.push(...triggers);
      } catch (err: any) {
        this.log.warn(`[${site.id}] Alarm scan fail: ${err.message}`);
      }
    }

    // Email gonder (ayni site icin tek mail — birden fazla trigger varsa toplu)
    const bySite = new Map<string, AlarmTrigger[]>();
    for (const a of alerts) {
      const list = bySite.get(a.siteId) ?? [];
      list.push(a);
      bySite.set(a.siteId, list);
    }

    for (const [siteId, siteAlerts] of bySite) {
      const first = siteAlerts[0];
      try {
        await this.email.sendRaw({
          userId: first.userId,
          to: first.userEmail,
          subject: `🚨 ${first.siteName}: AI görünürlük değişikliği`,
          html: this.renderAlertEmail(siteAlerts),
        });
        this.log.log(`[ALARM ${siteId}] Email gonderildi: ${first.userEmail} (${siteAlerts.length} trigger)`);
      } catch (err: any) {
        this.log.warn(`[${siteId}] Email fail: ${err.message}`);
      }
    }

    return { scanned: sites.length, alerts };
  }

  private async checkSite(site: any): Promise<AlarmTrigger[]> {
    const now = new Date();
    const last7 = new Date(now.getTime() - 7 * 86400000);
    const prev7 = new Date(now.getTime() - 14 * 86400000);

    const [recent, previous] = await Promise.all([
      this.prisma.aiCitationSnapshot.findMany({
        where: { siteId: site.id, date: { gte: last7 } },
      }),
      this.prisma.aiCitationSnapshot.findMany({
        where: { siteId: site.id, date: { gte: prev7, lt: last7 } },
      }),
    ]);

    if (recent.length < 4 || previous.length < 4) return []; // yeterli veri yok

    const triggers: AlarmTrigger[] = [];

    // Provider basina kontrol
    const providers = ['anthropic', 'gemini', 'openai', 'perplexity'];
    for (const p of providers) {
      const recentP = recent.filter((r) => r.provider === p);
      const previousP = previous.filter((r) => r.provider === p);
      if (recentP.length === 0 || previousP.length === 0) continue;

      // OLCULEMEYEN SNAPSHOT ORTALAMAYA GIRMEZ. AiCitationSnapshot,
      // saglayici cevap veremediginde available=false + score=null satiri
      // yaziyor. `?? 0` bunu gercek bir sifir sanip "gorunurlugun %X dustu"
      // alarmini tetikliyordu — kota bitmesi ya da anahtar hatasi musteriye
      // sahte dusus e-postasi olarak gidiyordu.
      const recentAvg = this.avg(olculebilenSkorlar(recentP));
      const previousAvg = this.avg(olculebilenSkorlar(previousP));
      if (recentAvg === null || previousAvg === null) continue;
      if (previousAvg < 5) continue; // anlamsiz baz

      const delta = (recentAvg - previousAvg) / previousAvg;

      if (delta <= -this.DROP_THRESHOLD) {
        triggers.push({
          siteId: site.id, siteName: site.name,
          userId: site.user.id, userEmail: site.user.email,
          type: `drop-${p}` as any,
          message: `${this.providerLabel(p)} görünürlüğü %${Math.abs(delta * 100).toFixed(0)} düştü`,
          delta: recentAvg - previousAvg,
          prevAvg: previousAvg,
          currentAvg: recentAvg,
        });
      } else if (delta >= this.RISE_THRESHOLD && recentAvg >= 30) {
        triggers.push({
          siteId: site.id, siteName: site.name,
          userId: site.user.id, userEmail: site.user.email,
          type: 'rise',
          message: `🎉 ${this.providerLabel(p)} görünürlüğü %${Math.abs(delta * 100).toFixed(0)} yükseldi`,
          delta: recentAvg - previousAvg,
          prevAvg: previousAvg,
          currentAvg: recentAvg,
        });
      }
    }

    // Genel skor kontrol
    const recentOverall = this.avg(olculebilenSkorlar(recent));
    const prevOverall = this.avg(olculebilenSkorlar(previous));
    // Iki donemden biri hic olculemediyse genel karsilastirma yapilamaz —
    // saglayici bazli tetikler yukarida zaten toplandi, onlari kaybetmeyelim.
    if (recentOverall !== null && prevOverall !== null && prevOverall >= 5) {
      const delta = (recentOverall - prevOverall) / prevOverall;
      if (delta <= -this.DROP_THRESHOLD) {
        triggers.push({
          siteId: site.id, siteName: site.name,
          userId: site.user.id, userEmail: site.user.email,
          type: 'drop-overall',
          message: `⚠ Genel AI görünürlük %${Math.abs(delta * 100).toFixed(0)} düştü`,
          delta: recentOverall - prevOverall,
          prevAvg: prevOverall,
          currentAvg: recentOverall,
        });
      }
    }

    return triggers;
  }

  /**
   * Ortalama — BOS DIZIDE null, 0 DEGIL.
   *
   * Onceden 0 donuyordu ve bu, "olcum yok" durumunu "skor sifir" haline
   * getiriyordu; yukaridaki delta hesabi da bunu gercek bir cokus sanip
   * musteriye alarm e-postasi gonderiyordu.
   */
  private avg(arr: number[]): number | null {
    if (arr.length === 0) return null;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  private providerLabel(p: string): string {
    return ({ anthropic: 'Claude', gemini: 'Gemini', openai: 'ChatGPT', perplexity: 'Perplexity' } as any)[p] ?? p;
  }

  private renderAlertEmail(alerts: AlarmTrigger[]): string {
    const first = alerts[0];
    return `
<!DOCTYPE html>
<html><body style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
  <h2 style="color: #6c5ce7;">🚨 AI Görünürlük Uyarısı</h2>
  <p>Merhaba,</p>
  <p><strong>${first.siteName}</strong> sitenizin son 7 günlük AI görünürlüğünde değişiklikler tespit ettik:</p>
  <ul>
    ${alerts.map((a) => `
      <li style="margin: 8px 0;">
        <strong>${a.message}</strong><br>
        <small style="color: #666;">
          Önceki ortalama: ${a.prevAvg.toFixed(0)}/100 → Şu an: ${a.currentAvg.toFixed(0)}/100
        </small>
      </li>
    `).join('')}
  </ul>
  <p>RanksUp <strong>otopilot</strong> moduyla bu sorunları otomatik düzeltebilir. Detaylar için panele bakın:</p>
  <p>
    <a href="https://ranksup.ai/sites/${first.siteId}?tab=report"
       style="display: inline-block; background: #6c5ce7; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none;">
      Raporu Aç →
    </a>
  </p>
  <hr style="margin: 24px 0; border: none; border-top: 1px solid #eee;">
  <p style="font-size: 12px; color: #999;">
    RanksUp · AI görünürlük takibi otomatiktir, her gün 04:00 UTC'de kontrol edilir.
  </p>
</body></html>
    `;
  }
}
