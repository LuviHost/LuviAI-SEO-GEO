import { Body, Controller, Delete, Get, Logger, Post, Req, Res, UseFilters } from '@nestjs/common';
import type { Request, Response } from 'express';
import { McpToolsService } from './mcp-tools.service.js';
import { QuotaService } from '../billing/quota.service.js';
import { ApiKeysService } from '../api-keys/api-keys.service.js';
import { Public } from '../auth/public.decorator.js';
import { McpAuthChallengeFilter } from './mcp-auth-challenge.filter.js';
import {
  MCP_PROTOCOL_VERSIONS,
  MCP_SERVER_INFO,
  SERVER_CARD_MEDIA_TYPE,
  bearerPresented,
  buildServerCard,
  mcpAuthChallenge,
} from './mcp-discovery.js';

/**
 * RanksUp MCP Server — Streamable HTTP transport, STATELESS mod.
 *
 * MCP (Model Context Protocol) JSON-RPC 2.0 uzerinden calisir. Bu controller
 * spec'in zorunlu minimum yuzeyini dependency'siz implemente eder:
 *   initialize / notifications-* / ping / tools/list / tools/call
 *
 * AUTH: global AuthGuard `Authorization: Bearer luvi_...` API anahtarini
 * dogruluyor (req.user doldurulur). Bu yalnizca istemci OZEL BASLIK
 * gonderebiliyorsa calisir: Claude Code ve Cursor gonderir. ChatGPT
 * gonderemez — kimlik dogrulamali sunucular icin OAuth 2.1 ister
 * (https://developers.openai.com/apps-sdk/build/auth). claude.ai ozel
 * baglayicilarinda baslikla kimlik dogrulama beta ve yalnizca sinirli sayida
 * kurulusta acik (https://claude.com/docs/connectors/custom/remote-mcp).
 * 401'ler WWW-Authenticate + RFC 9728 korunan kaynak metadatasi adresini
 * tasir (McpAuthChallengeFilter, mcp-discovery.ts); metadata yetkilendirme
 * sunucusu YAZMAZ, cunku yok.
 * TODO(MCP OAuth 2.1): ChatGPT ve claude.ai icin OAuth yetkilendirme sunucusu
 * — sahibin urun karari bekleniyor; kurulunca metadataya authorization_servers
 * eklenir.
 *
 * Kurulum rehberi: https://ranksup.ai/agent-setup.txt
 *   claude mcp add --transport http ranksup https://api.ranksup.ai/api/mcp \
 *     --header "Authorization: Bearer luvi_XXX"
 *
 * STATELESS: session id uretmiyoruz; her istek bagimsiz. SSE stream
 * ACILMAZ (GET → 405) — tum yanitlar tek JSON govdesi. Spec buna izin verir
 * (server MAY return application/json). Batching: 2025-03-26 istemcileri
 * icin dizi kabul edilir, dizi olarak yanitlanir.
 */

type JsonRpcMsg = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: any;
};

@Controller('mcp')
@UseFilters(McpAuthChallengeFilter)
export class McpController {
  private readonly log = new Logger(McpController.name);

  constructor(
    private readonly tools: McpToolsService,
    private readonly quota: QuotaService,
    private readonly apiKeys: ApiKeysService,
  ) {}

