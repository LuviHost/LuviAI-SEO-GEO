import type { Metadata } from 'next';

/**
 * Yardim alt sayfasinin metadata'si: kendi canonical'i, kendi aciklamasi.
 *
 * NEDEN: help/layout.tsx canonical'i https://ranksup.ai/help veriyor; alt sayfalar yalniz `title`
 * tanimladigi icin canonical'i ve aciklamayi layout'tan miras aliyordu. Google 8 alt sayfanin hepsini
 * /help'in kopyasi sayip dizine ayri almiyordu (10.11.2026 taramasi: hepsinde canonical=/help, ayni aciklama).
 * openGraph de verilir: layout'unki og:url'yi /help yapiyordu.
 */
export function yardimMeta(slug: string, title: string, description: string): Metadata {
  const url = `https://ranksup.ai/help/${slug}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url },
  };
}
