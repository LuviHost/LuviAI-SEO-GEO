'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useT, type Locale } from '@/lib/i18n';
import { trackCta } from '@/lib/landing-track';
import { cn } from '@/lib/utils';
import type { LandingPlan } from './landing-data';

/**
 * Landing fiyat kartlari. Plan verisi SUNUCUDA (ISR) iki dil icin cekilip prop olarak
 * gelir — ilk boyamada bos grid yok. Sunucu cekimi basarisiz olduysa (API kapali,
 * build ani) eski davranisa duser: istemcide /billing/plans istenir.
 * Plan adi ve maddeler tek kaynaktan: apps/api/src/billing/plans.ts.
 */
export function PricingSection({ initialPlans }: { initialPlans: Record<Locale, LandingPlan[]> }) {
  const { t, locale } = useT();
  const [billing, setBilling] = useState<'monthly' | 'annual'>('annual');
  const [fetched, setFetched] = useState<Partial<Record<Locale, LandingPlan[]>>>({});
  const plans = (initialPlans[locale]?.length ? initialPlans[locale] : fetched[locale]) ?? [];

  useEffect(() => {
    if (initialPlans[locale]?.length || fetched[locale]) return;
    // Yedek yol (sunucu cekimi bos geldiyse) — api.ts yalniz burada, gerekince yuklenir
    import('@/lib/api')
      .then(({ api }) => api.getPlans(locale))
      .then((r) => setFetched((f) => ({ ...f, [locale]: (r?.plans as LandingPlan[]) ?? [] })))
      .catch(() => {});
  }, [locale, initialPlans, fetched]);

  return (
    <>
      <div className="flex items-center justify-center gap-3 mb-12" role="group" aria-label={t('land.pricing.title')}>
        {(['monthly', 'annual'] as const).map((b) => (
          <button
            key={b}
            type="button"
            aria-pressed={billing === b}
            onClick={() => setBilling(b)}
            className={cn(
              'relative px-4 py-2 rounded-lg text-sm font-semibold transition',
              billing === b ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t(b === 'monthly' ? 'land.pric.monthly' : 'land.pric.annual')}
            {b === 'annual' && (
              <span className="absolute -top-3 -right-3 text-label bg-success text-white px-1.5 py-0.5 rounded-full font-bold">
                {t('land.pric.discount_badge')}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5 max-w-7xl mx-auto">
        {plans.length === 0
          ? Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-96 rounded-2xl border bg-muted/30 animate-pulse" />)
          : plans
              .filter((p) => p.id !== 'trial')
              .map((p) => {
                const monthlyEq = billing === 'annual' ? Math.round(p.annual / 12) : p.monthly;
                // TL karsiligi gosterilmez — fiyat USD'de kanonik, TL odeme aninda hesaplanir.
                return (
                  <PriceCard
                    key={p.id}
                    name={p.name}
                    price={p.contactSales ? t('land.pric.enterprise_label') : `$${monthlyEq.toLocaleString('en-US')}`}
                    period={p.contactSales ? '' : t('land.pric.per_month')}
                    annualNote={
                      p.contactSales
                        ? ''
                        : billing === 'annual'
                          ? `${t('land.pric.annual_billed_prefix')} $${p.annual.toLocaleString('en-US')} ${t('land.pric.annual_billed_suffix')}`
                          : t('land.pric.monthly_billed')
                    }
                    bullets={p.features ?? []}
                    inheritLabel={p.inheritsLabel}
                    cta={p.contactSales ? t('land.pric.cta_contact') : t('land.pric.cta_free')}
                    popularLabel={t('land.pricing.most_popular')}
                    highlighted={!!p.popular}
                    onCtaClick={() => trackCta('pricing_cta', { planId: p.id, billing })}
                  />
                );
              })}
      </div>
    </>
  );
}

function PriceCard({
  name, price, period, annualNote, bullets, inheritLabel, cta, popularLabel, highlighted, onCtaClick,
}: {
  name: string; price: string; period: string; annualNote: string;
  bullets: string[];
  /** "X'teki her sey, arti:" — ust planlar yalniz FARKI listeler */
  inheritLabel?: string;
  cta: string; popularLabel: string; highlighted?: boolean;
  onCtaClick?: () => void;
}) {
  return (
    <div
      className={cn(
        'relative flex flex-col rounded-[20px] border bg-card p-7',
        highlighted ? 'border-brand ring-1 ring-brand' : 'border-border',
      )}
    >
      {highlighted && (
        <p className="absolute -top-3 left-6 whitespace-nowrap rounded-full bg-brand px-3 py-1 text-label font-semibold text-white">
          {popularLabel}
        </p>
      )}
      <h3 className="font-brand text-lg font-semibold">{name}</h3>
      <div className="mt-4 mb-1">
        <span className="font-brand text-4xl font-semibold tracking-[-0.03em] tabular-nums">{price}</span>
        <span className="text-muted-foreground text-sm">{period}</span>
      </div>
      <p className="text-xs text-muted-foreground min-h-4">{annualNote}</p>
      {inheritLabel && <p className="mt-5 text-sm font-medium text-muted-foreground">{inheritLabel}</p>}
      <ul className={cn('space-y-2 text-sm mb-6 flex-1', inheritLabel ? 'mt-3' : 'mt-5')}>
        {bullets.map((b, i) => (
          <li key={i} className="flex items-start gap-2">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-700 dark:text-brand-300" aria-hidden />
            <span>{b}</span>
          </li>
        ))}
      </ul>
      <Button
        asChild
        className={cn('w-full', highlighted && 'bg-brand text-white hover:bg-brand-600')}
        variant={highlighted ? 'default' : 'outline'}
      >
        <Link href="/pricing" onClick={onCtaClick}>
          {cta}
        </Link>
      </Button>
    </div>
  );
}
