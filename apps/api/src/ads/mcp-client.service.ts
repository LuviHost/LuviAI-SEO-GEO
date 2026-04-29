import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * MCP Client — irinabuht12-oss/google-meta-ads-ga4-mcp remote MCP server'ina
 * Anthropic SDK uzerinden bagli.
 *
 * Anthropic API'nin yeni `mcp_servers` parametresi ile remote MCP'ye baglanir
 * ve Claude'un MCP tool'larini cagirma yetenegi otomatik aktif olur.
 *
 * Site bazinda MCP endpoint URL + bearer token tutulur (Site.adsMcpEndpoint /
 * adsMcpToken). Kullanici Ryze AI'a kayit olur, MCP URL'i panele yapistir.
 *
 * NOT: Anthropic Claude'un native MCP support'u beta/preview asamasinda
 * olabilir. Production'da MCP-over-HTTP'ye dogrudan istek atilarak da
 * cagrilabilir (alternatif yol).
 */
@Injectable()
export class AdsMcpClientService {
  private readonly log = new Logger(AdsMcpClientService.name);
  private readonly anthropic = process.env.ANTHROPIC_API_KEY
    ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    : null;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Bir site icin MCP'yi kullanarak Claude'a "campaign create" gibi
   * yuksek seviyeli komut ver. Claude MCP tool'larini kullanarak gercek
   * Google/Meta API call'larini yapar.
   *
   * Note: Anthropic SDK'da MCP support genis hale gelinceye kadar bu
   * fonksiyon "instruction-only" mode'da calisabilir (Claude'a tool listesi
   * verilir, manuel orchestration). Tam otomatik icin Anthropic Beta API
   * 'mcp_servers' kullanilir.
   */
  async runMcpCommand(siteId: string, command: string, options: {
    maxTurns?: number;
  } = {}): Promise<{ ok: boolean; output: string; toolCalls: number; error?: string }> {
    const site: any = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId } });
    if (!site.adsMcpEndpoint) {
      return { ok: false, output: '', toolCalls: 0, error: 'MCP endpoint tanimli degil' };
    }
    if (!this.anthropic) {
      return { ok: false, output: '', toolCalls: 0, error: 'ANTHROPIC_API_KEY yok' };
    }

    try {
      // Beta MCP support kullanmak icin extra header ile
      const resp = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: `Sen ${site.name} markasinin Paid Ads asistanisin. Google Ads, Meta Ads ve GA4 MCP server'lari uzerinden gercek API call'lari yapabilirsin. Komutu hassas sekilde uygulayip ozeti dondur.`,
        messages: [{ role: 'user', content: command }],
        // @ts-ignore — Beta API
        mcp_servers: [{
          type: 'url',
          url: site.adsMcpEndpoint,
          name: 'google-meta-ads-ga4',
          ...(site.adsMcpToken ? { authorization_token: site.adsMcpToken } : {}),
        }],
      } as any).catch((err) => {
        // Fallback: SDK MCP'yi henuz desteklemiyor; rapor uretip dondur
        throw new Error(`MCP call: ${err.message ?? err}`);
      });

      const text = resp.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
      const toolUses = resp.content.filter((b: any) => b.type === 'tool_use' || b.type === 'mcp_tool_use').length;

      this.log.log(`[${siteId}] MCP command OK: ${toolUses} tool call`);
      return { ok: true, output: text, toolCalls: toolUses };
    } catch (err: any) {
      this.log.warn(`[${siteId}] MCP command fail: ${err.message}`);
      return { ok: false, output: '', toolCalls: 0, error: err.message };
    }
  }

  /**
   * MCP olmadan da kullanicinin endpoint'inin canli olup olmadigini test eder.
   */
  async ping(siteId: string): Promise<{ ok: boolean; error?: string }> {
    const site: any = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId } });
    if (!site.adsMcpEndpoint) return { ok: false, error: 'MCP endpoint yok' };
    try {
      const res = await fetch(site.adsMcpEndpoint, {
        method: 'OPTIONS',
        headers: site.adsMcpToken ? { 'Authorization': `Bearer ${site.adsMcpToken}` } : {},
        signal: AbortSignal.timeout(8000),
      });
      return { ok: res.ok || res.status === 405 };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }
}
