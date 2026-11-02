import { Body, Controller, ForbiddenException, Get, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator.js';
import { EpostaKampanyaService } from './eposta-kampanya.service.js';
import { retSayfasi } from './soguk-gonderim.js';

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

  /** Soguk gonderim araci icin CSV + sablon metni; isaretle=true → satirlar DIS_ARAC (Mailjet turu almaz) */
  @Post('soguk-disa-aktar')
  sogukDisaAktar(@Req() req: Request, @Body() body: { sektor?: string; limit?: number; isaretle?: boolean }) {
    assertAdmin(req);
    return this.svc.sogukDisaAktar({ sektor: body?.sektor || undefined, limit: body?.limit, isaretle: body?.isaretle === true });
  }

  /** Pazarlama e-postasina acik + cift onayli aboneler (Mailjet'e yuklenebilir liste) */
  @Get('pazarlama-onayli')
  pazarlamaOnayli(@Req() req: Request) {
    assertAdmin(req);
    return this.svc.pazarlamaOnayliCsv();
  }

  /**
   * Imzali ret linki — soguk gonderim e-postalarindaki {{ret_url}}.
   * GET yalniz onay sayfasi gosterir, RET yazmaz. NEDEN: kurumsal posta guvenlik tarayicilari (Safe Links, Mimecast)
   * gelen maildeki her linki kendiliginden acar; GET ret yazsaydi kimse tiklamadan adresler RET'e duserdi.
   * POST: sayfadaki dugme ya da RFC 8058 tek tik ret. Kimlik istemez; imza yeter.
   */
  @Public()
  @Get('ret')
  retGet(@Query('e') e: string, @Query('t') t: string, @Res() res: Response) {
    const gecerli = this.svc.retImzaGecerli(e, t);
    res.status(gecerli ? 200 : 400).type('html').setHeader('Cache-Control', 'no-store').send(retSayfasi(gecerli ? 'onay' : 'gecersiz'));
  }

  @Public()
  @Post('ret')
  @HttpCode(200)
  async retPost(@Query('e') e: string, @Query('t') t: string, @Res() res: Response) {
    const ok = await this.svc.retIsle(e, t);
    res.status(ok ? 200 : 400).type('html').setHeader('Cache-Control', 'no-store').send(retSayfasi(ok ? 'tamam' : 'gecersiz'));
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
