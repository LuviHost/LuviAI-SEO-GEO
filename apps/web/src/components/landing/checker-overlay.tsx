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
import { QueryCard, UnlockCta, isMeasuredRow, PROVIDER_LOGOS, PROVIDER_SHORT, type ProviderRow } from '@/components/citation/query-card';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { openExplainer } from './explainer-dialog';
import type { CheckerCopy } from './checker-copy';

/**
 * AI gorunurluk testinin yukleme + sonuc katmani.
 *
 * NEDEN AYRI DOSYA: bu katman (sorgu kartlari, rakip listesi, e-posta takibi, Remotion
 * oynatici) landing'in en agir parcasi; ilk yuklemede gerekmiyor. ai-visibility-checker
 * bunu next/dynamic ile yalniz test baslayinca yukler.
 *
 * GORUNUM (15.11.2026): vitrin dili — duz kart (rounded-lg + ince cizgi), mono cumle
 * duzeni etiket (.v-rail; CSS `uppercase` YOK, EN'de "i"yi "İ" yapiyordu), golge ve
 * degrade yok, secili satir notr. Bu katman koyu vitrine gecerken (11.11.2026)
 * atlanmisti: turuncu degrade kartlar ve lacivert animasyon siyah sayfada kalmisti.
 * Turuncu yalniz kilit acma dugmesinde (UnlockCta); e-posta takibi beyaz dolu,
 * uyelik cerceveli dugme.
 */

type CheckResult = Awaited<ReturnType<typeof api.publicCitationCheck>>;

// @remotion/player yalniz sonuc geldiginde, ayri bir parca olarak yuklenir.
// Yer tutucu, kompozisyonun en-boy oraniyla ayni (1280 / 520) — yuklenince ziplamasin.
const AiScanPlayer = dynamic(() => import('./ai-scan-player'), {
  ssr: false,
  loading: () => <div className="aspect-[1280/520] w-full" />,
});

// Ucretsiz (anonim) testin SORDUGU dort asistan (api billing/plan-engines
// FREE_TEST_ENGINES; checker-copy.ts `loadingMessages` ile ayni liste). Eskiden
// burada Grok ve DeepSeek logolari da donuyordu; ucretsiz test onlara sormuyor.
const LOADING_ENGINES: VendorName[] = ['chatgpt', 'claude-ai', 'gemini', 'perplexity'];

