/**
 * Musteri raporu (Site Raporu) — panel ve herkese acik sayfanin ortak tipleri
 * ve saf yardimcilari.
 *
 * Govde API'de derlenir (apps/api/src/client-report/client-report.types.ts);
 * buradaki tip onun aynasidir — alan eklenirse ikisi birlikte guncellenir.
 * Panel govdeyi YENIDEN HESAPLAMAZ: olculmeyen alan API'den
 * `{ olculemedi: true, neden }` gelir ve oldugu gibi "Henüz ölçülmedi" yazilir.
 */

export type Olculemedi = { olculemedi: true; neden: string };
export type Olculebilir<T> = ({ olculemedi: false } & T) | Olculemedi;

export type KontrolDurumu = 'gecti' | 'kritik' | 'uyari' | 'dogrulanamadi';
export type Onem = 'kritik' | 'uyari' | 'bilgi';
export type Etki = 'yuksek' | 'orta' | 'dusuk';
export type Efor = 'kolay' | 'orta' | 'zor';
export type AiSonuc = 'alinti' | 'anilma' | 'yok' | 'olculemedi';

export interface RaporKpi {
  anahtar: 'siteSkoru' | 'aiGorunurluk' | 'anilmaOrani' | 'sesPayi' | 'aiBot' | 'yayinda';
  etiket: string;
  deger: number | null;
  sonek: string | null;
  ipucu: string;
}

export interface RaporKontrol {
  id: string;
  ad: string;
  durum: KontrolDurumu;
  skor: number | null;
  bulgu: string | null;
  neden: string;
  oneri: string;
  otomatik: boolean;
}

export interface RaporSayfaSorunu {
  tur: string;
  baslik: string;
  onem: Onem;
  sayi: number | null;
  birim: 'sayfa' | 'görsel' | 'başlık';
  ornekler: string[];
  ornekNotu: string | null;
  aciklama: string;
}

export interface RaporSeo {
  taramaTarihi: string;
  siteSkoru: number | null;
  guncelDegil: string | null;
  sayac: { gecti: number; kritik: number; uyari: number; dogrulanamadi: number; toplam: number };
  bulgu: { toplam: number; kritik: number; uyari: number; bilgi: number };
  kontroller: RaporKontrol[];
  sayfaSorunlari: RaporSayfaSorunu[];
  gorseller: Olculebilir<{
    icerikGorseli: number;
    altMetniYok: number;
    altMetniVar: number;
    susGorseli: number;
    supheli: number;
    sayfaSayisi: number;
    duzeltilen: number | null;
  }>;
  taranamayanSayfa: number;
}

export interface RaporGeo {
  taramaTarihi: string;
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
  olculenSoru: number;
  neden: string | null;
}

