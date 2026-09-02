'use client';

import Link from 'next/link';
import { Check, X, Lock, ArrowRight } from 'lucide-react';
import { VendorLogo, type VendorName } from '@/components/vendor-logo';
import type { api } from '@/lib/api';

/**
 * Tek sorgu karti — kilitli/acik iki durumu da cizer.
 *
 * NEDEN AYRI DOSYA: landing checker (ai-visibility-checker.tsx) bilerek
 * dokunulmamis halde tutuluyor; teaser gorunumu yalnizca /unlock gibi
 * uye-tarafi ekranlarda kullaniliyor. Landing'i tekrar duzenlemek zorunda
 * kalmamak icin karti ve bagimliliklarini burada bagimsiz tutuyoruz.
 *
 * KILITLI DURUM: soru metni ve kategorisi gorunur, sonuc alani yer tutucu.
 * Buradaki gizleme kozmetiktir — asil kilit sunucuda: kilitli sorgu icin LLM
 * cagrisi hic yapilmaz ve `providers` bos dizi olarak gelir.
 */

type CheckResult = Awaited<ReturnType<typeof api.publicCitationCheck>>;
export type QueryRow = CheckResult['queries'][number];

export const CATEGORY_LABELS: Record<string, { tr: string; en: string }> = {
  DISCOVERY: { tr: 'KEŞİF', en: 'DISCOVERY' },
  COMPARISON: { tr: 'KARŞILAŞTIRMA', en: 'COMPARISON' },
  BRAND: { tr: 'MARKA', en: 'BRAND' },
  PROBLEM: { tr: 'PROBLEM', en: 'PROBLEM' },
  BUYING_INTENT: { tr: 'SATIN ALMA NİYETİ', en: 'BUYING INTENT' },
};

const PROVIDER_LOGOS: Record<string, VendorName> = {
  anthropic: 'claude-ai',
  gemini: 'gemini',
  openai: 'chatgpt',
  perplexity: 'perplexity',
  xai: 'grok',
  deepseek: 'deepseek',
  meta: 'meta-ai',
};

const PROVIDER_SHORT: Record<string, string> = {
  anthropic: 'Claude',
  gemini: 'Gemini',
  openai: 'ChatGPT',
  perplexity: 'Perplexity',
  xai: 'Grok',
  deepseek: 'DeepSeek',
  meta: 'Meta AI',
};

export interface QueryCardLabels {
  show: string;
  hide: string;
  none: string;
  aiAnswer: string;
  truncated: string;
  lockedHint: string;
}

export interface QueryCardProps {
  q: QueryRow;
  idx: number;
  brand: string;
  lang: 'tr' | 'en';
  isOpen: boolean;
  onToggle: () => void;
  labels: QueryCardLabels;
}

