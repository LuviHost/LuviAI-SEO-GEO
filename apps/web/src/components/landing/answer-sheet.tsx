'use client';

import { useEffect, useMemo, useState } from 'react';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { useReducedMotion } from '@/lib/use-reduced-motion';
import { VendorLogo, type VendorName } from '@/components/vendor-logo';

/**
 * Hero'nun tek "cesur" ogesi: bir AI asistaninin ornek cevabi yazilir, markanin
 * anildigi yerin uzerinden turuncu bir fosforlu kalem gecer (koyu vitrinde dolu
 * turuncu, ustunde siyah metin). Ziyaretci alan adini yazdikca (DOMAIN_EVENT)
 * cevaptaki marka onun alan adi olur.
 *
 * DURUSTLUK: kart "Ornek cevap" etiketlidir; diger markalar uydurma adlardir
 * (gercek rakip adi kullanilmaz). Gercek sonuc alan adi testindedir.
 */
export const DOMAIN_EVENT = 'ranksup:domain';

/** Sekmeler (ornek cevap bu dort asistanda doner) */
export const ENGINES: Array<{ label: string; vendor: VendorName }> = [
  { label: 'ChatGPT', vendor: 'chatgpt' },
  { label: 'Gemini', vendor: 'gemini' },
  { label: 'Claude', vendor: 'claude-ai' },
  { label: 'Perplexity', vendor: 'perplexity' },
];
/** Kare "uygulama ikonu" bicimindeki SVG'ler: rozeti tamamen doldurur (digerleri beyaz zeminde yalin isaret) */
export const TILE_LOGOS: ReadonlySet<VendorName> = new Set<VendorName>(['chatgpt', 'claude-ai']);
/**
 * HER kurulumda olculen 6 asistan (plans.ts ile ayni) — hero'nun altindaki seritte gosterilir;
 * ilk dordu sekmelerle ayni sirada, serit etkin sekmeyi isaretler.
 */
export const MEASURED: Array<{ label: string; vendor: VendorName }> = [
  ...ENGINES,
  { label: 'Grok', vendor: 'grok' },
  { label: 'DeepSeek', vendor: 'deepseek' },
];
/**
 * Meta'nin asistani Muse (API'de saglayici kimligi `meta`). KOSULLU: yalniz
 * META_MODEL_API_KEY tanimliyken olculur (ai-citation.service.ts). Bu yuzden MEASURED
 * icinde degil; serit onu ancak API "su an olculuyor" derse ekler
 * (GET /billing/plans → measuredEngines; bkz. stripEngines). Kosulsuz gostermek
 * olcmedigimiz bir asistani vaat etmek olurdu.
 */
export const MUSE: { label: string; vendor: VendorName } = { label: 'Muse', vendor: 'muse' };

/** Seritte gosterilecek asistanlar: 6 sabit + (API olculuyor diyorsa) Muse */
export function stripEngines(measuredProviders?: readonly string[]): Array<{ label: string; vendor: VendorName }> {
  return measuredProviders?.includes('meta') ? [...MEASURED, MUSE] : MEASURED;
}

const TYPE_STEP = 2;         // her tikte kac karakter
const TYPE_MS = 22;
const HOLD_MS = 5200;        // cevap tamamlaninca bekleme

function cleanDomain(v: string): string {
  return v.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].slice(0, 40);
}

/**
 * `engine` hero'da tutulur (ai-checker-hero.tsx): alttaki asistan seridi de ayni
 * degeri okur ve cevap hangi asistanda yaziliyorsa onu isaretler.
 */
