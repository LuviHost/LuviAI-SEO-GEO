import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

const USE_CASES = [
  {
    icon: '🛒',
    title: 'E-ticaret',
    eyebrow: 'WooCommerce · Shopify',
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
    eyebrow: 'B2B · Documentation',
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
    eyebrow: 'White-label · Multi-tenant',
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
    eyebrow: 'Editorial · Multi-CMS',
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
    eyebrow: 'Enterprise · KVKK',
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
    eyebrow: 'WHMCS · cPanel',
    bullets: [
      '"X hosting nedir" tarz teknik makaleler',
      'WHMCS Knowledge Base entegrasyonu',
      'cPanel/SFTP/FTP otomatik yayın',
      'GEO ile AI search\'te alıntılan',
    ],
    cta: 'Hosting için başla',
  },
];

export default function UseCasesPage() {
  return (
    <main className="relative overflow-hidden">
      {/* Apple mesh + noise background */}
      <div className="absolute inset-0 -z-10 bg-mesh-warm opacity-70 pointer-events-none" />
      <div className="absolute inset-0 -z-10 bg-noise opacity-[0.03] pointer-events-none" />

      <div className="container-apple section-padding stagger-reveal">
        {/* Eyebrow */}
        <div className="text-center mb-16 max-w-[760px] mx-auto">
          <p className="eyebrow mb-4">Kullanım Senaryoları</p>
          <h1 className="text-balance font-medium tracking-display text-neutral-900 dark:text-white text-[clamp(2.5rem,6vw,5rem)] leading-[0.96]">
            Sektörüne göre{' '}
            <span className="font-display italic text-[1.08em] text-brand-600 dark:text-brand-400">biçildi.</span>
          </h1>
          <p className="text-pretty mt-7 max-w-[560px] mx-auto text-[clamp(1rem,1.4vw,1.25rem)] leading-[1.5] text-neutral-600 dark:text-neutral-400">
            Sitenizin tipine göre LuviAI nasıl yardım eder?
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-6 max-w-[1280px] mx-auto">
          {USE_CASES.map((u) => (
            <div key={u.title} className="card-apple p-8 lg:p-9 group flex flex-col">
              <div className="text-[2.5rem] mb-5 transition-transform duration-500 ease-apple group-hover:scale-110 origin-left">{u.icon}</div>
              <p className="eyebrow mb-2">{u.eyebrow}</p>
              <h2 className="text-h4 font-medium mb-5 tracking-[-0.025em]">{u.title}</h2>
              <ul className="space-y-2.5 text-[14px] text-neutral-600 dark:text-neutral-400 leading-[1.55] mb-8 flex-1">
                {u.bullets.map((b, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <span className="text-brand-500 mt-1.5 shrink-0">●</span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
              <Link
                href="/onboarding"
                className="inline-flex items-center justify-center gap-1.5 w-full h-11 rounded-full bg-foreground text-background text-[14px] font-medium transition-all duration-300 ease-apple hover:scale-[1.02] active:scale-[0.98] shadow-apple-sm"
              >
                {u.cta}
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
