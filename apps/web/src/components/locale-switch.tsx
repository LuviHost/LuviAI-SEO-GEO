'use client';

import { useT } from '@/lib/i18n';

export function LocaleSwitch() {
  const { locale, setLocale } = useT();
  return (
    <div className="inline-flex items-center gap-1 text-xs">
      <button
        onClick={() => setLocale('tr')}
        className={`px-2 py-1 rounded ${locale === 'tr' ? 'bg-brand text-white' : 'opacity-60 hover:opacity-100'}`}
      >TR</button>
      <button
        onClick={() => setLocale('en')}
        className={`px-2 py-1 rounded ${locale === 'en' ? 'bg-brand text-white' : 'opacity-60 hover:opacity-100'}`}
      >EN</button>
    </div>
  );
}
