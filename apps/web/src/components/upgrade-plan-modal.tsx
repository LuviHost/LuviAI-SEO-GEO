'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { invalidateEntitlements } from '@/lib/entitlements';

/**
 * Plan verisi ELLE YAZILMAZ — /billing/plans'tan gelir.
 *
 * Burada sabit bir tablo duruyordu ve fena halde bayatlamisti: plan adlari
 * eskiydi ('Baslangic' -> 'Buyume', agency'ye 'Kurumsal' deniyordu), fiyatlar
 * TL sabitiydi (₺3.080 / ₺6.980 / ₺13.610 — gerceginin yarisindan azi),
 * makale sayilari tutmuyordu (10/50/250 yerine 15/40/100) ve artik urunde
 * OLMAYAN "sosyal medya postu" ozelligi satiliyordu. Ustelik burasi bir
 * YUKSELTME modali: kullanici yanlis fiyat gorup odemeye gidiyordu.
 */
type Plan = {
  id: string;
  name: string;
  monthly: number;
  annual: number;
  monthlyTry: number;
  annualTry: number;
  articlesPerMonth: number;
  features: string[];
  popular?: boolean;
  contactSales?: boolean;
};


export function UpgradePlanModal({
  open,
  onClose,
  onSuccess,
  reason,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  reason?: string;
}) {
  const { data: session } = useSession();
  const [cycle, setCycle] = useState<'monthly' | 'annual'>('monthly');
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  const [iframeUrl, setIframeUrl] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const [originalPlan, setOriginalPlan] = useState<string | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);

  // Fiyat kartlariyla AYNI kaynak. contactSales planlari (Kurumsal) modalda
  // gosterilmez: kart ile satin alinamiyorlar, satis ekibinden geciyorlar.
  useEffect(() => {
    if (!open) return;
    api.getPlans('tr')
      .then((r) => setPlans(((r?.plans ?? []) as Plan[]).filter((p) => p.id !== 'trial' && !p.contactSales)))
      .catch(() => { /* fiyat gosterilmez, modal yine acilir */ });
  }, [open]);

  // Modal açılınca user'ın mevcut plan'ını cek (degisim algılama icin)
  useEffect(() => {
    if (!open) return;
    const userId = (session?.user as any)?.id;
    if (!userId) return;
    api.getUserQuota(userId).then((q) => {
      // limit'i original'a kaydet — degistiyse plan yukseldi demek
      setOriginalPlan(String(q.articles.limit));
    }).catch(() => { /* noop */ });
  }, [open, session]);

  // Iframe acildiktan sonra her 4 saniyede bir plan degisti mi diye poll et
  useEffect(() => {
    if (!iframeUrl || !originalPlan) return;
    const userId = (session?.user as any)?.id;
    if (!userId) return;
    setPolling(true);
    const interval = setInterval(async () => {
      try {
        const q = await api.getUserQuota(userId);
        if (String(q.articles.limit) !== originalPlan) {
          // Plan degisti → odeme tamamlandi
          clearInterval(interval);
          setPolling(false);
          toast.success(`Plan yukseltildi! Aylık ${q.articles.limit} makale hakkın oldu.`);
          setIframeUrl(null);
          // Ozellik haklari onbellekte tutuluyor; yukseltmeden sonra
          // temizlenmezse kullanici sert yenileme (F5) yapana kadar odedigi
          // ozelligi hala kilitli gorur.
          invalidateEntitlements();
          onSuccess?.();
          onClose();
        }
      } catch (_e) { /* noop */ }
    }, 4000);
    return () => clearInterval(interval);
  }, [iframeUrl, originalPlan, session]);

  const subscribe = async (planId: string) => {
    if (!session?.user?.id) {
      toast.error('Oturum süresi dolmuş, lütfen tekrar giriş yap');
      return;
    }
    setLoadingPlan(planId);
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '';
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
        setIframeUrl(data.iframeUrl);
        // Test mode dev-confirm icin merchantOid'i sakla
        if (data.merchantOid) {
          try { localStorage.setItem('luviai-pending-merchantOid', data.merchantOid); } catch (_e) { /* noop */ }
        }
        toast.info('Ödeme penceresi açıldı');
      } else {
        toast.error(data.message ?? 'Ödeme başlatılamadı');
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoadingPlan(null);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-card border rounded-xl shadow-2xl max-w-5xl w-full max-h-[92vh] overflow-y-auto">
        {/* Iframe acildiysa odeme ekrani */}
        {iframeUrl ? (
          <div className="flex flex-col h-[85vh]">
            <div className="flex items-center justify-between p-4 border-b">
              <div>
                <p className="font-semibold">Güvenli Ödeme · PayTR</p>
                <p className="text-xs text-muted-foreground">{polling && 'Ödeme bekleniyor… ekran otomatik kapanacak.'}</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => { setIframeUrl(null); }}>
                ← Plan seçimine dön
              </Button>
            </div>
            <iframe src={iframeUrl} className="flex-1 w-full border-0" title="PayTR Ödeme" />
          </div>
        ) : (
          <div className="p-6 sm:p-8">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h2 className="text-2xl font-bold">Plan Yükselt</h2>
                {reason && <p className="text-sm text-muted-foreground mt-1">{reason}</p>}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="text-muted-foreground hover:text-foreground p-2"
                aria-label="Kapat"
              >
                ✕
              </button>
            </div>

            {/* Cycle toggle */}
            <div className="flex justify-center mb-6">
              <div className="inline-flex bg-muted rounded-full p-1">
                <button
                  type="button"
                  onClick={() => setCycle('monthly')}
                  className={cn(
                    'px-5 py-1.5 rounded-full text-sm font-medium transition-colors',
                    cycle === 'monthly' ? 'bg-brand text-white' : 'text-muted-foreground',
                  )}
                >
                  Aylık
                </button>
                <button
                  type="button"
                  onClick={() => setCycle('annual')}
                  className={cn(
                    'px-5 py-1.5 rounded-full text-sm font-medium transition-colors flex items-center gap-1.5',
                    cycle === 'annual' ? 'bg-brand text-white' : 'text-muted-foreground',
                  )}
                >
                  Yıllık <span className="text-[10px] bg-green-500/20 text-green-600 rounded-full px-1.5 py-0.5">-20%</span>
                </button>
              </div>
            </div>

            {/* Plans grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {plans.map((p) => {
                // Fiyat USD'de kanonik; yillikta aylik esdeger gosteriliyor.
                const price = cycle === 'monthly' ? p.monthly : Math.round(p.annual / 12);
                return (
                  <div
                    key={p.id}
                    className={cn(
                      'rounded-lg border-2 p-4 flex flex-col transition-colors',
                      p.popular ? 'border-brand bg-brand/5' : 'hover:border-brand/40',
                    )}
                  >
                    {p.popular && (
                      <div className="text-[10px] font-bold tracking-wide bg-brand text-white rounded-full px-2 py-0.5 self-start mb-2">
                        EN POPÜLER
                      </div>
                    )}
                    <h3 className="font-bold text-lg">{p.name}</h3>
                    <div className="mt-2">
                      <span className="text-3xl font-bold">${price.toLocaleString('en-US')}</span>
                      <span className="text-sm text-muted-foreground">/ay</span>
                    </div>
                    {cycle === 'annual' && (
                      <p className="text-[10px] text-green-600 mt-0.5">Yıllık ödeme · ${p.annual.toLocaleString('en-US')}/yıl</p>
                    )}
                    <ul className="mt-3 space-y-1.5 text-xs flex-1">
                      {(p.features ?? []).slice(0, 6).map((f, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="text-green-500 shrink-0">✓</span>
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                    <Button
                      className="mt-4 w-full"
                      onClick={() => subscribe(p.id)}
                      disabled={loadingPlan === p.id}
                      variant={p.popular ? 'default' : 'outline'}
                    >
                      {loadingPlan === p.id ? 'Hazırlanıyor…' : 'Bu Plana Geç'}
                    </Button>
                  </div>
                );
              })}
            </div>

            <p className="text-center text-[11px] text-muted-foreground mt-4">
              💳 PayTR güvenli ödeme · ✅ İstediğin zaman iptal · 🇹🇷 KDV dahil
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
