import { marked } from 'marked';
import matter from 'gray-matter';

export function mdToHtml(md: string): string {
  return marked.parse(md) as string;
}

export function extractFAQs(bodyMd: string) {
  const m = bodyMd.match(/##\s+Sıkça Sorulan Sorular\s*\n([\s\S]*?)(?=\n##\s+|$)/);
  if (!m) return [];
  return m[1].split(/\n###\s+/).slice(1).map(block => {
    const [q, ...rest] = block.split('\n');
    return { question: q.trim(), answer: rest.join(' ').trim() };
  });
}

export function readingTime(md: string) {
  return Math.max(1, Math.round(md.split(/\s+/).length / 200));
}

export function parseFrontmatter(raw: string) {
  return matter(raw);
}
