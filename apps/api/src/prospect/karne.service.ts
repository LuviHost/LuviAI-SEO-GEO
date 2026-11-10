import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { AiCitationService } from '../audit/ai-citation.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { karneOzeti, karneHtml, markaGecenSorular, type KarneOzet } from './karne-html.js';
import { sorulariGetir, altsektorAnahtari, sektorDogrula, ozelSorulariOku } from './karne-sorular.js';
import { normalizeDomain } from './prospect-utils.js';
import { COST_PER_PROBE_USD, isUnconfiguredProvider } from '../audit/citation-providers.js';
import type { Provider } from '../audit/ai-citation.service.js';

/** Randevu linki ayar anahtari — karne kapanisinda ve mesaj sablonlarinda kullanilir */
export const RANDEVU_AYAR_ANAHTARI = 'SATIS_RANDEVU_URL';

/** Ozel soru setinde sektor alani serbest etikettir; bos birakilirsa karnede bu yazar (CLI ile ayni). */
export const OZEL_SORU_ETIKETI = 'Özel soru seti';

/** Karneye girebilecek asistanlar (CLI SAGLAYICILAR ile ayni sira) — maliyet tahmini icin */
const KARNE_SAGLAYICILARI: Provider[] = ['anthropic', 'gemini', 'openai', 'perplexity', 'xai', 'deepseek', 'meta'];

/** Panelde tutulan son is sayisi (calisan + biten/hatali). Sunucu yeniden baslarsa liste bosalir. */
const IS_KAYDI_SINIRI = 20;

export interface KarneUretGirdi {
  brand: string;
  host: string;
  /** Soru bankasi icin sektor anahtari; `sorular` verilirse karnede gorunen serbest etiket */
  sektor: string;
  altsektor?: string | null;
  /**
   * Kuruma ozel sorular (satir satir yazilmis). Verilirse soru bankasi KULLANILMAZ.
   * NEDEN: banka uc tuketici sektorunu kapsar; ajans ya da BT entegratorune alan disi soru sorulursa
   * karne yanlis "hic gorunmuyorsunuz" der (Kasim 2026: BT entegratoru ve ajans karneleri bu yuzden terminalden ozel soruyla uretildi).
   */
  sorular?: string[] | null;
  rakipler?: string[];
  /** Hangi LinkedIn adayi icin uretildi (panelden uretimde dolu) */
  prospectId?: string | null;
  /** Soru sayisini kis (ucuz test) */
  limit?: number;
}

/** Panelden baslatilan karne olcumu (bellekte; olcum 4-6 dk surer, istek beklemez) */
export interface KarneIsi {
  id: string;
  brand: string;
  host: string;
  soruSayisi: number;
  durum: 'CALISIYOR' | 'HAZIR' | 'HATA';
  basladi: string;
  bitti?: string;
  hata?: string;
  karneId?: string;
}

/** Paneldeki karne satiri — ozet JSON'undan sayilar (html tasinmaz) */
export interface KarneSatiri {
  id: string;
  brand: string;
  host: string;
  sektor: string;
  altsektor: string | null;
  url: string;
  createdAt: Date;
  /** Ayni alan adinin kacinci olcumu (1 = ilk) */
  olcumNo: number;
  soruSayisi: number;
  olculenCevap: number;
  anilanCevap: number;
  atifCevap: number;
  hataliCevap: number;
  olculenSaglayici: number;
  anilanSaglayici: number;
  maliyetUsd: number;
  gorulmeSayisi: number;
  sonGorulmeAt: Date | null;
  /** LinkedIn adayindan uretildiyse firma adi */
  linkedinFirma: string | null;
}

/** TR (UTC+3, yaz saati yok) gununun baslangici — "ayni gun ikinci olcum" kontrolu icin */
export function trGunBasi(d: Date): Date {
  const TR = 3 * 3600_000;
  return new Date(Math.floor((d.getTime() + TR) / 86_400_000) * 86_400_000 - TR);
}

