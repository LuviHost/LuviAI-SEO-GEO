'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { toast } from 'sonner';
import { Clock, Sparkles, X } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { readCheckout } from '@/lib/checkout-availability';
import {
  TRIAL_BILLING_HREF, TRIAL_COPY, TRIAL_UPGRADE_HREF, expiredModal, lapsedNotice, parseDismissed, readTrialAccess, trialBanner, trialPopup,
  trialPopupStorageKey, type TrialAccessView,
} from '@/lib/trial-access';
import { TRIAL_ERROR_COPY, TRIAL_ERROR_EVENT, isRawTrialToast, type TrialErrorAction } from '@/lib/trial-errors';
import { cn } from '@/lib/utils';

/*
 * Ucretsiz deneme: geri sayim bandi + hatirlatma penceresi + sure dolunca modal +
 * plani biten eski musteriye kapatilabilir "Planın sona erdi" bandi + sunucunun deneme
 * hata kodlarina tepki (lib/trial-errors.ts: TRIAL_EXPIRED modali acar,
 * TRIAL_SOURCE_REQUIRED yayin hedefi baglantili bildirim gosterir).
 * Kararlar lib/trial-access.ts'te (saf, test edilir); veri GET
 * /billing/users/:id/current (trialAccess, checkout, articleQuota). Okunamazsa
 * hicbir sey gosterilmez: asil kapi sunucuda (api trial-expiry.guard.ts).
 */

type Snapshot = { access: TrialAccessView | null; quota: unknown; checkoutMessage: string | null };

/** Sayfa gecislerinde en fazla bu siklikla yeniden okunur (her tikta istek atilmasin) */
const REFRESH_MS = 60_000;

/** Bu oturumda kapatilan "sure doldu" modali (yeni oturumda / sekmede yeniden acilir) */
const EXPIRED_SEEN_KEY = 'ranksup.trialExpiredSeen';

/** Bu oturumda kapatilan "Planın sona erdi" bandi */
const LAPSED_DISMISSED_KEY = 'ranksup.lapsedNoticeDismissed';

/**
 * Cagiranin ham "toast.error(err.message)" kopyasini kapatir. Olay hata firlatilmadan
 * once yayinlanir; cagiranin catch'i sonraki mikro gorevde bildirimi acar, bu yuzden
 * bir sonraki gorevde (setTimeout 0) aranir.
 */
function dismissRawToasts(message: string): void {
  for (const t of toast.getToasts()) {
    if ('title' in t && isRawTrialToast(t.title, message)) toast.dismiss(t.id);
  }
}

function readStore(fn: () => string | null): string | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

function writeStore(fn: () => void): void {
  try {
    fn();
  } catch {
    // Depo yoksa (gizli pencere) pencere bir kez fazla acilir; zarar yok
  }
}

