/**
 * Deterministik GEO kapısı.
 *
 * Neden var: prompt'lardaki GEO kuralları (soru H2, "Kısa cevap" blockquote,
 * tablo, son güncelleme, kaynaklı sayı) doğru yazılmıştı ama HİÇ ÖLÇÜLMÜYORDU.
 * Yayındaki 116 rehberde ölçüm şunu gösterdi: soru formatlı H2 %27,6 (104/377),
 * tablo 9, blockquote 0, "Kısa cevap" 3, "Son güncelleme" 0. Yani kural
 * yayın katmanında silinmiyor — üretimde hiç yazılmamış.
 *
 * Bu modül LLM'e sormaz, metni ölçer. Editör "PASS" dese bile kapı geçilmeden
 * makale PASS sayılmaz; bulgular editöre madde madde geri verilir.
 *
 * KASITLI OLARAK YOK: kelime sayısı eşiği. 03-writer prompt'u (index.ts "Uzunluk"
 * bölümü) sert kelime hedefini bilerek yasakladı; sayı tutturma baskısı modeli
 * dolgu metne iter, bilgi yoğunluğunu düşürür.
 *
 * ÖNEM DERECESİ: 'block' bulgular PASS'i engeller (editör turu revizyona düşer);
 * 'warn' bulgular engellemez, yalnız revizyon turunda editöre öneri olarak gider.
 * Uzun cümle ve yazar satırı 'warn' — bugün geçen makaleyi bu yüzden durdurmuyoruz.
 * TEMPLATE_STRUCTURE yalnız rehber DIŞI içerik tipinde ölçülür; tip açık seçim ya da
 * sıralayıcı kararıysa 'block', başlık sınıflandırıcı tahminiyse 'warn'.
 *
 * REGRESYON İLKESİ: bugün geçen bir makale yeni kurallar yüzünden durmaz
 * (iki revizyonda kapanmayan blok → REVIZE_NEEDED, yayın yok, hak iade yok).
 * Yeni engelleyici kural yalnız tip AÇIKÇA (açık seçim / sıralayıcı) belirlenmişse.
 */

import { isAuthoritativeSource, isProductFactType, type ContentType, type ContentTypeSource } from '../prompts/content-templates.js';

export type GeoGateCode =
  | 'NO_TABLE'
  | 'MISSING_SHORT_ANSWER'
  | 'LOW_QUESTION_H2_RATIO'
  | 'NO_UPDATED_DATE'
  | 'UNSOURCED_NUMERIC_CLAIM'
  | 'WEAK_LEDE'
  | 'LONG_SENTENCES'
  | 'TEMPLATE_STRUCTURE'
  | 'MISSING_AUTHOR_LINE';

export type GeoGateSeverity = 'block' | 'warn';

export interface GeoGateIssue {
  code: GeoGateCode;
  /** 'block' PASS'i engeller; 'warn' yalnız öneri */
  severity: GeoGateSeverity;
  /** Editöre doğrudan verilecek Türkçe talimat */
  message: string;
  /** Somut örnekler (başlık adı, satır metni) — max birkaç tane */
  samples?: string[];
}

export interface GeoGateStats {
  contentH2: number;
  questionH2: number;
  questionRatio: number;
  tables: number;
  shortAnswerCovered: number;
  hasUpdatedDate: boolean;
  unsourcedNumericClaims: number;
  /** Eski kalıbın kaçırdığı kaynaksız fiyatlar ("$29", "1.039 ₺", "29 €") */
  unsourcedPriceClaims: number;
  /** H1 ile ilk H2 arasindaki metnin uzunlugu (gorsel/yorum haric) */
  ledeChars: number;
  /** H1'den sonraki ilk anlamli blok cevap tasiyor mu (Hizli cevap blockquote'u ya da klise-siz cumle) */
  ledeHasAnswer: boolean;
  /** Düz metin cümle sayısı (tablo, kod, liste, başlık hariç) */
  sentences: number;
  /** Eşikten (varsayılan 25 kelime) uzun cümlelerin oranı */
  longSentenceRatio: number;
  /** Görünür yazar satırı ("Bu makale ... tarafından hazırlandı") var mı */
  hasAuthorLine: boolean;
  /** Ölçülen içerik tipi (verilmediyse 'guide') */
  contentType: ContentType;
  /** Tip şablonunda eksik bulunan zorunlu öğeler */
  templateMissing: string[];
}

export interface GeoGateResult {
  pass: boolean;
  issues: GeoGateIssue[];
  stats: GeoGateStats;
  /** Editör prompt'una eklenecek hazır blok; geçtiyse boş string */
  feedback: string;
}

