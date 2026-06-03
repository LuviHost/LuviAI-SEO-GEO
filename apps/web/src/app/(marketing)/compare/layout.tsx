import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Karşılaştırma — RanksUp vs Jasper, Surfer, Frase, Writesonic',
  description: "RanksUp ile diğer SEO + içerik üretim platformları (Jasper, Surfer SEO, Frase, Writesonic, Copy.ai, ContentPace, NeuronWriter) arasındaki farklar — özellik, fiyat, Türkçe destek, GEO optimizasyonu.",
  alternates: { canonical: 'https://ranksup.ai/compare' },
  openGraph: {
    title: 'RanksUp vs Diğer SEO Platformları',
    description: 'Jasper, Surfer, Frase ve diğerleriyle karşılaştırma — özellik, fiyat, Türkçe destek.',
    url: 'https://ranksup.ai/compare',
  },
};

export default function CompareLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
