/**
 * Satir farki (saf) — otomatik duzeltme onizlemesinde "ne degisecek" gosterimi.
 *
 * Ortak onek/sonek kirpilir, kalan orta kisimda LCS (en uzun ortak alt dizi)
 * calisir. Orta kisim cok buyukse (hucre tavani) LCS yerine "hepsi silindi +
 * hepsi eklendi" doner: gecerli bir fark, yalniz en kucuk olmayabilir. Bellek
 * ve sure tavani kullanicinin buyuk bir dosyasi icin API'yi kilitlemesin diye.
 */

export interface DiffLine {
  op: 'same' | 'add' | 'del';
  text: string;
}

export interface LineDiff {
  lines: DiffLine[];
  added: number;
  removed: number;
}

/**
 * "a\nb\n" → ['a','b'] (sondaki satir sonu hayalet bos satir uretmez).
 * CRLF, LF ve tek CR satir sonudur (RFC 9309 2.2 NL; robots-merge.ts ile
 * ayni kural): yalniz-CR bir robots.txt onizlemede tek satir gorunmesin.
 */
export function splitLines(text: string | null | undefined): string[] {
  if (!text) return [];
  const parts = text.split(/\r\n|\r|\n/);
  if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

export function lineDiff(before: string | null | undefined, after: string | null | undefined, maxCells = 2_000_000): LineDiff {
  const a = splitLines(before);
  const b = splitLines(after);

  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }

  const head: DiffLine[] = a.slice(0, start).map((text) => ({ op: 'same', text }));
  const tail: DiffLine[] = a.slice(endA).map((text) => ({ op: 'same', text }));
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);

  let mid: DiffLine[];
  if (midA.length === 0 || midB.length === 0 || (midA.length + 1) * (midB.length + 1) > maxCells) {
    mid = [...midA.map((text) => ({ op: 'del' as const, text })), ...midB.map((text) => ({ op: 'add' as const, text }))];
  } else {
    // LCS tablosu (sondan basa) — Uint32Array: satir sayisi tavanla sinirli
    const n = midA.length;
    const m = midB.length;
    const w = m + 1;
    const t = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        t[i * w + j] = midA[i] === midB[j] ? t[(i + 1) * w + j + 1] + 1 : Math.max(t[(i + 1) * w + j], t[i * w + j + 1]);
      }
    }
    mid = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) { mid.push({ op: 'same', text: midA[i] }); i++; j++; }
      else if (t[(i + 1) * w + j] >= t[i * w + j + 1]) { mid.push({ op: 'del', text: midA[i] }); i++; }
      else { mid.push({ op: 'add', text: midB[j] }); j++; }
    }
    while (i < n) mid.push({ op: 'del', text: midA[i++] });
    while (j < m) mid.push({ op: 'add', text: midB[j++] });
  }

  const lines = [...head, ...mid, ...tail];
  return {
    lines,
    added: lines.filter((l) => l.op === 'add').length,
    removed: lines.filter((l) => l.op === 'del').length,
  };
}
