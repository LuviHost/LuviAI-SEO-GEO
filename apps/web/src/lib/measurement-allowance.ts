'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';

/**
 * Haftalik AI olcum hakki — WEB TARAFI SADECE GOSTERIR.
 *
 * Kural ve asil kapi sunucuda (apps/api/src/billing/measurement-allowance.ts):
 * hesap basina 7 gunde 1 olcum; AI testi, Prompt Lab, urun radari, isi
 * haritasi... hepsi ayni hakki paylasir. Buradaki kilit yalnizca kullanicinin
 * 429 almadan once durumu gormesi icin.
 *
 * entitlements.ts ile ayni desen: modul ici tek promise (oturumda tek istek,
 * sonradan mount olan bilesen beklemeden deger alir) + bir olcumden sonra
 * TUM butonlarin birlikte kilitlenmesi icin abone listesi.
 */
export type MeasurementAllowance = Awaited<ReturnType<typeof api.getMeasurementAllowance>>;

export const WEEKLY_MEASUREMENT_LIMIT_CODE = 'WEEKLY_MEASUREMENT_LIMIT';

let cache: Promise<MeasurementAllowance | null> | null = null;
let latest: MeasurementAllowance | null = null;
const listeners = new Set<(a: MeasurementAllowance | null) => void>();

function load(): Promise<MeasurementAllowance | null> {
  if (!cache) {
    cache = api
      .getMeasurementAllowance()
      // Hata yutulur: durum bilinmiyorsa kilit gosterilmez, sunucu yine korur.
      .catch(() => null)
      .then((a) => {
        latest = a;
        listeners.forEach((fn) => fn(a));
        return a;
      });
  }
  return cache;
}

/** Bir olcum bittikten (ya da 429 alindiktan) sonra durumu tazele. */
export function refreshMeasurementAllowance(): void {
  cache = null;
  void load();
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
  const [allowance, setAllowance] = useState<MeasurementAllowance | null>(latest);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    listeners.add(setAllowance);
    void load().then(setAllowance);
    return () => {
      listeners.delete(setAllowance);
    };
  }, []);

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
