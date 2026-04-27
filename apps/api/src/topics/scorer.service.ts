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
    }, null, 2);

    const result = await this.runner.run({
      agentName: 'topic-ranker',
      agentSystemSuffix: AGENT_TOPIC_RANKER.systemSuffix,
      brainContext: input.brainContext,
      input: `4 kaynaktan toplanmış ham konu/fırsat verisi aşağıda. JSON skor + tier üret. Sadece JSON çıktı ver.\n\n${inputJson}`,
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