export function QueryCard({ q, idx, brand, lang, isOpen, onToggle, labels }: QueryCardProps) {
  const catLabel = q.category ? CATEGORY_LABELS[q.category]?.[lang] : undefined;

  if (q.locked) {
    return (
      <div className="bg-muted/30 rounded-2xl border p-4 sm:p-5 relative overflow-hidden">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <span className="inline-grid place-items-center min-w-[28px] h-7 px-2 rounded-md bg-muted text-muted-foreground text-xs font-bold">
              {idx + 1}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium leading-relaxed">{q.query}</p>
              {catLabel && (
                <span className="inline-block mt-1.5 text-[10px] font-bold uppercase tracking-wider text-brand-600 bg-brand-500/10 px-1.5 py-0.5 rounded">
                  {catLabel}
                </span>
              )}
            </div>
          </div>
          <Lock className="h-4 w-4 text-muted-foreground/60 shrink-0 mt-1.5" aria-hidden />
        </div>

        <div className="flex items-center gap-3 flex-wrap" aria-label={labels.lockedHint}>
          {Array.from({ length: Math.min(q.totalProviders || 7, 7) }).map((_, i) => (
            <div key={i} className="flex flex-col items-center gap-1">
              <div className="w-11 h-11 rounded-xl bg-muted/60 ring-1 ring-border animate-pulse" />
              <div className="h-2 w-9 rounded bg-muted/60" />
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">{labels.lockedHint}</p>
      </div>
    );
  }

  return (
    <div className="bg-muted/30 rounded-2xl border p-4 sm:p-5">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <span className="inline-grid place-items-center min-w-[28px] h-7 px-2 rounded-md bg-foreground text-background text-xs font-bold">
            {idx + 1}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium leading-relaxed">{q.query}</p>
            {(catLabel || q.brandInQuery) && (
            <span className="inline-flex items-center gap-1.5 mt-1.5">
              {catLabel && (
                <span className="text-[10px] font-bold uppercase tracking-wider text-brand-600 bg-brand-500/10 px-1.5 py-0.5 rounded">
                  {catLabel}
                </span>
              )}
              {q.brandInQuery && (
                <span
                  className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground bg-muted px-1.5 py-0.5 rounded"
                  title={lang === 'tr'
                    ? 'Soruda marka adı geçiyor — burada anılmak beklenen sonuç, görünürlük skoruna katılmaz'
                    : 'The query contains the brand name — a mention here is expected and excluded from the visibility score'}
                >
                  {lang === 'tr' ? 'markalı soru' : 'branded query'}
                </span>
              )}
            </span>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          {/* Markali soruda yesil sayi gosterme: 7/7 "basari" gibi okunuyordu,
              oysa soruda adi gecen markanin anilmasi beklenen sonuc. */}
          <div className={q.brandInQuery ? 'font-semibold text-base text-muted-foreground' : 'font-bold text-lg'}>
            <span className={!q.brandInQuery && q.citedCount > 0 ? 'text-emerald-600' : 'text-muted-foreground'}>{q.citedCount}</span>
            <span className="text-muted-foreground"> / {q.totalProviders}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        {q.providers.map((p) => {
          const logo = PROVIDER_LOGOS[p.provider];
          const short = PROVIDER_SHORT[p.provider] || p.label;
          const ok = p.cited || p.brandMentioned;
          return (
            <div key={p.provider} className="flex flex-col items-center gap-1">
              <div className={`relative w-11 h-11 rounded-xl grid place-items-center ${ok ? 'bg-emerald-500/10 ring-2 ring-emerald-500/40' : 'bg-muted/60 ring-1 ring-border'}`}>
                {logo && <VendorLogo name={logo} size={22} />}
                <div className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-full grid place-items-center ring-2 ring-background ${ok ? 'bg-emerald-500 text-white' : 'bg-muted-foreground/40 text-white'}`}>
                  {ok ? <Check className="h-3 w-3" strokeWidth={3} /> : <X className="h-3 w-3" strokeWidth={3} />}
                </div>
              </div>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{short}</span>
            </div>
          );
        })}
      </div>

      <ResponsesToggle providers={q.providers} brand={brand} isOpen={isOpen} onToggle={onToggle} labels={labels} />
    </div>
  );
}

export interface UnlockCtaProps {
  lockedCount: number;
  /** Ucretsiz olculen soru sayisi — metin bunu {open} ile kullanir. */
  unlockedCount?: number;
  domain: string;
  onNavigate?: () => void;
  labels: { title: string; body: string; cta: string; note: string };
}

/**
 * Kilitli sorularin hemen ustunde duran acma karti.
 *
 * Giris sonrasi /unlock'a doner ve kalan sorular uye kademesinde olculur.
 * signin sayfasi callbackUrl'i yalnizca uygulama-ici goreli yol kabul eder
 * (acik yonlendirme engeli), o yuzden tam URL degil goreli yol veriliyor.
 */
export function UnlockCta({ lockedCount, unlockedCount, domain, onNavigate, labels }: UnlockCtaProps) {
  if (lockedCount <= 0) return null;
  // Sayilar metne SABIT yazilmaz: PUBLIC_CITATION_FREE_QUERIES degisince
  // metin sessizce yalan soylerdi. Gercek sonuctan turetiliyor.
  const body = labels.body
    .replace('{open}', String(unlockedCount ?? 0))
    .replace('{locked}', String(lockedCount));
  return (
    <div className="rounded-2xl border-2 border-brand-500/40 bg-brand-500/5 p-5 text-center">
      <div className="inline-grid place-items-center w-10 h-10 rounded-full bg-brand-500/10 mb-3">
        <Lock className="h-5 w-5 text-brand-600" />
      </div>
      <h5 className="font-bold text-base mb-1.5">{labels.title.replace('{n}', String(lockedCount))}</h5>
      <p className="text-xs text-muted-foreground mb-4 leading-relaxed max-w-md mx-auto">{body}</p>
      <Link
        href={`/signin?callbackUrl=${encodeURIComponent(`/unlock?domain=${encodeURIComponent(domain)}`)}`}
        onClick={onNavigate}
        className="inline-flex items-center justify-center gap-2 bg-brand-600 hover:bg-brand-700 text-white px-6 py-2.5 text-sm font-bold rounded-lg transition-colors"
      >
        {labels.cta}
        <ArrowRight className="h-4 w-4" />
      </Link>
      <p className="text-[11px] text-muted-foreground/80 mt-2.5">{labels.note}</p>
    </div>
  );
}

function ResponsesToggle({
  providers,
  brand,
  isOpen,
  onToggle,
  labels,
}: {
  providers: QueryRow['providers'];
  brand: string;
  isOpen: boolean;
  onToggle: () => void;
  labels: QueryCardLabels;
}) {
  // "HATA:" ile isaretli excerpt'ler olculemeyen probe'lardir — gosterilmez.
  const withResponse = providers.filter((p) => p.excerpt && !p.excerpt.startsWith('HATA:'));
  if (withResponse.length === 0) return null;

  const cited = withResponse.filter((p) => p.cited || p.brandMentioned);
  const others = withResponse.filter((p) => !p.cited && !p.brandMentioned);

  return (
    <div className="mt-4">
      <button
        onClick={onToggle}
        className="text-xs font-semibold text-brand-600 hover:text-brand-700 inline-flex items-center gap-1.5 transition-colors"
        type="button"
      >
        {isOpen ? labels.hide : labels.show}
        <span className={`inline-block transition-transform ${isOpen ? 'rotate-180' : ''}`}>▾</span>
      </button>

      {isOpen && (
        <div className="mt-3 space-y-3">
          {cited.length === 0 && <p className="text-xs text-muted-foreground">{labels.none}</p>}
          {[...cited, ...others].map((p) => {
            const ok = p.cited || p.brandMentioned;
            return (
              <div
                key={p.provider}
                className={`rounded-lg p-3 text-xs leading-relaxed ${ok ? 'bg-emerald-500/5 ring-1 ring-emerald-500/20' : 'bg-muted/40 ring-1 ring-border'}`}
              >
                <div className="flex items-center gap-1.5 mb-1.5 font-semibold">
                  {PROVIDER_LOGOS[p.provider] && <VendorLogo name={PROVIDER_LOGOS[p.provider]} size={14} />}
                  <span>{PROVIDER_SHORT[p.provider] || p.label}</span>
                  <span className="text-muted-foreground font-normal">· {labels.aiAnswer}</span>
                </div>
                <p className="text-muted-foreground">
                  {highlightBrand(p.excerpt || '', brand)}
                  {(p.excerpt || '').length >= 210 && <span className="text-muted-foreground/60">{labels.truncated}</span>}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Marka adini cevap metninde vurgular. */
function highlightBrand(text: string, brand: string) {
  if (!brand || brand.length < 3) return text;
  const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
  return parts.map((part, i) =>
    part.toLowerCase() === brand.toLowerCase() ? (
      <strong key={i} className="text-foreground font-bold">
        {part}
      </strong>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

export type { CheckResult };
