'use client';

import { useT } from '@/lib/i18n';

/** Sayfa yolunun ilk adimi: TR "Ana Sayfa", EN "Home" (JSON-LD BreadcrumbList Turkce kalir) */
export function BreadcrumbHomeLabel() {
  const { locale } = useT();
  return <>{locale === 'en' ? 'Home' : 'Ana Sayfa'}</>;
}
