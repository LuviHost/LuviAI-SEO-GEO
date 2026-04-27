import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'LuviAI — SEO + GEO Otomasyonu',
  description: 'Sitenin URL\'ini ver, GSC bağla, AI haftalık 5-50 makale üretip yayınlasın.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body className="antialiased">{children}</body>
    </html>
  );
}
