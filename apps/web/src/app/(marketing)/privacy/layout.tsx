import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Gizlilik Politikası — Kullanıcı verisi, KVKK uyumu, AES-256 şifreleme',
  description: 'LuviAI gizlilik politikası — toplanan veriler, kullanım amacı, üçüncü taraf paylaşım, kullanıcı hakları, çerez politikası, AES-256-GCM şifreleme detayları.',
  alternates: { canonical: 'https://ai.luvihost.com/privacy' },
  robots: { index: true, follow: true },
};

export default function PrivacyLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
