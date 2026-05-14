import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

const USE_CASES = [
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
      'GEO ile AI search\'te alıntılan',
    ],
    cta: 'Hosting için başla',
  },
];

export default function UseCasesPage() {
  return (
    <main className="relative">
      <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute top-20 -left-20 w-96 h-96 bg-orange-500/10 rounded-full blur-3xl" />
        <div className="absolute top-60 -right-20 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl" />
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="text-center mb-12 max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-500/10 border border-orange-500/20 text-orange-600 text-xs font-semibold mb-5">
            🎯 Kullanım Senaryoları
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-tight mb-4">
            Senin sektörüne{' '}
            <span className="bg-gradient-to-r from-orange-500 via-orange-600 to-red-600 bg-clip-text text-transparent">
              özel akış
            </span>
          </h1>
          <p className="text-lg text-muted-foreground">Sitenizin tipine göre LuviAI nasıl yardım eder?</p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {USE_CASES.map((u) => (
            <div key={u.title} className="p-6 rounded-2xl border bg-background hover:border-orange-500/30 hover:shadow-lg hover:shadow-orange-500/5 transition-all group flex flex-col">
              <div className="text-4xl mb-4 group-hover:scale-110 transition-transform inline-block">{u.icon}</div>
              <h2 className="text-xl font-bold mb-3">{u.title}</h2>
              <ul className="space-y-2 text-sm text-muted-foreground mb-6 flex-1">
                {u.bullets.map((b, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-orange-600 shrink-0">•</span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
              <Button asChild className="w-full bg-gradient-to-br from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white">
                <Link href="/onboarding">{u.cta}</Link>
              </Button>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
