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
import { CheckCircle2, Sparkles, ShieldCheck, ArrowRight } from 'lucide-react';

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
        // Test mode dev-confirm için merchantOid'i sakla; success sayfası bunu okuyup
        // PayTR webhook gelmeden invoice'ı PAID + plan'ı upgrade eder.
        if (data.merchantOid) {
          try { localStorage.setItem('luviai-pending-merchantOid', data.merchantOid); } catch (_e) { /* noop */ }
        }
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
    <div className="relative">
      {/* gradient blob accents */}
      <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute top-10 -left-20 w-96 h-96 bg-orange-500/10 rounded-full blur-3xl" />
        <div className="absolute top-40 -right-20 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl" />
      </div>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
        <div className="max-w-3xl mx-auto text-center mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-500/10 border border-orange-500/20 text-orange-600 text-xs font-semibold mb-5">
            <Sparkles className="h-3 w-3" />
            <span>14 gün ücretsiz · Kredi kartı yok</span>
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-tight">
            Şeffaf fiyat,{' '}
            <span className="bg-gradient-to-r from-orange-500 via-orange-600 to-red-600 bg-clip-text text-transparent">
              ölçeklenebilir plan
            </span>
          </h1>
          <p className="mt-5 text-lg text-muted-foreground">
            {t('pricing.subtitle')}
          </p>
        </div>

        <div className="flex justify-center mb-12">
          <div className="inline-flex bg-background border rounded-full p-1 shadow-sm">
            <button
              onClick={() => setCycle('monthly')}
              className={`px-6 py-2 text-sm font-medium rounded-full transition-all ${
                cycle === 'monthly'
                  ? 'bg-gradient-to-br from-orange-500 to-orange-600 text-white shadow-md'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t('pricing.monthly')}
            </button>
            <button
              onClick={() => setCycle('annual')}
              className={`px-6 py-2 text-sm font-medium rounded-full transition-all flex items-center gap-2 ${
                cycle === 'annual'
                  ? 'bg-gradient-to-br from-orange-500 to-orange-600 text-white shadow-md'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t('pricing.annual')}
              <span className="text-[10px] bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 px-1.5 py-0.5 rounded-full font-bold">-20%</span>
            </button>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {realPlans.map((p) => {
            const price = cycle === 'annual' ? p.annual : p.monthly;
            const monthlyEq = cycle === 'annual' ? Math.round(p.annual / 12) : p.monthly;
            const highlighted = p.popular;
            return (
              <div
                key={p.id}
                className={`p-8 rounded-2xl border flex flex-col relative ${
                  highlighted
                    ? 'bg-gradient-to-br from-orange-500/10 to-orange-500/5 border-orange-500/30 shadow-xl shadow-orange-500/10 lg:scale-105'
                    : 'bg-background hover:border-orange-500/30 transition-colors'
                }`}
              >
                {highlighted && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-gradient-to-br from-orange-500 to-orange-600 text-white text-[10px] font-bold uppercase tracking-wider shadow-md">
                    {t('pricing.popular')}
                  </div>
                )}

                <h2 className="text-xl font-bold">{p.name}</h2>
                <div className="mt-4">
                  <span className="text-4xl sm:text-5xl font-extrabold">
                    ₺{price.toLocaleString('tr-TR')}
                  </span>
                  <span className="text-muted-foreground text-sm ml-2">
                    /{cycle === 'annual' ? 'yıl' : 'ay'}
                  </span>
                </div>
                {cycle === 'annual' && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Aylık ortalama ₺{monthlyEq.toLocaleString('tr-TR')}
                  </p>
                )}

                <ul className="space-y-3 text-sm mt-6 mb-8 flex-1">
                  <Feat highlight={highlighted}>{p.articlesPerMonth} {t('pricing.articles_per_month')}</Feat>
                  <Feat highlight={highlighted}>{p.socialPostsPerMonth} {t('pricing.social_posts_per_month')}</Feat>
                  <Feat highlight={highlighted}>{p.sites} {t('pricing.sites')}</Feat>
                  <Feat highlight={highlighted}>{p.publishTargets === 'all' ? t('pricing.all_publish_targets') : t('pricing.markdown_only')}</Feat>
                  <Feat highlight={highlighted}>{p.support}</Feat>
                  <Feat highlight={highlighted}>TR + EN içerik</Feat>
                  <Feat highlight={highlighted}>GEO/AEO optimizasyon</Feat>
                </ul>

                <Button
                  onClick={() => subscribe(p.id)}
                  disabled={loading === p.id}
                  className={`w-full ${
                    highlighted
                      ? 'bg-gradient-to-br from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white shadow-md'
                      : ''
                  }`}
                  variant={highlighted ? 'default' : 'outline'}
                >
                  {loading === p.id ? t('common.loading') : (
                    <>
                      {t('pricing.cta')}
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </>
                  )}
                </Button>
              </div>
            );
          })}
        </div>

        <div className="mt-12 max-w-2xl mx-auto text-center text-sm text-muted-foreground">
          <p className="inline-flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" /> {t('pricing.security_note')}
          </p>
        </div>
      </main>
    </div>
  );
}

function Feat({ children, highlight }: { children: React.ReactNode; highlight?: boolean }) {
  return (
    <li className="flex items-start gap-2 text-foreground/90">
      <CheckCircle2 className={`h-4 w-4 mt-0.5 shrink-0 ${highlight ? 'text-orange-600' : 'text-emerald-600'}`} />
      <span>{children}</span>
    </li>
  );
}
