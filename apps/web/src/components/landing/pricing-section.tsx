'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useT, type Locale } from '@/lib/i18n';
import { trackCta } from '@/lib/landing-track';
import { cn } from '@/lib/utils';
import type { LandingPlan } from './landing-data';
import { PlanEngineRow } from '@/components/plan-engine-row';
import { PlanFeatureList } from '@/components/plan-feature-list';

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
      {/* Uc paket (11.11.2026): Baslangic, Profesyonel, Kurumsal — /pricing ile ayni kart duzeni */}
      <div className="grid border-l border-t border-border lg:grid-cols-3">
        {plans.length === 0
          ? Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-96 animate-pulse border-b border-r border-border bg-card" />)
          : plans
              .filter((p) => p.id !== 'trial')
              .map((p) => {
                const monthlyEq = billing === 'annual' ? Math.round(p.annual / 12) : p.monthly;
                // TL karsiligi gosterilmez — fiyat USD'de kanonik, TL odeme aninda hesaplanir.
                return (
                  <PriceCard
                    key={p.id}
                    name={p.name}
                    tagline={p.tagline}
                    engines={p.engines}
                    enginesLabel={locale === 'en' ? 'AI assistants measured' : 'Ölçülen AI asistanları'}
                    price={p.contactSales ? t('land.pric.enterprise_label') : `$${monthlyEq.toLocaleString('en-US')}`}
                    period={p.contactSales ? '' : t('land.pric.per_month')}
                    annualNote={
                      p.contactSales
                        ? (locale === 'en' ? 'Scope and price are agreed in a call.' : 'Kapsam ve fiyat görüşmeyle belirlenir.')
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
  name, tagline, engines, enginesLabel, price, period, annualNote, bullets, inheritLabel, cta, popularLabel, highlighted, onCtaClick,
}: {
  name: string; price: string; period: string; annualNote: string;
  /** Plan adinin altindaki tek satir tanim (plans.ts tagline) */
  tagline?: string;
  /** Bu planin olctugu asistanlar (saglayici kimlikleri) — API'den */
  engines?: string[];
  enginesLabel: string;
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
        <h3 className="text-xl font-medium tracking-[-0.02em]">{name}</h3>
        {highlighted && <p className="font-mono text-vitrin-rail text-brand-vivid">{popularLabel}</p>}
      </div>
      <p className="mt-2 min-h-10 text-sm leading-5 text-muted-foreground">{tagline}</p>
      <div className="mb-1 mt-6 flex items-baseline gap-1">
        <span className="text-5xl font-[450] tracking-[-0.05em] tabular-nums">{price}</span>
        <span className="text-sm text-muted-foreground">{period}</span>
      </div>
      <p className="min-h-4 text-xs text-muted-foreground">{annualNote}</p>
      {/* Buton fiyatin hemen altinda (/pricing ile ayni sira): madde listesinin sonuna inmeden gorunur */}
      <Link href="/pricing" onClick={onCtaClick} className={cn(highlighted ? 'v-btn' : 'v-btn-line', 'mt-6 w-full')}>
        {cta}
      </Link>
      <PlanEngineRow engines={engines} label={enginesLabel} className="mt-7 border-t border-border pt-6" />
      {inheritLabel && <p className="mt-5 text-sm text-muted-foreground">{inheritLabel}</p>}
      <PlanFeatureList features={bullets} className={inheritLabel ? 'mt-3' : 'mt-5'} />
    </div>
  );
}
