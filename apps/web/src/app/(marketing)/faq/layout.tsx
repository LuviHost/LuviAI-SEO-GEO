import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sıkça Sorulan Sorular',
  description: "RanksUp nasıl çalışır, hangi sitelere uygundur, AI içeriği Google'da cezalandırılır mı, WordPress'e nasıl bağlanır, fiyatlandırma nasıl, iptal nasıl yapılır — tüm cevaplar.",
  alternates: { canonical: 'https://ranksup.ai/faq' },
  openGraph: {
    title: 'RanksUp Sıkça Sorulan Sorular',
    description: 'AI içerik, GEO optimizasyonu, WordPress entegrasyonu, KVKK, iptal hakkı — bilmen gereken her şey.',
    url: 'https://ranksup.ai/faq',
  },
};

export default function FaqLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
