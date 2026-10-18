import { ArgumentsHost, Catch, ExceptionFilter, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { bearerPresented, mcpAuthChallenge } from './mcp-discovery.js';

/**
 * MCP ucundaki 401'lere WWW-Authenticate ekler (RFC 9728 §5.1).
 *
 * NEDEN FILTRE: 401'i McpController degil global AuthGuard atar; guard'in
 * istisnasi da rotanin filtre zincirinden gecer. Controller seviyesinde
 * baglanan filtre global SentryExceptionFilter'dan ONCE secilir, yani yalnizca
 * MCP rotalari etkilenir — panelin 401'leri eskisi gibi kalir.
 *
 * Govde Nest'in varsayilan bicimiyle ayni (statusCode/message/error):
 * istemciler basliga bakar, govdeyi degistirmek icin sebep yok.
 */
@Catch(UnauthorizedException)
export class McpAuthChallengeFilter implements ExceptionFilter {
  catch(exception: UnauthorizedException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    res.setHeader('WWW-Authenticate', mcpAuthChallenge({ tokenPresented: bearerPresented(req.headers?.authorization) }));
    const body = exception.getResponse();
    res.status(exception.getStatus()).json(typeof body === 'string' ? { statusCode: 401, message: body } : body);
  }
}
