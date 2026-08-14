import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PageRendererService } from './page-renderer.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { modelForAudience, type Audience } from '../llm/model-tier.js';
import { readBodyCapped } from '../common/fetch-capped.js';

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

/**
 * Soru kategorileri — musteri yolculugunun farkli asamalari. Teaser'da
 * kilitli sorularin bile kategorisi gosterilir: kullanici neyi kacirdigini
 * gorur, bu da acma motivasyonunu yaratir.
 */
export const QUERY_CATEGORIES = ['DISCOVERY', 'COMPARISON', 'BRAND', 'PROBLEM', 'BUYING_INTENT'] as const;
export type QueryCategory = (typeof QUERY_CATEGORIES)[number];

export interface NicheDetectionResult {
  niche: string;                  // önerilen niş (NICHES içinden veya 'diğer')
  customNiche?: string;           // 'diğer' ise daha spesifik öneri (free text)
  confidence: number;             // 0..1
  reasoning: string;              // niye bu niş seçildi
  alternatives: Array<{ niche: string; confidence: number }>;
  /**
   * Gercek musterinin soracagi dogal sorular (yerel + hizmet-spesifik).
   * Landing'deki teaser 10 tanesini LISTELER ama yalnizca ilk birkacini
   * OLCER — kilitli olanlar icin LLM cagrisi yapilmaz. bkz. public-citation.
   */
  queries?: Array<{ query: string; category: QueryCategory }>;
  contentReadable?: boolean;      // sitenin metinsel içeriği okunabildi mi (SPA + render başarısız → false)
  renderUsed?: boolean;           // içerik headless render ile mi elde edildi
}

interface SiteSignals {
  title: string;
  metaDesc: string;
  ogDesc: string;
  h1: string;
  bodyText: string;
}

@Injectable()
export class NicheDetectorService {
  private readonly log = new Logger(NicheDetectorService.name);
  private readonly anthropic = process.env.ANTHROPIC_API_KEY
    ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    : null;

  constructor(
    private readonly renderer: PageRendererService,
    private readonly settings: SettingsService,
  ) {}

