import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';

/**
 * URL'den site nişini AI ile tespit et.
 *
 * Akış:
 *   1. URL'yi fetch et (anasayfa HTML, ~50KB)
 *   2. Title + meta description + ilk H1 + ilk 800 karakter body çıkar
 *   3. Claude Haiku'ya "Bu siteyi şu nişlerden hangisi en iyi anlatır?" sor
 *   4. Confidence + alternative suggestions ile dön
 *
 * Bu servis brain generator'dan **bağımsız**. Onboarding'de URL girildiği an
 * (henüz brain üretilmeden önce) niş önerisi sunmak için tasarlandı.
 */

const NICHES = [
  'web hosting', 'e-ticaret', 'SaaS', 'eğitim', 'sağlık', 'finans',
  'gayrimenkul', 'turizm', 'restoran', 'ajans', 'haber/medya', 'otomotiv',
  'inşaat', 'spor/fitness', 'moda/giyim', 'teknoloji/yazılım', 'hukuk',
  'danışmanlık', 'üretim/sanayi', 'diğer',
];

export interface NicheDetectionResult {
  niche: string;                  // önerilen niş (NICHES içinden veya 'diğer')
  customNiche?: string;           // 'diğer' ise daha spesifik öneri (free text)
  confidence: number;             // 0..1
  reasoning: string;              // niye bu niş seçildi
  alternatives: Array<{ niche: string; confidence: number }>;
}

@Injectable()
export class NicheDetectorService {
  private readonly log = new Logger(NicheDetectorService.name);
  private readonly anthropic = process.env.ANTHROPIC_API_KEY
    ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    : null;

  async detectFromUrl(url: string): Promise<NicheDetectionResult> {
    const fallback: NicheDetectionResult = {
      niche: 'diğer', confidence: 0,
      reasoning: 'Tespit edilemedi (varsayılan)',
      alternatives: [],
    };

    if (!this.anthropic) {
      return { ...fallback, reasoning: 'ANTHROPIC_API_KEY yok' };
    }

    // 1) Fetch
    let html = '';
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'LuviAI-NicheDetector/1.0 (+https://ai.luvihost.com)' },
      });
      clearTimeout(t);
      if (!res.ok) return { ...fallback, reasoning: `HTTP ${res.status}` };
      html = (await res.text()).slice(0, 50_000);
    } catch (err: any) {
      this.log.warn(`URL fetch fail (${url}): ${err.message}`);
      return { ...fallback, reasoning: `Fetch hatası: ${err.message}` };
    }

    // 2) Extract signals
    const title = (html.match(/<title[^>]*>([^<]+)</i)?.[1] ?? '').trim().slice(0, 200);
    const metaDesc = (html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)/i)?.[1] ?? '').trim().slice(0, 300);
    const ogDesc = (html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)/i)?.[1] ?? '').trim().slice(0, 300);
    const h1 = (html.match(/<h1[^>]*>([^<]+)</i)?.[1] ?? '').trim().slice(0, 200);
    // body text rough strip
    const bodyText = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 800);

    // 3) Ask Claude Haiku
    const prompt = `Bu web sitesinin sektörünü tespit et:

URL: ${url}
Title: ${title}
Meta description: ${metaDesc || ogDesc || '(yok)'}
H1: ${h1 || '(yok)'}
İçerik özeti: ${bodyText}

Mevcut niş seçenekleri:
${NICHES.join(', ')}

Kurallar:
- Hangi seçenek en iyi açıklar? Eğer hiçbiri uymazsa 'diğer' seç.
- 'diğer' seçtiysen customNiche'e 2-4 kelimelik daha spesifik etiket yaz (örn: "AI SEO platformu", "KOBİ dijitalleşme", "B2B SaaS analitik")
- 2-3 alternatif öner (alternatives)
- Sadece JSON döndür, başka açıklama yok.

Format:
{"niche": "SaaS", "customNiche": null, "confidence": 0.85, "reasoning": "1-2 cümle gerekçe", "alternatives": [{"niche": "teknoloji/yazılım", "confidence": 0.65}, {"niche": "ajans", "confidence": 0.25}]}`;

    try {
      const resp = await this.anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        system: 'Sen Türkçe SEO uzmanısın. JSON döndür, açıklama yapma, kod-fence kullanma.',
        messages: [{ role: 'user', content: prompt }],
      });
      const text = resp.content
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('')
        .trim();
      const jsonStart = text.indexOf('{');
      const jsonEnd = text.lastIndexOf('}');
      if (jsonStart < 0 || jsonEnd < 0) {
        return { ...fallback, reasoning: 'AI cevabı JSON değil' };
      }
      const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
      const niche = typeof parsed.niche === 'string' ? parsed.niche : 'diğer';
      const isKnown = NICHES.includes(niche);
      return {
        niche: isKnown ? niche : 'diğer',
        customNiche: parsed.customNiche ?? (isKnown ? undefined : niche),
        confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
        reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : 'AI tespit etti',
        alternatives: Array.isArray(parsed.alternatives)
          ? parsed.alternatives
              .filter((a: any) => a && typeof a.niche === 'string')
              .slice(0, 3)
              .map((a: any) => ({
                niche: a.niche,
                confidence: typeof a.confidence === 'number' ? a.confidence : 0,
              }))
          : [],
      };
    } catch (err: any) {
      this.log.warn(`Niş AI detect fail: ${err.message}`);
      return { ...fallback, reasoning: `AI hatası: ${err.message}` };
    }
  }
}
