'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowRight, Loader2, AlertCircle, Unlock, Lock, Check } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { QueryCard } from '@/components/citation/query-card';
import { UNLOCK_DOMAIN_KEY } from '@/lib/unlock-return';

type UnlockResult = Awaited<ReturnType<typeof api.publicCitationUnlock>>;

const COPY = {
  tr: {
    running: 'Kalan sorular 7 AI motorunda ölçülüyor…',
    runningSub: 'Bu işlem ~40 saniye sürer. Sayfayı kapatmayın.',
    title: 'Tam rapor hazır',
    subtitle: '{n} sorunun tamamı ölçüldü',
    missingDomain: 'Domain bilgisi yok. Ana sayfadan yeni bir test başlatın.',
    errorTitle: 'Kilit açılamadı',
    backHome: 'Ana sayfa',
    addSite: 'Siteyi ekle ve haftalık takibe al',
    competitorHeader: 'Rakip Karşılaştırması',
    competitorEmpty: 'Bu sorgularda öne çıkan rakip bulunamadı.',
    youLabel: '(siz)',
    showResponses: 'Yanıtları gör',
    hideResponses: 'Yanıtları gizle',
    noCitedResponses: 'Hiçbir motor markanızı cevabında geçirmedi.',
    aiAnswer: 'AI cevabı',
    truncated: '… (kısaltıldı)',
    lockedHint: 'Ölçülmedi.',
    payTitle: 'Tam raporu açmak için bir plan seç',
    payBody: '{domain} için 10 sorunun tamamı 7 AI motorunda ölçülecek: hangi motorlarda geçtiğin, AI cevaplarının tam metni ve rakip payın. Ücretsiz test yalnızca ilk birkaç soruyu ölçüyor.',
    payCta: 'Planları gör',
    payBack: 'Ücretsiz teste dön',
    payBullet1: '10 sorunun tamamı, 7 AI motorunda',
    payBullet2: 'AI cevaplarının tam metni + rakip payı',
    payBullet3: 'Haftalık otomatik retest ve düşüş alarmı',
  },
  en: {
    running: 'Measuring the remaining prompts across 7 AI engines…',
    runningSub: 'This takes ~40 seconds. Please keep this page open.',
    title: 'Full report ready',
    subtitle: 'All {n} prompts measured',
    missingDomain: 'No domain provided. Start a new test from the home page.',
    errorTitle: 'Could not unlock',
    backHome: 'Home',
    addSite: 'Add site and start weekly tracking',
    competitorHeader: 'Competitor Ranking',
    competitorEmpty: 'No competitors stood out in these queries.',
    youLabel: '(you)',
    showResponses: 'Show responses',
    hideResponses: 'Hide responses',
    noCitedResponses: 'No engine cited your brand in their answer.',
    aiAnswer: 'AI answer',
    truncated: '… (truncated)',
    lockedHint: 'Not measured.',
    payTitle: 'Choose a plan to unlock the full report',
    payBody: 'All 10 prompts for {domain} will be measured across 7 AI engines: which engines mention you, the full answer text, and your competitor share. The free test only measures the first few.',
    payCta: 'See plans',
    payBack: 'Back to free test',
    payBullet1: 'All 10 prompts across 7 AI engines',
    payBullet2: 'Full AI answer text + competitor share',
    payBullet3: 'Weekly auto-retest and drop alerts',
  },
} as const;

/**
 * /unlock?domain=... — landing teaser'inin devami.
 *
 * Landing'de anonim ziyaretci 10 sorudan 2'sini olculmus halde gorur. "Tum
 * raporu ac" CTA'si signin'e callbackUrl ile gonderir; giris sonrasi buraya
 * doner ve kalan sorular UYE kademesinde (Opus 5) olculur.
 */
export default function UnlockPage() {
  // useSearchParams prerender sirasinda Suspense siniri ister (Next 15).
  return (
    <Suspense
      fallback={
        <div className="max-w-xl mx-auto p-10 text-center">
          <Loader2 className="h-10 w-10 mx-auto animate-spin text-brand-600" />
        </div>
      }
    >
      <UnlockView />
    </Suspense>
  );
}

