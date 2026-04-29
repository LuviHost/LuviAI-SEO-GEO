import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../prisma/prisma.service.js';

export interface AdCopyVariants {
  // Google Responsive Search Ad format
  google: {
    headlines: Array<{ text: string; length: number }>; // 15 adet, max 30 char
    descriptions: Array<{ text: string }>;              // 4 adet, max 90 char
  };
  // Meta (Facebook + Instagram)
  meta: {
    primaryTexts: string[];      // 5 adet, 125 char ideal
    headlines: string[];         // 5 adet, 40 char
    descriptions: string[];      // 5 adet, 30 char
    callToAction: string;        // SHOP_NOW | LEARN_MORE | SIGN_UP | CONTACT_US
  };
  reasoning: string;
}

/**
 * AdGeneratorService — site brain + objective + audience'a gore reklam metni uretir.
 *
 * Format: Google RSA + Meta hashtag-free ad copy.
 * AI: Anthropic Sonnet 4.6 (yazar ajanin reklam versiyonu).
 */
@Injectable()
export class AdGeneratorService {
  private readonly log = new Logger(AdGeneratorService.name);
  private readonly anthropic = process.env.ANTHROPIC_API_KEY
    ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    : null;

  constructor(private readonly prisma: PrismaService) {}

  async generate(siteId: string, opts: {
    objective: 'traffic' | 'leads' | 'conversions' | 'brand_awareness' | 'sales';
    productOrService: string;
    keyBenefit?: string;       // ana fayda
    landingUrl: string;
    persona?: string;
  }): Promise<AdCopyVariants> {
    if (!this.anthropic) throw new Error('ANTHROPIC_API_KEY yok');

    const site: any = await this.prisma.site.findUniqueOrThrow({
      where: { id: siteId },
      include: { brain: true },
    });

    const brand = site.name;
    const niche = site.niche ?? '';
    const brandVoice: any = site.brain?.brandVoice ?? {};

    const objectiveLabel = ({
      traffic: 'web sitesi trafigi (cok ziyaret)',
      leads: 'lead toplama (form doldurma, email)',
      conversions: 'donusum (satin alma, kayit)',
      brand_awareness: 'marka bilinirligi',
      sales: 'satis',
    } as any)[opts.objective] ?? opts.objective;

    const resp = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2500,
      system: `Sen ${brand} markasinin paid ads copywriter'isin. Google Ads + Meta Ads icin yuksek CTR'li reklam metinleri yazarsin.

KURALLAR:
- Karakter limitlerini SIKI takip et
- Action verb baslat (Bul, Kesfet, Al, Dene, Ogren)
- Sosyal kanit/sayisal data kullan ("10K+ kullanici", "%30 indirim")
- 'Free shipping' tarzi US-centric ifadeler kullanma — Turkce yerel ifade
- ALL CAPS yasak (Google ban eder)
- "!" max 1 tane / metin
- Brand tonu: ${brandVoice.tone ?? 'profesyonel ama samimi'}

JSON dondur, baska aciklama yok.`,
      messages: [{
        role: 'user',
        content: `Hedef: ${objectiveLabel}
Urun/Hizmet: ${opts.productOrService}
Ana fayda: ${opts.keyBenefit ?? 'belirtilmemis'}
Landing URL: ${opts.landingUrl}
Persona: ${opts.persona ?? 'genel'}
Niche: ${niche}

JSON dondur:
{
  "google": {
    "headlines": [{"text":"...","length":N}, ... 15 adet, her biri MAX 30 char],
    "descriptions": [{"text":"..."}, ... 4 adet, her biri MAX 90 char]
  },
  "meta": {
    "primaryTexts": ["...", ... 5 adet, ideal 125 char],
    "headlines": ["...", ... 5 adet, max 40 char],
    "descriptions": ["...", ... 5 adet, max 30 char],
    "callToAction": "SHOP_NOW | LEARN_MORE | SIGN_UP | CONTACT_US arasindan EN UYGUNU"
  },
  "reasoning": "neden bu yaklasim secildi (1-2 cumle)"
}`,
      }],
    });

    const text = resp.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('AI JSON parse fail');
    const parsed = JSON.parse(match[0]);

    // length doldur
    if (parsed.google?.headlines) {
      for (const h of parsed.google.headlines) {
        h.length = String(h.text).length;
      }
    }

    return parsed as AdCopyVariants;
  }
}
