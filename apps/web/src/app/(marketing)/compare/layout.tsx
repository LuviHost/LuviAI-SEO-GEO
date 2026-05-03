import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Karşılaştırma — LuviAI vs Jasper, Surfer, Frase, Writesonic',
  description: "LuviAI ile diğer SEO + içerik üretim platformları (Jasper, Surfer SEO, Frase, Writesonic, Copy.ai, ContentPace, NeuronWriter) arasındaki farklar — özellik, fiyat, Türkçe destek, GEO optimizasyonu.",
  alternates: { canonical: 'https://ai.luvihost.com/compare' },
  openGraph: {
    title: 'LuviAI vs Diğer SEO Platformları',
    description: 'Jasper, Surfer, Frase ve diğerleriyle karşılaştırma — özellik, fiyat, Türkçe destek.',
    url: 'https://ai.luvihost.com/compare',
  },
};

export default function CompareLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
