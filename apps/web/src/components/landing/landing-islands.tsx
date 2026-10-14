'use client';

/**
 * Landing'in kucuk istemci adaciklari. page.tsx server bilesen; dil secimi
 * istemcide (localStorage) tutuldugu icin metinler <T k="..."/> yapraklarinda
 * cozulur — bolum iskeleti sunucuda kalir, yalniz metin dugumu hidrasyona girer.
 * SSR'da 'tr' basilir (i18n getServerSnapshot), EN ziyaretcide hidrasyonda degisir.
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useT, type Key } from '@/lib/i18n';
import { trackCta, trackPageview, setupScrollDepthTracking, setupSectionTracking } from '@/lib/landing-track';

export function T({ k }: { k: Key }) {
  const { t } = useT();
  return <>{t(k)}</>;
}

/** Sayiyi secili dile gore bicimler (TR 1.559 / 4,8 — EN 1,559 / 4.8) */
export function LocaleNumber({ value, decimals = 0 }: { value: number; decimals?: number }) {
  const { locale } = useT();
  return (
    <>
      {value.toLocaleString(locale === 'tr' ? 'tr-TR' : 'en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}
    </>
  );
}

/** Tiklamasi olculen baglanti (server bilesenden onClick gecilemez) */
export function TrackedLink({
  href,
  cta,
  className,
  children,
}: {
  href: string;
  cta: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className={className} onClick={() => trackCta(cta)}>
      {children}
    </Link>
  );
}

/** Sayfa goruntuleme + kaydirma derinligi + bolum gorunurlugu — bir kez kurulur */
export function LandingAnalytics({ sections }: { sections: string[] }) {
  useEffect(() => {
    trackPageview();
    const offScroll = setupScrollDepthTracking();
    const offSection = setupSectionTracking(sections);
    return () => { offScroll?.(); offSection?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

/**
 * Gorunume girince 0'dan hedefe sayan rakam. "6.5x" / "729K" / "2.9" gibi
 * on/son eki korur, yalniz sayiyi canlandirir. Hareketi azalt tercihinde direkt
 * hedef deger basilir. SSR'da hedef deger basilir (JS'siz ziyaretci/arama motoru
 * dogru rakami gorur), hidrasyon sonrasi gorunume girince sayar.
 */
export function AnimatedNumber({ raw }: { raw: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const match = raw.match(/-?[\d.]+/);
  const target = match ? parseFloat(match[0]) : 0;
  const prefix = match ? raw.slice(0, match.index!) : '';
  const suffix = match ? raw.slice(match.index! + match[0].length) : raw;
  const [val, setVal] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    let started = false;
    let first = true;
    let raf = 0;
    const obs = new IntersectionObserver(
      (entries) => {
        // Ilk olcumde zaten ekrandaysa (ust kisim) SSR degeri kalir — sifira inip
        // yeniden saymak goz kirpmasi yaratirdi.
        if (first) {
          first = false;
          if (entries[0].isIntersecting) { started = true; return; }
        }
        if (!entries[0].isIntersecting || started) return;
        started = true;
        const start = performance.now();
        const tick = (now: number) => {
          const p = Math.min(1, (now - start) / 1400);
          setVal(target * (1 - Math.pow(1 - p, 3)));
          if (p < 1) raf = requestAnimationFrame(tick);
        };
        setVal(0);
        raf = requestAnimationFrame(tick);
      },
      { threshold: 0.4 },
    );
    obs.observe(el);
    return () => { obs.disconnect(); cancelAnimationFrame(raf); };
  }, [target]);

  const v = val ?? target;
  const decimals = match && match[0].includes('.') ? match[0].split('.')[1].length : 0;
  return (
    <span ref={ref} className="tabular-nums">
      {prefix}
      {v.toFixed(decimals)}
      {suffix}
    </span>
  );
}
