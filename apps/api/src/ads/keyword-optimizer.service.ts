import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../prisma/prisma.service.js';
import { AdsClientService } from './ads-client.service.js';

/**
 * Keyword Optimizer — Google Ads search terms report'undan alakasiz aramalari
 * tespit edip negative keyword olarak ekler. Reklam savurganligini %15-30
 * dusurur.
 *
 * Algoritma:
 *   1. MCP -> "Get search terms report, last 30 days, campaigns: ${id}"
 *   2. AI analiz -> sektore alakasiz kelimeleri belirle
 *   3. MCP -> "Add negative keywords: [list] to campaign ${id}"
 */
@Injectable()
export class KeywordOptimizerService {
  private readonly log = new Logger(KeywordOptimizerService.name);
  private readonly anthropic = process.env.ANTHROPIC_API_KEY
    ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    : null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly adsClient: AdsClientService,
  ) {}

  async optimizeAllGoogleCampaigns(): Promise<{ analyzed: number; addedKeywords: number }> {
    const sites = await this.prisma.site.findMany({
      where: { adsAutopilot: true } as any,
    });

    let analyzed = 0;
    let addedKeywords = 0;

    for (const site of sites) {
      const campaigns = await this.prisma.adCampaign.findMany({
        where: { siteId: site.id, platform: 'google_ads', status: 'ACTIVE' },
      });

      for (const c of campaigns) {
        analyzed++;
        if (!c.externalId) continue;
        try {
          // 1. Search terms report (direkt Google Ads API)
          const terms = await this.adsClient.getSearchTerms(site.id, c.externalId);
          if (!terms || terms.length === 0) continue;

          // 2. AI ile alakasiz olanlari tespit
          if (!this.anthropic) continue;
          const site_: any = site;
          const niche = site_.niche ?? '';
          const aiResp = await this.anthropic.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 800,
            system: `Sen Google Ads optimizasyon uzmanisin. Search term listesi gosterilir, sektore alakasiz olanlari tespit edersin. Sadece JSON dondur.`,
            messages: [{
              role: 'user',
              content: `Sektor: ${niche}
Urun/Hizmet: ${c.name}

Search terms (son 30g):
${JSON.stringify(terms.slice(0, 50), null, 2)}

Bu listede ${niche} alaninda alakasiz, conversion uretmeyecek (free, ucretsiz, indir, hack, kirma vs gibi) kelimeleri sec. JSON dondur:
{"negativeKeywords": ["kelime1", "kelime2", ...], "reason": "kisa aciklama"}`,
            }],
          });
          const aiText = aiResp.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
          const aiMatch = aiText.match(/\{[\s\S]*\}/);
          if (!aiMatch) continue;
          const aiData = JSON.parse(aiMatch[0]);
          const negatives: string[] = aiData.negativeKeywords ?? [];
          if (negatives.length === 0) continue;

          // 3. Direkt Google Ads API ile negative keyword ekle
          const addRes = await this.adsClient.addNegativeKeywords(site.id, c.externalId, negatives);
          if (addRes.ok) {
            addedKeywords += addRes.added ?? negatives.length;
            this.log.log(`[${c.id}] ${addRes.added ?? negatives.length} negative keyword eklendi`);

            const history: any[] = Array.isArray(c.autopilotActions) ? (c.autopilotActions as any[]) : [];
            history.push({
              time: new Date().toISOString(),
              action: 'add-negative-keywords',
              keywords: negatives,
              reason: aiData.reason,
            });
            await this.prisma.adCampaign.update({
              where: { id: c.id },
              data: { autopilotActions: history.slice(-20) as any },
            });
          }
        } catch (err: any) {
          this.log.warn(`[${c.id}] keyword opt fail: ${err.message}`);
        }
      }
    }

    this.log.log(`Negative keyword optimizer: ${analyzed} kampanya, ${addedKeywords} negative eklendi`);
    return { analyzed, addedKeywords };
  }
}
