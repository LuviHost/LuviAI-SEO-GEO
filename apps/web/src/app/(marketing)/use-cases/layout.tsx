import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Kullanım Senaryoları',
  description: 'KOBİ, e-ticaret, dijital ajans, freelancer, blog yazarı için LuviAI nasıl kullanılır — gerçek senaryolar, beklenen sonuçlar, ROI tahmini.',
  alternates: { canonical: 'https://ai.luvihost.com/use-cases' },
  openGraph: {
    title: 'LuviAI Kullanım Senaryoları',
    description: 'KOBİ, e-ticaret, ajans ve freelancer için somut senaryolar.',
    url: 'https://ai.luvihost.com/use-cases',
  },
};

export default function UseCasesLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
