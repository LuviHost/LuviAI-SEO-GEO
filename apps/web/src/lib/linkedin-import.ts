import type { LinkedinImportRow } from './api';

/**
 * Admin LinkedIn CSV ice aktarimi — yapistirilan metnin ayristirilmasi ve PARTILER halinde
 * gonderimi. Saf, test edilir (linkedin-import.spec.mts).
 *
 * NEDEN PARTI: API JSON govdesini 100 KB'a kadar ayristirir (api request-body.ts
 * DEFAULT_JSON_BODY_LIMIT_BYTES; body-parser varsayilani) ve govde basina 10.000 oge
 * butcesi uygular (api common/json-body-budget.ts JSON_BODY_MAX_NODES; satir basina en
 * fazla 8 oge, govde 2 + 8N). Panel butun satirlari tek istekte gonderiyordu: Turkce, 7
 * sutunlu gercekci satir ~180 bayt; ~575 satirdan sonra her ice aktarma 413 ile tumden
 * reddediliyordu, sunucunun "tek seferde en fazla 5000 satır" siniri panelden hic
 * kullanilamiyordu (inceleme S17). Ucu 2 MiB listesine (LARGE_JSON_BODY_ROUTES) almak da
 * cozum degil: oge butcesi 1.250 tam satirda yine 413 verir ve kimlik denetiminden once
 * ayristirilan buyuk govdeyi genisletir. Cozum istemcide: en fazla 400 satir ve ~90 KB'lik
 * partiler, sirayla. Yeniden deneme guvenli: sunucu profileUrl ile upsert eder (ayni
 * profil ikinci kez eklenmez, guncellenir — api intel/linkedin-outreach.service.ts importRows).
 */

/** Tek seferde (bir tiklamada) aktarilan en fazla satir — api intel.controller.ts linkedinImport ve MAX_IMPORT_ROWS ile ayni sayi */
export const IMPORT_MAX_ROWS_PER_RUN = 5000;
/** Parti basina en fazla satir: 2 + 8 x 400 = 3.202 oge (10.000 butcenin cok altinda) */
export const IMPORT_BATCH_MAX_ROWS = 400;
/** Parti basina en fazla govde (UTF-8 bayt): 100 KB (102.400) sinirinin altinda pay birakir */
export const IMPORT_BATCH_MAX_BYTES = 90_000;

// ═══════════════════════════════════════════════════════════════
//  CSV ayristirma (yapistirilan metin) — ad,soyad,firma,unvan,sektor,kademe,profileUrl
// ═══════════════════════════════════════════════════════════════