  @Post()
  async handle(@Req() req: Request, @Res() res: Response, @Body() body: JsonRpcMsg | JsonRpcMsg[]) {
    const user = (req as any).user as { id: string; role: string; plan?: string } | undefined;
    if (!user) {
      // AuthGuard normalde 401 atar; bu dal savunma amacli
      res.setHeader('WWW-Authenticate', mcpAuthChallenge({ tokenPresented: bearerPresented(req.headers?.authorization) }));
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
    // API anahtarinin scope'lari — guard /mcp'yi yol/metod bazinda denetlemez
    // (POST hem okuma hem yazma tasir); denetim arac bazinda dispatch'te:
    // kaynak scope'u olan arac onu, olmayan mutating arac herhangi bir :write ister.
    const apiKey = (req as any).apiKey as { scopes: string[] } | undefined;
    const canWrite = !apiKey
      || apiKey.scopes.includes('*')
      || apiKey.scopes.some((s) => s.endsWith(':write'));

    const isBatch = Array.isArray(body);
    const messages = isBatch ? body : [body];

    const responses: any[] = [];
    for (const msg of messages) {
      const r = await this.dispatch(user, msg, canWrite, apiKey?.scopes ?? null);
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

  /**
   * MCP Server Card (SEP-2127) — <streamable-http-url>/server-card.
   * Herkese acik, salt-okuma metadata; CORS basliklari docs/discovery.md'de
   * MUST. ETag ve If-None-Match -> 304'u Express res.send kendisi yapar.
   */
  @Public()
  @Get('server-card')
  serverCard(@Res() res: Response) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, If-None-Match');
    res.setHeader('Access-Control-Expose-Headers', 'ETag');
    // Global CORS izinli kokenlere credentials basligi ekliyor; '*' ile birlikte
    // tarayici yaniti reddeder ve herkese acik belgede zaten anlamsiz.
    res.removeHeader('Access-Control-Allow-Credentials');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.type(SERVER_CARD_MEDIA_TYPE);
    // Buffer gonderilir: string'e Express charset ekler, Buffer'a eklemez.
    res.send(Buffer.from(JSON.stringify(buildServerCard(), null, 2)));
  }

  @Delete()
  deleteSession(@Res() res: Response) {
    // Stateless: silinecek oturum yok
    res.status(405).end();
  }

  // ────────────────────────────────────────────────────────────

  private async dispatch(user: { id: string; role: string; plan?: string }, msg: JsonRpcMsg, canWrite = true, keyScopes: string[] | null = null): Promise<any | undefined> {
    if (!msg || typeof msg !== 'object' || !msg.method) {
      return this.rpcError(msg?.id ?? null, -32600, 'Gecersiz istek');
    }

    const isNotification = msg.id === undefined || msg.id === null;

    try {
      switch (msg.method) {
        case 'initialize': {
          const requested = msg.params?.protocolVersion;
          const version = MCP_PROTOCOL_VERSIONS.includes(requested) ? requested : MCP_PROTOCOL_VERSIONS[0];
          return this.rpcResult(msg.id!, {
            protocolVersion: version,
            capabilities: { tools: { listChanged: false } },
            serverInfo: MCP_SERVER_INFO,
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
          const def = this.tools.list().find((t) => t.name === String(name));
          // API anahtariyla gelindiyse REST ile AYNI kural: aracin kaynak
          // scope'u (ToolDef.scope = REST ikizinin scope'u) okuma araclarinda
          // da aranir; ':write' ayni kaynagin ':read'ini kapsar. Eskiden
          // araclarin cogunda scope yoktu: yalniz 'social:read' tasiyan anahtar
          // makale/denetim okuyabiliyor, 'social:write' anahtari run_audit ve
          // create_article ile olcum hakki ve kota harcayabiliyordu (inceleme R21).
          if (def?.scope && keyScopes && !this.apiKeys.hasScopeForRoute(keyScopes, def.scope)) {
            return this.rpcResult(msg.id!, {
              content: [{ type: 'text', text: `Hata: bu API anahtarında "${def.scope}" yetkisi yok. Bu aracı kullanmak için anahtarı bu yetkiyle yeniden üret.` }],
              isError: true,
            });
          }
          // Kaynaga eslesmeyen arac (aksiyon plani, ASO) icin REST'in kaba
          // kurali: mutating -> herhangi bir ':write' (kota/maliyet tuketir).
          // Scope'lu yazma araclarinda yukaridaki denetim bunu zaten kapsar;
          // yine de burada kalir ki yanlislikla ':read' scope'u verilmis bir
          // yazma araci salt-okuma anahtarina acilmasin.
          if (def?.mutating && !canWrite) {
            return this.rpcResult(msg.id!, {
              content: [{ type: 'text', text: `Hata: bu API anahtarı salt okunur; ${String(name)} için en az bir yazma (:write) yetkisi olan anahtar gerekli.` }],
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
