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
    <main className="relative">
      <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute top-20 -left-20 w-96 h-96 bg-orange-500/10 rounded-full blur-3xl" />
        <div className="absolute top-60 -right-20 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl" />
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="text-center mb-12 max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-500/10 border border-orange-500/20 text-orange-600 text-xs font-semibold mb-5">
            💡 Yardım Merkezi
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-tight mb-4">
            Yardım{' '}
            <span className="bg-gradient-to-r from-orange-500 via-orange-600 to-red-600 bg-clip-text text-transparent">
              merkezi
            </span>
          </h1>
          <p className="text-lg text-muted-foreground">
            Sorununuzu bulamadıysanız{' '}
            <a href="mailto:destek@luvihost.com" className="text-orange-600 hover:underline">destek@luvihost.com</a>
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {TOPICS.map((t) => (
            <div key={t.title} className="p-6 rounded-2xl border bg-background hover:border-orange-500/30 hover:shadow-lg hover:shadow-orange-500/5 transition-all group">
              <div className="text-3xl mb-3 inline-block group-hover:scale-110 transition-transform">{t.icon}</div>
              <h2 className="font-bold mb-3">{t.title}</h2>
              <ul className="space-y-2 text-sm">
                {t.items.map((item) => (
                  <li key={item.href}>
                    <Link href={item.href as any} className="text-muted-foreground hover:text-orange-600 transition-colors inline-flex items-center gap-1">
                      <span>→</span> {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
