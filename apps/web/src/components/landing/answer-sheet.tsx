'use client';

import { useEffect, useMemo, useState } from 'react';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { useReducedMotion } from '@/lib/use-reduced-motion';
import { VendorLogo, type VendorName } from '@/components/vendor-logo';

/**
 * Hero'nun tek "cesur" ogesi: bir AI asistaninin ornek cevabi yazilir, markanin
 * anildigi yerin uzerinden turuncu bir fosforlu kalem gecer. Ziyaretci alan
 * adini yazdikca (DOMAIN_EVENT) cevaptaki marka onun alan adi olur.
 *
 * DURUSTLUK: kart "Ornek cevap" etiketlidir; diger markalar uydurma adlardir
 * (gercek rakip adi kullanilmaz). Gercek sonuc alan adi testindedir.
 */
export const DOMAIN_EVENT = 'ranksup:domain';

/** Sekmeler (ornek cevap bu dort asistanda doner) */
const ENGINES: Array<{ label: string; vendor: VendorName }> = [
  { label: 'ChatGPT', vendor: 'chatgpt' },
  { label: 'Gemini', vendor: 'gemini' },
  { label: 'Claude', vendor: 'claude-ai' },
  { label: 'Perplexity', vendor: 'perplexity' },
];
/** Olculen 7 asistanin logo dizisi — dikkat ceken ust serit (eski orbital diyagramin yerine) */
const MEASURED: Array<{ label: string; vendor: VendorName }> = [
  ...ENGINES,
  { label: 'Grok', vendor: 'grok' },
  { label: 'DeepSeek', vendor: 'deepseek' },
  { label: 'Meta AI', vendor: 'meta-ai' },
];
const FALLBACK_BRAND = 'markan.com';
const TYPE_STEP = 2;         // her tikte kac karakter
const TYPE_MS = 22;
const HOLD_MS = 5200;        // cevap tamamlaninca bekleme

function cleanDomain(v: string): string {
  return v.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].slice(0, 40);
}

