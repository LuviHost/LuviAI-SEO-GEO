import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Fiyatlandırma',
  description: "Starter 499 TL, Pro 1.299 TL, Agency 3.299 TL — aylık iptal, taahhüt yok. İlk makale ücretsiz dene, PayTR ile güvenli ödeme. Her plan: site denetimi, AI içerik üretimi, sosyal medya planlayıcı, otomatik yayın.",
  alternates: { canonical: 'https://ai.luvihost.com/pricing' },
  openGraph: {
    title: 'LuviAI Fiyatlandırma — 499 TL / 1.299 TL / 3.299 TL',
    description: 'Aylık iptal, taahhüt yok. İlk makale ücretsiz. 3 plan, tüm özellikler dahil.',
    url: 'https://ai.luvihost.com/pricing',
  },
};

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
