import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Demo Seeder — yeni kullanici signup oldugunda ornek bir site + 5 dummy makale
 * + audit + AI citation snapshot uretir. Boylece kullanici ilk girdi̇ginde
 * "ne yapmali" sormak yerine AI'in nelere yaptigini gorur.
 *
 * Demo site silindiginde dummy data kaskat silinir.
 */
@Injectable()
export class DemoSeederService {
  private readonly log = new Logger(DemoSeederService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createDemoSiteForUser(userId: string): Promise<{ siteId: string; articles: number }> {
    // Already has demo?
    const existing = await this.prisma.site.findFirst({
      where: { userId, name: 'Demo Sitesi (örnek)' },
    });
    if (existing) return { siteId: existing.id, articles: 0 };

    // 1. Demo site
    const site: any = await this.prisma.site.create({
      data: {
        userId,
        url: 'https://demo.luviai.com',
        name: 'Demo Sitesi (örnek)',
        niche: 'web hosting',
        language: 'tr',
        status: 'AUDIT_COMPLETE' as any,
        autopilot: true,
        platform: 'wordpress',
        platformConfidence: 0.95,
        platformDetectedAt: new Date(),
      } as any,
    });

    // 2. Brain
    await this.prisma.brain.create({
      data: {
        siteId: site.id,
        brandVoice: {
          tone: 'profesyonel ama samimi',
          summary: 'Türkiye merkezli web hosting çözümleri sunan örnek demo site.',
        } as any,
        seoStrategy: {
          aeoQueries: ['shared hosting nedir?', 'hangi hosting paketi uygun?', 'WordPress için en iyi hosting'],
          geoQueries: ['Türkiye\'de en iyi hosting hangisi?', 'Hosting önerisi 2026'],
          pillars: [
            { name: 'Shared Hosting', url: '/paylasimli-hosting' },
            { name: 'VDS', url: '/vds' },
          ],
        } as any,
        personas: [
          { name: 'Mert (KOBİ)', age: 35, expertise: ['Web hosting', 'KOBİ teknoloji'], bio: 'KOBİ sahibi, kendi sitesini yönetiyor.' },
        ] as any,
        competitors: [
          { name: 'Hostinger Turkey', url: 'https://hostinger.com.tr' },
          { name: 'Natro', url: 'https://natro.com' },
          { name: 'Turhost', url: 'https://turhost.com' },
        ] as any,
        generatedBy: 'demo-seed',
      },
    });

    // 3. Audit (with sample issues)
    await this.prisma.audit.create({
      data: {
        siteId: site.id,
        overallScore: 78,
        geoScore: 65,
        checks: {
          sitemap_xml: { id: 'sitemap_xml', name: 'Sitemap XML', found: true, valid: true, score: 100, issues: [] },
          robots_txt: { id: 'robots_txt', name: 'Robots.txt', found: true, valid: true, score: 90, issues: [] },
          llms_txt: { id: 'llms_txt', name: 'LLMs.txt (AI search)', found: false, valid: false, score: 30, issues: [{ severity: 'warning', type: 'llms_missing', description: 'llms.txt yok — ChatGPT/Perplexity/Claude AI sitenizi alıntılaması zorlaşır', fixable: true }] },
          schema_markup: { id: 'schema_markup', name: 'Schema.org markup', found: true, valid: false, score: 60, issues: [] },
          meta_title: { id: 'meta_title', name: 'Meta Title', found: true, valid: true, score: 85, issues: [] },
          https: { id: 'https', name: 'HTTPS', found: true, valid: true, score: 100, issues: [] },
          aiCitations: {
            id: 'ai_citations',
            name: 'AI arama görünürlüğü (Claude · Gemini · ChatGPT · Perplexity)',
            score: 42,
            providers: [
              { provider: 'anthropic', label: 'Anthropic Claude', available: true, score: 60, probes: [] },
              { provider: 'gemini', label: 'Google Gemini', available: true, score: 40, probes: [] },
              { provider: 'openai', label: 'OpenAI ChatGPT', available: false, score: null, probes: [], reason: 'OPENAI_API_KEY env yok' },
              { provider: 'perplexity', label: 'Perplexity', available: false, score: null, probes: [], reason: 'PERPLEXITY_API_KEY env yok' },
            ],
          },
        } as any,
        issues: [
          { severity: 'warning', type: 'llms_missing', description: 'llms.txt yok — ChatGPT/Perplexity/Claude AI sitenizi alıntılaması zorlaşır', fixable: true, checkId: 'llms_txt' },
          { severity: 'info', type: 'schema_low_coverage', description: 'Schema markup 12/20 sayfada — kapsama düşük', fixable: true, checkId: 'schema_markup' },
        ] as any,
        durationMs: 25000,
      },
    });

    // 4. Topic queue
    await this.prisma.topicQueue.create({
      data: {
        siteId: site.id,
        planTopics: [] as any,
        gscOpportunities: [] as any,
        geoGaps: [] as any,
        competitorMoves: [] as any,
        tier1Topics: [
          { topic: 'WordPress İçin En İyi Hosting Nasıl Seçilir', score: 91, persona: 'Mert', data_summary: 'KOBİ aramada lider sorgu' },
          { topic: 'Shared Hosting vs VDS Karşılaştırma', score: 88, persona: 'Mert', data_summary: 'Karşılaştırma sorgusu' },
          { topic: 'cPanel Nedir, Nasıl Kullanılır', score: 84, persona: 'Mert', data_summary: 'Teknik rehber' },
        ] as any,
        tier2Topics: [] as any,
        tier3Topics: [] as any,
        improvements: [] as any,
        totalEvaluated: 32,
        expiresAt: new Date(Date.now() + 7 * 86400000),
      },
    });

    // 5. 5 dummy makale (1 PUBLISHED, 1 GENERATING, 3 SCHEDULED)
    const articles = [
      { title: 'WordPress İçin En İyi Hosting Nasıl Seçilir? (2026 Rehberi)', status: 'PUBLISHED', daysAgo: 5, score: 56 },
      { title: 'Shared Hosting Nedir? Avantaj ve Dezavantajları', status: 'PUBLISHED', daysAgo: 2, score: 52 },
      { title: 'cPanel\'de SSL Sertifikası Nasıl Kurulur', status: 'GENERATING', daysAgo: 0, score: null },
      { title: 'VDS vs Cloud Hosting: Hangisi Sizin İçin Uygun?', status: 'SCHEDULED', daysAgo: -3 },
      { title: 'E-Ticaret Sitesi İçin Hosting Önerileri 2026', status: 'SCHEDULED', daysAgo: -7 },
    ];

    let articleCount = 0;
    for (const a of articles) {
      const slug = `demo-${a.title.toLowerCase().slice(0, 30).replace(/[^a-z0-9]+/g, '-')}-${articleCount}`;
      const date = a.daysAgo === 0 ? new Date() :
        a.daysAgo > 0 ? new Date(Date.now() - a.daysAgo * 86400000) :
        new Date(Date.now() + Math.abs(a.daysAgo) * 86400000);
      try {
        await this.prisma.article.create({
          data: {
            siteId: site.id,
            topic: a.title,
            slug,
            title: a.title,
            metaDescription: 'Bu örnek makale demo amaçlıdır. Gerçek hesabınızda AI tarafından profesyonel kalitede üretilecektir.',
            language: 'tr',
            status: a.status as any,
            scheduledAt: a.status === 'SCHEDULED' ? date : null,
            publishedAt: a.status === 'PUBLISHED' ? date : null,
            wordCount: a.status === 'PUBLISHED' ? 2100 : null,
            readingTime: a.status === 'PUBLISHED' ? 11 : null,
            editorScore: a.score ?? null,
            editorVerdict: (a.score && a.score >= 48) ? 'PASS' as any : null,
            totalCost: a.status === 'PUBLISHED' ? 0.65 : null,
          },
        });
        articleCount++;
      } catch (err: any) {
        this.log.warn(`Demo article fail: ${err.message}`);
      }
    }

    // 6. AI Citation snapshots (son 14 gün)
    for (let d = 0; d < 14; d++) {
      const date = new Date(Date.now() - d * 86400000);
      date.setHours(0, 0, 0, 0);
      for (const provider of ['anthropic', 'gemini']) {
        const baseScore = provider === 'anthropic' ? 50 : 35;
        const score = Math.max(0, Math.min(100, baseScore + Math.floor((Math.sin(d) * 15)) + Math.floor(Math.random() * 10)));
        try {
          await this.prisma.aiCitationSnapshot.create({
            data: {
              siteId: site.id,
              date,
              provider,
              available: true,
              score,
              probes: [{ query: 'demo soru', cited: score > 50, brandMentioned: true, excerpt: 'Demo veri' }] as any,
              citedCount: score > 50 ? 1 : 0,
              mentionedCount: score > 30 ? 1 : 0,
            },
          });
        } catch {}
      }
    }

    this.log.log(`[user:${userId}] Demo site oluşturuldu: ${site.id} (${articleCount} makale)`);
    return { siteId: site.id, articles: articleCount };
  }
}
