import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../prisma/prisma.service.js';
import { SiteCrawlerService } from './site-crawler.service.js';
import type { CrawlResult } from './site-crawler.service.js';

/**
 * Brain Generator: kullanıcı sitesinin AI bağlamını otomatik üretir.
 *
 * Akış:
 *  1. Site crawl (~30 sayfa)
 *  2. Claude'a "bu site hakkında" özet sor → marka tonu, niş, persona, rakip, SEO strateji
 *  3. Brain DB'ye kaydet
 *
 * Kullanıcı dashboard'da bu Brain'i manuel düzenleyebilir.
 */
@Injectable()
export class BrainGeneratorService {
  private readonly log = new Logger(BrainGeneratorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crawler: SiteCrawlerService,
  ) {}

  /** Site oluşturulduğunda çağrılır — job kuyruğuna ekler */
  async queueGeneration(siteId: string, opts: { forceRegenerate?: boolean } = {}) {
    const site = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId } });
    return this.prisma.job.create({
      data: {
        userId: site.userId,
        siteId,
        type: 'BRAIN_GENERATE',
        payload: { forceRegenerate: opts.forceRegenerate ?? false },
      },
    });
  }

  /** Worker'dan çağrılan asıl iş */
  async runGeneration(siteId: string, opts: { forceRegenerate?: boolean } = {}): Promise<void> {
    const site = await this.prisma.site.findUniqueOrThrow({
      where: { id: siteId },
      include: { brain: true },
    });

    if (!opts.forceRegenerate && site.brain && !this.shouldRegenerate(site.brain.updatedAt)) {
      this.log.log(`${siteId}: Brain mevcut ve fresh, atlanıyor (forceRegenerate=false)`);
      return;
    }

    this.log.log(`${siteId}: Site crawl başlıyor (${site.url})`);
    const crawlResult = await this.crawler.crawl(site.url, 30);

    if (crawlResult.pages.length === 0) {
      this.log.error(`${siteId}: Hiç sayfa crawl edilemedi`);
      throw new Error('Site erişilemedi');
    }

    this.log.log(`${siteId}: ${crawlResult.pages.length} sayfa crawl edildi, AI analizi başlıyor`);
    const brain = await this.analyzeWithAI(site, crawlResult);

    // DB'ye yaz
    await this.prisma.brain.upsert({
      where: { siteId },
      create: {
        siteId,
        ...brain,
      },
      update: {
        ...brain,
        version: { increment: 1 },
      },
    });

    // Site status güncelle
    await this.prisma.site.update({
      where: { id: siteId },
      data: { status: 'AUDIT_PENDING' }, // brain bitti, sıra audit'te
    });

    this.log.log(`${siteId}: Brain oluşturuldu, AUDIT_PENDING durumuna geçildi`);
  }

  private shouldRegenerate(updatedAt: Date): boolean {
    // 30 günden eski ise yeniden üret
    return Date.now() - updatedAt.getTime() > 30 * 24 * 60 * 60 * 1000;
  }

  private async analyzeWithAI(site: any, crawl: CrawlResult): Promise<any> {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    // İlk 10 sayfanın özetini Claude'a ver
    const pageSummaries = crawl.pages.slice(0, 10).map(p =>
      `## ${p.title}\nURL: ${p.url}\nMeta: ${p.metaDescription}\nH1: ${p.h1}\nH2: ${p.h2s.slice(0, 3).join(' | ')}\nText: ${p.textSample.slice(0, 300)}`
    ).join('\n\n---\n\n');

    const prompt = `Aşağıda bir web sitesinin ${crawl.pages.length} sayfasının özeti var. Bu siteyi analiz edip JSON formatında "brain" çıktısı ver.

KRİTİK voice-builder prensipleri (Charlie Hills social-media-skills'ten adapte):
- Marka sesi sadece "tone" değil; aynı zamanda **ne YAPMADIĞI** ile tanımlanır.
- pointOfView: markanın sektörde herkesten farklı düşündüğü şey. Boş geçme.
- offLimits + absencePatterns: markanın asla kullanmadığı yapılar. Site içeriğinde
  hangi ifade/yapı 0 kez geçiyorsa onu listele (örn: em-dash 0/10 sayfada → absence).
- signaturePhrases: site içeriğinde tekrar eden kelimeler/ifadeler. Boş bırakma.

Yukarıdaki prensiplere göre brandVoice'u doldur. Mock değer yazma:

\`\`\`json
{
  "brandVoice": {
    "tone": "samimi-uzman | profesyonel-resmi | eğlenceli | akademik",
    "bannedWords": ["...","..."],
    "examples": ["1-2 örnek paragraf marka sesini gösteren"],
    "pointOfView": "Sektörde herkesin yanlış bildiği şey — bu marka neye karşı, ne savunuyor (1 cümle, kontrarian/distinctive)",
    "brandPromise": "Bu markayı gördüklerinde okurun aklına gelmesi gereken TEK düşünce (1 cümle)",
    "offLimits": ["Asla yazmadığımız konular — örn: politika, rakip kötüleme, kişisel hayat"],
    "signaturePhrases": ["Markanın tekrar tekrar kullandığı 2-4 ifade/kelime"],
    "absencePatterns": ["Asla kullanmadığımız yapılar — örn: 'günümüz dünyasında', 'unutmayalım', em-dash, hashtag, generic başlangıçlar"],
    "hookStyle": "Marka açılışta nasıl hook atar? (kontrarian | data | hikaye | itiraf | gözlem | merak boşluğu)",
    "closingStyle": "Yazıyı nasıl kapatır? (motivasyonel | soru | CTA | gözlem)"
  },
  "personas": [
    {
      "name": "Persona ismi (Türkçe)",
      "age": "yaş aralığı",
      "expertise": "bilgi seviyesi",
      "searchIntent": ["aradığı 3-5 sorgu örneği"],
      "ctaTarget": "?gid=N veya URL"
    }
  ],
  "competitors": [
    {
      "name": "rakip marka adı",
      "url": "https://...",
      "strengths": ["..."],
      "weaknesses": ["..."]
    }
  ],
  "seoStrategy": {
    "primaryKeywords": ["3-5 ana anahtar kelime"],
    "topQuestions": ["Google'da aranabilecek 5-8 doğal soru cümlesi (örn: 'X nasıl yapılır?', 'X nedir?')"],
    "aeoQueries": ["ChatGPT/Claude/Gemini gibi AI asistanlara sorulduğunda bu sitenin tavsiye edilmesi beklenen 4-6 spesifik sorgu (markaya değil, çözüme yönelik)"],
    "geoQueries": ["Perplexity/SearchGPT gibi AI aramada kullanıcının yazacağı 4-6 sorgu — 'en iyi X araçları', 'X için alternatif', 'X vs Y' tarzı kıyaslama/liste sorguları"],
    "pillars": [
      {
        "url": "/sayfa-yolu",
        "name": "pillar adı",
        "clusters": ["cluster makale slug 1", "cluster makale slug 2"]
      }
    ]
  },
  "glossary": [
    { "term": "İngilizce/teknik terim", "translation": "Türkçe karşılığı", "note": "ne zaman kullan" }
  ]
}
\`\`\`

Sadece JSON döndür. Açıklama, kod-fence dışı text yazma.

3-4 persona, 4-6 rakip, 2-4 pillar üret. Site içerik tonunu mevcut kopyaya bakarak belirle.

# Site Adı: ${site.name}
# Site URL: ${site.url}
# Niche (kullanıcı söyledi): ${site.niche ?? 'belirtilmemiş'}
# Dil: ${site.language}

# Sayfa örnekleri:
${pageSummaries}`;

    const response = await client.messages.create({
      model: process.env.ROUTING_MODEL ?? 'claude-sonnet-4-6',
      max_tokens: 8192,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content
      .filter(b => b.type === 'text')
      .map((b: any) => b.text)
      .join('\n');

    // JSON parse — code-fence varsa soy
    let json = text.trim();
    const fenceMatch = json.match(/```(?:json)?\s*\n?([\s\S]*?)(?:\n?```|$)/);
    if (fenceMatch) json = fenceMatch[1].trim();
    const firstBrace = json.indexOf('{');
    if (firstBrace > 0) json = json.slice(firstBrace);

    try {
      return JSON.parse(json);
    } catch (err: any) {
      this.log.error(`JSON parse hatası: ${err.message}`);
      // Boş brain ile devam et — kullanıcı manual doldurabilir
      return {
        brandVoice: { tone: 'samimi-uzman', bannedWords: [], examples: [], pointOfView: '', brandPromise: '', offLimits: [], signaturePhrases: [], absencePatterns: [], hookStyle: '', closingStyle: '' },
        personas: [],
        competitors: [],
        seoStrategy: {
          primaryKeywords: [],
          topQuestions: [],
          aeoQueries: [],
          geoQueries: [],
          pillars: [],
        },
        glossary: [],
      };
    }
  }
}