export function AnswerSheet() {
  const { t } = useT();
  const reduced = useReducedMotion();
  const [engine, setEngine] = useState(0);
  const [typed, setTyped] = useState(0);
  const [brand, setBrand] = useState(FALLBACK_BRAND);
  const [pinned, setPinned] = useState(false); // kullanici sekme secti → otomatik gecis durur

  // Alan adi kutusundan gelen yazim
  useEffect(() => {
    const onDomain = (e: Event) => {
      const v = cleanDomain(String((e as CustomEvent<string>).detail ?? ''));
      setBrand(v.includes('.') ? v : FALLBACK_BRAND);
    };
    window.addEventListener(DOMAIN_EVENT, onDomain);
    return () => window.removeEventListener(DOMAIN_EVENT, onDomain);
  }, []);

  const parts = useMemo(
    () => [
      { text: t('land2.sheet.a1'), mark: false },
      { text: brand, mark: true, cite: 1 },
      { text: t('land2.sheet.a2'), mark: false },
      { text: t('land2.sheet.a3'), mark: false },
    ],
    [t, brand],
  );
  const total = parts.reduce((n, p) => n + p.text.length, 0);
  const shown = reduced ? total : Math.min(typed, total);

  // Yazma + bekle + sonraki asistan (hareket azaltildiysa hepsi statik)
  useEffect(() => {
    if (reduced) return;
    if (typed < total) {
      const id = window.setTimeout(() => setTyped((n) => n + TYPE_STEP), TYPE_MS);
      return () => window.clearTimeout(id);
    }
    if (pinned) return;
    const id = window.setTimeout(() => {
      setEngine((e) => (e + 1) % ENGINES.length);
      setTyped(0);
    }, HOLD_MS);
    return () => window.clearTimeout(id);
  }, [typed, total, pinned, reduced]);

  // Marka degisince cevabi yeniden yazmak yerine tamamlanmis goster
  useEffect(() => { setTyped((n) => (n > 0 ? Number.MAX_SAFE_INTEGER : n)); }, [brand]);

  let budget = shown;
  const done = shown >= total;

  return (
    <div>
      {/* 7 asistan logosu — o an yazilan asistan turuncu halkayla one cikar */}
      <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-3">
        <ul className="flex -space-x-3" aria-label={MEASURED.map((m) => m.label).join(', ')}>
          {MEASURED.map((m, i) => {
            const active = i === engine;
            return (
              <li
                key={m.vendor}
                title={m.label}
                className={cn(
                  'grid h-14 w-14 place-items-center rounded-full bg-white shadow-[0_6px_16px_-6px_rgb(0_0_0/0.25)] ring-[3px] ring-background',
                  'motion-safe:transition-transform motion-safe:duration-300',
                  active && 'relative z-10 ring-brand motion-safe:-translate-y-1.5',
                )}
              >
                {/* Beyaz zemin: renkli logolar koyu temada da gorunsun */}
                <VendorLogo name={m.vendor} size={30} alt="" />
              </li>
            );
          })}
        </ul>
        <p className="text-sm font-medium text-muted-foreground">{t('land2.sheet.measured')}</p>
      </div>

    <figure className="relative rounded-[20px] border border-border bg-card shadow-[0_1px_0_hsl(var(--border)),0_24px_60px_-28px_rgb(0_0_0/0.25)]">
      {/* Asistan secimi */}
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 sm:px-5">
        <div role="tablist" aria-label={t('land2.sheet.engines')} className="-mb-px flex min-w-0 gap-1 overflow-x-auto">
          {ENGINES.map(({ label: name, vendor }, i) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={engine === i}
              onClick={() => { setEngine(i); setTyped(reduced ? total : 0); setPinned(true); }}
              className={cn(
                'inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-2.5 py-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2',
                engine === i ? 'border-brand font-semibold text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              <VendorLogo name={vendor} size={16} alt="" />
              {name}
            </button>
          ))}
        </div>
        <span className="shrink-0 rounded-full border border-border px-2.5 py-0.5 text-label text-muted-foreground">{t('land2.sheet.label')}</span>
      </div>

      <div className="space-y-5 px-4 py-5 sm:px-6 sm:py-6">
        {/* Soru */}
        <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-muted px-4 py-2.5 text-[0.95rem] leading-relaxed">
          {t('land2.sheet.query')}
        </p>

        {/* Cevap — fosforlu kalem markanin uzerinden gecer */}
        <p className="min-h-[7.5rem] text-[1.05rem] leading-[1.75]" aria-live="off">
          {parts.map((p, i) => {
            const take = Math.max(0, Math.min(p.text.length, budget));
            budget -= take;
            if (take === 0) return null;
            const text = p.text.slice(0, take);
            if (!p.mark) return <span key={i}>{text}</span>;
            const complete = take === p.text.length;
            return (
              <span key={i}>
                <mark
                  className={cn(
                    // bg-transparent: tarayicinin <mark> icin varsayilan SARI zemini kalem gecerken gorunuyordu
                    'rounded-[3px] bg-transparent bg-no-repeat px-0.5 font-semibold text-foreground',
                    'bg-[linear-gradient(hsl(var(--highlighter)),hsl(var(--highlighter)))]',
                    'motion-safe:transition-[background-size] motion-safe:duration-700 motion-safe:ease-out',
                    complete ? '[background-size:100%_100%]' : '[background-size:0%_100%]',
                  )}
                >
                  {text}
                </mark>
                {complete && <sup className="ml-0.5 text-label font-semibold text-brand-700 dark:text-brand-300">[{p.cite}]</sup>}
              </span>
            );
          })}
          {!done && <span className="ml-0.5 inline-block h-[1.1em] w-[2px] translate-y-[3px] bg-foreground/70 motion-safe:animate-pulse" aria-hidden />}
        </p>

        {/* Kaynaklar */}
        <div className={cn('border-t border-border pt-4 transition-opacity duration-500', done ? 'opacity-100' : 'opacity-0')}>
          <p className="mb-2 text-label text-muted-foreground">{t('land2.sheet.sources')}</p>
          <ol className="space-y-1.5 text-sm">
            <li className="flex items-center gap-2">
              <span className="grid h-5 w-5 place-items-center rounded-full bg-brand text-label font-semibold text-white">1</span>
              <span className="font-medium">{brand}</span>
            </li>
            <li className="flex items-center gap-2 text-muted-foreground">
              <span className="grid h-5 w-5 place-items-center rounded-full bg-muted text-label font-semibold">2</span>
              hesapcik.example
            </li>
          </ol>
        </div>
      </div>

      <figcaption className="border-t border-border px-4 py-3 text-label text-muted-foreground sm:px-6">
        {t('land2.sheet.note')}
      </figcaption>
    </figure>
    </div>
  );
}
