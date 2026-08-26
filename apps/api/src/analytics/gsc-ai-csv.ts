/**
 * GSC "Generative AI" performans raporu CSV parser — saf, bagimliliksiz.
 *
 * Google'in raporu (support.google.com/webmasters/answer/16984139) AI
 * Overviews + AI Mode gorunumlerini BIRLESIK ve YALNIZ GOSTERIM olarak
 * verir; tiklama/CTR/pozisyon yok, API yok, tek cikis UI export. Kolon
 * basliklari resmi dokumante degil — parser EN/TR basliklari esnek esler,
 * bilinmeyen kolonlari yok sayar, eksikte beklenen kolonlari listeleyen
 * acik hata verir. ILK GERCEK EXPORT ile fixture dogrulanacak.
 *
 * YANLIS DOSYA KORUMASI (kirmizi-takim): normal Performans raporunun tarih
 * dosyasi (Tarih/Tiklama/Gosterim/TO/Pozisyon) bu basliklarin ust kumesi;
 * sessizce yutulsa normal arama gosterimleri "AI gorunurlugu" diye cizilirdi.
 * Tiklama kolonu DOLU (sifirdan buyuk deger) ise reddedilir.
 */

export interface GscAiCsvRow {
  date: string;          // YYYY-MM-DD
  impressions: number;
  clicks: number | null;
  position: number | null;
}

export interface GscAiCsvParse {
  rows: GscAiCsvRow[];
  delimiter: ',' | ';' | '\t';
  headers: string[];
  /** Hangi kolonun ne diye eslendigi — onizlemede gosterilir */
  mapping: Partial<Record<'date' | 'impressions' | 'clicks' | 'ctr' | 'position', string>>;
  warnings: string[];
}

export type GscAiCsvErrorCode = 'EMPTY' | 'NO_HEADER_MATCH' | 'HAS_CLICKS' | 'NO_ROWS';

export class GscAiCsvError extends Error {
  constructor(public readonly code: GscAiCsvErrorCode, message: string) {
    super(message);
    this.name = 'GscAiCsvError';
  }
}

const HEADER_ALIASES: Record<keyof GscAiCsvParse['mapping'], string[]> = {
  date: ['date', 'tarih', 'gun', 'day', 'hafta', 'week', 'ay', 'month'],
  impressions: ['impressions', 'gosterimler', 'gosterim', 'gosterim sayisi', 'toplam gosterim'],
  clicks: ['clicks', 'tiklamalar', 'tiklama', 'tiklama sayisi', 'toplam tiklama'],
  ctr: ['ctr', 'to', 'tiklama orani'],
  position: ['position', 'pozisyon', 'konum', 'ortalama konum', 'average position', 'ortalama pozisyon'],
};

