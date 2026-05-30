'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight, Check, X, Loader2, AlertCircle, Globe, Crown } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { VendorLogo, type VendorName } from '@/components/vendor-logo';

const COPY = {
  tr: {
    badge: '✨ AI Görünürlük Testi',
    titleA: 'Markanız',
    titleB: 'AI cevaplarında',
    titleC: 'görünüyor mu?',
    subtitle: 'Domain\'inizi girin — 6 AI motoru (ChatGPT, Claude, Gemini, Perplexity, Grok, DeepSeek) markanızı nasıl tanıyor öğrenin. 30 saniyede sonuç, üye olmadan.',
    heroEyebrow: '✨ AI Görünürlük Testi — 30 saniyede',
    heroSub: 'Markanız 6 AI motorunda nasıl görünüyor?',
    placeholder: 'yourdomain.com',
    btnStart: 'Test Et',
    btnLoading: 'Test ediliyor...',
    tagFree: '✓ Ücretsiz',
    tagNoCard: '✓ Kart bilgisi yok',
    tagFast: '✓ 30 saniye',
    loadingTitle: '6 AI motorda markanız aranıyor...',
    loadingSubtitle: 'Bu işlem ~25 saniye sürer',
    resultsHeader: 'Markanız bu AI cevaplarında geçti mi?',
    competitorHeader: 'Rakip Karşılaştırması',
    youLabel: '(siz)',
    citationCount: 'motor cevabında geçti',
    cachedAt: 'Sonuç önbellekten (24h cache)',
    ctaBoxTitle: 'Tam raporu açın — markanızı yükseltin',
    ctaBoxBody: 'AI Citation Tracker dashboard\'unuzda; günlük takip, drop alarmı, GEO Score Card ve auto-fix ile markanızı 90 günde AI cevaplarında yukarı çıkarın.',
    ctaPrimary: '2 Makale Ücretsiz Dene',
    ctaSecondary: 'Demo İncele',
    errorTitle: 'Test başarısız',
    competitorEmpty: 'Bu sorgularda öne çıkan rakip bulunamadı.',
    domainHint: 'Sadece domain yazın (örn. kobipratik.com)',
    closeBtn: 'Kapat',
    testAnother: 'Yeni test',
  },
  en: {
    badge: '✨ AI Visibility Test',
    titleA: 'Is your brand',
    titleB: 'in AI answers',
    titleC: 'at all?',
    subtitle: 'Enter your domain — see how 6 AI engines (ChatGPT, Claude, Gemini, Perplexity, Grok, DeepSeek) recognize your brand. Results in 30 seconds, no signup needed.',
    heroEyebrow: '✨ AI Visibility Test — 30 sec',
    heroSub: 'How does your brand show on 6 AI engines?',
    placeholder: 'yourdomain.com',
    btnStart: 'Test',
    btnLoading: 'Testing...',
    tagFree: '✓ Free',
    tagNoCard: '✓ No card',
    tagFast: '✓ 30 sec',
    loadingTitle: 'Searching your brand on 6 AI engines...',
    loadingSubtitle: 'This takes ~25 seconds',
    resultsHeader: 'Did your brand appear in these AI answers?',
    competitorHeader: 'Competitor Ranking',
    youLabel: '(you)',
    citationCount: 'engines cited you',
    cachedAt: 'Result from cache (24h)',
    ctaBoxTitle: 'Unlock full report — boost your brand',
    ctaBoxBody: 'AI Citation Tracker in your dashboard — daily tracking, drop alarm, GEO Score Card, and auto-fix to push your brand up in AI answers within 90 days.',
    ctaPrimary: 'Try 2 Articles Free',
    ctaSecondary: 'See Demo',
    errorTitle: 'Test failed',
    competitorEmpty: 'No competitors stood out in these queries.',
    domainHint: 'Just the domain (e.g. kobipratik.com)',
    closeBtn: 'Close',
    testAnother: 'New test',
  },
} as const;

const PROVIDER_LOGOS: Record<string, VendorName> = {
  anthropic: 'claude-ai',
  gemini: 'gemini',
  openai: 'chatgpt',
  perplexity: 'perplexity',
  xai: 'grok',
  deepseek: 'deepseek',
};

