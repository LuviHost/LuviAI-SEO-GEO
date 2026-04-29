import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../prisma/prisma.service.js';

export interface HaroQuery {
  publication: string;
  reporter: string;
  email: string;
  deadline: string;
  query: string;
  requirements: string;
  category: string;
  brandFitScore: number;
  draftPitch: string;
}

/**
 * HARO Parser — kullanici LuviAI'ye HARO emaillerini forward eder veya
 * paneli'ye gunluk HARO digest'ini yapistir. AI parse eder, sektore uygun
 * sorulara taslak yanit hazirlar.
 *
 * Backlink + AI authority signal kazandirir (gazeteci yazisinda alinti = otorite).
 */
@Injectable()
export class HaroParserService {
  private readonly log = new Logger(HaroParserService.name);
  private readonly anthropic = process.env.ANTHROPIC_API_KEY
    ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    : null;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * HARO email icerigini parse et + her sorgu icin draft pitch uret.
   */
  async parseDigest(siteId: string, emailContent: string): Promise<HaroQuery[]> {
    const site: any = await this.prisma.site.findUniqueOrThrow({
      where: { id: siteId },
      include: { brain: true },
    });
    const brand = site.name;
    const niche = site.niche ?? '';
    const brandVoice: any = site.brain?.brandVoice ?? {};

    // HARO format genelde:
    // 1) Summary: <text>
    // 2) Name: <reporter>
    //    Category: <cat>
    //    Email: <email>
    //    Media Outlet: <pub>
    //    Deadline: <date>
    //    Query: <multi-line>
    //    Requirements: <multi-line>
    //
    // Regex ile blok blok parse et
    const blocks = emailContent.split(/\n\d+\)\s*Summary:/i).slice(1);
    const queries: HaroQuery[] = [];

    for (const block of blocks) {
      const get = (label: string) => {
        const m = block.match(new RegExp(`${label}:\\s*([^\\n]+)`, 'i'));
        return m?.[1]?.trim() ?? '';
      };
      const summary = block.split('\n')[0]?.trim() ?? '';
      const name = get('Name');
      const category = get('Category');
      const email = get('Email');
      const publication = get('Media Outlet') || get('Outlet');
      const deadline = get('Deadline');

      // Query + Requirements multi-line — sonraki bos satira kadar
      const queryStart = block.search(/Query:\s*/i);
      const reqStart = block.search(/Requirements:\s*/i);
      let query = '';
      let requirements = '';
      if (queryStart >= 0) {
        const end = reqStart > queryStart ? reqStart : block.length;
        query = block.slice(queryStart + 6, end).replace(/^\s*Query:\s*/i, '').trim();
      }
      if (reqStart >= 0) {
        requirements = block.slice(reqStart + 13).replace(/^\s*Requirements:\s*/i, '').trim().split(/\n\d+\)/)[0];
      }

      if (!query) continue;

      const fitScore = this.scoreFit(category, summary, query, niche);
      const draftPitch = await this.generatePitch({
        brand, niche, brandTone: brandVoice.tone,
        reporterName: name, publication, query, requirements, summary,
      });

      queries.push({
        publication, reporter: name, email, deadline,
        query, requirements, category,
        brandFitScore: fitScore, draftPitch,
      });
    }

    return queries.sort((a, b) => b.brandFitScore - a.brandFitScore);
  }

  private scoreFit(category: string, summary: string, query: string, niche: string): number {
    let score = 30;
    const text = `${category} ${summary} ${query}`.toLowerCase();
    const nicheLower = niche.toLowerCase();

    if (nicheLower && text.includes(nicheLower)) score += 30;
    if (text.includes('expert') || text.includes('uzman') || text.includes('source')) score += 15;
    if (text.includes('quote') || text.includes('comment') || text.includes('alinti')) score += 15;
    if (category.toLowerCase().includes('tech') || category.toLowerCase().includes('biz')) score += 10;

    return Math.min(100, score);
  }

  private async generatePitch(opts: {
    brand: string; niche: string; brandTone?: string;
    reporterName: string; publication: string; query: string; requirements: string; summary: string;
  }): Promise<string> {
    if (!this.anthropic) {
      return `Merhaba ${opts.reporterName},\n\n${opts.publication} icin yazdiginiz makalede kaynak olarak yardimci olabilirim. ${opts.brand} olarak ${opts.niche} alaninda ${opts.summary} hakkinda yorumlarimi paylasabilirim.\n\n[AI cevap olusturmak icin ANTHROPIC_API_KEY gerekli — kendi sesinizde duzenleyin]`;
    }

    try {
      const resp = await this.anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        system: `Sen ${opts.brand} markasinin temsilcisisin. ${opts.niche} alaninda uzmansin. Gazetecilere kisa, somut, alintilanabilir HARO yaniti yazarsin. Marka tonu: ${opts.brandTone ?? 'profesyonel'}. Reklam degil, gercek deger.`,
        messages: [{
          role: 'user',
          content: `Yayin: ${opts.publication}\nGazeteci: ${opts.reporterName}\nSoru ozeti: ${opts.summary}\n\nTam soru:\n${opts.query}\n\nGereksinimler:\n${opts.requirements}\n\nKisa, alintilanabilir HARO pitch yaz (max 150 kelime). 1-2 net cumle + bir somut ornek/istatistik + iletisim daveti.`,
        }],
      });
      return resp.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
    } catch (err: any) {
      return `[AI fail: ${err.message}]`;
    }
  }
}
