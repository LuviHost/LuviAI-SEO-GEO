'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import dynamic from 'next/dynamic';
import { Loader2, Mail, Check, PlayCircle, ArrowLeft } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { trackCta } from '@/lib/landing-track';
import type { Locale } from '@/lib/i18n';
import { VendorLogo, type VendorName } from '@/components/vendor-logo';
import { QueryCard, UnlockCta, isMeasuredRow, type ProviderRow } from '@/components/citation/query-card';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { openExplainer } from './explainer-dialog';
import type { CheckerCopy } from './checker-copy';

/**
 * AI gorunurluk testinin yukleme + sonuc katmani.
 *
 * NEDEN AYRI DOSYA: bu katman (sorgu kartlari, rakip listesi, e-posta takibi, Remotion
 * oynatici) landing'in en agir parcasi; ilk yuklemede gerekmiyor. ai-visibility-checker
 * bunu next/dynamic ile yalniz test baslayinca yukler.
 */

type CheckResult = Awaited<ReturnType<typeof api.publicCitationCheck>>;

// @remotion/player yalniz sonuc geldiginde, ayri bir parca olarak yuklenir.
const AiScanPlayer = dynamic(() => import('./ai-scan-player'), {
  ssr: false,
  loading: () => <div className="aspect-video w-full rounded-xl bg-muted/40 animate-pulse" />,
});

// Olculen 6 asistan (checker-copy.ts notu): Meta Llama yalniz GROQ_LLAMA_MODEL
// tanimliyken olculur; yukleme ekrani kosulsuz cizmez. Sonuc ekrani saglayicilari
// API cevabindan listeler.
const LOADING_ENGINES: VendorName[] = ['chatgpt', 'claude-ai', 'gemini', 'perplexity', 'grok', 'deepseek'];

export interface CheckerOverlayProps {
  phase: 'loading' | 'result';
  result: CheckResult | null;
  locale: Locale;
  c: CheckerCopy;
  onReset: () => void;
  /**
   * Taze Cloudflare Turnstile token'i (site anahtari yoksa null). Abonelik ucu
   * TURNSTILE_SECRET tanimliyken token ister; token tek kullanimlik oldugu icin
   * testte kullanilan token yeniden gonderilemez.
   */
  getTurnstileToken?: () => Promise<string | null>;
}

