import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export interface GeoScoreCard {
  overallScore: number;
  grade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
  pillars: GeoPillar[];
  recommendations: string[];
  generatedAt: string;
}

export interface GeoPillar {
  id: string;
  name: string;
  weight: number;       // 1-3
  score: number;        // 0-100
  status: 'great' | 'good' | 'warning' | 'critical';
  checks: Array<{ id: string; name: string; ok: boolean; detail: string }>;
}

/**
 * GEO Score Card — sitenin "AI search engine'lerde gorunurluk seviyesi"ni
 * 6 pillar uzerinden olcer. Her birinin agirlikli ortalamasi overall skor.
 *
 *  1. Crawler Erisimi (robots.txt + llms.txt + llms-full.txt)
 *  2. Yapısal Veri (schema markup tipleri ve kapsami)
 *  3. AI Citation (Claude/Gemini/OpenAI/Perplexity gunluk skorlari)
 *  4. Otorite (sameAs, Wikidata varsa, Wikipedia varsa, social profiller)
 *  5. Tazelik (yayin sikligi, son guncellenme, content pivot durumu)
 *  6. Multi-Modal (TTS audio, video, podcast RSS)
 */
@Injectable()
export class GeoScoreCardService {
  private readonly log = new Logger(GeoScoreCardService.name);

  constructor(private readonly prisma: PrismaService) {}

  async build(siteId: string): Promise<GeoScoreCard> {
    const [crawler, structured, citation, authority, freshness, multiModal] = await Promise.all([
      this.checkCrawlerAccess(siteId),
      this.checkStructuredData(siteId),
      this.checkAiCitation(siteId),
      this.checkAuthority(siteId),
      this.checkFreshness(siteId),
      this.checkMultiModal(siteId),
    ]);

    const pillars = [crawler, structured, citation, authority, freshness, multiModal];
    const totalWeight = pillars.reduce((a, p) => a + p.weight, 0);
    const overall = Math.round(
      pillars.reduce((a, p) => a + p.score * p.weight, 0) / totalWeight,
    );

    const grade = overall >= 90 ? 'A+' : overall >= 80 ? 'A' : overall >= 70 ? 'B' : overall >= 60 ? 'C' : overall >= 50 ? 'D' : 'F';

    // Recommendations — en zayif pillar'lardan
    const recommendations: string[] = [];
    for (const p of pillars.sort((a, b) => a.score - b.score).slice(0, 3)) {
      const failed = p.checks.filter((c) => !c.ok);
      for (const c of failed.slice(0, 2)) {
        recommendations.push(`[${p.name}] ${c.name}: ${c.detail}`);
      }
    }

    return {
      overallScore: overall,
      grade,
      pillars,
      recommendations,
      generatedAt: new Date().toISOString(),
    };
  }