/** Animasyon bu genisligin altinda okunmaz (1280px'lik sahne kucultuluyor) → duragan ozet */
const WIDE_QUERY = '(min-width: 768px)';

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
  // Katman ssr:false ile yuklenir → matchMedia ilk render'da okunabilir. Animasyon
  // parcasi (remotion) dar ekranda hic indirilmez.
  const [wide] = useState(() => window.matchMedia?.(WIDE_QUERY).matches ?? true);

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !loading) onReset(); }}>
      <DialogContent
        size="xl"
        hideClose={loading}
        className="max-w-7xl bg-background"
        onEscapeKeyDown={(e) => { if (loading) e.preventDefault(); }}
        onInteractOutside={(e) => { if (loading) e.preventDefault(); }}
      >
        {loading && (
          <div className="px-6 py-14 text-center sm:px-16 sm:py-20" aria-live="polite">
            <DialogTitle className="text-panel-1">{c.loadingTitle}</DialogTitle>
            <DialogDescription className="mt-2">{c.loadingSubtitle}</DialogDescription>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              {LOADING_ENGINES.map((v, i) => (
                <div
                  key={v}
                  className="grid h-11 w-11 place-items-center rounded-md bg-muted/60 ring-1 ring-border animate-pulse motion-reduce:animate-none"
                  style={{ animationDelay: `${i * 220}ms` }}
                >
                  <VendorLogo name={v} size={22} />
                </div>
              ))}
            </div>
            <p className="v-rail mt-6 inline-flex h-4 items-center gap-2" key={loadingIdx}>
              <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
              {c.loadingMessages[loadingIdx]}
            </p>
          </div>
        )}

        {phase === 'result' && result && (
          <div className="p-5 sm:p-8 space-y-6">
            <div className="flex items-center gap-4 pr-12">
              <DomainFavicon domain={result.domain} brand={result.brand} />
              <div className="min-w-0">
                <DialogTitle className="text-panel-1 truncate">{result.brand}</DialogTitle>
                <DialogDescription className="mt-1 flex flex-wrap items-center gap-2">
                  <span>{result.domain}</span>
                  {result.niche && (
                    <span className="rounded border border-border px-1.5 py-0.5 font-mono text-vitrin-rail text-muted-foreground">
                      {result.customNiche || result.niche}
                    </span>
                  )}
                </DialogDescription>
              </div>
            </div>

            {result.fromCache && <ReusedResultNotice result={result} locale={locale} c={c} onNavigate={onReset} />}

            {/* Kisisel ozet — gercek sonuctan (skor + motor bazinda anilma). Genis
                ekranda animasyon, dar ekranda ayni bilginin duragan hali. */}
            {summary && summary.engines.length > 0 && (
              <div className="overflow-hidden rounded-lg border bg-card">
                <p className="v-rail px-4 pt-3 sm:px-5">{c.replayTitle}</p>
                {wide ? (
                  <AiScanPlayer domain={result.domain} score={summary.score} engines={summary.engines} locale={locale} />
                ) : (
                  <StaticSummary summary={summary} c={c} />
                )}
              </div>
            )}

            <div className="grid lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-4">
                <h4 className="v-rail">{c.resultsHeader}</h4>
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
                <h4 className="v-rail">{c.competitorHeader}</h4>
                <div className="rounded-lg border bg-card p-3">
                  {result.competitorRanking.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">{c.competitorEmpty}</p>
                  ) : (
                    <div className="space-y-1">
                      {result.competitorRanking.slice(0, 8).map((comp, idx) => (
                        // Kendi markan: notr secili satir (turuncu degil)
                        <div key={comp.name + idx} className={`flex items-center gap-3 rounded-md px-2 py-1.5 ${comp.isBrand ? 'bg-muted' : ''}`}>
                          <span className={`inline-grid h-6 w-6 shrink-0 place-items-center rounded font-mono text-vitrin-rail ${comp.isBrand ? 'bg-foreground text-background' : 'border border-border text-muted-foreground'}`}>
                            {idx + 1}
                          </span>
                          <span className="flex-1 text-sm font-medium truncate">
                            {comp.name}
                            {comp.isBrand && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{c.youLabel}</span>}
                          </span>
                          <span className={`shrink-0 font-mono text-sm tabular-nums ${comp.isBrand ? 'text-foreground' : 'text-muted-foreground'}`}>{comp.pct}%</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <OptinCard result={result} locale={locale} c={c} getTurnstileToken={getTurnstileToken} />

                <div className="space-y-2">
                  <Link href="/signin?signup=1" onClick={onReset} className="v-btn-line w-full">
                    {c.ctaPrimary}
                  </Link>
                  <button
                    type="button"
                    onClick={() => { onReset(); openExplainer('checker_result'); }}
                    className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <PlayCircle className="h-4 w-4" /> {c.ctaSecondary}
                  </button>
                </div>
              </div>
            </div>

            <div className="text-center pt-2">
              <button onClick={onReset} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
                <ArrowLeft className="h-4 w-4" /> {c.testAnother}
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Onceki sonuc yeniden gosterildi (anonim testte ayni site tekrar olculmez).
 * Tarihi soyler ve guncel olcum icin hesap/plan'a yonlendirir.
 */
function ReusedResultNotice({
  result,
  locale,
  c,
  onNavigate,
}: {
  result: CheckResult;
  locale: Locale;
  c: CheckerCopy;
  onNavigate: () => void;
}) {
  const when = result.cachedAt ? new Date(result.cachedAt) : null;
  const date = when && !Number.isNaN(when.getTime())
    ? when.toLocaleDateString(locale === 'tr' ? 'tr-TR' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    : '';
  const signupHref = `/signin?callbackUrl=${encodeURIComponent(`/unlock?domain=${encodeURIComponent(result.domain)}`)}`;
  return (
    <div className="space-y-3 rounded-lg border bg-card p-4 sm:p-5">
      {date && <p className="text-panel-3">{c.reusedTitle.replace('{date}', date)}</p>}
      <p className="text-sm text-muted-foreground">{c.reusedBody}</p>
      <div className="flex flex-col sm:flex-row gap-2">
        <Link
          href={signupHref}
          onClick={() => { trackCta('checker_reused_signup'); onNavigate(); }}
          className={SOLID_BTN}
        >
          {c.reusedCtaSignup}
        </Link>
        <Link
          href="/pricing"
          onClick={() => { trackCta('checker_reused_plans'); onNavigate(); }}
          className="v-btn-line"
        >
          {c.reusedCtaPlans}
        </Link>
      </div>
    </div>
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
  /** Ayri pazarlama izni — varsayilan bos, gonderimi engellemez */
  const [marketing, setMarketing] = useState(false);
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
          marketingConsent: marketing,
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
    <div className="rounded-lg border bg-card p-5">
      <h5 className="text-panel-3 mb-2 flex items-start gap-2">
        <Mail className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden /> {c.optinHeader}
      </h5>
      <p className="text-xs text-muted-foreground mb-4 leading-relaxed">{c.optinBody}</p>
      {status === 'sent' ? (
        <div className="rounded-md border border-success/40 bg-success/10 p-4 text-center text-success">
          <p className="inline-flex items-center gap-2 text-sm font-medium"><Check className="h-4 w-4" aria-hidden /> {c.optinSuccess}</p>
        </div>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); subscribe(); }} className="space-y-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={c.optinPlaceholder}
            aria-label={c.optinPlaceholder}
            disabled={status === 'sending'}
            className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus-visible:border-foreground"
            required
          />
          <label className="flex cursor-pointer items-start gap-2 text-xs leading-snug text-muted-foreground">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 shrink-0 accent-foreground" required />
            <span>{c.optinConsent}</span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 text-xs leading-snug text-muted-foreground">
            <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} className="mt-0.5 shrink-0 accent-foreground" />
            <span>{c.optinMarketing}</span>
          </label>
          <button
            type="submit"
            disabled={!email.trim() || !consent || status === 'sending'}
            className={`${SOLID_BTN} w-full`}
          >
            {status === 'sending' ? c.optinSending : c.optinBtn}
          </button>
          {status === 'error' && error && (
            <p role="alert" className="rounded-md border border-danger/30 bg-danger/10 p-2 text-xs text-danger">{error}</p>
          )}
          <ul className="space-y-0.5 text-label text-muted-foreground">
            {[c.optinSubBenefit1, c.optinSubBenefit2, c.optinSubBenefit3].map((b) => (
              <li key={b} className="flex items-center gap-1.5"><Check className="h-3 w-3" aria-hidden /> {b}</li>
            ))}
          </ul>
        </form>
      )}
    </div>
  );
}

/** Beyaz dolu dugme: turuncunun (kilit acma) bir alt kademesi */
const SOLID_BTN =
  'inline-flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-md bg-foreground px-5 text-sm font-medium text-background transition-opacity duration-200 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50';

type Summary = ReturnType<typeof summarize>;

/**
 * Dar ekranda animasyonun yerine gecen duragan ozet: ayni skor, ayni cumle,
 * ayni asistan durumlari (soru kartlarindaki kutucuklarla ayni renk kurali).
 */
function StaticSummary({ summary, c }: { summary: Summary; c: CheckerCopy }) {
  const cited = summary.engines.filter((e) => e.cited).length;
  return (
    <div className="px-4 pb-5 pt-3">
      <div className="flex items-end gap-2">
        <span className="text-vitrin-2 tabular-nums">{summary.score}</span>
        <span className="v-rail pb-1.5">{c.scoreLabel}</span>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        {c.summaryLine.replace('{n}', String(summary.engines.length)).replace('{k}', String(cited))}
      </p>
      <ul className="mt-4 flex flex-wrap gap-2">
        {summary.engines.map((e) => (
          <li
            key={e.provider}
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs ring-1 ${e.cited ? 'bg-success/10 text-success ring-success/50' : 'bg-muted/60 text-muted-foreground ring-border'}`}
          >
            {PROVIDER_LOGOS[e.provider] && <VendorLogo name={PROVIDER_LOGOS[e.provider]} size={14} />}
            {e.label}
          </li>
        ))}
      </ul>
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
  const engines = new Map<string, { provider: string; label: string; cited: boolean }>();
  for (const q of base) {
    for (const p of q.providers as ProviderRow[]) {
      if (!isMeasuredRow(p)) continue;
      // Kisa ad: API etiketi ("Anthropic Claude", "OpenAI ChatGPT") animasyondaki
      // kutuya sigmiyordu; soru kartlari da ayni kisa adi kullaniyor.
      const e = engines.get(p.provider) ?? { provider: p.provider, label: PROVIDER_SHORT[p.provider] || p.label, cited: false };
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
      <div className="grid h-14 w-14 shrink-0 place-items-center rounded-lg border border-border bg-muted text-2xl font-medium">
        {initial}
      </div>
    );
  }
  return (
    <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-lg bg-white ring-1 ring-border">
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
