import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sıkça Sorulan Sorular',
  description: "LuviAI nasıl çalışır, hangi sitelere uygundur, AI içeriği Google'da cezalandırılır mı, WordPress'e nasıl bağlanır, fiyatlandırma nasıl, iptal nasıl yapılır — tüm cevaplar.",
  alternates: { canonical: 'https://ai.luvihost.com/faq' },
  openGraph: {
    title: 'LuviAI Sıkça Sorulan Sorular',
    description: 'AI içerik, GEO optimizasyonu, WordPress entegrasyonu, KVKK, iptal hakkı — bilmen gereken her şey.',
    url: 'https://ai.luvihost.com/faq',
  },
};

export default function FaqLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
