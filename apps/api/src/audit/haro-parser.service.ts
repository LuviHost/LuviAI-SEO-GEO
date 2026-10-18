import { BadRequestException, Injectable, Logger } from '@nestjs/common';
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
  /** Bos dize: taslak uretilmedi (pitchSkipped) */
  draftPitch: string;
  /**
   * true: uygunluk puani ilk HARO_PITCH_TOP_N icinde degil, taslak (model
   * cagrisi) uretilmedi. Panel "taslak hazırlanmadı" gosterir.
   */
  pitchSkipped?: boolean;
}

/** HARO ozetini soru bloklarina ayiran desen ("N) Summary:") */
export const HARO_BLOCK_SPLIT = /\n\d+\)\s*Summary:/i;
/**
 * Tek istekte islenecek en fazla soru blogu. audit.controller haroParse ayni
 * kurali (HARO_MAX_QUERIES = 30, ayni desen) govde uzerinde uygular; servis
 * de uygular cunku dogrudan cagiran yollar (MCP, worker, test) controller'dan
 * gecmez ve 100 KB'lik bir govdeye binlerce kisa blok sigar.
 */
export const HARO_MAX_BLOCKS = 30;
/**
 * Taslak yanit (soru basina bir model cagrisi) yalniz uygunluk puani en
 * yuksek bu kadar soru icin uretilir. Eskiden HER blok icin sirayla cagri
 * yapiliyordu (30 blokta 30 cagri, ~dakikalar); musteri zaten en uygun
 * sorulara yanit verir, digerleri listede taslaksiz kalir.
 */
export const HARO_PITCH_TOP_N = 10;
/** Ayni anda en fazla bu kadar taslak cagrisi (saglayici hiz sinirina takilmasin) */
const PITCH_CONCURRENCY = 5;

/**
 * HARO Parser — kullanici RanksUp'ye HARO emaillerini forward eder veya
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
   * HARO email icerigini parse et + uygunluk puani en yuksek HARO_PITCH_TOP_N
   * sorgu icin draft pitch uret (digerleri pitchSkipped). En fazla
   * HARO_MAX_BLOCKS blok; fazlasi 400.
   */
  async parseDigest(siteId: string, emailContent: string): Promise<HaroQuery[]> {
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
    // Regex ile blok blok parse et. Tavan DB'ye ve modele gitmeden once.
    const content = typeof emailContent === 'string' ? emailContent : '';
    const blocks = content.split(HARO_BLOCK_SPLIT).slice(1);
    if (blocks.length > HARO_MAX_BLOCKS) {
      throw new BadRequestException(
        `Tek seferde en fazla ${HARO_MAX_BLOCKS} HARO sorusu işlenebilir (bu metinde ${blocks.length} soru var). E-postayı bölerek yapıştırın.`,
      );
    }

    const site: any = await this.prisma.site.findUniqueOrThrow({
      where: { id: siteId },
      include: { brain: true },
    });
    const brand = site.name;
    const niche = site.niche ?? '';
    const brandVoice: any = site.brain?.brandVoice ?? {};

    // 1) Once tum bloklar ayristirilir ve puanlanir (model cagrisi yok)
    const parsed: Array<{ q: HaroQuery; summary: string }> = [];

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

      parsed.push({
        summary,
        q: {
          publication, reporter: name, email, deadline,
          query, requirements, category,
          brandFitScore: this.scoreFit(category, summary, query, niche),
          draftPitch: '',
        },
      });
    }

    // 2) Uygunluga gore sirala (Array#sort kararli: esit puanda e-postadaki sira)
    parsed.sort((a, b) => b.q.brandFitScore - a.q.brandFitScore);

    // 3) Taslak yalniz ilk HARO_PITCH_TOP_N icin, en fazla PITCH_CONCURRENCY paralel
    const withPitch = parsed.slice(0, HARO_PITCH_TOP_N);
    for (let i = 0; i < withPitch.length; i += PITCH_CONCURRENCY) {
      await Promise.all(withPitch.slice(i, i + PITCH_CONCURRENCY).map(async (p) => {
        p.q.draftPitch = await this.generatePitch({
          brand, niche, brandTone: brandVoice.tone,
          reporterName: p.q.reporter, publication: p.q.publication,
          query: p.q.query, requirements: p.q.requirements, summary: p.summary,
        });
      }));
    }
    for (const p of parsed.slice(HARO_PITCH_TOP_N)) p.q.pitchSkipped = true;

    return parsed.map((p) => p.q);
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
        model: 'claude-opus-5',
        max_tokens: 4000,
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
