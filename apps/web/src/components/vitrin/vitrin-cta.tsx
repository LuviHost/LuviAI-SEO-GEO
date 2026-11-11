import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { T, TrackedLink } from '@/components/landing/landing-islands';
import { VITRIN_WRAP } from '@/lib/vitrin';

/**
 * Vitrin sayfalarinin ortak kapanisi: iki tonlu cagri + noktalardan cizilmis
 * marka oku. Birincil dugme her sayfadan ana sayfadaki alan adi testine gider
 * (sitenin ana eylemi); ikincisi kayit.
 */
export function VitrinCta() {
  return (
    <section className="relative overflow-hidden border-t border-border">
      <DotArrow className="pointer-events-none absolute -right-24 top-1/2 h-[30rem] w-[30rem] -translate-y-1/2 text-brand-vivid opacity-25 [mask-image:linear-gradient(to_left,black_30%,transparent)] lg:right-0 lg:h-[38rem] lg:w-[38rem] lg:opacity-90" />
      <div className={`${VITRIN_WRAP} relative py-28 lg:py-40`}>
        <h2 className="text-vitrin-1">
          <span className="block"><T k="land3.cta.a" /></span>{' '}
          <span className="block text-dim"><T k="land3.cta.b" /></span>
        </h2>
        <p className="mt-8 max-w-xl text-base leading-[1.75] text-muted-foreground"><T k="land.cta.subtitle" /></p>
        <div className="mt-10 flex flex-wrap items-center gap-3">
          <Link href="/#test" className="v-btn h-12 px-6 text-base">
            <T k="land2.cta.test" />
            <ArrowUpRight className="h-4 w-4" aria-hidden />
          </Link>
          <TrackedLink href="/signin?signup=1" cta="final_primary" className="v-btn-line h-12 px-6 text-base">
            <T k="land.cta.button" />
          </TrackedLink>
        </div>
      </div>
    </section>
  );
}

/**
 * Marka isareti (yukselen ok) kucuk karelerden olusur — ok, brand-logo.tsx'teki
 * "Bridge" isaretinin ayni cizimi. Renk currentColor.
 */
function DotArrow({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 240 240" fill="none" aria-hidden className={className}>
      <defs>
        <pattern id="vitrin-kare" width="6" height="6" patternUnits="userSpaceOnUse">
          <rect x="1.5" y="1.5" width="3" height="3" fill="currentColor" />
        </pattern>
        {/* Yatay ve dikey kollarin kenarlari 6 birimlik izgaraya oturur (24-60, 180-216):
            oturmazsa kenardaki kareler yarim kesilip kesik cizgi gibi gorunuyor */}
        <mask id="vitrin-ok">
          <g stroke="white" strokeWidth="36" strokeLinecap="square" strokeLinejoin="miter">
            <path d="M42 198 L186 54" />
            <path d="M84 42 L198 42 L198 156" />
          </g>
        </mask>
      </defs>
      <rect width="240" height="240" fill="url(#vitrin-kare)" mask="url(#vitrin-ok)" />
    </svg>
  );
}
