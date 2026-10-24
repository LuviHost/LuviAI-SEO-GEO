'use client';

import { useT } from '@/lib/i18n';
import { formatPageDate, pageUpdated, CONTENT_AUTHOR } from '@/lib/page-updated';
import { cn } from '@/lib/utils';

/**
 * Gorunur "Son güncelleme: 22 Ekim 2026 · RanksUp Ekibi" satiri. Tarih tek kaynaktan
 * (lib/page-updated.ts, sitemap lastModified ile ayni); AI asistanlari ve okur sayfanin
 * ne kadar taze oldugunu ve kimin yazdigini metinden gorur.
 *
 * Istemci bileseni yalniz dil secimi icin (useT); sunucu 'tr' basar, yani JS calistirmayan
 * tarayici da Turkce satiri ve makine-okunur <time dateTime> degerini gorur.
 */
export function PageUpdatedLine({ path, className }: { path: string; className?: string }) {
  const { locale } = useT();
  const iso = pageUpdated(path);
  return (
    <p className={cn('text-xs text-muted-foreground', className)}>
      {locale === 'en' ? 'Last updated' : 'Son güncelleme'}:{' '}
      <time dateTime={iso}>{formatPageDate(iso, locale)}</time>
      {' · '}
      <span>{CONTENT_AUTHOR[locale]}</span>
    </p>
  );
}
