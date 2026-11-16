'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Loader2, Check, X, PlayCircle, ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { trackCta } from '@/lib/landing-track';
import type { Locale } from '@/lib/i18n';
import { VendorLogo, type VendorName } from '@/components/vendor-logo';
import { QueryCard, UnlockCta, isMeasuredRow, PROVIDER_LOGOS, PROVIDER_SHORT, type ProviderRow } from '@/components/citation/query-card';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { lockedEnginesFrom, planEngineCount, type PlanEngines } from '@/lib/locked-engines';
import { openExplainer } from './explainer-dialog';
import { isProbeAbsentText, isProbeErrorText } from '@/lib/probe-error-text';
import type { CheckerCopy } from './checker-copy';

/**
 * AI gorunurluk testinin yukleme + sonuc katmani.
 *
 * NEDEN AYRI DOSYA: bu katman (ozet, sorgu kartlari, rakip listesi, e-posta takibi)
 * landing'in en agir parcasi; ilk yuklemede gerekmiyor. ai-visibility-checker bunu
 * next/dynamic ile yalniz test baslayinca yukler.
 *
 * GORUNUM (15.11.2026): vitrin dili — duz kart (rounded-lg + ince cizgi), mono cumle
 * duzeni etiket (.v-rail; CSS `uppercase` YOK, EN'de "i"yi "İ" yapiyordu), golge ve
 * degrade yok, secili satir notr. Bu katman koyu vitrine gecerken (11.11.2026)
 * atlanmisti: turuncu degrade kartlar ve lacivert animasyon siyah sayfada kalmisti.
 * Turuncu yalniz kilit acma dugmesinde (UnlockCta) ve cevap metninde markanin
 * ustundeki fosforlu kalemde (ana sayfadaki ornek cevap kartiyla ayni isaret);
 * e-posta takibi beyaz dolu, uyelik cerceveli dugme.
 *
 * OZET (15.11.2026, sahip secimi): en ustte asistanlarin CEVAPLARI yan yana durur
 * (rakam degil kanit: ne dendi, kimin adi gecti). Eski yorunge animasyonu
 * (@remotion/player + apps/video AiScan) bu katmandan kalkti. Takip karti, bugunku
 * skoru 90 gunluk cizginin ilk noktasi olarak gosterir; gelecek gunler bos kalir
 * (uydurma rakam yok).
 */

type CheckResult = Awaited<ReturnType<typeof api.publicCitationCheck>>;

