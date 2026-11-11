'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Play } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { trackCta } from '@/lib/landing-track';
import { cn } from '@/lib/utils';
import { AiVisibilityChecker } from './ai-visibility-checker';
import { openExplainer } from './explainer-dialog';
import { AnswerSheet, EngineChip, stripEngines } from './answer-sheet';

/**
 * Landing hero (koyu vitrin, Kasim 2026).
 *
 * Konu tek soruda: "Yapay zeka seni tavsiye ediyor mu?" Sol: iki tonlu baslik +
 * alan adi testi (birincil eylem). Sag: canli yazilan ORNEK bir AI cevabi; marka
 * adinin uzerinden turuncu kalem gecer ve ziyaretci alan adini yazdikca o ad
 * cevaba girer. Altta olculen asistanlarin seridi; cevap hangi asistanda
 * yaziliyorsa serit onu isaretler (eski yorunge yaylarinin yerine).
 *
 * `engines`: API'nin "su an olculuyor" dedigi saglayicilar (GET /billing/plans →
 * measuredEngines, sayfa sunucuda ceker). Serit ve "N asistanda" sayisi bundan
 * turer: 6 sabit asistan + anahtari tanimliysa Muse. Verilmezse 6.
 */
export function AiCheckerHero({ engines }: { engines?: readonly string[] } = {}) {
  const { t } = useT();
  const [engine, setEngine] = useState(0);
  const strip = stripEngines(engines);

  return (
    <>
      <div className="mx-auto grid max-w-7xl items-center gap-14 px-4 pb-16 pt-14 sm:px-6 lg:grid-cols-12 lg:gap-10 lg:px-8 lg:pb-24 lg:pt-24">
        <div className="min-w-0 lg:col-span-7">
          <h1 className="hero-headline text-vitrin-1">
            <span className="block">{t('land3.hero.a')}</span>{' '}
            <span className="block text-dim">{t('land3.hero.b')}</span>
          </h1>

          <p className="hero-subtitle mt-8 max-w-[34rem] text-base leading-[1.75] text-muted-foreground">
            {t('land2.hero.sub')}
          </p>

          <div className="mt-10 max-w-[34rem]">
            <AiVisibilityChecker />
            <p id="checker-hint" className="mt-3 text-sm leading-relaxed text-muted-foreground">
              {t('land3.hero.checker').replace('{n}', String(strip.length))}
            </p>
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-x-7 gap-y-3 text-sm">
            <Link
              href="/signin?signup=1"
              onClick={() => trackCta('hero_signup')}
              className="inline-flex items-center gap-1.5 border-b border-white/30 pb-0.5 font-medium text-foreground transition-colors duration-200 hover:border-brand-vivid hover:text-brand-vivid"
            >
              {t('land2.hero.signup')}
              <ArrowUpRight className="h-4 w-4" aria-hidden />
            </Link>
            <button
              type="button"
              onClick={() => openExplainer('hero')}
              className="inline-flex items-center gap-2 text-muted-foreground transition-colors duration-200 hover:text-foreground"
            >
              <Play className="h-3.5 w-3.5" aria-hidden />
              {t('land2.hero.watch')}
            </button>
          </div>
        </div>

        <div className="relative min-w-0 lg:col-span-5">
          <div
            className="v-dots pointer-events-none absolute -inset-x-16 -inset-y-20 [mask-image:radial-gradient(farthest-side,black_62%,transparent)]"
            aria-hidden
          />
          <AnswerSheet engine={engine} onEngineChange={setEngine} />
        </div>
      </div>

      {/* Olculen asistanlar — etkin sekme isaretli */}
      <div className="border-t border-border">
        <div className="mx-auto flex max-w-7xl flex-col gap-x-10 gap-y-3 px-4 py-5 sm:flex-row sm:items-center sm:px-6 lg:px-8">
          <p className="v-rail shrink-0">{t('land3.engines').replace('{n}', String(strip.length))}</p>
          <ul className="flex flex-wrap items-center gap-x-7 gap-y-3">
            {strip.map(({ label, vendor }, i) => (
              <li
                key={vendor}
                className={cn(
                  'flex items-center gap-2 border-b py-1 text-sm transition-colors duration-200',
                  i === engine ? 'border-brand-vivid text-foreground' : 'border-transparent text-muted-foreground',
                )}
              >
                <EngineChip vendor={vendor} />
                {label}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}
