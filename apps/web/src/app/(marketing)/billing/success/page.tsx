'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

const STORAGE_KEY = 'luviai-onboarding-v2';

export default function SuccessPage() {
  const router = useRouter();
  const [returnTo, setReturnTo] = useState<{ siteId?: string; step?: number } | null>(null);
  const [countdown, setCountdown] = useState(3);

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
    } catch (_e) { /* noop */ }
  }, []);

  // PayTR test mode webhook gondermiyor — kendimiz dev-confirm cagiralim
  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      try {
        const oid = localStorage.getItem('luviai-pending-merchantOid');
        if (!oid) return;
        const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '';
        await fetch(`${apiBase}/api/billing/dev-confirm/${oid}`, {
          method: 'POST',
          credentials: 'include',
        });
        if (!cancelled) {
          localStorage.removeItem('luviai-pending-merchantOid');
        }
      } catch (_e) { /* noop */ }
    };
    sync();
    return () => { cancelled = true; };
  }, []);

  // Onboarding state varsa 3 saniyede otomatik geri dön
  useEffect(() => {
    if (!returnTo?.siteId) return;
    if (countdown <= 0) {
      const sp = returnTo.step ? `&step=${returnTo.step}` : '';
      router.push(`/onboarding?siteId=${returnTo.siteId}${sp}&upgraded=1`);
      return;
    }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [returnTo, countdown, router]);

  const goBackToWizard = () => {
    if (!returnTo?.siteId) return;
    const sp = returnTo.step ? `&step=${returnTo.step}` : '';
    router.push(`/onboarding?siteId=${returnTo.siteId}${sp}&upgraded=1`);
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-50 to-brand/5 p-4">
      <div className="max-w-md text-center bg-white p-10 sm:p-12 rounded-2xl shadow">
        <div className="text-6xl mb-4">✅</div>
        <h1 className="text-3xl font-bold mb-2">Ödeme Başarılı!</h1>
        <p className="text-slate-600 mb-6">
          Aboneliğiniz aktif edildi. Yeni planınla daha fazla makale üretebilirsin.
        </p>

        {returnTo?.siteId ? (
          <>
            <p className="text-sm text-slate-500 mb-4">
              Kurulum sihirbazına <strong>{countdown}</strong> saniye içinde geri dönüleceksin…
            </p>
            <button
              onClick={goBackToWizard}
              className="inline-block w-full px-6 py-3 bg-brand text-white rounded-lg font-semibold hover:opacity-90"
            >
              Şimdi Sihirbaza Dön →
            </button>
            <Link
              href="/dashboard"
              className="block text-xs text-slate-400 mt-3 hover:underline"
            >
              veya Dashboard'a git
            </Link>
          </>
        ) : (
          <Link
            href="/dashboard"
            className="inline-block px-6 py-3 bg-brand text-white rounded-lg font-semibold"
          >
            Dashboard'a Git
          </Link>
        )}
      </div>
    </main>
  );
}
