'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ArrowUpRight, Clock, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { UpgradePlanModal } from '@/components/upgrade-plan-modal';
import { PURCHASE_CONTACT_EMAIL } from '@/lib/checkout-availability';
import { LIMIT_COPY, PLAN_LIMIT_EVENT, upgradeAction, type UpgradeOffer, type UpgradeRequest } from '@/lib/plan-limit';
import { isRawTrialToast } from '@/lib/trial-errors';
import { usePurchaseOpen } from '@/lib/use-purchase-state';
import { useMeasurementAllowance } from '@/lib/measurement-allowance';
import { cn } from '@/lib/utils';

/*
 * Plan siniri: duvara carpan dugme musteriye yolu gosterir (kural ve metinler lib/plan-limit.ts).
 *
 *  - <UpgradeGate/> panel duzeninde BIR kez durur; PLAN_LIMIT_EVENT'i dinler ve plan
 *    penceresini (kartla alinan plan) ya da teklif penceresini (teklifle satilan plan) acar.
 *    Olay iki yerden gelir: kilitli dugmenin tiklamasi (openUpgrade) ve sunucunun plan siniri
 *    403'u (lib/api.ts announcePlanLimit) — ikincisinde cagiranin ham kirmizi bildirimi kapatilir.
 *  - <UpgradeButton/> kilitli dugme: ozgun dugmenin yerine gecer, istek ATMAZ.
 *  - <MeasurementWaitLabel/> haftalik olcum hakki: satis yok, dugmenin ustunde tarih.
 */

/** Plan / teklif penceresini ac (kilitli dugmeler ve kartlar bunu cagirir) */
export function openUpgrade(request: UpgradeRequest): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(PLAN_LIMIT_EVENT, { detail: request }));
}

/**
 * Cagiranin ham "toast.error(err.message)" kopyasini kapatir (trial-upgrade.tsx ile ayni
 * yol): olay hata firlatilmadan once yayinlanir, cagiranin catch'i sonraki mikro gorevde
 * bildirimi acar; bu yuzden bir sonraki gorevde aranir.
 */
function dismissRawToasts(message: string): void {
  for (const t of toast.getToasts()) {
    if ('title' in t && isRawTrialToast(t.title, message)) toast.dismiss(t.id);
  }
}

export function UpgradeGate() {
  const [request, setRequest] = useState<UpgradeRequest | null>(null);

  useEffect(() => {
    const onLimit = (e: Event) => {
      const detail = (e as CustomEvent<UpgradeRequest>).detail;
      if (!detail?.offer || detail.offer.kind === 'wait') return;
      setRequest(detail);
      if (detail.fromError && detail.reason) {
        // Iki gecis: cagiran, bildirimini acmadan once bir sey bekliyorsa (state, ag) ilk
        // gecis bildirimi kacirir; pencere acikken kirmizi kopya arkada kalmasin
        window.setTimeout(() => dismissRawToasts(detail.reason), 0);
        window.setTimeout(() => dismissRawToasts(detail.reason), 400);
      }
    };
    window.addEventListener(PLAN_LIMIT_EVENT, onLimit);
    return () => window.removeEventListener(PLAN_LIMIT_EVENT, onLimit);
  }, []);

  if (!request) return null;
  const close = () => setRequest(null);

  if (request.offer.kind === 'quote') {
    const planName = request.offer.planName ?? '';
    return (
      <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>{LIMIT_COPY.quoteTitle(planName)}</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-3">
            {request.reason && <DialogDescription>{request.reason}</DialogDescription>}
            <p className="text-sm text-muted-foreground">{LIMIT_COPY.quoteBody}</p>
            {/* Adres metin olarak da durur: e-posta programi olmayan cihazda baglanti hicbir sey acmaz */}
            <p className="rounded-md border bg-muted px-3 py-2 font-mono text-sm">{PURCHASE_CONTACT_EMAIL}</p>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={close}>Kapat</Button>
            <Button asChild size="sm">
              <a href={`mailto:${PURCHASE_CONTACT_EMAIL}?subject=${encodeURIComponent(LIMIT_COPY.quoteSubject(planName))}`}>
                {LIMIT_COPY.quote}
                <ArrowUpRight className="h-4 w-4" aria-hidden />
              </a>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <UpgradePlanModal
      open
      reason={request.reason}
      liftedBy={request.offer.planId}
      onClose={close}
      // Odeme tamamlandi: sayfadaki kilitler (haklar, makale hakki, satin alma durumu) modul
      // ici onbelleklerden okunuyor ve acik bilesenler kendiliginden tazelenmiyor. Sayfa
      // yeniden yuklenir ki musteri odedigi ozelligi hala kilitli gormesin; basari
      // bildirimi okunabilsin diye kisa bir gecikmeyle.
      onSuccess={() => { window.setTimeout(() => window.location.reload(), 1800); }}
    />
  );
}

/**
 * Kilitli dugme. Cerceveli ve kilit simgeli: turuncu yalniz sayfanin birincil eylemindedir,
 * satir satir tekrar eden kilit turuncu cogalmasin (panel vitrin dili). `variant="default"`
 * yalniz gorunumun TEK eylemi oldugu yerde (kilit karti) verilir.
 */
export function UpgradeButton({
  offer,
  reason,
  size = 'sm',
  variant = 'outline',
  className,
}: {
  offer: UpgradeOffer | null | undefined;
  /** Neden kilitli — pencerenin basliginin altinda ve dugmenin ipucunda gorunur */
  reason: string;
  size?: 'sm' | 'default';
  variant?: 'default' | 'outline' | 'secondary';
  className?: string;
}) {
  const purchaseOpen = usePurchaseOpen();
  // Ne yapacagi ve etiketi tek kararda (lib/plan-limit.ts upgradeAction, test edilir)
  const action = upgradeAction(offer, purchaseOpen);
  const icon = <Lock className={cn('mr-1.5', size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4')} aria-hidden />;
  if (action.mode === 'none') {
    // Hicbir plan siniri kaldirmiyor: satis penceresi acilmaz, dugme pasif; neden ipucunda
    return (
      <Button type="button" size={size} variant="outline" className={className} title={reason || undefined} disabled>
        {icon}
        {action.label}
        {reason && <span className="sr-only"> — {reason}</span>}
      </Button>
    );
  }
  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      className={className}
      title={reason || undefined}
      onClick={() => openUpgrade({ offer: action.offer, reason })}
    >
      {icon}
      {action.label}
      {reason && <span className="sr-only"> — {reason}</span>}
    </Button>
  );
}

/**
 * Haftalik olcum hakki kullanildiginda olcum dugmesinin ICINE yazilan etiket: "Sonraki
 * ölçüm 22 Kasım 14:05". Dugme pasif kalir (satilacak bir sey yok: hak her planda ayni);
 * ama gri, aciklamasiz bir dugme yerine ne zaman acilacagini soyler.
 */
export function MeasurementWaitLabel() {
  const { nextLabel } = useMeasurementAllowance();
  return (
    <>
      <Clock className="mr-1.5 h-3.5 w-3.5" aria-hidden />
      {nextLabel ? LIMIT_COPY.nextMeasurement(nextLabel) : 'Bu haftaki ölçüm kullanıldı'}
    </>
  );
}
