/**
 * /rehber makale kaydi (sira = /rehber dizin sirasi). Yeni makale: veri modulunu ekle,
 * buraya kaydet, app/(marketing)/rehber/<slug>/page.tsx olustur ve lib/page-updated.ts
 * PUBLIC_PAGES'e '/rehber/<slug>' ekle — lib/rehber.spec.mts eksigi yakalar.
 */
import type { RehberArticle } from './types';
import { article as chatgpt } from './chatgpt-markam-gorunuyor-mu';
import { article as geo } from './geo-nedir';
import { article as botlar } from './yapay-zeka-botlari-robots-txt';
import { article as llms } from './llms-txt-nedir';
import { article as aiBakisi } from './ai-bakisi-gorunurluk';
import { article as mobil } from './mobil-uygulama-geo';
import { article as araclar } from './yapay-zeka-gorunurluk-araclari';

export const REHBER_ARTICLES: readonly RehberArticle[] = [chatgpt, geo, botlar, llms, aiBakisi, mobil, araclar];

export function findRehber(slug: string): RehberArticle {
  const a = REHBER_ARTICLES.find((x) => x.slug === slug);
  if (!a) throw new Error(`Rehber makalesi yok: ${slug}`);
  return a;
}
