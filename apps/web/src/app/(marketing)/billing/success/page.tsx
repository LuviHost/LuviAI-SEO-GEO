'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { AlertCircle, CheckCircle2, Clock, Loader2, XCircle } from 'lucide-react';
import { CHECKOUT_STORAGE_KEY } from '@/components/direct-checkout-form';
import { UNLOCK_DOMAIN_KEY } from '@/lib/unlock-return';
import { PURCHASE_CONTACT_EMAIL } from '@/lib/checkout-availability';
import {
  PAYMENT_POLL_MS,
  PAYMENT_WAIT_MS,
  PENDING_MERCHANT_OID_KEY,
  directCheckoutOid,
  findPaymentInvoice,
  keepPolling,
  mayDevConfirm,
  paymentMessage,
  paymentOutcome,
  paymentTestMode,
  type PaymentOutcome,
} from '@/lib/payment-status';

const STORAGE_KEY = 'luviai-onboarding-v2';

/** Depo kapaliysa (gizli pencere, engellenmis site verisi) okuma hata atabilir */
function readStorage(get: () => string | null): string | null {
  try { return get(); } catch { return null; }
}

/**
 * PayTR donus sayfasi (merchant_ok_url).
 *
 * Bu sayfaya gelmek odemenin onaylandigi anlamina GELMEZ (PayTR: onay bildirim
 * ucundan gelir). Eskiden her durumda "Odeme Basarili! Aboneliginiz aktif
 * edildi." yaziyor ve herkes icin dev-confirm cagiriyordu (yonetici olmayana
 * artik 403). Simdi aboneligin gercek durumunu okur, plan acilana kadar
 * "dogrulaniyor" der ve dev-confirm'i yalniz test modundaki yonetici icin
 * cagirir. Karar ve metinler: lib/payment-status.ts.
 */
