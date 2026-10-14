'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useTheme } from 'next-themes';
import { useT } from '@/lib/i18n';
import { useReducedMotion } from '@/lib/use-reduced-motion';

/**
 * Hero altindaki urun videosu — apps/video HeroLoop (20 sn, sessiz, kusursuz dongu).
 *
 * - Tema: light/dark iki ayri render; tema degisince kaynak degisir.
 * - Hidrasyondan once ve "hareketi azalt" tercihinde yalniz poster (CSS ile temaya
 *   gore) gosterilir; video hic istenmez.
 * - Dosya bulunamazsa (ornegin render alinmamis bir ortam) eski JSX mock'u
 *   (ProductPreview) ayri bir parca olarak yuklenir.
 */

const ProductPreview = dynamic(() => import('./product-preview'), { ssr: false });

const W = 1440;
const H = 810;
/** apps/video/scripts/render.mjs posterFrame 520 / 30 fps */
const POSTER_SECONDS = 520 / 30;

export function HeroVideo() {
  const { t } = useT();
  const { resolvedTheme } = useTheme();
  const reduced = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => setMounted(true), []);

  if (failed) return <ProductPreview />;

  const variant = resolvedTheme === 'dark' ? 'dark' : 'light';
  const label = t('land.hero.video_label');

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-2xl">
      {!mounted || reduced ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/landing-media/hero-loop-light.jpg" alt={label} width={W} height={H} className="block h-full w-full object-cover dark:hidden" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/landing-media/hero-loop-dark.jpg" alt={label} width={W} height={H} className="hidden h-full w-full object-cover dark:block" />
        </>
      ) : (
        <video
          key={variant}
          className="block h-full w-full object-cover"
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          poster={`/landing-media/hero-loop-${variant}.jpg`}
          width={W}
          height={H}
          aria-label={label}
          // Poster dolu paneli (kare 520) gosteriyor; oynatma da oradan baslasin ki
          // poster → bos panel sicramasi olmasin. Dongu bu noktadan sonra kendini kurar.
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            if (v.duration > POSTER_SECONDS) v.currentTime = POSTER_SECONDS;
          }}
        >
          <source src={`/landing-media/hero-loop-${variant}.mp4`} type="video/mp4" />
          {/* Son kaynak da yuklenemezse hata yalniz burada tetiklenir */}
          <source src={`/landing-media/hero-loop-${variant}.webm`} type="video/webm" onError={() => setFailed(true)} />
        </video>
      )}
    </div>
  );
}