export function TrialUpgrade() {
  const { data: session } = useSession();
  const userId = session?.user?.id ?? null;
  const pathname = usePathname();
  const router = useRouter();
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [expiredSeen, setExpiredSeen] = useState(false);
  const [lapsedDismissed, setLapsedDismissed] = useState(false);
  // Sunucu TRIAL_EXPIRED dondugunde durum hemen yeniden okunur (dakikalik sinir beklenmez)
  const [reloadKey, setReloadKey] = useState(0);
  const lastLoad = useRef<{ userId: string; at: number } | null>(null);

  useEffect(() => {
    const onTrialError = (e: Event) => {
      const action = (e as CustomEvent<TrialErrorAction>).detail;
      if (!action) return;
      if (action.kind === 'expired') {
        // Modal ham hata bildiriminin yerine gecer; "salt okunur devam" denmis olsa da
        // yapay zeka eylemi denendiginde yeniden acilir
        lastLoad.current = null;
        setExpiredSeen(false);
        writeStore(() => window.sessionStorage.removeItem(EXPIRED_SEEN_KEY));
        setReloadKey((k) => k + 1);
        window.setTimeout(() => dismissRawToasts(action.message), 0);
        return;
      }
      window.setTimeout(() => {
        dismissRawToasts(action.message);
        // Sabit kimlik: art arda tiklamada tek bildirim
        toast.error(action.message, {
          id: 'trial-source-required',
          duration: 10000,
          action: { label: TRIAL_ERROR_COPY.sourceAction, onClick: () => router.push(action.href) },
        });
      }, 0);
    };
    window.addEventListener(TRIAL_ERROR_EVENT, onTrialError);
    return () => window.removeEventListener(TRIAL_ERROR_EVENT, onTrialError);
  }, [router]);

  useEffect(() => {
    if (!userId) return;
    const last = lastLoad.current;
    if (last && last.userId === userId && Date.now() - last.at < REFRESH_MS) return;
    lastLoad.current = { userId, at: Date.now() };
    let alive = true;
    setDismissed(parseDismissed(readStore(() => window.localStorage.getItem(trialPopupStorageKey(userId)))));
    setExpiredSeen(readStore(() => window.sessionStorage.getItem(EXPIRED_SEEN_KEY)) === '1');
    setLapsedDismissed(readStore(() => window.sessionStorage.getItem(LAPSED_DISMISSED_KEY)) === '1');
    api
      .request<{ trialAccess?: unknown; articleQuota?: unknown; checkout?: unknown }>(`/billing/users/${encodeURIComponent(userId)}/current`)
      .then((r) => {
        if (!alive) return;
        setSnap({ access: readTrialAccess(r?.trialAccess), quota: r?.articleQuota ?? null, checkoutMessage: readCheckout(r?.checkout)?.message ?? null });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
    // Sayfa degisince (en fazla dakikada bir) yeniden okunur: uretim sonrasi hak bitti
    // penceresi ve kalan gun tazelenir
  }, [userId, pathname, reloadKey]);

  if (!userId || !snap?.access) return null;
  const banner = trialBanner(snap.access);
  const popup = trialPopup(snap.access, { quota: snap.quota, dismissed });
  const modal = expiredModal(snap.access, { pathname, checkoutMessage: snap.checkoutMessage });
  const lapsed = lapsedDismissed ? null : lapsedNotice(snap.access, { pathname });

  const dismissPopup = (key: string) => {
    const next = new Set(dismissed).add(key);
    setDismissed(next);
    writeStore(() => window.localStorage.setItem(trialPopupStorageKey(userId), JSON.stringify([...next])));
  };
  const closeExpired = () => {
    setExpiredSeen(true);
    writeStore(() => window.sessionStorage.setItem(EXPIRED_SEEN_KEY, '1'));
  };
  const closeLapsed = () => {
    setLapsedDismissed(true);
    writeStore(() => window.sessionStorage.setItem(LAPSED_DISMISSED_KEY, '1'));
  };

  return (
    <>
      {banner && (
        <div
          role="status"
          className={cn(
            'mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-4 py-2.5 text-sm',
            banner.tone === 'warning' ? 'border-warning/30 bg-warning/5' : 'border-info/25 bg-info/5',
          )}
        >
          <span className="inline-flex items-center gap-2">
            <Clock className={cn('h-4 w-4 shrink-0', banner.tone === 'warning' ? 'text-warning' : 'text-info')} aria-hidden />
            {banner.text}
          </span>
          <Button asChild size="sm" variant="outline">
            <Link href={TRIAL_UPGRADE_HREF}>{TRIAL_COPY.seePlans}</Link>
          </Button>
        </div>
      )}

      {/* Plani biten eski musteri: kilit yok, kapatilabilir bant (bu oturumda bir daha gosterilmez) */}
      {lapsed && (
        <div role="status" className="mb-4 flex flex-wrap items-start justify-between gap-2 rounded-lg border border-warning/30 bg-warning/5 px-4 py-2.5 text-sm">
          <div className="min-w-0 flex-1">
            <p className="font-medium">{lapsed.title}</p>
            <p className="mt-0.5 text-muted-foreground">{lapsed.body}</p>
          </div>
          <div className="flex items-center gap-1">
            <Button asChild size="sm">
              <Link href={TRIAL_UPGRADE_HREF}>{lapsed.cta}</Link>
            </Button>
            <Button size="sm" variant="ghost" onClick={closeLapsed} aria-label="Bandı kapat" title="Kapat">
              <X className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        </div>
      )}

      {/* Hatirlatma: kapatilabilir, bir kez */}
      {!modal && popup && (
        <Dialog open onOpenChange={(open) => { if (!open) dismissPopup(popup.key); }}>
          <DialogContent size="sm">
            <DialogHeader>
              <DialogTitle className="inline-flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-brand" aria-hidden />
                {popup.title}
              </DialogTitle>
            </DialogHeader>
            <DialogBody>
              <DialogDescription>{popup.body}</DialogDescription>
            </DialogBody>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => dismissPopup(popup.key)}>{TRIAL_COPY.later}</Button>
              <Button asChild size="sm" onClick={() => dismissPopup(popup.key)}>
                <Link href={TRIAL_UPGRADE_HREF}>{TRIAL_COPY.seePlans}</Link>
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Sure doldu: satin alma acikken engelleyen (kapatma yok, acik secim), kapaliyken kapatilabilir */}
      {modal && !expiredSeen && (
        <Dialog open onOpenChange={(open) => { if (!open && modal.dismissible) closeExpired(); }}>
          <DialogContent
            size="md"
            hideClose={!modal.dismissible}
            onEscapeKeyDown={(e) => { if (!modal.dismissible) e.preventDefault(); }}
            onPointerDownOutside={(e) => { if (!modal.dismissible) e.preventDefault(); }}
            onInteractOutside={(e) => { if (!modal.dismissible) e.preventDefault(); }}
          >
            <DialogHeader>
              <DialogTitle>{modal.title}</DialogTitle>
            </DialogHeader>
            <DialogBody className="space-y-3">
              <DialogDescription>{modal.body}</DialogDescription>
              {modal.checkoutMessage && <p className="rounded-md border bg-muted px-3 py-2 text-sm">{modal.checkoutMessage}</p>}
              <div className="grid gap-2 sm:grid-cols-2">
                <Link href={TRIAL_UPGRADE_HREF} className="rounded-lg border p-3 text-sm hover:border-brand">
                  <span className="font-medium">Planlar ve fiyatlar</span>
                  <span className="mt-1 block text-muted-foreground">Büyüme, Profesyonel ve Ajans planlarını karşılaştır.</span>
                </Link>
                <Link href={TRIAL_BILLING_HREF} className="rounded-lg border p-3 text-sm hover:border-brand">
                  <span className="font-medium">Abonelik</span>
                  <span className="mt-1 block text-muted-foreground">Planını ve faturalarını buradan yönet.</span>
                </Link>
              </div>
            </DialogBody>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={closeExpired}>
                {modal.dismissible ? TRIAL_COPY.later : TRIAL_COPY.continueReadOnly}
              </Button>
              <Button asChild size="sm">
                <Link href={TRIAL_UPGRADE_HREF}>{TRIAL_COPY.seePlans}</Link>
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
