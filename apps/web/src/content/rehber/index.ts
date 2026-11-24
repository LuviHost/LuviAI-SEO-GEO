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
import { article as aiModu } from './google-ai-modu';
import { article as mobil } from './mobil-uygulama-geo';
import { article as araclar } from './yapay-zeka-gorunurluk-araclari';
import { article as gorunurluk } from './yapay-zeka-gorunurlugu';
import { article as isletmeProfili } from './chatgpt-isletme-profili';
import { article as turkiye } from './turkiyede-yapay-zeka-gorunurluk-urunleri';
import { article as kobi } from './kobi-seo-ve-yapay-zeka-gorunurlugu';
import { article as eticaret } from './e-ticaret-yapay-zeka-gorunurlugu';
import { article as ajans } from './ajanslar-icin-yapay-zeka-gorunurluk-raporu';

// Kapsayici makale (yapay zeka gorunurlugu nedir) basta: "ai gorunurlugu" sorgulari bunu hedefliyor.
// 25.11.2026: Google AI Modu rehberi AI Bakisi'nin hemen ardinda (ikisi ayni Google konusu).
// ChatGPT isletme profili (14.11.2026) iki ChatGPT yazisi yan yana dursun diye olcum rehberinin ardinda.
// 14.11.2026: "hangi urun" sorulari icin dort rehber (Turkiye listesi, KOBI, e-ticaret, ajans) karsilastirmanin
// ardinda bir arada — hepsi urun secimine bakiyor.
export const REHBER_ARTICLES: readonly RehberArticle[] = [
  gorunurluk, chatgpt, isletmeProfili, geo, botlar, llms, aiBakisi, aiModu, mobil, araclar, turkiye, kobi, eticaret, ajans,
];

export function findRehber(slug: string): RehberArticle {
  const a = REHBER_ARTICLES.find((x) => x.slug === slug);
  if (!a) throw new Error(`Rehber makalesi yok: ${slug}`);
  return a;
}
