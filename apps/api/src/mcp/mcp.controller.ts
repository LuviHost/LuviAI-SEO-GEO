import { Body, Controller, Delete, Get, Logger, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { McpToolsService } from './mcp-tools.service.js';
import { QuotaService } from '../billing/quota.service.js';

/**
 * RanksUp MCP Server — Streamable HTTP transport, STATELESS mod.
 *
 * MCP (Model Context Protocol) JSON-RPC 2.0 uzerinden calisir. Bu controller
 * spec'in zorunlu minimum yuzeyini dependency'siz implemente eder:
 *   initialize / notifications-* / ping / tools/list / tools/call
 *
 * AUTH: global AuthGuard `Authorization: Bearer luvi_...` API anahtarini
 * zaten dogruluyor (req.user doldurulur). MCP istemcileri (Claude, ChatGPT,
 * Cursor...) custom header destekledigi icin ek OAuth katmani gerekmez.
 *
 * Kurulum (kullaniciya gosterilen):
 *   claude mcp add ranksup https://api.ranksup.ai/api/mcp \
 *     --transport http --header "Authorization: Bearer luvi_XXX"
 *
 * STATELESS: session id uretmiyoruz; her istek bagimsiz. SSE stream
 * ACILMAZ (GET → 405) — tum yanitlar tek JSON govdesi. Spec buna izin verir
 * (server MAY return application/json). Batching: 2025-03-26 istemcileri
 * icin dizi kabul edilir, dizi olarak yanitlanir.
 */

const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const SERVER_INFO = { name: 'ranksup', title: 'RanksUp — SEO + GEO + ASO', version: '1.0.0' };

type JsonRpcMsg = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: any;
};

@Controller('mcp')
export class McpController {
  private readonly log = new Logger(McpController.name);

  constructor(
    private readonly tools: McpToolsService,
    private readonly quota: QuotaService,
  ) {}

  @Post()
  async handle(@Req() req: Request, @Res() res: Response, @Body() body: JsonRpcMsg | JsonRpcMsg[]) {
    const user = (req as any).user as { id: string; role: string; plan?: string } | undefined;
    if (!user) {
      // AuthGuard normalde 401 atar; bu dal savunma amacli
      res.status(401).json(this.rpcError(null, -32001, 'Kimlik dogrulanamadi'));
      return;
    }
    // Plan kapisi — MCP sunucusu fiyat kartinda Kurumsal'a ait. JSON-RPC
    // oldugu icin HTTP 403 yerine RPC hatasi donuyoruz; istemciler (Claude,
    // Cursor) govdedeki hatayi kullaniciya gosterir, ciplak 403'u gostermez.
    try {
      await this.quota.enforcePlanFeature(user.id, 'mcpAccess');
    } catch (err: any) {
      res.status(403).json(this.rpcError(null, -32003, err?.message ?? 'Plan yetersiz'));
      return;
    }
    // API anahtarinin scope'lari — mutating tool'lar :write ister (guard /mcp'yi
    // metod bazinda denetlemez cunku POST hem okuma hem yazma tasir).
    const apiKey = (req as any).apiKey as { scopes: string[] } | undefined;
    const canWrite = !apiKey
      || apiKey.scopes.includes('*')
      || apiKey.scopes.some((s) => s.endsWith(':write'));

    const isBatch = Array.isArray(body);
    const messages = isBatch ? body : [body];

    const responses: any[] = [];
    for (const msg of messages) {
      const r = await this.dispatch(user, msg, canWrite);
      if (r !== undefined) responses.push(r);
    }

    if (responses.length === 0) {
      // Yalnizca notification geldi — 202 Accepted, govde yok (spec geregi)
      res.status(202).end();
      return;
    }
    res.status(200).json(isBatch ? responses : responses[0]);
  }

  /** SSE stream desteklenmiyor — stateless JSON modu */
  @Get()
  streamNotSupported(@Res() res: Response) {
    res.status(405).json({ error: 'SSE stream desteklenmiyor — POST ile JSON-RPC kullanin' });
  }

  @Delete()
  deleteSession(@Res() res: Response) {
    // Stateless: silinecek oturum yok
    res.status(405).end();
  }

  // ────────────────────────────────────────────────────────────

  private async dispatch(user: { id: string; role: string; plan?: string }, msg: JsonRpcMsg, canWrite = true): Promise<any | undefined> {
    if (!msg || typeof msg !== 'object' || !msg.method) {
      return this.rpcError(msg?.id ?? null, -32600, 'Gecersiz istek');
    }

    const isNotification = msg.id === undefined || msg.id === null;

    try {
      switch (msg.method) {
        case 'initialize': {
          const requested = msg.params?.protocolVersion;
          const version = PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0];
          return this.rpcResult(msg.id!, {
            protocolVersion: version,
            capabilities: { tools: { listChanged: false } },
            serverInfo: SERVER_INFO,
            instructions: [
              'RanksUp — SEO + GEO + ASO otomasyon platformunun MCP sunucusu.',
              'Once list_sites ile site_id al; site kapsamli tum tool\'lar bu id\'yi ister.',
              'Mutating tool\'lar (run_*, create_*, generate_*) kota/maliyet tuketir — kullanici acikca istemeden cagirma.',
            ].join(' '),
          });
        }

        case 'ping':
          return isNotification ? undefined : this.rpcResult(msg.id!, {});

        case 'tools/list':
          // Plan kapisi listede: kullanicinin planinda olmayan tool hic gorunmez
          return this.rpcResult(msg.id!, { tools: this.tools.listForMcp(user) });

        case 'tools/call': {
          const name = msg.params?.name;
          const args = msg.params?.arguments ?? {};
          // Salt-okunur anahtar mutating tool cagiramaz (kota/maliyet tuketir)
          const def = this.tools.list().find((t) => t.name === String(name));
          if (def?.mutating && !canWrite) {
            return this.rpcResult(msg.id!, {
              content: [{ type: 'text', text: 'Hata: bu API anahtari salt-okunur — ' + String(name) + ' icin :write scope\'lu anahtar gerekli.' }],
              isError: true,
            });
          }
          try {
            const result = await this.tools.call(user, String(name), args);
            return this.rpcResult(msg.id!, {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
              isError: false,
            });
          } catch (err: any) {
            // Tool hatasi — protokol hatasi DEGIL; isError:true ile icerik olarak doner
            return this.rpcResult(msg.id!, {
              content: [{ type: 'text', text: `Hata: ${err.message ?? 'bilinmeyen'}` }],
              isError: true,
            });
          }
        }

        default:
          // notifications/initialized, notifications/cancelled vb. sessiz kabul
          if (msg.method.startsWith('notifications/')) return undefined;
          if (isNotification) return undefined;
          return this.rpcError(msg.id!, -32601, `Metod bulunamadi: ${msg.method}`);
      }
    } catch (err: any) {
      this.log.error(`MCP dispatch hatasi (${msg.method}): ${err.message}`);
      if (isNotification) return undefined;
      return this.rpcError(msg.id!, -32603, err.message ?? 'Sunucu hatasi');
    }
  }

  private rpcResult(id: string | number, result: any) {
    return { jsonrpc: '2.0', id, result };
  }

  private rpcError(id: string | number | null, code: number, message: string) {
    return { jsonrpc: '2.0', id, error: { code, message } };
  }
}
