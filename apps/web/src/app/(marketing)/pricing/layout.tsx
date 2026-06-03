import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Fiyatlandırma — Başlangıç ₺1.499 / Profesyonel ₺4.999 / Ajans ₺14.999',
  description: "Başlangıç ₺1.499, Profesyonel ₺4.999, Ajans ₺14.999, Kurumsal ₺34.999+ — aylık iptal, taahhüt yok. 2 makale ücretsiz dene (kart gerekmez), PayTR ile güvenli ödeme. Her plan: AI Görünürlük, ASO, Apple Search Ads, AI Studio, Stuck Page Recovery, otomatik yayın. Video credit add-on pay-as-you-go.",
  alternates: { canonical: 'https://ranksup.ai/pricing' },
  openGraph: {
    title: 'RanksUp Fiyatlandırma — ₺1.499 / ₺4.999 / ₺14.999 / ₺34.999',
    description: '2 makale ücretsiz, kart gerekmez. 4 plan + video credit add-on, tüm özellikler dahil.',
    url: 'https://ranksup.ai/pricing',
  },
};

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
