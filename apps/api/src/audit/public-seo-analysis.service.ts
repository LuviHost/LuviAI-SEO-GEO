import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { JobQueueService } from '../jobs/job-queue.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { SiteCrawlerService } from '../sites/site-crawler.service.js';
import { assertPublicDomainResolves, normalizePublicDomainInput } from '../sites/site-url-policy.js';
import { AuditChecksService, OVERALL_SCORE_WEIGHTS } from './audit-checks.service.js';
import { PageSpeedService } from './pagespeed.service.js';
import { AttemptWindow } from './public-subscribe-limits.js';
import {
  GLOBAL_GUNLUK, IP_GUNLUK, ONBELLEK_MS, TAKILMA_MS, TARANACAK_SAYFA, analizOzeti, type SeoAnalizSonucu,
} from './public-seo-analysis.js';

export const PUBLIC_SEO_JOB = 'PUBLIC_SEO_ANALYSIS';

export const SEO_IP_LIMIT_MESSAGE = `Aynı ağdan 24 saatte en fazla ${IP_GUNLUK} farklı site analiz edilebilir. Yarın tekrar deneyebilir ya da ücretsiz hesap açıp sitenin tamamını tarayabilirsin.`;
export const SEO_GLOBAL_LIMIT_MESSAGE = 'Bugünkü ücretsiz analiz kapasitesi doldu. Yarın tekrar deneyebilir ya da ücretsiz hesap açıp sitenin tamamını tarayabilirsin.';
const SEO_FAILED_MESSAGE = 'Analiz tamamlanamadı. Site geçici olarak yanıt vermemiş olabilir; birkaç dakika sonra tekrar dene.';

export interface SeoAnalizDurumu {
  id: string;
  domain: string;
  status: 'queued' | 'running' | 'done' | 'error';
  /** Yalniz e-posta yazildiysa dolu (sonucu gormek icin e-posta sarti, 25.11.2026) */
  result: SeoAnalizSonucu | null;
  /** Bu analiz icin e-posta yazildi mi */
  emailVar: boolean;
  error: string | null;
  createdAt: string;
}

export const SEO_EMAIL_MESSAGE = 'Geçerli bir e-posta adresi yaz.';

/** Basit bicim denetimi (gonderim yapilmaz); kucuk harfe cevrilir */
export function eposta(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const e = input.trim().toLowerCase();
  if (e.length < 6 || e.length > 191) return null;
  return /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/.test(e) ? e : null;
}

/**
 * Ucretsiz SEO analizi (ranksup.ai/seo-analizi). Kurallar ve gerekce: public-seo-analysis.ts.
 * start(): dogrula → onbellek → sinirlar → kayit + kuyruk. run(): worker'da tarama + kontroller.
 */
