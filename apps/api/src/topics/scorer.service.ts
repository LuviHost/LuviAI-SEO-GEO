import { Injectable, Logger } from '@nestjs/common';
import { AgentRunnerService } from '../articles/agent-runner.service.js';
import { AGENT_TOPIC_RANKER } from '@luviai/shared';
import type { AgentContext } from '@luviai/shared';

export interface ScorerInput {
  brainContext: AgentContext;
  planTopics: any[];
  gscOpportunities: any[];
  geoGaps: any[];
  competitorMoves: any[];
  existingPages: string[];
  /** Google Ads'te tiklama / donusum getiren, marka adi gecmeyen arama terimleri (topics/ads-terms.ts) */
  adsSearchTerms?: any[];
}

@Injectable()
export class ScorerService {
  private readonly log = new Logger(ScorerService.name);

  constructor(private readonly runner: AgentRunnerService) {}

  async rank(input: ScorerInput): Promise<{ ranked: any; usage: any; costUsd: number }> {
    const inputJson = JSON.stringify({
      plan_topics: input.planTopics,
      gsc_opportunities: input.gscOpportunities,
      geo_gaps: input.geoGaps,
      competitor_moves: input.competitorMoves,
      existing_pages: input.existingPages,
      ...(input.adsSearchTerms?.length ? { ads_search_terms: input.adsSearchTerms } : {}),
    }, null, 2);
    // 18.11.2026: besinci kaynak — reklamda para odenen terimler (yalniz hesap bagliysa gelir)
    const reklamNotu = input.adsSearchTerms?.length
      ? '\n\nads_search_terms: Google Ads\'te son 30 günde para ödenen ve tıklama ya da dönüşüm getiren arama terimleri (marka adı geçenler çıkarıldı). Dönüşüm getiren terimler için organik aramada ve AI cevaplarında görünecek içerik yüksek önceliklidir; konu başlığını terimin arama niyetine göre yaz, terimi birebir kopyalama. Mevcut sayfalarda zaten işlenmiş terim için yeni konu açma.'
      : '';

    const result = await this.runner.run({
      agentName: 'topic-ranker',
      agentSystemSuffix: AGENT_TOPIC_RANKER.systemSuffix,
      brainContext: input.brainContext,
      input: `${input.adsSearchTerms?.length ? 5 : 4} kaynaktan toplanmış ham konu/fırsat verisi aşağıda. JSON skor + tier üret. Sadece JSON çıktı ver.${reklamNotu}\n\n${inputJson}`,
      maxTokens: 16384,
    });

    return {
      ranked: this.parseJsonRobust(result.output),
      usage: result.usage,
      costUsd: result.costUsd,
    };
  }

  private parseJsonRobust(text: string): any {
    let json = text.trim();
    const fenceMatch = json.match(/```(?:json)?\s*\n?([\s\S]*?)(?:\n?```|$)/);
    if (fenceMatch) json = fenceMatch[1].trim();
    const firstBrace = json.indexOf('{');
    if (firstBrace > 0) json = json.slice(firstBrace);

    try {
      return JSON.parse(json);
    } catch {
      // Truncate kurtarma
      return this.recoverTruncated(json);
    }
  }

  private recoverTruncated(text: string): any | null {
    let depth = 0;
    let inString = false;
    let escape = false;
    const stack: string[] = [];
    let lastSafe = -1;

    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (escape) { escape = false; continue; }
      if (c === '\\' && inString) { escape = true; continue; }
      if (c === '"') { inString = !inString; continue; }
      if (inString) continue;

      if (c === '{') stack.push('}');
      else if (c === '[') stack.push(']');
      else if (c === '}' || c === ']') stack.pop();

      if (c === ',' && stack.length > 0) lastSafe = i - 1;
      else if (c === '}') lastSafe = i;
    }

    if (lastSafe === -1) return null;

    const truncated = text.slice(0, lastSafe + 1);
    const restStack: string[] = [];
    let inStr = false;
    let esc = false;
    for (let i = 0; i < truncated.length; i++) {
      const c = truncated[i];
      if (esc) { esc = false; continue; }
      if (c === '\\' && inStr) { esc = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === '{') restStack.push('}');
      else if (c === '[') restStack.push(']');
      else if (c === '}' || c === ']') restStack.pop();
    }
    const closing = restStack.reverse().join('');

    try {
      return JSON.parse(truncated + closing);
    } catch {
      return null;
    }
  }
}
