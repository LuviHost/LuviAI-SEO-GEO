/**
 * Musteri raporu (Site Raporu) — TEK JSON govdesi.
 *
 * NEDEN tek govde: ayni nesne panelde cizilir, PDF'e basilir ve paylasim
 * aninda oldugu gibi dondurulup (snapshot) herkese acik baglantida gosterilir.
 * Musteri "paylasilan neyse onu" gormeli; govde sonradan yeniden hesaplanmaz.
 *
 * KURAL: olculmeyen hicbir deger uydurulmaz. Bolum ya olculdu ya da
 * `{ olculemedi: true, neden }` tasir (analytics/site-report.service.ts
 * Olculebilir deseni). Sifir bir olcumdur; "veri yok" ile karistirilmaz.
 *
 * Web tarafindaki ayna tip: apps/web/src/lib/musteri-raporu.ts — alan
 * eklenirse ikisi birlikte guncellenir (surum alani bu yuzden var).
 */

/** Govde surumu — web eski snapshot'i tanisin diye */
export const MUSTERI_RAPORU_SURUM = 1;

export type Olculemedi = { olculemedi: true; neden: string };
export type Olculebilir<T> = ({ olculemedi: false } & T) | Olculemedi;

export type KontrolDurumu = 'gecti' | 'kritik' | 'uyari' | 'dogrulanamadi';
export type Onem = 'kritik' | 'uyari' | 'bilgi';
export type Etki = 'yuksek' | 'orta' | 'dusuk';
export type Efor = 'kolay' | 'orta' | 'zor';
/** AI cevabinda site: adresi kaynak gosterildi / yalniz marka adi gecti / hicbiri / olculemedi */
export type AiSonuc = 'alinti' | 'anilma' | 'yok' | 'olculemedi';

export interface RaporKpi {
  anahtar: 'siteSkoru' | 'aiGorunurluk' | 'anilmaOrani' | 'sesPayi' | 'aiBot' | 'yayinda';
  etiket: string;
  /** null = olculmedi; arayuz "—" + ipucu gosterir */
  deger: number | null;
  sonek: string | null;
  ipucu: string;
}

export interface RaporKontrol {
  id: string;
  ad: string;
  durum: KontrolDurumu;
  /** Dogrulanamayan kontrolde null (skora girmedi) */
  skor: number | null;
  /**
   * Rapor diliyle bulgu cumleleri (kontrolun butun sorunlari) ya da
   * dogrulanamama nedeni. Ham tarama metni DEGIL (client-report-texts.ts).
   */
  bulgu: string | null;
  neden: string;
  oneri: string;
  /** RanksUp bu sorunu yayin hedefi uzerinden otomatik duzeltebilir mi */
  otomatik: boolean;
}

/**
 * Bilgi amacli kontrol: "gecti" ya da "sorunlu" sayilmaz, sayaca girmez.
 * llms.txt (skora girmez) ve hic etiket bulunmayan sitede hreflang (kontrol
 * bir sey olcmedi — tek dilli sitede gerekmez).
 */
export interface RaporBilgiKontrolu {
  id: string;
  ad: string;
  not: string;
}

export interface RaporSayfaSorunu {
  tur: string;
  baslik: string;
  onem: Onem;
  /** Etkilenen birim sayisi; tarama sayiyi tutmadiysa null */
  sayi: number | null;
  birim: 'sayfa' | 'görsel' | 'başlık';
  /** En fazla 10 ornek adres */
  ornekler: string[];
  /** Ornekler hakkinda durust not (yoksa / kisitliysa nedeni) */
  ornekNotu: string | null;
  /** Sorunun rapor diliyle cumlesi (ham tarama metni degil) */
  aciklama: string;
}

export interface RaporSeo {
  taramaTarihi: string;
  siteSkoru: number | null;
  /** Son tarama denemesi engellendiyse skor guncel degil — neden */
  guncelDegil: string | null;
  sayac: { gecti: number; kritik: number; uyari: number; dogrulanamadi: number; toplam: number };
  bulgu: { toplam: number; kritik: number; uyari: number; bilgi: number };
  kontroller: RaporKontrol[];
  /** Sayac disi bilgi kontrolleri; 12.11.2026 oncesi paylasim kayitlarinda yok */
  bilgiKontrolleri?: RaporBilgiKontrolu[];
  sayfaSorunlari: RaporSayfaSorunu[];
  gorseller: Olculebilir<{
    icerikGorseli: number;
    altMetniYok: number;
    altMetniVar: number;
    susGorseli: number;
    supheli: number;
    sayfaSayisi: number;
    /** Sitede alt metni duzeltilip dogrulanan gorsel (envanter); envanter yoksa null */
    duzeltilen: number | null;
  }>;
  /** Taranamayan sayfa sayisi (erisim engeli) — puana girmedi */
  taranamayanSayfa: number;
}

