import { Controller, Get, RequestMethod, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../auth/public.decorator.js';
import { buildProtectedResourceMetadata } from './mcp-discovery.js';

/** main.ts setGlobalPrefix istisnasi — testler de ayni sabiti kullanir */
export const MCP_WELL_KNOWN_PREFIX_EXCLUDE = {
  path: '.well-known/oauth-protected-resource/api/mcp',
  method: RequestMethod.GET,
};

/**
 * RFC 9728 korunan kaynak metadatasi — KOKTE:
 *   GET /.well-known/oauth-protected-resource/api/mcp
 * (main.ts global 'api' onekini yalnizca bu yol icin haric tutar).
 *
 * URETIM YONLENDIRMESI: api.ranksup.ai'de kok yollar su an Next'e gidiyor
 * (17.10.2026 canli kontrol: bu yol Next 404 dondu, /api/* ise Express).
 * Bu yuzden ayni belge apps/web/public/.well-known/oauth-protected-resource/api/mcp
 * olarak da yayimlanir. Nginx kok yollari API'ye verirse (docs/DEPLOYMENT.md
 * boyle anlatiyor) bu uc cevaplar. Iki kopyanin ayni kalmasini
 * public-docs.spec.ts dogrular.
 */
@Controller('.well-known/oauth-protected-resource')
export class McpWellKnownController {
  @Public()
  @Get('api/mcp')
  protectedResourceMetadata(@Res() res: Response) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    // Global CORS'un credentials basligi '*' ile birlikte tarayicida reddedilir
    res.removeHeader('Access-Control-Allow-Credentials');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.json(buildProtectedResourceMetadata());
  }
}
