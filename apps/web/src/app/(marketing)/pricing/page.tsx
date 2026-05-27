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
    <div className="relative overflow-hidden">
      {/* Apple-grade mesh + noise background */}
      <div className="absolute inset-0 -z-10 bg-mesh-warm opacity-80 pointer-events-none" />
      <div className="absolute inset-0 -z-10 bg-noise opacity-[0.04] pointer-events-none" />
      <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[120vw] h-[60vh] -z-10 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-b from-brand-200/20 via-transparent to-transparent dark:from-brand-900/15 blur-3xl" />
      </div>

      <main className="container-apple section-padding stagger-reveal">
        <div className="max-w-[760px] mx-auto text-center mb-16">
          <div className="inline-flex items-center gap-2 px-3 h-7 rounded-full border border-border/60 bg-background/60 backdrop-blur-sm text-[12px] font-medium text-neutral-700 dark:text-neutral-300 mb-7">
            <Sparkles className="h-3 w-3 text-brand-500" />
            <span>14 gün ücretsiz · Kredi kartı yok</span>
          </div>
          <h1 className="text-balance font-medium tracking-display text-neutral-900 dark:text-white text-[clamp(2.5rem,6vw,5rem)] leading-[0.96]">
            Şeffaf fiyat,
            <br />
            <span className="font-display italic text-[1.08em] bg-gradient-to-br from-brand-500 via-rose-500 to-amber-500 bg-clip-text text-transparent">
              ölçeklenebilir plan.
            </span>
          </h1>
          <p className="text-pretty mt-7 max-w-[560px] mx-auto text-[clamp(1.0625rem,1.5vw,1.25rem)] leading-[1.5] text-neutral-600 dark:text-neutral-400">
            {t('pricing.subtitle')}
          </p>
        </div>

        {/* Apple-style segmented control */}
        <div className="flex justify-center mb-16">
          <div className="inline-flex p-1 rounded-full bg-neutral-100 dark:bg-neutral-900 border border-border/60">
            <button
              onClick={() => setCycle('monthly')}
              className={`px-5 h-9 rounded-full text-[13px] font-medium transition-all duration-300 ease-apple ${
                cycle === 'monthly' ? 'bg-background shadow-apple-sm text-foreground' : 'text-neutral-500 hover:text-foreground'
              }`}
            >
              {t('pricing.monthly')}
            </button>
            <button
              onClick={() => setCycle('annual')}
              className={`px-5 h-9 rounded-full text-[13px] font-medium transition-all duration-300 ease-apple relative ${
                cycle === 'annual' ? 'bg-background shadow-apple-sm text-foreground' : 'text-neutral-500 hover:text-foreground'
              }`}
            >
              {t('pricing.annual')}
              <span className="absolute -top-2 -right-2 text-[10px] bg-brand-500 text-white px-1.5 py-0.5 rounded-full font-medium">−%20</span>
            </button>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-6 max-w-[1200px] mx-auto">
          {realPlans.map((p) => {
            const price = cycle === 'annual' ? p.annual : p.monthly;
            const monthlyEq = cycle === 'annual' ? Math.round(p.annual / 12) : p.monthly;
            const highlighted = p.popular;
            return (
              <div
                key={p.id}
                className={`relative rounded-apple border flex flex-col p-8 lg:p-10 transition-all duration-500 ease-apple ${
                  highlighted
                    ? 'bg-foreground text-background border-foreground shadow-apple-xl lg:-translate-y-2'
                    : 'bg-card border-border/60 shadow-apple-sm hover:shadow-apple-md'
                }`}
              >
                {highlighted && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 h-6 inline-flex items-center rounded-full text-[10px] font-medium tracking-[0.06em] uppercase bg-brand-500 text-white shadow-apple-md">
                    {t('pricing.popular')}
                  </div>
                )}

                <h2 className={`text-eyebrow mb-5 ${highlighted ? 'text-brand-400' : 'text-brand-600 dark:text-brand-400'}`}>{p.name}</h2>
                <div className="flex items-baseline gap-1.5 mb-1">
                  <span className="font-medium tracking-display text-[clamp(2.5rem,4vw,3.5rem)] leading-none">
                    ₺{price.toLocaleString('tr-TR')}
                  </span>
                  <span className={`text-[14px] ${highlighted ? 'text-neutral-400' : 'text-neutral-500 dark:text-neutral-400'}`}>
                    /{cycle === 'annual' ? 'yıl' : 'ay'}
                  </span>
                </div>
                {cycle === 'annual' ? (
                  <p className={`text-[12px] mt-1 ${highlighted ? 'text-neutral-400' : 'text-neutral-500 dark:text-neutral-400'}`}>
                    Aylık ortalama ₺{monthlyEq.toLocaleString('tr-TR')}
                  </p>
                ) : <p className={`text-[12px] mt-1 ${highlighted ? 'text-neutral-400' : 'text-neutral-500 dark:text-neutral-400'}`}>&nbsp;</p>}

                <ul className="space-y-3 text-[14px] mt-8 mb-9 flex-1">
                  <Feat highlight={highlighted}>{p.articlesPerMonth} {t('pricing.articles_per_month')}</Feat>
                  <Feat highlight={highlighted}>{p.socialPostsPerMonth} {t('pricing.social_posts_per_month')}</Feat>
                  <Feat highlight={highlighted}>{p.sites} {t('pricing.sites')}</Feat>
                  <Feat highlight={highlighted}>{p.publishTargets === 'all' ? t('pricing.all_publish_targets') : t('pricing.markdown_only')}</Feat>
                  <Feat highlight={highlighted}>{p.support}</Feat>
                  <Feat highlight={highlighted}>TR + EN içerik</Feat>
                  <Feat highlight={highlighted}>GEO/AEO optimizasyon</Feat>
                </ul>

                <button
                  onClick={() => subscribe(p.id)}
                  disabled={loading === p.id}
                  className={`inline-flex items-center justify-center w-full h-11 rounded-full font-medium text-[14px] gap-2 transition-all duration-300 ease-apple disabled:opacity-60 ${
                    highlighted
                      ? 'bg-background text-foreground hover:scale-[1.02] shadow-apple-sm'
                      : 'border border-border bg-background text-foreground hover:bg-neutral-100 dark:hover:bg-neutral-900'
                  }`}
                >
                  {loading === p.id ? t('common.loading') : (
                    <>
                      {t('pricing.cta')}
                      <ArrowRight className="h-3.5 w-3.5" />
                    </>
                  )}
                </button>
              </div>
            );
          })}
        </div>

        <div className="mt-16 max-w-[640px] mx-auto text-center text-[13px] text-neutral-500 dark:text-neutral-400">
          <p className="inline-flex items-center gap-2">
            <ShieldCheck className="h-3.5 w-3.5" /> {t('pricing.security_note')}
          </p>
        </div>
      </main>
    </div>
  );
}

function Feat({ children, highlight }: { children: React.ReactNode; highlight?: boolean }) {
  return (
    <li className="flex items-start gap-2.5">
      <CheckCircle2 className={`h-3.5 w-3.5 mt-1 shrink-0 ${highlight ? 'text-brand-400' : 'text-brand-500'}`} strokeWidth={2.25} />
      <span className={highlight ? 'text-neutral-200' : ''}>{children}</span>
    </li>
  );
}
