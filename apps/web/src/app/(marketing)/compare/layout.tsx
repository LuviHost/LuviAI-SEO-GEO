import type { Metadata } from 'next';

export const metadata: Metadata = {
  // Metadata yalniz sayfada karsilastirilan araclari sayar (eskiden sayfada hic gecmeyen
  // Writesonic, Copy.ai, ContentPace, NeuronWriter vardi). GEON ve SEOYEN 24.10.2026'da eklendi.
  title: 'RanksUp vs Surfer, Jasper, Ahrefs, Frase, GEON, SEOYEN',
  description: 'RanksUp ile Surfer, Jasper, Ahrefs, Frase, GEON ve SEOYEN arasındaki farklar: AI içerik, AI görünürlük ölçümü, site denetimi, yayın, Türkçe destek.',
  alternates: { canonical: 'https://ranksup.ai/compare' },
  openGraph: {
    title: 'RanksUp vs Diğer SEO Platformları',
    description: 'Surfer, Jasper, Ahrefs, Frase, GEON ve SEOYEN ile karşılaştırma — özellik, fiyat, Türkçe destek.',
    url: 'https://ranksup.ai/compare',
  },
};

export default function CompareLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
