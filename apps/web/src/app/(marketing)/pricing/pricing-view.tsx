'use client';

import { CHECKOUT_STORAGE_KEY } from '@/components/direct-checkout-form';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useT, type Locale } from '@/lib/i18n';
import { PageUpdatedLine } from '@/components/page-updated-line';
import { PURCHASE_CONTACT_EMAIL, purchaseState } from '@/lib/checkout-availability';
import { Button } from '@/components/ui/button';
import { CheckCircle2, Sparkles, ShieldCheck, ArrowRight, Star, AlertCircle } from 'lucide-react';

type GrandfatheringInfo = { isGrandfathered: boolean; grandfatheredUntil?: string; legacyMonthlyPriceTry?: number };

/** /billing/plans yaniti — sunucuda (page.tsx) ve istemcide ayni sekil */
export type PricingData = Awaited<ReturnType<typeof api.getPlans>>;

/**
 * Fiyat sayfasinin etkilesimli kismi. Plan verisi SUNUCUDA (page.tsx, ISR) iki dil
 * icin cekilip `initial` ile gelir: ilk HTML'de fiyat, limit ve maddeler hazir —
 * JS calistirmayan AI tarayicilari fiyati yalniz meta/JSON-LD'den degil sayfadan okur.
 * Istemci yine /billing/plans ister: gunun kuru ve satin alma durumu (checkout)
 * ISR onbelleginden taze olsun diye; gelen veri ayni sekilde ekrana yazilir.
 */
