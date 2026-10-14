'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Loader2, AlertCircle, Globe } from 'lucide-react';
import type { api } from '@/lib/api';
import { trackCta } from '@/lib/landing-track';
import { useT } from '@/lib/i18n';
import { CHECKER_COPY } from './checker-copy';
import { DOMAIN_EVENT } from './answer-sheet';

/**
 * Landing hero'sundaki AI gorunurluk testi — YALNIZ form + istek mantigi.
 *
 * Yukleme/sonuc katmani (sorgu kartlari, rakipler, e-posta takibi, Remotion oynatici)
 * checker-overlay.tsx'te; next/dynamic ile ancak test baslayinca indirilir. Eskiden
 * 900 satirlik tek dosya ilk yuklemede komple geliyordu. Input'a odaklaninca parca
 * onceden isitilir ki sonuc ani beklemesin.
 */

const loadOverlay = () => import('./checker-overlay');
const CheckerOverlay = dynamic(loadOverlay, { ssr: false });

type CheckResult = Awaited<ReturnType<typeof api.publicCitationCheck>>;
type Phase = 'idle' | 'loading' | 'result' | 'error';

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

export function AiVisibilityChecker() {
  const { locale } = useT();
  const c = CHECKER_COPY[locale];
  const [domain, setDomain] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<CheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const turnstileRef = useRef<HTMLDivElement | null>(null);
  const turnstileWidgetIdRef = useRef<string | null>(null);
  const tokenResolverRef = useRef<((token: string | null) => void) | null>(null);

  // Turnstile betigi yalniz site anahtari varsa yuklenir
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
        } catch { /* turnstile henuz hazir degil */ }
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

  const handleStart = async () => {
    const cleaned = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    if (!cleaned || !cleaned.includes('.')) {
      setError(c.domainHint);
      setPhase('error');
      return;
    }
    setPhase('loading');
    setError(null);
    // NEDEN olcum: sitenin ANA CTA'si bu (01.09.2026 tespiti)
    trackCta('checker_submit', { mode: 'hero' });
    // api.ts (tum uygulama istemcisi, ~1900 satir) ilk yuklemeye girmesin diye istekte yuklenir
    const { api: client, ApiError } = await import('@/lib/api');
    try {
      const token = (await getTurnstileToken()) ?? undefined;
      const res = await client.publicCitationCheck(cleaned, token);
      setResult(res);
      setPhase('result');
      trackCta('checker_result', { mode: 'hero', sorular: res?.queries?.length ?? 0 });
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

  return (
    <>
      {TURNSTILE_SITE_KEY && <div ref={turnstileRef} className="cf-turnstile" data-size="invisible" />}
      <div className="relative">
        <form
          onSubmit={(e) => { e.preventDefault(); handleStart(); }}
          className="flex flex-col gap-2 rounded-2xl border border-border bg-background p-1.5 transition-colors focus-within:border-brand sm:flex-row"
        >
          <label className="flex flex-1 items-center gap-3 px-3.5">
            <Globe className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="sr-only">{c.domainHint}</span>
            <input
              type="text"
              inputMode="url"
              value={domain}
              onChange={(e) => {
                setDomain(e.target.value);
                // Hero'daki ornek cevap karti alan adini canli gostersin
                window.dispatchEvent(new CustomEvent(DOMAIN_EVENT, { detail: e.target.value }));
              }}
              onFocus={() => { void loadOverlay(); void import('@/lib/api'); }}
              placeholder={c.placeholder}
              autoComplete="off"
              spellCheck={false}
              aria-describedby="checker-hint"
              disabled={phase === 'loading'}
              className="min-w-0 flex-1 bg-transparent py-3 text-lg font-medium outline-none placeholder:text-muted-foreground/60"
            />
          </label>
          <button
            type="submit"
            disabled={!domain.trim() || phase === 'loading'}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-55"
          >
            {phase === 'loading' ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : c.btnStart}
          </button>
        </form>

        {phase === 'error' && error && (
          <div role="alert" className="mt-3 flex items-start gap-2 p-3 rounded-lg border border-danger/30 bg-danger/10 text-danger text-xs">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <div>{error}</div>
          </div>
        )}
      </div>

      {(phase === 'loading' || phase === 'result') && (
        <CheckerOverlay phase={phase} result={result} locale={locale} c={c} onReset={handleReset} />
      )}
    </>
  );
}
