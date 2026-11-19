'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';

/**
 * Haftalik AI olcum hakki — WEB TARAFI SADECE GOSTERIR.
 *
 * Kural ve asil kapi sunucuda (apps/api/src/billing/measurement-allowance.ts):
 * 18.11.2026'dan beri hak SITE basina — her site 7 gunde 1, takvim ayinda en fazla 4 kez
 * olculur; o sitedeki AI testi, Prompt Lab, urun radari, isi haritasi... ayni hakki paylasir.
 * Buradaki kilit yalnizca kullanicinin 429 almadan once durumu gormesi icin.
 *
 * Site kimligi adresten okunur (/sites/[id]/...): her site sayfasi kendi sitesinin hakkini
 * gosterir. Site disinda (adres siteye ait degilse) hesap anahtari sorulur.
 *
 * entitlements.ts ile ayni desen: site basina modul ici tek promise + bir olcumden sonra
 * o sitedeki TUM butonlarin birlikte kilitlenmesi icin abone listesi.
 */
export type MeasurementAllowance = Awaited<ReturnType<typeof api.getMeasurementAllowance>>;

export const WEEKLY_MEASUREMENT_LIMIT_CODE = 'WEEKLY_MEASUREMENT_LIMIT';

const HESAP = '__hesap__';
const cache = new Map<string, Promise<MeasurementAllowance | null>>();
const latest = new Map<string, MeasurementAllowance | null>();
const listeners = new Map<string, Set<(a: MeasurementAllowance | null) => void>>();

function load(key: string): Promise<MeasurementAllowance | null> {
  let p = cache.get(key);
  if (!p) {
    p = api
      .getMeasurementAllowance(key === HESAP ? null : key)
      // Hata yutulur: durum bilinmiyorsa kilit gosterilmez, sunucu yine korur.
      .catch(() => null)
      .then((a) => {
        latest.set(key, a);
        listeners.get(key)?.forEach((fn) => fn(a));
        return a;
      });
    cache.set(key, p);
  }
  return p;
}

/** Bir olcum bittikten (ya da 429 alindiktan) sonra durumu tazele — butun siteler. */
export function refreshMeasurementAllowance(): void {
  const keys = [...listeners.keys()];
  cache.clear();
  for (const k of keys) void load(k);
}

/** Sunucunun haftalik limit hatasi mi? */
export function isWeeklyMeasurementLimitError(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    !!err.rawBody &&
    typeof err.rawBody === 'object' &&
    (err.rawBody as { code?: unknown }).code === WEEKLY_MEASUREMENT_LIMIT_CODE
  );
}

const DATE_FMT = new Intl.DateTimeFormat('tr-TR', {
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
});

export type UseMeasurementAllowance = {
  allowance: MeasurementAllowance | null;
  /** true = bu hafta olcum yapilamaz (butonlari kilitle) */
  blocked: boolean;
  /** "23 Ekim 14:05" — blocked iken bir sonraki hakkin acilacagi an */
  nextLabel: string | null;
};

export function useMeasurementAllowance(): UseMeasurementAllowance {
  const params = useParams<{ id?: string | string[] }>();
  const raw = params?.id;
  const siteId = typeof raw === 'string' && raw ? raw : null;
  const key = siteId ?? HESAP;
  const [allowance, setAllowance] = useState<MeasurementAllowance | null>(latest.get(key) ?? null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let set = listeners.get(key);
    if (!set) { set = new Set(); listeners.set(key, set); }
    set.add(setAllowance);
    setAllowance(latest.get(key) ?? null);
    void load(key).then(setAllowance);
    return () => {
      listeners.get(key)?.delete(setAllowance);
    };
  }, [key]);

  const nextMs = allowance?.nextAvailableAt ? Date.parse(allowance.nextAvailableAt) : NaN;
  const blocked = !!allowance?.limited && !allowance.allowed && Number.isFinite(nextMs) && nextMs > now;

  // Pencere sayfa acikken dolarsa kilit kendiliginden kalksin
  useEffect(() => {
    if (!blocked) return;
    const wait = nextMs - Date.now();
    // setTimeout ~24.8 gunun ustunde tasar; pencere 7 gun, yine de sinirla
    const id = setTimeout(() => {
      setNow(Date.now());
      refreshMeasurementAllowance();
    }, Math.min(Math.max(wait, 1000), 2_000_000_000));
    return () => clearTimeout(id);
  }, [blocked, nextMs]);

  return {
    allowance,
    blocked,
    nextLabel: blocked ? DATE_FMT.format(new Date(nextMs)) : null,
  };
}
