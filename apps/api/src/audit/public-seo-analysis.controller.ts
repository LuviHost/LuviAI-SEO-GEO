import { Body, Controller, Get, HttpException, HttpStatus, NotFoundException, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator.js';
import { clientIp } from '../common/client-ip.js';
import { PublicSeoAnalysisService } from './public-seo-analysis.service.js';

/** Ucretsiz testle ayni kaba bot suzgeci (public-citation.controller isObviousBot) */
export function isObviousBotUa(ua: string): boolean {
  const u = ua.toLowerCase();
  if (!u || u.length < 5) return true;
  return ['curl/', 'wget/', 'python-requests', 'scrapy', 'go-http-client', 'bot', 'spider', 'crawler', 'headless', 'lighthouse', 'pagespeed']
    .some((s) => u.includes(s));
}

/**
 * Ucretsiz SEO analizi (ranksup.ai/seo-analizi):
 *   POST /api/public/seo-analiz      { domain } → { id, status, ... }  (onbellekte varsa dogrudan sonuc)
 *   GET  /api/public/seo-analiz/:id  → durum ve sonuc (istemci birkac saniyede bir sorar)
 * Sinirlar ve gerekce: public-seo-analysis.ts.
 */
@Controller('public/seo-analiz')
export class PublicSeoAnalysisController {
  constructor(private readonly svc: PublicSeoAnalysisService) {}

  @Public()
  @Post()
  async start(@Req() req: Request, @Body() body: { domain?: unknown }) {
    if (isObviousBotUa((req.headers['user-agent'] ?? '').toString())) {
      throw new HttpException('Bot tespit edildi', HttpStatus.FORBIDDEN);
    }
    if (!body?.domain || typeof body.domain !== 'string') {
      throw new HttpException('Alan adı gerekli', HttpStatus.BAD_REQUEST);
    }
    return this.svc.start(body.domain, clientIp(req));
  }

  @Public()
  @Get(':id')
  async get(@Param('id') id: string) {
    const d = await this.svc.get(id);
    if (!d) throw new NotFoundException('Analiz bulunamadı');
    return d;
  }
}