export default function CheckerOverlay({ phase, result, locale, c, onReset, getTurnstileToken }: CheckerOverlayProps) {
  const [loadingIdx, setLoadingIdx] = useState(0);
  const [expandedQueries, setExpandedQueries] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (phase !== 'loading') return;
    setLoadingIdx(0);
    const id = setInterval(() => setLoadingIdx((i) => (i + 1) % c.loadingMessages.length), 2500);
    return () => clearInterval(id);
  }, [phase, c.loadingMessages.length]);

  const toggleQuery = (idx: number) => {
    setExpandedQueries((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const summary = useMemo(() => (result ? summarize(result) : null), [result]);
  const loading = phase === 'loading';

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !loading) onReset(); }}>
      <DialogContent
        size="xl"
        hideClose={loading}
        className="max-w-7xl border-2 border-brand-500/20 rounded-2xl bg-background"
        onEscapeKeyDown={(e) => { if (loading) e.preventDefault(); }}
        onInteractOutside={(e) => { if (loading) e.preventDefault(); }}
      >
        {loading && (
          <div className="p-10 sm:p-16 text-center" aria-live="polite">
            <div className="relative w-24 h-24 mx-auto mb-6">
              <div className="absolute inset-0 rounded-full bg-brand-500/20 animate-pulse" />
              <div className="absolute inset-2 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 grid place-items-center">
                <Loader2 className="h-10 w-10 text-white animate-spin" />
              </div>
            </div>
            <DialogTitle className="text-xl font-bold mb-2">{c.loadingTitle}</DialogTitle>
            <DialogDescription className="mb-6">{c.loadingSubtitle}</DialogDescription>
            <div className="h-6 mb-6 flex items-center justify-center">
              <p className="text-sm font-mono text-brand-600 animate-pulse" key={loadingIdx}>
                {c.loadingMessages[loadingIdx]}
              </p>
            </div>
            <div className="flex items-center justify-center gap-3 flex-wrap">
              {LOADING_ENGINES.map((v) => (
                <div key={v} className="relative w-12 h-12 rounded-full bg-muted/50 grid place-items-center">
                  <VendorLogo name={v} size={24} />
                  <div className="absolute inset-0 rounded-full border-2 border-brand-400 animate-ping opacity-60" />
                </div>
              ))}
            </div>
          </div>
        )}

        {phase === 'result' && result && (
          <div className="p-5 sm:p-8 space-y-6">
            <div className="flex items-center gap-4 pr-12">
              <DomainFavicon domain={result.domain} brand={result.brand} />
              <div>
                <DialogTitle className="font-bold text-xl sm:text-2xl">{result.brand}</DialogTitle>
                <DialogDescription>
                  {result.domain}
                  {result.niche && (
                    <span className="ml-2 inline-block px-2 py-0.5 rounded-full bg-brand-500/10 text-brand-600 text-label uppercase tracking-wider">
                      {result.customNiche || result.niche}
                    </span>
                  )}
                </DialogDescription>
              </div>
            </div>

            {result.fromCache && <p className="text-xs text-center text-muted-foreground -mt-2">{c.cachedAt}</p>}

            {/* Kisisel ozet videosu — gercek sonuctan (skor + motor bazinda anilma) */}
            {summary && summary.engines.length > 0 && (
              <div className="rounded-2xl border bg-card overflow-hidden">
                <p className="px-4 pt-3 text-label uppercase tracking-wider text-muted-foreground">{c.replayTitle}</p>
                <AiScanPlayer domain={result.domain} score={summary.score} engines={summary.engines} locale={locale} />
              </div>
            )}

            <div className="grid lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-4">
                <h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{c.resultsHeader}</h4>
                {result.queries.map((q, idx) => (
                  <div key={idx}>
                    {q.locked && !result.queries[idx - 1]?.locked && (
                      <div className="mb-4">
                        <UnlockCta
                          lockedCount={result.access?.lockedQueries ?? 0}
                          unlockedCount={result.access?.unlockedQueries ?? 0}
                          domain={result.domain}
                          onNavigate={onReset}
                          labels={{ title: c.unlockTitle, body: c.unlockBody, cta: c.unlockCta, note: c.unlockNote }}
                        />
                      </div>
                    )}
                    <QueryCard
                      q={q}
                      idx={idx}
                      brand={result.brand}
                      lang={locale}
                      isOpen={expandedQueries.has(idx)}
                      onToggle={() => toggleQuery(idx)}
                      labels={{ show: c.showResponses, hide: c.hideResponses, none: c.noCitedResponses, aiAnswer: c.aiAnswer, truncated: c.truncated, lockedHint: c.lockedHint }}
                    />
                  </div>
                ))}
              </div>

              <div className="lg:col-span-1 space-y-4">
                <h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{c.competitorHeader}</h4>
                <div className="bg-muted/30 rounded-2xl border p-5">
                  {result.competitorRanking.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">{c.competitorEmpty}</p>
                  ) : (
                    <div className="space-y-3">
                      {result.competitorRanking.slice(0, 8).map((comp, idx) => (
                        <div key={comp.name + idx} className={`flex items-center gap-3 p-2 rounded-lg ${comp.isBrand ? 'bg-brand-500/10 ring-1 ring-brand-500/30' : ''}`}>
                          <span className={`inline-grid place-items-center w-6 h-6 rounded-md text-xs font-bold shrink-0 ${comp.isBrand ? 'bg-brand-500 text-white' : 'bg-muted text-foreground'}`}>
                            {idx + 1}
                          </span>
                          <span className="flex-1 text-sm font-medium truncate">
                            {comp.name}
                            {comp.isBrand && <span className="text-brand-600 text-xs ml-1.5 font-bold">{c.youLabel}</span>}
                          </span>
                          <span className={`text-sm font-bold shrink-0 ${comp.isBrand ? 'text-brand-600' : 'text-muted-foreground'}`}>{comp.pct}%</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <OptinCard result={result} locale={locale} c={c} getTurnstileToken={getTurnstileToken} />

                <div className="space-y-2">
                  <Link
                    href="/signin?signup=1"
                    onClick={onReset}
                    className="block w-full text-center bg-foreground text-background hover:opacity-90 font-bold text-sm px-4 py-2.5 rounded-lg transition-opacity"
                  >
                    {c.ctaPrimary}
                  </Link>
                  <button
                    type="button"
                    onClick={() => { onReset(); openExplainer('checker_result'); }}
                    className="inline-flex w-full items-center justify-center gap-2 border border-muted-foreground/30 text-muted-foreground hover:text-foreground hover:border-muted-foreground/60 font-semibold text-sm px-4 py-2 rounded-lg transition-colors"
                  >
                    <PlayCircle className="h-4 w-4" /> {c.ctaSecondary}
                  </button>
                </div>
              </div>
            </div>

            <div className="text-center pt-2">
              <button onClick={onReset} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-brand-600 transition-colors">
                <ArrowLeft className="h-4 w-4" /> {c.testAnother}
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** 90 gunluk e-posta takibi (birincil CTA) */
function OptinCard({
  result,
  locale,
  c,
  getTurnstileToken,
}: {
  result: CheckResult;
  locale: Locale;
  c: CheckerCopy;
  getTurnstileToken?: () => Promise<string | null>;
}) {
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const subscribe = async () => {
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError(c.optinError);
      setStatus('error');
      return;
    }
    if (!consent) return;
    setStatus('sending');
    setError(null);
    try {
      // Sunucu marka/nisi alan adinin kontrol kaydindan okur; marka yalniz
      // uzunluk denetimi icin gider. Turnstile token'i her istekte tazelenir.
      const turnstileToken = (await getTurnstileToken?.()) ?? undefined;
      await api.request<{ ok: true }>('/public/citation-check/subscribe', {
        method: 'POST',
        body: JSON.stringify({
          email: email.trim(),
          domain: result.domain,
          brand: result.brand,
          locale,
          consent,
          turnstileToken,
        }),
      });
      setStatus('sent');
      trackCta('checker_optin');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error)?.message || c.optinError);
      setStatus('error');
    }
  };

  return (
    <div className="bg-gradient-to-br from-brand-500 to-brand-700 text-white rounded-2xl p-5 shadow-xl shadow-brand-500/20">
      <h5 className="font-bold text-base mb-2 leading-snug inline-flex items-center gap-2">
        <Mail className="h-4 w-4 shrink-0" /> {c.optinHeader}
      </h5>
      <p className="text-xs text-white/90 mb-4 leading-relaxed">{c.optinBody}</p>
      {status === 'sent' ? (
        <div className="bg-white/15 rounded-lg p-4 text-center">
          <p className="font-bold text-sm inline-flex items-center gap-2"><Check className="h-4 w-4" /> {c.optinSuccess}</p>
        </div>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); subscribe(); }} className="space-y-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={c.optinPlaceholder}
            disabled={status === 'sending'}
            className="w-full px-3 py-2.5 rounded-lg bg-white/95 text-foreground placeholder:text-muted-foreground/60 text-sm outline-none focus:bg-white"
            required
          />
          <label className="flex items-start gap-2 text-xs text-white/95 cursor-pointer leading-snug">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 shrink-0" required />
            <span>{c.optinConsent}</span>
          </label>
          <button
            type="submit"
            disabled={!email.trim() || !consent || status === 'sending'}
            className="w-full bg-white text-brand-600 hover:bg-white/95 disabled:bg-white/50 disabled:cursor-not-allowed font-bold text-sm px-4 py-2.5 rounded-lg transition-colors"
          >
            {status === 'sending' ? c.optinSending : c.optinBtn}
          </button>
          {status === 'error' && error && <p className="text-xs bg-black/20 rounded p-2">{error}</p>}
          <ul className="text-label text-white/80 space-y-0.5">
            {[c.optinSubBenefit1, c.optinSubBenefit2, c.optinSubBenefit3].map((b) => (
              <li key={b} className="flex items-center gap-1.5"><Check className="h-3 w-3" /> {b}</li>
            ))}
          </ul>
        </form>
      )}
    </div>
  );
}

