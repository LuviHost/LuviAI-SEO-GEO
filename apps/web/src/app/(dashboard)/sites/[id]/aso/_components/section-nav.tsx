'use client';

import { KeyRound, Megaphone, Smartphone } from 'lucide-react';
import { siteHref } from '@/lib/site-routes';
import { LinkTabs } from './app-bits';

/**
 * ASO bölümünün site düzeyi gezintisi. Apple Search Ads ve App Store Connect
 * site genelinde birer hesap bağlantısıdır — eskiden tek bir uygulamanın
 * modalının içine gömülüydü.
 */
export function AsoSectionNav({ siteId }: { siteId: string }) {
  const base = siteHref(siteId, 'aso');
  return (
    <LinkTabs
      label="ASO bölümleri"
      items={[
        { href: base, label: 'Uygulamalar', icon: Smartphone, exact: true },
        { href: `${base}/ads`, label: 'Apple Search Ads', icon: Megaphone },
        { href: `${base}/connect`, label: 'App Store Connect', icon: KeyRound },
      ]}
    />
  );
}
