'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { readCheckout } from '@/lib/checkout-availability';
import { currentAccountId } from '@/lib/entitlements';

/**
 * Bu hesap icin satin alma acik mi — kilitli dugmelerin etiketi icin (lib/plan-limit.ts
 * upgradeLabel: kapaliyken "X'e geç" yerine "Bize yaz").
 *
 * Kaynak GET /billing/users/:id/current `checkout` (fiyat sayfasi, abonelik sayfasi ve plan
 * penceresiyle ayni uc; PayTR test modunda yalniz yonetici acik). Hesap kimligi haklarla
 * ayni /me isteginden gelir (lib/entitlements.ts currentAccountId). use-article-allowance.ts
 * ile ayni desen: modul ici tek promise — sayfadaki butun kilitli dugmeler tek istek
 * paylasir. Okunamazsa null (bilinmiyor): dugme "X'e geç" der, pencere durumu kendisi
 * gosterir; asil kapi sunucuda (assertCheckoutOpen).
 */
const STALE_MS = 60_000;

let cache: { at: number; promise: Promise<boolean | null> } | null = null;
let latest: boolean | null | undefined;

function load(): Promise<boolean | null> {
  if (cache && Date.now() - cache.at < STALE_MS) return cache.promise;
  const promise = currentAccountId()
    .then((id) => (id ? api.request<{ checkout?: unknown }>(`/billing/users/${encodeURIComponent(id)}/current`) : null))
    .then((r) => readCheckout(r?.checkout)?.open ?? null)
    .catch(() => null)
    .then((open) => {
      latest = open;
      return open;
    });
  cache = { at: Date.now(), promise };
  return promise;
}

/** true: acik, false: kapali (test modu), null: henuz bilinmiyor / okunamadi */
export function usePurchaseOpen(): boolean | null {
  const [open, setOpen] = useState<boolean | null>(latest ?? null);

  useEffect(() => {
    let alive = true;
    void load().then((value) => {
      if (alive) setOpen(value);
    });
    return () => {
      alive = false;
    };
  }, []);

  return open;
}
