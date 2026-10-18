import type { Metadata } from 'next';

export const metadata: Metadata = {
  // Sayfa yalniz Surfer, Jasper, Ahrefs ve Frase'i karsilastirir; metadata eskiden
  // sayfada hic gecmeyen araclari (Writesonic, Copy.ai, ContentPace, NeuronWriter) sayiyordu.
  title: 'Karşılaştırma — RanksUp vs Surfer, Jasper, Ahrefs, Frase',
  description: 'RanksUp ile Surfer, Jasper, Ahrefs ve Frase arasındaki farklar — AI içerik, GEO / AI görünürlük ölçümü, site denetimi, yayın, Türkçe destek ve fiyat.',
  alternates: { canonical: 'https://ranksup.ai/compare' },
  openGraph: {
    title: 'RanksUp vs Diğer SEO Platformları',
    description: 'Surfer, Jasper, Ahrefs ve Frase ile karşılaştırma — özellik, fiyat, Türkçe destek.',
    url: 'https://ranksup.ai/compare',
  },
};

export default function CompareLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