/**
 * Gercek sonuctan video ozeti: skor = olculen (kilitsiz, marka adi gecmeyen)
 * sorularda motor cevaplarinin yuzde kaci markayi andi; motor "anildi" = bu
 * sorulardan en az birinde anildi ya da kaynak gosterdi (skordaki citedCount ile
 * ayni birim; eskiden yalniz alan adi atfi sayiliyordu ve markayi anan motor
 * videoda "Anılmadı" gorunuyordu).
 *
 * Payda sunucudan: totalProviders yalniz o soruda gercekten olculen asistanlar.
 * Hata veren saglayici (measured=false) motor listesine girmez — videodaki
 * "N motor" sayisi olculen motorlardir.
 */
function summarize(result: CheckResult) {
  const open = result.queries.filter((q) => !q.locked);
  const scored = open.filter((q) => !q.brandInQuery);
  const base = scored.length > 0 ? scored : open;
  const total = base.reduce((s, q) => s + q.totalProviders, 0);
  const cited = base.reduce((s, q) => s + q.citedCount, 0);
  const engines = new Map<string, { label: string; cited: boolean }>();
  for (const q of base) {
    for (const p of q.providers as ProviderRow[]) {
      if (!isMeasuredRow(p)) continue;
      const e = engines.get(p.provider) ?? { label: p.label, cited: false };
      e.cited = e.cited || p.cited || p.brandMentioned;
      engines.set(p.provider, e);
    }
  }
  return { score: total > 0 ? Math.round((cited / total) * 100) : 0, engines: [...engines.values()] };
}

function DomainFavicon({ domain, brand }: { domain: string; brand: string }) {
  const [failed, setFailed] = useState(false);
  const initial = (brand || domain).charAt(0).toUpperCase();
  if (failed) {
    return (
      <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white text-2xl font-bold grid place-items-center shrink-0">
        {initial}
      </div>
    );
  }
  return (
    <div className="w-14 h-14 rounded-xl bg-white grid place-items-center overflow-hidden shrink-0 ring-1 ring-border">
      <Image
        src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`}
        alt={brand}
        width={48}
        height={48}
        unoptimized
        onError={() => setFailed(true)}
      />
    </div>
  );
}
