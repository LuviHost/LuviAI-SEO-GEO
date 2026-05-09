import { Injectable, Logger } from '@nestjs/common';
import { AsoScrapersService } from './scrapers.service.js';
import { AsoKeywordService } from './keyword.service.js';
import { LLMProviderService } from '../llm/llm-provider.service.js';

/**
 * AI agent — app-agent (ngo275/app-agent) pattern'inden ilhamlandı.
 * Autonomous keyword research + competitor mining + AI ranking.
 */
@Injectable()
export class AsoAiAgentService {
  private readonly log = new Logger(AsoAiAgentService.name);

  constructor(
    private readonly scrapers: AsoScrapersService,
    private readonly keywords: AsoKeywordService,
    private readonly llm: LLMProviderService,
  ) {}

  /**
   * Otomatik rakip keşfi — 3 kademeli:
   * 1. Direct similar apps (store API)
   * 2. AI ile kategori-tabanlı öneri
   * 3. Top apps in same category
   */
  async discoverCompetitors(opts: {
    appStoreId?: string;
    playStoreId?: string;
    country?: string;
  }): Promise<Array<{ name: string; appId: string; store: 'IOS' | 'ANDROID'; rating?: number; reviewCount?: number }>> {
    const competitors: Array<any> = [];

    if (opts.appStoreId) {
      const similar = await this.scrapers.iosSimilar({
        id: opts.appStoreId,
        country: opts.country,
      });
      for (const a of similar.slice(0, 10)) {
        competitors.push({
          name: a.title,
          appId: String(a.id),
          store: 'IOS',
          rating: a.score,
          reviewCount: (a as any).reviews ?? null,
        });
      }
    }

    if (opts.playStoreId) {
      const similar = await this.scrapers.androidSimilar({
        appId: opts.playStoreId,
        country: opts.country,
      });
      for (const a of similar.slice(0, 10)) {
        competitors.push({
          name: a.title,
          appId: a.appId,
          store: 'ANDROID',
          rating: a.score,
          reviewCount: (a as any).reviews ?? null,
        });
      }
    }

    return competitors;
  }

  /**
   * Otomatik keyword research — rakip metadata'sı + AI ile keyword türetme.
   * app-agent pattern: rakipleri çek → keyword'lerini analiz et → kendi AI'mızla finalize.
   */
  async autonomousKeywordResearch(opts: {
    appName: string;
    appDescription?: string;
    category?: string;
    competitorAppIds: Array<{ appId: string; store: 'IOS' | 'ANDROID' }>;
    country?: string;
    targetLocale?: string; // 'tr' | 'en'
  }): Promise<Array<{ keyword: string; source: string; relevance: number }>> {
    // 1. Rakiplerden keyword çıkar
    const allKeywords = new Set<string>();
    for (const c of opts.competitorAppIds.slice(0, 5)) {
      const kws = await this.keywords.extractKeywordsFromCompetitor({
        competitorAppId: c.appId,
        store: c.store,
        country: opts.country,
      });
      kws.forEach(k => allKeywords.add(k));
    }

    // 2. AI'a sektöre özel keyword öner
    const aiPrompt = `Sen bir ASO (App Store Optimization) uzmanısın. ${opts.targetLocale === 'tr' ? 'Türkçe' : 'İngilizce'} keyword araştırması yap.

App bilgileri:
- İsim: ${opts.appName}
- Açıklama: ${opts.appDescription ?? '(verilmedi)'}
- Kategori: ${opts.category ?? '(verilmedi)'}

Rakiplerden çıkarılan keyword'ler (${allKeywords.size} adet):
${Array.from(allKeywords).slice(0, 50).join(', ')}

Yapacakların:
1. Bu keyword'ler içinden bu app için en alakalı 30 tanesini seç
2. Kendi bilgi tabanından bu app için 20 yeni keyword öner
3. Her keyword için 1-10 arası "relevance" skoru ver

JSON formatında dön:
[
  { "keyword": "...", "source": "competitor" | "ai", "relevance": 1-10 },
  ...
]`;

    let aiKeywords: Array<{ keyword: string; source: string; relevance: number }> = [];
    try {
      const response = await this.llm.chat({
        context: 'aso-keyword-research',
        model: 'claude-haiku-4-5-20251001',
        messages: [{ role: 'user', content: aiPrompt }],
        maxTokens: 3000,
      });
      const text = response.output ?? '';
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        aiKeywords = JSON.parse(jsonMatch[0]);
      }
    } catch (err: any) {
      this.log.warn(`AI keyword research: ${err.message}`);
    }

    return aiKeywords.slice(0, 50);
  }

  /**
   * Description / metadata optimization — AI ile yeniden yaz.
   */
  async optimizeMetadata(opts: {
    currentTitle: string;
    currentSubtitle?: string;
    currentDescription: string;
    targetKeywords: string[];
    locale: 'tr' | 'en';
    store: 'IOS' | 'ANDROID';
  }): Promise<{
    title: string;
    subtitle?: string;
    description: string;
    keywordField?: string; // iOS only
    suggestions: string[];
  }> {
    const charLimits = opts.store === 'IOS'
      ? { title: 30, subtitle: 30, description: 4000, keywordField: 100 }
      : { title: 50, shortDescription: 80, description: 4000 };

    const prompt = `ASO metadata optimization (${opts.locale === 'tr' ? 'Türkçe' : 'English'}).

Store: ${opts.store === 'IOS' ? 'Apple App Store' : 'Google Play'}
Mevcut:
- Title (${charLimits.title} char limit): "${opts.currentTitle}"
${opts.currentSubtitle ? `- Subtitle (${(charLimits as any).subtitle ?? 30} char): "${opts.currentSubtitle}"` : ''}
- Description (ilk 250 char): "${opts.currentDescription.slice(0, 250)}..."

Hedef keyword'ler: ${opts.targetKeywords.join(', ')}

Yapacakların:
1. Yeni TITLE öner (char limit'i aşma, en önemli keyword'ü içersin)
${opts.store === 'IOS' ? '2. Yeni SUBTITLE öner' : '2. SHORT DESCRIPTION (80 char) öner'}
3. Description'ı yeniden yaz (ilk 3 satır CTA + keyword zengin, sonra detaylı)
${opts.store === 'IOS' ? '4. KEYWORDS field için 100 char (virgülle ayrılmış, title/subtitle\'da olmayan keyword\'ler)' : ''}
5. 5 ek optimization önerisi

JSON formatında dön:
{
  "title": "...",
  "subtitle": "...",
  "description": "...",
  ${opts.store === 'IOS' ? '"keywordField": "...",' : ''}
  "suggestions": ["...", "..."]
}`;

    try {
      const response = await this.llm.chat({
        context: 'aso-metadata-optimize',
        model: 'claude-sonnet-4-6',
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 4000,
      });
      const text = response.output ?? '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (err: any) {
      this.log.warn(`Metadata optimize: ${err.message}`);
    }

    return {
      title: opts.currentTitle,
      description: opts.currentDescription,
      suggestions: ['AI yanıtı parse edilemedi, lütfen tekrar dene.'],
    };
  }
}
