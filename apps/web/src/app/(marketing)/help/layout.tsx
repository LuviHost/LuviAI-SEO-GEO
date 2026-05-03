import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Yardım Merkezi — Kurulum, WordPress, sosyal medya rehberleri',
  description: 'LuviAI kurulum, WordPress bağlantısı, sosyal medya hesabı ekleme, takvim kullanımı, fatura ve iptal işlemleri için adım adım rehber.',
  alternates: { canonical: 'https://ai.luvihost.com/help' },
  openGraph: {
    title: 'LuviAI Yardım Merkezi',
    description: 'Adım adım kurulum ve kullanım rehberleri.',
    url: 'https://ai.luvihost.com/help',
  },
};

export default function HelpLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
