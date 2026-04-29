import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { JobQueueService } from '../jobs/job-queue.service.js';

/**
 * Programmatic SEO — sablon × deger ile bulk sayfa uretir.
 *
 * Ornek:
 *   Sablon: "{location} icin shared hosting onerileri"
 *   Degerler: ["Istanbul", "Ankara", "Izmir", ...]
 *   -> 81 makale (81 il)
 *
 * Sablon türleri:
 *   - {location} city pages (81 il)
 *   - {niche} comparison pages
 *   - {keyword} integration pages
 *
 * Otopilot ON ise pipeline'a bulk olarak schedule eder, takvime yayar.
 */
@Injectable()
export class ProgrammaticSeoService {
  private readonly log = new Logger(ProgrammaticSeoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobQueue: JobQueueService,
  ) {}

  /**
   * Turkiye'nin 81 ili icin sehir bazli sayfa uret.
   */
  async generateCityPages(siteId: string, opts: {
    template: string;       // "{location} icin {niche} onerileri"
    cities?: string[];      // ozelse, yoksa 81 il
    spreadDays?: number;    // sayfalari N gune yay
    maxQuota?: number;      // kotaya gore maksimum
  }): Promise<{ scheduled: number; topics: string[] }> {
    const cities = opts.cities ?? this.getTurkishCities();
    const spreadDays = opts.spreadDays ?? 30;
    const max = opts.maxQuota ?? 81;

    const site: any = await this.prisma.site.findUniqueOrThrow({
      where: { id: siteId },
      include: { user: { select: { id: true, plan: true, articlesUsedThisMonth: true } } },
    });

    const PLAN_LIMITS: Record<string, number> = {
      TRIAL: 1, STARTER: 10, PRO: 40, AGENCY: 100, ENTERPRISE: 9999,
    };
    const limit = PLAN_LIMITS[site.user.plan] ?? 1;
    const remaining = Math.max(0, limit - site.user.articlesUsedThisMonth);
    const actualMax = Math.min(max, remaining, cities.length);

    const niche = site.niche ?? 'hosting';
    const topics: string[] = [];
    const slots = this.buildSpreadSlots(actualMax, spreadDays);

    let scheduled = 0;
    for (let i = 0; i < actualMax; i++) {
      const city = cities[i];
      const topic = opts.template
        .replace('{location}', city)
        .replace('{niche}', niche);
      const slug = `prog-${city.toLowerCase().replace(/[ığüşöç ]/g, '-')}-${Date.now().toString(36)}-${i}`;

      try {
        await this.prisma.article.create({
          data: {
            siteId,
            topic,
            slug,
            title: topic,
            language: site.language ?? 'tr',
            status: 'SCHEDULED' as any,
            scheduledAt: slots[i],
            frontmatter: {
              programmatic: true,
              location: city,
              template: opts.template,
            } as any,
          },
        });
        topics.push(topic);
        scheduled++;
      } catch (err: any) {
        this.log.warn(`[${siteId}] Programmatic schedule fail (${city}): ${err.message}`);
      }
    }

    this.log.log(`[${siteId}] Programmatic SEO: ${scheduled}/${cities.length} sehir scheduled (${spreadDays} gune yayildi)`);
    return { scheduled, topics };
  }

  /**
   * Turkiye'nin 81 il listesi.
   */
  private getTurkishCities(): string[] {
    return [
      'İstanbul', 'Ankara', 'İzmir', 'Bursa', 'Antalya', 'Adana', 'Konya', 'Gaziantep',
      'Şanlıurfa', 'Kocaeli', 'Mersin', 'Diyarbakır', 'Hatay', 'Manisa', 'Kayseri',
      'Samsun', 'Balıkesir', 'Kahramanmaraş', 'Van', 'Aydın', 'Tekirdağ', 'Sakarya',
      'Denizli', 'Muğla', 'Eskişehir', 'Mardin', 'Trabzon', 'Ordu', 'Afyonkarahisar',
      'Malatya', 'Erzurum', 'Sivas', 'Tokat', 'Adıyaman', 'Batman', 'Elazığ', 'Çorum',
      'Zonguldak', 'Edirne', 'Osmaniye', 'Düzce', 'Çanakkale', 'Kütahya', 'Aksaray',
      'Isparta', 'Yozgat', 'Bolu', 'Iğdır', 'Kırklareli', 'Kastamonu', 'Niğde',
      'Uşak', 'Kırıkkale', 'Karaman', 'Bitlis', 'Karabük', 'Burdur', 'Yalova', 'Rize',
      'Kars', 'Amasya', 'Siirt', 'Şırnak', 'Çankırı', 'Sinop', 'Hakkari', 'Bingöl',
      'Erzincan', 'Muş', 'Nevşehir', 'Kırşehir', 'Bilecik', 'Artvin', 'Bartın',
      'Giresun', 'Gümüşhane', 'Ardahan', 'Bayburt', 'Tunceli', 'Kilis',
    ];
  }

  /**
   * N sayfayi M gun icine yay (haftalik 5 sayfa gibi).
   */
  private buildSpreadSlots(count: number, days: number): Date[] {
    const slots: Date[] = [];
    const start = new Date();
    const stepMs = (days * 86400000) / Math.max(1, count);
    for (let i = 0; i < count; i++) {
      const d = new Date(start.getTime() + i * stepMs);
      d.setHours(10 + (i % 8), 0, 0, 0); // 10:00 - 17:00 arasi yay
      slots.push(d);
    }
    return slots;
  }
}
