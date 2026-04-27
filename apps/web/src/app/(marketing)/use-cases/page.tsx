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
    <main className="min-h-screen bg-gradient-to-b from-background to-muted">
      <div className="container py-12 max-w-6xl">
        <Link href="/" className="text-sm text-muted-foreground hover:text-brand">← Ana sayfa</Link>

        <div className="text-center my-12">
          <h1 className="text-4xl md:text-5xl font-bold mb-3">Kullanım Senaryoları</h1>
          <p className="text-muted-foreground">Sitenizin tipine göre LuviAI nasıl yardım eder?</p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {USE_CASES.map((u) => (
            <Card key={u.title}>
              <CardContent className="p-6">
                <div className="text-4xl mb-4">{u.icon}</div>
                <h2 className="text-2xl font-bold mb-4">{u.title}</h2>
                <ul className="space-y-2 text-sm text-muted-foreground mb-6">
                  {u.bullets.map((b, i) => (
                    <li key={i}>• {b}</li>
                  ))}
                </ul>
                <Button asChild className="w-full"><Link href="/onboarding">{u.cta}</Link></Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </main>
  );
}