export interface GeoGateOptions {
  /** Soru formatlı H2 için alt sınır (varsayılan 0.5 = %50) */
  minQuestionRatio?: number;
  /** Feedback bloğunda gösterilecek örnek sayısı */
  maxSamples?: number;
  /** Lede penceresi — H1 sonrasi kac karakter cevap tasimali (varsayilan 200) */
  ledeWindow?: number;
  /** İçerik tipi; 'guide' (varsayılan) için şablon kontrolü yapılmaz */
  contentType?: ContentType;
  /**
   * Tip kararının kaynağı. Yalnız 'explicit' / 'ranker' engelleyici kural doğurur
   * (TEMPLATE_STRUCTURE, ürün tiplerinde yeni fiyat kalıpları); verilmezse tahmin sayılır.
   */
  contentTypeSource?: ContentTypeSource;
  /** Sitenin gerçek yazar adı; verilirse yazar satırında bu ad aranır */
  authorName?: string | null;
  /** Uzun cümle eşiği, kelime (varsayılan 25) */
  longSentenceWords?: number;
  /** Uzun cümle oranı üst sınırı (varsayılan 0.2 = %20) */
  maxLongSentenceRatio?: number;
  /** Uzun cümle kuralının uygulanması için en az cümle sayısı (varsayılan 10) */
  minSentencesForLength?: number;
}

/**
 * Yapısal bölümler: bunlarda "Kısa cevap" blockquote'u ve soru başlığı beklenmez.
 * Soru oranının paydasına da girmezler — SSS/Sonuç başlığı zaten soru değildir,
 * paydada tutmak oranı yapay olarak düşürür.
 */
const STRUCTURAL_H2 = [
  'sikca sorulan sorular',
  'sikca sorulan soru',
  'sss',
  'sonuc',
  'sonuc ve ozet',
  'kaynaklar',
  'kaynakca',
  'ozet',
];

/** Kaynak sayılan işaretler — YMYL sayıların yanında bunlardan biri olmalı. */
const SOURCE_MARKERS: RegExp[] = [
  /\]\(https?:\/\//i, // markdown link
  /https?:\/\/\S+/i, // düz URL
  /kaynak\s*[:：]/i,
  /<blockquote[^>]*\scite=/i,
  /\b(GİB|GIB|Gelir İdaresi|TÜİK|TUIK|TCMB|Merkez Bankası|Resmî Gazete|Resmi Gazete|KOSGEB|SGK|BDDK|KGF|Hazine ve Maliye|Ticaret Bakanlığı|Türkiye Bankalar Birliği|mevzuat\.gov\.tr)\b/i,
];

/** Sayısal iddia kalıpları — YMYL (vergi/faiz/kredi) odaklı, dar tutuldu. */
const PERCENT_RE = /(%\s?\d|\d\s?%)/;
/**
 * Tutar — ESKİ kalıp, aynen korunur (önem derecesi değişmez: 'block').
 * Sembolden sonra `\b` aradığı için "1.039 ₺", "29 €", "$29" kalıplarını kaçırır.
 */
const MONEY_RE = /\d[\d.,]*\s?(TL|₺|lira|USD|\$|EUR|€|dolar|avro)\b/i;
/**
 * Tutar — eski kalıbın kaçırdığı biçimler: "1.039 ₺", "29 €", "29$", "$29", "€15".
 * Bu yeni yakalamalar yalnız ürün tipinde (comparison/best_for/alternatives/pricing)
 * ve tip açıkça belirlenmişse engeller; diğer her yerde öneridir (regresyon ilkesi).
 * Kod sızıntısına karşı: `$1`, `$2y$10$`, `=$1`, `{print $1}`, sembolden sonra yıl
 * ("₺ 2012'de") tutar sayılmaz.
 */
const PRICE_SUFFIX_RE = /\d[\d.,]*\s?(TL|₺|lira|USD|\$|EUR|€|dolar|avro)(?![\p{L}\p{N}_$])/iu;
// "(" kasitli olarak engel degil: "Trello Standard ($5/ay)", "(₺199/ay)" tutardir; "$(document)" zaten rakam istemez.
const PRICE_PREFIX_RE = /(?<![\p{L}\p{N}_$=\\{])(₺|\$|€)\s?(?!(19|20)\d{2}\b)(\d[\d.,]*)(?![\p{L}\p{N}$}\]])/gu;
/**
 * Kabuk konumsal argumani: "$1 ilk argümandır", "$2 ikinci parametre". Tek haneli
 * "$N" ardindan argüman sözcüğü gelirse tutar degildir.
 */
