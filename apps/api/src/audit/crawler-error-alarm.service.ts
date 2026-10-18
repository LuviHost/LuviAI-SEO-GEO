import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { WebhookNotifierService } from './webhook-notifier.service.js';
import { findCrawlerErrorTriggers, type BotDailyRow } from './crawler-error-rate.js';

/**
 * Bot adi bildirim basligina ve webhook'a AYNEN yazilir; yalniz UA belirteci
 * bicimindeki adlar kabul edilir (GPTBot, ChatGPT-User, cohere-ai...).
 * NEDEN: eski ara katman ?site=<id>|<tarih>|<metin> ile serbest metni bot adi
 * olarak yazdirabiliyordu ("Hesabiniz askiya alindi - ... evil.example" gibi
 * bir baslik musterinin bildirimine ve Slack/Discord'una gitti). Yeni yazim
 * yolu bunu kapatti; bu kural kalmis eski satirlara karsi da korur.
 */
const BOT_ADI_RE = /^[A-Za-z][A-Za-z0-9-]{1,39}$/;

/** Alarmin okudugu AiCrawlerHit alanlari */
export interface AlarmHitRow {
  bot: string;
  date: Date;
  /** Gunluk istek sayisi: guvenilir kaynaklarin TUM istekleri (3xx dahil) + betik/beacon sayimi */
  hits?: number | null;
  /** Yalniz log yuklemesi yazar (>0 = satir log yuklemesinden) */
  uniqueUrls?: number | null;
  /** Basarili son cevap: 2xx + 304 (crawler-analytics isSuccessfulCrawlStatus; eski satirlarda yalniz 2xx) */
  status2xx: number;
  status4xx: number;
  status5xx: number;
}

const sayi = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : 0);
const gunAnahtari = (d: Date) => d.toISOString().slice(0, 10);

/**
 * AiCrawlerHit satirindan alarm girdisi — YALNIZ durum kodu GUVENILIR
 * kaynaktan bilinen istekler; 3xx (304 dahil) da "ulasildi" sayilir.
 *
 * Guvenilir kaynaklar ne saklar (kod okunarak):
 *  - Log yuklemesi (crawler-analytics.service ingestLog): `hits` = logdaki TUM
 *    bot istekleri (3xx dahil, upsert ile UZERINE yazar), kovalar basarili
 *    (2xx + 304) / 4xx / >=500; `uniqueUrls` >= 1 yalniz bu yol yazar.
 *  - Imzali edge ingest (live-crawler.service updateDailyAggregates): `hits`
 *    her istekte +1, kovalar ayni kuralla — 301/302/307/308 hicbir kovaya
 *    girmez; ham istekler durum koduyla crawlerHitEvent'te (imzali, 60 gun) durur.
 *  - Betik/beacon (crawler-tracking.middleware) herkese acik: yalniz `hits`
 *    arttirir, durum yazmaz.
 *  - Iki guvenilir yazici 304'u basarili kovaya R16 kok duzeltmesiyle yazmaya
 *    basladi. ONCEKI satirlarda 304 de kovasizdir; pencere 3 gun oldugu icin
 *    gecis gunlerinde eski, yeni ve ayni gun karisik satirlar birlikte okunur.
 *
 * NEDEN 3xx: eskiden payda 2xx+4xx+5xx'ti; 304 Not Modified (degismeyen
 * sayfaya kosullu GET — basarili SON cevap) paydadan dusuyordu. Bingbot
 * 80×304 + 12×200 + 8×404 (gercek hata %8) "%40 hata — Bingbot sitene
 * ulaşamıyor" alarmi uretiyordu. Yonlendirme (301/302) de sunucunun bota
 * verdigi gecerli cevaptir ("ulasildi"); ama basarili kovaya yazilmaz, cunku
 * "site ayakta" kaniti degildir (isSuccessfulCrawlStatus notu).
 *
 * NEDEN `hits` dogrudan payda DEGIL: beacon sayimi da `hits`'e yazar; payda
 * olsaydi dogrulanmamis istekler orani sulandirip gercek bir engeli
 * gizleyebilirdi (WAF musterinin alan adinda GPTBot'u engellerken GPTBot
 * tracker.js'i RanksUp'tan indirmeye devam edebilir). Bu yuzden kovasiz 3xx:
 *  - log satirinda: hits - (basarili+4xx+5xx) — log yuklemesi hits'i logdaki
 *    sayiyla ezer; yukleme gunu sonradan gelen beacon isabeti buraya
 *    karisabilir (yalniz orani DUSURUR, alarm uretemez);
 *  - diger satirlarda: kovasiz3xx (imzali ham isteklerden kovaya girmemis
 *    3xx), satirin aciklanmamis hits'iyle sinirli.
 * Beacon hicbir durumda alarm URETEMEZ (yalniz paydayi buyutebilir); pay ve
 * "saglikli bot" kumesi yalniz durum sayaclarindan gelir.
 */