  /** HTML'den niş tespiti için metinsel sinyalleri çıkar. */
  private extractSignals(html: string): SiteSignals {
    const title = (html.match(/<title[^>]*>([^<]+)</i)?.[1] ?? '').trim().slice(0, 200);
    const metaDesc = (html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)/i)?.[1] ?? '').trim().slice(0, 300);
    const ogDesc = (html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)/i)?.[1] ?? '').trim().slice(0, 300);
    const h1 = (html.match(/<h1[^>]*>([^<]+)</i)?.[1] ?? '').trim().slice(0, 200);
    const bodyText = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 2000);
    return { title, metaDesc, ogDesc, h1, bodyText };
  }

  /**
   * İçerik "ince" mi? = niş tespiti için yeterli metinsel sinyal YOK.
   * Tipik SPA kabuğu: sadece <title> var; meta/h1/body boş veya title'ın tekrarı.
   */
  private isThin(s: SiteSignals): boolean {
    if (s.metaDesc || s.ogDesc || s.h1) return false;
    // body'den title'ı düş; geriye anlamlı metin kalıyor mu?
    const bodyNoTitle = s.bodyText.replace(s.title, '').replace(/\s+/g, ' ').trim();
    return bodyNoTitle.length < 120;
  }

  /**
   * @param audience Cagriyi kim tetikledi. Landing'deki anonim checker 'anon'
   *   gecer (ucuz model); onboarding/dashboard varsayilan 'member'.
   */
  async detectFromUrl(url: string, audience: Audience = 'member'): Promise<NicheDetectionResult> {
    const fallback: NicheDetectionResult = {
      niche: 'diğer', confidence: 0,
      reasoning: 'Tespit edilemedi (varsayılan)',
      alternatives: [],
    };

    if (!this.anthropic) {
      return { ...fallback, reasoning: 'ANTHROPIC_API_KEY yok' };
    }

    // 1) Fetch (statik HTML)
    let html = '';
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'RanksUp-NicheDetector/1.0 (+https://ranksup.ai)' },
      });
      clearTimeout(t);
      if (!res.ok) return { ...fallback, reasoning: `HTTP ${res.status}` };
      // 50 KB yetiyor — ama eski hali once govdenin tamamini indiriyordu.
      html = ((await readBodyCapped(res, 512 * 1024))?.text ?? '').slice(0, 50_000);
    } catch (err: any) {
      this.log.warn(`URL fetch fail (${url}): ${err.message}`);
      return { ...fallback, reasoning: `Fetch hatası: ${err.message}` };
    }

    // 2) Sinyalleri çıkar. İçerik ince ise (SPA kabuğu) → headless render dene.
    let signals = this.extractSignals(html);
    let renderUsed = false;
    if (this.isThin(signals)) {
      this.log.log(`İnce içerik (muhtemel SPA): ${url} — headless render deneniyor`);
      const rendered = await this.renderer.renderHtml(url);
      if (rendered) {
        const renderedSignals = this.extractSignals(rendered.slice(0, 200_000));
        if (!this.isThin(renderedSignals)) {
          signals = renderedSignals;
          renderUsed = true;
          this.log.log(`Render başarılı: ${url} (${rendered.length} byte DOM)`);
        }
      }
    }

    // 2b) Render sonrası hâlâ ince → içerik okunamadı. Sektörü İSİMDEN UYDURMA;
    //     dürüst düşük-güven sonuç dön (çağıran taraf jenerik fallback'e düşer).
    if (this.isThin(signals)) {
      return {
        ...fallback,
        confidence: 0,
        contentReadable: false,
        renderUsed,
        reasoning: this.renderer.isAvailable()
          ? 'Site JS ile render ediliyor; render edildi ama metinsel içerik bulunamadı'
          : 'Site JS ile render ediliyor (SPA), sunucu HTML\'i boş — render için Chromium kurulu değil',
      };
    }

    const { title, metaDesc, ogDesc, h1, bodyText } = signals;

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
- SADECE yukarıdaki Title/Description/H1/İçerik özetine dayan. Sektörü site ADINDAN/DOMAIN'den TAHMİN ETME. (örn. "PlanIn" adından "planlama yazılımı" çıkarma — içeriğe bak: etkinlik mi, sosyal mi, e-ticaret mi?)
- İçerik bir mobil uygulama / app tanıtım sitesiyse (App Store / Google Play indirme), uygulamanın GERÇEK işlevini esas al (örn. etkinlik keşif uygulaması, yemek siparişi, fitness takibi).
- Hangi seçenek en iyi açıklar? Eğer hiçbiri uymazsa 'diğer' seç.
- 'diğer' seçtiysen customNiche'e 2-4 kelimelik daha spesifik etiket yaz (örn: "AI SEO platformu", "etkinlik keşif uygulaması", "B2B SaaS analitik")
- 2-3 alternatif öner (alternatives)
- "queries": Bu işletmeyi/siteyi arayan GERÇEK bir potansiyel müşterinin ChatGPT veya Google'a yazacağı 10 doğal Türkçe soru üret:
  • Sitenin GERÇEK hizmet/ürününü yansıtsın — genel sektör adı değil. (örn. tüplü dalış okulu → "dalış kursu", emlak ofisi → "satılık daire")
  • İşletme yerelse konumu (şehir/ilçe) mutlaka içersin. (örn. Bodrum'daki dalış okulu → "Bodrum'da tüplü dalış kursu nereden alınır?")
  • Her biri tek cümle, 4-12 kelime. Birbirinin tekrarı OLMASIN.
  • Her soruya bir "category" ver — 5 kategoriden ikişer soru üret:
      DISCOVERY     → müşteri markayı bilmiyor, seçenek arıyor. Marka adı GEÇMEZ.
                      ("Bodrum'da tüplü dalış kursu nereden alınır?")
      COMPARISON    → seçenekleri kıyaslıyor. Marka adı GEÇMEZ.
                      ("Bodrum'daki dalış merkezleri arasında fark ne?")
      PROBLEM       → bir derdi var, çözüm arıyor. Marka adı GEÇMEZ.
                      ("Hiç deneyimim yok, dalışa nasıl başlarım?")
      BUYING_INTENT → satın almaya hazır, fiyat/şart soruyor. Marka adı GEÇMEZ.
                      ("Dalış kursu ücretleri ne kadar, kaç gün sürer?")
      BRAND         → markayı DUYMUŞ, doğrudan soruyor. Marka adı GEÇER.
                      ("${title || '(marka)'} nedir, ne sunuyor?")
  • DISCOVERY/COMPARISON/PROBLEM/BUYING_INTENT sorularında marka adı KESİNLİKLE geçmesin —
    müşteri markayı henüz bilmiyor; markayı yazarsak ölçüm anlamsız olur.
- Sadece JSON döndür, başka açıklama yok.

Format:
{"niche": "turizm", "customNiche": "tüplü dalış okulu", "confidence": 0.8, "reasoning": "1-2 cümle gerekçe", "alternatives": [{"niche": "spor/fitness", "confidence": 0.4}], "queries": [{"query": "Bodrum'da tüplü dalış kursu nereden alınır?", "category": "DISCOVERY"}, {"query": "Bodrum'daki dalış merkezleri arasındaki fark nedir?", "category": "COMPARISON"}, {"query": "Hiç deneyimim yok, tüplü dalışa nasıl başlarım?", "category": "PROBLEM"}, {"query": "Dalış kursu ücretleri ne kadar ve kaç gün sürer?", "category": "BUYING_INTENT"}]}`;

    try {
      const resp = await this.anthropic.messages.create({
        model: await modelForAudience(this.settings, audience),
        max_tokens: 4000,
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
        // Hem yeni {query,category} hem eski duz string formatini kabul et —
        // model ara sira eski sekle donebiliyor, tum teaser bu yuzden bos kalmasin.
        queries: Array.isArray(parsed.queries)
          ? parsed.queries
              .map((q: any) => {
                const text = typeof q === 'string' ? q : typeof q?.query === 'string' ? q.query : '';
                const trimmed = text.trim().slice(0, 160);
                if (trimmed.length < 8) return null;
                const cat = String(q?.category ?? '').toUpperCase().replace(/[\s-]/g, '_');
                return {
                  query: trimmed,
                  category: (QUERY_CATEGORIES as readonly string[]).includes(cat)
                    ? (cat as QueryCategory)
                    : ('DISCOVERY' as QueryCategory),
                };
              })
              .filter((q: any): q is { query: string; category: QueryCategory } => q !== null)
              .slice(0, 10)
          : [],
        contentReadable: true,
        renderUsed,
      };
    } catch (err: any) {
      this.log.warn(`Niş AI detect fail: ${err.message}`);
      return { ...fallback, reasoning: `AI hatası: ${err.message}` };
    }
  }
}