const SHELL_ARG_AFTER_RE = /^\s+(ilk|ikinci|üçüncü|dördüncü|son|sonraki|argüman|argumani|parametre|değişken|değişkeni|is the|refers|holds)/iu;
/** Kabuk / sunucu yapılandırması / kod gibi görünen satır — fiyat taramasına girmez */
const CODE_LIKE_RE = /[{};^]|=\s?\$|\b(echo|awk|sed|grep|sudo|printf|export|RewriteRule|RewriteCond|SetEnv)\b/;
/** Satır içi kod (`...`) taramadan önce atılır */
const INLINE_CODE_RE = /`[^`\n]*`/g;
/**
 * İçinde 2+ "$" geçen kelime (bcrypt/şifre özeti "$2y$10$...", "$PATH:$HOME") tutar değildir;
 * taramadan önce atılır. Fiyat aralığı ("$10-$20", "$10–$20", "$0,30/$0,50") istisnadır.
 */
const HASH_TOKEN_RE = /\S*\$\S*\$\S*/g;
const PRICE_RANGE_TOKEN_RE = /^[([]?\$\d[\d.,]*(\s?[-–/]\s?\$\d[\d.,]*)+[)\].,;:!?]*$/;
function stripHashTokens(text: string): string {
  return text.replace(HASH_TOKEN_RE, (tok) => (PRICE_RANGE_TOKEN_RE.test(tok) ? tok : ' '));
}
const UNIT_RE = /\d[\d.,]*\s?(baz puan|puan|kat)\b/i;
const FINANCE_WORD_RE =
  /(faiz|oran(ı|i|lar)?|vergi|stopaj|komisyon|kdv|prim|ceza|limit|tutar|tarife|iskonto|vade|taksit|kâr|kar\s?marj)/i;

/** Türkçe karakterleri sadeleştirip küçült — başlık eşleştirmesi için. */
function normalizeTr(s: string): string {
  return s
    .toLocaleLowerCase('tr')
    .replace(/[çÇ]/g, 'c')
    .replace(/[ğĞ]/g, 'g')
    .replace(/[ıİI]/g, 'i')
    .replace(/[öÖ]/g, 'o')
    .replace(/[şŞ]/g, 's')
    .replace(/[üÜ]/g, 'u')
    .replace(/[âÂ]/g, 'a')
    .replace(/[îÎ]/g, 'i')
    .replace(/[ûÛ]/g, 'u')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Frontmatter + kod bloklarını çıkar — kural taraması gövde metnine bakmalı. */
function stripNonProse(raw: string): string {
  let txt = String(raw ?? '');
  // Frontmatter (gray-matter'a gerek yok; bozuk YAML'da patlamasın)
  const fm = txt.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  if (fm) txt = txt.slice(fm[0].length);
  // Fenced kod blokları
  txt = txt.replace(/```[\s\S]*?```/g, '\n');
  return txt;
}

interface H2Section {
  title: string;
  body: string;
  structural: boolean;
}

function splitH2Sections(body: string): H2Section[] {
  const lines = body.split('\n');
  const sections: H2Section[] = [];
  let current: H2Section | null = null;

  for (const line of lines) {
    const m = line.match(/^##\s+(?!#)(.+?)\s*$/);
    if (m) {
      if (current) sections.push(current);
      const title = m[1].replace(/\*\*/g, '').trim();
      const norm = normalizeTr(title);
      current = {
        title,
        body: '',
        structural: STRUCTURAL_H2.some((s) => norm === s || norm.startsWith(s)),
      };
      continue;
    }
    // Yeni H1 gelirse mevcut bölüm kapanır
    if (/^#\s+(?!#)/.test(line)) {
      if (current) {
        sections.push(current);
        current = null;
      }
      continue;
    }
    if (current) current.body += line + '\n';
  }
  if (current) sections.push(current);
  return sections;
}

/** Bölümün ilk anlamlı satırlarında "> **Kısa cevap:**" var mı? */
function hasShortAnswer(sectionBody: string): boolean {
  const lines = sectionBody
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 5);
  return lines.some((l) => /^>\s*\*\*\s*k[ıi]sa\s+cevap\s*:?\s*\*\*/i.test(l));
}

/**
 * Lede: H1 ile ilk H2 arasindaki metin. OpenAI'nin indeksi sayfadan yalniz
 * basligi ve ~200 karakteri sakliyor (2 bagimsiz kaynak) — ilk 200 karakter
 * gorsel, boilerplate veya giris klisesiyse makale indekste bos gorunur.
 * Yazar prompt'u "> **Hızlı cevap:**" istiyor ama olculmuyordu.
 */
const LEDE_CLICHE = /(günümüzde|gunumuzde|bu yazıda|bu yazida|bu makalede|son yıllarda|son yillarda|bilindiği gibi|bilindigi gibi|hepimiz biliyoruz|teknolojinin gelişmesiyle)/i;

function extractLede(body: string): { present: boolean; text: string; firstBlockIsImage: boolean; hasQuickAnswer: boolean } {
  const lines = body.split('\n');
  let h1 = -1;
  for (let i = 0; i < lines.length; i++) if (/^#\s+(?!#)/.test(lines[i])) { h1 = i; break; }
  if (h1 < 0) return { present: false, text: '', firstBlockIsImage: false, hasQuickAnswer: false };
  const chunk: string[] = [];
  for (let i = h1 + 1; i < lines.length; i++) {
    if (/^##\s+(?!#)/.test(lines[i])) break;
    chunk.push(lines[i]);
  }
  const meaningful = chunk.map((l) => l.trim()).filter((l) => l && !/^<!--/.test(l));
  const firstBlockIsImage = meaningful.length > 0 && /^!\[/.test(meaningful[0]);
  const hasQuickAnswer = meaningful.slice(0, 3).some((l) => /^>\s*\*\*\s*h[ıi]zl[ıi]\s+cevap\s*:?\s*\*\*/i.test(l));
  const text = meaningful.filter((l) => !/^!\[/.test(l)).join(' ').replace(/\s+/g, ' ').trim();
  return { present: true, text, firstBlockIsImage, hasQuickAnswer };
}

/** Markdown tablosu: en az bir hizalama (separator) satırı olmalı. */
function countTables(body: string): number {
  const matches = body.match(/^\s*\|?[\s:]*-{3,}[\s:|-]*\|[\s:|-]*$/gm);
  return matches ? matches.length : 0;
}

/** 4 haneli yıl dışında rakam var mı — "2026 yılında" tek başına iddia değil. */
function hasNonYearNumber(line: string): boolean {
  return /\d/.test(line.replace(/\b(19|20)\d{2}\b/g, ''));
}

function isNumericClaim(line: string): boolean {
  if (PERCENT_RE.test(line)) return true;
  if (MONEY_RE.test(line)) return true;
  if (UNIT_RE.test(line)) return true;
  if (FINANCE_WORD_RE.test(line) && hasNonYearNumber(line)) return true;
  return false;
}

/** Eski kalıbın kaçırdığı kaynaksız fiyat (yalnız yeni yakalama) */
function isNewPriceClaim(line: string): boolean {
  if (CODE_LIKE_RE.test(line)) return false;
  if (PRICE_SUFFIX_RE.test(line)) return true;
  for (const m of line.matchAll(PRICE_PREFIX_RE)) {
    const digits = m[3];
    const after = line.slice((m.index ?? 0) + m[0].length);
    if (m[1] === '$' && /^\d$/.test(digits) && SHELL_ARG_AFTER_RE.test(after)) continue;
    return true;
  }
  return false;
}

function hasSource(text: string): boolean {
  return SOURCE_MARKERS.some((re) => re.test(text));
}

/**
 * Kaynaksız sayısal iddiaları bulur.
 *
 * Pencere: iddianın bulunduğu blok (boş satırla ayrılmış paragraf/tablo) +
 * hemen ardından gelen kısa "Kaynak/dipnot" bloğu. Başlık satırları taranmaz.
 */
function findUnsourcedClaims(body: string, limit: number): { legacy: string[]; price: string[] } {
  // Kaynak kontrolu ORIJINAL blokta yapilir (backtick icindeki ya da "$" iceren
  // kaynak adresi silinmesin). Kod / ozet dizgisi yalniz IDDIA taranirken atilir;
  // degistirmeler satir sonu silmez, bloklar ve satirlar 1:1 eslesir.
  const blocks = body.split(/\n\s*\n/);
  const scanBlocks = stripHashTokens(body.replace(INLINE_CODE_RE, ' ')).split(/\n\s*\n/);
  const hits: string[] = [];
  const price: string[] = [];
  const clip = (line: string) => (line.length > 160 ? `${line.slice(0, 157)}...` : line);

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (!block.trim()) continue;

    const next = blocks[i + 1] ?? '';
    const nextIsCaption =
      next.length < 200 && (/kaynak/i.test(next) || /^\s*[*_>]/.test(next));
    const window = nextIsCaption ? `${block}\n${next}` : block;
    if (hasSource(window)) continue;

    let priceHit: string | null = null;
    let legacyHit = false;
    const rawLines = block.split('\n');
    const scanLines = (scanBlocks[i] ?? block).split('\n');
    for (let j = 0; j < rawLines.length; j++) {
      const line = rawLines[j].trim();
      const scan = (scanLines[j] ?? rawLines[j]).trim();
      if (!line || line.startsWith('#')) continue;
      if (/^\|?[\s:|-]+\|?$/.test(line)) continue; // tablo separator
      // Eski kalip: orijinal satir eskisi gibi eslesmeli VE kod atildiktan sonra da
      // eslesmeli. Boylece eski yakalamalarin alt kumesi kalir (atma yeni eslesme yaratamaz).
      if (isNumericClaim(line) && isNumericClaim(scan)) {
        legacyHit = true;
        if (hits.length < limit) hits.push(clip(line)); // ornek: orijinal satir
        break; // blok başına tek örnek yeter
      }
      if (!priceHit && isNewPriceClaim(scan)) priceHit = line;
    }
    // Eski kalıbın yakaladığı blokta yeni yakalama tekrar sayılmaz
    if (!legacyHit && priceHit && price.length < limit) price.push(clip(priceHit));
  }
  return { legacy: hits, price };
}

// ────────────────────────────────────────────────────────────
//  Cümle uzunluğu (Türkçe)
// ────────────────────────────────────────────────────────────

/**
 * Nokta ile bitip cümle bitirmeyen kısaltmalar (küçük harfe indirgenmiş, noktasız).
 * "vb.", "örn.", "bkz.", "Dr.", "A.Ş." cümleyi bölmesin.
 */
const ABBREVIATIONS = new Set([
  'vb', 'vs', 'vd', 'örn', 'orn', 'bkz', 'krş', 'yy', 'sn', 'dk', 'sa', 'no', 'nr', 'tel',
  'dr', 'prof', 'doç', 'doc', 'yrd', 'av', 'mah', 'cad', 'sok', 'apt', 'ltd', 'şti', 'sti', 'inc', 'co',
  'a.ş', 'a.s', 't.c', 'e.g', 'i.e', 'etc', 'st', 'mr', 'mrs', 'ms', 'jr', 'yak', 'max', 'min', 'ort',
]);

/**
 * Ölçülecek düz metni çıkarır: tablo, kod, liste, başlık, görsel, HTML satırı
 * ve frontmatter atılır; blockquote'un ">" işareti ve kalın etiket ("Kısa cevap:")
 * soyulur, link metni korunur, URL'ler tek kelimeye iner.
 */
function proseForSentences(body: string): string {
  const out: string[] = [];
  for (const raw of body.split('\n')) {
    let line = raw.trim();
    if (!line) { out.push(''); continue; }
    if (line.startsWith('#')) { out.push(''); continue; }
    if (line.startsWith('|')) { out.push(''); continue; }
    if (/^([-*+]|\d+[.)])\s+/.test(line)) { out.push(''); continue; }
    if (/^!\[/.test(line)) { out.push(''); continue; }
    if (/^<\/?[a-z][^>]*>$/i.test(line) || /^<!--/.test(line)) { out.push(''); continue; }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) { out.push(''); continue; }
    line = line.replace(/^>\s*/, '');
    line = line.replace(/<[^>]+>/g, ' ');
    line = line.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');
    line = line.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
    line = line.replace(/https?:\/\/\S+/g, 'URL');
    line = line.replace(/\*\*[^*]{1,40}:\*\*/g, ' ');
    line = line.replace(/[*_`]/g, '');
    out.push(line);
  }
  return out.join('\n');
}

