/**
 * Ucretsiz test — sonucu gormek icin e-posta zorunlu (27.11.2026, sahip: "ilk taramayi yapan kisi
 * sonucu gormek icin mail adresini yazmak zorunda olsun, iletisim saglayamiyoruz").
 *
 * Akis: tarayici POST /public/citation-check → olcum yapilir, sonuc ISTEMCIYE GONDERILMEZ; yalniz
 * alan adi, marka ve kac soru / asistan olculdugu ile tek kullanimlik olmayan bir `anahtar` doner.
 * Ziyaretci e-postasini yazinca POST /public/citation-check/ac sonucu doner ve adres deneme kaydina
 * (/admin/leads) yazilir. SEO analizi (public-seo-analysis.service.ts) ile ayni kural: ekranda
 * gizlemek degil, veri hic gonderilmez — devtools'tan okunamaz.
 *
 * Sonuc surec belleginde tutulur (pm2 tek surec, fork — ecosystem.config.cjs). Yeniden baslatmada
 * kaybolur: ziyaretci "testi yeniden baslat" der, ayni alan adi 24 saat onbellekten doner (olcum
 * ve maliyet yok). Bu yuzden veritabanina sonuc kopyasi yazilmaz.
 *
 * Mobil uygulama (RanksUp-iOS/Android) bu kapiya girmez: uygulamanin kendi akisi var.
 */
import { randomBytes } from 'node:crypto';

/** Kilitli sonucun bellekte kalma suresi */
export const KAPI_SURE_MS = 2 * 60 * 60 * 1000;
/** Bellekte en fazla kac sonuc (en eskisi atilir) */
export const KAPI_TAVAN = 500;
/** IP basina 24 saatte e-posta ile acma denemesi */
export const KAPI_IP_GUNLUK = 20;

export const KAPI_EPOSTA_MESAJI = 'Geçerli bir e-posta adresi yazın.';
export const KAPI_SURESI_DOLDU_MESAJI = 'Sonucun süresi doldu. Testi yeniden başlatın.';

/** E-posta dogrulama (SEO analiziyle ayni kural); gecersizse null */
export function kapiEposta(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const e = input.trim().toLowerCase();
  if (e.length < 6 || e.length > 191) return null;
  return /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/.test(e) ? e : null;
}

export function yeniKapiAnahtari(): string {
  return randomBytes(24).toString('hex');
}

/** Kilitli cevapta istemciye giden ozet */
export interface KapiOzeti {
  anahtar: string;
  /** Olculen (kilitsiz) soru sayisi */
  soru: number;
  /** Olculen asistan sayisi (sorulardaki en genis kume) */
  asistan: number;
}

interface SonucBenzeri {
  queries: Array<{ locked?: boolean; providers?: Array<{ provider: string }> }>;
  competitorRanking?: unknown[];
}

/**
 * Sonucun kilitli kopyasi: sorular ve rakip tablosu BOS, `kilit` ozeti dolu. Alan adi, marka, nis,
 * access, onbellek bilgisi kalir (arayuz basligi ve "N soru, M asistan" cumlesi icin).
 */
export function kilitliSonuc<T extends SonucBenzeri>(sonuc: T, anahtar: string): T & { kilit: KapiOzeti } {
  const acik = (sonuc.queries ?? []).filter((q) => q?.locked !== true);
  const asistanlar = new Set<string>();
  for (const q of acik) for (const p of q.providers ?? []) asistanlar.add(p.provider);
  return {
    ...sonuc,
    queries: [],
    competitorRanking: [],
    kilit: { anahtar, soru: acik.length, asistan: asistanlar.size },
  };
}

interface KasaKaydi<T> {
  sonuc: T;
  domain: string;
  ipHash: string;
  son: number;
}

/** Anahtar → sonuc; sure ve tavanla sinirli surec belleği */
export class SonucKasasi<T> {
  private readonly kayitlar = new Map<string, KasaKaydi<T>>();

  constructor(
    private readonly sureMs = KAPI_SURE_MS,
    private readonly tavan = KAPI_TAVAN,
    private readonly simdi: () => number = Date.now,
  ) {}

  koy(anahtar: string, kayit: Omit<KasaKaydi<T>, 'son'>): void {
    this.temizle();
    // Map ekleme sirasini korur: tavan dolunca en eski atilir
    while (this.kayitlar.size >= this.tavan) {
      const ilk = this.kayitlar.keys().next().value;
      if (ilk === undefined) break;
      this.kayitlar.delete(ilk);
    }
    this.kayitlar.set(anahtar, { ...kayit, son: this.simdi() + this.sureMs });
  }

  al(anahtar: string): Omit<KasaKaydi<T>, 'son'> | null {
    const k = this.kayitlar.get(anahtar);
    if (!k) return null;
    if (k.son <= this.simdi()) {
      this.kayitlar.delete(anahtar);
      return null;
    }
    return { sonuc: k.sonuc, domain: k.domain, ipHash: k.ipHash };
  }

  get boyut(): number {
    return this.kayitlar.size;
  }

  private temizle(): void {
    const t = this.simdi();
    for (const [a, k] of this.kayitlar) if (k.son <= t) this.kayitlar.delete(a);
  }
}