// Ucretsiz (anonim) testin SORDUGU dort asistan (api billing/plan-engines
// FREE_TEST_ENGINES; checker-copy.ts `loadingMessages` ile ayni liste). Eskiden
// burada Grok ve DeepSeek logolari da donuyordu; ucretsiz test onlara sormuyor.
const LOADING_ENGINES: VendorName[] = ['chatgpt', 'claude-ai', 'gemini', 'perplexity'];

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

  // Plan listesi (herkese acik uc): kilitli asistanlar ve "N AI motorunda" sayilari buradan
  // (lib/locked-engines.ts). Katman acilirken (yukleme asamasinda) cekilir, sonuc geldiginde
  // hazirdir. Okunamazsa kilitli asistan cizilmez; ekran eski haline duser.
  const [plans, setPlans] = useState<PlanEngines[] | null>(null);
  // Ucretsiz testin SORDUGU asistanlar (ayni yanit: freeTestEngines). Sonuctaki satirlardan
  // cikarmak yetmez: saglayici duzeyinde dusen asistan (anahtar / kredi / emekli model) sonuca
  // satir olarak HIC girmez ve "Ücretsiz Deneme planda ölçülür" diye kilitli cizilirdi
  // (bagimsiz inceleme 15.11.2026). Alan yoksa (eski API) kilitli asistan gosterilmez.
  const [freeEngines, setFreeEngines] = useState<string[] | null>(null);
  useEffect(() => {
    let alive = true;
    api.getPlans(locale)
      .then((r) => {
        if (!alive) return;
        setPlans(Array.isArray(r?.plans) ? r.plans : null);
        const free = (r as { freeTestEngines?: unknown } | null)?.freeTestEngines;
        setFreeEngines(Array.isArray(free) ? free.filter((x): x is string => typeof x === 'string') : null);
      })
      .catch(() => { /* kilitli asistan gosterilmez */ });
    return () => { alive = false; };
  }, [locale]);
  const lockedEngines = useMemo(() => {
    if (!result || !freeEngines) return [];
    // Sorulan asistanlar: testin kapsami + sonuctaki satirlar (hata veren de sayilir; ona
    // soruldu, kilitli degil)
    const asked = [...freeEngines, ...result.queries.filter((q) => !q.locked).flatMap((q) => (q.providers as ProviderRow[]).map((p) => p.provider))];
    return lockedEnginesFrom(plans, asked);
  }, [plans, freeEngines, result]);
  // Sayilar sunucudan; okunamazsa plans.ts'in her kurulumda gecerli tabani (4 / 6)
  const unlockBody = c.unlockBody
    .replace('{starter}', String(planEngineCount(plans, 'starter') ?? 4))
    .replace('{pro}', String(planEngineCount(plans, 'pro') ?? 6));

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !loading) onReset(); }}>
      <DialogContent
        size="xl"
        hideClose={loading}
        className="max-w-7xl bg-background"
        // <html lang> sunucuda "tr" basilir ve dil tarayicidan algilandiginda degismez;
        // katmanin dili burada bildirilir (ekran okuyucu, buyuk/kucuk harf kurallari).
        // Belge genelinde degistirmek Turkce-yalniz sayfalari (rehber, panel) "en" yapardi.
        lang={locale}
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
            <p className="v-rail mt-6 inline-flex h-4 items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
              {/* key yalniz metinde: ikonun donusu her mesajda bastan baslamasin */}
              <span key={loadingIdx}>{c.loadingMessages[loadingIdx]}</span>
            </p>
          </div>
        )}

        {phase === 'result' && result && (
          <div className="p-5 sm:p-8 space-y-6">
            <div className="flex items-center gap-4 pr-12">
              <DomainFavicon domain={result.domain} brand={result.brand} />
              <div className="min-w-0">
                {/* pb-1: truncate tasmayi kirpar; siki satir yuksekliginde g/ş/y kuyruklari kesilmesin */}
                <DialogTitle className="truncate pb-1 text-panel-1">{result.brand}</DialogTitle>
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

            {/* Ozet — gercek sonuctan: skor, cumle ve secili sorunun cevaplari */}
            {summary && summary.engines.length > 0 && <SummaryBlock summary={summary} brand={result.brand} c={c} />}

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
                          labels={{ title: c.unlockTitle, body: unlockBody, cta: c.unlockCta, note: c.unlockNote }}
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
                      labels={{ show: c.showResponses, hide: c.hideResponses, none: c.noCitedResponses, aiAnswer: c.aiAnswer, truncated: c.truncated, lockedHint: c.lockedHint, lockedEngines: c.lockedEngines, lockedEnginesAria: c.lockedEnginesAria }}
                      lockedEngines={lockedEngines}
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

                <OptinCard result={result} locale={locale} c={c} score={summary && summary.engines.length > 0 ? summary.score : null} getTurnstileToken={getTurnstileToken} />

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
  score,
  getTurnstileToken,
}: {
  result: CheckResult;
  locale: Locale;
  c: CheckerCopy;
  /** Bugunku skor — cizginin ilk noktasi; ozet yoksa null (nokta rakamsiz kalir) */
  score: number | null;
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
      <h5 className="text-panel-3">{c.optinHeader}</h5>
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{c.optinBody}</p>
      {/* Bugunun skoru cizginin ilk noktasi; sonraki gunler olculmedigi icin bos (uydurma rakam yok) */}
      <div className="relative mb-5 mt-5">
        <div className="absolute inset-x-2 top-[6px] border-t border-dashed border-border" aria-hidden />
        <ol className="relative flex justify-between">
          {c.optinSteps.map((step, i) => (
            <li key={step} className={`flex flex-col ${i === 0 ? 'items-start' : i === c.optinSteps.length - 1 ? 'items-end' : 'items-center'}`}>
              <span className={`h-[13px] w-[13px] rounded-full ${i === 0 ? 'bg-foreground' : 'border border-dashed border-muted-foreground/60 bg-card'}`} aria-hidden />
              <span className={`mt-2.5 font-mono text-vitrin-rail ${i === 0 ? 'text-foreground' : 'text-muted-foreground'}`}>{step}</span>
              <span className={`mt-0.5 text-sm tabular-nums ${i === 0 ? '' : 'text-muted-foreground/50'}`}>{i === 0 && score !== null ? score : '—'}</span>
            </li>
          ))}
        </ol>
      </div>
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
          {/* Ilk rapor tarihi ve rapor sayisi cizgide gorunuyor; burada yalniz iptal notu */}
          <p className="text-label text-muted-foreground">{c.optinSubBenefit3}</p>
        </form>
      )}
    </div>
  );
}

