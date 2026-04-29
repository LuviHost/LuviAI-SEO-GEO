import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { jsonrepair } from 'jsonrepair';
import { PrismaService } from '../prisma/prisma.service.js';

export interface AudienceSuggestion {
  google: {
    keywords: Array<{ text: string; matchType: 'BROAD' | 'PHRASE' | 'EXACT'; estimatedVolume?: number }>;
    negativeKeywords: string[];
    locationsTargeted: string[];   // ["TR", "İstanbul"]
    languagesTargeted: string[];   // ["tr"]
    deviceBidAdjustments: { mobile: number; desktop: number; tablet: number }; // -100..+900
  };
  meta: {
    interests: Array<{ name: string; size?: string }>; // FB interest taxonomy
    behaviors: string[];
    demographics: {
      ageMin: number;
      ageMax: number;
      genders: ('all' | 'male' | 'female')[];
      relationshipStatuses?: string[];
      educationLevels?: string[];
    };
    locations: string[];
    languages: string[];
    lookalikeSource?: string;       // "Top customers (last 30 days)"
    customAudiencesNeeded: string[]; // ["Email list (newsletter)", "Pixel - cart abandon"]
  };
  reasoning: string;
  estimatedReach: { google: string; meta: string };
}

/**
 * AudienceBuilder — site brain (persona + niche) + objective'den hedef kitle onerisi.
 *
 * Hem Google (keywords + lokasyon + cihaz) hem Meta (interest + demografi + lookalike)
 * formatinda dondurur. Kullanici onayindan sonra MCP araciligiyla campaign'a uygulanir.
 */
@Injectable()
export class AudienceBuilderService {
  private readonly log = new Logger(AudienceBuilderService.name);
  private readonly anthropic = process.env.ANTHROPIC_API_KEY
    ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    : null;

  constructor(private readonly prisma: PrismaService) {}

  async build(siteId: string, opts: {
    objective: string;
    productOrService: string;
    budget: number;     // gunluk TL
  }): Promise<AudienceSuggestion> {
    if (!this.anthropic) throw new Error('ANTHROPIC_API_KEY yok');

    const site: any = await this.prisma.site.findUniqueOrThrow({
      where: { id: siteId },
      include: { brain: true },
    });

    const niche = site.niche ?? '';
    const brain: any = site.brain ?? {};
    const personas: any[] = Array.isArray(brain.personas) ? brain.personas : [];
    const competitors: any[] = Array.isArray(brain.competitors) ? brain.competitors : [];

    const personaList = personas.slice(0, 4).map((p: any) =>
      `- ${p.name}: ${p.bio ?? ''} (yas: ${p.age ?? '?'}, gelir: ${p.income ?? '?'})`
    ).join('\n');

    const resp = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2500,
      system: `Sen Turkiye pazari icin paid ads strateji uzmanisin. Google Ads ve Meta Ads icin hedefleme onerisi yaparsin. Yerel ifadeler kullan, Turkiye'ye ozel davran (TR il listesi, Tr lira bazli butce). JSON dondur, baska aciklama yok.`,
      messages: [{
        role: 'user',
        content: `Site: ${site.name}
Niche: ${niche}
Objective: ${opts.objective}
Urun/Hizmet: ${opts.productOrService}
Gunluk butce: ${opts.budget} TL
Personalar:
${personaList || '(brain henuz olusmadi)'}
Rakipler: ${competitors.slice(0, 5).map((c: any) => c.name).join(', ')}

JSON dondur:
{
  "google": {
    "keywords": [{"text":"...","matchType":"BROAD|PHRASE|EXACT","estimatedVolume":NUM}, 20-30 adet],
    "negativeKeywords": ["...","..."] 5-10 adet (urunla alakasiz aramalari hariclestir),
    "locationsTargeted": ["TR" veya specific iller],
    "languagesTargeted": ["tr"],
    "deviceBidAdjustments": {"mobile": -10..50, "desktop": 0..100, "tablet": -50..0}
  },
  "meta": {
    "interests": [{"name":"...","size":"5M-10M"}, 8-15 adet — Meta interest taxonomy],
    "behaviors": ["...","..."] 3-5 adet,
    "demographics": {
      "ageMin": NUM, "ageMax": NUM,
      "genders": ["all" | "male" | "female"],
      "relationshipStatuses": [...],
      "educationLevels": [...]
    },
    "locations": ["Turkey" veya specific iller],
    "languages": ["Turkish"],
    "lookalikeSource": "kim hedeflenecek (orn: 'Son 30 gun satin alanlarin %1 lookalike')",
    "customAudiencesNeeded": ["sitede ne olmali (orn: 'Pixel kurulumu — cart abandon retargeting')"]
  },
  "reasoning": "neden bu hedefleme (2-3 cumle, butceyi nasil dagit)",
  "estimatedReach": {"google":"~X kisi/gun","meta":"~Y kisi/gun"}
}`,
      }],
    });

    const text = resp.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Audience LLM cevabinda JSON bulunamadi');
    const raw = match[0];
    try {
      return JSON.parse(raw) as AudienceSuggestion;
    } catch (e1: any) {
      // LLM bozuk JSON dondurdu — jsonrepair ile onar
      try {
        const repaired = jsonrepair(raw);
        this.log.warn(`Audience JSON repair uygulandi (${e1.message})`);
        return JSON.parse(repaired) as AudienceSuggestion;
      } catch (e2: any) {
        this.log.error(`Audience JSON parse + repair fail: ${e2.message}; raw[0..400]=${raw.slice(0, 400)}`);
        throw new Error('Audience builder LLM cevabi parse edilemedi: ' + e1.message);
      }
    }
  }
}
