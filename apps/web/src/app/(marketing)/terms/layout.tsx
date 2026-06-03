import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Kullanım Şartları — Abonelik, fesih, sorumluluk ve haklar',
  description: 'RanksUp hizmet kullanım şartları, abonelik koşulları, fesih hakları, sorumluluk sınırları, fikri mülkiyet hakları ve uyuşmazlık çözüm prosedürleri.',
  alternates: { canonical: 'https://ranksup.ai/terms' },
  robots: { index: true, follow: true },
};

export default function TermsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
