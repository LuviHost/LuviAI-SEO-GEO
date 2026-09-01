import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { AiCitationService } from '../audit/ai-citation.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { karneOzeti, karneHtml, type KarneOzet } from './karne-html.js';
import { sorulariGetir, altsektorAnahtari, sektorDogrula } from './karne-sorular.js';
import { normalizeDomain } from './prospect-utils.js';

/** Randevu linki ayar anahtari — karne kapanisinda ve mesaj sablonlarinda kullanilir */
export const RANDEVU_AYAR_ANAHTARI = 'SATIS_RANDEVU_URL';

export interface KarneUretGirdi {
  brand: string;
  host: string;
  sektor: string;
  altsektor?: string | null;
  rakipler?: string[];
  /** Hangi LinkedIn adayi icin uretildi (panelden uretimde dolu) */
  prospectId?: string | null;
  /** Soru sayisini kis (ucuz test) */
  limit?: number;
}

export interface KarneKayit {
  id: string;
  token: string;
  url: string;
  ozet: KarneOzet;
}

/**
 * Ucretsiz "AI gorunurluk karnesi" uretimi — CLI ve panel AYNI yolu kullanir.
 *
 * NEDEN servis: karne bugune kadar yalnizca CLI'daydi ve ciktisi yerel dosyaydi; "olur" diyen
 * kisiye elle uretilip elle gonderiliyordu (01.09.2026 tespiti). Panelden tek tikla uretip
 * paylasilabilir link vermek icin mantik tek yerde toplandi.
 *
 * Metodoloji CLI ile birebir ayni: markasiz sorular (marka gecen soru elenir), hatali probe
 * olcum sayilmaz, tek kosum = anlik goruntu. Bu kurallar `karne-html.ts` ve `brand-in-query.ts`
 * icinde; burada tekrar edilmez.
 */
@Injectable()
export class KarneService {
  private readonly log = new Logger(KarneService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly citation: AiCitationService,
    private readonly settings: SettingsService,
  ) {}

  /** Panelde/mesajda kullanilacak randevu linki (bos ise cumle sablondan duser) */
  async randevuUrl(): Promise<string | null> {
    try {
      const s = (await this.settings.getString(RANDEVU_AYAR_ANAHTARI)).trim();
      return s && /^https?:\/\//i.test(s) ? s : null;
    } catch {
      return null;
    }
  }

  /**
   * Olcumu kos, karneyi uret ve DB'ye kaydet. Paylasim linki doner.
   * Maliyet: 7 asistan x 10 soru ~ $0,32; `addCost` defterine yazilir (ai-citation.service).
   */
  async uret(girdi: KarneUretGirdi): Promise<KarneKayit> {
    const brand = girdi.brand.trim();
    if (brand.length < 4) throw new Error('Kurum adı en az 4 karakter olmalı (kısa ad metinde rastgele eşleşir)');
    const host = normalizeDomain(girdi.host);
    if (!host) throw new Error('Geçerli bir alan adı gerekli');
    const sektor = sektorDogrula(girdi.sektor);
    if (!sektor) throw new Error(`Bilinmeyen sektör: ${girdi.sektor}`);

    const altAnahtar = girdi.altsektor ? altsektorAnahtari(girdi.altsektor) : null;
    let sorular = sorulariGetir(sektor, altAnahtar ?? undefined);
    if (girdi.limit && girdi.limit > 0) sorular = sorular.slice(0, girdi.limit);

    const rakipler = (girdi.rakipler ?? []).map((r) => normalizeDomain(r)).filter((r): r is string => !!r);

    const basladi = Date.now();
    const sonuc = await this.citation.runPublicProbes({ brand, host, queries: sorular, competitors: rakipler });
    const sure = Math.round((Date.now() - basladi) / 1000);

    const ozet = karneOzeti({
      brand,
      host,
      sektor,
      altsektor: altAnahtar ?? girdi.altsektor ?? undefined,
      sorular,
      saglayicilar: sonuc,
      rakipler,
      tarih: new Date(),
    });
    const html = karneHtml(ozet, { randevuUrl: await this.randevuUrl() });

    // NEDEN 24 bayt: tahmin edilemez olmali (link tek koruma; sayfa noindex ve listelenmez)
    const token = randomBytes(24).toString('base64url');
    const kayit = await this.prisma.prospectKarne.create({
      data: {
        token,
        brand,
        host,
        sektor,
        altsektor: altAnahtar ?? girdi.altsektor ?? null,
        ozet: ozet as unknown as object,
        html,
        prospectId: girdi.prospectId ?? null,
        cagriSayisi: ozet.cagriSayisi,
        maliyetUsd: ozet.maliyetUsd,
      },
      select: { id: true, token: true },
    });

    this.log.log(`Karne üretildi: ${brand} (${host}) · ${ozet.cagriSayisi} çağrı · $${ozet.maliyetUsd.toFixed(4)} · ${sure} sn`);
    return { id: kayit.id, token: kayit.token, url: this.paylasimUrl(kayit.token), ozet };
  }

  paylasimUrl(token: string): string {
    const base = (process.env.WEB_BASE_URL ?? 'https://ranksup.ai').replace(/\/+$/, '');
    return `${base}/karne/${token}`;
  }

  /**
   * Paylasim sayfasi icin karneyi getir ve GORULME say. NEDEN sayac: karsi taraf linki actiysa
   * bu sicak bir sinyal — panelde gorulur, takip zamanlamasi ona gore yapilir.
   */
  async getirVeSay(token: string): Promise<{ brand: string; html: string }> {
    const k = await this.prisma.prospectKarne.findUnique({
      where: { token },
      select: { id: true, brand: true, html: true },
    });
    if (!k) throw new NotFoundException('Karne bulunamadı');
    await this.prisma.prospectKarne
      .update({ where: { id: k.id }, data: { gorulmeSayisi: { increment: 1 }, sonGorulmeAt: new Date() } })
      .catch(() => undefined);
    return { brand: k.brand, html: k.html };
  }

  /** Bir adaya ait karneler (panelde link + goruntulenme gostermek icin) */
  async prospectKarneleri(prospectId: string) {
    const rows = await this.prisma.prospectKarne.findMany({
      where: { prospectId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, token: true, host: true, gorulmeSayisi: true, sonGorulmeAt: true, createdAt: true },
    });
    return rows.map((r) => ({ ...r, url: this.paylasimUrl(r.token) }));
  }
}
