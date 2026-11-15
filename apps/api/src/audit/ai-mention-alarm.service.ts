import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { EmailService } from '../email/email.service.js';
import { FONT, MARKA, MONO, dugme, duzen, ekranKarti, h, kacisla, p } from '../email/email-layout.js';
import { compareCells, type TrendResult, type TrendRow } from './comparable-trend.js';

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
type SnapshotLike = {
  provider: string;
  available?: boolean;
  probes?: unknown;
  matchVersion?: number | null;
};

/**
 * Snapshot'lari karsilastirilabilir hucrelere cevirir: hucre = saglayici ×
 * sorgu, deger = citation-score.ts ile AYNI puan (alinti 100, yalniz anilma
 * 50). Yalnizca markasiz (brandInQuery degil) ve olculebilen (HATA: degil)
 * probe'lar; available=false snapshot hic girmez (kota bitmesi / anahtar
 * hatasi "olcum yok"tur, "skor 0" degil — eskiden sahte dusus e-postasi).
 */
export function snapshotTrend(recent: SnapshotLike[], previous: SnapshotLike[], provider?: string): TrendResult {
  const rows = (snaps: SnapshotLike[], current: boolean): TrendRow[] => snaps
    .filter((s) => s.available !== false && (!provider || s.provider === provider))
    .flatMap((s) => (Array.isArray(s.probes) ? s.probes : [])
      .filter((p: any) => p && typeof p.query === 'string' && !String(p.excerpt ?? '').startsWith('HATA:') && !p.brandInQuery)
      .map((p: any) => ({
        cell: `${s.provider}|${p.query.trim().toLowerCase()}`,
        current,
        value: p.cited ? 100 : p.brandMentioned ? 50 : 0,
        version: s.matchVersion ?? 1,
      })));
  return compareCells([...rows(recent, true), ...rows(previous, false)]);
}

