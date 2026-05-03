import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sistem Durumu',
  description: 'LuviAI servislerinin (web panel, API, AI içerik üretimi, sosyal medya yayını, ödeme) gerçek zamanlı durumu, geçmiş uptime ve duyurular.',
  alternates: { canonical: 'https://ai.luvihost.com/status' },
};

export default function StatusLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
