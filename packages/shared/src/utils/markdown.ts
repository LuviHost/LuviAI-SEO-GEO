import { marked } from 'marked';
import matter from 'gray-matter';

export function mdToHtml(md: string): string {
  return marked.parse(md) as string;
}

export interface ExtractedFaq {
  q: string;
  a: string;
}

/**
 * Görünür SSS bölümünden soru/cevap çiftlerini çıkarır.
 *
 * Neden { q, a }: Article.faqs sütunu ve SchemaClassifier.buildJsonLd bu şekli
 * bekliyor (prisma/schema.prisma: `faqs Json? // [{ q, a }]`). Eski
 * { question, answer } şekli hiçbir tüketiciyle uyuşmuyordu — zaten fonksiyon
 * hiçbir yerden çağrılmıyordu.
 *
 * Cevabı boş olan soru DÖNMEZ: FAQPage şeması görünür metinde karşılığı olmayan
 * Question ilan ederse Google'ın rich-result politikası ihlal edilir (araç
 * sayfalarında 737 Question / 627'si görünmez sorununun kaynağı tam olarak bu).
 */
export function extractFAQs(bodyMd: string): ExtractedFaq[] {
  const src = String(bodyMd ?? '');
  // "## Sıkça Sorulan Sorular", "## SSS", "## Sıkça sorulan sorular (SSS)" vb.
  const m = src.match(
    /(?:^|\n)##\s+(?:s[ıi]k[çc]a\s+sorulan\s+sorular|sss)[^\n]*\n([\s\S]*?)(?=\n##\s+(?!#)|$)/i,
  );
  if (!m) return [];

  const section = m[1];
  const out: ExtractedFaq[] = [];
  // H3 soru blokları
  const blocks = section.split(/^###\s+/m).slice(1);

  for (const block of blocks) {
    const lines = block.split('\n');
    const q = (lines.shift() ?? '').replace(/\*\*/g, '').trim();
    if (!q) continue;
    const a = lines
      .join('\n')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/^>\s*/gm, '') // blockquote işaretleri
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // görseller
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // link → anchor metni
      .replace(/[*_`]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!a) continue; // görünür cevabı olmayan soruyu şemaya sokma
    out.push({ q, a });
  }

  return out;
}

export function readingTime(md: string) {
  return Math.max(1, Math.round(md.split(/\s+/).length / 200));
}

export function parseFrontmatter(raw: string) {
  return matter(raw);
}
