/**
 * Metni kutuya sigdirma — fontlar yuklendikten sonra canvas measureText ile GERCEK genislik
 * olculur (tahmin degil). Satirlar burada kirilir ve tek tek cizilir; boylece her metin
 * uzunlugunda tasma olmaz ve satir satir animasyon yapilabilir.
 */

export type FitOptions = {
  family: string;
  weight: number;
  maxWidth: number;
  maxLines: number;
  maxSize: number;
  minSize: number;
  /** em cinsinden harf araligi (negatif olabilir) */
  letterSpacing?: number;
  step?: number;
};

export type Fit = { size: number; lines: string[] };

let ctx: CanvasRenderingContext2D | null = null;
function measure(text: string, size: number, o: FitOptions): number {
  if (!ctx) ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return text.length * size * 0.6;
  ctx.font = `${o.weight} ${size}px ${o.family}`;
  return ctx.measureText(text).width + (o.letterSpacing ?? 0) * size * text.length;
}

function wrap(text: string, size: number, o: FitOptions): string[] | null {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (measure(w, size, o) > o.maxWidth) return null; // tek kelime sigmiyor -> kucult
    const next = cur ? `${cur} ${w}` : w;
    if (measure(next, size, o) <= o.maxWidth) cur = next;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines.length <= o.maxLines ? lines : null;
}

/** Tek satirda kalan yetim kelimeyi onle: son satir tek kelimeyse bir onceki satirdan kelime al */
function balance(lines: string[], size: number, o: FitOptions): string[] {
  if (lines.length < 2) return lines;
  const out = [...lines];
  const last = out[out.length - 1].split(' ');
  const prev = out[out.length - 2].split(' ');
  if (last.length === 1 && prev.length > 2) {
    const moved = `${prev[prev.length - 1]} ${last[0]}`;
    if (measure(moved, size, o) <= o.maxWidth) {
      out[out.length - 2] = prev.slice(0, -1).join(' ');
      out[out.length - 1] = moved;
    }
  }
  return out;
}

export function fitText(text: string, o: FitOptions): Fit {
  const step = o.step ?? 2;
  for (let size = o.maxSize; size >= o.minSize; size -= step) {
    const lines = wrap(text, size, o);
    if (lines) return { size, lines: balance(lines, size, o) };
  }
  // minSize'da sigmadi (cok uzun metin): tasma yerine minSize'in %60'ina kadar kucultmeye devam et
  const floor = Math.max(24, Math.round(o.minSize * 0.6));
  for (let size = o.minSize - step; size >= floor; size -= step) {
    const lines = wrap(text, size, o);
    if (lines) return { size, lines: balance(lines, size, o) };
  }
  // yine sigmadi (uc durum): satir sayisini asmadan kelimeleri zorla bol; metin adimi bunu engeller
  const size = floor;
  const words = text.split(/\s+/).filter(Boolean);
  const per = Math.ceil(words.length / o.maxLines);
  const lines: string[] = [];
  for (let i = 0; i < words.length; i += per) lines.push(words.slice(i, i + per).join(' '));
  return { size, lines };
}
