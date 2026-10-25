/**
 * /rehber icerik modeli. Makaleler bu tiplerle yazilan saf veri modulleridir; tek bir
 * sunucu bileseni (components/rehber/rehber-article.tsx) hepsini ayni duzende basar.
 *
 * Satir ici bicim (yalniz `text` / `items` / tablo hucreleri): `[metin](/yol)` baglanti,
 * `**metin**` kalin. SSS cevaplari DUZ METINDIR: FAQPage JSON-LD'si gorunur metinle
 * birebir ayni olmali (lib/rehber.spec.mts denetler).
 *
 * `kaynak`: blogun dayandigi kaynaklarin `sources[].id` degerleri. Para tutari ($, €, TL,
 * ₺) iceren her blok kaynak tasimak ZORUNDA; bilesen kaynagi blogun hemen altinda
 * "Kaynak: … (erişim …)" satiri olarak gosterir.
 *
 * Next importu yok — spec'ler bu dosyalari dogrudan calistirir.
 */

export type RehberBlock =
  | { t: 'p'; text: string; kaynak?: string[] }
  | { t: 'ul' | 'ol'; items: string[]; kaynak?: string[] }
  | { t: 'h3'; text: string }
  | { t: 'table'; caption: string; head: string[]; rows: string[][]; kaynak?: string[]; not?: string }
  | { t: 'code'; label: string; code: string }
  | { t: 'callout'; title: string; text: string; kaynak?: string[] }
  /** Sayfaya gomulu ucretsiz AI gorunurluk testi (landing ile ayni form, ayni haftalik hak) */
  | { t: 'tool'; title: string; text: string };

export interface RehberSection {
  /** Baglanti capasi (kucuk harf, tire) */
  id: string;
  /** Soru bicimli H2 */
  h2: string;
  blocks: RehberBlock[];
}

export interface RehberSource {
  /** Bloklarin `kaynak` alaninda kullanilan kisa anahtar */
  id: string;
  title: string;
  publisher: string;
  /** Birinci taraf olcumlerde (RanksUp, Search Console, Cloudflare paneli) URL yok */
  url?: string;
  /** URL'li kaynakta zorunlu: erisim (kontrol) tarihi, YYYY-MM-DD */
  accessed?: string;
  /** Birinci taraf veride donem ve yontem */
  note?: string;
}

export interface RehberFaq {
  q: string;
  a: string;
}

export interface RehberArticle {
  /** URL parcasi: /rehber/<slug>; app/(marketing)/rehber/<slug>/page.tsx ile ayni */
  slug: string;
  /** H1 = sayfanin cevapladigi tek soru */
  title: string;
  /** <title> (sablon ' · RanksUp' ekler; toplam ≤ 60 karakter) */
  metaTitle: string;
  /** Meta aciklama, ≤ 155 karakter */
  description: string;
  /** Rehber listesinde ve rozet satirinda gorunen kisa konu adi */
  topic: string;
  /** Ilk paragraf. Ilk cumlesi dogrudan cevap, ≤ 25 kelime */
  answer: string;
  /** "Hızlı cevap" kutusu maddeleri */
  quick: string[];
  sections: RehberSection[];
  /** Gorunur SSS (5-8 soru); FAQPage JSON-LD bu listeden uretilir */
  faq: RehberFaq[];
  sources: RehberSource[];
  /** Ilgili rehber slug'lari */
  related: string[];
  /** Ilk yayin tarihi, YYYY-MM-DD. Son guncelleme lib/page-updated.ts'te (tek kaynak). */
  published: string;
  schemaType: 'Article' | 'TechArticle';
}
