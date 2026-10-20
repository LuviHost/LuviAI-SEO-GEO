'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { api } from '@/lib/api';
import { PURCHASE_CONTACT_EMAIL, purchaseState, readCheckout } from '@/lib/checkout-availability';

/**
 * Satin alma durumu bu sure icinde okunamazsa (API yanit vermiyor) eski davranisa
 * donulur: metin + "Tekrar Dene". Sayfa bos kalmasin; odeme kapisi zaten sunucuda.
 */
const CHECKOUT_WAIT_MS = 8_000;

/**
 * PayTR basarisiz odeme donusu (merchant_fail_url — api paytr.service failUrl).
 *
 * NEDEN satin alma durumu okunuyor: "Tekrar Dene" herkesi /pricing'e yolluyordu.
 * PayTR test modunda yonetici disindaki hesaplar odeme baslatamaz (asil kapi api
 * paytr.service assertCheckoutOpen; fiyat sayfasinda butonlar kilitli), yani bu
 * musteri tekrar deneyemezdi ve sayfa nedenini soylemiyordu. Karar fiyat sayfasiyla
 * AYNI yardimci ve AYNI kaynaklardan gelir (lib/checkout-availability.ts
 * purchaseState): GET /billing/plans (anonim karar) + GET /billing/users/:id/current
 * (oturumdaki hesap; test modunda yonetici acik). Kapaliyken fiyat sayfasinin metni
 * ve iletisim adresi gosterilir, tekrar deneme baglantisi gosterilmez. Yoneticinin
 * test odemesinde (acik + test modu) baglanti kalir; odemenin gercek tahsilat
 * olmadigi success sayfasindaki notla ayni cumleyle yazilir.
 */
export default function FailurePage() {
  const { data: session, status } = useSession();
  const userId = session?.user?.id;
  // undefined = henuz okunmadi. Karar gelmeden metin ve baglanti cizilmez: yonetici
  // olmayan musteriye bir an "Tekrar Dene" gorunup kaybolmasin.
  const [pageCheckout, setPageCheckout] = useState<unknown>(undefined);
  const [accountCheckout, setAccountCheckout] = useState<unknown>(undefined);
  const [waitOver, setWaitOver] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setWaitOver(true), CHECKOUT_WAIT_MS);
    return () => clearTimeout(t);
  }, []);

  // Sayfa Turkce: metin de Turkce istenir (fiyat sayfasi kendi dilini gonderir)
  useEffect(() => {
    let stopped = false;
    api.getPlans('tr')
      .then((res) => { if (!stopped) setPageCheckout(res.checkout ?? null); })
      .catch(() => { if (!stopped) setPageCheckout(null); });
    return () => { stopped = true; };
  }, []);

  useEffect(() => {
    if (status === 'loading') return;
    if (!userId) { setAccountCheckout(null); return; }
    let stopped = false;
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
    fetch(`${apiBase}/api/billing/users/${userId}/current`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => { if (!stopped) setAccountCheckout(d?.checkout ?? null); })
      .catch(() => { if (!stopped) setAccountCheckout(null); });
    return () => { stopped = true; };
  }, [status, userId]);

  // Alan yoksa ya da istek basarisizsa purchaseState "acik" der (eski davranis; sunucu yine korur)
  const decided = waitOver || (pageCheckout !== undefined && accountCheckout !== undefined);
  const purchase = purchaseState({ page: pageCheckout, account: accountCheckout });
  const testMode = (readCheckout(accountCheckout) ?? readCheckout(pageCheckout))?.testMode === true;

  // Tema token'lari success sayfasiyla ayni (bg-card, border, text-muted-foreground). Eski kart
  // bg-white idi, baslik ise govdeden text-foreground aliyordu: karanlik temada "Odeme Basarisiz"
  // beyaz zeminde acik renk kaliyor, okunmuyordu; acik renkli gradyan da temaya uymuyordu.
  return (
    <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-muted/40 to-brand/5 p-4">
      <div className="max-w-md w-full text-center bg-card border p-10 sm:p-12 rounded-2xl shadow">
        <div className="text-6xl mb-4">❌</div>
        <h1 className="text-3xl font-bold mb-2">Ödeme Başarısız</h1>
        {!decided ? null : purchase.open ? (
          <>
            <p className="text-muted-foreground mb-6">
              Bir sorun oluştu — kart bilgilerinizi kontrol edip tekrar deneyebilirsiniz.
              Sorun devam ederse <a href="mailto:destek@luvihost.com" className="text-brand underline underline-offset-2">destek@luvihost.com</a> ile iletişime geçin.
            </p>
            {testMode && (
              <p className="text-xs text-muted-foreground mb-6">
                Ödeme altyapısı test modunda; test ödemeleri gerçek tahsilat değildir.
              </p>
            )}
            <Link
              href="/pricing"
              className="inline-block px-6 py-3 bg-brand text-white rounded-lg font-semibold"
            >
              Tekrar Dene
            </Link>
          </>
        ) : (
          // Fiyat sayfasindaki kilit metniyle ayni: API'nin metni + iletisim adresi
          <p role="status" className="text-muted-foreground">
            {purchase.message}{' '}
            <a href={`mailto:${PURCHASE_CONTACT_EMAIL}`} className="text-brand underline underline-offset-2">{PURCHASE_CONTACT_EMAIL}</a>
          </p>
        )}
      </div>
    </main>
  );
}
