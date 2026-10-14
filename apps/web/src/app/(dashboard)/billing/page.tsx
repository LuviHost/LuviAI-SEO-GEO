'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { toast } from 'sonner';
import {
  CheckCircle2, AlertCircle, Clock, XCircle, ArrowUpRight, Receipt, TrendingUp, Crown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/ui/page-header';
import { SectionHeader } from '@/components/ui/section-header';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState } from '@/components/empty-state';
import { cn } from '@/lib/utils';

/**
 * Abonelik & faturalama — panelin sakin diliyle (Ekim 2026).
 *
 * FIYAT: plan.monthly USD'dir (billing.service toDefinition: monthly = monthly_usd).
 * Eskiden "₺{monthly} KDV dahil" yaziyordu — Pro'da $349, ekranda "₺349" demekti.
 * Artik: eski fiyati korunan kullaniciya legacyMonthlyPriceTry (TL), digerlerine USD +
 * "TL tutari odeme anindaki kurla hesaplanir" (plans.ts sozlesmesi).
 *
 * IPTAL: paytr.cancelSubscription yalniz durumu CANCELED yapar ve onay e-postasi
 * gonderir; plani dusurmez, iade yapmaz. Pencere yalniz bu dogrulanmis sonuclari soyler.
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
  const [loadError, setLoadError] = useState(false);


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
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, [userId, status]);

  const cancel = async () => {
    if (!userId) return;
    setCancelling(true);
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
    try {
      const res = await fetch(`${apiBase}/api/billing/users/${userId}/cancel`, {
        method: 'POST',
        credentials: 'include',
      });
      // Eskiden yanit kontrol edilmeden "iptal edildi" deniyordu
      if (!res.ok) throw new Error(`İptal tamamlanamadı (${res.status}). Tekrar dene ya da destek ekibine yaz.`);
      toast.success('Aboneliğin iptal edildi');
      location.reload();
    } catch (err: any) {
      toast.error(err.message);
      setCancelling(false);
    }
  };

  const header = <PageHeader title="Abonelik ve faturalar" description="Planını, bu ayki kullanımını ve faturalarını gör." />;

  if (loading) {
    return (
      <div className="space-y-6">
        {header}
        <Skeleton className="h-56 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  if (!current || loadError) {
    return (
      <div className="space-y-6">
        {header}
        <EmptyState
          icon={AlertCircle}
          accent="rose"
          title="Abonelik bilgisi alınamadı"
          description="Bağlantı kesilmiş ya da oturumun sona ermiş olabilir. Sayfayı yenile; sorun sürerse yeniden giriş yap."
          primary={{ label: 'Sayfayı yenile', onClick: () => location.reload() }}
        />
      </div>
    );
  }

  const plan = current.plan;
  const articleUsage = quota?.articles ?? { remaining: 0, limit: 0 };
  const used = Math.max(0, articleUsage.limit - articleUsage.remaining);
  const usagePct = articleUsage.limit > 0 ? Math.min(100, Math.round((used / articleUsage.limit) * 100)) : 0;
  const isActive = current.status === 'ACTIVE';
  const isTrial = current.status === 'TRIAL';
  const legacyTry = Number(current.legacyMonthlyPriceTry ?? 0);
  const usd = Number(plan?.monthly ?? 0);

  return (
    <div className="space-y-6">
      {header}

      {/* Plan */}
      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex items-start gap-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border bg-muted/50 text-foreground/70" aria-hidden>
              <Crown className="h-5 w-5" />
            </span>
            <div>
              <p className="text-label text-muted-foreground">Mevcut planın</p>
              <h2 className="font-brand text-h4 font-semibold tracking-tight">{plan?.name ?? 'Ücretsiz'}</h2>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <StatusBadge status={current.status} />
                {isTrial && current.trialEndsAt && (
                  <span className="text-label text-muted-foreground">
                    Deneme {new Date(current.trialEndsAt).toLocaleDateString('tr-TR')} tarihinde bitiyor
                  </span>
                )}
              </div>
            </div>
          </div>

          {(legacyTry > 0 || usd > 0) && (
            <div className="text-right">
              <p className="font-brand text-h4 font-semibold tabular-nums">
                {legacyTry > 0 ? `₺${legacyTry.toLocaleString('tr-TR')}` : `$${usd.toLocaleString('en-US')}`}
                <span className="ml-1 text-sm font-normal text-muted-foreground">/ ay</span>
              </p>
              <p className="mt-1 text-label text-muted-foreground">
                {legacyTry > 0 ? 'Eski fiyatın korunuyor' : 'TL tutarı ödeme anındaki kurla hesaplanır'}
              </p>
            </div>
          )}
        </div>

        {/* Kullanim */}
        <div className="mt-6 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Bu ay üretilen içerik</span>
            <span className="tabular-nums font-medium">{used} / {articleUsage.limit}</span>
          </div>
          <div
            className="h-2 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={usagePct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Aylık içerik kotası kullanımı"
          >
            <div
              className={cn(
                'h-full rounded-full motion-safe:transition-[width] motion-safe:duration-700',
                usagePct > 90 ? 'bg-danger' : usagePct > 70 ? 'bg-warning' : 'bg-brand',
              )}
              style={{ width: `${usagePct}%` }}
            />
          </div>
          {usagePct > 80 && (
            <p className="inline-flex items-center gap-1.5 text-label text-warning">
              <AlertCircle className="h-3.5 w-3.5" aria-hidden />
              Aylık kotanın %{usagePct}&apos;ini kullandın. Daha fazlası için planını yükseltebilirsin.
            </p>
          )}
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <Button asChild>
            <Link href="/pricing"><TrendingUp className="h-4 w-4" aria-hidden /> Planları karşılaştır</Link>
          </Button>
          {isActive && (
            <Button variant="ghost" className="text-danger hover:bg-danger/10 hover:text-danger" onClick={() => setShowCancelDialog(true)}>
              Aboneliği iptal et
            </Button>
          )}
        </div>
      </Card>

      {/* Faturalar */}
      <section className="space-y-3">
        <SectionHeader title="Fatura geçmişi" description={invoices.length > 0 ? `${invoices.length} kayıt` : undefined} />
        {invoices.length === 0 ? (
          <EmptyState icon={Receipt} title="Henüz fatura yok" description="Bir plan satın aldığında faturaların burada listelenir." />
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-label text-muted-foreground">
                  <tr>
                    <th className="px-5 py-2.5 font-medium">Tarih</th>
                    <th className="px-5 py-2.5 font-medium">Açıklama</th>
                    <th className="px-5 py-2.5 text-right font-medium">Tutar</th>
                    <th className="px-5 py-2.5 font-medium">Durum</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv.id} className="border-t">
                      <td className="px-5 py-3 tabular-nums text-muted-foreground">{new Date(inv.createdAt).toLocaleDateString('tr-TR')}</td>
                      <td className="px-5 py-3">{inv.description}</td>
                      <td className="px-5 py-3 text-right font-medium tabular-nums">₺{Number(inv.amount).toLocaleString('tr-TR')}</td>
                      <td className="px-5 py-3"><InvoiceStatusBadge status={inv.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </section>

      <CancelDialog
        open={showCancelDialog}
        onCancel={() => setShowCancelDialog(false)}
        onConfirm={cancel}
        loading={cancelling}
        plan={plan?.name}
      />
    </div>
  );
}

