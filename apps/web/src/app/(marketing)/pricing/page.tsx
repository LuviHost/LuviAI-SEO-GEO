'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ThemeToggle } from '@/components/theme-toggle';
import { LocaleSwitch } from '@/components/locale-switch';
import { CheckCircle2, Sparkles, ShieldCheck, ArrowRight, Video, Lock, Clock, Star } from 'lucide-react';

type CreditPack = { key: '5' | '20' | '50'; packSize: number; priceTry: number; description: string };
type GrandfatheringInfo = { isGrandfathered: boolean; grandfatheredUntil?: string; legacyMonthlyPriceTry?: number };

export default function PricingPage() {
  const { t } = useT();
  const { data: session, status } = useSession();
  const router = useRouter();
  const [plans, setPlans] = useState<any[]>([]);
  const [cycle, setCycle] = useState<'monthly' | 'annual'>('monthly');
  const [loading, setLoading] = useState<string | null>(null);
  const [creditPacks, setCreditPacks] = useState<CreditPack[]>([]);
  const [grandfathering, setGrandfathering] = useState<GrandfatheringInfo | null>(null);
  const [purchasingPack, setPurchasingPack] = useState<string | null>(null);

  useEffect(() => {
    api.getPlans()
      .then(setPlans)
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
      {/* gradient blob accents */}
      <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute top-10 -left-20 w-96 h-96 bg-orange-500/10 rounded-full blur-3xl" />
        <div className="absolute top-40 -right-20 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl" />
      </div>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
        <div className="max-w-3xl mx-auto text-center mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-500/10 border border-orange-500/20 text-orange-600 text-xs font-semibold mb-5">
            <Sparkles className="h-3 w-3" />
            <span>2 makale ücretsiz · Kredi kartı yok</span>
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-tight">
            Şeffaf fiyat,{' '}
            <span className="bg-gradient-to-r from-orange-500 via-orange-600 to-red-600 bg-clip-text text-transparent">
              ölçeklenebilir plan
            </span>
          </h1>
          <p className="mt-5 text-lg text-muted-foreground">
            {t('pricing.subtitle')}
          </p>
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
                  ? 'bg-gradient-to-br from-orange-500 to-orange-600 text-white shadow-md'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t('pricing.monthly')}
            </button>
            <button
              onClick={() => setCycle('annual')}
              className={`px-6 py-2 text-sm font-medium rounded-full transition-all flex items-center gap-2 ${
                cycle === 'annual'
                  ? 'bg-gradient-to-br from-orange-500 to-orange-600 text-white shadow-md'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t('pricing.annual')}
              <span className="text-[10px] bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 px-1.5 py-0.5 rounded-full font-bold">-20%</span>
            </button>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {realPlans.map((p) => {
            const price = cycle === 'annual' ? p.annual : p.monthly;
            const monthlyEq = cycle === 'annual' ? Math.round(p.annual / 12) : p.monthly;
            const highlighted = p.popular;
            return (
              <div
                key={p.id}
                className={`p-8 rounded-2xl border flex flex-col relative ${
                  highlighted
                    ? 'bg-gradient-to-br from-orange-500/10 to-orange-500/5 border-orange-500/30 shadow-xl shadow-orange-500/10 lg:scale-105'
                    : 'bg-background hover:border-orange-500/30 transition-colors'
                }`}
              >
                {highlighted && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-gradient-to-br from-orange-500 to-orange-600 text-white text-[10px] font-bold uppercase tracking-wider shadow-md">
                    {t('pricing.popular')}
                  </div>
                )}

                <h2 className="text-xl font-bold">{p.name}</h2>
                <div className="mt-4">
                  <span className="text-4xl sm:text-5xl font-extrabold">
                    ₺{price.toLocaleString('tr-TR')}
                  </span>
                  <span className="text-muted-foreground text-sm ml-2">
                    /{cycle === 'annual' ? 'yıl' : 'ay'}
                  </span>
                </div>
                {cycle === 'annual' && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Aylık ortalama ₺{monthlyEq.toLocaleString('tr-TR')}
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

                <Button
                  onClick={() => subscribe(p.id)}
                  disabled={loading === p.id}
                  className={`w-full ${
                    highlighted
                      ? 'bg-gradient-to-br from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white shadow-md'
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
              </div>
            );
          })}
        </div>

        {/* Video Credit Add-on Section */}
        {creditPacks.length > 0 && (
          <div className="mt-20 max-w-5xl mx-auto">
            <div className="text-center mb-8">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-700 dark:text-purple-300 text-xs font-semibold mb-3">
                <Video className="h-3 w-3" /> EK VIDEO KREDİSİ
              </div>
              <h2 className="text-3xl font-bold">İhtiyaç anında ek video</h2>
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
                    className={`p-6 rounded-2xl border bg-background hover:border-purple-500/40 transition-colors relative ${
                      isPro ? 'border-purple-500/30 shadow-md' : ''
                    }`}
                  >
                    {isPro && (
                      <div className="absolute -top-2.5 right-4 px-2 py-0.5 rounded-full bg-purple-600 text-white text-[10px] font-bold uppercase">
                        EN POPÜLER
                      </div>
                    )}
                    <div className="flex items-center gap-2 text-purple-600 mb-2">
                      <Video className="h-4 w-4" />
                      <span className="text-2xl font-bold">{pack.packSize}</span>
                      <span className="text-xs text-muted-foreground">video</span>
                    </div>
                    <div className="text-3xl font-extrabold mt-3">
                      ₺{pack.priceTry.toLocaleString('tr-TR')}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      ≈ ₺{perVideo}/video
                    </div>
                    <p className="text-xs text-muted-foreground mt-3 leading-relaxed min-h-[3em]">
                      {pack.description}
                    </p>
                    <Button
                      onClick={() => buyCredits(pack.key)}
                      disabled={purchasingPack === pack.key}
                      variant={isPro ? 'default' : 'outline'}
                      className={`w-full mt-4 ${isPro ? 'bg-purple-600 hover:bg-purple-700' : ''}`}
                      size="sm"
                    >
                      {purchasingPack === pack.key ? 'Yönlendiriliyor...' : 'Satın Al'}
                    </Button>
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

function Feat({ children, highlight, muted }: { children: React.ReactNode; highlight?: boolean; muted?: boolean }) {
  return (
    <li className={`flex items-start gap-2 ${muted ? 'text-muted-foreground' : 'text-foreground/90'}`}>
      <CheckCircle2 className={`h-4 w-4 mt-0.5 shrink-0 ${
        muted ? 'text-muted-foreground/50' : highlight ? 'text-orange-600' : 'text-emerald-600'
      }`} />
      <span>{children}</span>
    </li>
  );
}
