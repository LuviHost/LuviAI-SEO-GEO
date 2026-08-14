import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/** Duzeltmeyi hangi servis uyguladi. */
export type FixKind = 'snippet' | 'static_html' | 'auto_fix';

export interface FixKaydi {
  siteId: string;
  userId?: string | null;
  kind: FixKind;
  fixType: string;
  target?: string | null;
  status?: 'APPLIED' | 'FAILED' | 'REVERTED';
  error?: string | null;
  detail?: Record<string, unknown> | null;
  adapter?: string | null;
}

/**
 * Uygulanan duzeltmelerin kaydi.
 *
 * NEDEN VAR: uc servis siteye gercek degisiklik yaziyordu ve hicbiri iz
 * birakmiyordu. Rapor "bu donemde N duzeltme uygulandi" diyemiyordu; deseydi
 * uydurma olurdu. Bu servis o boslugu kapatir.
 *
 * KAYIT HICBIR ZAMAN ISI DUSURMEZ: bir duzeltme siteye BASARIYLA uygulandiktan
 * sonra onu kaydedemezsek, kullaniciya hata dondurup "uygulanmadi" demek
 * gercege aykiri olurdu — degisiklik siteye zaten yazildi. Bu yuzden kayit
 * hatalari yutulur ve loglanir.
 */
@Injectable()
export class AppliedFixService {
  private readonly log = new Logger(AppliedFixService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Tek bir duzeltmeyi kaydeder. */
  async kaydet(k: FixKaydi): Promise<void> {
    try {
      await this.prisma.appliedFix.create({
        data: {
          siteId: k.siteId,
          userId: k.userId ?? null,
          kind: k.kind,
          fixType: k.fixType.slice(0, 48),
          target: k.target ?? null,
          status: k.status ?? 'APPLIED',
          error: k.error ?? null,
          detail: (k.detail ?? null) as any,
          adapter: k.adapter ?? null,
        },
      });
    } catch (err: any) {
      // Bilincli yutma — yukaridaki dosya yorumuna bak.
      this.log.warn(`Duzeltme kaydi yazilamadi (${k.kind}/${k.fixType}): ${err.message}`);
    }
  }

  /** Ayni islemde uygulanan birden fazla duzeltme. */
  async topluKaydet(kayitlar: FixKaydi[]): Promise<void> {
    if (!kayitlar.length) return;
    try {
      await this.prisma.appliedFix.createMany({
        data: kayitlar.map((k) => ({
          siteId: k.siteId,
          userId: k.userId ?? null,
          kind: k.kind,
          fixType: k.fixType.slice(0, 48),
          target: k.target ?? null,
          status: k.status ?? 'APPLIED',
          error: k.error ?? null,
          detail: (k.detail ?? null) as any,
          adapter: k.adapter ?? null,
        })),
      });
    } catch (err: any) {
      this.log.warn(`Toplu duzeltme kaydi yazilamadi (${kayitlar.length} kayit): ${err.message}`);
    }
  }

  /**
   * Donem ozeti — rapor bunu kullanir.
   *
   * YALNIZCA status='APPLIED' sayilir. Basarisiz denemeler ve geri alinanlar
   * "yapilan is" degildir; sayarsak rapor yine sisirilmis olur.
   */
  async donemOzeti(siteId: string, from: Date, to: Date) {
    const kayitlar = await this.prisma.appliedFix.findMany({
      where: { siteId, status: 'APPLIED', appliedAt: { gte: from, lte: to } },
      select: { kind: true, fixType: true, target: true },
    });

    const turBazinda = new Map<string, number>();
    const sayfalar = new Set<string>();
    for (const k of kayitlar) {
      turBazinda.set(k.fixType, (turBazinda.get(k.fixType) ?? 0) + 1);
      if (k.target) sayfalar.add(k.target);
    }

    const [basarisiz, geriAlinan] = await Promise.all([
      this.prisma.appliedFix.count({
        where: { siteId, status: 'FAILED', appliedAt: { gte: from, lte: to } },
      }),
      this.prisma.appliedFix.count({
        where: { siteId, status: 'REVERTED', appliedAt: { gte: from, lte: to } },
      }),
    ]);

    return {
      toplam: kayitlar.length,
      etkilenenSayfa: sayfalar.size,
      turBazinda: [...turBazinda.entries()]
        .map(([tur, adet]) => ({ tur, adet }))
        .sort((a, b) => b.adet - a.adet),
      basarisiz,
      geriAlinan,
    };
  }
}