export function trustedStatusRow(r: AlarmHitRow, liveRedirects = 0): BotDailyRow {
  const s2 = sayi(r.status2xx);
  const s4 = sayi(r.status4xx);
  const s5 = sayi(r.status5xx);
  const known = s2 + s4 + s5;
  const unexplained = Math.max(0, sayi(r.hits) - known);
  const redirects = sayi(r.uniqueUrls) > 0 ? unexplained : Math.min(unexplained, sayi(liveRedirects));
  return {
    bot: r.bot,
    date: gunAnahtari(r.date),
    hits: known + redirects,
    status2xx: s2,
    status4xx: s4,
    status5xx: s5,
  };
}

/** Bir gun + bot icin imzali ham istek sayilari (crawlerHitEvent) */
export interface HamIstekSayisi {
  /** Durum 200-299 */
  r2xx: number;
  /** Durum 300-399 (304 dahil) */
  r3xx: number;
}

/**
 * Log-disi satirda kovaya GIRMEMIS imzali 3xx sayisi:
 * ham 3xx - (basarili kova - ham 2xx), 0'in altina inmez.
 *
 * Basarili kova ile ham 2xx'in farki kovaya yazilmis 304 sayisidir: yazicilar
 * 304'u artik basarili kovaya yaziyor (isSuccessfulCrawlStatus); bu
 * degisiklikten onceki satirlarda fark 0, ayni gun karisik satirda yalniz
 * kovaya girmis kisim. Sonuc: eski satirda tum 3xx, yenide yalniz
 * 301/302/307/308.
 *
 * NEDEN ham 3xx'in kendisi DEGIL: yeni satirdaki 304'leri IKI kez sayardi.
 * Satirda beacon isabeti de varsa (aciklanmamis hits) payda sisip gercek bir
 * engel alarmsiz kalir ve "durum kodu ölçülen N istek" sayisi yanlis
 * yazilirdi. Yalniz 2xx ve 3xx karsilastirilir: kovasi yazilamamis (aggregate
 * yazimi dusmus) bir 4xx/5xx ya da durumu bilinmeyen (ingest'in 100'e
 * sikistirdigi) istek 3xx sayilmaz. Beacon ham tabloya yazmaz. HEAD donemi
 * ara katmani beacon isabetlerini 2xx kovasina da yaziyordu; o eski satirlarda
 * sonuc kuculur ama bu isabetler zaten kovada (paydada) oldugu icin payda
 * imzali canli toplamin altina dusmez.
 */
export function kovasiz3xx(r: AlarmHitRow, ham: HamIstekSayisi): number {
  const kovadaki304 = Math.max(0, sayi(r.status2xx) - sayi(ham.r2xx));
  return Math.max(0, sayi(ham.r3xx) - kovadaki304);
}

/**
 * Bildirim metnindeki hata dokumu (R22): 4xx ve 5xx ayri ve gercek sayilarla.
 * Eskiden toplam hata (4xx+5xx) cogunluk sinifinin etiketiyle yaziliyordu:
 * 10×4xx + 12×5xx "22 tanesinde 5xx aldı" oluyordu.
 */