export interface RaporGeo {
  taramaTarihi: string;
  /** Teknik GEO (AI arama) skoru; ornekler engellendiyse null + neden */
  geoSkoru: number | null;
  geoSkoruNotu: string | null;
  llmsTxt: 'var' | 'yok' | 'dogrulanamadi';
  sitemap: 'var' | 'yok' | 'dogrulanamadi';
  robots: Olculebilir<{
    dosya: boolean;
    sitemapSatiri: boolean;
    aramaBotlari: Array<{ ad: string; erisim: 'acik' | 'engelli' }>;
    egitimBotuEngelli: string[];
  }>;
  schema: Olculebilir<{ sayfa: number; toplam: number; oran: number }>;
  sinyaller: Array<{ id: string; ad: string; skor: number }>;
  ajanHazirligi: Olculebilir<{ skor: number | null; tarih: string | null }>;
}

export interface RaporAiAsistan {
  saglayici: string;
  ad: string;
  skor: number | null;
  sonuc: AiSonuc;
  alintiSayisi: number;
  anilmaSayisi: number;
  /** Skora giren YANIT sayisi (soru × tekrar) — ad tarihsel, soru sayisi degil */
  olculenSoru: number;
  /** Skora giren (markasiz) farkli soru sayisi; eski paylasim kayitlarinda yok */
  soruSayisi?: number;
  /** En az bir yanitinda sitenin kaynak gosterildigi soru sayisi */
  alintiSoru?: number;
  /** Hic kaynak gosterilmeyen ama en az bir yanitinda marka adi gecen soru sayisi */
  anilmaSoru?: number;
  neden: string | null;
}

export interface RaporAiSorgu {
  soru: string;
  /** Marka adini iceren soru — skora girmez */
  markali: boolean;
  /** Asistan sirasiyla (asistanlar dizisi) sonuc — o sorunun TUM yanitlarinin ozeti */
  sonuclar: AiSonuc[];
  /** Asistan sirasiyla: gecerli yanit sayisi ve kacinda kaynak / yalniz marka adi; eski kayitlarda yok */
  ayrinti?: Array<{ yanit: number; alinti: number; anilma: number }>;
}

export interface RaporAi {
  olcum: Olculebilir<{
    tarih: string;
    skor: number | null;
    /**
     * 'rolling' = son 7 olcum gunu ortalamasi, 'first-run' = ilk olcum
     * (panel mansetiyle ayni kaynak), 'son-olcum' = mansette seri yokken
     * en son kayitli olcumun asistan ortalamasi.
     */
    skorTuru: 'rolling' | 'first-run' | 'son-olcum';
    asistanlar: RaporAiAsistan[];
    sorgular: RaporAiSorgu[];
    /** Bir sorunun bir asistana en fazla kac kez soruldugu (1 = tek tur); eski kayitlarda yok */
    tekrar?: number;
  }>;
  anilmaOrani: Olculebilir<{ deger: number; markasizOlcum: number }>;
  sesPayi: Olculebilir<{ deger: number }>;
  rakipler: {
    tanimli: string[];
    sesPayiListesi: Olculebilir<{ liste: Array<{ ad: string; anilma: number; yuzde: number; marka: boolean }> }>;
  };
  yontemNotu: string;
}

export interface RaporAksiyon {
  baslik: string;
  aciklama: string | null;
  etki: Etki;
  efor: Efor | null;
  kaynak: 'plan' | 'tarama';
  durum: 'todo' | 'in_progress';
}

export interface MusteriRaporu {
  surum: typeof MUSTERI_RAPORU_SURUM;
  generatedAt: string;
  site: { ad: string; url: string; host: string };
  /** Her bolumun dayandigi verinin tarihi — musteri bayatligi gorebilsin */
  kaynaklar: {
    tarama: string | null;
    aiOlcum: string | null;
    aiOranlari: { baslangic: string; bitis: string };
    botZiyaret: { baslangic: string; bitis: string };
    ajanHazirligi: string | null;
  };
  ozet: { kpiler: RaporKpi[]; metin: string[] };
  seo: Olculebilir<RaporSeo>;
  geo: Olculebilir<RaporGeo>;
  ai: RaporAi;
  /** IP'si dogrulanmis bot ziyareti; dogrulanamayan30 = taklit olabilecek istek (varsa) */
  botlar: Olculebilir<{ son7: number; son30: number; dogrulanamayan30?: number; botlar: Array<{ ad: string; ziyaret: number }> }>;
  icerik: { yayinda: number; takvimde: number };
  aksiyonlar: RaporAksiyon[];
  yontem: string[];
}
