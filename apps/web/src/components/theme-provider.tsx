'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import { ThemeProvider as NextThemesProvider } from 'next-themes';
import { isVitrinPath } from '@/lib/vitrin';

/**
 * Vitrin sayfalari (koyu sahne — lib/vitrin.ts, globals.css `.vitrin`) ziyaretcinin
 * tema seciminden bagimsiz koyu cizilir. forcedTheme kayitli tercihi DEGISTIRMEZ;
 * panelde ve diger sayfalarda kullanicinin temasi aynen surer.
 */
export function ThemeProvider({ children, ...props }: React.ComponentProps<typeof NextThemesProvider>) {
  const pathname = usePathname();
  const forced = isVitrinPath(pathname) ? 'dark' : undefined;
  return <NextThemesProvider {...props} forcedTheme={forced}>{children}</NextThemesProvider>;
}