export function hataDokumu(errors: number, s4: number, s5: number): string {
  if (s4 > 0 && s5 > 0) return `${errors} tanesinde hata aldı (${s5} tanesi 5xx, ${s4} tanesi 4xx)`;
  return `${errors} tanesinde ${s5 > 0 ? '5xx' : '4xx'} aldı`;
}

/**
 * Bot hata-orani alarmi — 6 saatte bir (worker CRAWLER_ERROR_ALARM).
 *
 * Son 2 gunun AiCrawlerHit satirlarindan "bu bot hata aliyor ama digerleri
 * basarili yanit (2xx ya da 304) aliyor" durumunu bulur; gunde bot basina
 * TEK bildirim (kvStore kilidi, live-crawler notifyCiteFetch deseni). Veri
 * zaten toplaniyordu, uyari yoktu.
 * Vaka: IRS.gov, Ağu 2026 — insanlara acik site, botlara kapali; bir ayda
 * tum siralamalar gitti.
 *
 * YALNIZ GUVENILIR KAYNAK: oran durum sayaclarindan (imzali ingest + log
 * yuklemesi) hesaplanir, imzasiz betik/beacon sayimi alarma girmez
 * (trustedStatusRow). Eskiden herkes ?status=500 ile sahte alarm urettirebiliyordu.
 * Paydada 3xx (304 dahil) de var: saglikli, onbellekli sitede sahte
 * "ulaşamıyor" alarmi gitmesin (R16). Kok duzeltme yazicilarda: 304 basarili
 * kovaya yazilir; yonlendirmeler kovasiz kalir ve paydaya burada eklenir.
 * Metin 4xx ve 5xx'i ayri sayar (R22).
 */
@Injectable()
export class CrawlerErrorAlarmService {
  private readonly log = new Logger(CrawlerErrorAlarmService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly webhook: WebhookNotifierService,
  ) {}

  async scanAndAlert(): Promise<{ sites: number; alerts: number }> {
    const since = new Date(Date.now() - 2 * 86_400_000);
    since.setUTCHours(0, 0, 0, 0);
    const sites = await this.prisma.site.findMany({
      where: { status: { in: ['ACTIVE', 'AUDIT_COMPLETE'] as any[] } },
      select: { id: true, userId: true, name: true },
    });

    let alerts = 0;
    for (const site of sites) {
      try {
        const rows: AlarmHitRow[] = await this.prisma.aiCrawlerHit.findMany({
          where: { siteId: site.id, date: { gte: since } },
          select: { bot: true, date: true, hits: true, uniqueUrls: true, status2xx: true, status4xx: true, status5xx: true },
        });
        const valid = rows.filter((r) => BOT_ADI_RE.test(r.bot));
        // Hic 4xx/5xx yoksa tetik olamaz: ham istek sorgusu da yapilmaz
        if (!valid.some((r) => sayi(r.status4xx) + sayi(r.status5xx) > 0)) continue;
        const redirects = await this.liveRedirects(site.id, valid);
        const trusted = valid.map((r) => trustedStatusRow(r, redirects.get(`${gunAnahtari(r.date)}|${r.bot}`) ?? 0));
        const triggers = findCrawlerErrorTriggers(trusted);
        for (const t of triggers) {
          if (await this.alreadyNotified(site.id, t.bot)) continue;
          const pct = Math.round(t.errorRate * 100);
          const title = `⚠️ ${t.bot} sitene ulaşamıyor (%${pct} hata)`;
          const own = trusted.filter((r) => r.bot === t.bot);
          const s4 = own.reduce((a, r) => a + r.status4xx, 0);
          const s5 = own.reduce((a, r) => a + r.status5xx, 0);
          // t.hits = durum kodu guvenilir kaynaktan bilinen istek sayisi (3xx dahil;
          // trustedStatusRow). Pencere: iki gun once UTC gece yarisindan bu yana
          // gunluk satirlar (48-72 saat) — eski "son 48 saatte" bu yuzden yanlisti.
          // Saglikli bot = basarili kovasi dolu bot; kova artik 2xx + 304
          // (isSuccessfulCrawlStatus) — yalniz 304 alan bota "2xx alıyor" demek
          // yanlis olurdu.
          const body =
            `${site.name}: son 3 günde (bugün dahil) ${t.bot}, durum kodu ölçülen ${t.hits} isteğin ${hataDokumu(t.errors, s4, s5)}; ` +
            `${t.healthyBots.join(', ')} ise başarılı yanıt (2xx ya da 304) alıyor — yani site ayakta ama bu bota özel bir engel/katman var ` +
            `(WAF, bot koruması, UA kuralı). Google/AI görünürlüğü bu sürerken erir; Cloudflare/WAF kurallarını ve robots.txt'i kontrol et.`;
          await this.notifications.create({
            userId: site.userId,
            type: 'SYSTEM',
            title,
            body,
            link: `/sites/${site.id}/crawler-live`,
          });
          this.webhook.notify({
            siteId: site.id,
            siteName: site.name,
            event: 'crawler_error_spike',
            title,
            message: body,
            url: `/sites/${site.id}/crawler-live`,
          } as any).catch?.(() => undefined);
          alerts++;
        }
      } catch (err: any) {
        this.log.warn(`[${site.id}] crawler error alarm fail: ${err.message}`);
      }
    }
    if (alerts > 0) this.log.log(`Crawler hata alarmi: ${sites.length} site, ${alerts} bildirim`);
    return { sites: sites.length, alerts };
  }

