'use client';

import Link from 'next/link';
import { useT } from '@/lib/i18n';
import { Eyebrow, StepMotif } from '@/components/brand';

const USE_CASES = {
  tr: {
    eyebrow: '🎯 Kullanım Senaryoları',
    titleA: 'Senin sektörüne',
    titleB: 'özel akış',
    subtitle: 'Sitenizin tipine göre RanksUp nasıl yardım eder?',
    items: [
      {
        icon: '🛒',
        title: 'E-ticaret',
        bullets: [
          'Şehir + ürün kategorisi sayfaları (programmatic SEO)',
          'Ürün karşılaştırma blogları (organic traffic)',
          'WooCommerce REST API ile otomatik yayın',
          'Sezonsal kampanya yazıları (Black Friday, Sevgililer Günü)',
        ],
        cta: 'E-ticaret için başla',
      },
      {
        icon: '☁️',
        title: 'SaaS',
        bullets: [
          'Documentation + tutorial otomasyonu',
          'Long-tail "X nasıl yapılır" içerik',
          'Use case sayfaları (her sektör için ayrı)',
          'Comparison ("X vs Competitor") sayfaları',
        ],
        cta: 'SaaS için başla',
      },
      {
        icon: '🎨',
        title: 'Ajans',
        bullets: [
          'Müşteri başına ayrı brain + brand voice',
          'White-label dashboard (Faz 3)',
          'Toplu makale üretim (haftada 50+)',
          'GSC + GEO raporlama otomatik',
        ],
        cta: 'Ajans için başla',
      },
      {
        icon: '📝',
        title: 'Blog & Yayın',
        bullets: [
          'Editorial calendar otomasyon',
          'WordPress REST + Ghost + custom CMS',
          'Affiliate makale yazımı',
          'Topic cluster yönetimi (4 katman)',
        ],
        cta: 'Blog için başla',
      },
      {
        icon: '🏢',
        title: 'Kurumsal',
        bullets: [
          'KVKK + KKB + ETBİS uyumlu içerik',
          'Multi-site + multi-brand dashboard',
          'SLA garantili enterprise plan (Faz 3)',
          'Custom domain + custom branding',
        ],
        cta: 'Kurumsal için başla',
      },
      {
        icon: '🌐',
        title: 'Hosting / Tech',
        bullets: [
          '"X hosting nedir" tarz teknik makaleler',
          'WHMCS Knowledge Base entegrasyonu',
          'cPanel/SFTP/FTP otomatik yayın',
          "GEO ile AI search'te alıntılan",
        ],
        cta: 'Hosting için başla',
      },
    ],
  },
  en: {
    eyebrow: '🎯 Use Cases',
    titleA: 'A flow tailored to',
    titleB: 'your industry',
    subtitle: 'See how RanksUp helps depending on your site type.',
    items: [
      {
        icon: '🛒',
        title: 'E-commerce',
        bullets: [
          'City + product category pages (programmatic SEO)',
          'Product comparison blogs (organic traffic)',
          'WooCommerce REST API auto-publish',
          'Seasonal campaign articles (Black Friday, Valentine\'s Day)',
        ],
        cta: 'Start for E-commerce',
      },
      {
        icon: '☁️',
        title: 'SaaS',
        bullets: [
          'Documentation + tutorial automation',
          'Long-tail "how to X" content',
          'Use case pages (one per vertical)',
          'Comparison ("X vs Competitor") pages',
        ],
        cta: 'Start for SaaS',
      },
      {
        icon: '🎨',
        title: 'Agency',
        bullets: [
          'Per-client brain + brand voice',
          'White-label dashboard (Phase 3)',
          'Bulk article production (50+ per week)',
          'GSC + GEO reporting on autopilot',
        ],
        cta: 'Start for Agency',
      },
      {
        icon: '📝',
        title: 'Blog & Publishing',
        bullets: [
          'Editorial calendar automation',
          'WordPress REST + Ghost + custom CMS',
          'Affiliate article writing',
          'Topic cluster management (4 layers)',
        ],
        cta: 'Start for Blog',
      },
      {
        icon: '🏢',
        title: 'Enterprise',
        bullets: [
          'GDPR/KVKK + KKB + ETBİS compliant content',
          'Multi-site + multi-brand dashboard',
          'SLA-backed enterprise plan (Phase 3)',
          'Custom domain + custom branding',
        ],
        cta: 'Start for Enterprise',
      },
      {
        icon: '🌐',
        title: 'Hosting / Tech',
        bullets: [
          '"What is X hosting" technical articles',
          'WHMCS Knowledge Base integration',
          'cPanel/SFTP/FTP auto-publish',
          'Get cited in AI search via GEO',
        ],
        cta: 'Start for Hosting',
      },
    ],
  },
} as const;

export default function UseCasesPage() {
  const { locale } = useT();
  const data = USE_CASES[locale];

  return (
    <main className="relative">
      <div className="absolute inset-x-0 top-0 h-80 -z-10 grid-paper-light pointer-events-none" aria-hidden="true" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="relative text-center mb-12 max-w-3xl mx-auto">
          <StepMotif size={36} steps={4} className="absolute -top-1 right-0 hidden sm:block" />
          <div className="mb-5">
            <Eyebrow>{data.eyebrow}</Eyebrow>
          </div>
          <h1 className="font-brandDisplay text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-[-0.03em] leading-[1.08] mb-4">
            {data.titleA}{' '}
            <span className="text-brand dark:text-brand-400">
              {data.titleB}
            </span>
          </h1>
          <p className="text-lg text-muted-foreground">{data.subtitle}</p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {data.items.map((u) => (
            <div key={u.title} className="p-6 rounded-2xl border border-ink/10 dark:border-bone/10 bg-paper dark:bg-ink-2 hover:border-brand/40 dark:hover:border-brand-400/40 transition-colors flex flex-col">
              <div className="text-4xl mb-4 inline-block">{u.icon}</div>
              <h2 className="font-brandDisplay text-xl font-bold mb-3">{u.title}</h2>
              <ul className="space-y-2 text-sm text-muted-foreground mb-6 flex-1">
                {u.bullets.map((b, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-brand dark:text-brand-400 shrink-0">•</span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
              <Link href="/onboarding" className="btn-brand w-full text-sm">
                {u.cta}
              </Link>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
