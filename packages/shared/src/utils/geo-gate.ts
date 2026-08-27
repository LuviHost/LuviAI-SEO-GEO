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
 */

export type GeoGateCode =
  | 'NO_TABLE'
  | 'MISSING_SHORT_ANSWER'
  | 'LOW_QUESTION_H2_RATIO'
  | 'NO_UPDATED_DATE'
  | 'UNSOURCED_NUMERIC_CLAIM'
  | 'WEAK_LEDE';

export interface GeoGateIssue {
  code: GeoGateCode;
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
  /** H1 ile ilk H2 arasindaki metnin uzunlugu (gorsel/yorum haric) */
  ledeChars: number;
  /** H1'den sonraki ilk anlamli blok cevap tasiyor mu (Hizli cevap blockquote'u ya da klise-siz cumle) */
  ledeHasAnswer: boolean;
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
const MONEY_RE = /\d[\d.,]*\s?(TL|₺|lira|USD|\$|EUR|€|dolar|avro)\b/i;
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

function hasSource(text: string): boolean {
  return SOURCE_MARKERS.some((re) => re.test(text));
}

/**
 * Kaynaksız sayısal iddiaları bulur.
 *
 * Pencere: iddianın bulunduğu blok (boş satırla ayrılmış paragraf/tablo) +
 * hemen ardından gelen kısa "Kaynak/dipnot" bloğu. Başlık satırları taranmaz.
 */
function findUnsourcedClaims(body: string, limit: number): string[] {
  const blocks = body.split(/\n\s*\n/);
  const hits: string[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (!block.trim()) continue;

    const next = blocks[i + 1] ?? '';
    const nextIsCaption =
      next.length < 200 && (/kaynak/i.test(next) || /^\s*[*_>]/.test(next));
    const window = nextIsCaption ? `${block}\n${next}` : block;
    if (hasSource(window)) continue;

    for (const rawLine of block.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      if (/^\|?[\s:|-]+\|?$/.test(line)) continue; // tablo separator
      if (!isNumericClaim(line)) continue;
      hits.push(line.length > 160 ? `${line.slice(0, 157)}...` : line);
      if (hits.length >= limit) return hits;
      break; // blok başına tek örnek yeter
    }
  }
  return hits;
}

/**
 * Temizlenmiş markdown'ı GEO kurallarına karşı ölçer.
 * LLM çağırmaz, deterministiktir — aynı metin her zaman aynı sonucu verir.
 */
export function checkGeoGate(markdown: string, opts: GeoGateOptions = {}): GeoGateResult {
  const minRatio = opts.minQuestionRatio ?? 0.5;
  const maxSamples = opts.maxSamples ?? 6;
  const ledeWindow = opts.ledeWindow ?? 200;

  const body = stripNonProse(markdown);
  const sections = splitH2Sections(body);
  const content = sections.filter((s) => !s.structural);

  const questionH2 = content.filter((s) => s.title.trim().endsWith('?')).length;
  const questionRatio = content.length > 0 ? questionH2 / content.length : 0;
  const missingShortAnswer = content.filter((s) => !hasShortAnswer(s.body));
  const tables = countTables(body);
  const hasUpdatedDate = /son\s+g[üu]ncelleme\s*[:：]\s*\*{0,2}\s*\d{4}-\d{2}-\d{2}/i.test(body);
  const unsourced = findUnsourcedClaims(body, maxSamples);
  const lede = extractLede(body);
  const ledeHead = lede.text.slice(0, ledeWindow);
  const ledeHasAnswer = lede.present && !lede.firstBlockIsImage && lede.text.length > 0
    && (lede.hasQuickAnswer || !LEDE_CLICHE.test(ledeHead));

  const issues: GeoGateIssue[] = [];

  if (lede.present && !ledeHasAnswer) {
    issues.push({
      code: 'WEAK_LEDE',
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
      message:
        'Makalede hiç markdown tablosu yok. Karşılaştırma, oran/tarife veya adım-kriter ' +
        'verisini en az 1 tabloya taşı. Tabloyu dolgu için uydurma; metinde zaten anlattığın ' +
        'karşılaştırmayı yapılandır.',
    });
  }

  if (missingShortAnswer.length > 0) {
    issues.push({
      code: 'MISSING_SHORT_ANSWER',
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
      message:
        'Makale sonunda görünür "*Son güncelleme: YYYY-MM-DD*" satırı yok. ' +
        'Frontmatter yetmez; AI tazelik filtresi görünür metne bakar.',
    });
  }

  if (unsourced.length > 0) {
    issues.push({
      code: 'UNSOURCED_NUMERIC_CLAIM',
      message:
        `${unsourced.length} yerde kaynağı gösterilmemiş sayısal iddia var (oran, tutar, faiz, vergi). ` +
        'Her birinin yanına resmî kaynağı ekle (GİB, TÜİK, TCMB, Resmî Gazete, mevzuat.gov.tr gibi) ' +
        'veya sayıyı tamamen çıkar. Kaynağı olmayan sayı yazma — bu bir YMYL konusu.',
      samples: unsourced,
    });
  }

  const stats: GeoGateStats = {
    contentH2: content.length,
    questionH2,
    questionRatio: Number(questionRatio.toFixed(3)),
    tables,
    shortAnswerCovered: content.length - missingShortAnswer.length,
    hasUpdatedDate,
    unsourcedNumericClaims: unsourced.length,
    ledeChars: lede.text.length,
    ledeHasAnswer,
  };

  return {
    pass: issues.length === 0,
    issues,
    stats,
    feedback: issues.length === 0 ? '' : buildFeedback(issues),
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
  for (const issue of issues) {
    lines.push(`- **[${issue.code}]** ${issue.message}`);
    if (issue.samples?.length) {
      for (const s of issue.samples) lines.push(`  - ${s}`);
    }
  }
  lines.push('');
  lines.push(
    'Not: bu maddeleri kapatmak için kelime sayısını şişirme. Dolgu paragraf eklemek ' +
      'kapıyı geçirmez, bilgi yoğunluğunu düşürür.',
  );
  return lines.join('\n');
}