  /**
   * Log-disi satirlar icin gun + bot basina kovaya girmemis imzali 3xx
   * (kovasiz3xx). Ham istekler crawlerHitEvent'ten: yalniz imzasi dogrulanan
   * istekle yazilir (live-crawler ingest). Yalniz aciklanmamis hits'i olan
   * log-disi satirlarin gunleri icin, gun basina TEK groupBy (bot + durum)
   * ile sorulur; log satirinda 3xx zaten hits farkindan okunur
   * (trustedStatusRow).
   */
  private async liveRedirects(siteId: string, rows: AlarmHitRow[]): Promise<Map<string, number>> {
    const logDisi = rows.filter((r) => sayi(r.uniqueUrls) <= 0);
    const days = new Set<string>();
    for (const r of logDisi) {
      if (sayi(r.hits) - (sayi(r.status2xx) + sayi(r.status4xx) + sayi(r.status5xx)) <= 0) continue;
      days.add(gunAnahtari(r.date));
    }
    const ham = new Map<string, HamIstekSayisi>();
    for (const day of days) {
      const start = new Date(`${day}T00:00:00.000Z`);
      const groups = await this.prisma.crawlerHitEvent.groupBy({
        by: ['bot', 'status'],
        where: { siteId, ts: { gte: start, lt: new Date(start.getTime() + 86_400_000) } },
        _count: { _all: true },
      });
      for (const g of groups) {
        const key = `${day}|${g.bot}`;
        const cur = ham.get(key) ?? { r2xx: 0, r3xx: 0 };
        if (g.status >= 200 && g.status < 300) cur.r2xx += g._count._all;
        else if (g.status >= 300 && g.status < 400) cur.r3xx += g._count._all;
        ham.set(key, cur);
      }
    }
    const out = new Map<string, number>();
    for (const r of logDisi) {
      const key = `${gunAnahtari(r.date)}|${r.bot}`;
      const h = ham.get(key);
      if (h) out.set(key, kovasiz3xx(r, h));
    }
    return out;
  }

  /** Gunde bot basina tek bildirim — kvStore unique key kilidi */
  private async alreadyNotified(siteId: string, bot: string): Promise<boolean> {
    const stamp = new Date().toISOString().slice(0, 10);
    try {
      await this.prisma.kvStore.create({
        data: { key: `crawler-err:${siteId}:${bot}:${stamp}`, value: '1', expiresAt: new Date(Date.now() + 3 * 86_400_000) },
      });
      return false;
    } catch {
      return true;
    }
  }
}
