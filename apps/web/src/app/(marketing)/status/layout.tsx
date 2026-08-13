import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sistem Durumu — Web, API, AI üretimi, sosyal medya yayını',
  description: 'RanksUp servislerinin (web panel, API, AI görünürlük testi, içerik üretimi, ödeme) gerçek zamanlı durumu, geçmiş uptime ve duyurular.',
  alternates: { canonical: 'https://ranksup.ai/status' },
};

export default function StatusLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