const PROVIDER_SHORT: Record<string, string> = {
  anthropic: 'Claude',
  gemini: 'Gemini',
  openai: 'ChatGPT',
  perplexity: 'Perplexity',
  xai: 'Grok',
  deepseek: 'DeepSeek',
};

type CheckResult = Awaited<ReturnType<typeof api.publicCitationCheck>>;
type Phase = 'idle' | 'loading' | 'result' | 'error';

const LOADING_MESSAGES_TR = [
  'Soruluyor: ChatGPT',
  'Soruluyor: Claude',
  'Soruluyor: Gemini',
  'Soruluyor: Perplexity',
  'Soruluyor: Grok',
  'Soruluyor: DeepSeek',
  'Cevaplar analiz ediliyor...',
  'Rakipler tespit ediliyor...',
  'Skor hesaplanıyor...',
];

const LOADING_MESSAGES_EN = [
  'Asking: ChatGPT',
  'Asking: Claude',
  'Asking: Gemini',
  'Asking: Perplexity',
  'Asking: Grok',
  'Asking: DeepSeek',
  'Analyzing responses...',
  'Detecting competitors...',
  'Computing score...',
];

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

declare global {
  interface Window {
    turnstile?: {
      render: (selector: string | HTMLElement, options: {
        sitekey: string;
        size?: 'normal' | 'compact' | 'invisible' | 'flexible';
        callback?: (token: string) => void;
        'error-callback'?: () => void;
        'expired-callback'?: () => void;
      }) => string;
      execute: (widgetIdOrSelector: string | HTMLElement) => void;
      reset: (widgetIdOrSelector: string | HTMLElement) => void;
      remove: (widgetIdOrSelector: string | HTMLElement) => void;
    };
  }
}

export interface AiVisibilityCheckerProps {
  /** 'standalone' = full landing section with title/sub. 'hero' = compact card for hero side panel. */
  mode?: 'standalone' | 'hero';
}

