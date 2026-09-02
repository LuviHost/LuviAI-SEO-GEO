'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight, X, Loader2, AlertCircle, Globe, Crown } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { trackCta } from '@/lib/landing-track';
import { useT } from '@/lib/i18n';
import { VendorLogo, type VendorName } from '@/components/vendor-logo';
import { QueryCard, UnlockCta } from '@/components/citation/query-card';

const COPY = {
  tr: {
    badge: '✨ AI Görünürlük Testi',
    titleA: 'Markanız',
    titleB: 'AI cevaplarında',
    titleC: 'görünüyor mu?',
    subtitle: 'Domain\'inizi girin — 7 AI motoru (ChatGPT, Claude, Gemini, Perplexity, Grok, DeepSeek, Meta AI) markanızı nasıl tanıyor öğrenin. 30 saniyede sonuç, üye olmadan.',
    heroEyebrow: '✨ AI Görünürlük Testi — 30 saniyede',
    heroSub: 'Markanız 7 AI motorunda nasıl görünüyor?',
    placeholder: 'yourdomain.com',
    btnStart: 'Test Et',
    btnLoading: 'Test ediliyor...',
    tagFree: '✓ Ücretsiz',
    tagNoCard: '✓ Kart bilgisi yok',
    tagFast: '✓ 30 saniye',
    loadingTitle: '7 AI motorda markanız aranıyor...',
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
    // Response excerpts
    showResponses: 'Yanıtları gör',
    hideResponses: 'Yanıtları gizle',
    noCitedResponses: 'Hiçbir motor markanızı cevabında geçirmedi.',
    aiAnswer: 'AI cevabı',
    truncated: '… (kısaltıldı)',
    // Email optin
    // Teaser kilidi
    lockedHint: 'Bu soru henüz sorulmadı — kilidi açınca 7 motorda ölçülür.',
    unlockTitle: '{n} soru daha kilitli',
    unlockBody: 'Ücretsiz testte {open} soru ölçülüyor. Kalan {locked} soruyu 7 AI motorunda ölçmek, AI cevaplarının tam metnini ve rakip payını görmek için bir plan seçin.',
    unlockCta: 'Tüm raporu aç',
    unlockNote: 'Planlar aylık · İstediğin zaman iptal',
    optinHeader: '📧 90 gün boyunca markanızı takip edelim',
    optinBody: '15, 30, 60, 90 gün sonra 7 AI motorda otomatik retest yapıp size branded rapor email\'i atalım. Markanızın AI cevaplarında değişimini izleyin.',
    optinPlaceholder: 'siz@example.com',
    optinConsent: 'Aboneliği kabul ediyorum (KVKK uyumlu, istediğiniz zaman iptal)',
    optinBtn: '90 Günlük Takibi Başlat',
    optinSending: 'Gönderiliyor...',
    optinSuccess: '✅ Onay maili gönderildi — gelen kutunuzu kontrol edin',
    optinError: 'Bir hata oluştu',
    optinSubBenefit1: '✓ İlk rapor 15 gün sonra',
    optinSubBenefit2: '✓ Otomatik 4 rapor (15/30/60/90g)',
    optinSubBenefit3: '✓ Tek tıkla iptal',
  },
  en: {
    badge: '✨ AI Visibility Test',
    titleA: 'Is your brand',
    titleB: 'in AI answers',
    titleC: 'at all?',
    subtitle: 'Enter your domain — see how 7 AI engines (ChatGPT, Claude, Gemini, Perplexity, Grok, DeepSeek, Meta AI) recognize your brand. Results in 30 seconds, no signup needed.',
    heroEyebrow: '✨ AI Visibility Test — 30 sec',
    heroSub: 'How does your brand show on 7 AI engines?',
    placeholder: 'yourdomain.com',
    btnStart: 'Test',
    btnLoading: 'Testing...',
    tagFree: '✓ Free',
    tagNoCard: '✓ No card',
    tagFast: '✓ 30 sec',
    loadingTitle: 'Searching your brand on 7 AI engines...',
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
    // Response excerpts
    showResponses: 'Show responses',
    hideResponses: 'Hide responses',
    noCitedResponses: 'No engine cited your brand in their answer.',
    aiAnswer: 'AI answer',
    truncated: '… (truncated)',
    // Email optin
    // Teaser lock
    lockedHint: 'Not asked yet — unlock to measure it across all 7 engines.',
    unlockTitle: '{n} more prompts locked',
    unlockBody: 'The free test measures {open} prompts. Choose a plan to run the remaining {locked} across 7 AI engines and see full answer text plus competitor share.',
    unlockCta: 'Unlock full report',
    unlockNote: 'Monthly plans · Cancel anytime',
    optinHeader: '📧 Track your brand for 90 days',
    optinBody: 'We\'ll automatically retest your domain on 7 AI engines at 15, 30, 60, 90 days and email you a branded report. Track how your AI visibility evolves.',
    optinPlaceholder: 'you@example.com',
    optinConsent: 'I agree to receive these emails (GDPR-compliant, unsubscribe anytime)',
    optinBtn: 'Start 90-Day Tracking',
    optinSending: 'Sending...',
    optinSuccess: '✅ Confirmation email sent — check your inbox',
    optinError: 'An error occurred',
    optinSubBenefit1: '✓ First report in 15 days',
    optinSubBenefit2: '✓ Auto 4 reports (15/30/60/90d)',
    optinSubBenefit3: '✓ One-click unsubscribe',
  },
} as const;



