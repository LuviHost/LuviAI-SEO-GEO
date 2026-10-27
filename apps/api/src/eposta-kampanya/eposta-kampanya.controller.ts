import { Body, Controller, ForbiddenException, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator.js';
import { EpostaKampanyaService } from './eposta-kampanya.service.js';

function assertAdmin(req: Request) {
  const user = (req as any).user;
  if (!user) throw new ForbiddenException('Auth required');
  if (user.role !== 'ADMIN') throw new ForbiddenException('Admin only');
  return user;
}

/** Tick ayni surecte iki kez baslamasin (asil koruma DB kilidi; bu yalniz panel cift tiklamasi icin) */
let tickSuruyor = false;

/**
 * /api/eposta — kurumsal e-posta kampanyasi (admin paneli /admin/eposta) + Mailjet olay akisi.
 * Webhook disindaki her uc ADMIN ister.
 */
@Controller('eposta')
export class EpostaKampanyaController {
  constructor(private readonly svc: EpostaKampanyaService) {}

  @Get('overview')
  overview(@Req() req: Request, @Query() q: { durum?: string; sektor?: string; q?: string; sayfa?: string }) {
    assertAdmin(req);
    return this.svc.overview({ durum: q.durum || undefined, sektor: q.sektor || undefined, q: q.q, sayfa: Number(q.sayfa) || 1 });
  }

  @Post('acik')
  setAcik(@Req() req: Request, @Body() body: { acik?: boolean }) {
    assertAdmin(req);
    return this.svc.setAcik(body?.acik === true);
  }

  @Post('devam')
  devam(@Req() req: Request) {
    assertAdmin(req);
    return this.svc.devam();
  }

  @Post('ice-aktar')
  iceAktar(@Req() req: Request, @Body() body: { csv?: string }) {
    assertAdmin(req);
    return this.svc.iceAktar(String(body?.csv ?? ''));
  }

  @Post('iys-dosyasi')
  iysDosyasi(@Req() req: Request, @Body() body: { parti?: string }) {
    assertAdmin(req);
    return this.svc.iysDosyasi(body?.parti);
  }

  @Post('iys-yuklendi')
  iysYuklendi(@Req() req: Request, @Body() body: { parti?: string }) {
    assertAdmin(req);
    if (!body?.parti) throw new ForbiddenException('parti gerekli');
    return this.svc.iysYuklendi(body.parti);
  }

  @Post('hedef/:id')
  hedef(@Req() req: Request, @Param('id') id: string, @Body() body: { durum?: string; not?: string | null }) {
    assertAdmin(req);
    return this.svc.hedefGuncelle(id, body ?? {});
  }

  @Get('linkedin-firmalar')
  linkedinFirmalar(@Req() req: Request) {
    assertAdmin(req);
    return this.svc.linkedinFirmalarCsv();
  }

  @Post('webhook-kur')
  webhookKur(@Req() req: Request, @Body() body: { zorla?: boolean }) {
    assertAdmin(req);
    return this.svc.webhookKur(body?.zorla === true);
  }

  /** Elle tur: pencere disinda da (zorla) ama anahtar/IYS/kota/fren kapilari aynen gecerli */
  @Post('tick')
  async tick(@Req() req: Request) {
    assertAdmin(req);
    if (tickSuruyor) return { gonderildi: 0, hata: 0, neden: 'Tur zaten çalışıyor' };
    tickSuruyor = true;
    try {
      return await this.svc.tick({ zorla: true });
    } finally {
      tickSuruyor = false;
    }
  }

  /**
   * Mailjet Event API callback (open/click/bounce/blocked/spam/unsub; Version 1 = istek basina tek olay, dizi de kabul).
   * Kimlik: ?t=<belirtec> (webhookKur kurar).
   * Mailjet 200 almazsa yeniden dener; gecersiz belirtecte 200 + islenmedi doner ki yanlis istek tekrar tekrar gelmesin.
   */
  @SkipThrottle()
  @Public()
  @Post('webhooks/mailjet')
  @HttpCode(200)
  async webhook(@Query('t') t: string, @Body() body: unknown) {
    if (!this.svc.belirtecGecerli(t)) return { ok: false };
    const r = await this.svc.olaylariIsle(body);
    return { ok: true, ...r };
  }
}
