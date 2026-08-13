'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight, Check, X, Loader2, AlertCircle, Globe, Crown, Lock } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { VendorLogo, type VendorName } from '@/components/vendor-logo';

const COPY = {
  tr: {
    badge: 'AI Görünürlük Testi',
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
    unlockBody: 'Ücretsiz testte 2 soru ölçülüyor. Kalan soruları 7 AI motorunda ölçmek, rakip payını görmek ve haftalık takibe almak için hesabınızı açın.',
    unlockCta: 'Tüm raporu aç',
    unlockNote: 'Kayıt ücretsiz · Kart bilgisi istenmez',
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
    badge: 'AI Visibility Test',
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
    unlockBody: 'The free test measures 2 prompts. Create your account to run the rest across 7 AI engines, see competitor share, and get weekly tracking.',
    unlockCta: 'Unlock full report',
    unlockNote: 'Free to create · No card required',
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

const PROVIDER_LOGOS: Record<string, VendorName> = {
  anthropic: 'claude-ai',     // turuncu yildiz/burst
  gemini: 'gemini',
  openai: 'chatgpt',          // yesil iOS app icon
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

type CheckResult = Awaited<ReturnType<typeof api.publicCitationCheck>>;
type QueryRow = CheckResult['queries'][number];
type Phase = 'idle' | 'loading' | 'result' | 'error';

/** Soru kategorisi rozetleri — kilitli soruda da gorunur, merak yaratir. */
export const CATEGORY_LABELS: Record<string, { tr: string; en: string }> = {
  DISCOVERY: { tr: 'KEŞİF', en: 'DISCOVERY' },
  COMPARISON: { tr: 'KARŞILAŞTIRMA', en: 'COMPARISON' },
  BRAND: { tr: 'MARKA', en: 'BRAND' },
  PROBLEM: { tr: 'PROBLEM', en: 'PROBLEM' },
  BUYING_INTENT: { tr: 'SATIN ALMA NİYETİ', en: 'BUYING INTENT' },
};

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
        } catch { /* turnstile not ready yet */ }
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
      } catch {
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
            className="flex flex-col sm:flex-row gap-2 bg-ink-2 border border-bone/15 hover:border-bone/25 focus-within:border-brand-400/60 rounded-2xl p-2 transition-colors"
          >
            <div className="flex-1 flex items-center gap-3 px-4">
              <Globe className="h-5 w-5 text-brand-400 shrink-0" />
              <input
                type="text"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder={c.placeholder}
                autoComplete="off"
                spellCheck={false}
                disabled={phase === 'loading'}
                className="flex-1 bg-transparent outline-none text-lg sm:text-xl font-medium text-bone placeholder:text-bone/30 py-3 sm:py-4"
              />
            </div>
            <button
              type="submit"
              disabled={!domain.trim() || phase === 'loading'}
              className="btn-brand h-auto px-7 sm:px-8 py-3 sm:py-4 text-base sm:text-lg font-bold disabled:opacity-40 disabled:cursor-not-allowed"
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
          <div className="flex flex-wrap items-center justify-center lg:justify-start gap-x-4 gap-y-1 mt-3 text-xs text-bone/60">
            <span>{c.tagFree}</span>
            <span className="opacity-40">•</span>
            <span>{c.tagNoCard}</span>
            <span className="opacity-40">•</span>
            <span>{c.tagFast}</span>
          </div>

          {phase === 'error' && error && (
            <div className="mt-3 flex items-start gap-2 p-3 rounded-lg border border-[#C43C2E]/50 bg-[#C43C2E]/10 text-bone/90 text-xs">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-[#C43C2E]" />
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
              <div className="relative w-full max-w-7xl bg-background rounded-2xl border border-border shadow-2xl my-auto">
                {/* Loading overlay content */}
                {phase === 'loading' && (
                  <div className="p-10 sm:p-16 text-center">
                    <div className="relative w-24 h-24 mx-auto mb-6">
                      <div className="absolute inset-0 rounded-full bg-brand/15 animate-pulse" />
                      <div className="absolute inset-2 rounded-full bg-brand grid place-items-center">
                        <Loader2 className="h-10 w-10 text-white animate-spin" />
                      </div>
                    </div>
                    <h3 className="font-bold text-xl mb-2">{c.loadingTitle}</h3>
                    <p className="text-sm text-muted-foreground mb-6">{c.loadingSubtitle}</p>
                    <div className="h-6 mb-6 flex items-center justify-center">
                      <p className="text-sm font-mono text-brand dark:text-brand-400 animate-pulse" key={loadingIdx}>
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
                            <span className="ml-2 inline-block px-2 py-0.5 rounded-full bg-brand/10 text-brand dark:text-brand-400 text-[10px] font-semibold uppercase tracking-wider">
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
                            {/* Kilitli blogun hemen basinda acma karti */}
                            {q.locked && !result.queries[idx - 1]?.locked && (
                              <div className="mb-4">
                                <UnlockCta
                                  lockedCount={result.access?.lockedQueries ?? 0}
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
                        <div className="card-brand p-5">
                          {result.competitorRanking.length === 0 ? (
                            <p className="text-sm text-muted-foreground text-center py-8">{c.competitorEmpty}</p>
                          ) : (
                            <div className="space-y-3">
                              {result.competitorRanking.slice(0, 8).map((comp, idx) => (
                                <div key={comp.name + idx} className={`flex items-center gap-3 p-2 rounded-lg ${comp.isBrand ? 'bg-brand/10 ring-1 ring-brand/30' : ''}`}>
                                  <span className={`inline-grid place-items-center w-6 h-6 rounded-md text-xs font-bold shrink-0 ${comp.isBrand ? 'bg-brand text-white' : 'bg-muted text-foreground'}`}>
                                    {idx + 1}
                                  </span>
                                  <span className="flex-1 text-sm font-medium truncate">
                                    {comp.name}
                                    {comp.isBrand && <span className="text-brand dark:text-brand-400 text-xs ml-1.5 font-bold">{c.youLabel}</span>}
                                  </span>
                                  <span className={`text-sm font-bold shrink-0 ${comp.isBrand ? 'text-brand dark:text-brand-400' : 'text-muted-foreground'}`}>
                                    {comp.pct}%
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* PRIMARY CTA — email optin (90 gün takip) */}
                        <div className="bg-brand text-white rounded-2xl p-5">
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
                                className="w-full bg-white text-brand hover:bg-white/95 disabled:bg-white/50 disabled:cursor-not-allowed font-bold text-sm px-4 py-2.5 rounded-lg transition-colors"
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
                        className="text-sm text-muted-foreground hover:text-brand dark:hover:text-brand-400 transition-colors"
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
    <section id="ai-checker" className="relative py-16 lg:py-24 border-y border-ink/10 bg-bone text-ink dark:border-bone/10 dark:bg-ink-2 dark:text-bone">
      {TURNSTILE_SITE_KEY && <div ref={turnstileRef} className="cf-turnstile" data-size="invisible" />}

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-10 max-w-3xl mx-auto">
          <p className="eyebrow mb-4">
            <span className="text-brand dark:text-brand-400">{c.badge}</span>
          </p>
          <h2 className="font-brandDisplay text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-[-0.03em] leading-[1.05] mb-4">
            {c.titleA}{' '}
            <span className="text-brand dark:text-brand-400">
              {c.titleB}
            </span>{' '}
            {c.titleC}
          </h2>
          <p className="text-base sm:text-lg text-[#6E6259] dark:text-[#A99F92] leading-relaxed">
            {c.subtitle}
          </p>
        </div>

        {(phase === 'idle' || phase === 'error') && (
          <div className="max-w-2xl mx-auto">
            <form
              onSubmit={(e) => { e.preventDefault(); handleStart(); }}
              className="flex flex-col sm:flex-row gap-3 card-brand rounded-2xl p-3 focus-within:border-brand/50 transition-colors"
            >
              <div className="flex-1 flex items-center gap-2 px-3">
                <Globe className="h-5 w-5 text-brand shrink-0" />
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
                className="btn-brand h-auto px-6 py-3 text-base font-bold disabled:opacity-40 disabled:cursor-not-allowed"
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
              <div className="mt-5 flex items-start gap-3 p-4 rounded-xl border border-[#C43C2E]/40 bg-[#C43C2E]/10 text-[#C43C2E] dark:text-[#E8907F] text-sm">
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
          <div className="max-w-2xl mx-auto card-brand p-10 text-center">
            <div className="relative w-20 h-20 mx-auto mb-6">
              <div className="absolute inset-0 rounded-full bg-brand/15 animate-pulse" />
              <div className="absolute inset-2 rounded-full bg-brand grid place-items-center">
                <Loader2 className="h-8 w-8 text-white animate-spin" />
              </div>
            </div>
            <h3 className="font-bold text-lg mb-2">{c.loadingTitle}</h3>
            <p className="text-sm text-muted-foreground mb-6">{c.loadingSubtitle}</p>
            <div className="h-6 mb-6 flex items-center justify-center">
              <p className="text-sm font-mono text-brand dark:text-brand-400 animate-pulse" key={loadingIdx}>
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
            <div className="card-brand p-6 flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-4">
                <DomainFavicon domain={result.domain} brand={result.brand} />
                <div>
                  <h3 className="font-bold text-xl">{result.brand}</h3>
                  <p className="text-sm text-muted-foreground">
                    {result.domain}
                    {result.niche && (
                      <span className="ml-2 inline-block px-2 py-0.5 rounded-full bg-brand/10 text-brand dark:text-brand-400 text-[10px] font-semibold uppercase tracking-wider">
                        {result.customNiche || result.niche}
                      </span>
                    )}
                  </p>
                </div>
              </div>
              <button
                onClick={handleReset}
                className="text-sm text-muted-foreground hover:text-brand dark:hover:text-brand-400 transition-colors px-3 py-1.5 rounded-lg border border-muted hover:border-brand/40"
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
                <div className="card-brand p-5">
                  {result.competitorRanking.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">{c.competitorEmpty}</p>
                  ) : (
                    <div className="space-y-3">
                      {result.competitorRanking.slice(0, 8).map((comp, idx) => (
                        <div key={comp.name + idx} className={`flex items-center gap-3 p-2 rounded-lg ${comp.isBrand ? 'bg-brand/10 ring-1 ring-brand/30' : ''}`}>
                          <span className={`inline-grid place-items-center w-6 h-6 rounded-md text-xs font-bold shrink-0 ${comp.isBrand ? 'bg-brand text-white' : 'bg-muted text-foreground'}`}>
                            {idx + 1}
                          </span>
                          <span className="flex-1 text-sm font-medium truncate">
                            {comp.name}
                            {comp.isBrand && <span className="text-brand dark:text-brand-400 text-xs ml-1.5 font-bold">{c.youLabel}</span>}
                          </span>
                          <span className={`text-sm font-bold shrink-0 ${comp.isBrand ? 'text-brand dark:text-brand-400' : 'text-muted-foreground'}`}>
                            {comp.pct}%
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="bg-brand text-white rounded-2xl p-5">
                  <Crown className="h-6 w-6 mb-2" />
                  <h5 className="font-bold text-base mb-1.5">{c.ctaBoxTitle}</h5>
                  <p className="text-xs text-white/90 mb-4 leading-relaxed">{c.ctaBoxBody}</p>
                  <div className="space-y-2">
                    <Link
                      href="/onboarding"
                      className="block w-full text-center bg-white text-brand hover:bg-white/95 font-bold text-sm px-4 py-2.5 rounded-lg transition-colors"
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

export interface QueryCardProps {
  q: QueryRow;
  idx: number;
  brand: string;
  lang: 'tr' | 'en';
  isOpen: boolean;
  onToggle: () => void;
  labels: { show: string; hide: string; none: string; aiAnswer: string; truncated: string; lockedHint: string };
}

/**
 * Tek soru karti — hem modal hem standalone modunda ayni bilesen.
 *
 * KILITLI DURUM: soru metni ve kategorisi GORUNUR, sonuc alani placeholder.
 * Buradaki bulaniklik kozmetiktir; asil kilit sunucuda — kilitli sorgu icin
 * LLM cagrisi hic yapilmaz, `providers` bos dizi olarak gelir. Yani devtools
 * acan biri de bir sey goremez, cunku gonderilen veri yok.
 */
export function QueryCard({ q, idx, brand, lang, isOpen, onToggle, labels }: QueryCardProps) {
  const catLabel = q.category ? CATEGORY_LABELS[q.category]?.[lang] : undefined;

  if (q.locked) {
    return (
      <div className="card-brand p-4 sm:p-5 relative overflow-hidden">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <span className="inline-grid place-items-center min-w-[28px] h-7 px-2 rounded-md bg-muted text-muted-foreground text-xs font-bold">
              {idx + 1}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium leading-relaxed">{q.query}</p>
              {catLabel && (
                <span className="inline-block mt-1.5 text-[10px] font-bold uppercase tracking-wider text-brand/70 bg-brand/10 px-1.5 py-0.5 rounded">
                  {catLabel}
                </span>
              )}
            </div>
          </div>
          <Lock className="h-4 w-4 text-muted-foreground/60 shrink-0 mt-1.5" aria-hidden />
        </div>

        {/* Olculmemis sonuc alani — veri yok, yer tutucu var */}
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
    <div className="card-brand p-4 sm:p-5">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <span className="inline-grid place-items-center min-w-[28px] h-7 px-2 rounded-md bg-foreground text-background text-xs font-bold">
            {idx + 1}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium leading-relaxed">{q.query}</p>
            {catLabel && (
              <span className="inline-block mt-1.5 text-[10px] font-bold uppercase tracking-wider text-brand/70 bg-brand/10 px-1.5 py-0.5 rounded">
                {catLabel}
              </span>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-bold text-lg">
            <span className={q.citedCount > 0 ? 'text-[#3E9B4F]' : 'text-muted-foreground'}>{q.citedCount}</span>
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
              <div className={`relative w-11 h-11 rounded-xl grid place-items-center ${ok ? 'bg-[#3E9B4F]/10 ring-2 ring-[#3E9B4F]/40' : 'bg-muted/60 ring-1 ring-border'}`}>
                {logo && <VendorLogo name={logo} size={22} />}
                <div className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-full grid place-items-center ring-2 ring-background ${ok ? 'bg-[#3E9B4F] text-white' : 'bg-muted-foreground/40 text-white'}`}>
                  {ok ? <Check className="h-3 w-3" strokeWidth={3} /> : <X className="h-3 w-3" strokeWidth={3} />}
                </div>
              </div>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{short}</span>
            </div>
          );
        })}
      </div>

      <ResponsesToggle
        providers={q.providers}
        brand={brand}
        isOpen={isOpen}
        onToggle={onToggle}
        labels={labels}
      />
    </div>
  );
}

interface UnlockCtaProps {
  lockedCount: number;
  domain: string;
  onNavigate?: () => void;
  labels: { title: string; body: string; cta: string; note: string };
}

/** Kilitli sorularin hemen ustunde duran acma karti. */
function UnlockCta({ lockedCount, domain, onNavigate, labels }: UnlockCtaProps) {
  if (lockedCount <= 0) return null;
  return (
    <div className="rounded-2xl border-2 border-brand/40 bg-brand/5 p-5 text-center">
      <div className="inline-grid place-items-center w-10 h-10 rounded-full bg-brand/15 mb-3">
        <Lock className="h-5 w-5 text-brand" />
      </div>
      <h5 className="font-bold text-base mb-1.5">{labels.title.replace('{n}', String(lockedCount))}</h5>
      <p className="text-xs text-muted-foreground mb-4 leading-relaxed max-w-md mx-auto">{labels.body}</p>
      <Link
        // Giris sonrasi /unlock'a doner ve kalan sorular uye kademesinde olculur.
        // signin sayfasi callbackUrl'i yalnizca uygulama-ici goreli yol olarak kabul eder.
        href={`/signin?callbackUrl=${encodeURIComponent(`/unlock?domain=${encodeURIComponent(domain)}`)}`}
        onClick={onNavigate}
        className="inline-flex items-center justify-center gap-2 btn-brand px-6 py-2.5 text-sm font-bold rounded-lg"
      >
        {labels.cta}
        <ArrowRight className="h-4 w-4" />
      </Link>
      <p className="text-[11px] text-muted-foreground/80 mt-2.5">{labels.note}</p>
    </div>
  );
}

interface ResponsesToggleProps {
  providers: Array<{ provider: string; label: string; cited: boolean; brandMentioned: boolean; excerpt?: string }>;
  brand: string;
  isOpen: boolean;
  onToggle: () => void;
  labels: { show: string; hide: string; none: string; aiAnswer: string; truncated: string };
}

function ResponsesToggle({ providers, brand, isOpen, onToggle, labels }: ResponsesToggleProps) {
  // Only show providers that have a meaningful excerpt (skip errors marked with "HATA:")
  const withResponse = providers.filter((p) => p.excerpt && !p.excerpt.startsWith('HATA:'));
  if (withResponse.length === 0) return null;

  const cited = withResponse.filter((p) => p.cited || p.brandMentioned);
  const others = withResponse.filter((p) => !p.cited && !p.brandMentioned);

  return (
    <div className="mt-4">
      <button
        onClick={onToggle}
        className="text-xs font-semibold text-brand hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300 inline-flex items-center gap-1.5 transition-colors"
        type="button"
      >
        {isOpen ? labels.hide : labels.show}
        <span className={`inline-block transition-transform ${isOpen ? 'rotate-180' : ''}`}>▾</span>
      </button>

      {isOpen && (
        <div className="mt-3 space-y-2">
          {cited.length === 0 ? (
            <p className="text-xs text-muted-foreground italic px-3 py-2">{labels.none}</p>
          ) : null}

          {/* Show cited first, then others */}
          {[...cited, ...others].map((p) => {
            const short = PROVIDER_SHORT[p.provider] || p.label;
            const logo = PROVIDER_LOGOS[p.provider];
            const ok = p.cited || p.brandMentioned;
            return (
              <div
                key={p.provider}
                className={`rounded-lg border p-3 text-xs ${ok ? 'bg-[#3E9B4F]/5 border-[#3E9B4F]/20' : 'bg-muted/30 border-border'}`}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  {logo && <VendorLogo name={logo} size={16} />}
                  <span className="font-bold text-sm">{short}</span>
                  {ok && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#3E9B4F] bg-[#3E9B4F]/10 px-2 py-0.5 rounded-full">
                      <Check className="h-3 w-3" strokeWidth={3} />
                      {p.cited ? 'URL cite' : 'brand mention'}
                    </span>
                  )}
                </div>
                <p className="text-muted-foreground leading-relaxed">
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

/** Brand adı geçen yerleri turuncu vurgula */
function highlightBrand(text: string, brand: string): React.ReactNode {
  if (!brand || brand.length < 3) return text;
  const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const splitRe = new RegExp(`(${escaped})`, 'gi');
  const brandLower = brand.toLowerCase();
  const parts = text.split(splitRe);
  return parts.map((part, i) =>
    part.toLowerCase() === brandLower
      ? <mark key={i} className="bg-brand/15 text-brand-700 dark:text-brand-300 font-semibold rounded px-0.5">{part}</mark>
      : <span key={i}>{part}</span>
  );
}

function DomainFavicon({ domain, brand }: { domain: string; brand: string }) {
  const [failed, setFailed] = useState(false);
  const initial = (brand || domain).charAt(0).toUpperCase();
  if (failed) {
    return (
      <div className="w-14 h-14 rounded-xl bg-brand text-white text-2xl font-bold grid place-items-center shrink-0">
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
