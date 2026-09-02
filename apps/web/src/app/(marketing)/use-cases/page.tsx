'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';

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
      <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute top-20 -left-20 w-96 h-96 bg-brand-500/10 rounded-full blur-3xl" />
        <div className="absolute top-60 -right-20 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl" />
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="text-center mb-12 max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-500/10 border border-brand-500/20 text-brand-600 text-xs font-semibold mb-5">
            {data.eyebrow}
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-tight mb-4">
            {data.titleA}{' '}
            <span className="bg-gradient-to-r from-brand-500 via-brand-600 to-red-600 bg-clip-text text-transparent">
              {data.titleB}
            </span>
          </h1>
          <p className="text-lg text-muted-foreground">{data.subtitle}</p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {data.items.map((u) => (
            <div key={u.title} className="p-6 rounded-2xl border bg-background hover:border-brand-500/30 hover:shadow-lg hover:shadow-brand-500/5 transition-all group flex flex-col">
              <div className="text-4xl mb-4 group-hover:scale-110 transition-transform inline-block">{u.icon}</div>
              <h2 className="text-xl font-bold mb-3">{u.title}</h2>
              <ul className="space-y-2 text-sm text-muted-foreground mb-6 flex-1">
                {u.bullets.map((b, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-brand-600 shrink-0">•</span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
              <Button asChild className="w-full bg-gradient-to-br from-brand-500 to-brand-600 hover:from-brand-600 hover:to-brand-700 text-white">
                <Link href="/onboarding">{u.cta}</Link>
              </Button>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
