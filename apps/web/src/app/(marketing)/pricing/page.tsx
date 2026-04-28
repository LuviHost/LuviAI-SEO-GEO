'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ThemeToggle } from '@/components/theme-toggle';
import { LocaleSwitch } from '@/components/locale-switch';
import { Check } from 'lucide-react';

export default function PricingPage() {
  const { t } = useT();
  const { data: session, status } = useSession();
  const router = useRouter();
  const [plans, setPlans] = useState<any[]>([]);
  const [cycle, setCycle] = useState<'monthly' | 'annual'>('monthly');
  const [loading, setLoading] = useState<string | null>(null);

  useEffect(() => {
    api.getPlans()
      .then(setPlans)
      .catch(() => toast.error(t('common.error')));
  }, []);

  const subscribe = async (planId: string) => {
    if (status === 'loading') return;

    if (!session?.user?.id) {
      toast.message('Devam etmek için giriş yapın');
      router.push(`/signin?callbackUrl=${encodeURIComponent('/pricing')}`);
      return;
    }

    setLoading(planId);
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
      const res = await fetch(`${apiBase}/api/billing/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          userId: session.user.id,
          planId,
          cycle,
          userEmail: session.user.email,
          userName: session.user.name ?? session.user.email,
        }),
      });
      const data = await res.json();
      if (data.iframeUrl) {
        toast.success('Yönlendiriliyor...');
        window.location.href = data.iframeUrl;
      } else {
        toast.error(data.message ?? 'Bilinmeyen hata');
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(null);
    }
  };

  const realPlans = plans.filter((p) => p.id !== 'trial');

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted">
      <header className="container flex justify-between items-center py-4 sm:py-6 px-4">
        <Link href="/" className="text-xl sm:text-2xl font-bold text-foreground">LuviAI</Link>
        <div className="flex items-center gap-2 sm:gap-3">
          <LocaleSwitch />
          <ThemeToggle />
        </div>
      </header>

      <main className="container py-8 sm:py-12 px-4">
        <div className="text-center mb-8 sm:mb-12">
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold mb-3">{t('pricing.title')}</h1>
          <p className="text-muted-foreground text-base sm:text-lg px-2">{t('pricing.subtitle')}</p>
        </div>

        <div className="flex justify-center mb-10">
          <div className="inline-flex bg-card border rounded-lg p-1">
            <button
              onClick={() => setCycle('monthly')}
              className={`px-5 py-2 text-sm font-medium rounded-md transition-colors ${
                cycle === 'monthly' ? 'bg-brand text-white' : 'text-muted-foreground'
              }`}
            >
              {t('pricing.monthly')}
            </button>
            <button
              onClick={() => setCycle('annual')}
              className={`px-5 py-2 text-sm font-medium rounded-md transition-colors flex items-center gap-2 ${
                cycle === 'annual' ? 'bg-brand text-white' : 'text-muted-foreground'
              }`}
            >
              {t('pricing.annual')}
              <Badge variant="secondary" className="text-[10px]">-20%</Badge>
            </button>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 max-w-5xl mx-auto">
          {realPlans.map((p) => {
            const price = cycle === 'annual' ? p.annual : p.monthly;
            const monthlyEq = cycle === 'annual' ? Math.round(p.annual / 12) : p.monthly;
            return (
              <Card key={p.id} className={`relative ${p.popular ? 'ring-2 ring-brand shadow-xl sm:col-span-2 lg:col-span-1' : ''}`}>
                {p.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge>{t('pricing.popular')}</Badge>
                  </div>
                )}
                <CardHeader>
                  <h2 className="text-xl sm:text-2xl font-bold">{p.name}</h2>
                  <div className="mt-2">
                    <span className="text-3xl sm:text-4xl font-bold">₺{price.toLocaleString('tr-TR')}</span>
                    <span className="text-muted-foreground text-sm ml-2">
                      /{cycle === 'annual' ? 'yıl' : 'ay'}
                    </span>
                  </div>
                  {cycle === 'annual' && (
                    <p className="text-xs text-muted-foreground">
                      aylık ortalama ₺{monthlyEq}
                    </p>
                  )}
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 text-sm mb-6">
                    <Feat>{p.articlesPerMonth} {t('pricing.articles_per_month')}</Feat>
                    <Feat>{p.socialPostsPerMonth} {t('pricing.social_posts_per_month')}</Feat>
                    <Feat>{p.sites} {t('pricing.sites')}</Feat>
                    <Feat>{p.publishTargets === 'all' ? t('pricing.all_publish_targets') : t('pricing.markdown_only')}</Feat>
                    <Feat>{p.support}</Feat>
                    <Feat>TR + EN içerik</Feat>
                    <Feat>GEO/AEO optimizasyon</Feat>
                  </ul>
                  <Button
                    onClick={() => subscribe(p.id)}
                    disabled={loading === p.id}
                    variant={p.popular ? 'default' : 'outline'}
                    className="w-full"
                  >
                    {loading === p.id ? t('common.loading') : t('pricing.cta')}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="mt-12 text-center text-sm text-muted-foreground">
          <p>{t('pricing.security_note')}</p>
        </div>
      </main>
    </div>
  );
}

function Feat({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2 text-foreground/80">
      <Check className="h-4 w-4 text-brand shrink-0" />
      <span>{children}</span>
    </li>
  );
}
