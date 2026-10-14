'use client';

import Link from 'next/link';
import { useT } from '@/lib/i18n';
import { trackCta } from '@/lib/landing-track';
import { AiVisibilityChecker } from './ai-visibility-checker';
import { WatchVideoButton } from './explainer-dialog';
import { AnswerSheet } from './answer-sheet';

/**
 * Landing hero (yeniden tasarim, Ekim 2026).
 *
 * Konu tek soruda: "Yapay zeka seni tavsiye ediyor mu?" Sol: baslik + alan adi
 * testi (birincil eylem). Sag: canli yazilan ORNEK bir AI cevabi; marka adinin
 * uzerinden fosforlu kalem gecer ve ziyaretci alan adini yazdikca o ad cevaba
 * girer. Eski dondurulen motor adi + orbital diyagram kaldirildi.
 */
export function AiCheckerHero() {
  const { t } = useT();

  return (
    <div className="grid items-start gap-12 lg:grid-cols-12 lg:gap-14">
      <div className="min-w-0 lg:col-span-6 lg:pt-6">
        <h1 className="hero-headline font-brand text-[2.6rem] font-semibold leading-[1.02] tracking-[-0.035em] [text-wrap:balance] sm:text-6xl xl:text-[4.4rem]">
          {t('land2.hero.title')}
        </h1>

        <p className="hero-subtitle mt-6 max-w-[34rem] text-lg leading-relaxed text-muted-foreground">
          {t('land2.hero.sub')}
        </p>

        <div className="mt-9 max-w-[34rem]">
          <p id="checker-hint" className="mb-3 text-sm font-medium text-foreground">{t('land2.hero.checker')}</p>
          <AiVisibilityChecker />
        </div>

        <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
          <Link
            href="/signin?signup=1"
            onClick={() => trackCta('hero_signup')}
            className="font-semibold text-foreground underline decoration-brand decoration-2 underline-offset-[6px] hover:text-brand-700 dark:hover:text-brand-300"
          >
            {t('land2.hero.signup')}
          </Link>
          <WatchVideoButton label="land2.hero.watch" source="hero" variant="link" size="sm" className="h-auto px-0 text-sm font-semibold text-muted-foreground hover:text-foreground" />
        </div>
      </div>

      <div className="min-w-0 lg:col-span-6">
        <AnswerSheet />
      </div>
    </div>
  );
}
