import * as cheerio from "cheerio";

/**
 * Icerik sayfasinin "alintilanabilirlik" sinyalleri (GEO yontemi v4). Saf.
 *
 * NEDEN: AI asistanlarinin kaynak gosterip cevaba kattigi sayfalarda en guclu
 * iliskili ozellikler sayfa SEKLI degil ICERIK BLOKLARI cikti. Her bulgu en az
 * iki bagimsiz kaynakla desteklendigi icin skora girdi (iki-kaynak kurali):
 *  - Rakam / istatistik: GEO Citation Lab (arXiv 2604.25707, 23.745 alinti;
 *    rakamli sayfa +%61,6 etki) + Aggarwal ve ark. GEO (KDD 2024; istatistik
 *    ekleme gorunurlugu artirdi).
 *  - Karsilastirma ve adim bloklari: GEO Citation Lab (+%55,3 / +%41,2) +
 *    presenc.ai bicim analizi (tablo/kisa cevap blogu ayni uzunlukta duz
 *    metne gore ~1,5 kat).
 *  - Uzunluk ve bolum sayisi: GEO Citation Lab (ust ceyrek ort. 1.943 kelime /
 *    10,6 baslik, alt ceyrek 170 kelime) + bagimsiz analizler (alintilanan
 *    sayfa medyani ~941 kelime; ort. ~2.290). Esik bu yuzden "uzun" degil
 *    "ince olmamak" (1.000 kelimede tam puan) — daha uzunu odullendirilmez.
 * Hepsi ILISKI; neden-sonuc degil. Puan siteye "su bloklar eksik" der, AI'in
 * siteyi alintilayacagini vaat etmez.
 */

export interface ContentSignals {
  /** 0..100 — rakam/istatistik (50) + karsilastirma (25) + adim (25) */
  evidenceScore: number;
  /** 0..100 — ana metin kelime sayisi (%70) + alt baslik sayisi (%30) */
  depthScore: number;
  /** Ham sayimlar: aciklama ve test icin */
  facts: number;
  hasComparison: boolean;
  hasSteps: boolean;
  words: number;
  sections: number;
}

// Sayi + birim/para/yuzde: "yuzde 40", "%12", "12,5%", "3.500 TL", "14 gun", "2 kat".
// Ciplak sayi (tarih, sayfa no, telefon) olgu sayilmaz — birim ister.
const UNIT = "(?:TL|₺|\\$|€|USD|EUR|milyon|milyar|bin|kat|kg|km|m²|m2|gün|gun|ay|yıl|yil|hafta|saat|dakika|saniye|kişi|kisi|adet|kullanıcı|kullanici|müşteri|musteri|sayfa|kelime|puan)";
// Sayi alternatifleri rakam dizisinin BASINA bagli ((?<![\\d.,])): capasiz \\d+
// uzun rakam dizisinde her konumdan yeniden tarayip karesel surer.
const FACT_RE = new RegExp(
  [
    "%\\s?\\d+(?:[.,]\\d+)?",
    "(?<![\\d.,])\\d+(?:[.,]\\d+)?\\s?%",
    "yüzde\\s+\\d+(?:[.,]\\d+)?",
    `(?<![\\d.,])\\d[\\d.,]*\\s?${UNIT}(?![\\p{L}])`,
  ].join("|"),
  "giu",
);

const COMPARE_RE = /karşılaştır|kıyasla|farkı nedir|farkları|\bvs\.?\s|\bversus\b|mı yoksa|mi yoksa/iu;
const STEP_HEADING_RE = /^\s*(?:\d+[.)]\s|adım\s*\d+|\d+\.\s*adım)/iu;

/** Ana metin: nav/header/footer/aside/form/script disarida; article > main > body. */
function mainContent($: cheerio.CheerioAPI) {
  const root = $("article").first().length ? $("article").first()
    : $("main").first().length ? $("main").first()
    : $("body").first();
  const clone = root.clone();
  clone.find("script, style, noscript, template, nav, header, footer, aside, form, svg").remove();
  return clone;
}

export function contentSignals($: cheerio.CheerioAPI): ContentSignals {
  const main = mainContent($);
  // Blok elemanlarin metni birbirine yapismasin ("Baslik12 TL") diye bosluk
  const text = main.find("*").addBack().contents().toArray()
    .filter((n) => n.type === "text")
    .map((n) => (n as unknown as { data: string }).data)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  const facts = (text.match(FACT_RE) ?? []).length;

  const tables = main.find("table").toArray();
  const comparisonTable = tables.some((t) => {
    const rows = $(t).find("tr").toArray();
    return rows.length >= 3 && rows.some((r) => $(r).children("th, td").length >= 3);
  });
  const hasComparison = comparisonTable || COMPARE_RE.test(text);

  const orderedSteps = main.find("ol").toArray().some((ol) => $(ol).children("li").length >= 3);
  const stepHeadings = main.find("h2, h3, h4").toArray()
    .filter((h) => STEP_HEADING_RE.test($(h).text())).length;
  const hasSteps = orderedSteps || stepHeadings >= 3;

  const evidenceScore = Math.min(50, facts * 10)
    + (comparisonTable ? 25 : hasComparison ? 10 : 0)
    + (hasSteps ? 25 : 0);

  const words = text ? text.split(" ").filter((w) => /\p{L}/u.test(w)).length : 0;
  const sections = main.find("h2, h3").length;
  const wordScore = words >= 1000 ? 100 : words >= 600 ? 70 : words >= 300 ? 40 : 0;
  const sectionScore = sections >= 6 ? 100 : sections >= 3 ? 60 : sections >= 1 ? 30 : 0;
  const depthScore = Math.round(wordScore * 0.7 + sectionScore * 0.3);

  return { evidenceScore, depthScore, facts, hasComparison, hasSteps, words, sections };
}

/** HTML metinden dogrudan (testler ve makale kapisi icin). */
export function contentSignalsFromHtml(html: string): ContentSignals {
  return contentSignals(cheerio.load(html));
}
