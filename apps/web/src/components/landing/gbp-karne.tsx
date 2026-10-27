'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowRight, Loader2, MapPin, Search } from 'lucide-react';
import type { GbpAday, GbpDenetim } from '@/lib/api';
import { gbpHataMetni } from '@/lib/google-isletme';
import { SIGNUP_HREF } from '@/lib/rehber';
import { DenetimKarti, GoogleAttribution } from '@/components/google-isletme/denetim-karti';
import { AdayKarti } from '@/components/google-isletme/aday-karti';

/**
 * Ucretsiz Google Isletme karnesi (/google-isletme-karnesi) — isletme ara → sec → canli karne.
 *
 * Turnstile: ai-visibility-checker.tsx ile ayni gorunmez parcacik (window.turnstile tipi orada).
 * Token tek kullanimlik: arama ve karne icin ayri ayri alinir. Sunucu IP basina gunluk sinir (429)
 * ve gunluk harcama tavani (503) uygular; sonuc saklanmaz.
 */

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

type Faz = 'bos' | 'araniyor' | 'adaylar' | 'denetleniyor' | 'sonuc';

export function GbpKarne() {
  const [sorgu, setSorgu] = useState('');
  const [faz, setFaz] = useState<Faz>('bos');
  const [adaylar, setAdaylar] = useState<GbpAday[]>([]);
  const [secilen, setSecilen] = useState<string | null>(null);
  const [sonuc, setSonuc] = useState<GbpDenetim | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const turnstileRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const resolverRef = useRef<((token: string | null) => void) | null>(null);

  // Turnstile betigi yalniz site anahtari varsa yuklenir
  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return;
    if (!document.querySelector('script[src*="turnstile/v0/api.js"]')) {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.defer = true;
      document.head.appendChild(s);
    }
  }, []);

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !turnstileRef.current) return;
    let iptal = false;
    const interval = setInterval(() => {
      if (iptal) return;
      if (window.turnstile && turnstileRef.current && !widgetIdRef.current) {
        try {
          widgetIdRef.current = window.turnstile.render(turnstileRef.current, {
            sitekey: TURNSTILE_SITE_KEY!,
            size: 'invisible',
            callback: (token) => { resolverRef.current?.(token); resolverRef.current = null; },
            'error-callback': () => { resolverRef.current?.(null); resolverRef.current = null; },
            'expired-callback': () => {
              if (widgetIdRef.current && window.turnstile) window.turnstile.reset(widgetIdRef.current);
            },
          });
          clearInterval(interval);
        } catch { /* turnstile henuz hazir degil */ }
      }
    }, 200);
    return () => {
      iptal = true;
      clearInterval(interval);
      if (widgetIdRef.current && window.turnstile) {
        try { window.turnstile.remove(widgetIdRef.current); } catch { /* noop */ }
        widgetIdRef.current = null;
      }
    };
  }, []);

  const token = (): Promise<string | undefined> => {
    if (!TURNSTILE_SITE_KEY || !window.turnstile || !widgetIdRef.current) return Promise.resolve(undefined);
    return new Promise((resolve) => {
      resolverRef.current = (t) => resolve(t ?? undefined);
      try {
        window.turnstile!.reset(widgetIdRef.current!);
        window.turnstile!.execute(widgetIdRef.current!);
      } catch {
        resolve(undefined);
      }
      setTimeout(() => {
        if (resolverRef.current) { resolverRef.current(null); resolverRef.current = null; }
      }, 15_000);
    });
  };

  async function ara() {
    const q = sorgu.trim();
    if (q.length < 3) {
      setHata('İşletme adını ve şehri yazın (ör. Kahve Durağı Kadıköy).');
      return;
    }
    setFaz('araniyor');
    setHata(null);
    setSonuc(null);
    // api.ts (tum uygulama istemcisi) ilk yuklemeye girmesin diye istekte yuklenir
    const { api } = await import('@/lib/api');
    try {
      const r = await api.publicGbpAra(q, await token());
      setAdaylar(r);
      setFaz('adaylar');
    } catch (err) {
      setHata(gbpHataMetni(err, 'public'));
      setFaz('bos');
    }
  }

  async function karne(a: GbpAday) {
    setSecilen(a.placeId);
    setFaz('denetleniyor');
    setHata(null);
    const { api } = await import('@/lib/api');
    try {
      setSonuc(await api.publicGbpKarne(a.placeId, await token()));
      setFaz('sonuc');
    } catch (err) {
      setHata(gbpHataMetni(err, 'public'));
      setFaz('adaylar');
    }
  }

  const mesgul = faz === 'araniyor' || faz === 'denetleniyor';

  return (
    <div className="space-y-5">
      {TURNSTILE_SITE_KEY && <div ref={turnstileRef} className="cf-turnstile" data-size="invisible" />}

      <form
        onSubmit={(e) => { e.preventDefault(); void ara(); }}
        className="flex flex-col gap-2 rounded-2xl border border-border bg-background p-1.5 transition-colors focus-within:border-brand sm:flex-row"
      >
        <label className="flex flex-1 items-center gap-3 px-3.5">
          <MapPin className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="sr-only">İşletme adı ve şehir</span>
          <input
            type="text"
            value={sorgu}
            onChange={(e) => setSorgu(e.target.value)}
            onFocus={() => { void import('@/lib/api'); }}
            placeholder="İşletme adı ve şehir"
            autoComplete="off"
            maxLength={120}
            disabled={mesgul}
            className="min-w-0 flex-1 bg-transparent py-3 text-lg font-medium outline-none placeholder:text-muted-foreground/60"
          />
        </label>
        <button
          type="submit"
          disabled={mesgul}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-55"
        >
          {faz === 'araniyor' ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <Search className="h-5 w-5" aria-hidden />}
          İşletmemi bul
        </button>
      </form>

      {hata && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div>{hata}</div>
        </div>
      )}

      {(faz === 'adaylar' || faz === 'denetleniyor') && (
        adaylar.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Sonuç bulunamadı. İşletme adını Google Haritalar’da göründüğü gibi ve şehirle birlikte yazın.
          </p>
        ) : (
          <div className="space-y-2">
            <p className="text-sm font-medium">İşletmenizi seçin</p>
            <ul className="divide-y rounded-xl border bg-card">
              {adaylar.map((a) => (
                <li key={a.placeId}>
                  <AdayKarti
                    aday={a}
                    aksiyon={
                      <button
                        type="button"
                        onClick={() => karne(a)}
                        disabled={mesgul}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-br from-brand-500 to-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:from-brand-600 hover:to-brand-700 disabled:cursor-wait disabled:opacity-60"
                      >
                        Karnemi çıkar
                        {faz === 'denetleniyor' && secilen === a.placeId
                          ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                          : <ArrowRight className="h-4 w-4" aria-hidden />}
                      </button>
                    }
                  />
                </li>
              ))}
            </ul>
            <GoogleAttribution />
          </div>
        )
      )}

      {faz === 'sonuc' && sonuc && (
        <div className="space-y-5">
          <DenetimKarti
            sonuc={sonuc}
            not="Bu karne Google Haritalar’daki herkese açık bilgilerden anlık hesaplanır ve saklanmaz. Sitenizdeki adres ve telefonla karşılaştırma RanksUp panelinde yapılır."
          />
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border bg-card p-6">
            <div>
              <p className="font-bold">Profilinizi RanksUp’ta takip edin — 14 gün ücretsiz</p>
              <p className="text-sm text-muted-foreground">
                Sitenizle tutarlılık denetimi, yerel AI soruları ve AI asistanlarında görünürlük ölçümü tek panelde. Kart gerekmez.
              </p>
            </div>
            <Link
              href={SIGNUP_HREF as any}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-br from-brand-500 to-brand-600 px-4 py-2 text-sm font-semibold text-white hover:from-brand-600 hover:to-brand-700"
            >
              Ücretsiz başla <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </div>
          <button
            type="button"
            onClick={() => { setFaz('bos'); setSonuc(null); setAdaylar([]); }}
            className="text-sm font-medium text-brand hover:underline"
          >
            Başka bir işletmeyi denetle
          </button>
        </div>
      )}
    </div>
  );
}