export function AnswerSheet({ engine, onEngineChange }: { engine: number; onEngineChange: (next: number) => void }) {
  const { t } = useT();
  const reduced = useReducedMotion();
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
      onEngineChange((engine + 1) % ENGINES.length);
      setTyped(0);
    }, HOLD_MS);
    return () => window.clearTimeout(id);
  }, [typed, total, pinned, reduced, engine, onEngineChange]);

  // Marka degisince cevabi yeniden yazmak yerine tamamlanmis goster
  useEffect(() => { setTyped((n) => (n > 0 ? Number.MAX_SAFE_INTEGER : n)); }, [brand]);

  let budget = shown;
  const done = shown >= total;

  return (
    <figure className="relative rounded-lg border border-border bg-card">
      {/* Asistan secimi */}
      <div className="border-b border-border px-3 sm:px-4">
        <div role="tablist" aria-label={t('land2.sheet.engines')} className="-mb-px flex min-w-0 gap-1 overflow-x-auto">
          {ENGINES.map(({ label: name, vendor }, i) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={engine === i}
              onClick={() => { onEngineChange(i); setTyped(reduced ? total : 0); setPinned(true); }}
              className={cn(
                'inline-flex items-center gap-1.5 whitespace-nowrap border-b px-2 py-3.5 text-sm transition-colors duration-200',
                engine === i ? 'border-brand-vivid text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              <EngineChip vendor={vendor} />
              {/* Kart darken dort ad yan yana sigmaz (telefon; hero iki sutuna gecince lg-xl arasi):
                  secili olmayan sekme yalniz logosuyla durur, adi ekran okuyucuya kalir */}
              <span className={cn(engine !== i && 'sr-only sm:not-sr-only lg:sr-only xl:not-sr-only')}>{name}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-5 px-4 py-5 sm:px-6 sm:py-6">
        {/* "Ornek cevap" etiketi + soru. Etiket sekme satirinda degil: dort sekmeyle ayni satira sigmiyordu */}
        <div className="flex items-start justify-between gap-4">
          <span className="v-rail shrink-0 pt-3">{t('land2.sheet.label')}</span>
          <p className="w-fit max-w-[75%] rounded-lg bg-muted px-4 py-2.5 text-sm leading-relaxed">
            {t('land2.sheet.query')}
          </p>
        </div>

        {/* Cevap — fosforlu kalem markanin uzerinden gecer */}
        <p className="min-h-[8.75rem] text-base leading-[1.8]" aria-live="off">
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
                    'rounded-[3px] bg-transparent bg-no-repeat px-1 font-medium',
                    'bg-[linear-gradient(hsl(var(--highlighter)),hsl(var(--highlighter)))]',
                    'motion-safe:transition-[background-size,color] motion-safe:duration-700 motion-safe:ease-out',
                    // Kalem gecene kadar metin acik renk kalir; turuncu dolunca siyaha doner
                    complete ? 'text-black [background-size:100%_100%]' : 'text-foreground [background-size:0%_100%]',
                  )}
                >
                  {text}
                </mark>
                {complete && <sup className="ml-0.5 text-label font-medium text-brand-vivid">[{p.cite}]</sup>}
              </span>
            );
          })}
          {!done && <span className="ml-0.5 inline-block h-[1.1em] w-[2px] translate-y-[3px] bg-brand-vivid motion-safe:animate-pulse" aria-hidden />}
        </p>

        {/* Kaynaklar */}
        <div className={cn('border-t border-border pt-4 transition-opacity duration-500', done ? 'opacity-100' : 'opacity-0')}>
          <p className="v-rail mb-3">{t('land2.sheet.sources')}</p>
          <ol className="space-y-2 text-sm">
            <li className="flex items-center gap-2.5">
              <span className="grid h-5 w-5 place-items-center rounded bg-brand-vivid font-mono text-label font-medium text-black">1</span>
              <span className="font-medium">{brand}</span>
            </li>
            <li className="flex items-center gap-2.5 text-muted-foreground">
              <span className="grid h-5 w-5 place-items-center rounded bg-muted font-mono text-label font-medium">2</span>
              {t('land2.sheet.source2')}
            </li>
          </ol>
        </div>
      </div>

      <figcaption className="border-t border-border px-4 py-3.5 text-label leading-relaxed text-muted-foreground sm:px-6">
        {t('land2.sheet.note')}
      </figcaption>
    </figure>
  );
}

/**
 * Asistan logosu, kucuk beyaz rozet icinde: logolarin bir kismi siyah (Grok) ya da
 * koyu tonlu; koyu sahnede ancak beyaz zeminde okunur. Kare ikonlar rozeti doldurur.
 */
export function EngineChip({ vendor, className }: { vendor: VendorName; className?: string }) {
  const tile = TILE_LOGOS.has(vendor);
  return (
    <span className={cn('grid h-5 w-5 shrink-0 place-items-center overflow-hidden rounded bg-white', className)}>
      <VendorLogo name={vendor} size={tile ? 20 : 13} alt="" className={tile ? 'h-full w-full' : undefined} />
    </span>
  );
}
