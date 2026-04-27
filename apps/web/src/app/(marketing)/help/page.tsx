import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';

const TOPICS = [
  {
    icon: '🚀',
    title: 'Başlangıç',
    items: [
      { label: 'Hesap nasıl açılır', href: '/onboarding' },
      { label: 'İlk site bağlama', href: '/help/onboarding' },
      { label: 'GSC bağlantısı', href: '/help/gsc-setup' },
    ],
  },
  {
    icon: '✍️',
    title: 'Makale Üretimi',
    items: [
      { label: 'Topic engine nasıl çalışır', href: '/help/topic-engine' },
      { label: 'Brain düzenleme', href: '/help/brain-editing' },
      { label: 'Manuel konu ekleme', href: '/help/manual-topics' },
    ],
  },
  {
    icon: '🌐',
    title: 'Yayın Hedefi',
    items: [
      { label: 'WordPress REST', href: '/help/wordpress-rest' },
      { label: 'FTP/SFTP', href: '/help/ftp-sftp' },
      { label: 'GitHub repo', href: '/help/github' },
      { label: 'Webflow CMS', href: '/help/webflow' },
    ],
  },
  {
    icon: '📊',
    title: 'Analytics',
    items: [
      { label: '30 gün rapor', href: '/help/analytics' },
      { label: 'Trending sorgular', href: '/help/trending' },
      { label: 'İyileştirme önerileri', href: '/help/suggestions' },
    ],
  },
  {
    icon: '💳',
    title: 'Faturalama',
    items: [
      { label: 'Plan değiştirme', href: '/help/upgrade' },
      { label: 'İptal işlemi', href: '/help/cancel' },
      { label: 'Fatura indirme', href: '/help/invoice' },
    ],
  },
  {
    icon: '🤝',
    title: 'Affiliate',
    items: [
      { label: 'Programa kayıt', href: '/help/affiliate-enroll' },
      { label: 'Komisyon hesaplama', href: '/help/commission' },
      { label: 'Ödeme metodu', href: '/help/payout' },
    ],
  },
];

export default function HelpPage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-background to-muted">
      <div className="container max-w-5xl py-12">
        <Link href="/" className="text-sm text-muted-foreground hover:text-brand">← Ana sayfa</Link>

        <div className="text-center my-12">
          <h1 className="text-4xl md:text-5xl font-bold mb-3">Yardım Merkezi</h1>
          <p className="text-muted-foreground">
            Sorununuzu bulamadıysanız{' '}
            <a href="mailto:destek@luvihost.com" className="text-brand">destek@luvihost.com</a>
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {TOPICS.map((t) => (
            <Card key={t.title}>
              <CardContent className="p-6">
                <div className="text-3xl mb-3">{t.icon}</div>
                <h2 className="font-bold mb-3">{t.title}</h2>
                <ul className="space-y-2 text-sm">
                  {t.items.map((item) => (
                    <li key={item.href}>
                      <Link href={item.href as any} className="text-muted-foreground hover:text-brand">
                        → {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </main>
  );
}