const STATUS: Record<string, { label: string; tone: 'success' | 'brand' | 'secondary' | 'danger' | 'warning'; icon: React.ComponentType<{ className?: string }> }> = {
  ACTIVE: { label: 'Aktif', tone: 'success', icon: CheckCircle2 },
  TRIAL: { label: 'Deneme', tone: 'brand', icon: Clock },
  CANCELED: { label: 'İptal edildi', tone: 'secondary', icon: XCircle },
  EXPIRED: { label: 'Süresi doldu', tone: 'danger', icon: AlertCircle },
  PAST_DUE: { label: 'Ödeme gecikti', tone: 'warning', icon: Clock },
};

function StatusBadge({ status }: { status: string }) {
  const m = STATUS[status] ?? { label: status, tone: 'secondary' as const, icon: AlertCircle };
  const Icon = m.icon;
  return <Badge variant={m.tone} className="gap-1"><Icon className="h-3 w-3" aria-hidden />{m.label}</Badge>;
}

const INVOICE_STATUS: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'secondary'; icon: React.ComponentType<{ className?: string }> }> = {
  PAID: { label: 'Ödendi', tone: 'success', icon: CheckCircle2 },
  PENDING: { label: 'Bekliyor', tone: 'warning', icon: Clock },
  FAILED: { label: 'Başarısız', tone: 'danger', icon: XCircle },
  REFUNDED: { label: 'İade edildi', tone: 'secondary', icon: ArrowUpRight },
};

function InvoiceStatusBadge({ status }: { status: string }) {
  const m = INVOICE_STATUS[status] ?? { label: status, tone: 'secondary' as const, icon: AlertCircle };
  const Icon = m.icon;
  return <Badge variant={m.tone} className="gap-1"><Icon className="h-3 w-3" aria-hidden />{m.label}</Badge>;
}

function CancelDialog({
  open, onCancel, onConfirm, loading, plan,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  loading: boolean;
  plan?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !loading) onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Abonelik iptal edilsin mi?</DialogTitle>
          <DialogDescription>
            {plan ? <><strong>{plan}</strong> aboneliğini iptal etmek üzeresin.</> : 'Aboneliğini iptal etmek üzeresin.'}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <ul className="space-y-1.5 text-sm text-muted-foreground">
            <li>Aboneliğin iptal olarak işaretlenir ve sana onay e-postası gönderilir.</li>
            <li>Sitelerin, içeriklerin ve raporların silinmez.</li>
            <li>Ücret iadesi için destek ekibine yazman gerekir.</li>
          </ul>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={loading}>Vazgeç</Button>
          <Button variant="destructive" onClick={onConfirm} disabled={loading}>
            {loading ? 'İptal ediliyor…' : 'Aboneliği iptal et'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