/** Tek satiri ayirici + cift tirnak kurallariyla boler ("a, b" tek alan kalir) */
export function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === sep) {
      out.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** Ayirici: ilk dolu satirda en cok gecen (; , tab) — Excel TR ';' verir */
export function detectSep(line: string): string {
  const adaylar = [',', ';', '\t'];
  let best = ',';
  let bestN = -1;
  for (const s of adaylar) {
    const n = line.split(s).length - 1;
    if (n > bestN) { best = s; bestN = n; }
  }
  return best;
}

/**
 * Profil URL'sini kanonik hale getir: https://www.linkedin.com/in/<slug>/
 * NEDEN: www./cipsiz, tr.linkedin.com, ?trk=..., #, buyuk-kucuk harf varyantlari
 * ayni kisidir; arka uc profileUrl @unique oldugundan kanonik olmayan girdi
 * ayni kisi icin ikinci satir uretirdi.
 */
export function canonicalProfileUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim().replace(/^(?!https?:\/\/)/, 'https://'));
  } catch {
    return null;
  }
  if (!/(^|\.)linkedin\.com$/i.test(u.hostname)) return null;
  const m = u.pathname.match(/^\/in\/([^/?#\s]+)/i);
  if (!m) return null;
  let slug: string;
  try { slug = decodeURIComponent(m[1]); } catch { slug = m[1]; }
  slug = slug.toLowerCase();
  return `https://www.linkedin.com/in/${encodeURIComponent(slug)}/`;
}

/** parseImportText sonucu */
export interface ParsedImport {
  rows: LinkedinImportRow[];
  hatalar: string[];
  /** Her gecerli satirin HAM metni (kaynak[i] ↔ rows[i]) */
  kaynak: string[];
  /** Her gecerli satirin metindeki satir indeksi, 0 tabanli (kaynakSatir[i] ↔ rows[i]) */
  kaynakSatir: number[];
  /** Atlanan baslik satirinin indeksi; baslik yoksa null */
  baslikSatiri: number | null;
}

/**
 * Yapistirilan metin → gecerli satirlar, sorunlu satir notlari, her gecerli satirin HAM
 * metni ve metindeki yeri. NEDEN yer: bir parti hata verirse metin kutusundan YALNIZ
 * sunucuya ulasan satirlar cikar (remainingImportText); baslik, sorunlu satirlar ve
 * gonderilmeyen satirlar musterinin yazdigi bicimiyle yerinde kalir.
 */
export function parseImportText(text: string): ParsedImport {
  const rows: LinkedinImportRow[] = [];
  const hatalar: string[] = [];
  const kaynak: string[] = [];
  const kaynakSatir: number[] = [];
  let baslikSatiri: number | null = null;
  const rawLines = text.split(/\r?\n/);
  const firstNonEmpty = rawLines.find((l) => l.trim());
  if (!firstNonEmpty) return { rows, hatalar, kaynak, kaynakSatir, baslikSatiri };

  const sep = detectSep(firstNonEmpty);
  const gorulen = new Set<string>();
  let basliqAtlandi = false;

  // NEDEN ham satir numarasi: bos satirlar atilinca "Satir N" kayiyordu
  rawLines.forEach((rawLine, idx) => {
    const line = rawLine.trim();
    if (!line) return;
    const satir = idx + 1;
    const cols = splitCsvLine(line, sep);
    if (!basliqAtlandi) {
      basliqAtlandi = true;
      const low = cols.map((c) => c.toLowerCase());
      if (low.includes('profileurl') || (low[0] === 'ad' && low[1] === 'soyad')) {
        baslikSatiri = idx;
        return;
      }
    }
    const [ad = '', soyad = '', firma = '', unvan = '', sektor = '', kademeRaw = '', profileRaw = ''] = cols;

    if (!ad || !soyad || !firma || !profileRaw) {
      hatalar.push(`Satır ${satir}: ad, soyad, firma ve profileUrl zorunlu`);
      return;
    }
    const profileUrl = canonicalProfileUrl(profileRaw);
    if (!profileUrl) {
      hatalar.push(`Satır ${satir}: profileUrl linkedin.com/in/... biçiminde olmalı`);
      return;
    }
    if (gorulen.has(profileUrl)) {
      hatalar.push(`Satır ${satir}: aynı profil tekrar ediyor, atlandı`);
      return;
    }
    gorulen.add(profileUrl);

    const kademeN = parseInt(kademeRaw, 10);
    const kademe = kademeN === 1 || kademeN === 2 ? kademeN : undefined;
    if (kademeRaw && kademe === undefined) hatalar.push(`Satır ${satir}: kademe 1 veya 2 olmalı (boş bırakıldı)`);

    rows.push({
      ad, soyad, firma,
      unvan: unvan || undefined,
      sektor: sektor || undefined,
      kademe,
      profileUrl,
    });
    kaynak.push(line);
    kaynakSatir.push(idx);
  });

  return { rows, hatalar, kaynak, kaynakSatir, baslikSatiri };
}

/**
 * Gonderimden sonra metin kutusunda kalacak metin: ozgun metinden YALNIZ sunucuya ulasan
 * satirlar (ilk sentRows gecerli satir; partiler sirali) cikar. Baslik, sorunlu satirlar,
 * gonderilmeyen ve tek seferlik sinirin ustunde kalan satirlar yerinde kalir. Geriye baslik
 * ve bos satirdan baska bir sey kalmazsa bos metin. invalidLines: kutuda kalan sorunlu
 * (aktarilamayan) satir sayisi — bildirim ne kaldigini soyler.
 * NEDEN: hata yolunda kutu yalniz gonderilmeyen gecerli satirlarla yeniden yaziliyordu;
 * baslik ve panelin "sorunlu satır" diye listeledigi satirlar sessizce siliniyordu (S17
 * yan etkisi). Gonderim sirasinda yazilani korumak sayfanin isi: kutu gonderim boyunca
 * kilitli ve metin yalniz gonderim anindaki metinle ayniysa degistirilir.
 */
export function remainingImportText(
  text: string,
  parsed: Pick<ParsedImport, 'rows' | 'kaynakSatir' | 'baslikSatiri'>,
  sentRows: number,
): { text: string; invalidLines: number; unsentRows: number } {
  const gonderilen = Math.min(Math.max(0, Math.floor(sentRows)), parsed.kaynakSatir.length);
  const cikan = new Set(parsed.kaynakSatir.slice(0, gonderilen));
  const gecerli = new Set(parsed.kaynakSatir);
  const kalan: string[] = [];
  let sorunlu = 0;
  let icerik = false;
  text.split(/\r?\n/).forEach((line, i) => {
    if (cikan.has(i)) return;
    kalan.push(line);
    if (!line.trim() || i === parsed.baslikSatiri) return;
    icerik = true;
    if (!gecerli.has(i)) sorunlu++;
  });
  return { text: icerik ? kalan.join('\n') : '', invalidLines: sorunlu, unsentRows: parsed.rows.length - gonderilen };
}

// ═══════════════════════════════════════════════════════════════
//  Partiler
// ═══════════════════════════════════════════════════════════════

const utf8Bayt = (s: string) => new TextEncoder().encode(s).length;
/** 5000 -> "5.000" (Turkce binlik ayirici; ICU'ya bagli degil) */
const binlik = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/**
 * Satirlari sirayla partilere boler: parti basina en fazla maxRows satir ve govdesi
 * (JSON.stringify({ rows })) en fazla maxBytes bayt. Tek basina siniri asan satir kendi
 * partisinde gider (sunucu reddederse hata gosterilir). Siralama korunur: ilk N parti
 * basariliysa gonderilen satirlar tam olarak ilk satirlardir.
 */
export function planImportBatches<T>(
  rows: readonly T[],
  opts: { maxRows?: number; maxBytes?: number } = {},
): T[][] {
  const maxRows = opts.maxRows ?? IMPORT_BATCH_MAX_ROWS;
  const maxBytes = opts.maxBytes ?? IMPORT_BATCH_MAX_BYTES;
  const zarf = utf8Bayt('{"rows":[]}');
  const out: T[][] = [];
  let cur: T[] = [];
  let bayt = zarf;
  for (const row of rows) {
    const b = utf8Bayt(JSON.stringify(row));
    // Virgul: partideki ikinci ve sonraki satirlar
    const ek = cur.length > 0 ? b + 1 : b;
    if (cur.length > 0 && (cur.length >= maxRows || bayt + ek > maxBytes)) {
      out.push(cur);
      cur = [];
      bayt = zarf;
    }
    bayt += cur.length > 0 ? b + 1 : b;
    cur.push(row);
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

export interface ImportRunResult {
  /** Sunucunun ekledigi / guncelledigi kayit (partilerin toplami) */
  upserted: number;
  /** Sunucunun atladigi satir (eksik alan) */
  skipped: number;
  /** Sunucuya ulasan satir: ilk sentRows satir (siralama korunur) */
  sentRows: number;
  batches: number;
  doneBatches: number;
  /** Duran partinin hata metni; tamami gonderildiyse null */
  error: string | null;
}

/**
 * Partileri SIRAYLA gonderir; bir parti hata verirse durur (sonrakiler gonderilmez:
 * hata sinira ya da oturuma bagliysa hepsi ayni hatayi alirdi). onProgress her partiden
 * once (tamamlanan, toplam).
 */
export async function runImportBatches(opts: {
  rows: readonly LinkedinImportRow[];
  send: (batch: LinkedinImportRow[]) => Promise<{ upserted?: unknown; skipped?: unknown } | null | undefined>;
  onProgress?: (done: number, total: number) => void;
  maxRows?: number;
  maxBytes?: number;
}): Promise<ImportRunResult> {
  const partiler = planImportBatches(opts.rows, { maxRows: opts.maxRows, maxBytes: opts.maxBytes });
  const sonuc: ImportRunResult = { upserted: 0, skipped: 0, sentRows: 0, batches: partiler.length, doneBatches: 0, error: null };
  const sayi = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
  for (const parti of partiler) {
    opts.onProgress?.(sonuc.doneBatches, partiler.length);
    try {
      const res = await opts.send(parti);
      // Eski API skipped donmez; upserted yoksa partinin tamami sayilir (eski bildirimle ayni)
      sonuc.upserted += sayi(res?.upserted) ?? parti.length;
      sonuc.skipped += sayi(res?.skipped) ?? 0;
    } catch (err) {
      const m = (err as { message?: unknown } | null)?.message;
      sonuc.error = typeof m === 'string' && m.trim() ? m.trim() : 'İstek başarısız oldu.';
      return sonuc;
    }
    sonuc.sentRows += parti.length;
    sonuc.doneBatches++;
  }
  opts.onProgress?.(sonuc.doneBatches, partiler.length);
  return sonuc;
}

/**
 * Ice aktarma bildirimi. leftover: tek seferlik sinirin (IMPORT_MAX_ROWS_PER_RUN) ustunde
 * kalip gonderilmeyen satir; unsent: hata yuzunden gonderilmeyen satir; invalid: metin
 * kutusunda kalan sorunlu satir (remainingImportText) — ucu de kutuda kalir, bildirim
 * kutuda ne kaldigini ve aktarilanlarin cikarildigini soyler.
 */
export function importRunNotice(r: ImportRunResult, extra: { leftover: number; unsent: number; invalid?: number }): {
  tone: 'success' | 'warning' | 'error';
  title: string;
  description?: string;
} {
  const sayim = `${r.upserted} kayıt eklendi/güncellendi${r.skipped > 0 ? `, ${r.skipped} satır sunucuda atlandı (eksik alan)` : ''}`;
  const sorunlu = extra.invalid ?? 0;
  if (r.error) {
    const aktarilan = r.sentRows > 0
      ? `${r.sentRows} satır aktarıldı (${sayim}) ve metin kutusundan çıkarıldı. `
      : 'Hiçbir satır aktarılmadı. ';
    return {
      tone: 'error',
      title: `İçe aktarma ${r.doneBatches + 1}/${r.batches}. partide durdu: ${r.error}`,
      description: `${aktarilan}Gönderilmeyen ${extra.unsent + extra.leftover} satır${sorunlu > 0 ? ` ve ${sorunlu} sorunlu satır` : ''} metin kutusunda kaldı; tekrar denemek güvenli: aynı profil ikinci kez eklenmez, güncellenir.`,
    };
  }
  const aciklama: string[] = [];
  if (r.batches > 1) aciklama.push(`${r.batches} partide sırayla gönderildi.`);
  if (extra.leftover > 0) {
    aciklama.push(`Tek seferde en fazla ${binlik(IMPORT_MAX_ROWS_PER_RUN)} satır aktarılır; kalan ${extra.leftover} satır metin kutusunda, tekrar “İçe aktar”a bas.`);
  }
  if (sorunlu > 0) aciklama.push(`${sorunlu} sorunlu satır aktarılmadı; düzeltebilmen için metin kutusunda duruyor.`);
  return { tone: extra.leftover > 0 ? 'warning' : 'success', title: sayim, description: aciklama.length > 0 ? aciklama.join(' ') : undefined };
}