type Hazir = {
  brand: string;
  host: string;
  sektor: string;
  altsektorKayit: string | null;
  sorular: string[];
  rakipler: string[];
};

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
   *
   * Maliyet: olculen asistanlar (6 — Claude, Gemini, ChatGPT, Perplexity, Grok,
   * DeepSeek; Meta Llama yalniz GROQ_LLAMA_MODEL tanimliyken) x en fazla 10
   * soru. Probe basina TAVAN audit/citation-providers.ts COST_PER_PROBE_USD'de;
   * Ekim 2026 tablosuyla 10 soruda tavan ~2,7 USD (Claude 2 + Gemini 0,4 +
   * ChatGPT 0,3 + digerleri ~0,015), gercek tutar genelde daha dusuk. Harcama
   * `addCost` defterine yazilir (ai-citation.service).
   */
  /**
   * Girdiyi dogrula ve sorulacak sorulari cikar — PARA HARCAMADAN. Panel ayni kontrolu olcumu
   * baslatmadan once yapar ki hata (bilinmeyen sektor, 20'den fazla soru) aninda gorunsun.
   */
  private hazirla(girdi: KarneUretGirdi): Hazir {
    const brand = (girdi.brand ?? '').trim();
    if (brand.length < 4) throw new Error('Kurum adı en az 4 karakter olmalı (kısa ad metinde rastgele eşleşir)');
    const host = normalizeDomain(girdi.host);
    if (!host) throw new Error('Geçerli bir alan adı gerekli');

    let sektor: string;
    let altsektorKayit: string | null = null;
    let sorular: string[];
    const ozel = girdi.sorular?.length ? ozelSorulariOku(girdi.sorular.join('\n')) : null;
    if (ozel && ozel.length) {
      // Ozel soru setinde sektor yalniz karnedeki etikettir; soru secimine girmez (CLI --sorular-dosya ile ayni).
      sektor = (girdi.sektor ?? '').trim().slice(0, 64) || OZEL_SORU_ETIKETI;
      altsektorKayit = girdi.altsektor?.trim().slice(0, 64) || null;
      sorular = ozel;
    } else {
      const s = sektorDogrula(girdi.sektor);
      if (!s) throw new Error(`Bilinmeyen sektör: ${girdi.sektor}`);
      sektor = s;
      // altsektorAnahtari(sektor, altsektor): eskiden tek arguman (alt sektor
      // metni) veriliyordu; fonksiyon onu SEKTOR diye dogrulayip "Bilinmeyen
      // sektör" hatasi atiyordu — panelden alt sektorlu her karne uretimi
      // sessizce dusuyordu (intel.controller hatayi yalniz loglar).
      const altAnahtar = girdi.altsektor ? altsektorAnahtari(sektor, girdi.altsektor) : null;
      if (girdi.altsektor && !altAnahtar) {
        // CLI ile ayni uyari: eslesmeyen alt sektor genel sorulara duser
        this.log.warn(`Karne: alt sektör "${girdi.altsektor}" ${sektor} için eşleşmedi; genel sorular kullanılıyor.`);
      }
      altsektorKayit = altAnahtar ?? girdi.altsektor ?? null;
      sorular = sorulariGetir(sektor, girdi.altsektor ?? null);
    }

    // CLI ile ayni: kurum adi gecen soru skora girmez — sorulmaz, para harcanmaz.
    const markali = markaGecenSorular(sorular, brand, host);
    if (markali.length) {
      this.log.warn(`Karne: ${markali.length} soruda kurum adı geçiyor, sorulmayacak (${brand}).`);
      sorular = sorular.filter((q) => !markali.includes(q));
    }
    if (girdi.limit && girdi.limit > 0) sorular = sorular.slice(0, girdi.limit);
    if (!sorular.length) throw new Error('Sorulacak markasız soru kalmadı (sorularda kurum adı geçmemeli)');

    const rakipler = (girdi.rakipler ?? []).map((r) => normalizeDomain(r)).filter((r): r is string => !!r);
    return { brand, host, sektor, altsektorKayit, sorular, rakipler };
  }

  async uret(girdi: KarneUretGirdi): Promise<KarneKayit> {
    const { brand, host, sektor, altsektorKayit, sorular, rakipler } = this.hazirla(girdi);

    const basladi = Date.now();
    const sonuc = await this.citation.runPublicProbes({ brand, host, queries: sorular, competitors: rakipler });
    const sure = Math.round((Date.now() - basladi) / 1000);

    const ozet = karneOzeti({
      brand,
      host,
      sektor,
      altsektor: altsektorKayit ?? undefined,
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
        altsektor: altsektorKayit,
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

  // ── Panel: /admin/karneler ──────────────────────────────────────────────

  private readonly isler = new Map<string, KarneIsi>();
  private isSayac = 0;

  /** Son isler (en yeni once) — calisanlar ve hata verenler panelde gorunur */
  isListesi(): KarneIsi[] {
    return [...this.isler.values()].sort((a, b) => b.basladi.localeCompare(a.basladi));
  }

  /** Olculecek asistan sayisi ve soru basina maliyet TAVANI (gercek tutar genelde daha dusuk) */
  maliyetTahmini(): { saglayici: number; soruBasiTavanUsd: number } {
    const aktif = KARNE_SAGLAYICILARI.filter((p) => !isUnconfiguredProvider(p));
    return { saglayici: aktif.length, soruBasiTavanUsd: aktif.reduce((n, p) => n + COST_PER_PROBE_USD[p], 0) };
  }

  /**
   * Olcumu ARKA PLANDA baslat. Dogrulama hatasi ve kurallar burada, para harcanmadan:
   *  - ayni alan adi icin calisan olcum varken ikincisi baslamaz,
   *  - ayni TR gununde o alan adinin karnesi varsa `ayniGunOnay` ister. NEDEN: AI cevaplari gunden
   *    gune degisir; ikinci olcum BASKA GUN yapildiginda anlamli (iki-kaynak kurali). CLI'daki --force'un karsiligi.
   * Olcum 4-6 dk surer (Cloudflare 100 sn'de keser) → istek beklemez; sonuc listeye duser.
   */
  async baslat(
    girdi: KarneUretGirdi,
    secenek: { ayniGunOnay?: boolean } = {},
  ): Promise<{ started: true; is: KarneIsi } | { started: false; reason: string; ayniGun?: boolean }> {
    let h: Hazir;
    try {
      h = this.hazirla(girdi);
    } catch (e: any) {
      return { started: false, reason: String(e?.message ?? e) };
    }
    const calisan = this.isListesi().find((i) => i.durum === 'CALISIYOR' && i.host === h.host);
    if (calisan) return { started: false, reason: `${h.host} için ölçüm zaten sürüyor (${calisan.basladi.slice(11, 16)} UTC'de başladı)` };

    if (!secenek.ayniGunOnay) {
      const bugun = await this.prisma.prospectKarne.findFirst({
        where: { host: h.host, createdAt: { gte: trGunBasi(new Date()) } },
        select: { id: true },
      });
      if (bugun) {
        return {
          started: false,
          ayniGun: true,
          reason: `${h.host} bugün zaten ölçüldü. İkinci ölçüm başka bir günde yapıldığında anlamlı; yine de ölçmek için onaylayın.`,
        };
      }
    }

    const is: KarneIsi = {
      id: `is${Date.now().toString(36)}${(this.isSayac++).toString(36)}`,
      brand: h.brand,
      host: h.host,
      soruSayisi: h.sorular.length,
      durum: 'CALISIYOR',
      basladi: new Date().toISOString(),
    };
    this.isler.set(is.id, is);
    this.isKaydiniBuda();

    this.uret({ ...girdi, sorular: girdi.sorular?.length ? girdi.sorular : null })
      .then((k) => {
        is.durum = 'HAZIR';
        is.karneId = k.id;
      })
      .catch((err) => {
        is.durum = 'HATA';
        is.hata = String(err?.message ?? err).slice(0, 300);
        this.log.warn(`Panel karnesi üretilemedi (${h.brand} · ${h.host}): ${is.hata}`);
      })
      .finally(() => {
        is.bitti = new Date().toISOString();
      });
    return { started: true, is };
  }

  /** Ayni sorularla yeniden olc (ikinci gun olcumu). Banka soruyla uretilmis karne de AYNI sorularla olculur. */
  async tekrarBaslat(id: string, secenek: { ayniGunOnay?: boolean } = {}) {
    const k = await this.prisma.prospectKarne.findUnique({
      where: { id },
      select: { brand: true, host: true, sektor: true, altsektor: true, ozet: true, prospectId: true },
    });
    if (!k) throw new NotFoundException('Karne bulunamadı');
    const sorular = ((k.ozet as any)?.sorular ?? []).filter((s: unknown): s is string => typeof s === 'string' && !!s.trim());
    if (!sorular.length) return { started: false as const, reason: 'Bu karnede soru listesi kayıtlı değil' };
    return this.baslat(
      { brand: k.brand, host: k.host, sektor: k.sektor, altsektor: k.altsektor, sorular, prospectId: k.prospectId },
      secenek,
    );
  }

  /** Tum karneler (CLI ve panel uretimi) — html tasinmaz, sayilar ozetten */
  async adminListe(): Promise<KarneSatiri[]> {
    const rows = await this.prisma.prospectKarne.findMany({
      orderBy: { createdAt: 'desc' },
      take: 300,
      select: {
        id: true, token: true, brand: true, host: true, sektor: true, altsektor: true, ozet: true,
        maliyetUsd: true, gorulmeSayisi: true, sonGorulmeAt: true, createdAt: true,
        prospect: { select: { firma: true } },
      },
    });
    // Ayni alan adinin kacinci olcumu: eskiden yeniye say
    const sira = new Map<string, number>();
    const no = new Map<string, number>();
    for (const r of [...rows].reverse()) {
      const n = (sira.get(r.host) ?? 0) + 1;
      sira.set(r.host, n);
      no.set(r.id, n);
    }
    return rows.map((r) => {
      const o = (r.ozet ?? {}) as Partial<KarneOzet>;
      const t: Partial<KarneOzet['toplam']> = o.toplam ?? {};
      return {
        id: r.id,
        brand: r.brand,
        host: r.host,
        sektor: r.sektor,
        altsektor: r.altsektor,
        url: this.paylasimUrl(r.token),
        createdAt: r.createdAt,
        olcumNo: no.get(r.id) ?? 1,
        soruSayisi: Array.isArray(o.sorular) ? o.sorular.length : 0,
        olculenCevap: t.olculenCevap ?? 0,
        anilanCevap: t.anilanCevap ?? 0,
        atifCevap: t.atifCevap ?? 0,
        hataliCevap: t.hataliCevap ?? 0,
        olculenSaglayici: t.olculenSaglayici ?? 0,
        anilanSaglayici: t.anilanSaglayici ?? 0,
        maliyetUsd: r.maliyetUsd,
        gorulmeSayisi: r.gorulmeSayisi,
        sonGorulmeAt: r.sonGorulmeAt,
        linkedinFirma: r.prospect?.firma ?? null,
      };
    });
  }

  /**
   * Panel onizlemesi — GORULME SAYILMAZ. NEDEN: sayac "karsi taraf linki acti" sinyalidir; linki
   * kendimiz acinca sinyal bozuluyordu (kontrol icin link acilamiyordu).
   */
  async onizleme(id: string): Promise<{ brand: string; html: string }> {
    const k = await this.prisma.prospectKarne.findUnique({ where: { id }, select: { brand: true, html: true } });
    if (!k) throw new NotFoundException('Karne bulunamadı');
    return k;
  }

  private isKaydiniBuda() {
    const fazla = this.isler.size - IS_KAYDI_SINIRI;
    if (fazla <= 0) return;
    const bitenler = this.isListesi().filter((i) => i.durum !== 'CALISIYOR').reverse();
    for (const i of bitenler.slice(0, fazla)) this.isler.delete(i.id);
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