@Injectable()
export class PublicSeoAnalysisService {
  private readonly log = new Logger(PublicSeoAnalysisService.name);
  /** Yonetici bildirimi: ayni alan adi gunde bir kez, gunde en fazla 50 (surec bellegi) */
  private readonly bildirim = new AttemptWindow(ONBELLEK_MS);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: JobQueueService,
    private readonly notifications: NotificationsService,
    private readonly crawler: SiteCrawlerService,
    private readonly checks: AuditChecksService,
    private readonly pagespeed: PageSpeedService,
  ) {}

  ipHash(ip: string): string {
    const salt = process.env.IP_HASH_SALT ?? 'luviai-public-citation';
    return createHash('sha256').update(`${salt}:seo:${ip || 'bilinmiyor'}`).digest('hex').slice(0, 32);
  }

  async start(domainInput: unknown, ip: string): Promise<SeoAnalizDurumu> {
    const { url, host } = normalizePublicDomainInput(domainInput); // gecersizse 400 (Turkce)
    const simdi = Date.now();
    const gun = new Date(simdi - ONBELLEK_MS);

    // Onbellek: ayni alan adinin son 24 saatteki basarili ya da suren analizi (sinira sayilmaz)
    const son = await this.prisma.publicSeoAnalysis.findFirst({
      where: { domain: host, createdAt: { gte: gun }, status: { in: ['done', 'queued', 'running'] } },
      orderBy: { createdAt: 'desc' },
    });
    const ipHash = this.ipHash(ip);
    if (son?.status === 'done') {
      // Her ziyaretcinin kendi kaydi olsun (e-postasi kendi satirina yazilir); sinirlara sayilmaz
      const kopya = await this.prisma.publicSeoAnalysis.create({
        data: { domain: host, ipHash, status: 'done', result: son.result as any, onbellek: true, finishedAt: new Date() },
      });
      return this.durum(kopya);
    }
    if (son && simdi - son.createdAt.getTime() < TAKILMA_MS) return this.durum(son);

    const ipAlanlari = await this.prisma.publicSeoAnalysis.findMany({
      where: { ipHash, createdAt: { gte: gun }, onbellek: false },
      select: { domain: true },
      distinct: ['domain'],
    });
    if (ipAlanlari.length >= IP_GUNLUK) throw new HttpException(SEO_IP_LIMIT_MESSAGE, HttpStatus.TOO_MANY_REQUESTS);
    const bugun = await this.prisma.publicSeoAnalysis.count({ where: { createdAt: { gte: gun }, onbellek: false } });
    if (bugun >= GLOBAL_GUNLUK) throw new HttpException(SEO_GLOBAL_LIMIT_MESSAGE, HttpStatus.SERVICE_UNAVAILABLE);

    await assertPublicDomainResolves(url); // ozel/ic adrese cozulen alan adi 400

    const row = await this.prisma.publicSeoAnalysis.create({
      data: { domain: host, ipHash, status: 'queued' },
    });
    try {
      await this.queue.enqueueSystem(PUBLIC_SEO_JOB, { id: row.id }, { jobId: `seo-analiz-${row.id}` });
    } catch (err: any) {
      await this.prisma.publicSeoAnalysis.update({ where: { id: row.id }, data: { status: 'error', error: 'Kuyruğa eklenemedi', finishedAt: new Date() } });
      this.log.warn(`SEO analizi kuyruga eklenemedi (${host}): ${err?.message ?? err}`);
      throw new HttpException(SEO_FAILED_MESSAGE, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return this.durum(row);
  }

  /** Sonucu gormek icin e-posta: analiz kaydina yazilir, durum (sonucla) doner */
  async setEmail(id: string, emailInput: unknown, pazarlamaIzni: unknown): Promise<SeoAnalizDurumu | null> {
    if (typeof id !== 'string' || !/^[a-z0-9]{20,40}$/.test(id)) return null;
    const e = eposta(emailInput);
    if (!e) throw new HttpException(SEO_EMAIL_MESSAGE, HttpStatus.BAD_REQUEST);
    const row = await this.prisma.publicSeoAnalysis.findUnique({ where: { id } });
    if (!row) return null;
    const guncel = await this.prisma.publicSeoAnalysis.update({
      where: { id },
      data: { email: e, pazarlamaIzni: pazarlamaIzni === true },
    });
    void this.yoneticiyeBildir(row.domain, e).catch(() => undefined);
    return this.get(guncel.id);
  }

  async get(id: string): Promise<SeoAnalizDurumu | null> {
    if (typeof id !== 'string' || !/^[a-z0-9]{20,40}$/.test(id)) return null;
    const row = await this.prisma.publicSeoAnalysis.findUnique({ where: { id } });
    if (!row) return null;
    // Takilmis kayit (worker yeniden basladi vb.): ziyaretci sonsuza kadar beklemesin
    if ((row.status === 'queued' || row.status === 'running') && Date.now() - row.createdAt.getTime() > TAKILMA_MS) {
      return { ...this.durum(row), status: 'error', error: SEO_FAILED_MESSAGE };
    }
    return this.durum(row);
  }

  /** Worker: tarama + 15 kontrol + mobil PageSpeed */
  async run(id: string): Promise<{ status: string }> {
    const row = await this.prisma.publicSeoAnalysis.findUnique({ where: { id } });
    if (!row || row.status === 'done') return { status: 'skip' };
    await this.prisma.publicSeoAnalysis.update({ where: { id }, data: { status: 'running' } });
    const url = `https://${row.domain}/`;
    try {
      const [crawl, psi] = await Promise.all([
        this.crawler.crawl(url, TARANACAK_SAYFA, { stopIfHomeUnreadable: true }),
        this.pagespeed.runAudit(url, 'mobile').catch(() => null),
      ]);
      let result: SeoAnalizSonucu;
      if (crawl.pages.length === 0) {
        result = analizOzeti({
          domain: row.domain, url, checks: [], puan: 0, taranan: 0, psi,
          engel: crawl.stoppedEarly || 'Ana sayfa okunamadı.', puanliKontroller: new Set(),
        });
      } else {
        const checks = await this.checks.runAllChecks(crawl);
        result = analizOzeti({
          domain: row.domain, url, checks, puan: this.checks.computeOverallScore(checks), taranan: crawl.pages.length, psi,
          engel: null, puanliKontroller: new Set(Object.keys(OVERALL_SCORE_WEIGHTS)),
        });
      }
      await this.prisma.publicSeoAnalysis.update({
        where: { id },
        data: { status: 'done', result: result as any, finishedAt: new Date() },
      });
      return { status: 'done' };
    } catch (err: any) {
      this.log.warn(`SEO analizi basarisiz (${row.domain}): ${String(err?.message ?? err).slice(0, 200)}`);
      await this.prisma.publicSeoAnalysis.update({
        where: { id },
        data: { status: 'error', error: SEO_FAILED_MESSAGE.slice(0, 300), finishedAt: new Date() },
      });
      return { status: 'error' };
    }
  }

  private durum(row: { id: string; domain: string; status: string; result: unknown; error: string | null; createdAt: Date; email?: string | null }): SeoAnalizDurumu {
    const status = (['queued', 'running', 'done', 'error'].includes(row.status) ? row.status : 'error') as SeoAnalizDurumu['status'];
    return {
      id: row.id,
      domain: row.domain,
      status,
      // Sonuc yalniz e-posta yazildiysa doner (ekranda gizlemek degil: veri hic gonderilmez)
      result: status === 'done' && row.email ? (row.result as SeoAnalizSonucu) : null,
      emailVar: !!row.email,
      error: status === 'error' ? (row.error ?? SEO_FAILED_MESSAGE) : null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** Panel zili (e-posta yok): e-posta birakan ziyaretci. Hata analizi bozmaz. */
  private async yoneticiyeBildir(domain: string, email: string): Promise<void> {
    if (!this.bildirim.take(`d:${domain}:${email}`, 1) || !this.bildirim.take('toplam', 50)) return;
    const admin = await this.prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' }, select: { id: true } });
    if (!admin) return;
    await this.notifications.create({
      userId: admin.id,
      type: 'SYSTEM',
      title: `SEO analizi: ${domain}`,
      body: `ranksup.ai/seo-analizi sayfasında ${email} adresiyle sonucu açtı. Ayrıntı: /admin/leads.`,
      link: '/admin/leads',
      refKind: 'public_seo_analysis',
      channels: ['inapp'],
    });
  }
}
