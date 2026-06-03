import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Yardım Merkezi — Kurulum, WordPress, sosyal medya rehberleri',
  description: 'RanksUp kurulum, WordPress bağlantısı, sosyal medya hesabı ekleme, takvim kullanımı, fatura ve iptal işlemleri için adım adım rehber.',
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