/**
 * Türkçe metni cümlelere böler; kısaltma, ondalık ("3,5" / "3.5"), "1.039" ve URL cümle bitirmez.
 * "3. adımda" sıra sayısıdır (sonraki kelime küçük harf); "31 Mart 2026. Bu ..." ve
 * "sınırı 5. Daha ..." cümle sonudur (sonraki kelime büyük harf).
 * Doğrusal: her parça bir kez işlenir (patolojik "vb. vb. vb. ..." girdisinde O(n²) yok).
 */
export function splitSentences(text: string): string[] {
  const sentences: string[] = [];
  // Paragraf sınırı her zaman cümle sınırıdır
  for (const para of text.split(/\n\s*\n/)) {
    const flat = para.replace(/\s+/g, ' ').trim();
    if (!flat) continue;
    let buf: string[] = [];
    const parts = flat.split(/(?<=[.!?…])\s+/);
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      buf.push(part);
      const sp = part.lastIndexOf(' ');
      const lastWord = part.slice(sp + 1).replace(/^["'“‘([]+/, '').replace(/["'”’)\]]+$/, '');
      const nextStartsLower = i + 1 < parts.length && /^["'“‘(]*[\p{Ll}]/u.test(parts[i + 1]);
      const endsWithAbbr = /\.$/.test(lastWord)
        && (ABBREVIATIONS.has(lastWord.slice(0, -1).toLocaleLowerCase('tr'))
          || /^(\p{L}\.)+$/u.test(lastWord) // "A.Ş." "T.C." "e.g."
          || (/^\d+\.$/.test(lastWord) && nextStartsLower)); // "3. adımda" sıra sayısı
      if (endsWithAbbr && i + 1 < parts.length) continue;
      sentences.push(buf.join(' '));
      buf = [];
    }
    if (buf.length) sentences.push(buf.join(' '));
  }
  return sentences;
}

function countWords(sentence: string): number {
  return sentence.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

// ────────────────────────────────────────────────────────────
//  Yazar satırı
// ────────────────────────────────────────────────────────────

const AUTHOR_LINE_RE = /bu (makale|yaz[ıi]|i[çc]erik|rehber)[^\n]{1,160}?taraf[ıi]ndan (haz[ıi]rland[ıi]|yaz[ıi]ld[ıi]|derlendi)|\b(written|prepared|reviewed) by\s+\S/i;
/** "Yazar: ...", "Author: ...", satır başında "By Jane Doe" (İngilizce siteler) */
const AUTHOR_LABEL_RE = /^\s*[*_]*\s*(yazar|author)\s*[*_]*\s*:/im;
/** Büyük/küçük harf duyarlı: "By Jane Doe" (iki büyük harfli ad); "By default, ..." değil */
const AUTHOR_BYLINE_RE = /^\s*[*_]*\s*[Bb]y\s+[*_]*\p{Lu}\p{Ll}+\s+\p{Lu}[^\n]*/mu;

function findAuthorLine(body: string): string | null {
  const m = body.match(AUTHOR_LINE_RE);
  if (m) return m[0];
  const lbl = body.match(new RegExp(AUTHOR_LABEL_RE.source + '.*', 'im'));
  if (lbl) return lbl[0];
  const by = body.match(AUTHOR_BYLINE_RE);
  return by ? by[0] : null;
}

// ────────────────────────────────────────────────────────────
//  İçerik tipi şablonu
// ────────────────────────────────────────────────────────────

/** Her markdown tablosunun veri satırı sayısı (başlık + ayraç hariç) */
function tableDataRows(body: string): number[] {
  const rows: number[] = [];
  const lines = body.split('\n');
  for (let i = 1; i < lines.length; i++) {
    if (!/^\s*\|?[\s:]*-{3,}[\s:|-]*\|[\s:|-]*$/.test(lines[i])) continue;
    let n = 0;
    for (let j = i + 1; j < lines.length && /^\s*\|/.test(lines[j]); j++) n++;
    rows.push(n);
  }
  return rows;
}

/** En uzun ardışık numaralı liste (1. 2. 3. ya da 1) 2) 3)) */
function longestOrderedList(body: string): number {
  let best = 0;
  let run = 0;
  for (const line of body.split('\n')) {
    if (/^\s*\d+[.)]\s+\S/.test(line)) { run++; best = Math.max(best, run); continue; }
    if (!line.trim() || /^\s{2,}\S/.test(line)) continue; // boş satır / girintili devam satırı listeyi kesmez
    run = 0;
  }
  return best;
}

/** SSS dışındaki H3 başlık sayısı */
function contentH3Count(sections: H2Section[]): number {
  return sections
    .filter((s) => !s.structural)
    .reduce((n, s) => n + (s.body.match(/^###\s+(?!#)\S/gm)?.length ?? 0), 0);
}

/**
 * Tip şablonunun zorunlu öğeleri — yalnız deterministik ölçülebilenler, cömert eşikle.
 * guide ve listicle için kontrol yok (bugünkü yapı).
 */
function missingTemplateElements(
  type: ContentType,
  ctx: { body: string; sections: H2Section[]; tables: number; hasQuickAnswer: boolean },
): string[] {
  const missing: string[] = [];
  const rows = tableDataRows(ctx.body);
  switch (type) {
    case 'comparison':
      if (!ctx.hasQuickAnswer) missing.push('H1 altında hükmü ilk cümlede veren "> **Hızlı cevap:**" bloğu');
      if (ctx.tables === 0) missing.push('yan yana karşılaştırma tablosu (Özellikler, Fiyat, Entegrasyon, Destek)');
      break;
    case 'best_for':
      if (!ctx.hasQuickAnswer) missing.push('H1 altında tek cümlelik cevap ("> **Hızlı cevap:**")');
      if (!rows.some((n) => n >= 3)) missing.push('en az 3 satırlı sıralı tablo (Ad, Kime uygun, Fiyat, Temel sınırlama)');
      break;
    case 'alternatives':
      if (Math.max(contentH3Count(ctx.sections), ...rows, 0) < 5) {
        missing.push('en az 5 alternatif (her biri H3 başlık ya da özet tabloda satır, "Kime uygun" etiketiyle)');
      }
      break;
    case 'howto':
      if (longestOrderedList(ctx.body) < 3) missing.push('en az 3 adımlık numaralı liste (1. 2. 3.)');
      break;
    case 'pricing':
      if (ctx.tables === 0) missing.push('plan karşılaştırma tablosu (Plan, Fiyat, Limitler, Kime uygun)');
      break;
    default:
      break;
  }
  return missing;
}

/**
 * Temizlenmiş markdown'ı GEO kurallarına karşı ölçer.
 * LLM çağırmaz, deterministiktir — aynı metin her zaman aynı sonucu verir.
 */
export function checkGeoGate(markdown: string, opts: GeoGateOptions = {}): GeoGateResult {
  const minRatio = opts.minQuestionRatio ?? 0.5;
  const maxSamples = opts.maxSamples ?? 6;
  const ledeWindow = opts.ledeWindow ?? 200;
  const contentType: ContentType = opts.contentType ?? 'guide';
  const authoritative = isAuthoritativeSource(opts.contentTypeSource);
  const longWords = opts.longSentenceWords ?? 25;
  const maxLongRatio = opts.maxLongSentenceRatio ?? 0.2;
  const minSentences = opts.minSentencesForLength ?? 10;

  const body = stripNonProse(markdown);
  const sections = splitH2Sections(body);
  const content = sections.filter((s) => !s.structural);

  const questionH2 = content.filter((s) => s.title.trim().endsWith('?')).length;
  const questionRatio = content.length > 0 ? questionH2 / content.length : 0;
  const missingShortAnswer = content.filter((s) => !hasShortAnswer(s.body));
  const tables = countTables(body);
  const hasUpdatedDate = /son\s+g[üu]ncelleme\s*[:：]\s*\*{0,2}\s*\d{4}-\d{2}-\d{2}/i.test(body);
  const { legacy: unsourced, price: unsourcedPrice } = findUnsourcedClaims(body, maxSamples);
  const lede = extractLede(body);
  const ledeHead = lede.text.slice(0, ledeWindow);
  const ledeHasAnswer = lede.present && !lede.firstBlockIsImage && lede.text.length > 0
    && (lede.hasQuickAnswer || !LEDE_CLICHE.test(ledeHead));

  const sentences = splitSentences(proseForSentences(body));
  const longSentences = sentences.filter((x) => countWords(x) > longWords);
  const longRatio = sentences.length > 0 ? longSentences.length / sentences.length : 0;
  const authorLine = findAuthorLine(body);
  const authorName = (opts.authorName ?? '').trim();
  const authorLineOk = !!authorLine
    && (!authorName || authorLine.toLocaleLowerCase('tr').includes(authorName.toLocaleLowerCase('tr')));
  const templateMissing = missingTemplateElements(contentType, {
    body,
    sections,
    tables,
    hasQuickAnswer: lede.hasQuickAnswer,
  });

  const issues: GeoGateIssue[] = [];

  if (lede.present && !ledeHasAnswer) {
    issues.push({
      code: 'WEAK_LEDE',
      severity: 'block',
      message:
        `H1'den sonraki ilk ${ledeWindow} karakter cevap taşımıyor` +
        (lede.firstBlockIsImage ? ' (ilk blok görsel)' : lede.text.length === 0 ? ' (H1 ile ilk H2 arası boş)' : ' (giriş klişesiyle başlıyor)') +
        '. AI indeksleri sayfadan yalnız başlık + ilk ~200 karakteri saklar: H1\'in hemen altına "> **Hızlı cevap:** ..." ' +
        'blockquote\'unu koy, görseli ve giriş cümlesini ondan SONRAYA al.',
      samples: ledeHead ? [ledeHead.slice(0, 160)] : undefined,
    });
  }

  if (tables === 0) {
    issues.push({
      code: 'NO_TABLE',
      severity: 'block',
      message:
        'Makalede hiç markdown tablosu yok. Karşılaştırma, oran/tarife veya adım-kriter ' +
        'verisini en az 1 tabloya taşı. Tabloyu dolgu için uydurma; metinde zaten anlattığın ' +
        'karşılaştırmayı yapılandır.',
    });
  }

  if (missingShortAnswer.length > 0) {
    issues.push({
      code: 'MISSING_SHORT_ANSWER',
      severity: 'block',
      message:
        `${missingShortAnswer.length} H2 bölümünde "> **Kısa cevap:** ..." satırı yok. ` +
        'Her içerik H2\'sinin hemen altına, ilk paragraftan ÖNCE max 25 kelimelik atomik ' +
        'cevap blockquote\'u ekle (SSS ve Sonuç bölümleri hariç).',
      samples: missingShortAnswer.slice(0, maxSamples).map((s) => s.title),
    });
  }

  if (content.length > 0 && questionRatio < minRatio) {
    issues.push({
      code: 'LOW_QUESTION_H2_RATIO',
      severity: 'block',
      message:
        `Soru formatlı H2 oranı %${Math.round(questionRatio * 100)} (${questionH2}/${content.length}); ` +
        `alt sınır %${Math.round(minRatio * 100)}. Başlıkları okurun arama kutusuna yazdığı ` +
        'soruya çevir ("KDV Hesaplama" → "KDV nasıl hesaplanır?"). Konuyu değiştirme, sadece başlığı.',
      samples: content
        .filter((s) => !s.title.trim().endsWith('?'))
        .slice(0, maxSamples)
        .map((s) => s.title),
    });
  }

  if (!hasUpdatedDate) {
    issues.push({
      code: 'NO_UPDATED_DATE',
      severity: 'block',
      message:
        'Makale sonunda görünür "*Son güncelleme: YYYY-MM-DD*" satırı yok. ' +
        'Frontmatter yetmez; AI tazelik filtresi görünür metne bakar.',
    });
  }

  if (unsourced.length > 0) {
    issues.push({
      code: 'UNSOURCED_NUMERIC_CLAIM',
      severity: 'block',
      message:
        `${unsourced.length} yerde kaynağı gösterilmemiş sayısal iddia var (oran, tutar, faiz, vergi). ` +
        'Her birinin yanına resmî kaynağı ekle (GİB, TÜİK, TCMB, Resmî Gazete, mevzuat.gov.tr gibi) ' +
        'veya sayıyı tamamen çıkar. Kaynağı olmayan sayı yazma — bu bir YMYL konusu.',
      samples: unsourced,
    });
  }

  if (unsourcedPrice.length > 0) {
    // Yeni yakalama: yalnız açıkça belirlenmiş ürün tipinde engeller
    const strict = authoritative && isProductFactType(contentType);
    issues.push({
      code: 'UNSOURCED_NUMERIC_CLAIM',
      severity: strict ? 'block' : 'warn',
      message:
        `${unsourcedPrice.length} yerde kaynağı gösterilmemiş fiyat var (₺, $, €). Adı geçen ürünün fiyatını ` +
        'yalnız resmî fiyat sayfası bağlantısı ya da "Kaynak: ..." satırıyla yaz; kaynağın yoksa rakamı çıkar ' +
        've niteliksel anlat ("ücretsiz planı var", "ücretli planlar kullanıcı sayısına göre artar").',
      samples: unsourcedPrice,
    });
  }

  if (templateMissing.length > 0) {
    issues.push({
      code: 'TEMPLATE_STRUCTURE',
      // Sınıflandırıcı tahmini: öneri; açık seçim / sıralayıcı: engel
      severity: authoritative ? 'block' : 'warn',
      message:
        `İçerik tipi "${contentType}" şablonunun zorunlu öğeleri eksik. Okurun bu tip soruda aradığı ` +
        'iskelet AI cevaplarında alıntılanan kısımdır; eksik öğeyi ekle, var olan bölümleri silme. ' +
        'Doğrulayamadığın fiyat/özellik için rakam uydurma, niteliksel yaz.',
      samples: templateMissing,
    });
  }

  if (sentences.length >= minSentences && longRatio > maxLongRatio) {
    issues.push({
      code: 'LONG_SENTENCES',
      severity: 'warn',
      message:
        `Cümlelerin %${Math.round(longRatio * 100)}'i ${longWords} kelimeden uzun (${longSentences.length}/${sentences.length}; ` +
        `üst sınır %${Math.round(maxLongRatio * 100)}). Uzun cümleleri ikiye böl: bir cümle, bir bilgi. ` +
        '"ve", "ancak", "çünkü" ile bağlanan yan cümleleri ayrı cümle yap; anlamı ve rakamları değiştirme.',
      samples: longSentences.slice(0, Math.min(3, maxSamples)).map((x) => (x.length > 160 ? `${x.slice(0, 157)}...` : x)),
    });
  }

  if (!authorLineOk) {
    issues.push({
      code: 'MISSING_AUTHOR_LINE',
      severity: 'warn',
      message: authorName
        ? `Görünür yazar satırı "${authorName}" adını taşımıyor. Sonuç bölümünden sonra "**Bu makale ${authorName} tarafından hazırlandı.**" satırını yaz; başka ad uydurma.`
        : 'Görünür yazar satırı yok. Sonuç bölümünden sonra "**Bu makale [kurum adı] tarafından hazırlandı.**" satırını ekle; kişi adı uydurma, persona adı yazma.',
    });
  }

  const blocking = issues.filter((i) => i.severity === 'block');

  const stats: GeoGateStats = {
    contentH2: content.length,
    questionH2,
    questionRatio: Number(questionRatio.toFixed(3)),
    tables,
    shortAnswerCovered: content.length - missingShortAnswer.length,
    hasUpdatedDate,
    unsourcedNumericClaims: unsourced.length,
    unsourcedPriceClaims: unsourcedPrice.length,
    ledeChars: lede.text.length,
    ledeHasAnswer,
    sentences: sentences.length,
    longSentenceRatio: Number(longRatio.toFixed(3)),
    hasAuthorLine: authorLineOk,
    contentType,
    templateMissing,
  };

  // Yalnız 'block' bulgular kapıyı düşürür. Öneriler (warn) PASS'te editöre
  // GİTMEZ (bugünkü girdi değişmesin); revizyon turunda listenin sonuna eklenir.
  return {
    pass: blocking.length === 0,
    issues,
    stats,
    feedback: blocking.length === 0 ? '' : buildFeedback(issues),
  };
}

/** Editör prompt'una eklenecek zorunlu düzeltme bloğu. */
function buildFeedback(issues: GeoGateIssue[]): string {
  const lines = [
    '',
    '## DETERMİNİSTİK GEO KAPISI — ZORUNLU DÜZELTMELER',
    '',
    'Aşağıdaki bulgular makineyle ölçüldü, yorum değil. Hepsi giderilmeden PASS verme;',
    'düzeltilmiş tam makaleyi mutlaka döndür.',
    '',
  ];
  const pushIssue = (issue: GeoGateIssue) => {
    lines.push(`- **[${issue.code}]** ${issue.message}`);
    if (issue.samples?.length) {
      for (const s of issue.samples) lines.push(`  - ${s}`);
    }
  };
  issues.filter((i) => i.severity === 'block').forEach(pushIssue);
  const warnings = issues.filter((i) => i.severity === 'warn');
  if (warnings.length > 0) {
    lines.push('');
    lines.push('### Öneriler (PASS\'i engellemez, düzeltirken birlikte gider)');
    lines.push('');
    warnings.forEach(pushIssue);
  }
  lines.push('');
  lines.push(
    'Not: bu maddeleri kapatmak için kelime sayısını şişirme. Dolgu paragraf eklemek ' +
      'kapıyı geçirmez, bilgi yoğunluğunu düşürür.',
  );
  return lines.join('\n');
}
