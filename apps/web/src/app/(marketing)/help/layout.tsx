import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Yardım Merkezi — Kurulum, WordPress, ASO ve GEO rehberleri',
  description: 'RanksUp kurulum, WordPress bağlantısı, AI görünürlük testi, ASO kullanımı, fatura ve iptal işlemleri için adım adım rehber.',
  alternates: { canonical: 'https://ranksup.ai/help' },
  openGraph: {
    title: 'RanksUp Yardım Merkezi',
    description: 'Adım adım kurulum ve kullanım rehberleri.',
    url: 'https://ranksup.ai/help',
  },
};

export default function HelpLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
