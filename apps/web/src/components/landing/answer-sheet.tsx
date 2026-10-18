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
/** Kare "uygulama ikonu" bicimindeki SVG'ler: baloncugu tamamen doldurur (digerleri beyaz zeminde yalin isaret) */
const TILE_LOGOS = new Set<VendorName>(['chatgpt', 'claude-ai']);
/**
 * Olculen 6 asistanin logo dizisi (plans.ts ile ayni) — dikkat ceken ust serit (eski orbital
 * diyagramin yerine). Meta AI (Llama) yok: yalniz GROQ_LLAMA_MODEL tanimliyken olculur
 * (ai-citation.service.ts); "olculen" diye kosulsuz gostermek yanlis vaat olurdu.
 */
const MEASURED: Array<{ label: string; vendor: VendorName }> = [
  ...ENGINES,
  { label: 'Grok', vendor: 'grok' },
  { label: 'DeepSeek', vendor: 'deepseek' },
];
/** Yay uzerindeki yatay konumlar (%): ust yayda sekmelerdeki 4 asistan, altta digerleri 50 etrafinda ortali */
const TOP_ORBIT = ENGINES.map((e, i) => ({ ...e, x: 20 + i * 20 }));
const BOTTOM = MEASURED.slice(ENGINES.length);
const BOTTOM_ORBIT = BOTTOM.map((e, i) => ({ ...e, x: 50 + (i - (BOTTOM.length - 1) / 2) * 20 }));

/**
 * Yay geometrisi (viewBox 100x100, kutuya gerilir): merkez (50, ARC_CY), dikey yaricap
 * ARC_R, yatay yaricap 50. Logolar ayni fonksiyonla konumlanir ki cizgiye tam otursun.
 */
const ARC_CY = 160;
const ARC_R = 130;
function arcY(x: number): number {
  const dx = (x - 50) / 50;
  return ARC_CY - ARC_R * Math.sqrt(Math.max(0, 1 - dx * dx));
}
const ARC_PATH = (() => {
  const pts: string[] = [];
  for (let x = 0; x <= 100; x += 2) pts.push(`${x},${arcY(x).toFixed(2)}`);
  return `M${pts.join(' L')}`;
})();

function OrbitArc({ side, items, active }: {
  side: 'top' | 'bottom';
  items: Array<{ label: string; vendor: VendorName; x: number }>;
  active: number;
}) {
  const top = side === 'top';
  return (
    <div
      className={cn(
        'pointer-events-none absolute -inset-x-2 h-20 sm:h-24 lg:-inset-x-6',
        top ? 'top-0' : 'bottom-0 -scale-y-100',
      )}
    >
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden
        className="absolute inset-0 h-full w-full overflow-visible text-brand/45 [mask-image:linear-gradient(to_bottom,black_45%,transparent_150%)]"
      >
        <path d={ARC_PATH} fill="none" stroke="currentColor" strokeWidth={1.25} strokeDasharray="4 6" vectorEffect="non-scaling-stroke" />
      </svg>
      <ul className="contents">
        {items.map((m, i) => {
          const on = i === active;
          const tile = TILE_LOGOS.has(m.vendor);
          return (
            <li
              key={m.vendor}
              title={m.label}
              style={{ left: `${m.x}%`, top: `${arcY(m.x)}%` }}
              className={cn(
                'absolute grid h-11 w-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white sm:h-14 sm:w-14',
                // alt yay aynalaniyor; logo duz kalsin
                !top && '-scale-y-100',
                'motion-safe:transition-[transform,box-shadow] motion-safe:duration-500',
                on
                  ? 'z-10 shadow-lg shadow-brand/30 ring-[3px] ring-brand motion-safe:scale-110'
                  : 'shadow-md ring-1 ring-border',
              )}
            >
              {/* Beyaz zemin: renkli logolar koyu temada da gorunsun; kare ikonlar daireye kirpilip kucultulur */}
              <span className={cn('block', tile ? 'h-6 w-6 sm:h-8 sm:w-8' : 'h-6 w-6 sm:h-[30px] sm:w-[30px]')}>
                <VendorLogo name={m.vendor} size={32} alt="" className={cn('h-full w-full', tile && 'rounded-full')} />
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

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
  // null = ziyaretçi alan adı yazmadı → dile göre örnek marka (markan.com / yourbrand.com)
  const [typedBrand, setTypedBrand] = useState<string | null>(null);
  const brand = typedBrand ?? t('land2.sheet.brand');
  const [pinned, setPinned] = useState(false); // kullanici sekme secti → otomatik gecis durur

  // Alan adi kutusundan gelen yazim
  useEffect(() => {
    const onDomain = (e: Event) => {
      const v = cleanDomain(String((e as CustomEvent<string>).detail ?? ''));
      setTypedBrand(v.includes('.') ? v : null);
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
    <div className="relative py-20 sm:py-24">
      {/* Yorunge: kartin ustunde ve altinda iki kesik yay, 6 asistan logosu yaylarin
          uzerinde. Kartin yanlari yazi dolu oldugu icin logo yalniz ust/alt bosluktadir. */}
      <OrbitArc side="top" items={TOP_ORBIT} active={engine} />
      <OrbitArc side="bottom" items={BOTTOM_ORBIT} active={-1} />

    <figure className="relative z-10 rounded-[20px] border border-border bg-card shadow-[0_1px_0_hsl(var(--border)),0_24px_60px_-28px_rgb(0_0_0/0.25)]">
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
              <VendorLogo name={vendor} size={16} alt="" className={TILE_LOGOS.has(vendor) ? 'rounded-full' : undefined} />
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
              {t('land2.sheet.source2')}
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
