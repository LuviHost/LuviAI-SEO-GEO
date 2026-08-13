'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Eyebrow, StepMotif } from '@/components/brand';
import { ShieldCheck, ArrowRight, Video, Lock, Clock, Star } from 'lucide-react';

type CreditPack = { key: '5' | '20' | '50'; packSize: number; priceTry: number; description: string };
type GrandfatheringInfo = { isGrandfathered: boolean; grandfatheredUntil?: string; legacyMonthlyPriceTry?: number };

export default function PricingPage() {
  const { t } = useT();
  const { data: session, status } = useSession();
  const router = useRouter();
  const [plans, setPlans] = useState<any[]>([]);
  /** Gunun TCMB kuru — fiyatlar USD, TL karsiligi bununla gosteriliyor */
  const [fx, setFx] = useState<{ rate: number; fetchedAt: string; source: string; stale: boolean } | null>(null);
  const [cycle, setCycle] = useState<'monthly' | 'annual'>('monthly');
  const [loading, setLoading] = useState<string | null>(null);
  const [creditPacks, setCreditPacks] = useState<CreditPack[]>([]);
  const [grandfathering, setGrandfathering] = useState<GrandfatheringInfo | null>(null);
  const [purchasingPack, setPurchasingPack] = useState<string | null>(null);

  useEffect(() => {
    api.getPlans()
      .then((res) => {
        setPlans(res.plans);
        setFx(res.fx);
      })
      .catch(() => toast.error(t('common.error')));

    // Video credit pack'leri yukle (public)
    fetch(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/api/billing/video-credits/packs`)
      .then((r) => r.json())
      .then(setCreditPacks)
      .catch(() => { /* sessizce gec - add-on opsiyonel */ });
  }, []);

  // Grandfathering durumunu cek (sadece logged-in user icin)
  useEffect(() => {
    if (!session?.user?.id) return;
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
    fetch(`${apiBase}/api/billing/users/${session.user.id}/current`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
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

  const buyCredits = async (packKey: '5' | '20' | '50') => {
    if (!session?.user?.id) {
      toast.message('Devam etmek için giriş yapın');
      router.push(`/signin?callbackUrl=${encodeURIComponent('/pricing')}`);
      return;
    }
    setPurchasingPack(packKey);
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
      const res = await fetch(`${apiBase}/api/billing/users/${session.user.id}/video-credits/purchase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          packKey,
          userEmail: session.user.email,
          userName: session.user.name ?? session.user.email,
        }),
      });
      const data = await res.json();
      if (data.iframeUrl) {
        toast.success('Ödeme sayfasına yönlendiriliyorsunuz...');
        window.location.href = data.iframeUrl;
      } else {
        toast.error(data.message ?? 'Satın alma başlatılamadı');
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setPurchasingPack(null);
    }
  };

  const subscribe = async (planId: string) => {
    if (status === 'loading') return;

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
      if (data.iframeUrl) {
        // Test mode dev-confirm için merchantOid'i sakla; success sayfası bunu okuyup
        // PayTR webhook gelmeden invoice'ı PAID + plan'ı upgrade eder.
        if (data.merchantOid) {
          try { localStorage.setItem('luviai-pending-merchantOid', data.merchantOid); } catch (_e) { /* noop */ }
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
      {/* Basamak hero atmosferi — grafik kağıdı */}
      <div className="absolute inset-x-0 top-0 h-[480px] -z-10 overflow-hidden pointer-events-none" aria-hidden="true">
        <div className="absolute inset-0 grid-paper-light dark:hidden" />
        <div className="absolute inset-0 hidden dark:block grid-paper" />
      </div>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
        <div className="max-w-3xl mx-auto text-center mb-12">
          <div className="flex justify-center mb-4"><StepMotif size={32} steps={4} /></div>
          <Eyebrow index="2 makale ücretsiz" className="mb-5">Kredi kartı yok</Eyebrow>
          <h1 className="font-brandDisplay text-4xl sm:text-5xl lg:text-6xl font-bold tracking-[-0.03em] leading-tight">
            Şeffaf fiyat,{' '}
            <span className="text-brand dark:text-brand-400">ölçeklenebilir plan</span>
          </h1>
          <p className="mt-5 text-lg text-muted-foreground">
            {t('pricing.subtitle')}
          </p>
        </div>

        {/* Grandfathering banner — sadece mevcut user'lar icin */}
        {grandfathering?.isGrandfathered && grandfathering.grandfatheredUntil && (
          <div className="mb-8 max-w-3xl mx-auto p-4 card-brand">
            <div className="flex items-start gap-3">
              <Star className="h-5 w-5 text-brand dark:text-brand-400 mt-0.5 shrink-0" />
              <div className="flex-1 text-sm">
                <div className="font-semibold">
                  Eski fiyatınızla devam ediyorsunuz
                </div>
                <p className="text-muted-foreground mt-1">
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
          <div className="inline-flex card-brand p-1">
            <button
              onClick={() => setCycle('monthly')}
              className={`px-6 py-2 text-sm font-semibold rounded-[10px] transition-colors ${
                cycle === 'monthly'
                  ? 'bg-ink text-bone dark:bg-bone dark:text-ink'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t('pricing.monthly')}
            </button>
            <button
              onClick={() => setCycle('annual')}
              className={`px-6 py-2 text-sm font-semibold rounded-[10px] transition-colors flex items-center gap-2 ${
                cycle === 'annual'
                  ? 'bg-ink text-bone dark:bg-bone dark:text-ink'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t('pricing.annual')}
              <span className="text-[10px] bg-[#3E9B4F] text-white px-1.5 py-0.5 rounded-full font-bold">-20%</span>
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
              <span className="block mt-1 text-brand-600 dark:text-brand-400">
                Güncel kur alınamadı, son bilinen kur gösteriliyor. Ödeme sırasında güncel kur uygulanır.
              </span>
            )}
            <span className="block mt-1">Tahsilat, ödeme anındaki kurla Türk lirası olarak yapılır.</span>
          </p>
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
                className={`card-brand p-8 flex flex-col relative transition-colors ${
                  highlighted ? 'border-brand' : 'hover:border-brand/40'
                }`}
              >
                {highlighted && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-full font-mono text-[10px] font-medium uppercase tracking-[0.14em] bg-brand text-paper whitespace-nowrap">
                    {t('pricing.popular')}
                  </div>
                )}

                <h2 className="text-xl font-bold">{p.name}</h2>
                <div className="mt-4">
                  <span className="font-brandDisplay text-4xl sm:text-5xl font-extrabold tabular-nums">
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

                <ul className="space-y-3 text-sm mt-6 mb-8 flex-1">
                  <Feat highlight={highlighted}>{p.articlesPerMonth} {t('pricing.articles_per_month')}</Feat>
                  <Feat highlight={highlighted}>{p.socialPostsPerMonth} {t('pricing.social_posts_per_month')}</Feat>
                  {p.videosPerMonth > 0 ? (
                    <Feat highlight={highlighted}>
                      <span className="inline-flex items-center gap-1.5">
                        <Video className="h-3.5 w-3.5" />
                        {p.videosPerMonth} AI video / ay (Sora 2 + Veo 3)
                      </span>
                    </Feat>
                  ) : (
                    <Feat highlight={highlighted} muted>
                      <span className="inline-flex items-center gap-1.5">
                        <Lock className="h-3.5 w-3.5" />
                        Video: ek paketten satın al (5'lik ₺499)
                      </span>
                    </Feat>
                  )}
                  <Feat highlight={highlighted}>{p.sites} {t('pricing.sites')}</Feat>
                  <Feat highlight={highlighted}>{p.publishTargets === 'all' ? t('pricing.all_publish_targets') : t('pricing.markdown_only')}</Feat>
                  <Feat highlight={highlighted}>{p.support}</Feat>
                  <Feat highlight={highlighted}>TR + EN içerik</Feat>
                  <Feat highlight={highlighted}>GEO/AEO + AI Citation Tracking</Feat>
                </ul>

                <button
                  onClick={() => subscribe(p.id)}
                  disabled={loading === p.id}
                  className={`${highlighted ? 'btn-brand' : 'btn-brand-outline'} w-full disabled:opacity-60 disabled:pointer-events-none`}
                >
                  {loading === p.id ? t('common.loading') : (
                    <>
                      {t('pricing.cta')}
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </button>
              </div>
            );
          })}
        </div>

        {/* Video Credit Add-on Section */}
        {creditPacks.length > 0 && (
          <div className="mt-20 max-w-5xl mx-auto">
            <div className="text-center mb-8">
              <Eyebrow className="mb-3">EK VIDEO KREDİSİ</Eyebrow>
              <h2 className="font-brandDisplay text-3xl font-bold tracking-[-0.02em]">İhtiyaç anında ek video</h2>
              <p className="mt-2 text-muted-foreground text-sm">
                Plan kotanız dolduğunda istediğiniz zaman ek video kredisi satın alın. Tüketmediğinizde kalan kredileriniz kaybolmaz.
              </p>
            </div>

            <div className="grid sm:grid-cols-3 gap-4">
              {creditPacks.map((pack) => {
                const perVideo = Math.round(pack.priceTry / pack.packSize);
                const isPro = pack.key === '20';
                return (
                  <div
                    key={pack.key}
                    className={`card-brand p-6 transition-colors relative ${
                      isPro ? 'border-brand' : 'hover:border-brand/40'
                    }`}
                  >
                    {isPro && (
                      <div className="absolute -top-2.5 right-4 px-2.5 py-0.5 rounded-full font-mono text-[10px] font-medium uppercase tracking-[0.14em] bg-brand text-paper">
                        EN POPÜLER
                      </div>
                    )}
                    <div className="flex items-center gap-2 text-brand dark:text-brand-400 mb-2">
                      <Video className="h-4 w-4" />
                      <span className="text-2xl font-bold tabular-nums">{pack.packSize}</span>
                      <span className="text-xs text-muted-foreground">video</span>
                    </div>
                    <div className="font-brandDisplay text-3xl font-extrabold tabular-nums mt-3">
                      ₺{pack.priceTry.toLocaleString('tr-TR')}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      ≈ ₺{perVideo}/video
                    </div>
                    <p className="text-xs text-muted-foreground mt-3 leading-relaxed min-h-[3em]">
                      {pack.description}
                    </p>
                    <button
                      onClick={() => buyCredits(pack.key)}
                      disabled={purchasingPack === pack.key}
                      className={`${isPro ? 'btn-brand' : 'btn-brand-outline'} w-full mt-4 h-9 text-sm disabled:opacity-60 disabled:pointer-events-none`}
                    >
                      {purchasingPack === pack.key ? 'Yönlendiriliyor...' : 'Satın Al'}
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="mt-6 text-center text-xs text-muted-foreground inline-flex items-center justify-center gap-2 w-full">
              <Clock className="h-3 w-3" />
              <span>Kredileriniz süresiz geçerli · Plan kotası önce tüketilir, sonra credit havuzu</span>
            </div>
          </div>
        )}

        <div className="mt-12 max-w-2xl mx-auto text-center text-sm text-muted-foreground">
          <p className="inline-flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" /> {t('pricing.security_note')}
          </p>
        </div>
      </main>
    </div>
  );
}

function Feat({ children, muted }: { children: React.ReactNode; highlight?: boolean; muted?: boolean }) {
  return (
    <li className={`flex items-start gap-2 ${muted ? 'text-muted-foreground' : 'text-foreground/90'}`}>
      {/* Basamak bullet — kare */}
      <span className={`mt-[7px] h-2 w-2 shrink-0 ${muted ? 'bg-muted-foreground/40' : 'bg-brand'}`} aria-hidden="true" />
      <span>{children}</span>
    </li>
  );
}
