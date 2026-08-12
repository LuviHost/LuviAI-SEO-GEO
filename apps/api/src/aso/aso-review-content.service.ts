import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { LLMProviderService } from '../llm/llm-provider.service.js';
import { safeParseJson } from '../common/safe-json.js';

/**
 * Review → Icerik Dongusu — ASO'nun kapali dongu karsiligi.
 *
 * Olumsuz yorum temalari uc ciktiya donusur:
 *   1. What's New metni    — "duzelttik" mesaji (store guncelleme notu)
 *   2. FAQ maddeleri       — web'e FAQPage schema'siyla eklenecek soru/cevap
 *   3. Blog konulari       — ContentOpportunity(source='reviews') kaydi;
 *                            oradan tek tikla makale uretilir (mevcut dongu)
 *
 * Boylece "kullanicilar X'ten sikayetci" verisi kendiliginden icerige akar.
 */

export interface ReviewContentPack {
  appId: string;
  appName: string;
  basedOn: { negativeCount: number; themes: Array<{ theme: string; count: number }> };
  whatsNew: string;
  faqs: Array<{ q: string; a: string }>;
  blogTopics: Array<{ title: string; opportunityId: string | null }>;
  generatedAt: string;
}

@Injectable()
export class AsoReviewContentService {
  private readonly log = new Logger(AsoReviewContentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LLMProviderService,
  ) {}

  async buildPack(siteId: string, appId: string): Promise<ReviewContentPack> {
    const app = await this.prisma.trackedApp.findFirst({ where: { id: appId, siteId } });
    if (!app) throw new NotFoundException('Uygulama bulunamadi');

    // Son negatif + notr yorumlar (temalar buradan)
    const reviews = await this.prisma.appReview.findMany({
      where: { trackedAppId: appId, sentiment: { in: ['NEGATIVE', 'NEUTRAL'] } },
      orderBy: { reviewDate: 'desc' },
      take: 60,
      select: { rating: true, title: true, text: true, topics: true },
    });
    if (reviews.length < 3) {
      throw new BadRequestException('Yeterli yorum verisi yok — once yorumlari cek (reviews/fetch) ve analiz et');
    }

    // Tema sayimi (LLM analizi varsa topics alanindan, yoksa ham metinden LLM cikarir)
    const themeCount = new Map<string, number>();
    for (const r of reviews) {
      const topics: any[] = Array.isArray(r.topics) ? (r.topics as any[]) : [];
      for (const t of topics) {
        const key = String(t).toLowerCase();
        themeCount.set(key, (themeCount.get(key) ?? 0) + 1);
      }
    }
    const themes = Array.from(themeCount.entries())
      .map(([theme, count]) => ({ theme, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);

    const reviewSample = reviews
      .slice(0, 30)
      .map((r) => `[${r.rating}★] ${r.title ? r.title + ' — ' : ''}${r.text.slice(0, 250)}`)
      .join('\n');

    const res = await this.llm.chat({
      context: 'aso-review-content-pack',
      siteId,
      model: 'claude-sonnet-5',
      effort: 'low',
      maxTokens: 2500,
      systemPrompt: [
        'Sen bir ASO + icerik stratejistisin. Sana bir mobil uygulamanin OLUMSUZ/notr kullanici yorumlari verilecek.',
        'Uc cikti uret ve YALNIZCA su JSON\'u dondur:',
        '{',
        '  "whatsNew": "App Store/Play Store guncelleme notu (max 500 karakter, Turkce, sikayet edilen konulara \'duzelttik/iyilestirdik\' diliyle deginen, samimi ama profesyonel)",',
        '  "faqs": [{"q": "soru", "a": "cevap (2-3 cumle)"}] — en cok sikayet edilen 4-5 konu icin web sitesine eklenecek SSS,',
        '  "blogTopics": ["baslik1", ...] — sikayet temalarini firsata ceviren 3 blog konusu (ör. pil sikayeti → "X uygulamasinda pil optimizasyonu rehberi")',
        '}',
        'Uydurma ozellik vaat etme; yorumlarda gecmeyen seyleri "duzelttik" deme.',
      ].join('\n'),
      messages: [{
        role: 'user',
        content: `Uygulama: ${app.name} (${app.category ?? 'kategori bilinmiyor'})\n\nTemalar: ${themes.map((t) => `${t.theme}(${t.count})`).join(', ') || 'etiketlenmemis'}\n\nYorumlar:\n${reviewSample}`,
      }],
    });

    const raw = res.output.trim().replace(/^```json?\s*|\s*```$/g, '');
    const parsed = safeParseJson<any>(raw);
    const whatsNew = typeof parsed?.whatsNew === 'string' ? parsed.whatsNew.slice(0, 1000) : '';
    const faqs = Array.isArray(parsed?.faqs)
      ? parsed.faqs.filter((f: any) => f?.q && f?.a).slice(0, 6).map((f: any) => ({ q: String(f.q), a: String(f.a) }))
      : [];
    const topicTitles: string[] = Array.isArray(parsed?.blogTopics)
      ? parsed.blogTopics.filter((t: any) => typeof t === 'string' && t.trim().length >= 10).slice(0, 3)
      : [];

    // Blog konularini ContentOpportunity'ye yaz — kapali donguye baglanir
    const blogTopics: ReviewContentPack['blogTopics'] = [];
    for (const title of topicTitles) {
      const dup = await this.prisma.contentOpportunity.findFirst({
        where: { siteId, source: 'reviews', title, status: { notIn: ['DISMISSED'] } },
      });
      if (dup) {
        blogTopics.push({ title, opportunityId: dup.id });
        continue;
      }
      const opp = await this.prisma.contentOpportunity.create({
        data: {
          siteId,
          source: 'reviews',
          title,
          query: `${app.name} kullanici yorumlari: ${themes.map((t) => t.theme).slice(0, 3).join(', ')}`,
          coverage: 'MISSING',
          score: 60,
          status: 'OPEN',
          meta: { appId: app.id, appName: app.name, themes },
        },
      });
      blogTopics.push({ title, opportunityId: opp.id });
    }

    return {
      appId: app.id,
      appName: app.name,
      basedOn: { negativeCount: reviews.length, themes },
      whatsNew,
      faqs,
      blogTopics,
      generatedAt: new Date().toISOString(),
    };
  }
}