type CheckResult = Awaited<ReturnType<typeof api.publicCitationCheck>>;
type Phase = 'idle' | 'loading' | 'result' | 'error';

const LOADING_MESSAGES_TR = [
  'Soruluyor: ChatGPT',
  'Soruluyor: Claude',
  'Soruluyor: Gemini',
  'Soruluyor: Perplexity',
  'Soruluyor: Grok',
  'Soruluyor: DeepSeek',
  'Soruluyor: Meta AI',
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
  'Asking: Meta AI',
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

  // Expanded responses state (per-query)
  const [expandedQueries, setExpandedQueries] = useState<Set<number>>(new Set());
  const toggleQuery = (idx: number) => {
    setExpandedQueries((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  // Email optin state
  const [optinEmail, setOptinEmail] = useState('');
  const [optinConsent, setOptinConsent] = useState(false);
  const [optinStatus, setOptinStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [optinError, setOptinErrorMsg] = useState<string | null>(null);

  const handleSubscribe = async () => {
    if (!result) return;
    if (!optinEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(optinEmail)) {
      setOptinErrorMsg(c.optinError);
      setOptinStatus('error');
      return;
    }
    if (!optinConsent) return;
    setOptinStatus('sending');
    setOptinErrorMsg(null);
    try {
      await api.request<{ ok: true }>('/public/citation-check/subscribe', {
        method: 'POST',
        body: JSON.stringify({
          email: optinEmail.trim(),
          domain: result.domain,
          brand: result.brand,
          niche: result.niche,
          customNiche: result.customNiche,
          locale,
          consent: optinConsent,
        }),
      });
      setOptinStatus('sent');
      trackCta('checker_optin');
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error)?.message || c.optinError;
      setOptinErrorMsg(msg);
      setOptinStatus('error');
    }
  };

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
    // NEDEN olcum: sitenin ANA CTA'si bu; bugune kadar hic izlenmiyordu, dolayisiyla
    // "kac ziyaretci gercekten test yapti" bilinmiyordu (01.09.2026 tespiti)
    trackCta('checker_submit', { mode });
    try {
      const token = (await getTurnstileToken()) ?? undefined;
      const res = await api.publicCitationCheck(cleaned, token);
      setResult(res);
      setPhase('result');
      trackCta('checker_result', { mode, sorular: res?.queries?.length ?? 0 });
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
            className="flex flex-col sm:flex-row gap-2 bg-background border-2 border-brand-500/30 hover:border-brand-500/50 focus-within:border-brand-500/70 rounded-2xl p-2 shadow-2xl shadow-brand-500/10 transition-colors"
          >
            <div className="flex-1 flex items-center gap-3 px-4">
              <Globe className="h-5 w-5 text-brand-600 shrink-0" />
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
              className="inline-flex items-center justify-center gap-2 px-7 sm:px-8 py-3 sm:py-4 rounded-xl bg-gradient-to-br from-brand-500 to-brand-600 hover:from-brand-600 hover:to-brand-700 disabled:from-muted disabled:to-muted disabled:text-muted-foreground disabled:cursor-not-allowed text-white font-bold text-base sm:text-lg shadow-lg shadow-brand-500/40 transition-all hover:scale-[1.02] active:scale-[0.98]"
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
              <div className="relative w-full max-w-7xl bg-background rounded-2xl border-2 border-brand-500/20 shadow-2xl my-auto">
                {/* Loading overlay content */}
                {phase === 'loading' && (
                  <div className="p-10 sm:p-16 text-center">
                    <div className="relative w-24 h-24 mx-auto mb-6">
                      <div className="absolute inset-0 rounded-full bg-gradient-to-br from-brand-500 to-red-600 animate-pulse opacity-20" />
                      <div className="absolute inset-2 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 grid place-items-center">
                        <Loader2 className="h-10 w-10 text-white animate-spin" />
                      </div>
                    </div>
                    <h3 className="font-bold text-xl mb-2">{c.loadingTitle}</h3>
                    <p className="text-sm text-muted-foreground mb-6">{c.loadingSubtitle}</p>
                    <div className="h-6 mb-6 flex items-center justify-center">
                      <p className="text-sm font-mono text-brand-600 animate-pulse" key={loadingIdx}>
                        {msgs[loadingIdx]}
                      </p>
                    </div>
                    <div className="flex items-center justify-center gap-3 flex-wrap">
                      {(['chatgpt', 'claude-ai', 'gemini', 'perplexity', 'grok', 'deepseek', 'meta-ai'] as VendorName[]).map((v, idx) => (
                        <div
                          key={v}
                          className="relative w-12 h-12 rounded-full bg-muted/50 grid place-items-center"
                          style={{ animationDelay: `${idx * 120}ms` }}
                        >
                          <VendorLogo name={v} size={24} />
                          <div className="absolute inset-0 rounded-full border-2 border-brand-400 animate-ping opacity-60" style={{ animationDelay: `${idx * 120}ms` }} />
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
                            <span className="ml-2 inline-block px-2 py-0.5 rounded-full bg-brand-500/10 text-brand-600 text-[10px] font-semibold uppercase tracking-wider">
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
                          <div key={idx}>
                            {q.locked && !result.queries[idx - 1]?.locked && (
                              <div className="mb-4">
                                <UnlockCta
                                  lockedCount={result.access?.lockedQueries ?? 0}
                                  unlockedCount={result.access?.unlockedQueries ?? 0}
                                  domain={result.domain}
                              onNavigate={handleReset}
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
                        <h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                          {c.competitorHeader}
                        </h4>
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
                                  <span className={`text-sm font-bold shrink-0 ${comp.isBrand ? 'text-brand-600' : 'text-muted-foreground'}`}>
                                    {comp.pct}%
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* PRIMARY CTA — email optin (90 gün takip) */}
                        <div className="bg-gradient-to-br from-brand-500 via-brand-600 to-red-600 text-white rounded-2xl p-5 shadow-xl shadow-brand-500/20">
                          <h5 className="font-bold text-base mb-2 leading-snug">{c.optinHeader}</h5>
                          <p className="text-xs text-white/90 mb-4 leading-relaxed">{c.optinBody}</p>

                          {optinStatus === 'sent' ? (
                            <div className="bg-white/15 backdrop-blur rounded-lg p-4 text-center">
                              <p className="font-bold text-sm">{c.optinSuccess}</p>
                            </div>
                          ) : (
                            <form
                              onSubmit={(e) => { e.preventDefault(); handleSubscribe(); }}
                              className="space-y-3"
                            >
                              <input
                                type="email"
                                value={optinEmail}
                                onChange={(e) => setOptinEmail(e.target.value)}
                                placeholder={c.optinPlaceholder}
                                disabled={optinStatus === 'sending'}
                                className="w-full px-3 py-2.5 rounded-lg bg-white/95 text-foreground placeholder:text-muted-foreground/60 text-sm outline-none focus:bg-white"
                                required
                              />
                              <label className="flex items-start gap-2 text-[11px] text-white/95 cursor-pointer leading-snug">
                                <input
                                  type="checkbox"
                                  checked={optinConsent}
                                  onChange={(e) => setOptinConsent(e.target.checked)}
                                  className="mt-0.5 shrink-0"
                                  required
                                />
                                <span>{c.optinConsent}</span>
                              </label>
                              <button
                                type="submit"
                                disabled={!optinEmail.trim() || !optinConsent || optinStatus === 'sending'}
                                className="w-full bg-white text-brand-600 hover:bg-white/95 disabled:bg-white/50 disabled:cursor-not-allowed font-bold text-sm px-4 py-2.5 rounded-lg transition-colors"
                              >
                                {optinStatus === 'sending' ? c.optinSending : c.optinBtn}
                              </button>
                              {optinStatus === 'error' && optinError && (
                                <p className="text-xs text-red-100 bg-red-900/30 rounded p-2">{optinError}</p>
                              )}
                              <div className="text-[10px] text-white/80 space-y-0.5">
                                <div>{c.optinSubBenefit1}</div>
                                <div>{c.optinSubBenefit2}</div>
                                <div>{c.optinSubBenefit3}</div>
                              </div>
                            </form>
                          )}
                        </div>

                        {/* SECONDARY: signup + demo links */}
                        <div className="space-y-2">
                          <Link
                            href="/signin?signup=1"
                            onClick={handleReset}
                            className="block w-full text-center bg-foreground text-background hover:opacity-90 font-bold text-sm px-4 py-2.5 rounded-lg transition-opacity"
                          >
                            {c.ctaPrimary}
                          </Link>
                          <a
                            href="#nasil"
                            onClick={(e) => { e.preventDefault(); handleReset(); setTimeout(() => { document.getElementById('nasil')?.scrollIntoView({ behavior: 'smooth' }); }, 100); }}
                            className="block w-full text-center bg-transparent border border-muted-foreground/30 text-muted-foreground hover:text-foreground hover:border-muted-foreground/60 font-semibold text-sm px-4 py-2 rounded-lg transition-colors"
                          >
                            {c.ctaSecondary}
                          </a>
                        </div>
                      </div>
                    </div>

                    {/* Footer: test another */}
                    <div className="text-center pt-2">
                      <button
                        onClick={handleReset}
                        className="text-sm text-muted-foreground hover:text-brand-600 transition-colors"
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
    <section id="ai-checker" className="relative py-16 lg:py-24 border-y bg-gradient-to-b from-brand-50/50 via-amber-50/30 to-transparent dark:from-brand-950/10 dark:via-amber-950/10">
      {TURNSTILE_SITE_KEY && <div ref={turnstileRef} className="cf-turnstile" data-size="invisible" />}
      <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute top-10 left-1/4 w-96 h-96 bg-brand-400/10 rounded-full blur-3xl" />
        <div className="absolute bottom-10 right-1/4 w-96 h-96 bg-amber-400/10 rounded-full blur-3xl" />
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-10 max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-500/10 border border-brand-500/20 text-brand-600 text-xs font-semibold mb-5">
            {c.badge}
          </div>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight leading-tight mb-4">
            {c.titleA}{' '}
            <span className="bg-gradient-to-r from-brand-500 via-brand-600 to-red-600 bg-clip-text text-transparent">
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
              className="flex flex-col sm:flex-row gap-3 bg-background border-2 border-brand-500/20 rounded-2xl p-3 shadow-xl shadow-brand-500/5"
            >
              <div className="flex-1 flex items-center gap-2 px-3">
                <Globe className="h-5 w-5 text-brand-600 shrink-0" />
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
                className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-br from-brand-500 to-brand-600 hover:from-brand-600 hover:to-brand-700 disabled:from-muted disabled:to-muted disabled:text-muted-foreground disabled:cursor-not-allowed text-white font-bold text-base shadow-lg shadow-brand-500/30 transition-all hover:scale-[1.02] active:scale-[0.98]"
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
              {(['chatgpt', 'claude-ai', 'gemini', 'perplexity', 'grok', 'deepseek', 'meta-ai'] as VendorName[]).map((v) => (
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
          <div className="max-w-2xl mx-auto bg-background rounded-2xl border-2 border-brand-500/20 p-10 shadow-xl shadow-brand-500/5 text-center">
            <div className="relative w-20 h-20 mx-auto mb-6">
              <div className="absolute inset-0 rounded-full bg-gradient-to-br from-brand-500 to-red-600 animate-pulse opacity-20" />
              <div className="absolute inset-2 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 grid place-items-center">
                <Loader2 className="h-8 w-8 text-white animate-spin" />
              </div>
            </div>
            <h3 className="font-bold text-lg mb-2">{c.loadingTitle}</h3>
            <p className="text-sm text-muted-foreground mb-6">{c.loadingSubtitle}</p>
            <div className="h-6 mb-6 flex items-center justify-center">
              <p className="text-sm font-mono text-brand-600 animate-pulse" key={loadingIdx}>
                {msgs[loadingIdx]}
              </p>
            </div>
            <div className="flex items-center justify-center gap-3 flex-wrap">
              {(['chatgpt', 'claude-ai', 'gemini', 'perplexity', 'grok', 'deepseek', 'meta-ai'] as VendorName[]).map((v, idx) => (
                <div
                  key={v}
                  className="relative w-12 h-12 rounded-full bg-muted/50 grid place-items-center"
                  style={{ animationDelay: `${idx * 120}ms` }}
                >
                  <VendorLogo name={v} size={24} />
                  <div className="absolute inset-0 rounded-full border-2 border-brand-400 animate-ping opacity-60" style={{ animationDelay: `${idx * 120}ms` }} />
                </div>
              ))}
            </div>
          </div>
        )}

        {phase === 'result' && result && (
          <div className="space-y-6">
            <div className="bg-background rounded-2xl border-2 border-brand-500/20 p-6 shadow-xl shadow-brand-500/5 flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-4">
                <DomainFavicon domain={result.domain} brand={result.brand} />
                <div>
                  <h3 className="font-bold text-xl">{result.brand}</h3>
                  <p className="text-sm text-muted-foreground">
                    {result.domain}
                    {result.niche && (
                      <span className="ml-2 inline-block px-2 py-0.5 rounded-full bg-brand-500/10 text-brand-600 text-[10px] font-semibold uppercase tracking-wider">
                        {result.customNiche || result.niche}
                      </span>
                    )}
                  </p>
                </div>
              </div>
              <button
                onClick={handleReset}
                className="text-sm text-muted-foreground hover:text-brand-600 transition-colors px-3 py-1.5 rounded-lg border border-muted hover:border-brand-500/30"
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
                  <div key={idx}>
                    {q.locked && !result.queries[idx - 1]?.locked && (
                      <div className="mb-4">
                        <UnlockCta
                          lockedCount={result.access?.lockedQueries ?? 0}
                          unlockedCount={result.access?.unlockedQueries ?? 0}
                          domain={result.domain}
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
                <h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  {c.competitorHeader}
                </h4>
                <div className="bg-background rounded-2xl border p-5">
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
                          <span className={`text-sm font-bold shrink-0 ${comp.isBrand ? 'text-brand-600' : 'text-muted-foreground'}`}>
                            {comp.pct}%
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="bg-gradient-to-br from-brand-500 via-brand-600 to-red-600 text-white rounded-2xl p-5 shadow-xl shadow-brand-500/20">
                  <Crown className="h-6 w-6 mb-2" />
                  <h5 className="font-bold text-base mb-1.5">{c.ctaBoxTitle}</h5>
                  <p className="text-xs text-white/90 mb-4 leading-relaxed">{c.ctaBoxBody}</p>
                  <div className="space-y-2">
                    <Link
                      href="/onboarding?new=1"
                      className="block w-full text-center bg-white text-brand-600 hover:bg-white/95 font-bold text-sm px-4 py-2.5 rounded-lg transition-colors"
                    >
                      {c.ctaPrimary}
                    </Link>
                    <Link
                      href="/onboarding?demo=1&new=1"
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