  // ────────────────────────────────────────────────────────────
  //  Pillar 1: Crawler Erisimi
  // ────────────────────────────────────────────────────────────
  private async checkCrawlerAccess(siteId: string): Promise<GeoPillar> {
    const audit = await this.prisma.audit.findFirst({
      where: { siteId },
      orderBy: { ranAt: 'desc' },
    });
    const checks: GeoPillar['checks'] = [];
    const ck: any = audit?.checks ?? {};

    checks.push({
      id: 'robots', name: 'robots.txt',
      ok: ck.robots_txt?.found === true && ck.robots_txt?.score >= 70,
      detail: ck.robots_txt?.found ? `Skor: ${ck.robots_txt?.score}/100` : 'robots.txt yok — auto-fix uygula',
    });
    checks.push({
      id: 'llms', name: 'llms.txt',
      ok: ck.llms_txt?.found === true,
      detail: ck.llms_txt?.found ? 'Mevcut' : 'llms.txt yok — AI search engines siteyi öğrenemiyor',
    });

    const site: any = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId } });
    checks.push({
      id: 'llms-full', name: 'llms-full.txt',
      ok: !!site.llmsFullTxt,
      detail: site.llmsFullTxt ? 'Cached, weekly auto-rebuild' : 'Henüz oluşturulmadı',
    });
    checks.push({
      id: 'sitemap', name: 'sitemap.xml',
      ok: ck.sitemap_xml?.found === true,
      detail: ck.sitemap_xml?.found ? 'Mevcut' : 'sitemap.xml yok',
    });

    const score = Math.round((checks.filter(c => c.ok).length / checks.length) * 100);
    return {
      id: 'crawler-access', name: 'Crawler Erişimi', weight: 3,
      score, status: this.scoreStatus(score), checks,
    };
  }

  // ────────────────────────────────────────────────────────────
  //  Pillar 2: Yapısal Veri (Schema)
  // ────────────────────────────────────────────────────────────
  private async checkStructuredData(siteId: string): Promise<GeoPillar> {
    const articles = await this.prisma.article.findMany({
      where: { siteId, status: 'PUBLISHED' as any },
      select: { id: true, schemaMarkup: true } as any,
      take: 50,
    });
    const checks: GeoPillar['checks'] = [];

    const withSchema = articles.filter((a: any) => a.schemaMarkup);
    const totalArticles = articles.length;

    checks.push({
      id: 'schema-coverage', name: 'Schema kapsama',
      ok: totalArticles > 0 && withSchema.length / totalArticles >= 0.8,
      detail: `${withSchema.length}/${totalArticles} makale schema'lı`,
    });

    // Schema types diversity
    const allTypes = new Set<string>();
    for (const a of withSchema as any[]) {
      for (const t of (a.schemaMarkup?.types ?? [])) allTypes.add(t);
    }
    checks.push({
      id: 'schema-diversity', name: 'Schema tip çeşitliliği',
      ok: allTypes.size >= 5,
      detail: `${allTypes.size} farklı schema tipi (${[...allTypes].slice(0, 6).join(', ')})`,
    });

    checks.push({
      id: 'speakable', name: 'Speakable (sesli asistanlar)',
      ok: [...allTypes].includes('Speakable'),
      detail: [...allTypes].includes('Speakable') ? 'Aktif' : 'Yok — Siri/Alexa optimize değil',
    });

    checks.push({
      id: 'faq-page', name: 'FAQPage',
      ok: [...allTypes].includes('FAQPage'),
      detail: [...allTypes].includes('FAQPage') ? 'Aktif' : 'FAQ schema eksik',
    });

    const score = Math.round((checks.filter(c => c.ok).length / checks.length) * 100);
    return {
      id: 'structured-data', name: 'Yapısal Veri', weight: 3,
      score, status: this.scoreStatus(score), checks,
    };
  }

  // ────────────────────────────────────────────────────────────
  //  Pillar 3: AI Citation
  // ────────────────────────────────────────────────────────────
  private async checkAiCitation(siteId: string): Promise<GeoPillar> {
    const last7 = new Date(Date.now() - 7 * 86400000);
    const recent = await this.prisma.aiCitationSnapshot.findMany({
      where: { siteId, date: { gte: last7 } },
    });

    const checks: GeoPillar['checks'] = [];
    const providers = ['anthropic', 'gemini', 'openai', 'perplexity'];

    for (const p of providers) {
      const pSnapshots = recent.filter((r) => r.provider === p && r.available);
      if (pSnapshots.length === 0) {
        checks.push({
          id: `cite-${p}`, name: this.providerLabel(p),
          ok: false,
          detail: 'Snapshot yok — AI saglayicisi aktif degil',
        });
        continue;
      }
      const avg = pSnapshots.reduce((a, s) => a + (s.score ?? 0), 0) / pSnapshots.length;
      checks.push({
        id: `cite-${p}`, name: this.providerLabel(p),
        ok: avg >= 30,
        detail: `Son 7 gün ortalama: ${avg.toFixed(0)}/100`,
      });
    }

    const score = checks.length > 0 ? Math.round((checks.filter(c => c.ok).length / checks.length) * 100) : 0;
    return {
      id: 'ai-citation', name: 'AI Citation (4 saglayici)', weight: 3,
      score, status: this.scoreStatus(score), checks,
    };
  }

  // ────────────────────────────────────────────────────────────
  //  Pillar 4: Otorite (sameAs, Wikidata, social)
  // ────────────────────────────────────────────────────────────
  private async checkAuthority(siteId: string): Promise<GeoPillar> {
    const site: any = await this.prisma.site.findUniqueOrThrow({
      where: { id: siteId },
      include: { brain: true, socialChannels: true } as any,
    });
    const checks: GeoPillar['checks'] = [];

    const socialProfiles = Array.isArray(site.socialProfiles) ? site.socialProfiles : [];
    checks.push({
      id: 'social-sameAs', name: 'sosyal sameAs',
      ok: socialProfiles.length >= 2,
      detail: `${socialProfiles.length} sosyal profil bağlı`,
    });

    const competitors: any[] = Array.isArray(site.brain?.competitors) ? site.brain.competitors : [];
    checks.push({
      id: 'competitive-landscape', name: 'Rekabet manzarası',
      ok: competitors.length >= 3,
      detail: `${competitors.length} rakip tanımlı`,
    });

    const channels = (site as any).socialChannels ?? [];
    checks.push({
      id: 'social-active', name: 'Sosyal kanal aktif',
      ok: channels.filter((c: any) => c.isActive).length >= 1,
      detail: `${channels.filter((c: any) => c.isActive).length} aktif kanal`,
    });

    checks.push({
      id: 'gsc', name: 'GSC bağlı',
      ok: !!site.gscConnectedAt,
      detail: site.gscConnectedAt ? 'Bağlı' : 'Otorite sinyali için bağlamanız önerilir',
    });

    const score = Math.round((checks.filter(c => c.ok).length / checks.length) * 100);
    return {
      id: 'authority', name: 'Otorite Sinyalleri', weight: 2,
      score, status: this.scoreStatus(score), checks,
    };
  }

  // ────────────────────────────────────────────────────────────
  //  Pillar 5: Tazelik
  // ────────────────────────────────────────────────────────────
  private async checkFreshness(siteId: string): Promise<GeoPillar> {
    const last30 = new Date(Date.now() - 30 * 86400000);
    const last7 = new Date(Date.now() - 7 * 86400000);

    const [recentArticles, lastWeek] = await Promise.all([
      this.prisma.article.count({
        where: { siteId, status: 'PUBLISHED' as any, publishedAt: { gte: last30 } },
      }),
      this.prisma.article.count({
        where: { siteId, status: 'PUBLISHED' as any, publishedAt: { gte: last7 } },
      }),
    ]);

    const checks: GeoPillar['checks'] = [];
    checks.push({
      id: 'recent-30', name: '30 gün yayın',
      ok: recentArticles >= 4,
      detail: `${recentArticles} makale (önerilen: 4+)`,
    });
    checks.push({
      id: 'recent-7', name: '7 gün yayın',
      ok: lastWeek >= 1,
      detail: `${lastWeek} makale`,
    });

    const last90 = new Date(Date.now() - 90 * 86400000);
    const stale = await this.prisma.article.count({
      where: { siteId, status: 'PUBLISHED' as any, publishedAt: { lte: last90 }, updatedAt: { lte: last90 } },
    });
    checks.push({
      id: 'stale-content', name: 'Eskimiş içerik',
      ok: stale < 10,
      detail: stale === 0 ? 'Eskimiş içerik yok' : `${stale} makale 90+ gündür güncellenmedi (content pivot çalıştır)`,
    });

    const score = Math.round((checks.filter(c => c.ok).length / checks.length) * 100);
    return {
      id: 'freshness', name: 'Tazelik', weight: 2,
      score, status: this.scoreStatus(score), checks,
    };
  }

  // ────────────────────────────────────────────────────────────
  //  Pillar 6: Multi-Modal
  // ────────────────────────────────────────────────────────────
  private async checkMultiModal(siteId: string): Promise<GeoPillar> {
    const checks: GeoPillar['checks'] = [];

    // Bu site'in articles'larinda audio var mi?
    // Frontmatter'da audio_url alani veya inlineImages'a eklenmis audio
    const articles: any[] = await this.prisma.article.findMany({
      where: { siteId, status: 'PUBLISHED' as any },
      select: { frontmatter: true, inlineImages: true } as any,
      take: 50,
    });
    const withAudio = articles.filter((a) =>
      (a.frontmatter as any)?.audio_url ||
      (Array.isArray(a.inlineImages) && (a.inlineImages as any[]).some((i) => i.type === 'audio'))
    ).length;

    checks.push({
      id: 'tts-audio', name: 'TTS audio coverage',
      ok: articles.length === 0 ? false : withAudio / articles.length >= 0.3,
      detail: articles.length === 0 ? 'Henuz makale yok' : `${withAudio}/${articles.length} makalede audio`,
    });

    checks.push({
      id: 'podcast-rss', name: 'Podcast RSS feed',
      ok: withAudio >= 3,
      detail: withAudio >= 3 ? 'Spotify/Apple Podcasts hazir' : `${withAudio} audio (3+ olunca podcast feed aktif)`,
    });

    // Image coverage
    const withHero = articles.filter((a) => a.frontmatter?.hero_image).length;
    checks.push({
      id: 'hero-image', name: 'Hero görsel',
      ok: articles.length === 0 ? false : withHero / articles.length >= 0.7,
      detail: `${withHero}/${articles.length} makalede hero görsel`,
    });

    const score = Math.round((checks.filter(c => c.ok).length / checks.length) * 100);
    return {
      id: 'multi-modal', name: 'Multi-Modal', weight: 1,
      score, status: this.scoreStatus(score), checks,
    };
  }

  // ────────────────────────────────────────────────────────────
  private scoreStatus(score: number): 'great' | 'good' | 'warning' | 'critical' {
    if (score >= 80) return 'great';
    if (score >= 60) return 'good';
    if (score >= 40) return 'warning';
    return 'critical';
  }

  private providerLabel(p: string): string {
    return ({ anthropic: 'Claude', gemini: 'Gemini', openai: 'ChatGPT', perplexity: 'Perplexity' } as any)[p] ?? p;
  }
}
