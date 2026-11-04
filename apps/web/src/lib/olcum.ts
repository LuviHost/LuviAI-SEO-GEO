/**
 * Olcum altyapisi (site + rakipler) — API sozlesmesi (apps/api/src/olcum) ve panel icin saf yardimcilar.
 * Test: olcum.spec.mts
 */

export type OlcumPlatformTur = 'etiket' | 'analitik' | 'reklam' | 'pazarlama';
export type OlcumKaynak = 'html' | 'js' | 'gtm';

export type OlcumPlatform = { kod: string; ad: string; tur: OlcumPlatformTur; kimlikler: string[]; kaynaklar: OlcumKaynak[] };
export type OlcumOlayDegeri = { tur: 'sabit'; sayi: number; para?: string } | { tur: 'dinamik' };
export type OlcumOlay = { ad: string; platform: string; tetikleyici?: string; deger?: OlcumOlayDegeri; kaynak: OlcumKaynak };
export type OlcumRaporu = {
  platformlar: OlcumPlatform[];
  olaylar: OlcumOlay[];
  gtm: Array<{ kimlik: string; etiketSayisi: number; duraklatilan: number; sunucuTarafli: boolean }>;
  sunucuTarafli: boolean;
};
export type OlcumBulgusu = { duzey: 'kritik' | 'uyari' | 'bilgi'; kod: string; metin: string };
export type OlcumHedef = {
  ad: string;
  url: string;
  rakip: boolean;
  durum: 'tamam' | 'olculemedi';
  neden?: string;
  rapor?: OlcumRaporu;
  bulgular?: OlcumBulgusu[];
  taranan?: { script: number; gtm: number; kesildi: boolean };
};
export type OlcumSonucu = {
  durum: 'calisiyor' | 'tamam';
  baslangic: string;
  bitis?: string;
  hedefler: OlcumHedef[];
  /** Rakipler sayfasinda 10'dan fazla rakip varsa taranmayanlar */
  atlananRakipler?: string[];
};

/** Olay platformlarinin panel adi (datalayer: GTM'e itilen ozel olay) */
export const PLATFORM_KISA: Record<string, string> = {
  ga4: 'GA4', google_ads: 'Google Ads', meta: 'Meta', linkedin: 'LinkedIn', tiktok: 'TikTok',
  openai_ads: 'ChatGPT reklamı', bing_uet: 'Microsoft Ads', x_ads: 'X', reddit: 'Reddit', pinterest: 'Pinterest',
  yandex: 'Yandex', datalayer: 'dataLayer',
};

const TUR_SIRA: OlcumPlatformTur[] = ['analitik', 'reklam', 'etiket', 'pazarlama'];
export const TUR_ADI: Record<OlcumPlatformTur, string> = { analitik: 'Analitik', reklam: 'Reklam', etiket: 'Etiket yönetimi', pazarlama: 'Pazarlama' };

/** Sayfa gorunumu / GTM ic olaylari donusum sayilmaz (api olcum-tespit.ts donusumOlayiMi ile ayni) */
const DONUSUM_DISI = /^(gtm\.|page_view$|pageview$|PageView$|page_viewed$|ViewContent$|user_engagement$|scroll$|session_start$|first_visit$|config$)/;
export const donusumOlaylari = (r: OlcumRaporu | undefined): OlcumOlay[] => (r?.olaylar ?? []).filter((o) => !DONUSUM_DISI.test(o.ad));

export type KarsilastirmaSatiri = { kod: string; ad: string; tur: OlcumPlatformTur; hucreler: Array<boolean | null> };

/**
 * Platform x hedef tablosu. Hucre: true kurulu, false gorunmuyor, null olculemedi (site okunamadi —
 * "yok" denmez). Satirlar: herhangi bir hedefte bulunan platformlar, ture gore gruplu; once musterinin sahip
 * olmadiklari (rakipte var, sizde yok) degil, sabit tur sirasi — tablo her taramada ayni duzende kalsin.
 */
export function karsilastirma(hedefler: OlcumHedef[]): KarsilastirmaSatiri[] {
  const satirlar = new Map<string, KarsilastirmaSatiri>();
  hedefler.forEach((h) => {
    for (const p of h.rapor?.platformlar ?? []) {
      if (!satirlar.has(p.kod)) satirlar.set(p.kod, { kod: p.kod, ad: p.ad, tur: p.tur, hucreler: [] });
    }
  });
  for (const s of satirlar.values()) {
    s.hucreler = hedefler.map((h) => (h.durum !== 'tamam' || !h.rapor ? null : h.rapor.platformlar.some((p) => p.kod === s.kod)));
  }
  const sira = [...satirlar.values()];
  return sira.sort((a, b) => TUR_SIRA.indexOf(a.tur) - TUR_SIRA.indexOf(b.tur));
}

/** "800 TRY (dosyada yazan)" / "dinamik" — birim ekonomisi diye sunulmaz */
export function degerMetni(d: OlcumOlayDegeri | undefined): string | null {
  if (!d) return null;
  if (d.tur === 'dinamik') return 'değer ödeme anında gönderiliyor';
  return `dosyada yazan değer: ${d.sayi.toLocaleString('tr-TR')}${d.para ? ` ${d.para}` : ''}`;
}

/** Rakipte olup sizde gorunmeyen reklam kanallari — sayfanin ust ozeti */
export function rakiptekiKanallar(hedefler: OlcumHedef[]): Array<{ ad: string; rakipler: string[] }> {
  const siz = hedefler.find((h) => !h.rakip);
  if (!siz || siz.durum !== 'tamam') return [];
  const sizde = new Set((siz.rapor?.platformlar ?? []).map((p) => p.kod));
  const out = new Map<string, { ad: string; rakipler: string[] }>();
  for (const h of hedefler) {
    if (!h.rakip || h.durum !== 'tamam') continue;
    for (const p of h.rapor?.platformlar ?? []) {
      if (p.tur !== 'reklam' || sizde.has(p.kod)) continue;
      const k = out.get(p.kod) ?? { ad: p.ad, rakipler: [] };
      k.rakipler.push(h.ad);
      out.set(p.kod, k);
    }
  }
  return [...out.values()];
}
