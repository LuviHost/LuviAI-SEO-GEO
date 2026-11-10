import { Body, Controller, ForbiddenException, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { KarneService, OZEL_SORU_ETIKETI } from './karne.service.js';
import { ALT_SEKTOR_ANAHTARLARI, OZEL_SORU_SINIRI, sektorAltAnahtarlari } from './karne-sorular.js';
import { SEKTORLER } from './prospect-utils.js';

function assertAdmin(req: Request) {
  const user = (req as any).user;
  if (!user) throw new ForbiddenException('Auth required');
  if (user.role !== 'ADMIN') throw new ForbiddenException('Admin only');
  return user;
}

/** Panelden gelen soru metni: satir satir yazilmis metin ya da dizi */
function sorulariAl(v: unknown): string[] | null {
  if (Array.isArray(v)) return v.filter((s): s is string => typeof s === 'string');
  if (typeof v === 'string' && v.trim()) return v.split(/\r?\n/);
  return null;
}

/**
 * /api/karneler — ucretsiz AI gorunurluk karnesi, panelden (admin /admin/karneler).
 *
 * NEDEN: karne bugune kadar ya terminalden (CLI, ozel sorular) ya da yalniz LinkedIn adayina
 * (banka sorulari) uretiliyordu; e-postayla cevap veren firmaya karne cikarmak icin terminal
 * gerekiyordu ve CLI karneleri panelde hic gorunmuyordu (10.11.2026).
 * Paylasim sayfasi ayri: /api/public/karne/:token (KarneController). Her uc ADMIN ister.
 */
@Controller('karneler')
export class KarneAdminController {
  constructor(private readonly karne: KarneService) {}

  @Get()
  async liste(@Req() req: Request) {
    assertAdmin(req);
    return {
      karneler: await this.karne.adminListe(),
      isler: this.karne.isListesi(),
      tahmin: this.karne.maliyetTahmini(),
      secenekler: {
        sektorler: [...SEKTORLER],
        altSektorler: Object.fromEntries(SEKTORLER.map((s) => [s, sektorAltAnahtarlari(s)])) as Record<string, string[]>,
        tumAltSektorler: [...ALT_SEKTOR_ANAHTARLARI],
        soruSiniri: OZEL_SORU_SINIRI,
        ozelEtiket: OZEL_SORU_ETIKETI,
      },
    };
  }

  /** Karneyi panelde ac — gorulme sayaci ARTMAZ (sayac karsi tarafin acmasini olcer) */
  @Get(':id/onizleme')
  async onizleme(@Req() req: Request, @Param('id') id: string) {
    assertAdmin(req);
    return this.karne.onizleme(id);
  }

  /** Yeni olcum — arka planda (4-6 dk); sonuc listeye duser */
  @Post()
  async baslat(
    @Req() req: Request,
    @Body()
    body: {
      brand?: string;
      host?: string;
      sektor?: string;
      altsektor?: string | null;
      sorular?: string | string[];
      rakipler?: string | string[];
      ayniGunOnay?: boolean;
    },
  ) {
    assertAdmin(req);
    const b = body ?? {};
    const rakipler = Array.isArray(b.rakipler)
      ? b.rakipler
      : typeof b.rakipler === 'string'
        ? b.rakipler.split(/[\s,;]+/).filter(Boolean)
        : [];
    return this.karne.baslat(
      {
        brand: String(b.brand ?? ''),
        host: String(b.host ?? ''),
        sektor: String(b.sektor ?? ''),
        altsektor: b.altsektor ?? null,
        sorular: sorulariAl(b.sorular),
        rakipler,
      },
      { ayniGunOnay: b.ayniGunOnay === true },
    );
  }

  /** Ayni sorularla yeniden olc (baska gun ikinci olcum) */
  @Post(':id/tekrar')
  async tekrar(@Req() req: Request, @Param('id') id: string, @Body() body: { ayniGunOnay?: boolean }) {
    assertAdmin(req);
    return this.karne.tekrarBaslat(id, { ayniGunOnay: body?.ayniGunOnay === true });
  }
}