export function PricingView({ initial }: { initial: Record<Locale, PricingData | null> }) {
  const { t, locale } = useT();
  const { data: session, status } = useSession();
  const router = useRouter();
  /** Istemcide tazelenen yanit (dile gore); yoksa sunucudan gelen kullanilir */
  const [fresh, setFresh] = useState<Partial<Record<Locale, PricingData>>>({});
  const data = fresh[locale] ?? initial[locale] ?? null;
  const plans = data?.plans ?? [];
  /** Gunun TCMB kuru — fiyatlar USD, TL karsiligi bununla gosteriliyor */
  const fx = data?.fx ?? null;
  const pageCheckout: unknown = data?.checkout ?? null;
  const [cycle, setCycle] = useState<'monthly' | 'annual'>('monthly');
  const [loading, setLoading] = useState<string | null>(null);
  const [grandfathering, setGrandfathering] = useState<GrandfatheringInfo | null>(null);
  /**
   * Satin alma acik mi — PayTR test modunda kapali (lib/checkout-availability.ts).
   * pageCheckout: /plans (anonim karar, metin sayfanin dilinde; yukarida `data`dan);
   * accountCheckout: /current (oturumdaki hesap; test modunda yonetici acik). Asil kapi API'de.
   */
  const [accountCheckout, setAccountCheckout] = useState<unknown>(null);

  // Plan listesi + gunun kuru (tazeleme). Sunucu verisi varken hata sessiz gecer —
  // sayfa zaten dolu; yalniz ikisi de yoksa kullaniciya hata gosterilir.
  // NOT: bu fetch 0db5a1c'de video kredi paketi cagrisiyla ayni useEffect'te
  // oldugu icin yanlislikla silinmisti; sayfa o tarihten beri bos grid basiyordu.
  useEffect(() => {
    api.getPlans(locale)
      .then((res) => setFresh((f) => ({ ...f, [locale]: res })))
      .catch(() => { if (!initial[locale]) toast.error(t('common.error')); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale]);

  // Grandfathering + hesaba ozel satin alma durumu (sadece logged-in user icin)
  useEffect(() => {
    if (!session?.user?.id) { setAccountCheckout(null); return; }
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
    fetch(`${apiBase}/api/billing/users/${session.user.id}/current`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        setAccountCheckout(d?.checkout ?? null);
        if (d?.grandfatheredUntil) {
          setGrandfathering({
            isGrandfathered: true,
            grandfatheredUntil: d.grandfatheredUntil,
            legacyMonthlyPriceTry: d.legacyMonthlyPriceTry,
          });
        }
      })
      .catch(() => { /* not critical */ });
  }, [session?.user?.id]);


  const purchase = purchaseState({ page: pageCheckout, account: accountCheckout });

  const subscribe = async (planId: string) => {
    if (status === 'loading') return;
    if (!purchase.open) return; // butonlar zaten kilitli; API de 403 verir

    if (!session?.user?.id) {
      toast.message('Devam etmek için giriş yapın');
      router.push(`/signin?callbackUrl=${encodeURIComponent('/pricing')}`);
      return;
    }

    setLoading(planId);
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
      const res = await fetch(`${apiBase}/api/billing/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          userId: session.user.id,
          planId,
          cycle,
          userEmail: session.user.email,
          userName: session.user.name ?? session.user.email,
        }),
      });
      const data = await res.json();
      // Otomatik yenileme açık: imzalı kart formu → kendi ödeme sayfamız
      if (data.mode === 'direct') {
        try { sessionStorage.setItem(CHECKOUT_STORAGE_KEY, JSON.stringify(data)); } catch { /* noop */ }
        router.push('/billing/checkout');
        return;
      }
      if (data.iframeUrl) {
        // merchantOid success sayfasi icin saklanir: sayfa bu odemenin faturasini bulup
        // gercek durumu (dogrulaniyor / aktif / tamamlanmadi) gosterir (lib/payment-status.ts).
        // PayTR bildirimi gelmeden faturayi PAID yapan dev-confirm YALNIZ test modundaki
        // yoneticide cagrilir (mayDevConfirm: checkout {open, testMode} + PENDING fatura);
        // sunucu da yalniz ona izin verir (api paytr.service assertCheckoutOpen).
        if (data.merchantOid) {
          try { localStorage.setItem('luviai-pending-merchantOid', data.merchantOid); } catch { /* noop */ }
        }
        toast.success('Yönlendiriliyor...');
        window.location.href = data.iframeUrl;
      } else {
        toast.error(data.message ?? 'Bilinmeyen hata');
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(null);
    }
  };

  const realPlans = plans.filter((p) => p.id !== 'trial');

  return (
    <div className="relative">
      {/* gradient blob accents */}
      <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute top-10 -left-20 w-96 h-96 bg-brand-500/10 rounded-full blur-3xl" />
        <div className="absolute top-40 -right-20 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl" />
      </div>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
        <div className="max-w-3xl mx-auto text-center mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-500/10 border border-brand-500/20 text-brand-600 text-xs font-semibold mb-5">
            <Sparkles className="h-3 w-3" />
            <span>14 gün ücretsiz, 2 makale · Kredi kartı yok</span>
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-tight">
            Şeffaf fiyat,{' '}
            <span className="bg-gradient-to-r from-brand-500 via-brand-600 to-red-600 bg-clip-text text-transparent">
              ölçeklenebilir plan
            </span>
          </h1>
          <p className="mt-5 text-lg text-muted-foreground">
            {t('pricing.subtitle')}
          </p>
          <PageUpdatedLine path="/pricing" className="mt-4" />
        </div>

        {/* Grandfathering banner — sadece mevcut user'lar icin */}
        {grandfathering?.isGrandfathered && grandfathering.grandfatheredUntil && (
          <div className="mb-8 max-w-3xl mx-auto p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10">
            <div className="flex items-start gap-3">
              <Star className="h-5 w-5 text-emerald-600 mt-0.5 shrink-0" />
              <div className="flex-1 text-sm">
                <div className="font-semibold text-emerald-700 dark:text-emerald-400">
                  Eski fiyatınızla devam ediyorsunuz
                </div>
                <p className="text-emerald-700/80 dark:text-emerald-300/80 mt-1">
                  Mevcut planınız <strong>aylık ₺{grandfathering.legacyMonthlyPriceTry?.toLocaleString('tr-TR')}</strong>{' '}
                  fiyatla{' '}
                  <strong>
                    {new Date(grandfathering.grandfatheredUntil).toLocaleDateString('tr-TR', {
                      year: 'numeric', month: 'long', day: 'numeric',
                    })}
                  </strong>{' '}
                  tarihine kadar devam edecek. Bu tarihten sonra otomatik olarak yeni fiyata geçeceksiniz.
                  30 gün önce email ile hatırlatma alacaksınız.
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-center mb-12">
          <div className="inline-flex bg-background border rounded-full p-1 shadow-sm">
            <button
              onClick={() => setCycle('monthly')}
              className={`px-6 py-2 text-sm font-medium rounded-full transition-all ${
                cycle === 'monthly'
                  ? 'bg-gradient-to-br from-brand-500 to-brand-600 text-white shadow-md'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t('pricing.monthly')}
            </button>
            <button
              onClick={() => setCycle('annual')}
              className={`px-6 py-2 text-sm font-medium rounded-full transition-all flex items-center gap-2 ${
                cycle === 'annual'
                  ? 'bg-gradient-to-br from-brand-500 to-brand-600 text-white shadow-md'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t('pricing.annual')}
              {/* Yillik = 10 ay fiyatina 12 ay (plans.ts annual_usd = monthly_usd * 10) →
                  indirim %16,7. Eskiden "-20%" yaziyordu. */}
              <span className="text-[10px] bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 px-1.5 py-0.5 rounded-full font-bold">{locale === 'en' ? '2 months free' : '2 ay bedava'}</span>
            </button>
          </div>
        </div>

        {/* Kur dipnotu — TL tutarinin nereden geldigi acikca yazilir.
            Kur bayatsa (TCMB'ye ulasilamadi) kullanici bunu bilmelidir. */}
        {fx && (
          <p className="text-center text-xs text-muted-foreground mb-6">
            Fiyatlar ABD doları cinsindendir. Türk lirası tutarı{' '}
            <strong className="tabular-nums">1 USD = ₺{fx.rate.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</strong>{' '}
            kuruyla hesaplanmıştır
            {fx.source === 'TCMB' && ' (TCMB)'}
            {fx.fetchedAt && ` · ${new Date(fx.fetchedAt).toLocaleDateString('tr-TR')}`}.
            {fx.stale && (
              <span className="block mt-1 text-amber-600 dark:text-amber-400">
                Güncel kur alınamadı, son bilinen kur gösteriliyor. Ödeme sırasında güncel kur uygulanır.
              </span>
            )}
            <span className="block mt-1">Tahsilat, ödeme anındaki kurla Türk lirası olarak yapılır.</span>
          </p>
        )}

        {/* Satin alma kapali (PayTR test modu): butonlar kilitli, nedeni burada.
            Metin API'den (dile gore); Kurumsal'in iletisim butonu etkilenmez. */}
        {!purchase.open && (
          <div
            id="purchase-closed"
            role="status"
            className="mb-8 max-w-3xl mx-auto flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/5 p-4 text-sm"
          >
            <AlertCircle className="h-5 w-5 mt-0.5 shrink-0 text-warning" aria-hidden />
            <p>
              {purchase.message}{' '}
              <a href={`mailto:${PURCHASE_CONTACT_EMAIL}`} className="font-medium underline underline-offset-2">
                {PURCHASE_CONTACT_EMAIL}
              </a>
            </p>
          </div>
        )}

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {realPlans.map((p) => {
            // Fiyat USD kanonik; TL karsiligi backend'de gunun TCMB kuruyla hesaplandi
            const price = cycle === 'annual' ? p.annual : p.monthly;
            const priceTry = cycle === 'annual' ? p.annualTry : p.monthlyTry;
            const monthlyEq = cycle === 'annual' ? Math.round(p.annual / 12) : p.monthly;
            const monthlyEqTry = cycle === 'annual' ? Math.round(p.annualTry / 12) : p.monthlyTry;
            const highlighted = p.popular;
            return (
              <div
                key={p.id}
                className={`p-8 rounded-2xl border flex flex-col relative ${
                  highlighted
                    ? 'bg-gradient-to-br from-brand-500/10 to-brand-500/5 border-brand-500/30 shadow-xl shadow-brand-500/10 lg:scale-105'
                    : 'bg-background hover:border-brand-500/30 transition-colors'
                }`}
              >
                {highlighted && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-gradient-to-br from-brand-500 to-brand-600 text-white text-[10px] font-bold uppercase tracking-wider shadow-md">
                    {t('pricing.popular')}
                  </div>
                )}

                <h2 className="text-xl font-bold">{p.name}</h2>
                <div className="mt-4">
                  <span className="text-4xl sm:text-5xl font-extrabold">
                    ${price.toLocaleString('en-US')}
                  </span>
                  <span className="text-muted-foreground text-sm ml-2">
                    /{cycle === 'annual' ? 'yıl' : 'ay'}
                  </span>
                </div>
                {/* TL karsiligi — gunun TCMB kuruyla hesaplaniyor, bilgi amacli */}
                {priceTry > 0 && (
                  <p className="text-sm text-muted-foreground mt-1 tabular-nums">
                    ≈ ₺{priceTry.toLocaleString('tr-TR')}
                    <span className="text-xs"> /{cycle === 'annual' ? 'yıl' : 'ay'}</span>
                  </p>
                )}
                {cycle === 'annual' && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Aylık ortalama ${monthlyEq.toLocaleString('en-US')}
                    {monthlyEqTry > 0 && ` (≈ ₺${monthlyEqTry.toLocaleString('tr-TR')})`}
                  </p>
                )}

                {/* Maddeler plans.ts'ten geliyor — burada ikinci bir liste TUTULMAZ.
                    Onceki sabit liste her plana ayni 8 satiri basiyordu ve iki
                    maddesi ('TR + EN icerik', prompt run sayilari) hicbir calisan
                    ozellige dayanmiyordu. */}
                {p.inheritsLabel && (
                  <p className="mt-6 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {p.inheritsLabel}
                  </p>
                )}
                <ul className={`space-y-3 text-sm mb-8 flex-1 ${p.inheritsLabel ? 'mt-3' : 'mt-6'}`}>
                  {(p.features ?? []).map((f: string, i: number) => (
                    <Feat key={i} highlight={highlighted}>{f}</Feat>
                  ))}
                </ul>

                {/* contactSales planlari kart akisina GIRMEZ: "sozlesmeli kurulum"
                    vaadi varken Kurumsal'i PayTR'ye yollamak celiskiydi. API
                    tarafinda da PURCHASABLE_PLAN_IDS ile reddediliyor. */}
                {p.contactSales ? (
                  <Button asChild className="w-full" variant="outline">
                    <a href={`mailto:destek@luvihost.com?subject=${encodeURIComponent(`${p.name} planı — kurulum görüşmesi`)}`}>
                      {t('pricing.cta_contact')}
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </a>
                  </Button>
                ) : (
                  <Button
                    onClick={() => subscribe(p.id)}
                    disabled={loading === p.id || !purchase.open}
                    aria-describedby={purchase.open ? undefined : 'purchase-closed'}
                    className={`w-full ${
                      highlighted
                        ? 'bg-gradient-to-br from-brand-500 to-brand-600 hover:from-brand-600 hover:to-brand-700 text-white shadow-md'
                        : ''
                    }`}
                    variant={highlighted ? 'default' : 'outline'}
                  >
                    {loading === p.id ? t('common.loading') : (
                      <>
                        {t('pricing.cta')}
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </>
                    )}
                  </Button>
                )}
              </div>
            );
          })}
        </div>

        {/* Video Credit Add-on Section */}

        <div className="mt-12 max-w-2xl mx-auto text-center text-sm text-muted-foreground">
          <p className="inline-flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" /> {t('pricing.security_note')}
          </p>
        </div>
      </main>
    </div>
  );
}

function Feat({ children, highlight, muted }: { children: React.ReactNode; highlight?: boolean; muted?: boolean }) {
  return (
    <li className={`flex items-start gap-2 ${muted ? 'text-muted-foreground' : 'text-foreground/90'}`}>
      <CheckCircle2 className={`h-4 w-4 mt-0.5 shrink-0 ${
        muted ? 'text-muted-foreground/50' : highlight ? 'text-brand-600' : 'text-emerald-600'
      }`} />
      <span>{children}</span>
    </li>
  );
}