export interface RaporAi {
  olcum: Olculebilir<{
    tarih: string;
    skor: number | null;
    skorTuru: 'rolling' | 'first-run' | 'son-olcum';
    asistanlar: RaporAiAsistan[];
    sorgular: Array<{ soru: string; markali: boolean; sonuclar: AiSonuc[] }>;
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
  surum: 1;
  generatedAt: string;
  site: { ad: string; url: string; host: string };
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
  botlar: Olculebilir<{ son7: number; son30: number; botlar: Array<{ ad: string; ziyaret: number }> }>;
  icerik: { yayinda: number; takvimde: number };
  aksiyonlar: RaporAksiyon[];
  yontem: string[];
}

export interface PaylasimOzeti {
  token: string;
  yol: string;
  olusturuldu: string;
  sonGecerlilik: string;
}

export interface PaylasilanRapor {
  rapor: MusteriRaporu;
  paylasim: { olusturuldu: string; sonGecerlilik: string };
}

// ─── Bolumler (yazdirma sirasi) ─────────────────────────────────────

export type BolumId = 'kapak' | 'ozet' | 'seo' | 'geo' | 'ai' | 'aksiyon' | 'yontem';

export interface RaporBolumu {
  id: BolumId;
  baslik: string;
  /** Bolumun dayandigi verinin tarihi (ISO); kapak/yontemde null */
  veriTarihi: string | null;
  /** Kagitta bu bolum yeni sayfadan baslar */
  yeniSayfa: boolean;
}

/**
 * Raporun bolumleri — ekran ve kagit AYNI sirayi kullanir. Olculmeyen bolum
 * de listelenir (icinde "Henüz ölçülmedi" yazar): musteri eksik olcumu
 * gormeli, bolumun sessizce kaybolmasi "sorun yok" diye okunur.
 * Kapak ilk sayfadir; sonraki her ana bolum yeni sayfadan baslar.
 */
export function raporBolumleri(r: MusteriRaporu): RaporBolumu[] {
  return [
    { id: 'kapak', baslik: 'Kapak', veriTarihi: null, yeniSayfa: false },
    { id: 'ozet', baslik: 'Yönetici özeti', veriTarihi: r.generatedAt, yeniSayfa: true },
    { id: 'seo', baslik: 'SEO bulguları', veriTarihi: r.kaynaklar.tarama, yeniSayfa: true },
    { id: 'geo', baslik: 'GEO ve AI hazırlığı', veriTarihi: r.kaynaklar.tarama, yeniSayfa: true },
    { id: 'ai', baslik: 'AI görünürlük', veriTarihi: r.kaynaklar.aiOlcum, yeniSayfa: true },
    { id: 'aksiyon', baslik: 'Öncelikli aksiyonlar', veriTarihi: r.generatedAt, yeniSayfa: true },
    { id: 'yontem', baslik: 'Yöntem ve notlar', veriTarihi: null, yeniSayfa: true },
  ];
}

// ─── Bicim ──────────────────────────────────────────────────────────

const AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
/** Turkiye sabit UTC+3: sunucu (SSR) ve tarayici ayni tarihi yazsin, hidrasyon farki olmasin */
const TR_OFFSET_MS = 3 * 3_600_000;

/** "22 Ekim 2026" — Istanbul saatine gore, tarayici diline bagli degil */
export function trTarih(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(Date.parse(iso) + TR_OFFSET_MS);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getUTCDate()} ${AYLAR[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Binlik ayiricili tam sayi / tek ondalikli sayi, Turkce: 1.040 · 33,3 */
export function trSayi(n: number): string {
  const yuvarli = Math.round(n * 10) / 10;
  const [tam, ondalik] = String(Math.abs(yuvarli)).split('.');
  const binlik = tam.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${yuvarli < 0 ? '−' : ''}${binlik}${ondalik ? `,${ondalik}` : ''}`;
}

/** KPI kutusunun gorunen degeri: olculmeyen "—" (sifir degil) */
export function kpiMetni(k: Pick<RaporKpi, 'deger' | 'sonek'>): { deger: string; sonek: string | null } {
  if (k.deger === null) return { deger: '—', sonek: null };
  if (k.sonek === '%') return { deger: `%${trSayi(k.deger)}`, sonek: null };
  return { deger: trSayi(k.deger), sonek: k.sonek };
}

export const DURUM_ETIKETI: Record<KontrolDurumu, string> = {
  gecti: 'Geçti',
  kritik: 'Kritik',
  uyari: 'Uyarı',
  dogrulanamadi: 'Doğrulanamadı',
};

export const ONEM_ETIKETI: Record<Onem, string> = { kritik: 'Kritik', uyari: 'Uyarı', bilgi: 'Bilgi' };
export const ETKI_ETIKETI: Record<Etki, string> = { yuksek: 'Yüksek etki', orta: 'Orta etki', dusuk: 'Düşük etki' };
export const EFOR_ETIKETI: Record<Efor, string> = { kolay: 'Kolay', orta: 'Orta efor', zor: 'Zor' };

export const AI_SONUC_ETIKETI: Record<AiSonuc, string> = {
  alinti: 'Kaynak gösterildi',
  anilma: 'Marka anıldı',
  yok: 'Görünmedi',
  olculemedi: 'Ölçülemedi',
};

export function skorTuruMetni(t: 'rolling' | 'first-run' | 'son-olcum'): string {
  return t === 'rolling' ? 'Son 7 ölçüm gününün ortalaması' : t === 'first-run' ? 'İlk ölçüm' : 'Son ölçüm';
}

/** Ton: skor bandi (panel scoreTone ile ayni esikler) */
export function skorTonu(s: number | null): 'success' | 'warning' | 'danger' | 'muted' {
  if (s === null) return 'muted';
  return s >= 80 ? 'success' : s >= 50 ? 'warning' : 'danger';
}

/** Ornek listesinde gosterilmeyen kalan adet ("ve 14 sayfa daha") */
export function kalanOrnek(s: Pick<RaporSayfaSorunu, 'sayi' | 'ornekler' | 'birim'>): number {
  if (s.sayi === null || s.birim !== 'sayfa') return 0;
  return Math.max(0, s.sayi - s.ornekler.length);
}

// ─── Paylasim ───────────────────────────────────────────────────────

/** API ile ayni desen (client-report-share.ts RAPOR_TOKEN_DESENI) — sayfa DB'ye gitmeden 404 */
export const RAPOR_TOKEN_DESENI = /^[A-Za-z0-9_-]{32,64}$/;

export function gecerliRaporTokeni(token: unknown): token is string {
  return typeof token === 'string' && RAPOR_TOKEN_DESENI.test(token);
}

/** Musteriye gidecek tam adres — panelin kendi kokeni */
export function paylasimAdresi(origin: string, p: Pick<PaylasimOzeti, 'token'>): string {
  return `${origin.replace(/\/+$/, '')}/rapor/${p.token}`;
}

/** Kalan gun (yukari yuvarlanir); suresi dolduysa 0 */
export function kalanGun(sonGecerlilik: string, simdi: number): number {
  const ms = Date.parse(sonGecerlilik) - simdi;
  return ms > 0 ? Math.ceil(ms / 86_400_000) : 0;
}

/** Paylasim suresi secenekleri (gun) — API 1..90 araligina sikistirir */
export const PAYLASIM_GUNLERI = [7, 30, 90] as const;
export const VARSAYILAN_PAYLASIM_GUNU = 30;