export default function SuccessPage() {
  const router = useRouter();
  const { data: session, status: authStatus } = useSession();
  const userId = session?.user?.id;
  const [returnTo, setReturnTo] = useState<{ siteId?: string; step?: number } | null>(null);
  const [unlockDomain, setUnlockDomain] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(3);
  // null: ilk okuma bekleniyor
  const [outcome, setOutcome] = useState<PaymentOutcome | null>(null);
  const [testMode, setTestMode] = useState(false);
  // "Tekrar kontrol et" yeni bir bekleme turu baslatir
  const [round, setRound] = useState(0);

  // localStorage'dan onboarding state'i oku
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.siteId) {
          setReturnTo({ siteId: parsed.siteId, step: parsed.step });
        }
      }
    } catch { /* noop */ }
  }, []);

  // Teaser satis duvarindan gelindiyse odeme sonrasi rapora don.
  // PayTR'in ok_url'i sabit oldugu icin hedef domaini localStorage tasiyor.
  useEffect(() => {
    try {
      const d = localStorage.getItem(UNLOCK_DOMAIN_KEY);
      if (d) setUnlockDomain(d);
    } catch { /* noop */ }
  }, []);

  // Aboneligin gercek durumu: plan acilana, odeme reddedilene ya da bekleme
  // suresi dolana kadar yeniden okunur.
  useEffect(() => {
    if (authStatus === 'loading') return;
    if (!userId) {
      setOutcome({ kind: 'unknown' });
      return;
    }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let devConfirmTried = false;
    const startedAt = Date.now();
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
    // Bu tarayicida baslatilan odeme: iFrame akisi siparis numarasini localStorage'a,
    // Direkt API akisi imzali formu sekme deposuna birakir
    const candidates = [
      readStorage(() => localStorage.getItem(PENDING_MERCHANT_OID_KEY)),
      directCheckoutOid(readStorage(() => sessionStorage.getItem(CHECKOUT_STORAGE_KEY))),
    ];
    const getJson = (path: string, init?: RequestInit): Promise<unknown> =>
      fetch(`${apiBase}/api/billing${path}`, { credentials: 'include', ...init })
        .then((r) => r.json())
        .catch(() => null);
    const readState = () =>
      Promise.all([getJson(`/users/${userId}/current`), getJson(`/users/${userId}/invoices`)]);

    const tick = async () => {
      let [current, invoices] = await readState();
      if (stopped) return;
      let invoice = findPaymentInvoice(invoices, candidates);
      // Yalniz test modundaki yonetici: PayTR bildirimi gelmeden kendi test odemesini onaylar
      if (!devConfirmTried && invoice && mayDevConfirm(current, invoice)) {
        devConfirmTried = true;
        await getJson(`/dev-confirm/${encodeURIComponent(invoice.merchantOid)}`, { method: 'POST' });
        if (stopped) return;
        [current, invoices] = await readState();
        if (stopped) return;
        invoice = findPaymentInvoice(invoices, candidates);
      }
      const timedOut = Date.now() - startedAt >= PAYMENT_WAIT_MS;
      const next = paymentOutcome({ current, invoice, timedOut });
      // Gecici okuma hatasinda (429, ag) ekrandaki son durum kalir; bekleme bitince gosterilir
      if (next.kind !== 'unknown' || timedOut) {
        setOutcome(next);
        setTestMode(paymentTestMode(current));
      }
      if (keepPolling(next, timedOut)) {
        timer = setTimeout(() => { void tick(); }, PAYMENT_POLL_MS);
        return;
      }
      // Sonuc kesinlesti: bu siparis numarasi bir dahaki ziyarette yeniden aranmasin
      const settled = next.kind === 'failed' || (next.kind === 'active' && next.paymentConfirmed);
      if (settled && invoice) {
        try {
          if (localStorage.getItem(PENDING_MERCHANT_OID_KEY) === invoice.merchantOid) {
            localStorage.removeItem(PENDING_MERCHANT_OID_KEY);
          }
        } catch { /* noop */ }
      }
    };
    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [authStatus, userId, round]);

  const active = outcome?.kind === 'active';

  // Unlock akisi onceliklidir: kullanici tam raporu acmak icin odedi. Plan
  // acilmadan donulmez; rapor sayfasi yine satis duvarini gosterirdi.
  useEffect(() => {
    if (!active || !unlockDomain) return;
    try { localStorage.removeItem(UNLOCK_DOMAIN_KEY); } catch { /* noop */ }
    router.push(`/unlock?domain=${encodeURIComponent(unlockDomain)}`);
  }, [active, unlockDomain, router]);

  // Plan acildiysa ve onboarding state varsa 3 saniyede otomatik geri don
  useEffect(() => {
    if (!active || unlockDomain) return;
    if (!returnTo?.siteId) return;
    if (countdown <= 0) {
      const sp = returnTo.step ? `&step=${returnTo.step}` : '';
      router.push(`/onboarding?siteId=${returnTo.siteId}${sp}&upgraded=1`);
      return;
    }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [active, returnTo, countdown, router, unlockDomain]);

  const goBackToWizard = () => {
    if (!returnTo?.siteId) return;
    const sp = returnTo.step ? `&step=${returnTo.step}` : '';
    router.push(`/onboarding?siteId=${returnTo.siteId}${sp}&upgraded=1`);
  };

  const checkAgain = () => {
    setOutcome(null);
    setRound((r) => r + 1);
  };

  const msg = paymentMessage(outcome);
  const Icon = outcome === null || outcome.kind === 'verifying'
    ? Loader2
    : msg.tone === 'success' ? CheckCircle2 : msg.tone === 'error' ? XCircle : outcome.kind === 'unconfirmed' ? Clock : AlertCircle;
  const iconTone = msg.tone === 'success' ? 'text-success' : msg.tone === 'error' ? 'text-danger' : msg.tone === 'pending' ? 'text-brand' : 'text-warning';
  const spinning = outcome === null || outcome.kind === 'verifying';
  const showSupport = outcome?.kind === 'failed' || outcome?.kind === 'unconfirmed';

  return (
    <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-muted/40 to-brand/5 p-4">
      <div className="max-w-md w-full text-center bg-card border p-10 sm:p-12 rounded-2xl shadow">
        <Icon className={`mx-auto mb-4 h-14 w-14 ${iconTone} ${spinning ? 'animate-spin' : ''}`} aria-hidden="true" />
        <div role="status" aria-live="polite">
          <h1 className="text-3xl font-bold mb-2">{msg.title}</h1>
          <p className="text-muted-foreground mb-6">{msg.body}</p>
        </div>

        {showSupport && (
          <p className="text-sm text-muted-foreground mb-6">
            Ödeme yaptığın hâlde yeni planın açılmadıysa{' '}
            <a href={`mailto:${PURCHASE_CONTACT_EMAIL}`} className="text-brand underline underline-offset-2">{PURCHASE_CONTACT_EMAIL}</a>{' '}
            adresine yaz.
          </p>
        )}

        {testMode && (
          <p className="text-xs text-muted-foreground mb-6">
            Ödeme altyapısı test modunda; test ödemeleri gerçek tahsilat değildir.
          </p>
        )}

        {active && returnTo?.siteId && !unlockDomain ? (
          <>
            <p className="text-sm text-muted-foreground mb-4">
              Kurulum sihirbazına <strong>{countdown}</strong> saniye içinde geri dönüleceksin…
            </p>
            <button
              type="button"
              onClick={goBackToWizard}
              className="inline-block w-full px-6 py-3 bg-brand text-white rounded-lg font-semibold hover:opacity-90"
            >
              Şimdi Sihirbaza Dön →
            </button>
            <Link href="/dashboard" className="block text-xs text-muted-foreground mt-3 hover:underline">
              veya panele git
            </Link>
          </>
        ) : active ? (
          <Link href="/dashboard" className="inline-block px-6 py-3 bg-brand text-white rounded-lg font-semibold">
            Panele git
          </Link>
        ) : outcome === null || outcome.kind === 'verifying' ? (
          <Link href="/billing" className="text-sm text-muted-foreground hover:underline">
            Abonelik sayfasına git
          </Link>
        ) : (
          <div className="flex flex-col gap-3">
            {outcome.kind === 'failed' ? (
              <Link href="/pricing" className="inline-block px-6 py-3 bg-brand text-white rounded-lg font-semibold">
                Planlara dön
              </Link>
            ) : (
              <button
                type="button"
                onClick={checkAgain}
                className="inline-block w-full px-6 py-3 bg-brand text-white rounded-lg font-semibold hover:opacity-90"
              >
                Tekrar kontrol et
              </button>
            )}
            <Link href="/billing" className="text-sm text-muted-foreground hover:underline">
              Abonelik sayfasına git
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
