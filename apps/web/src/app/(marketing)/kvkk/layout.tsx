import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'KVKK Aydınlatma Metni — 6698 sayılı kanun kapsamında veri işleme',
  description: '6698 sayılı Kişisel Verilerin Korunması Kanunu kapsamında RanksUp tarafından işlenen veriler, işleme amacı, hukuki sebep, saklama süresi ve kullanıcı hakları.',
  alternates: { canonical: 'https://ranksup.ai/kvkk' },
  robots: { index: true, follow: true },
};

export default function KvkkLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