/** Alarm bildiriminin `refKind` degeri (tekrar kontrolu bununla aranir) */
export const ALARM_REF_KIND = 'ai_mention_alarm';
/** Ayni degisiklik bu sure icinde bir kez bildirilir (karsilastirma penceresi 7 + 7 gun) */
export const ALARM_REPEAT_WINDOW_MS = 14 * 86_400_000;

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
      include: { user: { select: { id: true, email: true, deletionRequestedAt: true } } },
    });

    const alerts: AlarmTrigger[] = [];

    for (const site of sites) {
      // Silme talebi olan hesap 30 gunluk bekleme suresinde alarm e-postasi
      // almaz (erisim kapandi). Talepte siteler PAUSED'a alinir, bu yuzden
      // normalde buraya gelmez; sendRaw kontrol etmedigi icin yine de burada.
      if (site.user?.deletionRequestedAt) {
        this.log.debug(`[${site.id}] Alarm taraması atlandı — hesap için silme talebi var (${site.user.id})`);
        continue;
      }
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
      // Panel ziline de duser (sahip, 16.11.2026: "burdaki bildirimleri kullanalım"); e-posta
      // gidemese de musteri degisikligi panelde gorur. Hata e-postayi durdurmaz.
      // AYNI degisiklik bir kez bildirilir. Tarama her gun calisir ama musteri en fazla haftada
      // bir olcer: iki olcum arasindaki fark, yeni olcum gelene kadar her gun AYNI cikar. Eskiden
      // ayni e-posta yedi gun ust uste gidiyordu; zil de ayni satirla dolardi. Metin (sayilariyla)
      // degismedikce yeni bildirim de e-posta da yok; yeni olcum farkli sayi uretince yeniden gider.
      const bildirim = {
        title: `${first.siteName}: AI görünürlük değişikliği`.slice(0, 191),
        body: siteAlerts.map((a) => a.message).join(' · ').slice(0, 1000),
        link: `/sites/${siteId}/visibility`,
      };
      try {
        const onceki = await this.prisma.notification.findFirst({
          where: {
            userId: first.userId, refKind: ALARM_REF_KIND, link: bildirim.link, body: bildirim.body,
            createdAt: { gte: new Date(Date.now() - ALARM_REPEAT_WINDOW_MS) },
          },
          select: { id: true },
        });
        if (onceki) {
          this.log.debug(`[ALARM ${siteId}] Ayni degisiklik daha once bildirildi; tekrar gonderilmedi`);
          continue;
        }
        // Tur SYSTEM: panel turu gostermez; uretimde yazildigi bilinen deger
        await this.prisma.notification.create({
          data: { userId: first.userId, type: 'SYSTEM', ...bildirim, refKind: ALARM_REF_KIND, channels: ['inapp'] },
        });
      } catch (err: any) {
        // Bildirim okunamadi / yazilamadi: e-posta yine gider
        this.log.warn(`[${siteId}] Panel bildirimi yazilamadi: ${err?.message ?? err}`);
      }
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

    // Provider basina kontrol — YALNIZCA ayni sorular ayni saglayicida iki
    // donemde de olculduyse (comparable-trend). Beyin yenilenip sorular
    // degisince ya da alinti olcum yontemi guncellenince eskiden musteriye
    // sahte "gorunurlugun %X dustu" e-postasi gidiyordu.
    const providers = ['anthropic', 'gemini', 'openai', 'perplexity'];
    for (const p of providers) {
      const t = snapshotTrend(recent as any[], previous as any[], p);
      if (t.state !== 'comparable' || t.current === null || t.previous === null) continue;
      const recentAvg = t.current;
      const previousAvg = t.previous;
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

    // Genel kontrol — tum saglayicilarin ortak hucreleri
    const overall = snapshotTrend(recent as any[], previous as any[]);
    if (overall.state === 'comparable' && overall.current !== null && overall.previous !== null && overall.previous >= 5) {
      const recentOverall = overall.current;
      const prevOverall = overall.previous;
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

  private providerLabel(p: string): string {
    return ({ anthropic: 'Claude', gemini: 'Gemini', openai: 'ChatGPT', perplexity: 'Perplexity' } as any)[p] ?? p;
  }

  /**
   * GORUNUM (15.11.2026): ortak e-posta duzeni (email/email-layout.ts); degisimler ustteki
   * ekran kartinda. Eskiden kendi HTML'i vardi: mor (#6c5ce7) baslik ve dugme — eski marka rengi.
   * Site adi ve uyari metni artik KACISLANIR: site adini musteri yazar; kacislanmadan e-postaya
   * gomuluyordu.
   */
  private renderAlertEmail(alerts: AlarmTrigger[]): string {
    const first = alerts[0];
    const satirlar = alerts.map((a, i) => `
      <div style="${i > 0 ? `border-top:1px solid ${MARKA.ekranCizgi};margin-top:14px;padding-top:14px;` : ''}font-family:${FONT};">
        <div style="font-size:17px;line-height:1.3;font-weight:700;letter-spacing:-.3px;color:${MARKA.ekranInk};">${kacisla(a.message)}</div>
        <div style="margin-top:4px;font-size:13px;color:${MARKA.ekranSoluk};">Önceki ortalama: ${a.prevAvg.toFixed(0)}/100 &rarr; Şu an: ${a.currentAvg.toFixed(0)}/100</div>
      </div>`).join('');
    const baslik = 'AI Görünürlük Uyarısı';
    const govde =
      ekranKarti(`<div style="font-family:${MONO};font-size:12px;line-height:16px;color:${MARKA.ekranSoluk};margin-bottom:12px;">${kacisla(first.siteName)} · son 7 gün</div>${satirlar}`) +
      h(baslik) +
      p(`<strong>${kacisla(first.siteName)}</strong> sitenizin son 7 günlük AI görünürlüğünde değişiklikler tespit ettik.`) +
      p('RanksUp <strong>otopilot</strong> moduyla bu sorunları otomatik düzeltebilir. Detaylar için panele bakın:') +
      dugme('Raporu Aç', `https://ranksup.ai/sites/${encodeURIComponent(first.siteId)}?tab=report`) +
      // Altbilgi yalniz koddan dogrulanabileni soyler: alarm son 7 gunu onceki 7
      // gunle kiyaslar (checkSite). Eski "her gun 04:00 UTC'de kontrol edilir"
      // yanlisti — alarm isi 05:00 UTC'de kosar, gunluk olcum cron'u ise
      // AI_CITATION_DAILY_CRON ile kapatilabilir (apps/worker/src/index.ts).
      p(`<span style="font-size:13px;color:${MARKA.soluk};">Bu uyarı, son 7 günün AI görünürlük ölçümleri önceki 7 günle karşılaştırılarak otomatik hazırlanır.</span>`);
    return duzen(baslik, govde, { onizleme: alerts.map((a) => a.message).join(' · '), gorsel: 'zil' });
  }
}
