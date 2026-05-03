import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Hakkımızda — Türkiye merkezli AI içerik ve SEO platformu',
  description: 'LuviAI, Türkiye merkezli LuviHost grubunun AI içerik + SEO + sosyal medya + reklam denetimi otomasyon platformudur. Kuruluş, vizyon, ekip ve neden güvenmeli sorusunun cevabı.',
  alternates: { canonical: 'https://ai.luvihost.com/about' },
  openGraph: {
    title: 'LuviAI Hakkında — Türkiye merkezli AI SaaS',
    description: 'KOBİ ve dijital ajanslar için yapay zeka destekli içerik + SEO + reklam denetimi platformu.',
    url: 'https://ai.luvihost.com/about',
  },
};

export default function AboutLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