/** Beyaz dolu dugme: turuncunun (kilit acma) bir alt kademesi */
const SOLID_BTN =
  'inline-flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-md bg-foreground px-5 text-sm font-medium text-background transition-opacity duration-200 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50';

type Summary = ReturnType<typeof summarize>;

/** Fosforlu kalem: ana sayfadaki ornek cevap kartiyla ayni isaret (marka cevapta nerede) */
function markBrand(text: string, brand: string) {
  const re = brandRegex(brand, 'gi');
  if (!re) return text;
  // split + yakalama grubu: tek indeksli parcalar eslesmelerdir
  return text.split(re).map((part, i) =>
    i % 2 === 1 ? (
      <mark key={i} className="rounded-sm bg-brand-vivid px-1 text-black">{part}</mark>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

function brandRegex(brand: string, flags: string): RegExp | null {
  if (!brand || brand.length < 3) return null;
  return new RegExp(`(${brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, flags);
}

/**
 * Ozet: skor + cumle, altinda secili sorunun cevaplari yan yana (anan asistanlar
 * once). Dar ekranda cevap metinleri yerine durum kutucuklari gosterilir; metinler
 * soru kartlarindaki "Yanitlari gor" altinda zaten var.
 *
 * ALINTI SINIRI: sunucu cevabin ilk 220 karakterini yollar (ai-citation.service
 * `excerpt`). Marka daha sonra geciyorsa alintida gorunmez; kutu bunu acikca soyler,
 * "andi" deyip isaret gostermemek kafa karistirirdi.
 */
function SummaryBlock({ summary, brand, c }: { summary: Summary; brand: string; c: CheckerCopy }) {
  const [qi, setQi] = useState(0);
  const total = summary.questions.length;
  const q = total > 0 ? summary.questions[Math.min(qi, total - 1)] : null;
  const citedCount = summary.engines.filter((e) => e.cited).length;
  const rank = (p: ProviderRow) => (!isMeasuredRow(p) ? 2 : p.cited || p.brandMentioned ? 0 : 1);
  const panes = q ? [...(q.providers as ProviderRow[])].sort((a, b) => rank(a) - rank(b)) : [];
  const pagerBtn = 'grid h-7 w-7 place-items-center rounded border border-border text-muted-foreground transition-colors hover:border-foreground hover:text-foreground';
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 px-4 pt-4 sm:px-6 sm:pt-5">
        <div className="min-w-0">
          <p className="v-rail">{c.replayTitle}</p>
          <p className="mt-2 text-vitrin-3">
            {c.summaryLine.replace('{n}', String(summary.engines.length)).replace('{k}', String(citedCount))}
          </p>
        </div>
        <div className="flex items-end gap-2">
          <span className="text-vitrin-2 tabular-nums">{summary.score}</span>
          <span className="v-rail pb-2">{c.scoreLabel}</span>
        </div>
      </div>

      <ul className="flex flex-wrap gap-2 px-4 pb-5 pt-4 sm:hidden">
        {summary.engines.map((e) => (
          <li
            key={e.provider}
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs ring-1 ${e.cited ? 'bg-success/10 text-success ring-success/50' : 'bg-muted/60 text-muted-foreground ring-border'}`}
          >
            {/* Durum yalniz renkle anlatilmaz: ikon + ekran okuyucu metni. Logo susleme
                (alt bos), ad zaten yaninda yaziyor. */}
            {PROVIDER_LOGOS[e.provider] && <VendorLogo name={PROVIDER_LOGOS[e.provider]} size={14} alt="" />}
            {e.label}
            {e.cited ? <Check className="h-3 w-3" strokeWidth={3} aria-hidden /> : <X className="h-3 w-3" strokeWidth={3} aria-hidden />}
            <span className="sr-only">{e.cited ? c.citedLabel : c.notCitedLabel}</span>
          </li>
        ))}
      </ul>

      {q && (
        <div className="hidden sm:block">
          <div className="mx-6 mt-5 flex items-center gap-3 rounded-md border border-border bg-background px-4 py-2.5">
            <span className="v-rail shrink-0">{c.askedLabel}</span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium" title={q.query}>{q.query}</span>
            <span className="v-rail shrink-0 tabular-nums">
              {c.questionCounter.replace('{i}', String(Math.min(qi, total - 1) + 1)).replace('{n}', String(total))}
            </span>
            {total > 1 && (
              <span className="flex shrink-0 gap-1">
                <button type="button" onClick={() => setQi((i) => (i - 1 + total) % total)} aria-label={c.prevQuestion} className={pagerBtn}>
                  <ChevronLeft className="h-4 w-4" aria-hidden />
                </button>
                <button type="button" onClick={() => setQi((i) => (i + 1) % total)} aria-label={c.nextQuestion} className={pagerBtn}>
                  <ChevronRight className="h-4 w-4" aria-hidden />
                </button>
              </span>
            )}
          </div>
          {/* Hucre cizgileri: son sutun/satirin cizgisi -1px ile disari tasar ve kirpilir
              (asistan sayisi 4'e bolunmese de bos hucre cizgisi kalmaz) */}
          <div className="mt-5 overflow-hidden border-t border-border">
            <div className="-mb-px -mr-px grid sm:grid-cols-2 lg:grid-cols-4">
              {panes.map((p) => <AnswerPane key={p.provider} p={p} brand={brand} c={c} />)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AnswerPane({ p, brand, c }: { p: ProviderRow; brand: string; c: CheckerCopy }) {
  const logo = PROVIDER_LOGOS[p.provider];
  const measured = isMeasuredRow(p);
  const ok = measured && (p.cited || p.brandMentioned);
  const text = measured && p.excerpt && !isProbeErrorText(p.excerpt) ? p.excerpt : '';
  const inText = !!text && !!brandRegex(brand, 'i')?.test(text);
  const status = !measured ? (isProbeAbsentText(p.excerpt) ? c.paneSurfaceAbsent : c.paneNoAnswer) : p.brandMentioned ? c.paneMentioned : p.cited ? c.paneCited : c.paneAbsent;
  return (
    <div className="flex min-h-[11rem] flex-col border-b border-r border-border p-5">
      <div className="flex items-center gap-2">
        {logo && <VendorLogo name={logo} size={18} alt="" />}
        <span className="text-sm font-medium">{PROVIDER_SHORT[p.provider] || p.label}</span>
      </div>
      <p className={`mt-3 flex-1 text-sm leading-relaxed ${ok ? 'text-foreground/90' : 'text-muted-foreground'}`}>
        {text && markBrand(text, brand)}
        {text.length >= 210 && <span className="text-muted-foreground/60">{c.truncated}</span>}
      </p>
      {ok && text && !inText && (
        <p className="mt-2 text-xs text-muted-foreground">{p.brandMentioned ? c.paneLater : c.paneSourceOnly}</p>
      )}
      <p className={`mt-4 inline-flex items-center gap-2 font-mono text-vitrin-rail ${ok ? 'text-success' : 'text-muted-foreground'}`}>
        <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden /> {status}
      </p>
    </div>
  );
}

/**
 * Gercek sonuctan ozet: skor = olculen (kilitsiz, marka adi gecmeyen)
 * sorularda motor cevaplarinin yuzde kaci markayi andi; motor "anildi" = bu
 * sorulardan en az birinde anildi ya da kaynak gosterdi (skordaki citedCount ile
 * ayni birim; eskiden yalniz alan adi atfi sayiliyordu ve markayi anan motor
 * ozette "Anılmadı" gorunuyordu). `questions`: ozetin sayfaladigi ayni sorular.
 *
 * Payda sunucudan: totalProviders yalniz o soruda gercekten olculen asistanlar.
 * Hata veren saglayici (measured=false) motor listesine girmez — ozetteki
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
      // Kisa ad: API etiketi ("Anthropic Claude", "OpenAI ChatGPT") dar kutulara
      // sigmiyor; soru kartlari da ayni kisa adi kullaniyor.
      const e = engines.get(p.provider) ?? { provider: p.provider, label: PROVIDER_SHORT[p.provider] || p.label, cited: false };
      e.cited = e.cited || p.cited || p.brandMentioned;
      engines.set(p.provider, e);
    }
  }
  return { score: total > 0 ? Math.round((cited / total) * 100) : 0, engines: [...engines.values()], questions: base };
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