function UnlockView() {
  const { locale } = useT();
  const c = COPY[locale];
  const params = useSearchParams();
  const domain = (params.get('domain') ?? '').trim();

  const [result, setResult] = useState<UnlockResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 402 = plan satin alinmamis. Hata degil, satis adimi — ayri ele alinir.
  const [needsPayment, setNeedsPayment] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  // React 18 StrictMode dev'de effect'i iki kez calistirir — kota tuketen
  // bir cagri oldugu icin tek seferlik guard sart.
  const startedRef = useRef(false);

  useEffect(() => {
    if (!domain || startedRef.current) return;
    startedRef.current = true;
    api
      .publicCitationUnlock(domain)
      .then(setResult)
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 402) {
          setNeedsPayment(true);
          return;
        }
        setError(err instanceof ApiError ? err.message : (err as Error)?.message ?? 'Beklenmedik hata');
      });
  }, [domain]);

  const toggle = (i: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  if (!domain) {
    return (
      <div className="max-w-xl mx-auto p-8 text-center">
        <p className="text-sm text-muted-foreground mb-4">{c.missingDomain}</p>
        <Link href="/" className="inline-flex bg-brand-600 hover:bg-brand-700 text-white px-5 py-2.5 rounded-lg text-sm font-bold transition-colors">
          {c.backHome}
        </Link>
      </div>
    );
  }

  // ODEME ADIMI — kilit satin almayla acilir, giris yapmak yetmez.
  // Bu bir hata ekrani degil satis ekrani: ne kazanacagini gosterip
  // /pricing'e (PayTR iframe akisi) yonlendirir.
  if (needsPayment) {
    return (
      <div className="max-w-lg mx-auto p-6 sm:p-10">
        <div className="bg-muted/30 rounded-2xl border p-6 sm:p-8 text-center">
          <div className="inline-grid place-items-center w-12 h-12 rounded-full bg-brand-500/10 mb-4">
            <Lock className="h-6 w-6 text-brand-600" />
          </div>
          <h1 className="text-xl font-bold mb-2">{c.payTitle}</h1>
          <p className="text-sm text-muted-foreground leading-relaxed mb-5">
            {c.payBody.replace('{domain}', domain)}
          </p>

          <ul className="text-sm text-left space-y-2 mb-6 max-w-sm mx-auto">
            {[c.payBullet1, c.payBullet2, c.payBullet3].map((b) => (
              <li key={b} className="flex items-start gap-2">
                <Check className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" strokeWidth={3} />
                <span>{b}</span>
              </li>
            ))}
          </ul>

          <Link
            href="/pricing"
            // PayTR'in donus adresi (ok_url) sabit oldugu icin query param
            // tasinamiyor; hedef domaini localStorage'a birakiyoruz ve
            // /billing/success odeme sonrasi buraya geri getiriyor.
            onClick={() => {
              try { localStorage.setItem(UNLOCK_DOMAIN_KEY, domain); } catch { /* noop */ }
            }}
            className="w-full inline-flex items-center justify-center gap-2 bg-brand-600 hover:bg-brand-700 text-white px-5 py-3 rounded-lg text-sm font-bold transition-colors"
          >
            {c.payCta}
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link href="/" className="mt-3 inline-flex text-xs font-semibold text-muted-foreground hover:text-foreground">
            {c.payBack}
          </Link>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-xl mx-auto p-8">
        <div className="flex items-start gap-3 p-4 rounded-xl border border-[#C43C2E]/40 bg-[#C43C2E]/10 text-[#C43C2E] dark:text-[#E8907F] text-sm">
          <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
          <div>
            <div className="font-bold mb-0.5">{c.errorTitle}</div>
            <div>{error}</div>
          </div>
        </div>
        <Link href="/" className="mt-4 inline-flex text-sm font-semibold text-brand-600 hover:underline">
          {c.backHome}
        </Link>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="max-w-xl mx-auto p-10 text-center">
        <Loader2 className="h-10 w-10 mx-auto mb-5 animate-spin text-brand-600" />
        <p className="font-bold text-base mb-1">{c.running}</p>
        <p className="text-sm text-muted-foreground">{c.runningSub}</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-8 space-y-6">
      <div className="flex items-center gap-3">
        <div className="inline-grid place-items-center w-10 h-10 rounded-full bg-brand-500/10 shrink-0">
          <Unlock className="h-5 w-5 text-brand-600" />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-bold truncate">
            {c.title} — {result.brand}
          </h1>
          <p className="text-sm text-muted-foreground">
            {c.subtitle.replace('{n}', String(result.queries.length))} · {result.domain}
          </p>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          {result.queries.map((q, idx) => (
            <QueryCard
              key={idx}
              q={q}
              idx={idx}
              brand={result.brand}
              lang={locale}
              isOpen={expanded.has(idx)}
              onToggle={() => toggle(idx)}
              labels={{
                show: c.showResponses,
                hide: c.hideResponses,
                none: c.noCitedResponses,
                aiAnswer: c.aiAnswer,
                truncated: c.truncated,
                lockedHint: c.lockedHint,
              }}
            />
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
                  <div
                    key={comp.name + idx}
                    className={`flex items-center gap-3 p-2 rounded-lg ${comp.isBrand ? 'bg-brand-500/10 ring-1 ring-brand-500/30' : ''}`}
                  >
                    <span
                      className={`inline-grid place-items-center w-6 h-6 rounded-md text-xs font-bold shrink-0 ${comp.isBrand ? 'bg-brand-600 text-white' : 'bg-muted text-foreground'}`}
                    >
                      {idx + 1}
                    </span>
                    <span className="flex-1 text-sm font-medium truncate">
                      {comp.name}
                      {comp.isBrand && (
                        <span className="text-brand-600 text-xs ml-1.5 font-bold">{c.youLabel}</span>
                      )}
                    </span>
                    <span
                      className={`text-sm font-bold shrink-0 ${comp.isBrand ? 'text-brand-600' : 'text-muted-foreground'}`}
                    >
                      {comp.pct}%
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <Link
            href={`/onboarding?url=${encodeURIComponent(`https://${result.domain}`)}`}
            className="w-full inline-flex items-center justify-center gap-2 bg-brand-600 hover:bg-brand-700 text-white px-5 py-3 rounded-lg text-sm font-bold transition-colors"
          >
            {c.addSite}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}
