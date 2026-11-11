'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Check } from 'lucide-react';
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
      <div className="mb-10 inline-flex rounded-md border border-border p-1" role="group" aria-label={t('land.pricing.title')}>
        {(['monthly', 'annual'] as const).map((b) => (
          <button
            key={b}
            type="button"
            aria-pressed={billing === b}
            onClick={() => setBilling(b)}
            className={cn(
              'inline-flex h-9 items-center gap-2 rounded px-4 text-sm font-medium transition-colors duration-200',
              billing === b ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t(b === 'monthly' ? 'land.pric.monthly' : 'land.pric.annual')}
            {b === 'annual' && (
              <span className={cn('font-mono text-vitrin-rail', billing === b ? 'opacity-70' : 'text-brand-vivid')}>
                {t('land.pric.discount_badge')}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Bitisik hucreler: kartlar arasi bosluk yerine tek ince cizgi */}
      <div className="grid border-l border-t border-border sm:grid-cols-2 lg:grid-cols-4">
        {plans.length === 0
          ? Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-96 animate-pulse border-b border-r border-border bg-card" />)
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
    <div className={cn('relative flex flex-col border-b border-r border-border p-6 sm:p-7', highlighted && 'bg-card')}>
      {/* Onerilen plan: ustte turuncu cizgi + etiket (cerceve/halka yerine) */}
      {highlighted && <span className="absolute inset-x-0 top-0 h-0.5 bg-brand-vivid" aria-hidden />}
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-base font-medium">{name}</h3>
        {highlighted && <p className="font-mono text-vitrin-rail text-brand-vivid">{popularLabel}</p>}
      </div>
      <div className="mb-1 mt-6 flex items-baseline gap-1">
        <span className="text-5xl font-[450] tracking-[-0.05em] tabular-nums">{price}</span>
        <span className="text-sm text-muted-foreground">{period}</span>
      </div>
      <p className="min-h-4 text-xs text-muted-foreground">{annualNote}</p>
      {inheritLabel && <p className="mt-6 text-sm text-muted-foreground">{inheritLabel}</p>}
      <ul className={cn('mb-8 flex-1 space-y-2.5 text-sm leading-relaxed', inheritLabel ? 'mt-3' : 'mt-6')}>
        {bullets.map((b, i) => (
          <li key={i} className="flex items-start gap-2.5">
            <Check className="mt-1 h-3.5 w-3.5 shrink-0 text-brand-vivid" aria-hidden />
            <span>{b}</span>
          </li>
        ))}
      </ul>
      <Link href="/pricing" onClick={onCtaClick} className={cn(highlighted ? 'v-btn' : 'v-btn-line', 'w-full')}>
        {cta}
      </Link>
    </div>
  );
}
