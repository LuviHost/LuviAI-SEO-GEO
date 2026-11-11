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
import { VitrinBand, VitrinHero, VITRIN_LINK } from '@/components/vitrin/vitrin-page';
import { ArrowUpRight, Check, Star, AlertCircle } from 'lucide-react';

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
      // Bos ya da bozuk yanit sunucudan gelen dolu veriyi EZMEZ
      .then((res) => {
        if (Array.isArray(res?.plans) && res.plans.length > 0) setFresh((f) => ({ ...f, [locale]: res }));
      })
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

  // Koyu vitrin (Kasim 2026): iki tonlu baslik, bitisik hucreli plan izgarasi (ana sayfadaki
  // fiyat bolumuyle ayni dil). Yalniz gorunum degisti; odeme akisi ve metinler ayni.
  return (
    <div>
      <VitrinHero
        rail="14 gün ücretsiz, 2 makale · Kredi kartı yok"
        a="Şeffaf fiyat,"
        b="ölçeklenebilir plan"
        lead={t('pricing.subtitle')}
      >
        <PageUpdatedLine path="/pricing" className="mt-4 font-mono" />
      </VitrinHero>

      <VitrinBand>
        {/* Grandfathering banner — sadece mevcut user'lar icin */}
        {grandfathering?.isGrandfathered && grandfathering.grandfatheredUntil && (
          <div className="mb-8 max-w-3xl rounded-lg border border-success/30 bg-success/5 p-4">
            <div className="flex items-start gap-3">
              <Star className="mt-0.5 h-5 w-5 shrink-0 text-success" />
              <div className="flex-1 text-sm">
                <div className="font-medium text-success">
                  Eski fiyatınızla devam ediyorsunuz
                </div>
                <p className="mt-1 leading-relaxed text-muted-foreground">
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

        <div className="mb-10 flex flex-wrap items-end justify-between gap-x-10 gap-y-6">
          <div className="inline-flex rounded-md border border-border p-1" role="group" aria-label={`${t('pricing.monthly')} / ${t('pricing.annual')}`}>
            <button
              type="button"
              aria-pressed={cycle === 'monthly'}
              onClick={() => setCycle('monthly')}
              className={`inline-flex h-9 items-center rounded px-4 text-sm font-medium transition-colors duration-200 ${
                cycle === 'monthly' ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t('pricing.monthly')}
            </button>
            <button
              type="button"
              aria-pressed={cycle === 'annual'}
              onClick={() => setCycle('annual')}
              className={`inline-flex h-9 items-center gap-2 rounded px-4 text-sm font-medium transition-colors duration-200 ${
                cycle === 'annual' ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t('pricing.annual')}
              {/* Yillik = 10 ay fiyatina 12 ay (plans.ts annual_usd = monthly_usd * 10) →
                  indirim %16,7. Eskiden "-20%" yaziyordu. */}
              <span className={`font-mono text-vitrin-rail ${cycle === 'annual' ? 'opacity-70' : 'text-brand-vivid'}`}>{locale === 'en' ? '2 months free' : '2 ay bedava'}</span>
            </button>
          </div>

          {/* Kur dipnotu — TL tutarinin nereden geldigi acikca yazilir.
              Kur bayatsa (TCMB'ye ulasilamadi) kullanici bunu bilmelidir. */}
          {fx && (
            <p className="max-w-xl text-xs leading-relaxed text-muted-foreground lg:text-right">
              Fiyatlar ABD doları cinsindendir. Türk lirası tutarı{' '}
              <strong className="font-medium text-foreground tabular-nums">1 USD = ₺{fx.rate.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</strong>{' '}
              kuruyla hesaplanmıştır
              {fx.source === 'TCMB' && ' (TCMB)'}
              {/* Saat dilimi sabit: bu satir artik sunucuda da basiliyor; tarayicinin dilimiyle
                  formatlansa UTC+11 gibi bir istemcide gun kayar ve hidrasyon uyusmazligi olur. */}
              {fx.fetchedAt && ` · ${new Date(fx.fetchedAt).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' })}`}.
              {fx.stale && (
                <span className="mt-1 block text-warning">
                  Güncel kur alınamadı, son bilinen kur gösteriliyor. Ödeme sırasında güncel kur uygulanır.
                </span>
              )}
              <span className="mt-1 block">Tahsilat, ödeme anındaki kurla Türk lirası olarak yapılır.</span>
            </p>
          )}
        </div>

        {/* Satin alma kapali (PayTR test modu): butonlar kilitli, nedeni burada.
            Metin API'den (dile gore); Kurumsal'in iletisim butonu etkilenmez. */}
        {!purchase.open && (
          <div
            id="purchase-closed"
            role="status"
            className="mb-8 flex max-w-3xl items-start gap-3 rounded-lg border border-warning/30 bg-warning/5 p-4 text-sm"
          >
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden />
            <p>
              {purchase.message}{' '}
              <a href={`mailto:${PURCHASE_CONTACT_EMAIL}`} className={VITRIN_LINK}>
                {PURCHASE_CONTACT_EMAIL}
              </a>
            </p>
          </div>
        )}

        {/* Bitisik hucreler: kartlar arasi bosluk yerine tek ince cizgi */}
        <div className="grid border-l border-t border-border sm:grid-cols-2 lg:grid-cols-4">
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
                className={`relative flex flex-col border-b border-r border-border p-6 sm:p-7 ${highlighted ? 'bg-card' : ''}`}
              >
                {/* Onerilen plan: ustte turuncu cizgi + etiket (cerceve, golge, buyutme yerine).
                    Etiket ana sayfadakiyle ayni ("Önerilen"); "en çok tercih edilen" dogrulanmis bir veri degildi. */}
                {highlighted && <span className="absolute inset-x-0 top-0 h-0.5 bg-brand-vivid" aria-hidden />}

                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="text-base font-medium">{p.name}</h2>
                  {highlighted && <p className="font-mono text-vitrin-rail text-brand-vivid">{t('land.pricing.most_popular')}</p>}
                </div>
                <div className="mt-6 flex items-baseline gap-1">
                  <span className="text-5xl font-[450] tracking-[-0.05em] tabular-nums">
                    ${price.toLocaleString('en-US')}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    /{cycle === 'annual' ? 'yıl' : 'ay'}
                  </span>
                </div>
                {/* TL karsiligi — gunun TCMB kuruyla hesaplaniyor, bilgi amacli */}
                {priceTry > 0 && (
                  <p className="mt-1 text-sm text-muted-foreground tabular-nums">
                    ≈ ₺{priceTry.toLocaleString('tr-TR')}
                    <span className="text-xs"> /{cycle === 'annual' ? 'yıl' : 'ay'}</span>
                  </p>
                )}
                {cycle === 'annual' && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Aylık ortalama ${monthlyEq.toLocaleString('en-US')}
                    {monthlyEqTry > 0 && ` (≈ ₺${monthlyEqTry.toLocaleString('tr-TR')})`}
                  </p>
                )}

                {/* Maddeler plans.ts'ten geliyor — burada ikinci bir liste TUTULMAZ.
                    Onceki sabit liste her plana ayni 8 satiri basiyordu ve iki
                    maddesi ('TR + EN icerik', prompt run sayilari) hicbir calisan
                    ozellige dayanmiyordu. */}
                {p.inheritsLabel && (
                  <p className="mt-6 text-sm text-muted-foreground">
                    {p.inheritsLabel}
                  </p>
                )}
                <ul className={`mb-8 flex-1 space-y-2.5 text-sm leading-relaxed ${p.inheritsLabel ? 'mt-3' : 'mt-6'}`}>
                  {(p.features ?? []).map((f: string, i: number) => (
                    <Feat key={i}>{f}</Feat>
                  ))}
                </ul>

                {/* contactSales planlari kart akisina GIRMEZ: "sozlesmeli kurulum"
                    vaadi varken Kurumsal'i PayTR'ye yollamak celiskiydi. API
                    tarafinda da PURCHASABLE_PLAN_IDS ile reddediliyor. */}
                {p.contactSales ? (
                  <a
                    href={`mailto:destek@luvihost.com?subject=${encodeURIComponent(`${p.name} planı — kurulum görüşmesi`)}`}
                    className="v-btn-line w-full"
                  >
                    {t('pricing.cta_contact')}
                    <ArrowUpRight className="h-4 w-4" aria-hidden />
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={() => subscribe(p.id)}
                    disabled={loading === p.id || !purchase.open}
                    aria-describedby={purchase.open ? undefined : 'purchase-closed'}
                    className={`w-full disabled:cursor-not-allowed disabled:opacity-55 ${highlighted ? 'v-btn' : 'v-btn-line'}`}
                  >
                    {loading === p.id ? t('common.loading') : (
                      <>
                        {t('pricing.cta')}
                        <ArrowUpRight className="h-4 w-4" aria-hidden />
                      </>
                    )}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <p className="mt-8 text-sm text-muted-foreground">{t('pricing.security_note')}</p>
      </VitrinBand>
    </div>
  );
}

function Feat({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <Check className="mt-1 h-3.5 w-3.5 shrink-0 text-brand-vivid" aria-hidden />
      <span>{children}</span>
    </li>
  );
}