export function AiVisibilityChecker({ mode = 'standalone' }: AiVisibilityCheckerProps) {
  const { locale } = useT();
  const c = COPY[locale];
  const [domain, setDomain] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<CheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingIdx, setLoadingIdx] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const turnstileRef = useRef<HTMLDivElement | null>(null);
  const turnstileWidgetIdRef = useRef<string | null>(null);
  const tokenResolverRef = useRef<((token: string | null) => void) | null>(null);

  // Lazy-load Turnstile script when widget mounts (only if site key set)
  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return;
    const existing = document.querySelector<HTMLScriptElement>('script[src*="turnstile/v0/api.js"]');
    if (!existing) {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.defer = true;
      document.head.appendChild(s);
    }
  }, []);

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !turnstileRef.current) return;
    let cancelled = false;
    const interval = setInterval(() => {
      if (cancelled) return;
      if (window.turnstile && turnstileRef.current && !turnstileWidgetIdRef.current) {
        try {
          const widgetId = window.turnstile.render(turnstileRef.current, {
            sitekey: TURNSTILE_SITE_KEY!,
            size: 'invisible',
            callback: (token) => {
              tokenResolverRef.current?.(token);
              tokenResolverRef.current = null;
            },
            'error-callback': () => {
              tokenResolverRef.current?.(null);
              tokenResolverRef.current = null;
            },
            'expired-callback': () => {
              if (turnstileWidgetIdRef.current && window.turnstile) {
                window.turnstile.reset(turnstileWidgetIdRef.current);
              }
            },
          });
          turnstileWidgetIdRef.current = widgetId;
          clearInterval(interval);
        } catch (_e) { /* turnstile not ready yet */ }
      }
    }, 200);
    return () => {
      cancelled = true;
      clearInterval(interval);
      if (turnstileWidgetIdRef.current && window.turnstile) {
        try { window.turnstile.remove(turnstileWidgetIdRef.current); } catch { /* noop */ }
        turnstileWidgetIdRef.current = null;
      }
    };
  }, []);

  const getTurnstileToken = (): Promise<string | null> => {
    if (!TURNSTILE_SITE_KEY) return Promise.resolve(null);
    if (!window.turnstile || !turnstileWidgetIdRef.current) return Promise.resolve(null);
    return new Promise((resolve) => {
      tokenResolverRef.current = resolve;
      try {
        window.turnstile!.reset(turnstileWidgetIdRef.current!);
        window.turnstile!.execute(turnstileWidgetIdRef.current!);
      } catch (_e) {
        resolve(null);
      }
      setTimeout(() => {
        if (tokenResolverRef.current) {
          tokenResolverRef.current(null);
          tokenResolverRef.current = null;
        }
      }, 15_000);
    });
  };

  useEffect(() => {
    if (phase !== 'loading') {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    const msgs = locale === 'en' ? LOADING_MESSAGES_EN : LOADING_MESSAGES_TR;
    setLoadingIdx(0);
    intervalRef.current = setInterval(() => {
      setLoadingIdx((i) => (i + 1) % msgs.length);
    }, 2500);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [phase, locale]);

  // Body scroll lock when result modal is open in hero mode
  useEffect(() => {
    if (mode !== 'hero') return;
    if (phase === 'result' || phase === 'loading') {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [phase, mode]);

  const handleStart = async () => {
    const cleaned = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    if (!cleaned || !cleaned.includes('.')) {
      setError(c.domainHint);
      setPhase('error');
      return;
    }
    setPhase('loading');
    setError(null);
    try {
      const token = (await getTurnstileToken()) ?? undefined;
      const res = await api.publicCitationCheck(cleaned, token);
      setResult(res);
      setPhase('result');
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error)?.message || 'Hata';
      setError(msg);
      setPhase('error');
    }
  };

  const handleReset = () => {
    setPhase('idle');
    setResult(null);
    setError(null);
  };

  const msgs = locale === 'en' ? LOADING_MESSAGES_EN : LOADING_MESSAGES_TR;

  // ─────────────────────────────────────────────────────────
  //  HERO MODE — compact input card + fullscreen modal for results
  // ─────────────────────────────────────────────────────────
  if (mode === 'hero') {
    return (
      <>
        {TURNSTILE_SITE_KEY && <div ref={turnstileRef} className="cf-turnstile" data-size="invisible" />}
        <div className="relative">
          <form
            onSubmit={(e) => { e.preventDefault(); handleStart(); }}
            className="flex flex-col sm:flex-row gap-2 bg-background border-2 border-orange-500/30 hover:border-orange-500/50 focus-within:border-orange-500/70 rounded-2xl p-2 shadow-2xl shadow-orange-500/10 transition-colors"
          >
            <div className="flex-1 flex items-center gap-3 px-4">
              <Globe className="h-5 w-5 text-orange-600 shrink-0" />
              <input
                type="text"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder={c.placeholder}
                autoComplete="off"
                spellCheck={false}
                disabled={phase === 'loading'}
                className="flex-1 bg-transparent outline-none text-lg sm:text-xl font-medium placeholder:text-muted-foreground/50 py-3 sm:py-4"
              />
            </div>
            <button
              type="submit"
              disabled={!domain.trim() || phase === 'loading'}
              className="inline-flex items-center justify-center gap-2 px-7 sm:px-8 py-3 sm:py-4 rounded-xl bg-gradient-to-br from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 disabled:from-muted disabled:to-muted disabled:text-muted-foreground disabled:cursor-not-allowed text-white font-bold text-base sm:text-lg shadow-lg shadow-orange-500/40 transition-all hover:scale-[1.02] active:scale-[0.98]"
            >
              {phase === 'loading' ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>
                  {c.btnStart}
                  <ArrowRight className="h-5 w-5" />
                </>
              )}
            </button>
          </form>

          {/* Inline tag row */}
          <div className="flex flex-wrap items-center justify-center lg:justify-start gap-x-4 gap-y-1 mt-3 text-xs text-muted-foreground">
            <span>{c.tagFree}</span>
            <span className="opacity-40">•</span>
            <span>{c.tagNoCard}</span>
            <span className="opacity-40">•</span>
            <span>{c.tagFast}</span>
          </div>

          {phase === 'error' && error && (
            <div className="mt-3 flex items-start gap-2 p-3 rounded-lg border border-red-300/50 bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-300 text-xs">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>{error}</div>
            </div>
          )}
        </div>

        {/* FULLSCREEN OVERLAY — loading or result */}
        {(phase === 'loading' || phase === 'result') && (
          <div
            className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm overflow-y-auto"
            onClick={(e) => { if (e.target === e.currentTarget && phase === 'result') handleReset(); }}
          >
            <div className="min-h-full flex items-start justify-center p-4 sm:p-8">
              <div className="relative w-full max-w-5xl bg-background rounded-2xl border-2 border-orange-500/20 shadow-2xl my-auto">
                {/* Loading overlay content */}
                {phase === 'loading' && (
                  <div className="p-10 sm:p-16 text-center">
                    <div className="relative w-24 h-24 mx-auto mb-6">
                      <div className="absolute inset-0 rounded-full bg-gradient-to-br from-orange-500 to-red-600 animate-pulse opacity-20" />
                      <div className="absolute inset-2 rounded-full bg-gradient-to-br from-orange-400 to-orange-600 grid place-items-center">
                        <Loader2 className="h-10 w-10 text-white animate-spin" />
                      </div>
                    </div>
                    <h3 className="font-bold text-xl mb-2">{c.loadingTitle}</h3>
                    <p className="text-sm text-muted-foreground mb-6">{c.loadingSubtitle}</p>
                    <div className="h-6 mb-6 flex items-center justify-center">
                      <p className="text-sm font-mono text-orange-600 animate-pulse" key={loadingIdx}>
                        {msgs[loadingIdx]}
                      </p>
                    </div>
                    <div className="flex items-center justify-center gap-3 flex-wrap">
                      {(['chatgpt', 'claude-ai', 'gemini', 'perplexity', 'grok', 'deepseek'] as VendorName[]).map((v, idx) => (
                        <div
                          key={v}
                          className="relative w-12 h-12 rounded-full bg-muted/50 grid place-items-center"
                          style={{ animationDelay: `${idx * 120}ms` }}
                        >
                          <VendorLogo name={v} size={24} />
                          <div className="absolute inset-0 rounded-full border-2 border-orange-400 animate-ping opacity-60" style={{ animationDelay: `${idx * 120}ms` }} />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Result modal content */}
                {phase === 'result' && result && (
                  <div className="p-5 sm:p-8 space-y-6">
                    {/* Close button */}
                    <button
                      onClick={handleReset}
                      className="absolute top-4 right-4 text-muted-foreground hover:text-foreground transition-colors p-2 rounded-lg hover:bg-muted"
                      aria-label={c.closeBtn}
                    >
                      <X className="h-5 w-5" />
                    </button>

                    {/* Brand header */}
                    <div className="flex items-center gap-4 pr-12">
                      <DomainFavicon domain={result.domain} brand={result.brand} />
                      <div>
                        <h3 className="font-bold text-xl sm:text-2xl">{result.brand}</h3>
                        <p className="text-sm text-muted-foreground">
                          {result.domain}
                          {result.niche && (
                            <span className="ml-2 inline-block px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-600 text-[10px] font-semibold uppercase tracking-wider">
                              {result.customNiche || result.niche}
                            </span>
                          )}
                        </p>
                      </div>
                    </div>

                    {result.fromCache && (
                      <p className="text-xs text-center text-muted-foreground -mt-2">{c.cachedAt}</p>
                    )}

                    {/* Two-col results */}
                    <div className="grid lg:grid-cols-3 gap-6">
                      <div className="lg:col-span-2 space-y-4">
                        <h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                          {c.resultsHeader}
                        </h4>
                        {result.queries.map((q, idx) => (
                          <div key={idx} className="bg-muted/30 rounded-2xl border p-4 sm:p-5">
                            <div className="flex items-start justify-between gap-4 mb-4">
                              <div className="flex items-start gap-3 flex-1">
                                <span className="inline-grid place-items-center min-w-[28px] h-7 px-2 rounded-md bg-foreground text-background text-xs font-bold">
                                  {idx + 1}
                                </span>
                                <p className="text-sm font-medium leading-relaxed flex-1">{q.query}</p>
                              </div>
                              <div className="shrink-0 text-right">
                                <div className="font-bold text-lg">
                                  <span className={q.citedCount > 0 ? 'text-emerald-600' : 'text-muted-foreground'}>
                                    {q.citedCount}
                                  </span>
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
                          </div>
                        ))}
                      </div>

                      <div className="lg:col-span-1 space-y-4">
                        <h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                          {c.competitorHeader}
                        </h4>
                        <div className="bg-muted/30 rounded-2xl border p-5">
                          {result.competitorRanking.length === 0 ? (
                            <p className="text-sm text-muted-foreground text-center py-8">{c.competitorEmpty}</p>
                          ) : (
                            <div className="space-y-3">
                              {result.competitorRanking.slice(0, 8).map((comp, idx) => (
                                <div key={comp.name + idx} className={`flex items-center gap-3 p-2 rounded-lg ${comp.isBrand ? 'bg-orange-500/10 ring-1 ring-orange-500/30' : ''}`}>
                                  <span className={`inline-grid place-items-center w-6 h-6 rounded-md text-xs font-bold shrink-0 ${comp.isBrand ? 'bg-orange-500 text-white' : 'bg-muted text-foreground'}`}>
                                    {idx + 1}
                                  </span>
                                  <span className="flex-1 text-sm font-medium truncate">
                                    {comp.name}
                                    {comp.isBrand && <span className="text-orange-600 text-xs ml-1.5 font-bold">{c.youLabel}</span>}
                                  </span>
                                  <span className={`text-sm font-bold shrink-0 ${comp.isBrand ? 'text-orange-600' : 'text-muted-foreground'}`}>
                                    {comp.pct}%
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        <div className="bg-gradient-to-br from-orange-500 via-orange-600 to-red-600 text-white rounded-2xl p-5 shadow-xl shadow-orange-500/20">
                          <Crown className="h-6 w-6 mb-2" />
                          <h5 className="font-bold text-base mb-1.5">{c.ctaBoxTitle}</h5>
                          <p className="text-xs text-white/90 mb-4 leading-relaxed">{c.ctaBoxBody}</p>
                          <div className="space-y-2">
                            <Link
                              href="/onboarding"
                              className="block w-full text-center bg-white text-orange-600 hover:bg-white/95 font-bold text-sm px-4 py-2.5 rounded-lg transition-colors"
                            >
                              {c.ctaPrimary}
                            </Link>
                            <Link
                              href="/onboarding?demo=1"
                              className="block w-full text-center bg-transparent border border-white/40 text-white hover:bg-white/10 font-semibold text-sm px-4 py-2 rounded-lg transition-colors"
                            >
                              {c.ctaSecondary}
                            </Link>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Footer: test another */}
                    <div className="text-center pt-2">
                      <button
                        onClick={handleReset}
                        className="text-sm text-muted-foreground hover:text-orange-600 transition-colors"
                      >
                        ← {c.testAnother}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  // ─────────────────────────────────────────────────────────
  //  STANDALONE MODE — full landing section
  // ─────────────────────────────────────────────────────────
  return (
    <section id="ai-checker" className="relative py-16 lg:py-24 border-y bg-gradient-to-b from-orange-50/50 via-amber-50/30 to-transparent dark:from-orange-950/10 dark:via-amber-950/10">
      {TURNSTILE_SITE_KEY && <div ref={turnstileRef} className="cf-turnstile" data-size="invisible" />}
      <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute top-10 left-1/4 w-96 h-96 bg-orange-400/10 rounded-full blur-3xl" />
        <div className="absolute bottom-10 right-1/4 w-96 h-96 bg-amber-400/10 rounded-full blur-3xl" />
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-10 max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-500/10 border border-orange-500/20 text-orange-600 text-xs font-semibold mb-5">
            {c.badge}
          </div>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight leading-tight mb-4">
            {c.titleA}{' '}
            <span className="bg-gradient-to-r from-orange-500 via-orange-600 to-red-600 bg-clip-text text-transparent">
              {c.titleB}
            </span>{' '}
            {c.titleC}
          </h2>
          <p className="text-base sm:text-lg text-muted-foreground leading-relaxed">
            {c.subtitle}
          </p>
        </div>

        {(phase === 'idle' || phase === 'error') && (
          <div className="max-w-2xl mx-auto">
            <form
              onSubmit={(e) => { e.preventDefault(); handleStart(); }}
              className="flex flex-col sm:flex-row gap-3 bg-background border-2 border-orange-500/20 rounded-2xl p-3 shadow-xl shadow-orange-500/5"
            >
              <div className="flex-1 flex items-center gap-2 px-3">
                <Globe className="h-5 w-5 text-orange-600 shrink-0" />
                <input
                  type="text"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  placeholder={c.placeholder}
                  autoComplete="off"
                  spellCheck={false}
                  className="flex-1 bg-transparent outline-none text-base placeholder:text-muted-foreground/60 py-2"
                />
              </div>
              <button
                type="submit"
                disabled={!domain.trim()}
                className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-br from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 disabled:from-muted disabled:to-muted disabled:text-muted-foreground disabled:cursor-not-allowed text-white font-bold text-base shadow-lg shadow-orange-500/30 transition-all hover:scale-[1.02] active:scale-[0.98]"
              >
                {c.btnStart}
                <ArrowRight className="h-5 w-5" />
              </button>
            </form>

            <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 mt-4 text-xs text-muted-foreground">
              <span>{c.tagFree}</span>
              <span>{c.tagNoCard}</span>
              <span>{c.tagFast}</span>
            </div>

            {phase === 'error' && error && (
              <div className="mt-5 flex items-start gap-3 p-4 rounded-xl border border-red-300/50 bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-300 text-sm">
                <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="font-bold mb-0.5">{c.errorTitle}</div>
                  <div>{error}</div>
                </div>
              </div>
            )}

            <div className="mt-8 flex flex-wrap items-center justify-center gap-x-7 gap-y-3 opacity-70">
              {(['chatgpt', 'claude-ai', 'gemini', 'perplexity', 'grok', 'deepseek'] as VendorName[]).map((v) => (
                <div key={v} className="flex items-center gap-1.5">
                  <VendorLogo name={v} size={18} />
                  <span className="text-xs font-semibold">{
                    v === 'claude-ai' ? 'Claude' : v === 'chatgpt' ? 'ChatGPT' : v.charAt(0).toUpperCase() + v.slice(1)
                  }</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {phase === 'loading' && (
          <div className="max-w-2xl mx-auto bg-background rounded-2xl border-2 border-orange-500/20 p-10 shadow-xl shadow-orange-500/5 text-center">
            <div className="relative w-20 h-20 mx-auto mb-6">
              <div className="absolute inset-0 rounded-full bg-gradient-to-br from-orange-500 to-red-600 animate-pulse opacity-20" />
              <div className="absolute inset-2 rounded-full bg-gradient-to-br from-orange-400 to-orange-600 grid place-items-center">
                <Loader2 className="h-8 w-8 text-white animate-spin" />
              </div>
            </div>
            <h3 className="font-bold text-lg mb-2">{c.loadingTitle}</h3>
            <p className="text-sm text-muted-foreground mb-6">{c.loadingSubtitle}</p>
            <div className="h-6 mb-6 flex items-center justify-center">
              <p className="text-sm font-mono text-orange-600 animate-pulse" key={loadingIdx}>
                {msgs[loadingIdx]}
              </p>
            </div>
            <div className="flex items-center justify-center gap-3 flex-wrap">
              {(['chatgpt', 'claude-ai', 'gemini', 'perplexity', 'grok', 'deepseek'] as VendorName[]).map((v, idx) => (
                <div
                  key={v}
                  className="relative w-12 h-12 rounded-full bg-muted/50 grid place-items-center"
                  style={{ animationDelay: `${idx * 120}ms` }}
                >
                  <VendorLogo name={v} size={24} />
                  <div className="absolute inset-0 rounded-full border-2 border-orange-400 animate-ping opacity-60" style={{ animationDelay: `${idx * 120}ms` }} />
                </div>
              ))}
            </div>
          </div>
        )}

        {phase === 'result' && result && (
          <div className="space-y-6">
            <div className="bg-background rounded-2xl border-2 border-orange-500/20 p-6 shadow-xl shadow-orange-500/5 flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-4">
                <DomainFavicon domain={result.domain} brand={result.brand} />
                <div>
                  <h3 className="font-bold text-xl">{result.brand}</h3>
                  <p className="text-sm text-muted-foreground">
                    {result.domain}
                    {result.niche && (
                      <span className="ml-2 inline-block px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-600 text-[10px] font-semibold uppercase tracking-wider">
                        {result.customNiche || result.niche}
                      </span>
                    )}
                  </p>
                </div>
              </div>
              <button
                onClick={handleReset}
                className="text-sm text-muted-foreground hover:text-orange-600 transition-colors px-3 py-1.5 rounded-lg border border-muted hover:border-orange-500/30"
              >
                ← {c.testAnother}
              </button>
            </div>

            {result.fromCache && (
              <p className="text-xs text-center text-muted-foreground">{c.cachedAt}</p>
            )}

            <div className="grid lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-4">
                <h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  {c.resultsHeader}
                </h4>
                {result.queries.map((q, idx) => (
                  <div key={idx} className="bg-background rounded-2xl border p-5 hover:border-orange-500/30 transition-colors">
                    <div className="flex items-start justify-between gap-4 mb-4">
                      <div className="flex items-start gap-3 flex-1">
                        <span className="inline-grid place-items-center min-w-[28px] h-7 px-2 rounded-md bg-foreground text-background text-xs font-bold">
                          {idx + 1}
                        </span>
                        <p className="text-sm font-medium leading-relaxed flex-1">{q.query}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="font-bold text-lg">
                          <span className={q.citedCount > 0 ? 'text-emerald-600' : 'text-muted-foreground'}>
                            {q.citedCount}
                          </span>
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
                            <div className={`relative w-11 h-11 rounded-xl grid place-items-center ${ok ? 'bg-emerald-500/10 ring-2 ring-emerald-500/40' : 'bg-muted/40 ring-1 ring-border'}`}>
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
                  </div>
                ))}
              </div>

              <div className="lg:col-span-1 space-y-4">
                <h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  {c.competitorHeader}
                </h4>
                <div className="bg-background rounded-2xl border p-5">
                  {result.competitorRanking.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">{c.competitorEmpty}</p>
                  ) : (
                    <div className="space-y-3">
                      {result.competitorRanking.slice(0, 8).map((comp, idx) => (
                        <div key={comp.name + idx} className={`flex items-center gap-3 p-2 rounded-lg ${comp.isBrand ? 'bg-orange-500/10 ring-1 ring-orange-500/30' : ''}`}>
                          <span className={`inline-grid place-items-center w-6 h-6 rounded-md text-xs font-bold shrink-0 ${comp.isBrand ? 'bg-orange-500 text-white' : 'bg-muted text-foreground'}`}>
                            {idx + 1}
                          </span>
                          <span className="flex-1 text-sm font-medium truncate">
                            {comp.name}
                            {comp.isBrand && <span className="text-orange-600 text-xs ml-1.5 font-bold">{c.youLabel}</span>}
                          </span>
                          <span className={`text-sm font-bold shrink-0 ${comp.isBrand ? 'text-orange-600' : 'text-muted-foreground'}`}>
                            {comp.pct}%
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="bg-gradient-to-br from-orange-500 via-orange-600 to-red-600 text-white rounded-2xl p-5 shadow-xl shadow-orange-500/20">
                  <Crown className="h-6 w-6 mb-2" />
                  <h5 className="font-bold text-base mb-1.5">{c.ctaBoxTitle}</h5>
                  <p className="text-xs text-white/90 mb-4 leading-relaxed">{c.ctaBoxBody}</p>
                  <div className="space-y-2">
                    <Link
                      href="/onboarding"
                      className="block w-full text-center bg-white text-orange-600 hover:bg-white/95 font-bold text-sm px-4 py-2.5 rounded-lg transition-colors"
                    >
                      {c.ctaPrimary}
                    </Link>
                    <Link
                      href="/onboarding?demo=1"
                      className="block w-full text-center bg-transparent border border-white/40 text-white hover:bg-white/10 font-semibold text-sm px-4 py-2 rounded-lg transition-colors"
                    >
                      {c.ctaSecondary}
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function DomainFavicon({ domain, brand }: { domain: string; brand: string }) {
  const [failed, setFailed] = useState(false);
  const initial = (brand || domain).charAt(0).toUpperCase();
  if (failed) {
    return (
      <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-orange-500 to-orange-700 text-white text-2xl font-bold grid place-items-center shrink-0">
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
