'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { generationLock, type GenerationLock } from '@/lib/article-allowance';

/**
 * Makale hakki — WEB TARAFI SADECE GOSTERIR (karar: lib/article-allowance.ts).
 *
 * Asil kapi sunucuda (api billing/quota.service consumeArticleAllowance); buradaki
 * kilit yalniz musterinin 403 almadan once durumu gormesi icin. Okunamazsa
 * (ag hatasi, eski API, null) kilit gosterilmez.
 *
 * NEDEN /me/dashboard DEGIL de GET /billing/users/:sahip/current: hak SITENIN
 * SAHIBINDEN duser (sunucu site.userId). /me/dashboard oturumdaki hesabin hakkini
 * verir; yonetici bir musterinin sitesine baktiginda kendi hakkina gore kilit gormesin.
 * Uc yonetici icin her hesabi, digerleri icin yalniz kendi hesabini acar (ensureSelf).
 *
 * measurement-allowance.ts ile ayni desen: sahip basina modul ici tek promise
 * (oturumda tek istek, sonradan mount olan bilesen beklemeden deger alir) + bir
 * uretimden sonra TUM dugmelerin birlikte guncellenmesi icin abone listesi.
 */

type Snapshot = { quota: unknown; plan: unknown };

/** Bu kadar eski degeri yeni mount olan bilesen tazeler (hak iadesi / ay basi / yukseltme) */
const STALE_MS = 60_000;

const cache = new Map<string, { at: number; promise: Promise<Snapshot | null> }>();
const latest = new Map<string, Snapshot | null>();
const listeners = new Set<(ownerId: string, s: Snapshot | null) => void>();

function load(ownerId: string, force = false): Promise<Snapshot | null> {
  const hit = cache.get(ownerId);
  if (hit && !force && Date.now() - hit.at < STALE_MS) return hit.promise;
  const promise = api
    .request<{ plan?: unknown; articleQuota?: unknown }>(`/billing/users/${encodeURIComponent(ownerId)}/current`)
    .then((r) => ({ quota: r?.articleQuota ?? null, plan: r?.plan ?? null }))
    // Hata yutulur: durum bilinmiyorsa kilit gosterilmez, sunucu yine korur
    .catch(() => null)
    .then((s) => {
      latest.set(ownerId, s);
      listeners.forEach((fn) => fn(ownerId, s));
      return s;
    });
  cache.set(ownerId, { at: Date.now(), promise });
  return promise;
}

/**
 * Bir uretim denemesinden sonra (basarili, 403 ya da baska hata) hakki tazele.
 * Sahip verilmezse bilinen tum hesaplar tazelenir.
 */
export function refreshArticleAllowance(ownerId?: string | null): void {
  const ids = ownerId ? [ownerId] : Array.from(cache.keys());
  for (const id of ids) void load(id, true);
}

/** Sitenin sahibinin makale hakkina gore uretim dugmesi kilidi; sahip bilinmiyorsa acik */
export function useArticleAllowance(ownerId: string | null | undefined): GenerationLock {
  const id = typeof ownerId === 'string' && ownerId ? ownerId : null;
  // Deger sahibiyle birlikte tutulur: sahip degisirse eski hesabin degeri kullanilmaz
  const [state, setState] = useState<{ owner: string; snap: Snapshot | null } | null>(() =>
    id && latest.has(id) ? { owner: id, snap: latest.get(id) ?? null } : null,
  );

  useEffect(() => {
    if (!id) return;
    let alive = true;
    const onChange = (owner: string, s: Snapshot | null) => {
      if (alive && owner === id) setState({ owner, snap: s });
    };
    listeners.add(onChange);
    void load(id).then((s) => {
      if (alive) setState({ owner: id, snap: s });
    });
    return () => {
      alive = false;
      listeners.delete(onChange);
    };
  }, [id]);

  const snap = id && state?.owner === id ? state.snap : null;
  return generationLock(snap?.quota, snap?.plan);
}
