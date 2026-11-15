import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { EmailService } from '../email/email.service.js';
import { acquireCronLock } from '../common/cron-lock.js';
import { ReportsService } from './reports.service.js';
import { SiteReportService } from './site-report.service.js';
import { MONTHLY_REPORT_MAX_SITES_PER_USER, monthlyReportData, oncekiAy, type MonthlyOverview } from './monthly-report.js';

/**
 * Ornek (demo) sitenin adresi — articles/article-scheduler.service DEMO_SITE_URL ile ayni deger
 * (monthly-report.spec.ts denetler). Sabit oradan iceri alinmaz: o dosya makale modulunun
 * tamamini yukler. Ornek site gostermeliktir; raporu e-postayla gonderilmez.
 */
export const MONTHLY_REPORT_DEMO_URL = 'https://demo.luviai.com';

/**
 * Her ayin 4–7'si 09:00 (Turkiye).
 *
 * NEDEN AYIN 4'U (1'i degil): Search Console verisi ~2 gun gecikmeli gelir ve birkac gun daha
 * revize edilir (analytics.cron.ts dailySnapshot her gece son 90 gunu yeniden yazar). Ayin 1'inde
 * uretilen rapor onceki ayin son 2–3 gununu eksik sayardi.
 *
 * NEDEN DORT GUN: is tek gun calissaydi yarida kesilen tur (dagitim, proses yeniden baslatma,
 * gonderim hatasi) o ayin raporunu geri kalan musteriler icin kaybederdi; yeniden deneme yoktu.
 * 5–7'sindeki turlar yalniz GONDERILMEMIS siteleri isler (monthlySentKey kaydi); gonderilmis
 * siteye ikinci e-posta gitmez.
 */
export const MONTHLY_REPORT_CRON = '0 9 4-7 * *';

/** "Bu sitenin bu ay raporu gonderildi" kaydinin anahtari (KvStore) */
export const monthlySentKey = (siteId: string, donemKey: string) => `monthly-report-sent:${siteId}:${donemKey}`;
const SENT_KEY_TTL_MS = 90 * 86_400_000;

/**
 * Aylik rapor: onceki takvim ayinin raporu URETILIR, DONDURULUR ve e-postayla haber verilir.
 *
 * NEDEN VAR: `monthly_report` sablonu ve otomatik rapor icin ayrilmis alan (SiteReport.trigger
 * = 'cron') vardi ama ikisini calistiran kod yoktu; musteri aylik rapor almiyordu
 * (monthly-report.ts basligi).
 *
 * AKIS (site basina):
 *  1. Bu ay icin gonderildi kaydi varsa atlanir (hesabin kayitlari donguden once okunur ve
 *     aylik sinira sayilir).
 *  2. Ozet hesaplanir; donemde hareket yoksa RAPOR DA E-POSTA DA YOK.
 *  3. Panelin "Dönem raporu" sekmesindeki "Rapor çalıştır" ile AYNI yoldan
 *     (SiteReportService.generate) dondurulmus rapor uretilir. Onceki bir turda uretilmis ama
 *     e-postasi gidememis rapor varsa YENIDEN URETILMEZ, o kullanilir.
 *  4. E-posta o rapora baglanir; sayilar dondurulmus govdeden okunur (musteri "Raporu aç"a
 *     bastiginda ayni sayilari gorur). Gonderim basariliysa gonderildi kaydi yazilir.
 *
 * KIME: ucretli plandaki hesaplar (deneme hesabi almaz; haftalik rapor ona da gider). Abonelik
 * durumuna bakilmaz: plani elle atanmis hesap da musteridir. Site basina bir e-posta; hesap
 * basina ayda en fazla MONTHLY_REPORT_MAX_SITES_PER_USER.
 *
 * MALIYET: veritabani + Search Console okur; yapay zeka cagrisi ve ucretli olcum YOK.
 *
 * KILITLI (common/cron-lock.ts): API ve worker ayni modulu yukler; kilitsiz her site icin iki
 * rapor uretilir, her musteri iki e-posta alirdi. Kilit gunluk.
 */
@Injectable()
export class MonthlyReportCron {
  private readonly log = new Logger(MonthlyReportCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: ReportsService,
    private readonly siteReports: SiteReportService,
    private readonly email: EmailService,
  ) {}

