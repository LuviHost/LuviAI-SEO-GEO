import { describe, it, expect, vi } from 'vitest';
import { McpToolsService, type ToolUser } from './mcp-tools.service.js';

/**
 * MCP / sohbet run_prompt — alintilanan kaynak listeleri ajan baglamina
 * GIRMEZ (20 probe x 20 kaynak cevabi 15-30 KB buyuturdu). Olcum sonucunun
 * geri kalani aynen doner. bkz. audit/citation-sources.ts providersWithoutSources
 */

const user: ToolUser = { id: 'u1', role: 'USER', plan: 'AGENCY' };
const SITE = { id: 's1', userId: 'u1', name: 'Site', url: 'https://site.com', niche: null, status: 'ACTIVE' };

describe('run_prompt', () => {
  it('probe kaynaklari cikarilir; main/summary ve damga kalir', async () => {
    const result = {
      promptId: 'p1', text: 'soru', main: { cited: 1, total: 2 }, fanout: [], weakestBranches: [], local: null, runAt: 'x',
      providers: [
        { provider: 'perplexity', label: 'Perplexity', available: true, probes: [{ query: 'soru', cited: true, sourcesVersion: 1, sources: [{ url: 'https://reddit.com/r/a/', domain: 'reddit.com' }] }] },
        { provider: 'xai', label: 'Grok', available: true, probes: [{ query: 'soru', cited: false, sourcesVersion: 1 }] },
      ],
    };
    const promptLab = { runPrompt: vi.fn(async () => result) };
    const measurement = { run: vi.fn(async (_u: unknown, fn: () => Promise<unknown>) => fn()) };
    const prisma = { site: { findUnique: vi.fn(async () => SITE) } };
    const n = null as never;
    const svc = new McpToolsService(prisma as never, n, n, n, n, n, n, n, promptLab as never, n, n, measurement as never);
    const out = await svc.list().find((t) => t.name === 'run_prompt')!.handler(user, { site_id: 's1', prompt_id: 'p1' });

    expect(promptLab.runPrompt).toHaveBeenCalledWith('s1', 'p1', {});
    expect(JSON.stringify(out)).not.toContain('reddit.com');
    expect(out.providers[0].probes[0]).toEqual({ query: 'soru', cited: true, sourcesVersion: 1 });
    expect(out.providers[1].probes[0]).toEqual({ query: 'soru', cited: false, sourcesVersion: 1 });
    expect(out.main).toEqual({ cited: 1, total: 2 });
    expect((result.providers[0].probes[0] as { sources?: unknown[] }).sources).toHaveLength(1);
  });
});