/** Baslik normalizasyonu: kucuk harf, TR harf katlama, fazla bosluk */
export function normalizeHeader(h: string): string {
  return h
    .replace(/^﻿/, '')
    .trim()
    .toLowerCase()
    .replace(/ı/g, 'i').replace(/i̇/g, 'i')
    .replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .replace(/["']/g, '')
    .replace(/\s+/g, ' ');
}

function detectDelimiter(headerLine: string): ',' | ';' | '\t' {
  const counts: Array<[',' | ';' | '\t', number]> = [
    [',', (headerLine.match(/,/g) ?? []).length],
    [';', (headerLine.match(/;/g) ?? []).length],
    ['\t', (headerLine.match(/\t/g) ?? []).length],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

/** Tirnakli alanlari destekleyen basit CSV satir ayirici */
export function splitCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; }
      } else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      out.push(cur); cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** "1.234" (TR binlik) / "1,234" (EN binlik) / "0,5" (TR ondalik) / "~" "-" → 0 */
export function parseNumber(raw: string): number | null {
  const v = raw.replace(/\s/g, '').replace(/%$/, '');
  if (v === '' ) return null;
  if (v === '~' || v === '-' || v === '—') return 0; // GSC export: kucuk/gizli deger
  if (/^\d{1,3}(\.\d{3})+$/.test(v)) return Number(v.replace(/\./g, ''));
  if (/^\d{1,3}(,\d{3})+$/.test(v)) return Number(v.replace(/,/g, ''));
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

const TR_MONTHS: Record<string, number> = {
  oca: 1, sub: 2, mar: 3, nis: 4, may: 5, haz: 6, tem: 7, agu: 8, eyl: 9, eki: 10, kas: 11, ara: 12,
  jan: 1, feb: 2, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** YYYY-MM-DD | DD.MM.YYYY | DD/MM/YYYY | "26 Agu 2026" → YYYY-MM-DD */
export function parseDate(raw: string): string | null {
  const v = raw.trim().replace(/^"|"$/g, '');
  let m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = v.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = normalizeHeader(v).match(/^(\d{1,2})\s+([a-z]{3})[a-z]*\.?\s+(\d{4})$/);
  if (m && TR_MONTHS[m[2]]) return `${m[3]}-${String(TR_MONTHS[m[2]]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

export function parseGscAiCsv(text: string): GscAiCsvParse {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) throw new GscAiCsvError('EMPTY', 'Dosya boş.');

  const delimiter = detectDelimiter(lines[0]);
  const headers = splitCsvLine(lines[0], delimiter);
  const norm = headers.map(normalizeHeader);

  const mapping: GscAiCsvParse['mapping'] = {};
  const idx: Partial<Record<keyof GscAiCsvParse['mapping'], number>> = {};
  for (const key of Object.keys(HEADER_ALIASES) as Array<keyof GscAiCsvParse['mapping']>) {
    const i = norm.findIndex((h) => HEADER_ALIASES[key].includes(h));
    if (i >= 0) { idx[key] = i; mapping[key] = headers[i]; }
  }

  if (idx.date === undefined || idx.impressions === undefined) {
    throw new GscAiCsvError(
      'NO_HEADER_MATCH',
      `Beklenen kolonlar bulunamadı. Gerekli: Tarih/Date ve Gösterimler/Impressions. Dosyadaki başlıklar: ${headers.join(' | ')}. `
      + 'Search Console → Performans → Üretken AI raporu → Dışa aktar → tarih tablosu (CSV) dosyasını yükleyin.',
    );
  }

  const warnings: string[] = [];
  const byDate = new Map<string, GscAiCsvRow>();
  let clicksPositive = 0;

  for (let li = 1; li < lines.length; li++) {
    const cells = splitCsvLine(lines[li], delimiter);
    const date = parseDate(cells[idx.date] ?? '');
    if (!date) { warnings.push(`Satır ${li + 1}: tarih okunamadı (${cells[idx.date] ?? ''})`); continue; }
    const impressions = parseNumber(cells[idx.impressions] ?? '');
    if (impressions === null) { warnings.push(`Satır ${li + 1}: gösterim okunamadı`); continue; }
    const clicks = idx.clicks !== undefined ? parseNumber(cells[idx.clicks] ?? '') : null;
    const position = idx.position !== undefined ? parseNumber(cells[idx.position] ?? '') : null;
    if (clicks !== null && clicks > 0) clicksPositive++;
    if (byDate.has(date)) warnings.push(`${date} birden fazla satırda — son satır alındı`);
    byDate.set(date, { date, impressions: Math.round(impressions), clicks, position });
  }

  if (clicksPositive > 0) {
    throw new GscAiCsvError(
      'HAS_CLICKS',
      `Bu dosya normal Performans raporuna benziyor (${clicksPositive} satırda tıklama > 0). Üretken AI raporu tıklama vermez — `
      + 'yanlış rapor yüklenirse normal arama gösterimleri "AI görünürlüğü" diye çizilir. Lütfen Üretken AI raporunun export\'unu yükleyin.',
    );
  }

  const rows = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  if (rows.length === 0) throw new GscAiCsvError('NO_ROWS', 'Geçerli satır bulunamadı. ' + warnings.slice(0, 3).join(' · '));

  return { rows, delimiter, headers, mapping, warnings };
}
