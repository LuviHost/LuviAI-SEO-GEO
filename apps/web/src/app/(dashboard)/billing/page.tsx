'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { toast } from 'sonner';
import { animate, stagger } from 'animejs';
import {
  CreditCard, Sparkles, TrendingUp, Calendar, Receipt,
  CheckCircle2, AlertCircle, Clock, XCircle, ArrowUpRight,
  ChevronRight, Activity, Crown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Abonelik & Faturalama — premium tasarım, anime.js v4 ile staggered animasyonlar.
 *
 * Animasyon zaman çizgisi:
 *   0ms     Header fadeInUp
 *   100ms   Plan kartı scaleIn + price count-up + usage bar animated fill
 *   400ms   CTA buttonlar slide-in
 *   600ms   Invoice tablosu satır satır stagger fade-in (60ms/satır)
 *   Loop:   Status badge pulse halo (ACTIVE iken)
 */

export default function BillingPage() {
  const { data: session, status } = useSession();
  const userId = session?.user?.id;
  const [current, setCurrent] = useState<any>(null);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [quota, setQuota] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);

  const playedRef = useRef(false);
  const usageBarRef = useRef<HTMLDivElement | null>(null);
  const priceRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (status === 'loading') return;
    if (!userId) { setLoading(false); return; }
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
    Promise.all([
      fetch(`${apiBase}/api/billing/users/${userId}/current`, { credentials: 'include' }).then((r) => r.json()),
      fetch(`${apiBase}/api/billing/users/${userId}/invoices`, { credentials: 'include' }).then((r) => r.json()),
      fetch(`${apiBase}/api/billing/users/${userId}/quota`, { credentials: 'include' }).then((r) => r.json()),
    ])
      .then(([c, i, q]) => {
        setCurrent(c);
        setInvoices(Array.isArray(i) ? i : []);
        setQuota(q);
      })
      .catch(() => toast.error('Veri yüklenemedi'))
      .finally(() => setLoading(false));
  }, [userId, status]);

  // Animations — sayfa yüklenince bir kez
  useEffect(() => {
    if (loading || !current || playedRef.current) return;
    playedRef.current = true;

    const articleUsage = quota?.articles ?? { remaining: 0, limit: 0 };
    const used = Math.max(0, articleUsage.limit - articleUsage.remaining);
    const usagePct = articleUsage.limit > 0 ? Math.round((used / articleUsage.limit) * 100) : 0;

    // Plan card breathing glow
    animate('.bil-plan-glow', {
      opacity: [0.3, 0.6, 0.3],
      duration: 3200,
      loop: true,
      easing: 'easeInOutSine',
    });

    // Usage bar fill (0% → usagePct%)
    if (usageBarRef.current) {
      animate(usageBarRef.current, {
        width: ['0%', `${usagePct}%`],
        duration: 1400,
        easing: 'cubicBezier(0.16, 1, 0.3, 1)',
        delay: 300,
      });
    }

    // Count-up: used number + price
    countUp('.bil-used', used, 1200);
    countUp('.bil-limit', articleUsage.limit, 1200);
    if (current.plan?.monthly) {
      countUp('.bil-price', current.plan.monthly, 1300, '₺');
    }

    // Invoice rows stagger
    if (invoices.length > 0) {
      animate('.bil-invoice-row', {
        opacity: [0, 1],
        translateY: [12, 0],
        duration: 500,
        easing: 'cubicBezier(0.16, 1, 0.3, 1)',
        delay: stagger(60, { start: 600 }),
      });
    }
  }, [loading, current, quota, invoices.length]);

  const cancel = async () => {
    if (!userId) return;
    setCancelling(true);
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
    try {
      await fetch(`${apiBase}/api/billing/users/${userId}/cancel`, {
        method: 'POST',
        credentials: 'include',
      });
      toast.success('Abonelik iptal edildi');
      location.reload();
    } catch (err: any) {
      toast.error(err.message);
      setCancelling(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-1/3" />
        <Skeleton className="h-56 rounded-2xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  if (!current) {
    return <div className="text-muted-foreground">Veri yüklenemedi.</div>;
  }

  const plan = current.plan;
  const articleUsage = quota?.articles ?? { remaining: 0, limit: 0 };
  const used = Math.max(0, articleUsage.limit - articleUsage.remaining);
  const usagePct = articleUsage.limit > 0 ? Math.round((used / articleUsage.limit) * 100) : 0;
  const isActive = current.status === 'ACTIVE';
  const isTrial = current.status === 'TRIAL';

  return (
    <div className="relative space-y-8">
      {/* Background gradient orbs (subtle) */}
      <div className="pointer-events-none absolute -top-32 -right-20 h-72 w-72 rounded-full bg-brand/15 blur-[120px]" />
      <div className="pointer-events-none absolute top-40 -left-32 h-72 w-72 rounded-full bg-violet-500/10 blur-[120px]" />

      {/* Header */}
      <div className="relative animate-[fadeInUp_500ms_ease-out_both]">
        <div className="flex items-center gap-2 mb-1">
          <span className="h-1.5 w-1.5 rounded-full bg-brand animate-pulse" />
          <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-brand font-semibold">
            Faturalama Merkezi
          </span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
          Abonelik &amp; Faturalama
        </h1>
        <p className="text-sm text-muted-foreground mt-1.5">
          Mevcut planını gör, kullanımını takip et, dilediğin zaman değiştir.
        </p>
      </div>

      {/* Plan Card — premium */}
      <div
        className="relative rounded-2xl border bg-card overflow-hidden animate-[scaleIn_600ms_cubic-bezier(0.16,1,0.3,1)_both]"
        style={{ animationDelay: '100ms' }}
      >
        {/* Animated gradient glow background */}
        <div className="bil-plan-glow absolute inset-0 bg-gradient-to-br from-brand/15 via-violet-500/8 to-fuchsia-500/12 pointer-events-none" />
        {/* Top accent bar */}
        <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-brand via-violet-500 to-fuchsia-500" />

        <div className="relative p-6 sm:p-8">
          <div className="flex justify-between items-start flex-wrap gap-4 mb-6">
            {/* Plan info */}
            <div className="flex items-start gap-4">
              <div className="shrink-0 h-14 w-14 rounded-2xl bg-gradient-to-br from-brand/20 to-violet-500/20 grid place-items-center border border-brand/30">
                <Crown className="h-6 w-6 text-brand" />
              </div>
              <div>
                <div className="text-xs uppercase tracking-widest text-muted-foreground font-mono mb-1">
                  Mevcut Planınız
                </div>
                <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
                  {plan?.name ?? 'Ücretsiz'}
                </h2>
                <div className="mt-2 flex items-center gap-2">
                  <StatusBadge status={current.status} />
                  {isTrial && current.trialEndsAt && (
                    <span className="text-[11px] text-muted-foreground font-mono">
                      Trial bitiş: {new Date(current.trialEndsAt).toLocaleDateString('tr-TR')}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Price */}
            {plan?.monthly > 0 && (
              <div className="text-right">
                <div className="text-3xl sm:text-4xl font-bold tabular-nums font-mono text-brand">
                  <span ref={priceRef} className="bil-price">₺0</span>
                  <span className="text-sm text-muted-foreground font-sans font-normal">/ay</span>
                </div>
                <div className="text-[10px] text-muted-foreground/70 mt-1 font-mono uppercase tracking-widest">
                  KDV dahil · TR
                </div>
              </div>
            )}
          </div>

          {/* Usage bar */}
          <div className="space-y-2 mb-6">
            <div className="flex items-center justify-between text-sm">
              <div className="inline-flex items-center gap-1.5 text-foreground/80">
                <Activity className="h-3.5 w-3.5 text-brand" />
                <span>Bu ay kullanım</span>
              </div>
              <span className="font-mono tabular-nums text-foreground/90">
                <span className="bil-used">0</span> / <span className="bil-limit">0</span> makale
              </span>
            </div>
            <div className="relative h-2.5 bg-muted/60 rounded-full overflow-hidden">
              <div
                ref={usageBarRef}
                className={`absolute inset-y-0 left-0 rounded-full ${
                  usagePct > 90
                    ? 'bg-gradient-to-r from-red-500 to-red-400'
                    : usagePct > 70
                      ? 'bg-gradient-to-r from-amber-500 to-yellow-400'
                      : 'bg-gradient-to-r from-brand to-violet-500'
                } shadow-[0_0_12px_currentColor]`}
                style={{ width: '0%' }}
              />
              {/* Shimmer overlay during fill */}
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent opacity-0 animate-[shimmer_2s_ease-in-out_infinite]" />
            </div>
            {usagePct > 80 && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400 inline-flex items-center gap-1.5 mt-1">
                <AlertCircle className="h-3 w-3" />
                Limitin %80&apos;ini geçtin — yeni plan değerlendirmek isteyebilirsin.
              </p>
            )}
          </div>

          {/* CTAs */}
          <div className="flex gap-2 flex-wrap">
            <Button
              asChild
              size="lg"
              className="group relative overflow-hidden bg-gradient-to-r from-brand to-violet-500 shadow-[0_0_0_1px_rgb(124_58_237/0.3),0_8px_24px_-6px_rgb(124_58_237/0.5)] hover:shadow-[0_0_0_1px_rgb(124_58_237/0.5),0_12px_36px_-6px_rgb(124_58_237/0.7)] transition-shadow duration-300"
            >
              <Link href="/pricing" className="font-mono text-xs uppercase tracking-widest">
                <TrendingUp className="h-4 w-4 mr-2" />
                Plan Yükselt
                <ChevronRight className="h-3.5 w-3.5 ml-1.5 group-hover:translate-x-0.5 transition-transform" />
                <span aria-hidden className="absolute inset-y-0 -left-1/2 w-1/2 bg-gradient-to-r from-transparent via-white/25 to-transparent skew-x-12 group-hover:translate-x-[400%] transition-transform duration-700" />
              </Link>
            </Button>
            {isActive && (
              <Button
                variant="outline"
                size="lg"
                onClick={() => setShowCancelDialog(true)}
                className="font-mono text-xs uppercase tracking-widest text-red-500 border-red-300/50 hover:bg-red-500/10 hover:border-red-500/60"
              >
                <XCircle className="h-4 w-4 mr-2" />
                İptal Et
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Invoice table */}
      <div
        className="relative animate-[fadeInUp_500ms_ease-out_both]"
        style={{ animationDelay: '400ms' }}
      >
        <div className="flex items-center gap-2 mb-4">
          <Receipt className="h-4 w-4 text-brand" />
          <h2 className="text-lg font-semibold">Fatura Geçmişi</h2>
          {invoices.length > 0 && (
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              · {invoices.length} kayıt
            </span>
          )}
        </div>

        {invoices.length === 0 ? (
          <EmptyInvoices />
        ) : (
          <div className="rounded-xl border bg-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left px-4 py-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Tarih</th>
                    <th className="text-left px-4 py-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Açıklama</th>
                    <th className="text-right px-4 py-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Tutar</th>
                    <th className="text-left px-4 py-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Durum</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr
                      key={inv.id}
                      className="bil-invoice-row border-t hover:bg-muted/20 transition-colors"
                      style={{ opacity: 0 }}
                    >
                      <td className="px-4 py-3.5">
                        <div className="inline-flex items-center gap-2">
                          <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                          <span>{new Date(inv.createdAt).toLocaleDateString('tr-TR')}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-foreground/90">{inv.description}</td>
                      <td className="px-4 py-3.5 text-right font-mono tabular-nums font-semibold">
                        ₺{Number(inv.amount).toLocaleString('tr-TR')}
                      </td>
                      <td className="px-4 py-3.5">
                        <InvoiceStatusBadge status={inv.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Cancel dialog */}
      {showCancelDialog && (
        <CancelDialog
          onCancel={() => setShowCancelDialog(false)}
          onConfirm={cancel}
          loading={cancelling}
          plan={plan?.name}
        />
      )}

      <style jsx global>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes scaleIn {
          from { opacity: 0; transform: scale(0.96); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes shimmer {
          0%   { opacity: 0; transform: translateX(-100%); }
          50%  { opacity: 0.3; }
          100% { opacity: 0; transform: translateX(100%); }
        }
      `}</style>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string; icon: React.ComponentType<{ className?: string }>; pulse?: boolean }> = {
    ACTIVE:    { label: 'AKTİF',     cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30', icon: CheckCircle2, pulse: true },
    TRIAL:     { label: 'DENEME',    cls: 'bg-brand/15 text-brand border-brand/30',                                        icon: Sparkles },
    CANCELED:  { label: 'İPTAL',     cls: 'bg-muted text-muted-foreground border-border',                                  icon: XCircle },
    EXPIRED:   { label: 'SÜRE DOLDU', cls: 'bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30',               icon: AlertCircle },
    PAST_DUE:  { label: 'GECİKME',   cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30',        icon: Clock, pulse: true },
  };
  const m = map[status] ?? { label: status, cls: 'bg-muted text-muted-foreground border-border', icon: AlertCircle };
  const Icon = m.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 h-6 rounded-md border text-[10px] font-mono uppercase tracking-widest font-semibold ${m.cls}`}>
      {m.pulse && <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />}
      <Icon className="h-3 w-3" />
      {m.label}
    </span>
  );
}

function InvoiceStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string; icon: React.ComponentType<{ className?: string }>; pulse?: boolean }> = {
    PAID:     { label: 'ÖDENDİ',  cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30', icon: CheckCircle2 },
    PENDING:  { label: 'BEKLEMEDE', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30',       icon: Clock, pulse: true },
    FAILED:   { label: 'BAŞARISIZ', cls: 'bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30',               icon: XCircle },
    REFUNDED: { label: 'İADE',    cls: 'bg-violet-500/15 text-violet-700 dark:text-violet-400 border-violet-500/30',     icon: ArrowUpRight },
  };
  const m = map[status] ?? { label: status, cls: 'bg-muted text-muted-foreground border-border', icon: AlertCircle };
  const Icon = m.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 h-6 rounded-md border text-[10px] font-mono uppercase tracking-widest font-semibold ${m.cls}`}>
      {m.pulse && <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />}
      <Icon className="h-3 w-3" />
      {m.label}
    </span>
  );
}

function EmptyInvoices() {
  return (
    <div className="rounded-2xl border-2 border-dashed border-brand/20 bg-card overflow-hidden animate-[scaleIn_500ms_ease-out_both]">
      <div className="absolute inset-0 bg-gradient-to-br from-brand/[0.04] via-transparent to-violet-500/[0.04] pointer-events-none" />
      <div className="relative p-12 text-center">
        <div className="mx-auto mb-5 h-14 w-14 rounded-2xl bg-gradient-to-br from-brand/15 to-violet-500/15 grid place-items-center border border-brand/20">
          <Receipt className="h-6 w-6 text-brand" />
        </div>
        <h3 className="text-base font-semibold mb-1">Henüz fatura yok</h3>
        <p className="text-sm text-muted-foreground">
          Bir plan satın aldığında burada listelenecek.
        </p>
      </div>
    </div>
  );
}

function CancelDialog({
  onCancel, onConfirm, loading, plan,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  loading: boolean;
  plan?: string;
}) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4 animate-[fadeInUp_200ms_ease-out_both]"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="bg-card border border-red-500/30 rounded-xl p-6 max-w-md w-full shadow-2xl animate-[scaleIn_300ms_cubic-bezier(0.16,1,0.3,1)_both]">
        <div className="flex items-start gap-3 mb-4">
          <div className="h-12 w-12 rounded-2xl bg-red-500/10 grid place-items-center shrink-0 border border-red-500/30">
            <AlertCircle className="h-6 w-6 text-red-500" />
          </div>
          <div>
            <h3 className="text-lg font-semibold">Aboneliği iptal et</h3>
            <p className="text-sm text-muted-foreground mt-1.5">
              {plan ? <><strong>{plan}</strong> aboneliğini iptal etmek üzeresin.</> : 'Aboneliğini iptal etmek üzeresin.'}
            </p>
          </div>
        </div>
        <div className="rounded-lg bg-muted/40 border p-3 mb-5 text-xs text-muted-foreground space-y-1">
          <p>• İptal sonrası mevcut dönem sonuna kadar aktif kalır</p>
          <p>• Yeni faturalama yapılmaz, ücret iadesi ayrı bir taleple yapılır</p>
          <p>• Ücretsiz plana otomatik geçilir, içerikler korunur</p>
          <p>• İstediğin zaman tekrar abone olabilirsin</p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel} disabled={loading}>
            Vazgeç
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? 'İptal ediliyor…' : 'Aboneliği iptal et'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function countUp(selector: string, target: number, durationMs: number, prefix: string = '') {
  if (!Number.isFinite(target) || target <= 0) {
    document.querySelectorAll<HTMLElement>(selector).forEach((el) => {
      el.textContent = `${prefix}0`;
    });
    return;
  }
  const els = document.querySelectorAll<HTMLElement>(selector);
  if (els.length === 0) return;
  const t0 = performance.now();
  const tick = (now: number) => {
    const p = Math.min(1, (now - t0) / durationMs);
    const eased = 1 - Math.pow(1 - p, 3);
    const v = Math.round(target * eased);
    els.forEach((el) => { el.textContent = `${prefix}${v.toLocaleString('tr-TR')}`; });
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
