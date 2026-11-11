'use client';

import { useT, type Locale } from '@/lib/i18n';

const LOCALES: Locale[] = ['tr', 'en'];

export function LocaleSwitch({ quiet = false }: {
  /**
   * Koyu vitrin: secili dil turuncu dolgu yerine notr bir zeminle isaretlenir.
   * Ust menude hemen yaninda turuncu birincil dugme var; iki turuncu yan yana
   * birincil eylemi zayiflatiyordu.
   */
  quiet?: boolean;
} = {}) {
  const { locale, setLocale } = useT();
  return (
    <div className={`inline-flex items-center gap-1 ${quiet ? 'font-mono text-vitrin-rail' : 'text-xs'}`}>
      {LOCALES.map((l) => {
        const on = locale === l;
        const tone = quiet
          ? on ? 'bg-foreground/10 text-foreground' : 'text-muted-foreground transition-colors duration-200 hover:text-foreground'
          : on ? 'bg-foreground text-background' : 'opacity-60 hover:opacity-100';
        return (
          <button key={l} onClick={() => setLocale(l)} aria-pressed={on} className={`rounded px-2 py-1 ${tone}`}>
            {l.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}
