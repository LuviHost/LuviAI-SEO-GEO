import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { JobQueueService } from '../jobs/job-queue.service.js';
import { QuotaService } from '../billing/quota.service.js';

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
    private readonly quota: QuotaService,
  ) {}

  /**
   * Turkiye'nin 81 ili icin sehir bazli sayfa uret.
   */
  async generateCityPages(siteId: string, opts: {
    template: string;       // "{location} icin {niche} onerileri"
    cities?: string[];      // ozelse, yoksa 81 il
    spreadDays?: number;    // sayfalari N gune yay
    maxQuota?: number;      // kotaya gore maksimum
  }): Promise<{
    scheduled: number;
    topics: string[];
    /** Istenen sehir sayisi (maxQuota ve liste uzunluguyla kirpilmis) */
    requested: number;
    /** Kalan makale hakki yetmedigi icin eklenmeyen sehir sayisi */
    skippedForQuota: number;
    /** Islem oncesi kalan makale hakki */
    remainingQuota: number;
  }> {
    const cities = opts.cities ?? this.getTurkishCities();
    const spreadDays = opts.spreadDays ?? 30;
    const max = opts.maxQuota ?? 81;

    const site: any = await this.prisma.site.findUniqueOrThrow({
      where: { id: siteId },
      select: { id: true, userId: true, niche: true, language: true },
    });

    // Kalan hak QuotaService'ten: once ay basi sifirlamasini uygular, sonra
    // satiri yeniden okur. Eskiden sayac dogrudan okunuyordu; yeni ayin ilk
    // cagrisinda gecen ayin dolu sayaci gorulup 0 sehir donuyordu. Tavan
    // QuotaService.LIMITS — plans.ts ile esitligi plans-quota-sync.spec'te.
    const { remaining } = await this.quota.checkArticleQuota(site.userId);
    const requested = Math.min(max, cities.length);
    const actualMax = Math.min(requested, remaining);
    const skippedForQuota = requested - actualMax;
    if (skippedForQuota > 0) {
      this.log.log(`[${siteId}] Programmatic SEO: ${skippedForQuota} sehir makale hakki yetmedigi icin eklenmedi (kalan hak ${remaining})`);
    }

    // 'hosting' LuviHost kalıntısı bir varsayılandı: nişi boş olan bir finans
    // sitesinde "İstanbul için hosting önerileri" gibi konusu tamamen yanlış
    // sayfalar üretiyordu. Niş yoksa {niche} yer tutucusu boş bırakılır.
    const niche = String(site.niche ?? '').trim();
    if (!niche && opts.template.includes('{niche}')) {
      this.log.warn(`[${siteId}] Şablon {niche} içeriyor ama sitenin nişi tanımsız — yer tutucu boş bırakıldı`);
    }
    const topics: string[] = [];
    const slots = this.buildSpreadSlots(actualMax, spreadDays);

    let scheduled = 0;
    for (let i = 0; i < actualMax; i++) {
      const city = cities[i];
      const topic = opts.template
        .replace('{location}', city)
        .replace('{niche}', niche)
        .replace(/\s{2,}/g, ' ')
        .trim();
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
    return { scheduled, topics, requested, skippedForQuota, remainingQuota: remaining };
  }

  /**
   * Turkiye'nin 81 il listesi.
   *
   * Liste kabaca nufusa gore siralidir. Bir donem 'Ağrı' eksikti (80 il) —
   * fiyat karti "81 il sablonu" dedigi halde sablon 80 sayfa uretiyordu.
   */
  private getTurkishCities(): string[] {
    return [
      'İstanbul', 'Ankara', 'İzmir', 'Bursa', 'Antalya', 'Adana', 'Konya', 'Gaziantep',
      'Şanlıurfa', 'Kocaeli', 'Mersin', 'Diyarbakır', 'Hatay', 'Manisa', 'Kayseri',
      'Samsun', 'Balıkesir', 'Kahramanmaraş', 'Van', 'Aydın', 'Tekirdağ', 'Sakarya',
      'Denizli', 'Muğla', 'Eskişehir', 'Mardin', 'Trabzon', 'Ordu', 'Afyonkarahisar',
      'Malatya', 'Erzurum', 'Sivas', 'Tokat', 'Adıyaman', 'Batman', 'Elazığ', 'Çorum',
      'Zonguldak', 'Edirne', 'Osmaniye', 'Düzce', 'Çanakkale', 'Kütahya', 'Ağrı',
      'Aksaray', 'Isparta', 'Yozgat', 'Bolu', 'Iğdır', 'Kırklareli', 'Kastamonu', 'Niğde',
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