  @Cron(MONTHLY_REPORT_CRON, { timeZone: 'Europe/Istanbul' })
  async monthlyReports(now: Date = new Date()): Promise<{ sent: number; already: number; inactive: number; failed: number }> {
    // sent: bu turda gonderildi · already: bu ay daha once gonderilmis · inactive: donemde
    // hareketi olmayan site (rapor ve e-posta yok) · failed: gonderilemedi (sonraki gun yeniden denenir)
    const sonuc = { sent: 0, already: 0, inactive: 0, failed: 0 };
    if (!(await acquireCronLock(this.prisma, 'email-monthly-report', 'daily'))) return sonuc;
    const donem = oncekiAy(now);

    const users = await this.prisma.user.findMany({
      where: {
        plan: { not: 'TRIAL' },
        emailVerified: { not: null },
        deletionRequestedAt: null,
        sites: { some: { status: 'ACTIVE', url: { not: MONTHLY_REPORT_DEMO_URL } } },
      },
      select: {
        id: true, email: true, name: true,
        sites: {
          where: { status: 'ACTIVE', url: { not: MONTHLY_REPORT_DEMO_URL } },
          select: { id: true, name: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    for (const u of users) {
      // Bu ay bu hesaba DAHA ONCE giden raporlar donguden ONCE sayilir. Dongu icinde sirayla
      // sayilsaydi sinir asilabilirdi: 7 siteli hesapta ilk gun C basarisiz, A B D E F gitti;
      // ertesi gun dongu A ve B'yi gorup C'yi yeniden deneyince altinci e-posta giderdi.
      const anahtarlar = u.sites.map((s) => monthlySentKey(s.id, donem.key));
      const gonderilmis = new Set(
        anahtarlar.length
          ? (await this.prisma.kvStore.findMany({ where: { key: { in: anahtarlar } }, select: { key: true } })).map((k) => k.key)
          : [],
      );
      sonuc.already += gonderilmis.size;
      let gonderilen = gonderilmis.size;
      for (const site of u.sites) {
        const anahtar = monthlySentKey(site.id, donem.key);
        if (gonderilmis.has(anahtar)) continue;
        if (gonderilen >= MONTHLY_REPORT_MAX_SITES_PER_USER) {
          this.log.warn(`[${u.id}] Aylik rapor: hesap basina ${MONTHLY_REPORT_MAX_SITES_PER_USER} site siniri; kalan siteler icin rapor uretilmedi`);
          break;
        }
        try {

          // Hareket var mi: hareketsiz siteye bos bir rapor kaydi da yazilmaz
          const [ozet, aiOlcum] = await Promise.all([
            this.reports.overview(site.id, { from: donem.from, to: donem.to }),
            this.prisma.aiCitationSnapshot.count({ where: { siteId: site.id, available: true, date: { gte: donem.from, lte: donem.to } } }),
          ]);
          const aiMeasured = aiOlcum > 0;
          if (!monthlyReportData(site, donem, ozet, { aiMeasured })) { sonuc.inactive++; continue; }

          // Onceki turda uretilmis ama e-postasi gidememis rapor yeniden uretilmez
          const rapor =
            (await this.prisma.siteReport.findFirst({
              where: { siteId: site.id, trigger: 'cron', periodStart: donem.from },
              orderBy: { generatedAt: 'desc' },
            })) ?? (await this.siteReports.generate(site.id, { from: donem.from, to: donem.to, userId: u.id, trigger: 'cron' }));

          // Sayilar DONDURULMUS govdeden: e-posta ile acilan rapor ayni seyi soyler
          const ek = { reportId: rapor.id, aiVisibility: rapor.aiVisibility, aiMeasured };
          const dondurulmus = ((rapor.data as any)?.seo ?? ozet) as MonthlyOverview;
          const data = monthlyReportData(site, donem, dondurulmus, ek) ?? monthlyReportData(site, donem, ozet, ek)!;

          // send() hata FIRLATMAZ: saglayici yoksa / gonderim hatasinda { ok: false } doner
          const r = await this.email.send({ userId: u.id, to: u.email, template: 'monthly_report', data: { name: u.name, ...data } });
          if (!r.ok) { sonuc.failed++; continue; }
          gonderilen++;
          sonuc.sent++;
          // Kayit yazilamazsa en kotu sonuc ertesi gun ikinci bir e-postadir; rapor yine tektir
          await this.prisma.kvStore
            .create({ data: { key: anahtar, value: rapor.id, expiresAt: new Date(now.getTime() + SENT_KEY_TTL_MS) } })
            .catch((err: any) => this.log.error(`Aylik rapor gonderildi kaydi yazilamadi ${site.id}: ${err?.message ?? err}`));
        } catch (err: any) {
          // Bir sitenin raporu cikarilamazsa digerleri gonderilmeye devam eder
          sonuc.failed++;
          this.log.error(`Aylik rapor ${u.id}/${site.id}: ${err?.message ?? err}`);
        }
      }
    }

    if (sonuc.sent + sonuc.failed > 0 || now.getUTCDate() === 4) {
      this.log.log(`Aylik rapor (${donem.label}): ${sonuc.sent} gonderildi, ${sonuc.already} daha once gonderilmis, ${sonuc.inactive} hareketsiz site atlandi, ${sonuc.failed} gonderilemedi`);
    }
    return sonuc;
  }
}
