import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Kullanım Senaryoları — KOBİ, e-ticaret, ajans için AI otomasyon',
  description: 'KOBİ, e-ticaret, dijital ajans, freelancer, blog yazarı için RanksUp nasıl kullanılır — gerçek senaryolar, beklenen sonuçlar, ROI tahmini.',
  alternates: { canonical: 'https://ranksup.ai/use-cases' },
  openGraph: {
    title: 'RanksUp Kullanım Senaryoları',
    description: 'KOBİ, e-ticaret, ajans ve freelancer için somut senaryolar.',
    url: 'https://ranksup.ai/use-cases',
  },
};

export default function UseCasesLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
